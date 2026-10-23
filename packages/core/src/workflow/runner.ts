import { TOOL_CATALOG, validateToolInput, validateWorkflowGraph, type RiskLevel, type WorkflowEdge, type WorkflowGraph, type WorkflowNode } from '@collabspace/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { createApproval } from '../engine/approvals.js';
import { submitTask } from '../engine/task-ops.js';
import { publishRealtime } from '../events.js';
import { resolveAllowedSources } from '../knowledge/retrieve.js';
import { logger } from '../logger.js';
import { enqueueWorkflowAdvance } from '../queue.js';
import { notifyUser } from '../services/notifications.js';
import { getAdapter } from '../tools/registry.js';
import { evaluateExpression } from './expression.js';

type NodeRun = Prisma.WorkflowNodeExecutionGetPayload<Record<string, never>>;
type LogEntry = { at: string; level: 'info' | 'warn' | 'error'; message: string };

const ACTIVATED = '__activatedEdges';

function outputOf(run: NodeRun | undefined): Record<string, unknown> {
  return ((run?.output as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
}

function renderTemplate(template: string, scope: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.$-]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), scope);
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

async function appendLog(run: NodeRun, level: LogEntry['level'], message: string) {
  const logs = [...((run.logs as LogEntry[]) ?? []), { at: new Date().toISOString(), level, message }].slice(-100);
  await prisma.workflowNodeExecution.update({ where: { id: run.id }, data: { logs } });
  run.logs = logs;
}

async function setNode(run: NodeRun, data: Prisma.WorkflowNodeExecutionUncheckedUpdateInput) {
  const updated = await prisma.workflowNodeExecution.update({ where: { id: run.id }, data });
  Object.assign(run, updated);
  return updated;
}

/**
 * Advance a workflow execution: run every node whose predecessors are complete.
 * Idempotent and safe to call repeatedly (every async node completion enqueues an advance).
 */
