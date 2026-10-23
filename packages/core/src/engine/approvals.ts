import { canApproveRisk, TOOL_CATALOG, type ApprovalDto, type ApprovalStatus, type RiskLevel, type TaskStatus, type WorkspaceRole } from '@collabspace/shared';
import { prisma } from '../db.js';
import { hashProposal } from '../crypto.js';
import { Errors } from '../errors.js';
import { publishRealtime, recordEvent } from '../events.js';
import { enqueueAgentTask, enqueueWorkflowAdvance } from '../queue.js';
import { audit } from '../services/audit.js';
import { notifyRoles, notifyUser } from '../services/notifications.js';
import { transitionTask } from './task-ops.js';

const APPROVAL_TTL_MS = 7 * 24 * 3600 * 1000;

export const approvalInclude = {
  task: { select: { id: true, title: true, status: true } },
  agent: { select: { id: true, name: true, avatar: true, color: true } },
  decisions: { include: { decidedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' as const } },
} as const;

type ApprovalRow = Awaited<ReturnType<typeof prisma.approvalRequest.findFirstOrThrow<{ include: typeof approvalInclude }>>>;

export function toApprovalDto(a: ApprovalRow): ApprovalDto {
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    taskId: a.taskId,
    task: a.task ? { id: a.task.id, title: a.task.title, status: a.task.status as TaskStatus } : null,
    workflowExecutionId: a.workflowExecutionId,
    agentId: a.agentId,
    agent: a.agent,
    toolId: a.toolId,
    actionTitle: a.actionTitle,
    actionDescription: a.actionDescription,
    targetResource: a.targetResource,
    risk: a.risk as RiskLevel,
    proposal: (a.proposal as Record<string, unknown>) ?? {},
    proposalVersion: a.proposalVersion,
    proposalHash: a.proposalHash,
    evidence: (a.evidence as Record<string, unknown> | null) ?? null,
    diff: (a.diff as { before: string | null; after: string | null } | null) ?? null,
    status: a.status as ApprovalStatus,
    expiresAt: a.expiresAt?.toISOString() ?? null,
    decisions: a.decisions.map((d) => ({ id: d.id, decision: d.decision, comment: d.comment, decidedBy: d.decidedBy, createdAt: d.createdAt.toISOString() })),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export interface CreateApprovalInput {
  workspaceId: string;
  taskId?: string | null;
  workflowExecutionId?: string | null;
  workflowNodeExecutionId?: string | null;
  agentId?: string | null;
  toolId?: string | null;
  invocationId?: string | null;
  actionTitle: string;
  actionDescription: string;
  targetResource: string | null;
  risk: RiskLevel;
  proposal: Record<string, unknown>;
  evidence?: Record<string, unknown> | null;
  diff?: { before: string | null; after: string | null } | null;
  requestedByType?: 'AGENT' | 'USER' | 'SYSTEM';
}

/** Persist an immutable proposal and notify reviewers. The hash pins the exact action approved later. */
export async function createApproval(input: CreateApprovalInput) {
  const proposalHash = hashProposal({ toolId: input.toolId ?? null, proposal: input.proposal, targetResource: input.targetResource ?? null });
  const approval = await prisma.approvalRequest.create({
    data: {
      workspaceId: input.workspaceId,
      taskId: input.taskId ?? null,
      workflowExecutionId: input.workflowExecutionId ?? null,
      workflowNodeExecutionId: input.workflowNodeExecutionId ?? null,
      agentId: input.agentId ?? null,
      toolId: input.toolId ?? null,
      actionTitle: input.actionTitle,
      actionDescription: input.actionDescription,
      targetResource: input.targetResource,
      risk: input.risk,
      proposal: input.proposal as object,
      proposalVersion: 1,
      proposalHash,
      evidence: (input.evidence ?? undefined) as object | undefined,
      diff: (input.diff ?? undefined) as object | undefined,
      requestedByType: input.requestedByType ?? 'AGENT',
      expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
    },
    include: approvalInclude,
  });
  if (input.invocationId) await prisma.toolInvocation.update({ where: { id: input.invocationId }, data: { approvalId: approval.id, status: 'AWAITING_APPROVAL' } });
  const roles: WorkspaceRole[] = input.risk === 'CRITICAL' ? ['OWNER', 'ADMIN'] : ['OWNER', 'ADMIN', 'APPROVER'];
  await notifyRoles({ workspaceId: input.workspaceId, roles, type: 'APPROVAL_REQUESTED', title: `Approval needed: ${input.actionTitle}`, body: input.actionDescription.slice(0, 200), link: `/approvals/${approval.id}` });
  await publishRealtime({ type: 'approval.updated', workspaceId: input.workspaceId, approvalId: approval.id, status: 'PENDING', taskId: approval.taskId });
  await audit({ workspaceId: input.workspaceId, actorType: 'AGENT', action: 'approval.requested', resourceType: 'approval', resourceId: approval.id, metadata: { toolId: input.toolId, risk: input.risk, taskId: input.taskId, targetResource: input.targetResource } });
  return toApprovalDto(approval);
}

export interface DecisionInput {
  approvalId: string;
  workspaceId: string;
  userId: string;
  userRole: WorkspaceRole;
  decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';
  comment?: string | null;
  proposalVersion: number;
  ip?: string | null;
  requestId?: string | null;
}

/**
 * Record a reviewer decision. The decision is bound to the proposal version the reviewer saw,
 * the reviewer must hold a role allowed for the risk level, and the request must still be pending.
 * Execution of an approved action happens in the worker with fresh permission checks.
 */
export async function decideApproval(input: DecisionInput) {
  const approval = await prisma.approvalRequest.findFirst({ where: { id: input.approvalId, workspaceId: input.workspaceId }, include: approvalInclude });
  if (!approval) throw Errors.notFound('Approval request');
  if (!canApproveRisk(input.userRole, approval.risk as RiskLevel)) throw Errors.forbidden(`Your role cannot decide ${approval.risk.toLowerCase()}-risk approvals`);
  if (approval.status !== 'PENDING') throw Errors.conflict(`Approval request is already ${approval.status.toLowerCase()}`);
  if (approval.expiresAt && approval.expiresAt < new Date()) {
    await prisma.approvalRequest.update({ where: { id: approval.id }, data: { status: 'EXPIRED' } });
    throw Errors.conflict('Approval request has expired');
  }
  if (approval.proposalVersion !== input.proposalVersion) throw Errors.conflict('The proposal changed since you viewed it. Reload and review the new version.');
  // Re-verify the stored proposal hash matches the stored proposal (tamper detection)
  const expectedHash = hashProposal({ toolId: approval.toolId, proposal: approval.proposal, targetResource: approval.targetResource });
  if (expectedHash !== approval.proposalHash) throw Errors.conflict('Proposal integrity check failed');

  const status: ApprovalStatus = input.decision;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.approvalDecision.create({ data: { approvalId: approval.id, decision: input.decision, comment: input.comment ?? null, decidedById: input.userId, proposalVersion: approval.proposalVersion } });
    return tx.approvalRequest.update({ where: { id: approval.id }, data: { status }, include: approvalInclude });
  });

  const eventType = input.decision === 'APPROVED' ? 'APPROVAL_GRANTED' : input.decision === 'REJECTED' ? 'APPROVAL_REJECTED' : 'APPROVAL_CHANGES_REQUESTED';
  if (approval.taskId) {
    await recordEvent({ taskId: approval.taskId, workspaceId: approval.workspaceId, type: eventType, level: input.decision === 'APPROVED' ? 'SUCCESS' : 'WARNING', message: `${approval.actionTitle}: ${input.decision.toLowerCase().replace('_', ' ')} by reviewer`, metadata: { approvalId: approval.id, decidedBy: input.userId, comment: input.comment ?? null, toolId: approval.toolId } });
    // Resume the paused task; the worker re-validates permissions before executing the action.
    const task = await prisma.agentTask.findUnique({ where: { id: approval.taskId }, select: { status: true, priority: true, attempt: true, createdById: true, title: true } });
    if (task?.status === 'WAITING_APPROVAL') {
      await transitionTask(approval.taskId, 'QUEUED', { progressMessage: input.decision === 'APPROVED' ? 'Approved; resuming execution' : 'Reviewer decision received; resuming' });
      await enqueueAgentTask(approval.taskId, { priority: task.priority, resume: true, attempt: task.attempt });
    }
    if (task?.createdById && task.createdById !== input.userId) {
      await notifyUser({ workspaceId: approval.workspaceId, userId: task.createdById, type: 'APPROVAL_DECIDED', title: `Approval ${input.decision.toLowerCase().replace('_', ' ')}`, body: `${approval.actionTitle} for task "${task.title}"`, link: `/tasks/${approval.taskId}` });
    }
  } else if (approval.workflowExecutionId) {
    await enqueueWorkflowAdvance(approval.workflowExecutionId, approval.workflowNodeExecutionId ?? undefined);
  }
  await publishRealtime({ type: 'approval.updated', workspaceId: approval.workspaceId, approvalId: approval.id, status, taskId: approval.taskId });
  await audit({ workspaceId: approval.workspaceId, actorId: input.userId, actorType: 'USER', action: `approval.${input.decision.toLowerCase()}`, resourceType: 'approval', resourceId: approval.id, metadata: { toolId: approval.toolId, risk: approval.risk, proposalVersion: approval.proposalVersion, proposalHash: approval.proposalHash, comment: input.comment ?? null, taskId: approval.taskId }, ip: input.ip, requestId: input.requestId });
  return toApprovalDto(updated);
}

/** Maintenance: expire pending approvals past their deadline and fail their tasks. */
export async function expireApprovals() {
  const expired = await prisma.approvalRequest.findMany({ where: { status: 'PENDING', expiresAt: { lt: new Date() } } });
  for (const a of expired) {
    await prisma.approvalRequest.update({ where: { id: a.id }, data: { status: 'EXPIRED' } });
    await publishRealtime({ type: 'approval.updated', workspaceId: a.workspaceId, approvalId: a.id, status: 'EXPIRED', taskId: a.taskId });
    if (a.taskId) {
      const task = await prisma.agentTask.findUnique({ where: { id: a.taskId }, select: { status: true, agentId: true } });
      if (task?.status === 'WAITING_APPROVAL') {
        await transitionTask(a.taskId, 'TIMED_OUT', { errorMessage: 'Approval request expired', failureClass: 'TIMEOUT', completedAt: new Date(), progressMessage: 'Approval expired' });
        await recordEvent({ taskId: a.taskId, workspaceId: a.workspaceId, type: 'TASK_TIMED_OUT', level: 'ERROR', message: 'Approval request expired before a reviewer decided' });
      }
    }
  }
  return expired.length;
}

export function riskForTool(toolId: string): RiskLevel {
  return TOOL_CATALOG[toolId]?.risk ?? 'HIGH';
}
