import { validateWorkflowGraph, type NodeExecutionStatus, type WorkflowDto, type WorkflowExecutionDto, type WorkflowExecutionStatus, type WorkflowGraph } from '@collabspace/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { Errors } from '../errors.js';
import { enqueueWorkflowAdvance } from '../queue.js';
import { advanceWorkflow } from '../workflow/runner.js';
import { audit } from './audit.js';

export const workflowInclude = { currentVersion: true, executions: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { id: true, status: true, createdAt: true } } } as const;
type WorkflowRow = Prisma.WorkflowGetPayload<{ include: typeof workflowInclude }>;

export function toWorkflowDto(w: WorkflowRow): WorkflowDto {
  return {
    id: w.id,
    workspaceId: w.workspaceId,
    projectId: w.projectId,
    name: w.name,
    description: w.description,
    currentVersion: w.currentVersion?.version ?? 0,
    currentVersionId: w.currentVersion?.id ?? '',
    graph: (w.currentVersion?.graph as WorkflowGraph) ?? { nodes: [], edges: [] },
    isTemplate: w.isTemplate,
    lastExecution: w.executions[0] ? { id: w.executions[0].id, status: w.executions[0].status as WorkflowExecutionStatus, createdAt: w.executions[0].createdAt.toISOString() } : null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

export const executionInclude = { nodes: { orderBy: { startedAt: 'asc' as const } }, version: { select: { version: true } } } as const;
type ExecutionRow = Prisma.WorkflowExecutionGetPayload<{ include: typeof executionInclude }>;

export function toExecutionDto(e: ExecutionRow): WorkflowExecutionDto {
  return {
    id: e.id,
    workflowId: e.workflowId,
    workflowVersionId: e.workflowVersionId,
    version: e.version.version,
    status: e.status as WorkflowExecutionStatus,
    dryRun: e.dryRun,
    input: (e.input as Record<string, unknown>) ?? {},
    output: (e.output as Record<string, unknown> | null) ?? null,
    errorMessage: e.errorMessage,
    startedAt: e.startedAt?.toISOString() ?? null,
    completedAt: e.completedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
    nodes: e.nodes.map((n) => {
      const output = (n.output as Record<string, unknown> | null) ?? null;
      const { __activatedEdges: _a, ...cleanOutput } = output ?? {};
      void _a;
      return {
        id: n.id,
        nodeId: n.nodeId,
        nodeType: n.nodeType,
        label: n.label,
        status: n.status as NodeExecutionStatus,
        attempt: n.attempt,
        input: (n.input as Record<string, unknown> | null) ?? null,
        output: output ? cleanOutput : null,
        errorMessage: n.errorMessage,
        taskId: typeof output?.taskId === 'string' ? output.taskId : null,
        approvalId: typeof output?.approvalId === 'string' ? output.approvalId : null,
        logs: (n.logs as Array<{ at: string; level: string; message: string }>) ?? [],
        startedAt: n.startedAt?.toISOString() ?? null,
        completedAt: n.completedAt?.toISOString() ?? null,
      };
    }),
  };
}

export async function createWorkflow(workspaceId: string, actorId: string, input: { name: string; description: string; projectId: string | null; graph: WorkflowGraph; changeSummary?: string; isTemplate?: boolean }) {
  const workflow = await prisma.$transaction(async (tx) => {
    const w = await tx.workflow.create({ data: { workspaceId, projectId: input.projectId, name: input.name, description: input.description, createdById: actorId, isTemplate: input.isTemplate ?? false } });
    const v = await tx.workflowVersion.create({ data: { workflowId: w.id, version: 1, graph: input.graph as object, changeSummary: input.changeSummary ?? 'Initial version', createdById: actorId } });
    await tx.workflow.update({ where: { id: w.id }, data: { currentVersionId: v.id } });
    return tx.workflow.findUniqueOrThrow({ where: { id: w.id }, include: workflowInclude });
  });
  await audit({ workspaceId, actorId, action: 'workflow.created', resourceType: 'workflow', resourceId: workflow.id, metadata: { name: workflow.name, nodes: input.graph.nodes.length } });
  return toWorkflowDto(workflow);
}

export async function updateWorkflow(workspaceId: string, workflowId: string, actorId: string, input: { name?: string; description?: string; projectId?: string | null; graph?: WorkflowGraph; changeSummary?: string }) {
  const existing = await prisma.workflow.findFirst({ where: { id: workflowId, workspaceId }, include: workflowInclude });
  if (!existing) throw Errors.notFound('Workflow');
  const workflow = await prisma.$transaction(async (tx) => {
    await tx.workflow.update({ where: { id: workflowId }, data: { name: input.name, description: input.description, projectId: input.projectId } });
    if (input.graph) {
      const v = await tx.workflowVersion.create({ data: { workflowId, version: (existing.currentVersion?.version ?? 0) + 1, graph: input.graph as object, changeSummary: input.changeSummary ?? 'Graph updated', createdById: actorId } });
      await tx.workflow.update({ where: { id: workflowId }, data: { currentVersionId: v.id } });
    }
    return tx.workflow.findUniqueOrThrow({ where: { id: workflowId }, include: workflowInclude });
  });
  await audit({ workspaceId, actorId, action: 'workflow.updated', resourceType: 'workflow', resourceId: workflowId, metadata: { newVersion: input.graph ? (existing.currentVersion?.version ?? 0) + 1 : null } });
  return toWorkflowDto(workflow);
}

export async function duplicateWorkflow(workspaceId: string, workflowId: string, actorId: string) {
  const existing = await prisma.workflow.findFirst({ where: { id: workflowId, workspaceId }, include: workflowInclude });
  if (!existing?.currentVersion) throw Errors.notFound('Workflow');
  return createWorkflow(workspaceId, actorId, { name: `${existing.name} (copy)`, description: existing.description, projectId: existing.projectId, graph: existing.currentVersion.graph as WorkflowGraph, changeSummary: `Duplicated from ${existing.name} v${existing.currentVersion.version}`, isTemplate: false });
}

export async function listVersions(workspaceId: string, workflowId: string) {
  const w = await prisma.workflow.findFirst({ where: { id: workflowId, workspaceId }, select: { id: true } });
  if (!w) throw Errors.notFound('Workflow');
  const versions = await prisma.workflowVersion.findMany({ where: { workflowId }, orderBy: { version: 'desc' }, include: { createdBy: { select: { id: true, name: true } } } });
  return versions.map((v) => ({ id: v.id, version: v.version, changeSummary: v.changeSummary, createdAt: v.createdAt.toISOString(), createdBy: v.createdBy, graph: v.graph as WorkflowGraph }));
}

/** Validate the current version; also checks referenced agents exist and are not archived. */
export async function validateWorkflow(workspaceId: string, graph: WorkflowGraph) {
  const result = validateWorkflowGraph(graph);
  const issues = [...result.issues];
  for (const n of graph.nodes) {
    if (n.type === 'AGENT' && n.data.agentId) {
      const a = await prisma.agent.findFirst({ where: { id: n.data.agentId, workspaceId, archivedAt: null }, select: { id: true, status: true, name: true } });
      if (!a) issues.push({ level: 'error', nodeId: n.id, message: `Agent ${n.data.agentId} not found in this workspace` });
      else if (a.status === 'PAUSED') issues.push({ level: 'warning', nodeId: n.id, message: `Agent ${a.name} is paused; the step will fail until it is resumed` });
    }
    if (n.type === 'TOOL' && n.data.toolId) {
      const { TOOL_CATALOG } = await import('@collabspace/shared');
      const def = TOOL_CATALOG[n.data.toolId];
      if (def && def.category !== 'READ') issues.push({ level: 'error', nodeId: n.id, message: `Tool nodes may only use read-only tools; ${def.name} requires an Agent node so permissions and approvals apply` });
    }
  }
  return { valid: !issues.some((i) => i.level === 'error'), issues, order: result.order };
}

export async function executeWorkflow(workspaceId: string, workflowId: string, actorId: string, input: Record<string, unknown>, dryRun: boolean) {
  const w = await prisma.workflow.findFirst({ where: { id: workflowId, workspaceId }, include: workflowInclude });
  if (!w?.currentVersion) throw Errors.notFound('Workflow');
  const validation = await validateWorkflow(workspaceId, w.currentVersion.graph as WorkflowGraph);
  if (!validation.valid) throw Errors.badRequest('Workflow is invalid', validation.issues);
  const execution = await prisma.workflowExecution.create({ data: { workspaceId, workflowId, workflowVersionId: w.currentVersion.id, status: 'PENDING', dryRun, input: input as object, startedById: actorId } });
  await audit({ workspaceId, actorId, action: dryRun ? 'workflow.dry_run' : 'workflow.executed', resourceType: 'workflow', resourceId: workflowId, metadata: { executionId: execution.id, version: w.currentVersion.version } });
  if (dryRun) {
    // dry runs are synchronous: no external side effects are possible
    await advanceWorkflow(execution.id);
  } else {
    await enqueueWorkflowAdvance(execution.id);
  }
  return toExecutionDto(await prisma.workflowExecution.findUniqueOrThrow({ where: { id: execution.id }, include: executionInclude }));
}

export async function listExecutions(workspaceId: string, workflowId: string) {
  const w = await prisma.workflow.findFirst({ where: { id: workflowId, workspaceId }, select: { id: true } });
  if (!w) throw Errors.notFound('Workflow');
  const rows = await prisma.workflowExecution.findMany({ where: { workflowId }, orderBy: { createdAt: 'desc' }, take: 50, include: executionInclude });
  return rows.map(toExecutionDto);
}

export async function getExecution(workspaceId: string, executionId: string) {
  const row = await prisma.workflowExecution.findFirst({ where: { id: executionId, workspaceId }, include: executionInclude });
  if (!row) throw Errors.notFound('Workflow execution');
  return toExecutionDto(row);
}

export const WORKFLOW_TEMPLATES: Array<{ name: string; description: string; graph: (agentIds: Record<string, string>) => WorkflowGraph }> = [
  {
    name: 'Research → Review → Approve → Document',
    description: 'Researcher produces findings, QA reviews them, a human approves, Documentation writes the final report.',
    graph: (ids) => ({
      nodes: [
        { id: 'start', type: 'START', position: { x: 0, y: 160 }, data: { label: 'Start' } },
        { id: 'research', type: 'AGENT', position: { x: 240, y: 160 }, data: { label: 'Research', agentId: ids.RESEARCHER ?? '', taskTitle: 'Research: {{input.topic}}', instructions: 'Research the topic "{{input.topic}}" using approved sources and produce a findings report with citations.' } },
        { id: 'review', type: 'AGENT', position: { x: 520, y: 160 }, data: { label: 'QA review', agentId: ids.QA_REVIEWER ?? '', taskTitle: 'Review research: {{input.topic}}', instructions: 'Review the research findings below for gaps, unsupported claims and inconsistencies. Produce a findings table with severity.' } },
        { id: 'approve', type: 'APPROVAL', position: { x: 800, y: 160 }, data: { label: 'Human approval', approvalTitle: 'Approve research for publication', risk: 'MEDIUM' } },
        { id: 'document', type: 'AGENT', position: { x: 1080, y: 160 }, data: { label: 'Final report', agentId: ids.DOCUMENTATION ?? '', taskTitle: 'Final report: {{input.topic}}', instructions: 'Write the final polished report from the approved research and review notes below.' } },
        { id: 'end', type: 'END', position: { x: 1360, y: 160 }, data: { label: 'End' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'research' },
        { id: 'e2', source: 'research', target: 'review' },
        { id: 'e3', source: 'review', target: 'approve' },
        { id: 'e4', source: 'approve', target: 'document' },
        { id: 'e5', source: 'document', target: 'end' },
      ],
      inputSchema: { topic: 'string' },
    }),
  },
  {
    name: 'Plan → Draft tasks → Approve → Notify',
    description: 'Planner creates task drafts, a human approves them, then the project owner is notified.',
    graph: (ids) => ({
      nodes: [
        { id: 'start', type: 'START', position: { x: 0, y: 160 }, data: { label: 'Start' } },
        { id: 'plan', type: 'AGENT', position: { x: 240, y: 160 }, data: { label: 'Plan', agentId: ids.PROJECT_PLANNER ?? '', taskTitle: 'Plan: {{input.objective}}', instructions: 'Create a project plan and task drafts for: {{input.objective}}' } },
        { id: 'approve', type: 'APPROVAL', position: { x: 520, y: 160 }, data: { label: 'Approve plan', approvalTitle: 'Approve generated task drafts', risk: 'LOW' } },
        { id: 'notify', type: 'HUMAN_TASK', position: { x: 800, y: 160 }, data: { label: 'Notify project owner' } },
        { id: 'end', type: 'END', position: { x: 1080, y: 160 }, data: { label: 'End' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'plan' },
        { id: 'e2', source: 'plan', target: 'approve' },
        { id: 'e3', source: 'approve', target: 'notify' },
        { id: 'e4', source: 'notify', target: 'end' },
      ],
      inputSchema: { objective: 'string' },
    }),
  },
];