export async function advanceWorkflow(executionId: string): Promise<void> {
  const execution = await prisma.workflowExecution.findUnique({ where: { id: executionId }, include: { version: true, workflow: { select: { name: true } }, nodes: true } });
  if (!execution) return;
  if (['COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED'].includes(execution.status)) return;
  const graph = execution.version.graph as WorkflowGraph;
  const validation = validateWorkflowGraph(graph);
  if (!validation.valid) {
    await finishExecution(execution.id, execution.workspaceId, 'FAILED', null, `Workflow version is invalid: ${validation.issues.map((i) => i.message).join('; ')}`);
    return;
  }
  const runs = new Map(execution.nodes.map((n) => [n.nodeId, n]));
  if (execution.status === 'PENDING') {
    await prisma.workflowExecution.update({ where: { id: execution.id }, data: { status: 'RUNNING', startedAt: new Date() } });
    for (const node of graph.nodes) {
      if (!runs.has(node.id)) {
        const created = await prisma.workflowNodeExecution.create({ data: { executionId: execution.id, nodeId: node.id, nodeType: node.type, label: node.data.label ?? null } });
        runs.set(node.id, created);
      }
    }
    await publishRealtime({ type: 'workflow.updated', workspaceId: execution.workspaceId, executionId: execution.id, status: 'RUNNING' });
  }
  const incoming = new Map<string, WorkflowEdge[]>();
  for (const e of graph.edges) incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);

  let progressed = true;
  let guard = 0;
  while (progressed && guard++ < 500) {
    progressed = false;
    for (const node of graph.nodes) {
      const run = runs.get(node.id)!;
      if (run.status === 'WAITING') {
        const resolved = await resolveWaiting(node, run, execution.id, execution.workspaceId, execution.dryRun);
        if (resolved) progressed = true;
        continue;
      }
      if (run.status !== 'PENDING') continue;
      const edges = incoming.get(node.id) ?? [];
      const sourcesDone = edges.every((e) => ['COMPLETED', 'SKIPPED'].includes(runs.get(e.source)?.status ?? 'PENDING'));
      if (!sourcesDone && node.type !== 'START') continue;
      const activated = edges.filter((e) => ((outputOf(runs.get(e.source))[ACTIVATED] as string[] | undefined) ?? []).includes(e.id));
      if (node.type !== 'START' && activated.length === 0) {
        await setNode(run, { status: 'SKIPPED', completedAt: new Date() });
        progressed = true;
        continue;
      }
      const predecessors = Object.fromEntries(activated.map((e) => [e.source, stripInternal(outputOf(runs.get(e.source)))]));
      const scope = { input: execution.input as Record<string, unknown>, nodes: Object.fromEntries([...runs.entries()].map(([id, r]) => [id, { output: stripInternal(outputOf(r)) }])), prev: predecessors, prevList: Object.values(predecessors) };
      try {
        await runNode(node, run, graph, scope, { executionId: execution.id, workspaceId: execution.workspaceId, dryRun: execution.dryRun, startedById: execution.startedById, workflowName: execution.workflow.name, input: execution.input as Record<string, unknown>, projectId: null });
        progressed = true;
      } catch (err) {
        logger.warn({ err, nodeId: node.id }, 'workflow node failed');
        await appendLog(run, 'error', (err as Error).message);
        const retries = node.data.retries ?? 0;
        if (run.attempt < retries) {
          await setNode(run, { status: 'PENDING', attempt: run.attempt + 1, errorMessage: (err as Error).message });
          progressed = true;
          continue;
        }
        if (node.data.onError === 'CONTINUE') {
          await setNode(run, { status: 'COMPLETED', completedAt: new Date(), errorMessage: (err as Error).message, output: { error: (err as Error).message, [ACTIVATED]: outgoingIds(graph, node.id) } });
          progressed = true;
          continue;
        }
        await setNode(run, { status: 'FAILED', completedAt: new Date(), errorMessage: (err as Error).message });
        await finishExecution(execution.id, execution.workspaceId, 'FAILED', null, `Node ${node.data.label ?? node.id} failed: ${(err as Error).message}`);
        return;
      }
    }
  }

  // completion check
  const all = [...runs.values()];
  const ends = graph.nodes.filter((n) => n.type === 'END');
  const endDone = ends.some((n) => runs.get(n.id)?.status === 'COMPLETED');
  const anyActive = all.some((r) => r.status === 'RUNNING' || r.status === 'WAITING' || r.status === 'PENDING');
  if (endDone && !all.some((r) => r.status === 'RUNNING')) {
    const endRun = ends.map((n) => runs.get(n.id)).find((r) => r?.status === 'COMPLETED');
    await finishExecution(execution.id, execution.workspaceId, 'COMPLETED', stripInternal(outputOf(endRun)), null, execution.startedById);
    return;
  }
  if (!anyActive) {
    await finishExecution(execution.id, execution.workspaceId, 'FAILED', null, 'Workflow stalled: no reachable End node completed');
    return;
  }
  const waiting = all.some((r) => r.status === 'WAITING');
  await prisma.workflowExecution.update({ where: { id: execution.id }, data: { status: waiting ? 'WAITING' : 'RUNNING' } });
  await publishRealtime({ type: 'workflow.updated', workspaceId: execution.workspaceId, executionId: execution.id, status: waiting ? 'WAITING' : 'RUNNING' });
}

function stripInternal(o: Record<string, unknown>): Record<string, unknown> {
  const { [ACTIVATED]: _ignored, ...rest } = o;
  void _ignored;
  return rest;
}

function outgoingIds(graph: WorkflowGraph, nodeId: string, handle?: string): string[] {
  return graph.edges.filter((e) => e.source === nodeId && (handle === undefined || (e.sourceHandle ?? '') === handle)).map((e) => e.id);
}

interface RunCtx {
  executionId: string;
  workspaceId: string;
  dryRun: boolean;
  startedById: string | null;
  workflowName: string;
  input: Record<string, unknown>;
  projectId: string | null;
}

