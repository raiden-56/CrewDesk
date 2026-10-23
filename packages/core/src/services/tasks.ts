import { TOOL_CATALOG, type AgentCategory, type CreateTaskInput, type ExecutionEventDto, type ExecutionEventType, type TaskDto, type TaskPriority, type TaskStatus } from '@collabspace/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { Errors } from '../errors.js';
import { submitTask } from '../engine/task-ops.js';
import { taskUsageTotals } from '../engine/usage.js';
import { publishRealtime } from '../events.js';
import { audit } from './audit.js';

export const taskInclude = {
  agent: { select: { id: true, name: true, avatar: true, color: true, category: true } },
  project: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { artifacts: { where: { deletedAt: null } } } },
  approvals: { where: { status: 'PENDING' as const }, select: { id: true }, take: 1 },
} as const;

type TaskRow = Prisma.AgentTaskGetPayload<{ include: typeof taskInclude }>;

export async function toTaskDto(t: TaskRow): Promise<TaskDto> {
  const usage = await taskUsageTotals(t.id);
  return {
    id: t.id,
    workspaceId: t.workspaceId,
    projectId: t.projectId,
    project: t.project,
    agentId: t.agentId,
    agent: { ...t.agent, category: t.agent.category as AgentCategory },
    agentVersionId: t.agentVersionId,
    title: t.title,
    description: t.description,
    status: t.status as TaskStatus,
    priority: t.priority as TaskPriority,
    progress: t.progress,
    progressMessage: t.progressMessage,
    deadline: t.deadline?.toISOString() ?? null,
    scheduledFor: t.scheduledFor?.toISOString() ?? null,
    expectedDeliverable: t.expectedDeliverable,
    allowedTools: Array.isArray(t.allowedTools) ? (t.allowedTools as string[]) : null,
    budgetUsd: t.budgetUsd,
    requireApprovalForWrites: t.requireApprovalForWrites,
    attempt: t.attempt,
    maxAttempts: t.maxAttempts,
    failureClass: t.failureClass,
    errorMessage: t.errorMessage,
    resultSummary: t.resultSummary,
    resultContent: t.resultContent,
    startedAt: t.startedAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
    durationMs: t.durationMs ?? (t.startedAt && !t.completedAt ? Date.now() - t.startedAt.getTime() : null),
    usage: { inputTokens: usage.hasUnavailable && usage.inputTokens === 0 ? null : usage.inputTokens, outputTokens: usage.hasUnavailable && usage.outputTokens === 0 ? null : usage.outputTokens, estimatedCostUsd: usage.requests ? usage.estimatedCostUsd : null, requests: usage.requests, toolInvocations: usage.toolInvocations, hasUnavailable: usage.hasUnavailable },
    createdBy: t.createdBy,
    conversationId: t.conversationId,
    workflowExecutionId: t.workflowExecutionId,
    pendingApprovalId: t.approvals[0]?.id ?? null,
    artifactCount: t._count.artifacts,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toEventDto(e: { id: string; taskId: string; executionId: string | null; type: string; level: string; message: string; metadata: unknown; diagnostics: unknown; durationMs: number | null; sequence: number; createdAt: Date }, includeDiagnostics: boolean): ExecutionEventDto {
  return {
    id: e.id,
    taskId: e.taskId,
    executionId: e.executionId,
    type: e.type as ExecutionEventType,
    level: e.level as ExecutionEventDto['level'],
    message: e.message,
    metadata: (e.metadata as Record<string, unknown> | null) ?? null,
    ...(includeDiagnostics ? { diagnostics: (e.diagnostics as Record<string, unknown> | null) ?? null } : {}),
    durationMs: e.durationMs,
    sequence: e.sequence,
    createdAt: e.createdAt.toISOString(),
  };
}

export async function createTask(workspaceId: string, actorId: string, input: CreateTaskInput, opts: { maxAttempts?: number; timeoutMs?: number } = {}) {
  const agent = await prisma.agent.findFirst({ where: { id: input.agentId, workspaceId }, include: { currentVersion: { select: { id: true, tools: true, modelConfig: true } } } });
  if (!agent || !agent.currentVersion) throw Errors.notFound('Agent');
  if (agent.archivedAt) throw Errors.conflict('Agent is archived');
  if (input.projectId) {
    const p = await prisma.project.findFirst({ where: { id: input.projectId, workspaceId }, select: { id: true } });
    if (!p) throw Errors.badRequest('Project does not belong to this workspace');
  }
  if (input.inputArtifactIds.length) {
    const count = await prisma.artifact.count({ where: { id: { in: input.inputArtifactIds }, workspaceId, deletedAt: null } });
    if (count !== new Set(input.inputArtifactIds).size) throw Errors.badRequest('One or more input files are not in this workspace');
  }
  // task-level tool allowlist can only narrow the agent's granted tools, never widen them
  const allowedTools = input.allowedTools ? input.allowedTools.filter((t) => agent.currentVersion!.tools.includes(t) && TOOL_CATALOG[t]) : null;
  if (input.idempotencyKey) {
    const existing = await prisma.agentTask.findFirst({ where: { workspaceId, idempotencyKey: input.idempotencyKey }, include: taskInclude });
    if (existing) return { task: await toTaskDto(existing), duplicate: true };
  }
  const mc = agent.currentVersion.modelConfig as { timeoutMs?: number; maxRetries?: number };
  const task = await prisma.agentTask.create({
    data: {
      workspaceId,
      projectId: input.projectId ?? agent.projectId,
      agentId: agent.id,
      agentVersionId: agent.currentVersion.id,
      title: input.title,
      description: input.description,
      status: input.asDraft ? 'DRAFT' : 'QUEUED',
      priority: input.priority as TaskPriority,
      deadline: input.deadline ? new Date(input.deadline) : null,
      scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
      expectedDeliverable: input.expectedDeliverable,
      allowedTools: allowedTools ?? undefined,
      inputArtifactIds: input.inputArtifactIds,
      budgetUsd: input.budgetUsd,
      requireApprovalForWrites: input.requireApprovalForWrites,
      idempotencyKey: input.idempotencyKey ?? null,
      conversationId: input.conversationId ?? null,
      createdById: actorId,
      maxAttempts: opts.maxAttempts ?? 1 + (mc.maxRetries ?? 2),
      timeoutMs: opts.timeoutMs ?? mc.timeoutMs ?? 600000,
      progressMessage: input.asDraft ? 'Draft' : 'Queued',
    },
    include: taskInclude,
  });
  await audit({ workspaceId, actorId, action: 'task.created', resourceType: 'task', resourceId: task.id, metadata: { title: task.title, agentId: agent.id, priority: task.priority, draft: input.asDraft } });
  if (!input.asDraft) {
    if (agent.status === 'PAUSED') {
      await prisma.agentTask.update({ where: { id: task.id }, data: { status: 'PAUSED', progressMessage: 'Agent is paused' } });
    } else {
      await submitTask(task.id);
    }
  }
  const fresh = await prisma.agentTask.findUniqueOrThrow({ where: { id: task.id }, include: taskInclude });
  await publishRealtime({ type: 'task.updated', workspaceId, task: { id: fresh.id, status: fresh.status as TaskStatus, progress: fresh.progress, progressMessage: fresh.progressMessage, agentId: fresh.agentId, updatedAt: fresh.updatedAt.toISOString() } });
  return { task: await toTaskDto(fresh), duplicate: false };
}

export async function duplicateTask(workspaceId: string, taskId: string, actorId: string) {
  const t = await prisma.agentTask.findFirst({ where: { id: taskId, workspaceId } });
  if (!t) throw Errors.notFound('Task');
  return createTask(workspaceId, actorId, {
    title: t.title,
    description: t.description,
    agentId: t.agentId,
    projectId: t.projectId,
    priority: t.priority as TaskPriority,
    deadline: null,
    scheduledFor: null,
    inputArtifactIds: t.inputArtifactIds,
    expectedDeliverable: t.expectedDeliverable,
    allowedTools: Array.isArray(t.allowedTools) ? (t.allowedTools as string[]) : null,
    budgetUsd: t.budgetUsd,
    requireApprovalForWrites: t.requireApprovalForWrites,
    asDraft: true,
  });
}

/** Publish a DRAFT task (e.g. one created by a planner agent) so it executes. */
export async function publishDraftTask(workspaceId: string, taskId: string, actorId: string) {
  const t = await prisma.agentTask.findFirst({ where: { id: taskId, workspaceId }, select: { status: true, agentId: true } });
  if (!t) throw Errors.notFound('Task');
  if (t.status !== 'DRAFT') throw Errors.conflict('Only draft tasks can be published');
  await submitTask(taskId);
  await audit({ workspaceId, actorId, action: 'task.published', resourceType: 'task', resourceId: taskId });
  return prisma.agentTask.findUniqueOrThrow({ where: { id: taskId }, include: taskInclude }).then(toTaskDto);
}