async function runNode(node: WorkflowNode, run: NodeRun, graph: WorkflowGraph, scope: Record<string, unknown>, ctx: RunCtx) {
  await setNode(run, { status: 'RUNNING', startedAt: new Date(), input: scope.prev as object });
  await appendLog(run, 'info', `Started ${node.type}${ctx.dryRun ? ' (dry run)' : ''}`);
  const complete = async (output: Record<string, unknown>, handle?: string) => {
    await setNode(run, { status: 'COMPLETED', completedAt: new Date(), output: { ...output, [ACTIVATED]: outgoingIds(graph, node.id, handle) } });
    await appendLog(run, 'info', 'Completed');
  };
  const prevText = Object.values(scope.prev as Record<string, Record<string, unknown>>)
    .map((o) => (typeof o.text === 'string' ? o.text : typeof o.result === 'string' ? o.result : JSON.stringify(o)))
    .join('\n\n');

  switch (node.type) {
    case 'START':
      return complete({ ...ctx.input });
    case 'PROMPT':
      return complete({ text: renderTemplate(node.data.template ?? '', scope) });
    case 'PARALLEL':
      return complete({ text: prevText });
    case 'MERGE':
      return complete({ branches: scope.prev, text: prevText });
    case 'END':
      return complete({ result: scope.prev, text: prevText });
    case 'CONDITION': {
      const value = evaluateExpression(node.data.expression ?? 'false', scope);
      await appendLog(run, 'info', `Condition "${node.data.expression}" evaluated to ${value}`);
      return complete({ result: Boolean(value) }, value ? 'true' : 'false');
    }
    case 'TOOL': {
      const toolId = node.data.toolId ?? '';
      const def = TOOL_CATALOG[toolId];
      if (!def) throw new Error(`Unknown tool ${toolId}`);
      if (def.category !== 'READ') throw new Error(`Workflow Tool nodes may only run read-only tools. Use an Agent node (with approvals) for ${toolId}.`);
      const rawInput = JSON.parse(renderTemplate(JSON.stringify(node.data.toolInput ?? {}), scope)) as unknown;
      const validated = validateToolInput(toolId, rawInput);
      if (!validated.ok) throw new Error(`Invalid tool input: ${validated.error}`);
      if (ctx.dryRun) return complete({ dryRun: true, tool: toolId, input: validated.data as object });
      const adapter = getAdapter(toolId);
      if (!adapter) throw new Error('No adapter');
      const sourceIds = await resolveAllowedSources({ workspaceId: ctx.workspaceId, projectId: ctx.projectId, agentId: '', knowledge: { allowWorkspaceKnowledge: true, allowProjectDocuments: true } });
      const output = await adapter.execute(validated.data, { workspaceId: ctx.workspaceId, projectId: ctx.projectId, agentId: 'workflow', agentName: 'Workflow', taskId: ctx.executionId, executionId: null, knowledgeSourceIds: sourceIds, allowPreviousReports: false, inputArtifactIds: [], actorUserId: ctx.startedById, idempotencyKey: `${ctx.executionId}:${node.id}:${run.attempt}` });
      return complete({ tool: toolId, output });
    }
    case 'DELAY': {
      const delayMs = node.data.delayMs ?? 0;
      if (ctx.dryRun || delayMs === 0) return complete({ delayedMs: 0, dryRun: ctx.dryRun });
      const resumeAt = new Date(Date.now() + delayMs);
      await setNode(run, { status: 'WAITING', output: { resumeAt: resumeAt.toISOString() } });
      await enqueueWorkflowAdvance(ctx.executionId, node.id, delayMs + 250);
      return;
    }
    case 'AGENT': {
      const agent = await prisma.agent.findFirst({ where: { id: node.data.agentId ?? '', workspaceId: ctx.workspaceId, archivedAt: null }, select: { id: true, name: true, currentVersionId: true, status: true, projectId: true } });
      if (!agent?.currentVersionId) throw new Error('Agent not found or has no active version');
      if (agent.status === 'PAUSED') throw new Error(`Agent ${agent.name} is paused`);
      const instructions = renderTemplate(node.data.instructions ?? '', scope);
      const description = [instructions, prevText ? `\n\n## Input from previous steps\n${prevText}` : ''].join('');
      const title = node.data.taskTitle ? renderTemplate(node.data.taskTitle, scope) : `${ctx.workflowName}: ${node.data.label ?? agent.name}`;
      if (ctx.dryRun) return complete({ dryRun: true, wouldCreateTask: { agentId: agent.id, agentName: agent.name, title, description: description.slice(0, 2000) }, text: `[dry run] ${agent.name} would execute "${title}"` });
      const task = await prisma.agentTask.create({ data: { workspaceId: ctx.workspaceId, projectId: agent.projectId, agentId: agent.id, agentVersionId: agent.currentVersionId, title, description, status: 'QUEUED', priority: 'NORMAL', createdById: ctx.startedById, workflowExecutionId: ctx.executionId, workflowNodeExecutionId: run.id, timeoutMs: node.data.timeoutMs ?? 600000, maxAttempts: 1 + (node.data.retries ?? 0) } });
      await setNode(run, { status: 'WAITING', output: { taskId: task.id } });
      await appendLog(run, 'info', `Created task ${task.id} for ${agent.name}`);
      await submitTask(task.id);
      return;
    }
    case 'APPROVAL': {
      if (ctx.dryRun) return complete({ dryRun: true, approved: true, text: prevText });
      const approval = await createApproval({
        workspaceId: ctx.workspaceId,
        workflowExecutionId: ctx.executionId,
        workflowNodeExecutionId: run.id,
        actionTitle: node.data.approvalTitle ?? `${ctx.workflowName}: ${node.data.label ?? 'Approval'}`,
        actionDescription: `Workflow "${ctx.workflowName}" requires approval to continue past "${node.data.label ?? node.id}".`,
        targetResource: `workflowExecution:${ctx.executionId}`,
        risk: (node.data.risk ?? 'MEDIUM') as RiskLevel,
        proposal: { nodeId: node.id, previousOutputs: scope.prev },
        diff: { before: null, after: prevText.slice(0, 20000) },
        requestedByType: 'SYSTEM',
      });
      await setNode(run, { status: 'WAITING', output: { approvalId: approval.id } });
      return;
    }
    case 'HUMAN_TASK': {
      if (ctx.dryRun) return complete({ dryRun: true, completedBy: null, text: prevText });
      const assignee = node.data.assigneeUserId ?? ctx.startedById;
      await setNode(run, { status: 'WAITING', assigneeId: assignee ?? null, output: { assigneeId: assignee } });
      if (assignee) await notifyUser({ workspaceId: ctx.workspaceId, userId: assignee, type: 'HUMAN_TASK', title: `Action needed: ${node.data.label ?? 'Human task'}`, body: `Workflow "${ctx.workflowName}" is waiting for you.`, link: `/workflows/executions/${ctx.executionId}` });
      return;
    }
    default:
      throw new Error(`Unsupported node type ${node.type}`);
  }
}

/** Check whether a WAITING node can now complete (task finished, approval decided, delay elapsed, human task done). */
async function resolveWaiting(node: WorkflowNode, run: NodeRun, executionId: string, workspaceId: string, dryRun: boolean): Promise<boolean> {
  void dryRun;
  const out = outputOf(run);
  const complete = async (output: Record<string, unknown>, handle?: string) => {
    const graph = (await prisma.workflowExecution.findUniqueOrThrow({ where: { id: executionId }, include: { version: true } })).version.graph as WorkflowGraph;
    await setNode(run, { status: 'COMPLETED', completedAt: new Date(), output: { ...output, [ACTIVATED]: outgoingIds(graph, node.id, handle) } });
    return true;
  };
  if (node.type === 'AGENT' && typeof out.taskId === 'string') {
    const task = await prisma.agentTask.findUnique({ where: { id: out.taskId }, select: { status: true, resultContent: true, resultSummary: true, errorMessage: true, artifacts: { where: { deletedAt: null }, select: { id: true, name: true, type: true } } } });
    if (!task) throw new Error('Linked task disappeared');
    if (task.status === 'COMPLETED') {
      await appendLog(run, 'info', `Task completed with ${task.artifacts.length} artifact(s)`);
      return complete({ taskId: out.taskId, text: task.resultContent ?? '', summary: task.resultSummary, artifacts: task.artifacts, result: task.resultContent ?? '' });
    }
    if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(task.status)) {
      await appendLog(run, 'error', `Task ${task.status.toLowerCase()}: ${task.errorMessage ?? ''}`);
      if (node.data.onError === 'CONTINUE') return complete({ taskId: out.taskId, error: task.errorMessage ?? task.status, text: '' });
      await setNode(run, { status: 'FAILED', completedAt: new Date(), errorMessage: task.errorMessage ?? `Task ${task.status}` });
      await finishExecution(executionId, workspaceId, 'FAILED', null, `Agent step "${node.data.label ?? node.id}" ${task.status.toLowerCase()}: ${task.errorMessage ?? ''}`);
      return false;
    }
    return false;
  }
  if (node.type === 'APPROVAL' && typeof out.approvalId === 'string') {
    const approval = await prisma.approvalRequest.findUnique({ where: { id: out.approvalId }, include: { decisions: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!approval || approval.status === 'PENDING') return false;
    if (approval.status === 'APPROVED') {
      await prisma.approvalRequest.update({ where: { id: approval.id }, data: { status: 'EXECUTED', executedAt: new Date() } });
      await appendLog(run, 'info', 'Approved by reviewer');
      return complete({ approved: true, approvalId: approval.id, comment: approval.decisions[0]?.comment ?? null, text: String((out.text as string) ?? '') });
    }
    await appendLog(run, 'warn', `Approval ${approval.status.toLowerCase()}`);
    if (node.data.onError === 'CONTINUE') return complete({ approved: false, approvalId: approval.id, comment: approval.decisions[0]?.comment ?? null });
    await setNode(run, { status: 'FAILED', completedAt: new Date(), errorMessage: `Approval ${approval.status.toLowerCase()}` });
    await finishExecution(executionId, workspaceId, 'FAILED', null, `Approval step "${node.data.label ?? node.id}" was ${approval.status.toLowerCase().replace('_', ' ')}`);
    return false;
  }
  if (node.type === 'DELAY' && typeof out.resumeAt === 'string') {
    if (new Date(out.resumeAt) <= new Date()) return complete({ delayedMs: node.data.delayMs ?? 0 });
    return false;
  }
  if (node.type === 'HUMAN_TASK') {
    if (out.completed === true) return complete({ completedBy: out.completedBy ?? null, text: typeof out.note === 'string' ? out.note : '', note: out.note ?? null });
    return false;
  }
  return false;
}

/** Called by the API when a human completes a HUMAN_TASK node. */
export async function completeHumanTask(executionId: string, nodeId: string, userId: string, note: string | null) {
  const run = await prisma.workflowNodeExecution.findUnique({ where: { executionId_nodeId: { executionId, nodeId } } });
  if (!run || run.status !== 'WAITING' || run.nodeType !== 'HUMAN_TASK') throw new Error('Human task is not waiting');
  await prisma.workflowNodeExecution.update({ where: { id: run.id }, data: { output: { ...outputOf(run), completed: true, completedBy: userId, note } } });
  await enqueueWorkflowAdvance(executionId, nodeId);
}

async function finishExecution(executionId: string, workspaceId: string, status: 'COMPLETED' | 'FAILED' | 'CANCELLED', output: Record<string, unknown> | null, errorMessage: string | null, startedById?: string | null) {
  await prisma.workflowExecution.update({ where: { id: executionId }, data: { status, output: output as object | undefined, errorMessage, completedAt: new Date() } });
  await publishRealtime({ type: 'workflow.updated', workspaceId, executionId, status });
  if (startedById) await notifyUser({ workspaceId, userId: startedById, type: 'WORKFLOW_COMPLETED', title: 'Workflow completed', body: 'A workflow execution you started has finished.', link: `/workflows/executions/${executionId}` });
}

export async function cancelWorkflowExecution(executionId: string, workspaceId: string) {
  const execution = await prisma.workflowExecution.findFirst({ where: { id: executionId, workspaceId }, include: { nodes: true } });
  if (!execution) throw new Error('Execution not found');
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(execution.status)) return execution;
  for (const run of execution.nodes) {
    if (run.status === 'WAITING' || run.status === 'RUNNING' || run.status === 'PENDING') {
      await prisma.workflowNodeExecution.update({ where: { id: run.id }, data: { status: 'SKIPPED', completedAt: new Date() } });
    }
  }
  await prisma.approvalRequest.updateMany({ where: { workflowExecutionId: executionId, status: 'PENDING' }, data: { status: 'SUPERSEDED' } });
  await finishExecution(executionId, workspaceId, 'CANCELLED', null, 'Cancelled by user');
  return prisma.workflowExecution.findUniqueOrThrow({ where: { id: executionId } });
}

/** Pause/resume support: paused executions ignore advance jobs until resumed. */
export async function pauseWorkflowExecution(executionId: string, workspaceId: string, resume: boolean) {
  const execution = await prisma.workflowExecution.findFirst({ where: { id: executionId, workspaceId } });
  if (!execution) throw new Error('Execution not found');
  if (resume) {
    if (execution.status !== 'PAUSED') return execution;
    const updated = await prisma.workflowExecution.update({ where: { id: executionId }, data: { status: 'RUNNING' } });
    await enqueueWorkflowAdvance(executionId);
    return updated;
  }
  if (!['RUNNING', 'WAITING'].includes(execution.status)) return execution;
  return prisma.workflowExecution.update({ where: { id: executionId }, data: { status: 'PAUSED' } });
}
