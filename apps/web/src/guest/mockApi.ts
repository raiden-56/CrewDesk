/* Guest mode mock API: answers every /api/v1 request in the browser from the in-memory sample data. */
import {
  AGENT_TEMPLATES,
  ApprovalDecisionSchema,
  BudgetPolicySchema,
  CreateAgentSchema,
  CreateKnowledgeSchema,
  CreateProjectSchema,
  CreateTaskSchema,
  CreateWorkflowSchema,
  IntegrationSchema,
  InviteMemberSchema,
  MODEL_PRICES,
  TOOL_CATALOG,
  TOOL_GROUPS,
  UpdateAgentSchema,
  UpdateWorkflowSchema,
  canApproveRisk,
  estimateCostUsd,
  renderInstructions,
  toolSummary,
  validateWorkflowGraph,
  type AgentDto,
  type ApprovalDto,
  type ArtifactType,
  type AuditLogDto,
  type DashboardMetricsDto,
  type ExecutionEventDto,
  type KnowledgeSourceDto,
  type MessageDto,
  type NotificationDto,
  type RealtimeEvent,
  type TaskDto,
  type UsageSummaryDto,
  type WorkflowDto,
  type WorkflowExecutionDto,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowValidationIssue,
  type WorkspaceRole,
} from '@collabspace/shared';
import type { ZodType } from 'zod';
import { emitGuestEvent } from './events';
import { onGuestSessionEnd, GUEST_WORKSPACE_ID } from './session';
import { KNOWLEDGE_SNIPPETS, WORKFLOW_TEMPLATES, clone, createGuestDb, mimeFor, prng, type GuestArtifact, type GuestDb } from './seed';

export interface GuestResponse {
  status: number;
  data: unknown;
  /** set for file downloads (api.download) */
  raw?: { body: string; contentType: string; filename: string };
}

class GuestApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- request bodies are untyped JSON
type Body = Record<string, any>;
interface Ctx {
  db: GuestDb;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Body;
  form?: FormData;
}
type Handler = (ctx: Ctx) => unknown;

// ------------------------------------------------------------------ state
let db: GuestDb | null = null;
const timers = new Set<ReturnType<typeof setTimeout>>();

onGuestSessionEnd(() => {
  db = null;
  for (const t of timers) clearTimeout(t);
  timers.clear();
});

function getDb(): GuestDb {
  if (!db) db = createGuestDb();
  return db;
}

/** Schedule simulated background work; dropped if the guest session ends. */
function after(ms: number, fn: () => void) {
  const owner = db;
  const t = setTimeout(() => {
    timers.delete(t);
    if (db && db === owner) fn();
  }, ms);
  timers.add(t);
}

const nowIso = () => new Date().toISOString();
const nextId = (d: GuestDb, prefix: string) => `${prefix}_${(d.seq++).toString(36)}`;
const emit = (event: RealtimeEvent) => emitGuestEvent(event);
const ME = (d: GuestDb) => ({ id: d.user.id, name: d.user.name });

function notFound(what: string): never {
  throw new GuestApiError(404, 'NOT_FOUND', `${what} not found`);
}
function conflict(message: string): never {
  throw new GuestApiError(409, 'CONFLICT', message);
}
function parse<T>(schema: ZodType<T>, body: unknown): T {
  const res = schema.safeParse(body);
  if (!res.success) throw new GuestApiError(400, 'VALIDATION_ERROR', 'Validation failed', res.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return res.data;
}
function find<T extends { id: string }>(list: T[], id: string | undefined, what: string): T {
  return list.find((x) => x.id === id) ?? notFound(what);
}

function paginate<T>(items: T[], q: URLSearchParams, defaultSize = 20) {
  const page = Math.max(1, Number(q.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(q.get('pageSize')) || defaultSize));
  return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length };
}

const contains = (haystack: string | null | undefined, needle: string) => (haystack ?? '').toLowerCase().includes(needle.toLowerCase());

function audit(d: GuestDb, action: string, resourceType: string, resourceId: string | null, metadata: Record<string, unknown> | null = null, actor: 'USER' | 'AGENT' | 'SYSTEM' = 'USER', agent?: { id: string; name: string }) {
  const row: AuditLogDto = { id: nextId(d, 'al'), action, resourceType, resourceId, actor: actor === 'USER' ? ME(d) : actor === 'AGENT' && agent ? agent : null, actorType: actor, metadata, ip: actor === 'USER' ? '203.0.113.24' : null, createdAt: nowIso() };
  d.audit.unshift(row);
}

function notify(d: GuestDb, n: Omit<NotificationDto, 'id' | 'readAt' | 'createdAt'>) {
  const notification: NotificationDto = { ...n, id: nextId(d, 'n'), readAt: null, createdAt: nowIso() };
  d.notifications.unshift(notification);
  emit({ type: 'notification', workspaceId: GUEST_WORKSPACE_ID, userId: d.user.id, notification });
}

// ------------------------------------------------------------- projections
const ACTIVE_TASK = ['RUNNING', 'WAITING_APPROVAL', 'QUEUED', 'PAUSED'];

function agentView(d: GuestDb, a: AgentDto): AgentDto {
  const tasks = d.tasks.filter((t) => t.agentId === a.id);
  const current = tasks.find((t) => t.status === 'RUNNING') ?? tasks.find((t) => t.status === 'WAITING_APPROVAL') ?? tasks.find((t) => t.status === 'PAUSED') ?? null;
  const last = tasks.map((t) => t.updatedAt).sort().pop() ?? null;
  return {
    ...a,
    currentTask: current ? { id: current.id, title: current.title, status: current.status, progress: current.progress, progressMessage: current.progressMessage } : null,
    lastActivityAt: last,
    stats: {
      totalTasks: tasks.length,
      completedTasks: tasks.filter((t) => t.status === 'COMPLETED').length,
      failedTasks: tasks.filter((t) => t.status === 'FAILED' || t.status === 'TIMED_OUT').length,
      runningTasks: tasks.filter((t) => ACTIVE_TASK.includes(t.status)).length,
    },
  };
}

function taskView(d: GuestDb, t: TaskDto): TaskDto {
  const a = d.agents.find((x) => x.id === t.agentId);
  return { ...t, agent: a ? { id: a.id, name: a.name, avatar: a.avatar, color: a.color, category: a.category } : t.agent, artifactCount: d.artifacts.filter((x) => x.taskId === t.id).length };
}

function approvalView(d: GuestDb, a: ApprovalDto) {
  const task = a.taskId ? d.tasks.find((t) => t.id === a.taskId) : null;
  return { ...a, task: task ? { id: task.id, title: task.title, status: task.status } : a.task, canDecide: canApproveRisk(d.workspace.role, a.risk) };
}

function workflowView(d: GuestDb, w: WorkflowDto): WorkflowDto {
  const last = d.executions.filter((e) => e.workflowId === w.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return { ...w, lastExecution: last ? { id: last.id, status: last.status, createdAt: last.createdAt } : null };
}

const artifactDto = ({ content: _content, ...rest }: GuestArtifact) => rest;

// ------------------------------------------------------------ task engine
function pushEvent(d: GuestDb, task: TaskDto, type: ExecutionEventDto['type'], level: ExecutionEventDto['level'], message: string, metadata: Record<string, unknown> | null = null, durationMs: number | null = null) {
  const list = (d.events[task.id] ??= []);
  const event: ExecutionEventDto = { id: nextId(d, 'ev'), taskId: task.id, executionId: `ex_${task.id}`, type, level, message, metadata, diagnostics: null, durationMs, sequence: list.length + 1, createdAt: nowIso() };
  list.push(event);
  emit({ type: 'task.event', workspaceId: GUEST_WORKSPACE_ID, event });
}

function touchTask(d: GuestDb, task: TaskDto, patch: Partial<TaskDto>) {
  Object.assign(task, patch, { updatedAt: nowIso() });
  emit({ type: 'task.updated', workspaceId: GUEST_WORKSPACE_ID, task: { id: task.id, status: task.status, progress: task.progress, progressMessage: task.progressMessage, agentId: task.agentId, updatedAt: task.updatedAt } });
}

function setAgentStatus(d: GuestDb, agentId: string) {
  const a = d.agents.find((x) => x.id === agentId);
  if (!a || a.status === 'PAUSED' || a.status === 'ARCHIVED' || a.status === 'OFFLINE') return;
  const busy = d.tasks.some((t) => t.agentId === agentId && t.status === 'RUNNING');
  const next = busy ? 'WORKING' : 'ONLINE';
  if (a.status !== next) {
    a.status = next;
    emit({ type: 'agent.updated', workspaceId: GUEST_WORKSPACE_ID, agentId, status: next });
  }
}

const TOOLS_FOR: Record<string, string[]> = {
  RESEARCHER: ['web.search', 'docs.search'],
  PROJECT_PLANNER: ['docs.search', 'task.create_draft'],
  QA_REVIEWER: ['docs.search', 'file.read'],
  DOCUMENTATION: ['docs.search', 'document.create_draft'],
  DATA_ANALYST: ['file.read', 'csv.analyze'],
  CUSTOMER_SUPPORT: ['docs.search', 'document.create_draft'],
  CODE_ASSISTANT: ['repo.metadata', 'file.read'],
  SECURITY_REVIEWER: ['repo.metadata', 'docs.search'],
};

function sampleResult(task: TaskDto): string {
  return `## ${task.title}\n\n${task.agent.name} worked through this request using approved workspace sources.\n\n### Findings\n- The request was scoped against the project brief${task.project ? ` for **${task.project.name}**` : ''}.\n- Relevant context was found in 3 knowledge sources.\n- No write actions were needed, so no approvals were requested.\n\n### Recommended next steps\n1. Review the findings with the team.\n2. Assign follow-ups as tasks.\n\n> Sample output generated in guest mode — no AI model was called.`;
}

/** Walk a task through a believable execution; each step emits the same realtime events as the worker. */
function runTask(d: GuestDb, taskId: string, from: 'start' | 'resume' = 'start') {
  const task = d.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const agent = d.agents.find((a) => a.id === task.agentId);
  if (agent && (agent.status === 'PAUSED' || agent.status === 'OFFLINE')) {
    touchTask(d, task, { status: 'QUEUED', progressMessage: `${agent.name} is ${agent.status.toLowerCase()}; the task starts when the agent is resumed` });
    return;
  }
  const tools = TOOLS_FOR[task.agent.category] ?? ['docs.search'];
  const steps: Array<{ progress: number; message: string; run: () => void }> =
    from === 'start'
      ? [
          { progress: 15, message: 'Retrieving context', run: () => pushEvent(d, task, 'CONTEXT_RETRIEVED', 'INFO', 'Retrieved 5 knowledge chunks from 2 approved sources', { chunks: 5, sources: 2 }, 380) },
          { progress: 30, message: 'Thinking', run: () => pushEvent(d, task, 'MODEL_REQUEST_STARTED', 'INFO', `Model request started (${agent?.modelConfig.model ?? 'default model'})`, { model: agent?.modelConfig.model }) },
          ...tools.map((tool, i) => ({
            progress: 45 + i * 15,
            message: `Running ${tool}`,
            run: () => {
              pushEvent(d, task, 'TOOL_REQUESTED', 'INFO', `Requested tool ${tool}`, { toolId: tool });
              pushEvent(d, task, 'TOOL_EXECUTED', 'SUCCESS', `Tool ${tool} returned results`, { toolId: tool }, 420 + i * 180);
            },
          })),
          { progress: 85, message: 'Writing the deliverable', run: () => pushEvent(d, task, 'MODEL_RESPONSE_RECEIVED', 'INFO', 'Model response received', { inputTokens: 18_400, outputTokens: 2_900 }, 3900) },
        ]
      : [{ progress: 90, message: 'Finishing up', run: () => pushEvent(d, task, 'TASK_RESUMED', 'INFO', 'Task resumed') }];

  const step = (i: number) => {
    if (task.status !== 'RUNNING') return;
    const s = steps[i];
    if (!s) return finishTask(d, task);
    s.run();
    touchTask(d, task, { progress: s.progress, progressMessage: s.message });
    after(1400, () => step(i + 1));
  };

  after(from === 'start' ? 1200 : 600, () => {
    if (task.status !== 'QUEUED' && task.status !== 'WAITING_APPROVAL') return;
    touchTask(d, task, { status: 'RUNNING', startedAt: task.startedAt ?? nowIso(), attempt: from === 'start' ? task.attempt + 1 : task.attempt, progress: from === 'start' ? 5 : task.progress, progressMessage: 'Starting' });
    setAgentStatus(d, task.agentId);
    step(0);
  });
}

function finishTask(d: GuestDb, task: TaskDto) {
  const model = d.agents.find((a) => a.id === task.agentId)?.modelConfig.model ?? 'claude-sonnet-5-5';
  // Resumed tasks (after an approval) already carry usage from their first leg: add to it.
  const tin = (task.usage.inputTokens ?? 0) + 4_000 + Math.round(Math.random() * 16_000);
  const tout = (task.usage.outputTokens ?? 0) + 800 + Math.round(Math.random() * 2_400);
  const toolCalls = task.usage.toolInvocations + (TOOLS_FOR[task.agent.category] ?? ['x']).length;
  const content = sampleResult(task);
  const artifact: GuestArtifact = {
    id: nextId(d, 'ar'),
    workspaceId: GUEST_WORKSPACE_ID,
    projectId: task.projectId,
    taskId: task.id,
    agentId: task.agentId,
    agent: { id: task.agent.id, name: task.agent.name, avatar: task.agent.avatar, color: task.agent.color },
    name: `${task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report'}.md`,
    type: 'MARKDOWN',
    mimeType: 'text/markdown',
    size: new TextEncoder().encode(content).length,
    version: 1,
    sources: [{ title: 'Product requirements: v2.0', sourceId: 'k_prd', url: null }],
    visibility: 'WORKSPACE',
    createdBy: null,
    createdAt: nowIso(),
    content,
  };
  d.artifacts.unshift(artifact);
  pushEvent(d, task, 'ARTIFACT_GENERATED', 'SUCCESS', `Generated ${artifact.name}`, { artifactId: artifact.id });
  emit({ type: 'artifact.created', workspaceId: GUEST_WORKSPACE_ID, artifact: artifactDto(artifact) });
  const completedAt = nowIso();
  const durationMs = task.startedAt ? new Date(completedAt).getTime() - new Date(task.startedAt).getTime() : null;
  pushEvent(d, task, 'TASK_COMPLETED', 'SUCCESS', 'Task completed with 1 artifact(s)', { artifacts: 1 }, durationMs);
  touchTask(d, task, {
    status: 'COMPLETED',
    progress: 100,
    progressMessage: 'Done',
    completedAt,
    durationMs,
    resultContent: content,
    resultSummary: `${task.agent.name} completed "${task.title}".`,
    pendingApprovalId: null,
    usage: { inputTokens: tin, outputTokens: tout, estimatedCostUsd: estimateCostUsd(model, tin, tout), requests: task.usage.requests + 3, toolInvocations: toolCalls, hasUnavailable: false },
  });
  setAgentStatus(d, task.agentId);
  audit(d, 'task.completed', 'task', task.id, { title: task.title }, 'AGENT', { id: task.agent.id, name: task.agent.name });
  notify(d, { type: 'TASK_COMPLETED', title: 'Task completed', body: `${task.agent.name} completed "${task.title}"`, link: `/tasks/${task.id}` });
  if (task.conversationId) {
    const conv = d.conversations.find((c) => c.id === task.conversationId);
    if (conv) addMessage(d, conv.id, { role: 'AGENT', kind: 'TEXT', content: `Finished **${task.title}**. The report is attached to the task and in Files.`, taskId: task.id });
  }
  if (task.workflowExecutionId) onWorkflowTaskDone(d, task);
}

function createTask(d: GuestDb, input: ReturnType<typeof CreateTaskSchema.parse>, extra: Partial<TaskDto> = {}): TaskDto {
  const agent = find(d.agents, input.agentId, 'Agent');
  if (agent.archivedAt) conflict(`${agent.name} is archived and cannot receive tasks`);
  const project = input.projectId ? d.projects.find((p) => p.id === input.projectId) : null;
  const created = nowIso();
  const task: TaskDto = {
    id: nextId(d, 't'),
    workspaceId: GUEST_WORKSPACE_ID,
    projectId: project?.id ?? agent.projectId,
    project: project ? { id: project.id, name: project.name } : agent.project,
    agentId: agent.id,
    agent: { id: agent.id, name: agent.name, avatar: agent.avatar, color: agent.color, category: agent.category },
    agentVersionId: agent.currentVersionId,
    title: input.title,
    description: input.description,
    status: input.asDraft ? 'DRAFT' : 'QUEUED',
    priority: input.priority,
    progress: 0,
    progressMessage: input.asDraft ? null : 'Waiting for a free worker',
    deadline: input.deadline,
    scheduledFor: input.scheduledFor,
    expectedDeliverable: input.expectedDeliverable,
    allowedTools: input.allowedTools,
    budgetUsd: input.budgetUsd,
    requireApprovalForWrites: input.requireApprovalForWrites,
    attempt: 0,
    maxAttempts: 3,
    failureClass: null,
    errorMessage: null,
    resultSummary: null,
    resultContent: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    usage: { inputTokens: null, outputTokens: null, estimatedCostUsd: null, requests: 0, toolInvocations: 0, hasUnavailable: false },
    createdBy: ME(d),
    conversationId: input.conversationId ?? null,
    workflowExecutionId: null,
    pendingApprovalId: null,
    artifactCount: 0,
    createdAt: created,
    updatedAt: created,
    ...extra,
  };
  d.tasks.unshift(task);
  d.events[task.id] = [];
  pushEvent(d, task, 'TASK_ACCEPTED', 'INFO', `Task accepted by ${agent.name}`);
  audit(d, 'task.created', 'task', task.id, { title: task.title, agent: agent.name });
  if (task.status === 'QUEUED') {
    pushEvent(d, task, 'TASK_QUEUED', 'INFO', 'Queued for execution', { priority: task.priority });
    runTask(d, task.id);
  }
  if (task.conversationId) addMessage(d, task.conversationId, { role: 'AGENT', kind: 'EXECUTION', content: `Working on **${task.title}**.`, taskId: task.id });
  return task;
}

// ------------------------------------------------------------ chat engine
function addMessage(d: GuestDb, conversationId: string, m: Partial<MessageDto> & Pick<MessageDto, 'role' | 'content'>): MessageDto {
  const message: MessageDto = { id: nextId(d, 'm'), conversationId, kind: 'TEXT', metadata: null, taskId: null, status: 'COMPLETE', usage: null, createdAt: nowIso(), ...m };
  d.messages.push(message);
  const conv = d.conversations.find((c) => c.id === conversationId);
  if (conv) conv.updatedAt = message.createdAt;
  emit({ type: 'message.created', workspaceId: GUEST_WORKSPACE_ID, conversationId, message });
  return message;
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'what', 'how', 'do', 'does', 'we', 'our', 'you', 'can', 'me', 'about', 'with', 'please', 'which']);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9€$]+/).filter((w) => w.length > 2 && !STOP.has(w));

function searchSnippets(d: GuestDb, query: string, sourceIds: string[] | null, limit = 8) {
  const terms = words(query);
  const hits: Array<{ sourceId: string; title: string; url: string | null; index: number; content: string; score: number }> = [];
  for (const k of d.knowledge) {
    if (k.status !== 'READY' || (sourceIds && !sourceIds.includes(k.id))) continue;
    (KNOWLEDGE_SNIPPETS[k.id] ?? []).forEach((content, index) => {
      const text = `${k.title} ${content}`.toLowerCase();
      const score = terms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0);
      if (score > 0) hits.push({ sourceId: k.id, title: k.title, url: k.url, index, content, score: Math.round((score / Math.max(terms.length, 1)) * 100) / 100 });
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function composeReply(d: GuestDb, agent: AgentDto, prompt: string): { text: string; sources: Array<{ title: string; url: string | null }> } {
  const hits = searchSnippets(d, prompt, agent.knowledge.sourceIds.length ? agent.knowledge.sourceIds : null, 2);
  const note = '\n\n_Sample reply — guest mode does not call an AI model._';
  if (/^(hi|hello|hey)\b/i.test(prompt.trim())) {
    return { text: `Hi! I'm **${agent.name}**, your ${AGENT_TEMPLATES[agent.category].name.toLowerCase()}. ${agent.description}\n\nAsk me a question, or switch on **Task mode** to give me real work with tools and approvals.${note}`, sources: [] };
  }
  if (hits.length) {
    const lines = hits.map((h) => `- ${h.content} _(${h.title})_`).join('\n');
    return { text: `Here is what I found in the approved sources:\n\n${lines}\n\nWant me to turn this into a task with a full write-up?${note}`, sources: hits.map((h) => ({ title: h.title, url: h.url })) };
  }
  return { text: `I could not find anything about that in my approved sources (${agent.knowledge.sourceIds.length} linked). I can research it properly as a task — switch on **Task mode** and send the request again.${note}`, sources: [] };
}

function streamReply(d: GuestDb, conversationId: string, reply: MessageDto, prompt: string) {
  const conv = d.conversations.find((c) => c.id === conversationId);
  const agent = conv ? d.agents.find((a) => a.id === conv.agentId) : undefined;
  if (!agent) return;
  const { text, sources } = composeReply(d, agent, prompt);
  const tokens = text.split(/(\s+)/);
  let i = 0;
  const tick = () => {
    const live = d.messages.find((m) => m.id === reply.id);
    if (!live) return;
    i = Math.min(tokens.length, i + 6);
    live.status = 'STREAMING';
    emit({ type: 'message.delta', workspaceId: GUEST_WORKSPACE_ID, conversationId, messageId: reply.id, delta: tokens.slice(0, i).join('') });
    if (i < tokens.length) return after(70, tick);
    Object.assign(live, { status: 'COMPLETE', content: text, metadata: { sources }, usage: { inputTokens: 2100 + prompt.length, outputTokens: Math.round(text.length / 3.8) } });
    emit({ type: 'message.created', workspaceId: GUEST_WORKSPACE_ID, conversationId, message: live });
  };
  after(700, tick);
}

// --------------------------------------------------------- workflow engine
function graphFor(d: GuestDb, ex: WorkflowExecutionDto): WorkflowGraph {
  const versions = d.workflowVersions[ex.workflowId] ?? [];
  return versions.find((v) => v.id === ex.workflowVersionId)?.graph ?? d.workflows.find((w) => w.id === ex.workflowId)?.graph ?? { nodes: [], edges: [] };
}

function render(template: string | undefined, input: Record<string, unknown>) {
  return (template ?? '').replace(/\{\{\s*input\.(\w+)\s*\}\}/g, (_, k: string) => String(input[k] ?? ''));
}

function logNode(n: WorkflowExecutionDto['nodes'][number], level: string, message: string) {
  n.logs.push({ at: nowIso(), level, message });
}

function publishExecution(ex: WorkflowExecutionDto) {
  emit({ type: 'workflow.updated', workspaceId: GUEST_WORKSPACE_ID, executionId: ex.id, status: ex.status });
}

function completeNode(n: WorkflowExecutionDto['nodes'][number], output: Record<string, unknown>) {
  n.status = 'COMPLETED';
  n.output = output;
  n.completedAt = nowIso();
  logNode(n, 'info', 'Completed');
}

/** Advance an execution through its graph in topological order (condition branches skip the other side). */
function advance(d: GuestDb, ex: WorkflowExecutionDto, dryRun = false) {
  if (ex.status !== 'RUNNING' && ex.status !== 'PENDING' && ex.status !== 'WAITING') return;
  const graph = graphFor(d, ex);
  const { order } = validateWorkflowGraph(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const state = new Map(ex.nodes.map((n) => [n.nodeId, n]));
  ex.status = 'RUNNING';
  for (const nodeId of order) {
    const node = byId.get(nodeId);
    const n = state.get(nodeId);
    if (!node || !n) continue;
    if (n.status === 'COMPLETED' || n.status === 'SKIPPED') continue;
    if (n.status === 'FAILED') return failExecution(d, ex, n.errorMessage ?? 'A step failed');
    if (n.status === 'RUNNING' || n.status === 'WAITING') {
      ex.status = n.status === 'WAITING' ? 'WAITING' : 'RUNNING';
      return publishExecution(ex);
    }
    const incoming = graph.edges.filter((e) => e.target === nodeId);
    const active =
      node.type === 'START' ||
      incoming.some((e) => {
        const src = state.get(e.source);
        if (src?.status !== 'COMPLETED') return false;
        return byId.get(e.source)?.type !== 'CONDITION' || (src.output?.branch ?? 'true') === (e.sourceHandle ?? 'true');
      });
    if (!active) {
      n.status = 'SKIPPED';
      continue;
    }
    n.status = 'RUNNING';
    n.startedAt = nowIso();
    n.input = { ...ex.input };
    logNode(n, 'info', `${node.data.label ?? node.type} started`);
    if (dryRun) {
      completeNode(n, dryOutput(node, ex.input));
      continue;
    }
    startNode(d, ex, node, n);
    return publishExecution(ex);
  }
  ex.status = 'COMPLETED';
  ex.completedAt = nowIso();
  const lastTask = [...ex.nodes].reverse().find((n) => n.taskId);
  const result = lastTask ? d.tasks.find((t) => t.id === lastTask.taskId)?.resultContent : null;
  ex.output = { text: result ?? (dryRun ? 'Dry run finished: every reachable step was simulated without calling agents or tools.' : 'Workflow finished.') };
  if (!dryRun) {
    notify(d, { type: 'WORKFLOW_COMPLETED', title: `Workflow finished: ${d.workflows.find((w) => w.id === ex.workflowId)?.name ?? 'workflow'}`, body: 'All steps completed.', link: `/workflows/executions/${ex.id}` });
    audit(d, 'workflow.execution.completed', 'workflowExecution', ex.id, null, 'SYSTEM');
  }
  publishExecution(ex);
}

function dryOutput(node: WorkflowNode, input: Record<string, unknown>): Record<string, unknown> {
  switch (node.type) {
    case 'AGENT':
      return { dryRun: true, wouldCreateTask: render(node.data.taskTitle, input) || node.data.label };
    case 'CONDITION':
      return { dryRun: true, branch: 'false', expression: node.data.expression };
    case 'APPROVAL':
      return { dryRun: true, wouldRequestApproval: node.data.approvalTitle ?? node.data.label };
    case 'TOOL':
      return { dryRun: true, wouldCall: node.data.toolId };
    default:
      return { dryRun: true };
  }
}

function failExecution(d: GuestDb, ex: WorkflowExecutionDto, message: string) {
  ex.status = 'FAILED';
  ex.errorMessage = message;
  ex.completedAt = nowIso();
  for (const n of ex.nodes) if (n.status === 'PENDING') n.status = 'SKIPPED';
  notify(d, { type: 'SYSTEM', title: 'Workflow failed', body: message, link: `/workflows/executions/${ex.id}` });
  publishExecution(ex);
}

function startNode(d: GuestDb, ex: WorkflowExecutionDto, node: WorkflowNode, n: WorkflowExecutionDto['nodes'][number]) {
  switch (node.type) {
    case 'AGENT': {
      const agent = d.agents.find((a) => a.id === node.data.agentId);
      if (!agent || agent.archivedAt) {
        n.status = 'FAILED';
        n.errorMessage = 'Agent not found or archived';
        return after(400, () => advance(d, ex));
      }
      const task = createTask(d, parse(CreateTaskSchema, { title: render(node.data.taskTitle, ex.input) || `${node.data.label ?? 'Workflow step'}`, description: render(node.data.instructions, ex.input), agentId: agent.id }), { workflowExecutionId: ex.id });
      n.taskId = task.id;
      logNode(n, 'info', `Created task "${task.title}" for ${agent.name}`);
      return;
    }
    case 'APPROVAL': {
      const approval: ApprovalDto = {
        id: nextId(d, 'ap'),
        workspaceId: GUEST_WORKSPACE_ID,
        taskId: null,
        task: null,
        workflowExecutionId: ex.id,
        agentId: null,
        agent: null,
        toolId: null,
        actionTitle: node.data.approvalTitle ?? node.data.label ?? 'Approve workflow step',
        actionDescription: `The workflow "${d.workflows.find((w) => w.id === ex.workflowId)?.name ?? ''}" is waiting for approval before continuing.`,
        targetResource: `workflow:${ex.workflowId}`,
        risk: node.data.risk ?? 'MEDIUM',
        proposal: { executionId: ex.id, step: node.data.label ?? node.id, input: ex.input },
        proposalVersion: 1,
        proposalHash: `${ex.id}${node.id}`.padEnd(64, '0'),
        evidence: null,
        diff: null,
        status: 'PENDING',
        expiresAt: null,
        decisions: [],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      d.approvals.unshift(approval);
      n.status = 'WAITING';
      n.approvalId = approval.id;
      logNode(n, 'warn', 'Waiting for human approval');
      notify(d, { type: 'APPROVAL_REQUESTED', title: `Approval needed: ${approval.actionTitle}`, body: 'A workflow is waiting for your decision.', link: `/approvals/${approval.id}` });
      emit({ type: 'approval.updated', workspaceId: GUEST_WORKSPACE_ID, approvalId: approval.id, status: 'PENDING', taskId: null });
      ex.status = 'WAITING';
      return;
    }
    case 'HUMAN_TASK':
      n.status = 'WAITING';
      logNode(n, 'warn', 'Waiting for a person to complete this step');
      ex.status = 'WAITING';
      notify(d, { type: 'HUMAN_TASK', title: 'Workflow step assigned to you', body: node.data.label ?? 'Human task', link: `/workflows/executions/${ex.id}` });
      return;
    case 'DELAY':
      logNode(n, 'info', 'Delay shortened to 2 seconds in guest mode');
      return after(2000, () => {
        completeNode(n, { waitedMs: node.data.delayMs ?? 0 });
        advance(d, ex);
      });
    case 'CONDITION':
      return after(700, () => {
        const branch = Object.values(ex.input).some((v) => /\blow\b/i.test(String(v))) ? 'false' : 'true';
        completeNode(n, { branch, expression: node.data.expression });
        advance(d, ex);
      });
    case 'TOOL':
      return after(900, () => {
        completeNode(n, { toolId: node.data.toolId, results: searchSnippets(d, JSON.stringify(ex.input), null, 3).length });
        advance(d, ex);
      });
    case 'PROMPT':
      return after(700, () => {
        completeNode(n, { text: render(node.data.template, ex.input) });
        advance(d, ex);
      });
    default:
      return after(500, () => {
        completeNode(n, {});
        advance(d, ex);
      });
  }
}

function onWorkflowTaskDone(d: GuestDb, task: TaskDto) {
  const ex = d.executions.find((e) => e.id === task.workflowExecutionId);
  const n = ex?.nodes.find((x) => x.taskId === task.id);
  if (!ex || !n || n.status !== 'RUNNING') return;
  if (task.status === 'COMPLETED') completeNode(n, { text: task.resultSummary ?? 'Done', taskId: task.id });
  else {
    n.status = 'FAILED';
    n.errorMessage = task.errorMessage ?? `Task ${task.status.toLowerCase()}`;
    n.completedAt = nowIso();
  }
  after(500, () => advance(d, ex));
}

function newExecution(d: GuestDb, wf: WorkflowDto, input: Record<string, unknown>, dryRun: boolean): WorkflowExecutionDto {
  const validation = validateGraph(d, wf.graph);
  if (!validation.valid) throw new GuestApiError(400, 'BAD_REQUEST', 'Workflow is invalid', validation.issues);
  const created = nowIso();
  const ex: WorkflowExecutionDto = {
    id: nextId(d, 'wx'),
    workflowId: wf.id,
    workflowVersionId: wf.currentVersionId,
    version: wf.currentVersion,
    status: 'PENDING',
    dryRun,
    input,
    output: null,
    errorMessage: null,
    startedAt: created,
    completedAt: null,
    createdAt: created,
    nodes: wf.graph.nodes.map((n, i) => ({ id: nextId(d, `nx${i}`), nodeId: n.id, nodeType: n.type, label: n.data.label ?? null, status: 'PENDING', attempt: 1, input: null, output: null, errorMessage: null, taskId: null, approvalId: null, logs: [], startedAt: null, completedAt: null })),
  };
  d.executions.unshift(ex);
  audit(d, dryRun ? 'workflow.dry_run' : 'workflow.executed', 'workflow', wf.id, { executionId: ex.id, version: wf.currentVersion });
  advance(d, ex, dryRun);
  return ex;
}

function validateGraph(d: GuestDb, graph: WorkflowGraph): { valid: boolean; issues: WorkflowValidationIssue[]; order: string[] } {
  const result = validateWorkflowGraph(graph);
  const issues = [...result.issues];
  for (const n of graph.nodes) {
    if (n.type === 'AGENT' && n.data.agentId) {
      const a = d.agents.find((x) => x.id === n.data.agentId && !x.archivedAt);
      if (!a) issues.push({ level: 'error', nodeId: n.id, message: `Agent ${n.data.agentId} not found in this workspace` });
      else if (a.status === 'PAUSED') issues.push({ level: 'warning', nodeId: n.id, message: `Agent ${a.name} is paused; the step will fail until it is resumed` });
    }
    if (n.type === 'TOOL' && n.data.toolId) {
      const def = TOOL_CATALOG[n.data.toolId];
      if (def && def.category !== 'READ') issues.push({ level: 'error', nodeId: n.id, message: `Tool nodes may only use read-only tools; ${def.name} requires an Agent node so permissions and approvals apply` });
    }
  }
  return { valid: !issues.some((i) => i.level === 'error'), issues, order: result.order };
}

// ------------------------------------------------------------ usage maths
type Period = '24h' | '7d' | '30d';
const PERIOD_DAYS: Record<Period, number> = { '24h': 1, '7d': 7, '30d': 30 };
const periodOf = (q: URLSearchParams): Period => (['24h', '7d', '30d'].includes(q.get('period') ?? '') ? (q.get('period') as Period) : '7d');
const windowOf = (p: Period) => ({ label: p === '24h' ? 'Last 24 hours' : p === '7d' ? 'Last 7 days' : 'Last 30 days', from: new Date(Date.now() - PERIOD_DAYS[p] * 86_400_000).toISOString(), to: nowIso() });

function dashboard(d: GuestDb, p: Period): DashboardMetricsDto {
  const from = Date.now() - PERIOD_DAYS[p] * 86_400_000;
  const inWindow = d.tasks.filter((t) => new Date(t.createdAt).getTime() >= from);
  const count = (s: string) => inWindow.filter((t) => t.status === s).length;
  const completed = count('COMPLETED');
  const failed = count('FAILED') + count('TIMED_OUT');
  const buckets = p === '24h' ? 12 : PERIOD_DAYS[p];
  const rand = prng(p.length * 97 + 11);
  const labels: string[] = [];
  const created: number[] = [];
  const done: number[] = [];
  const fail: number[] = [];
  for (let i = buckets - 1; i >= 0; i--) {
    const at = new Date(Date.now() - i * (p === '24h' ? 2 * 3_600_000 : 86_400_000));
    labels.push(p === '24h' ? `${String(at.getHours()).padStart(2, '0')}:00` : at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    const c = Math.round((p === '24h' ? 1 : 4) + rand() * (p === '24h' ? 3 : 9));
    const f = rand() < 0.35 ? 1 : 0;
    created.push(c);
    done.push(Math.max(0, c - f - Math.round(rand() * 2)));
    fail.push(f);
  }
  const usage = inWindow.reduce((acc, t) => ({ inputTokens: acc.inputTokens + (t.usage.inputTokens ?? 0), outputTokens: acc.outputTokens + (t.usage.outputTokens ?? 0), estimatedCostUsd: acc.estimatedCostUsd + (t.usage.estimatedCostUsd ?? 0), requests: acc.requests + t.usage.requests, hasUnavailable: false }), { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, requests: 0, hasUnavailable: false });
  const live = d.agents.filter((a) => !a.archivedAt);
  return {
    window: windowOf(p),
    totalAgents: live.length,
    activeAgents: live.filter((a) => a.status === 'ONLINE' || a.status === 'WORKING' || a.status === 'IDLE').length,
    totalTasks: inWindow.length,
    runningTasks: d.tasks.filter((t) => t.status === 'RUNNING').length,
    queuedTasks: d.tasks.filter((t) => t.status === 'QUEUED').length,
    completedTasks: completed,
    awaitingApproval: d.approvals.filter((a) => a.status === 'PENDING').length,
    failedTasks: failed,
    successRate: completed + failed ? completed / (completed + failed) : null,
    usage,
    trends: { labels, tasksCreated: created, tasksCompleted: done, tasksFailed: fail },
    aiProvider: { configured: true, provider: 'anthropic', model: 'claude-sonnet-5-5', isMock: false },
  };
}

function usageSummary(d: GuestDb, p: Period, projectId: string | null, agentId: string | null): UsageSummaryDto {
  const days = PERIOD_DAYS[p] === 1 ? 1 : PERIOD_DAYS[p];
  const rand = prng(days * 31 + (projectId?.length ?? 0) + (agentId?.length ?? 0));
  const scale = agentId ? 0.18 : projectId ? 0.4 : 1;
  const daily: UsageSummaryDto['daily'] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const inputTokens = Math.round((180_000 + rand() * 260_000) * scale);
    const outputTokens = Math.round(inputTokens * (0.1 + rand() * 0.06));
    daily.push({ date, inputTokens, outputTokens, estimatedCostUsd: Math.round((inputTokens * 2.4 + outputTokens * 11) / 10_000) / 100, requests: Math.round((40 + rand() * 50) * scale) + 1, failed: rand() < 0.3 ? 1 : 0 });
  }
  const sum = (k: 'inputTokens' | 'outputTokens' | 'estimatedCostUsd' | 'requests' | 'failed') => daily.reduce((s, r) => s + r[k], 0);
  const totals = { inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), requests: sum('requests'), toolInvocations: Math.round(sum('requests') * 1.7), durationMs: sum('requests') * 21_000, estimatedCostUsd: Math.round(sum('estimatedCostUsd') * 100) / 100, failed: sum('failed'), retries: Math.round(sum('failed') * 1.5), hasUnavailable: false };
  const agents = d.agents.filter((a) => !a.archivedAt && (!agentId || a.id === agentId) && (!projectId || a.projectId === projectId));
  const weights = agents.map((a, i) => ({ a, w: (a.modelConfig.model?.includes('opus') ? 1.6 : a.modelConfig.model?.includes('haiku') ? 0.5 : 1) * (1 + ((i * 37) % 10) / 10) }));
  const wsum = weights.reduce((s, x) => s + x.w, 0) || 1;
  const byAgent = weights.map(({ a, w }) => {
    const share = w / wsum;
    return { agentId: a.id, name: a.name, color: a.color, inputTokens: Math.round(totals.inputTokens * share), outputTokens: Math.round(totals.outputTokens * share), estimatedCostUsd: Math.round(totals.estimatedCostUsd * share * 100) / 100, requests: Math.round(totals.requests * share), tasks: d.tasks.filter((t) => t.agentId === a.id).length };
  });
  const byProject = d.projects
    .filter((pr) => !projectId || pr.id === projectId)
    .map((pr) => {
      const rows = byAgent.filter((r) => d.agents.find((a) => a.id === r.agentId)?.projectId === pr.id);
      return { projectId: pr.id as string | null, name: pr.name, inputTokens: rows.reduce((s, r) => s + r.inputTokens, 0), outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0), estimatedCostUsd: Math.round(rows.reduce((s, r) => s + r.estimatedCostUsd, 0) * 100) / 100, requests: rows.reduce((s, r) => s + r.requests, 0) };
    })
    .filter((r) => r.requests > 0);
  const models = new Map<string, UsageSummaryDto['byModel'][number]>();
  for (const r of byAgent) {
    const model = d.agents.find((a) => a.id === r.agentId)?.modelConfig.model ?? 'claude-sonnet-5-5';
    const m = models.get(model) ?? { model, requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
    m.requests += r.requests;
    m.inputTokens += r.inputTokens;
    m.outputTokens += r.outputTokens;
    m.estimatedCostUsd = Math.round((m.estimatedCostUsd + r.estimatedCostUsd) * 100) / 100;
    models.set(model, m);
  }
  const usedFor = (b: GuestDb['budgets'][number]) => {
    const monthly = totals.estimatedCostUsd * (30 / days);
    const base = b.period === 'DAILY' ? monthly / 30 : b.period === 'MONTHLY' ? monthly : monthly * 1.6;
    if (b.scope === 'WORKSPACE') return base;
    if (b.scope === 'AGENT') return b.scopeId === 'a_sentinel' ? (b.hardLimitUsd ?? 5) * 1.04 : base * ((byAgent.find((r) => r.agentId === b.scopeId)?.estimatedCostUsd ?? 0) / (totals.estimatedCostUsd || 1));
    return base * 0.45;
  };
  return {
    period: windowOf(p),
    totals,
    daily,
    byAgent,
    byProject,
    byModel: [...models.values()],
    budgets: d.budgets.map((b) => {
      const usedUsd = Math.round(usedFor(b) * 100) / 100;
      const ratio = b.hardLimitUsd ? usedUsd / b.hardLimitUsd : 0;
      const scopeName = b.scope === 'WORKSPACE' ? 'Workspace' : b.scope === 'AGENT' ? (d.agents.find((a) => a.id === b.scopeId)?.name ?? 'Agent') : (d.projects.find((x) => x.id === b.scopeId)?.name ?? 'Project');
      return { id: b.id, scope: b.scope, scopeId: b.scopeId, scopeName, period: b.period, hardLimitUsd: b.hardLimitUsd, warningRatio: b.warningRatio, usedUsd, state: ratio >= 1 ? ('EXCEEDED' as const) : ratio >= b.warningRatio ? ('WARNING' as const) : ('OK' as const), enabled: b.enabled };
    }),
  };
}

// ----------------------------------------------------------------- router
const routes: Array<{ method: string; re: RegExp; keys: string[]; handler: Handler }> = [];
function route(method: string, pattern: string, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), '([^/]+)'))}/?$`);
  routes.push({ method, re, keys, handler });
}

const HEALTH = () => ({
  ok: true,
  version: '1.0.0',
  environment: 'guest',
  checks: { database: { ok: true, message: null }, redis: { ok: true, message: null }, storage: { ok: true, message: null } },
  aiProvider: { configured: true, provider: 'anthropic', reason: null, isMock: false, defaultModel: 'claude-sonnet-5-5', models: Object.entries(MODEL_PRICES).filter(([, m]) => m.provider !== 'mock').map(([id, m]) => ({ id, label: m.label, provider: m.provider })), embeddings: true },
  storage: { driver: 's3 (sample)', ok: true, message: null },
});

// ---- system & auth
route('GET', '/health', HEALTH);
route('GET', '/auth/me', ({ db: d }) => ({ user: d.user, workspaces: [d.workspace] }));
route('PATCH', '/auth/me', ({ db: d, body }) => {
  if (typeof body.name === 'string' && body.name.trim().length >= 2) d.user.name = body.name.trim();
  if (body.themePreference) d.user.themePreference = body.themePreference;
  const m = d.members.find((x) => x.userId === d.user.id);
  if (m) m.name = d.user.name;
  return { user: d.user };
});
route('POST', '/auth/login', ({ db: d }) => ({ user: d.user, workspaces: [d.workspace] }));
route('POST', '/auth/register', ({ db: d }) => ({ user: d.user, workspaces: [d.workspace] }));
route('POST', '/auth/logout', () => ({ ok: true }));

// ---- workspaces
route('GET', '/workspaces', ({ db: d }) => ({ items: [d.workspace] }));
route('PATCH', '/workspaces/:id', ({ db: d, body }) => {
  if (typeof body.name === 'string') d.workspace.name = body.name;
  if (typeof body.maxConcurrentTasks === 'number') d.workspace.maxConcurrentTasks = body.maxConcurrentTasks;
  if (typeof body.defaultAgentConcurrency === 'number') d.workspace.defaultAgentConcurrency = body.defaultAgentConcurrency;
  audit(d, 'workspace.updated', 'workspace', d.workspace.id, body);
  const { id, name, slug, maxConcurrentTasks, defaultAgentConcurrency } = d.workspace;
  return { id, name, slug, maxConcurrentTasks, defaultAgentConcurrency };
});
const membersOf = (d: GuestDb) => ({ members: d.members.map((m) => ({ ...m, avatarUrl: null })), invites: d.invites });
route('GET', '/workspaces/:id/members', ({ db: d }) => membersOf(d));
route('POST', '/workspaces/:id/members', ({ db: d, body }) => {
  const input = parse(InviteMemberSchema, body);
  const email = input.email.toLowerCase();
  const existing = d.members.find((m) => m.email === email);
  if (existing) existing.role = input.role as WorkspaceRole;
  else {
    d.invites = d.invites.filter((i) => i.email !== email);
    d.invites.push({ id: nextId(d, 'wi'), email, role: input.role as WorkspaceRole, createdAt: nowIso() });
  }
  audit(d, 'member.invited', 'workspace', d.workspace.id, { email, role: input.role });
  return membersOf(d);
});
route('PATCH', '/workspaces/:id/members/:userId', ({ db: d, params, body }) => {
  const m = d.members.find((x) => x.userId === params.userId) ?? notFound('Member');
  const role = body.role as WorkspaceRole;
  if (m.role === 'OWNER' && role !== 'OWNER' && d.members.filter((x) => x.role === 'OWNER').length <= 1) conflict('A workspace must keep at least one owner');
  audit(d, 'member.role_changed', 'member', m.userId, { from: m.role, to: role });
  m.role = role;
  return membersOf(d);
});
route('DELETE', '/workspaces/:id/members/:userId', ({ db: d, params }) => {
  const m = d.members.find((x) => x.userId === params.userId) ?? notFound('Member');
  if (m.role === 'OWNER' && d.members.filter((x) => x.role === 'OWNER').length <= 1) conflict('A workspace must keep at least one owner');
  if (m.userId === d.user.id) conflict('You cannot remove yourself in guest mode');
  d.members = d.members.filter((x) => x !== m);
  audit(d, 'member.removed', 'member', m.userId, { name: m.name });
  return membersOf(d);
});
route('GET', '/workspaces/:id/projects', ({ db: d }) => ({ items: d.projects }));
route('POST', '/workspaces/:id/projects', ({ db: d, body }) => {
  const input = parse(CreateProjectSchema, body);
  const project = { id: nextId(d, 'p'), workspaceId: GUEST_WORKSPACE_ID, name: input.name, description: input.description, createdAt: nowIso(), updatedAt: nowIso() };
  d.projects.push(project);
  audit(d, 'project.created', 'project', project.id, { name: project.name });
  return project;
});
route('GET', '/workspaces/:id/budgets', ({ db: d }) => ({ items: d.budgets }));
route('POST', '/workspaces/:id/budgets', ({ db: d, body }) => {
  const input = parse(BudgetPolicySchema, body);
  const existing = d.budgets.find((b) => b.scope === input.scope && b.scopeId === input.scopeId && b.period === input.period);
  const policy = existing ?? { id: nextId(d, 'b'), ...input };
  Object.assign(policy, input);
  if (!existing) d.budgets.push(policy);
  audit(d, 'budget.updated', 'budgetPolicy', policy.id, input);
  return policy;
});
route('DELETE', '/workspaces/:id/budgets/:budgetId', ({ db: d, params }) => {
  d.budgets = d.budgets.filter((b) => b.id !== params.budgetId);
  return { ok: true };
});

// ---- notifications
route('GET', '/notifications', ({ db: d }) => ({ items: d.notifications.slice(0, 50), unread: d.notifications.filter((n) => !n.readAt).length }));
route('POST', '/notifications/read-all', ({ db: d }) => {
  for (const n of d.notifications) n.readAt ??= nowIso();
  return { ok: true };
});
route('POST', '/notifications/:id/read', ({ db: d, params }) => {
  const n = d.notifications.find((x) => x.id === params.id);
  if (n) n.readAt ??= nowIso();
  return { ok: true };
});

// ---- agents
route('GET', '/agents/templates', () => ({ items: Object.values(AGENT_TEMPLATES).map((t) => ({ ...t, renderedInstructions: renderInstructions(t.instructions) })) }));
route('GET', '/agents', ({ db: d, query: q }) => {
  const search = q.get('search');
  const items = d.agents
    .filter((a) => q.get('includeArchived') === 'true' || !a.archivedAt)
    .filter((a) => !q.get('category') || a.category === q.get('category'))
    .filter((a) => !q.get('status') || a.status === q.get('status'))
    .filter((a) => !q.get('projectId') || a.projectId === q.get('projectId'))
    .filter((a) => !search || contains(a.name, search) || contains(a.description, search))
    .map((a) => agentView(d, a))
    .filter((a) => (q.get('availability') === 'available' ? ['ONLINE', 'IDLE'].includes(a.status) && !a.currentTask : q.get('availability') === 'busy' ? a.stats.runningTasks > 0 : true));
  return paginate(items, q);
});
route('POST', '/agents/validate', ({ db: d, body }) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const id of (body.tools ?? []) as string[]) {
    const def = TOOL_CATALOG[id];
    if (!def) {
      errors.push(`Unknown tool ${id}`);
      continue;
    }
    if (def.requiresIntegration && !d.integrations.some((i) => i.provider === def.requiresIntegration && i.status === 'CONNECTED')) warnings.push(`${def.name} requires the ${def.requiresIntegration} integration, which is not configured. The tool will be unavailable until it is.`);
    if (def.requiresApproval) warnings.push(`${def.name} always requires human approval before it executes.`);
  }
  if (!((body.tools ?? []) as string[]).length) warnings.push('The agent has no tools; it can only answer from its instructions and retrieved knowledge.');
  return { valid: errors.length === 0, errors, warnings };
});
route('POST', '/agents/test', ({ body }) => {
  const config = (body.config ?? {}) as Body;
  const name = (config.name as string) || 'Draft agent';
  const tools = ((config.tools ?? []) as string[]).map((t) => TOOL_CATALOG[t]?.name ?? t);
  const text = `**${name}** here. For "${String(body.prompt ?? '').slice(0, 200)}" I would:\n\n1. Search the approved workspace sources for relevant context.\n2. ${tools.length ? `Use ${tools.slice(0, 3).join(', ')} to gather and produce the deliverable.` : 'Answer from my instructions only (no tools granted).'}\n3. Return a concise result in the configured output format, flagging anything I could not verify.\n\n_Sandbox reply generated in guest mode — no AI model was called._`;
  return { text, provider: config.modelConfig?.provider ?? 'anthropic', model: config.modelConfig?.model ?? 'claude-sonnet-5-5', isMock: false, usage: { inputTokens: 1840, outputTokens: 212, available: true }, stopReason: 'end_turn', durationMs: 1430 };
});
route('POST', '/agents', ({ db: d, body }) => {
  const input = parse(CreateAgentSchema, body);
  const id = nextId(d, 'a');
  const created = nowIso();
  const project = input.projectId ? d.projects.find((p) => p.id === input.projectId) : null;
  const agent: AgentDto = {
    id,
    workspaceId: GUEST_WORKSPACE_ID,
    projectId: project?.id ?? null,
    project: project ? { id: project.id, name: project.name } : null,
    name: input.name,
    avatar: input.avatar,
    color: input.color,
    description: input.description,
    category: input.category as AgentDto['category'],
    status: 'ONLINE',
    currentVersion: 1,
    currentVersionId: `av_${id}_1`,
    instructions: input.instructions,
    modelConfig: input.modelConfig,
    tools: input.tools,
    knowledge: input.knowledge,
    currentTask: null,
    lastActivityAt: null,
    lastError: null,
    stats: { totalTasks: 0, completedTasks: 0, failedTasks: 0, runningTasks: 0 },
    createdAt: created,
    updatedAt: created,
    archivedAt: null,
  };
  d.agents.push(agent);
  d.agentVersions[id] = [{ id: agent.currentVersionId, version: 1, changeSummary: input.changeSummary ?? 'Initial version', createdAt: created, createdBy: ME(d), instructions: agent.instructions, modelConfig: agent.modelConfig, tools: agent.tools }];
  audit(d, 'agent.created', 'agent', id, { name: agent.name, category: agent.category });
  emit({ type: 'agent.updated', workspaceId: GUEST_WORKSPACE_ID, agentId: id, status: 'ONLINE' });
  return agentView(d, agent);
});
route('GET', '/agents/:id', ({ db: d, params }) => agentView(d, find(d.agents, params.id, 'Agent')));
route('GET', '/agents/:id/versions', ({ db: d, params }) => {
  find(d.agents, params.id, 'Agent');
  return { items: d.agentVersions[params.id!] ?? [] };
});
route('GET', '/agents/:id/activity', ({ db: d, params }) => {
  find(d.agents, params.id, 'Agent');
  const items = d.tasks
    .filter((t) => t.agentId === params.id)
    .flatMap((t) => (d.events[t.id] ?? []).map((e) => ({ id: e.id, taskId: t.id, taskTitle: t.title, type: e.type, level: e.level, message: e.message, createdAt: e.createdAt, durationMs: e.durationMs })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 40);
  return { items };
});
route('PATCH', '/agents/:id', ({ db: d, params, body }) => {
  const agent = find(d.agents, params.id, 'Agent');
  const input = parse(UpdateAgentSchema, body);
  const { changeSummary, projectId, category, ...rest } = input;
  Object.assign(agent, rest);
  if (category) agent.category = category as AgentDto['category'];
  if (projectId !== undefined) {
    const project = projectId ? d.projects.find((p) => p.id === projectId) : null;
    agent.projectId = project?.id ?? null;
    agent.project = project ? { id: project.id, name: project.name } : null;
  }
  agent.currentVersion += 1;
  agent.currentVersionId = `av_${agent.id}_${agent.currentVersion}`;
  agent.updatedAt = nowIso();
  (d.agentVersions[agent.id] ??= []).unshift({ id: agent.currentVersionId, version: agent.currentVersion, changeSummary: changeSummary ?? 'Edited', createdAt: agent.updatedAt, createdBy: ME(d), instructions: agent.instructions, modelConfig: agent.modelConfig, tools: agent.tools });
  audit(d, 'agent.updated', 'agent', agent.id, { version: agent.currentVersion, changeSummary: changeSummary ?? null });
  emit({ type: 'agent.updated', workspaceId: GUEST_WORKSPACE_ID, agentId: agent.id, status: agent.status });
  return agentView(d, agent);
});
route('POST', '/agents/:id/duplicate', ({ db: d, params }) => {
  const src = find(d.agents, params.id, 'Agent');
  const id = nextId(d, 'a');
  const copy: AgentDto = { ...clone(src), id, name: `${src.name} (copy)`.slice(0, 60), status: 'ONLINE', currentVersion: 1, currentVersionId: `av_${id}_1`, lastError: null, archivedAt: null, createdAt: nowIso(), updatedAt: nowIso() };
  d.agents.push(copy);
  d.agentVersions[id] = [{ id: copy.currentVersionId, version: 1, changeSummary: `Duplicated from ${src.name} v${src.currentVersion}`, createdAt: copy.createdAt, createdBy: ME(d), instructions: copy.instructions, modelConfig: copy.modelConfig, tools: copy.tools }];
  audit(d, 'agent.created', 'agent', id, { duplicatedFrom: src.id });
  return agentView(d, copy);
});
const lifecycle = (action: 'pause' | 'resume' | 'archive'): Handler => ({ db: d, params }) => {
  const agent = find(d.agents, params.id, 'Agent');
  if (action === 'pause') agent.status = 'PAUSED';
  if (action === 'archive') {
    agent.status = 'ARCHIVED';
    agent.archivedAt = nowIso();
  }
  if (action === 'resume') {
    agent.status = 'ONLINE';
    agent.lastError = null;
    for (const t of d.tasks.filter((x) => x.agentId === agent.id && x.status === 'QUEUED')) runTask(d, t.id);
  }
  agent.updatedAt = nowIso();
  audit(d, `agent.${action === 'archive' ? 'archived' : action === 'pause' ? 'paused' : 'resumed'}`, 'agent', agent.id);
  emit({ type: 'agent.updated', workspaceId: GUEST_WORKSPACE_ID, agentId: agent.id, status: agent.status });
  return agentView(d, agent);
};
route('POST', '/agents/:id/pause', lifecycle('pause'));
route('POST', '/agents/:id/resume', lifecycle('resume'));
route('POST', '/agents/:id/archive', lifecycle('archive'));
route('DELETE', '/agents/:id', ({ db: d, params }) => {
  const agent = find(d.agents, params.id, 'Agent');
  d.agents = d.agents.filter((a) => a !== agent);
  audit(d, 'agent.delete.request', 'agent', agent.id, { name: agent.name });
  return { ok: true };
});

// ---- tasks
const PRIORITY_RANK: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 };
route('GET', '/agent-tasks', ({ db: d, query: q }) => {
  const search = q.get('search');
  const sort = q.get('sort') ?? 'createdAt';
  const dir = q.get('order') === 'asc' ? 1 : -1;
  const key = (t: TaskDto): string | number => {
    switch (sort) {
      case 'priority':
        return PRIORITY_RANK[t.priority] ?? 0;
      case 'duration':
        return t.durationMs ?? -1;
      case 'cost':
        return t.usage.estimatedCostUsd ?? -1;
      case 'status':
        return t.status;
      case 'title':
        return t.title.toLowerCase();
      case 'updatedAt':
        return t.updatedAt;
      default:
        return t.createdAt;
    }
  };
  const items = d.tasks
    .filter((t) => !q.get('status') || t.status === q.get('status'))
    .filter((t) => !q.get('agentId') || t.agentId === q.get('agentId'))
    .filter((t) => !q.get('projectId') || t.projectId === q.get('projectId'))
    .filter((t) => !q.get('priority') || t.priority === q.get('priority'))
    .filter((t) => !search || contains(t.title, search) || contains(t.description, search))
    .sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return (ka < kb ? -1 : ka > kb ? 1 : 0) * dir;
    })
    .map((t) => taskView(d, t));
  return paginate(items, q);
});
route('POST', '/agent-tasks', ({ db: d, body }) => taskView(d, createTask(d, parse(CreateTaskSchema, body))));
route('POST', '/agent-tasks/bulk-cancel', ({ db: d, body }) => {
  const ids = (body.taskIds ?? []) as string[];
  const results = ids.map((id) => {
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return { id, ok: false, message: 'Task not found' };
    if (!['DRAFT', ...ACTIVE_TASK].includes(t.status)) return { id, ok: false, message: `Task is already ${t.status.toLowerCase()}` };
    cancelTask(d, t);
    return { id, ok: true };
  });
  audit(d, 'task.bulk_cancel', 'task', null, { taskIds: ids });
  return { results };
});
function cancelTask(d: GuestDb, t: TaskDto) {
  pushEvent(d, t, 'TASK_CANCELLED', 'WARNING', `Task cancelled by ${d.user.name}`);
  touchTask(d, t, { status: 'CANCELLED', completedAt: nowIso(), failureClass: 'CANCELLED', errorMessage: `Cancelled by ${d.user.name}`, pendingApprovalId: null, progressMessage: 'Cancelled' });
  for (const a of d.approvals.filter((x) => x.taskId === t.id && x.status === 'PENDING')) a.status = 'SUPERSEDED';
  setAgentStatus(d, t.agentId);
  if (t.workflowExecutionId) onWorkflowTaskDone(d, t);
}
route('GET', '/agent-tasks/:id', ({ db: d, params }) => taskView(d, find(d.tasks, params.id, 'Task')));
route('POST', '/agent-tasks/:id/cancel', ({ db: d, params }) => {
  const t = find(d.tasks, params.id, 'Task');
  if (!['DRAFT', ...ACTIVE_TASK].includes(t.status)) conflict(`Task is already ${t.status.toLowerCase()}`);
  cancelTask(d, t);
  audit(d, 'task.cancel', 'task', t.id);
  return { cancelled: true, status: t.status, task: taskView(d, t) };
});
route('POST', '/agent-tasks/:id/retry', ({ db: d, params }) => {
  const t = find(d.tasks, params.id, 'Task');
  if (!['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(t.status)) conflict(`A ${t.status.toLowerCase()} task cannot be retried`);
  touchTask(d, t, { status: 'QUEUED', progress: 0, progressMessage: 'Waiting for a free worker', errorMessage: null, failureClass: null, completedAt: null, durationMs: null, attempt: 0 });
  pushEvent(d, t, 'TASK_QUEUED', 'INFO', 'Re-queued for another attempt');
  audit(d, 'task.retry', 'task', t.id);
  runTask(d, t.id);
  return taskView(d, t);
});
route('POST', '/agent-tasks/:id/duplicate', ({ db: d, params }) => {
  const t = find(d.tasks, params.id, 'Task');
  const copy = createTask(d, parse(CreateTaskSchema, { title: `${t.title} (copy)`.slice(0, 200), description: t.description, agentId: t.agentId, projectId: t.projectId, priority: t.priority, expectedDeliverable: t.expectedDeliverable, asDraft: true }));
  return taskView(d, copy);
});
route('POST', '/agent-tasks/:id/publish', ({ db: d, params }) => {
  const t = find(d.tasks, params.id, 'Task');
  if (t.status !== 'DRAFT') conflict('Only drafts can be published');
  touchTask(d, t, { status: 'QUEUED', progressMessage: 'Waiting for a free worker' });
  pushEvent(d, t, 'TASK_QUEUED', 'INFO', 'Draft published and queued', { priority: t.priority });
  runTask(d, t.id);
  return taskView(d, t);
});
route('GET', '/agent-tasks/:id/events', ({ db: d, params, query: q }) => {
  const t = find(d.tasks, params.id, 'Task');
  const search = q.get('search');
  const items = (d.events[t.id] ?? []).filter((e) => (!q.get('type') || e.type === q.get('type')) && (!q.get('level') || e.level === q.get('level')) && (!search || contains(e.message, search)));
  const format = q.get('format');
  if (format === 'csv') {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['sequence,timestamp,type,level,message,durationMs,metadata', ...items.map((e) => [e.sequence, e.createdAt, e.type, e.level, esc(e.message), e.durationMs ?? '', esc(JSON.stringify(e.metadata ?? {}))].join(','))].join('\n');
    return rawFile(csv, 'text/csv; charset=utf-8', `task-${t.id}-events.csv`);
  }
  if (format === 'json') return rawFile(JSON.stringify({ items, includeDiagnostics: true }, null, 2), 'application/json', `task-${t.id}-events.json`);
  return { items, includeDiagnostics: true };
});
route('GET', '/agent-tasks/:id/artifacts', ({ db: d, params }) => ({ items: d.artifacts.filter((a) => a.taskId === params.id).map(artifactDto) }));
route('GET', '/agent-tasks/:id/invocations', ({ db: d, params }) => ({
  items: (d.events[params.id!] ?? [])
    .filter((e) => e.type === 'TOOL_EXECUTED' || e.type === 'TOOL_DENIED')
    .map((e) => {
      const toolId = String(e.metadata?.toolId ?? 'docs.search');
      const def = TOOL_CATALOG[toolId];
      return { id: `inv_${e.id}`, toolId, toolName: def?.name ?? toolId, category: def?.category ?? 'READ', risk: def?.risk ?? 'LOW', status: e.type === 'TOOL_DENIED' ? 'DENIED' : 'SUCCEEDED', errorMessage: e.type === 'TOOL_DENIED' ? e.message : null, approvalId: null, durationMs: e.durationMs, createdAt: e.createdAt, completedAt: e.createdAt };
    }),
}));
route('GET', '/agent-tasks/:id/executions', ({ db: d, params }) => {
  const t = find(d.tasks, params.id, 'Task');
  if (!t.startedAt) return { items: [] };
  return { items: [{ id: `ex_${t.id}`, attempt: Math.max(1, t.attempt), status: t.status, workerId: 'guest-worker-1', errorMessage: t.errorMessage, failureClass: t.failureClass, startedAt: t.startedAt, heartbeatAt: t.updatedAt, completedAt: t.completedAt }] };
});

// ---- approvals
route('GET', '/approvals', ({ db: d, query: q }) => {
  const items = d.approvals
    .filter((a) => !q.get('status') || a.status === q.get('status'))
    .filter((a) => !q.get('taskId') || a.taskId === q.get('taskId'))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((a) => approvalView(d, a));
  return { ...paginate(items, q), pending: d.approvals.filter((a) => a.status === 'PENDING').length };
});
route('GET', '/approvals/:id', ({ db: d, params }) => approvalView(d, find(d.approvals, params.id, 'Approval request')));
const decide = (decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED'): Handler => ({ db: d, params, body }) => {
  const a = find(d.approvals, params.id, 'Approval request');
  const input = parse(ApprovalDecisionSchema, body);
  if (a.status !== 'PENDING') conflict(`This request is already ${a.status.toLowerCase().replace('_', ' ')}`);
  if (input.proposalVersion !== a.proposalVersion) conflict('The proposal changed since you opened it. Review the new version.');
  a.status = decision;
  a.updatedAt = nowIso();
  a.decisions.push({ id: nextId(d, 'd'), decision, comment: input.comment ?? null, decidedBy: ME(d), createdAt: a.updatedAt });
  audit(d, `approval.${decision === 'APPROVED' ? 'approved' : decision === 'REJECTED' ? 'rejected' : 'changes_requested'}`, 'approval', a.id, { risk: a.risk, comment: input.comment ?? null });
  emit({ type: 'approval.updated', workspaceId: GUEST_WORKSPACE_ID, approvalId: a.id, status: a.status, taskId: a.taskId });
  const task = a.taskId ? d.tasks.find((t) => t.id === a.taskId) : null;
  if (task && task.status === 'WAITING_APPROVAL') {
    pushEvent(d, task, decision === 'APPROVED' ? 'APPROVAL_GRANTED' : decision === 'REJECTED' ? 'APPROVAL_REJECTED' : 'APPROVAL_CHANGES_REQUESTED', decision === 'APPROVED' ? 'SUCCESS' : 'WARNING', `${a.actionTitle}: ${decision.toLowerCase().replace('_', ' ')} by ${d.user.name}`, { approvalId: a.id });
    if (decision === 'APPROVED' && a.toolId) pushEvent(d, task, 'TOOL_EXECUTED', 'SUCCESS', `Tool ${a.toolId} executed the approved proposal`, { toolId: a.toolId }, 640);
    touchTask(d, task, { pendingApprovalId: null, progressMessage: 'Resuming after review' });
    runTask(d, task.id, 'resume');
    if (decision === 'APPROVED') after(800, () => (a.status = 'EXECUTED'));
  }
  const ex = a.workflowExecutionId ? d.executions.find((e) => e.id === a.workflowExecutionId) : null;
  const node = ex?.nodes.find((n) => n.approvalId === a.id);
  if (ex && node && node.status === 'WAITING') {
    if (decision === 'APPROVED') completeNode(node, { approvedBy: d.user.name, comment: input.comment ?? null });
    else {
      node.status = 'FAILED';
      node.errorMessage = decision === 'REJECTED' ? 'Rejected by reviewer' : 'Changes requested by reviewer';
      node.completedAt = nowIso();
    }
    ex.status = 'RUNNING';
    after(400, () => advance(d, ex));
  }
  return approvalView(d, a);
};
route('POST', '/approvals/:id/approve', decide('APPROVED'));
route('POST', '/approvals/:id/reject', decide('REJECTED'));
route('POST', '/approvals/:id/request-changes', decide('CHANGES_REQUESTED'));

// ---- workflows
route('GET', '/workflows/templates', () => ({ items: clone(WORKFLOW_TEMPLATES) }));
route('GET', '/workflows', ({ db: d }) => ({ items: [...d.workflows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((w) => workflowView(d, w)) }));
route('POST', '/workflows', ({ db: d, body }) => {
  const input = parse(CreateWorkflowSchema, body);
  return workflowView(d, createWorkflow(d, input.name, input.description, input.projectId, input.graph as WorkflowGraph, input.changeSummary ?? 'Initial version'));
});
function createWorkflow(d: GuestDb, name: string, description: string, projectId: string | null, graph: WorkflowGraph, summary: string): WorkflowDto {
  const id = nextId(d, 'wf');
  const created = nowIso();
  const wf: WorkflowDto = { id, workspaceId: GUEST_WORKSPACE_ID, projectId, name, description, currentVersion: 1, currentVersionId: `wv_${id}_1`, graph: clone(graph), isTemplate: false, lastExecution: null, createdAt: created, updatedAt: created };
  d.workflows.push(wf);
  d.workflowVersions[id] = [{ id: wf.currentVersionId, version: 1, changeSummary: summary, createdAt: created, createdBy: ME(d), graph: clone(graph) }];
  audit(d, 'workflow.created', 'workflow', id, { name });
  return wf;
}
const execById = (d: GuestDb, id: string | undefined) => find(d.executions, id, 'Workflow execution');
route('GET', '/workflows/executions/:executionId', ({ db: d, params }) => execById(d, params.executionId));
route('POST', '/workflows/executions/:executionId/cancel', ({ db: d, params }) => {
  const ex = execById(d, params.executionId);
  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(ex.status)) conflict('This run has already finished');
  ex.status = 'CANCELLED';
  ex.completedAt = nowIso();
  ex.errorMessage = `Cancelled by ${d.user.name}`;
  for (const n of ex.nodes) {
    if (n.taskId) {
      const t = d.tasks.find((x) => x.id === n.taskId);
      if (t && ACTIVE_TASK.includes(t.status)) cancelTask(d, t);
    }
    if (n.approvalId) {
      const a = d.approvals.find((x) => x.id === n.approvalId);
      if (a?.status === 'PENDING') a.status = 'SUPERSEDED';
    }
    if (n.status === 'PENDING' || n.status === 'RUNNING' || n.status === 'WAITING') n.status = 'SKIPPED';
  }
  audit(d, 'workflow.execution.cancelled', 'workflowExecution', ex.id);
  publishExecution(ex);
  return ex;
});
route('POST', '/workflows/executions/:executionId/pause', ({ db: d, params }) => {
  const ex = execById(d, params.executionId);
  if (!['PENDING', 'RUNNING', 'WAITING'].includes(ex.status)) conflict('Only active runs can be paused');
  ex.status = 'PAUSED';
  publishExecution(ex);
  return ex;
});
route('POST', '/workflows/executions/:executionId/resume', ({ db: d, params }) => {
  const ex = execById(d, params.executionId);
  if (ex.status !== 'PAUSED') conflict('Only paused runs can be resumed');
  ex.status = 'RUNNING';
  advance(d, ex);
  return ex;
});
route('POST', '/workflows/executions/:executionId/nodes/:nodeId/complete', ({ db: d, params, body }) => {
  const ex = execById(d, params.executionId);
  const n = ex.nodes.find((x) => x.nodeId === params.nodeId) ?? notFound('Workflow step');
  if (n.status !== 'WAITING' || n.nodeType !== 'HUMAN_TASK') conflict('This step is not waiting for a person');
  completeNode(n, { note: body.note ?? null, completedBy: d.user.name });
  audit(d, 'workflow.human_task.completed', 'workflowExecution', ex.id, { nodeId: n.nodeId });
  ex.status = 'RUNNING';
  advance(d, ex);
  return ex;
});
route('GET', '/workflows/:id', ({ db: d, params }) => workflowView(d, find(d.workflows, params.id, 'Workflow')));
route('PATCH', '/workflows/:id', ({ db: d, params, body }) => {
  const wf = find(d.workflows, params.id, 'Workflow');
  const input = parse(UpdateWorkflowSchema, body);
  if (input.name !== undefined) wf.name = input.name;
  if (input.description !== undefined) wf.description = input.description;
  if (input.projectId !== undefined) wf.projectId = input.projectId;
  if (input.graph) wf.graph = clone(input.graph as WorkflowGraph);
  wf.currentVersion += 1;
  wf.currentVersionId = `wv_${wf.id}_${wf.currentVersion}`;
  wf.updatedAt = nowIso();
  (d.workflowVersions[wf.id] ??= []).unshift({ id: wf.currentVersionId, version: wf.currentVersion, changeSummary: input.changeSummary ?? 'Edited', createdAt: wf.updatedAt, createdBy: ME(d), graph: clone(wf.graph) });
  audit(d, 'workflow.updated', 'workflow', wf.id, { version: wf.currentVersion });
  return workflowView(d, wf);
});
route('DELETE', '/workflows/:id', ({ db: d, params }) => {
  const wf = find(d.workflows, params.id, 'Workflow');
  d.workflows = d.workflows.filter((w) => w !== wf);
  audit(d, 'workflow.archived', 'workflow', wf.id);
  return { ok: true };
});
route('POST', '/workflows/:id/validate', ({ db: d, params, body }) => {
  const wf = find(d.workflows, params.id, 'Workflow');
  return validateGraph(d, (body.graph as WorkflowGraph | undefined) ?? wf.graph);
});
route('POST', '/workflows/:id/dry-run', ({ db: d, params, body }) => newExecution(d, find(d.workflows, params.id, 'Workflow'), (body.input ?? {}) as Record<string, unknown>, true));
route('POST', '/workflows/:id/execute', ({ db: d, params, body }) => newExecution(d, find(d.workflows, params.id, 'Workflow'), (body.input ?? {}) as Record<string, unknown>, Boolean(body.dryRun)));
route('GET', '/workflows/:id/executions', ({ db: d, params }) => {
  find(d.workflows, params.id, 'Workflow');
  return { items: d.executions.filter((e) => e.workflowId === params.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
});
route('GET', '/workflows/:id/versions', ({ db: d, params }) => {
  find(d.workflows, params.id, 'Workflow');
  return { items: d.workflowVersions[params.id!] ?? [] };
});
route('POST', '/workflows/:id/duplicate', ({ db: d, params }) => {
  const wf = find(d.workflows, params.id, 'Workflow');
  return workflowView(d, createWorkflow(d, `${wf.name} (copy)`.slice(0, 120), wf.description, wf.projectId, wf.graph, `Duplicated from ${wf.name} v${wf.currentVersion}`));
});

// ---- knowledge
route('GET', '/knowledge-sources', ({ db: d, query: q }) => {
  const search = q.get('search');
  const items = d.knowledge
    .filter((k) => !q.get('projectId') || k.projectId === q.get('projectId'))
    .filter((k) => !q.get('status') || k.status === q.get('status'))
    .filter((k) => !q.get('type') || k.type === q.get('type'))
    .filter((k) => !q.get('agentId') || k.agentIds.includes(q.get('agentId')!))
    .filter((k) => !search || contains(k.title, search) || contains(k.url, search))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return paginate(items, q);
});
route('GET', '/knowledge-sources/search', ({ db: d, query: q }) => {
  const agentId = q.get('agentId');
  const agent = agentId ? find(d.agents, agentId, 'Agent') : null;
  return { items: searchSnippets(d, q.get('q') ?? '', agent ? agent.knowledge.sourceIds : null, Number(q.get('limit')) || 8) };
});
function addKnowledge(d: GuestDb, source: Partial<KnowledgeSourceDto> & Pick<KnowledgeSourceDto, 'type' | 'title'>): KnowledgeSourceDto {
  const created = nowIso();
  const k: KnowledgeSourceDto = { id: nextId(d, 'k'), workspaceId: GUEST_WORKSPACE_ID, projectId: null, url: null, status: 'PROCESSING', statusMessage: 'Extracting and chunking', version: 1, chunkCount: 0, size: null, agentIds: [], createdBy: ME(d), createdAt: created, updatedAt: created, indexedAt: null, ...source };
  d.knowledge.unshift(k);
  audit(d, 'knowledge.created', 'knowledgeSource', k.id, { type: k.type, title: k.title });
  finishIndexing(d, k);
  return k;
}
function finishIndexing(d: GuestDb, k: KnowledgeSourceDto) {
  emit({ type: 'knowledge.updated', workspaceId: GUEST_WORKSPACE_ID, sourceId: k.id, status: k.status });
  after(2500, () => {
    Object.assign(k, { status: 'READY', statusMessage: null, chunkCount: k.chunkCount || 6 + Math.round(Math.random() * 20), indexedAt: nowIso(), updatedAt: nowIso() });
    emit({ type: 'knowledge.updated', workspaceId: GUEST_WORKSPACE_ID, sourceId: k.id, status: k.status });
  });
}
route('POST', '/knowledge-sources', ({ db: d, body }) => {
  const input = parse(CreateKnowledgeSchema, body);
  if (input.type === 'URL') return addKnowledge(d, { type: 'URL', title: input.title || new URL(input.url).hostname, url: input.url, projectId: input.projectId, agentIds: input.agentIds });
  return addKnowledge(d, { type: 'TEXT', title: input.title, size: input.content.length, projectId: input.projectId, agentIds: input.agentIds });
});
route('POST', '/knowledge-sources/upload', ({ db: d, form }) => {
  const file = form?.get('file');
  const name = file instanceof File ? file.name : 'upload';
  const agentIds = String(form?.get('agentIds') ?? '').split(',').filter(Boolean);
  const projectId = String(form?.get('projectId') ?? '') || null;
  return addKnowledge(d, { type: 'DOCUMENT', title: name, size: file instanceof File ? file.size : null, projectId, agentIds });
});
route('GET', '/knowledge-sources/:id', ({ db: d, params }) => {
  const k = find(d.knowledge, params.id, 'Knowledge source');
  return { ...k, sampleChunks: (KNOWLEDGE_SNIPPETS[k.id] ?? []).map((content, index) => ({ index, content, tokens: Math.round(content.length / 4) })) };
});
route('POST', '/knowledge-sources/:id/reindex', ({ db: d, params }) => {
  const k = find(d.knowledge, params.id, 'Knowledge source');
  Object.assign(k, { status: 'PROCESSING', statusMessage: 'Re-indexing', version: k.version + 1, updatedAt: nowIso() });
  finishIndexing(d, k);
  return { ok: true };
});
route('POST', '/knowledge-sources/:id/agents', ({ db: d, params, body }) => {
  const k = find(d.knowledge, params.id, 'Knowledge source');
  k.agentIds = ((body.agentIds ?? []) as string[]).filter((id) => d.agents.some((a) => a.id === id));
  for (const a of d.agents) {
    const linked = k.agentIds.includes(a.id);
    const has = a.knowledge.sourceIds.includes(k.id);
    if (linked && !has) a.knowledge.sourceIds.push(k.id);
    if (!linked && has) a.knowledge.sourceIds = a.knowledge.sourceIds.filter((x) => x !== k.id);
  }
  return k;
});
route('DELETE', '/knowledge-sources/:id', ({ db: d, params, query: q }) => {
  const k = find(d.knowledge, params.id, 'Knowledge source');
  if (q.get('hard') === 'true') d.knowledge = d.knowledge.filter((x) => x !== k);
  else Object.assign(k, { status: 'REVOKED', statusMessage: `Revoked by ${d.user.name}`, updatedAt: nowIso() });
  audit(d, 'knowledge.revoked', 'knowledgeSource', k.id, { hard: q.get('hard') === 'true' });
  return { ok: true };
});

// ---- artifacts
route('GET', '/artifacts', ({ db: d, query: q }) => {
  const search = q.get('search');
  const items = d.artifacts
    .filter((a) => !q.get('taskId') || a.taskId === q.get('taskId'))
    .filter((a) => !q.get('agentId') || a.agentId === q.get('agentId'))
    .filter((a) => !q.get('projectId') || a.projectId === q.get('projectId'))
    .filter((a) => !q.get('type') || a.type === q.get('type'))
    .filter((a) => !search || contains(a.name, search))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(artifactDto);
  return paginate(items, q);
});
route('POST', '/artifacts', async ({ db: d, form }) => {
  const file = form?.get('file');
  if (!(file instanceof File)) throw new GuestApiError(400, 'BAD_REQUEST', 'Missing file field');
  const ext = file.name.split('.').pop()?.toLowerCase();
  const type: ArtifactType = ext === 'md' ? 'MARKDOWN' : ext === 'csv' ? 'CSV' : ext === 'json' ? 'JSON' : ext === 'txt' ? 'TEXT' : ext === 'pdf' ? 'PDF' : 'UPLOAD';
  const text = type === 'PDF' || type === 'UPLOAD' ? '' : await file.text().catch(() => '');
  const artifact: GuestArtifact = { id: nextId(d, 'ar'), workspaceId: GUEST_WORKSPACE_ID, projectId: String(form?.get('projectId') ?? '') || null, taskId: null, agentId: null, agent: null, name: file.name, type, mimeType: file.type || mimeFor(type), size: file.size, version: 1, sources: [], visibility: 'WORKSPACE', createdBy: ME(d), createdAt: nowIso(), content: text.slice(0, 200_000) };
  d.artifacts.unshift(artifact);
  audit(d, 'artifact.uploaded', 'artifact', artifact.id, { name: artifact.name, size: artifact.size });
  return artifactDto(artifact);
});
route('GET', '/artifacts/:id', ({ db: d, params }) => artifactDto(find(d.artifacts, params.id, 'Artifact')));
route('GET', '/artifacts/:id/download', ({ db: d, params }) => {
  const a = find(d.artifacts, params.id, 'Artifact');
  audit(d, 'artifact.downloaded', 'artifact', a.id, { name: a.name });
  return rawFile(a.content, a.mimeType, a.name);
});
route('GET', '/artifacts/:id/preview', ({ db: d, params }) => {
  const a = find(d.artifacts, params.id, 'Artifact');
  if (a.type === 'PDF' || a.type === 'UPLOAD') return { artifact: artifactDto(a), previewable: false, content: null };
  return { artifact: artifactDto(a), previewable: true, content: a.content, truncated: false };
});
route('POST', '/artifacts/:id/duplicate', ({ db: d, params }) => {
  const a = find(d.artifacts, params.id, 'Artifact');
  const copy: GuestArtifact = { ...clone(a), id: nextId(d, 'ar'), name: `copy-of-${a.name}`, createdBy: ME(d), createdAt: nowIso() };
  d.artifacts.unshift(copy);
  return artifactDto(copy);
});
route('DELETE', '/artifacts/:id', ({ db: d, params }) => {
  const a = find(d.artifacts, params.id, 'Artifact');
  d.artifacts = d.artifacts.filter((x) => x !== a);
  audit(d, 'artifact.deleted', 'artifact', a.id, { name: a.name });
  return { ok: true };
});

// ---- conversations
route('GET', '/conversations', ({ db: d, query: q }) => ({ items: d.conversations.filter((c) => !q.get('agentId') || c.agentId === q.get('agentId')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }));
route('POST', '/conversations', ({ db: d, body }) => {
  const agent = find(d.agents, body.agentId as string, 'Agent');
  const projectId = (body.projectId as string | null | undefined) ?? null;
  const existing = d.conversations.find((c) => c.agentId === agent.id && c.projectId === projectId);
  if (existing) return existing;
  const conv = { id: nextId(d, 'c'), agentId: agent.id, projectId, title: `Chat with ${agent.name}`, createdAt: nowIso(), updatedAt: nowIso() };
  d.conversations.push(conv);
  return conv;
});
route('GET', '/conversations/:id/messages', ({ db: d, params }) => {
  find(d.conversations, params.id, 'Conversation');
  return { items: d.messages.filter((m) => m.conversationId === params.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
});
route('POST', '/conversations/:id/messages', ({ db: d, params, body }) => {
  const conv = find(d.conversations, params.id, 'Conversation');
  const content = String(body.content ?? '').trim();
  if (!content) throw new GuestApiError(400, 'VALIDATION_ERROR', 'Message is empty', [{ path: 'content', message: 'Required' }]);
  const userMessage = addMessage(d, conv.id, { role: 'USER', content, status: 'COMPLETE' });
  // Task-mode bookkeeping messages from the chat panel do not need a reply.
  if (content.startsWith('[Task created:')) return { userMessage, reply: null };
  const reply = addMessage(d, conv.id, { role: 'AGENT', content: '', status: 'PENDING' });
  streamReply(d, conv.id, reply, content);
  return { userMessage, reply };
});
route('POST', '/conversations/:id/messages/:messageId/retry', ({ db: d, params }) => {
  const conv = find(d.conversations, params.id, 'Conversation');
  const m = d.messages.find((x) => x.id === params.messageId && x.conversationId === conv.id && x.role === 'AGENT') ?? notFound('Message');
  const prompt = [...d.messages].filter((x) => x.conversationId === conv.id && x.role === 'USER' && x.createdAt <= m.createdAt).pop()?.content ?? 'hello';
  Object.assign(m, { status: 'PENDING', kind: 'TEXT', content: '' });
  emit({ type: 'message.created', workspaceId: GUEST_WORKSPACE_ID, conversationId: conv.id, message: m });
  streamReply(d, conv.id, m, prompt);
  return m;
});

// ---- usage, audit, integrations, tools
route('GET', '/usage/dashboard', ({ db: d, query: q }) => dashboard(d, periodOf(q)));
route('GET', '/usage', ({ db: d, query: q }) => usageSummary(d, periodOf(q), q.get('projectId'), q.get('agentId')));
route('GET', '/usage/agents', ({ db: d, query: q }) => {
  const s = usageSummary(d, periodOf(q), null, null);
  return { period: s.period, items: s.byAgent, hasUnavailable: false };
});
route('GET', '/audit-logs', ({ db: d, query: q }) => {
  const search = q.get('search');
  const items = d.audit
    .filter((r) => !q.get('action') || r.action.startsWith(q.get('action')!))
    .filter((r) => !q.get('actorId') || r.actor?.id === q.get('actorId'))
    .filter((r) => !q.get('resourceType') || r.resourceType === q.get('resourceType'))
    .filter((r) => !search || contains(r.action, search) || contains(r.resourceId, search) || contains(r.actor?.name, search));
  return paginate(items, q);
});
route('GET', '/integrations', ({ db: d }) => ({
  items: d.integrations,
  available: [
    { provider: 'github', name: 'GitHub', description: 'Repository metadata, draft pull requests and merges (code.merge requires approval).', secretLabel: 'Personal access token', tools: ['repo.metadata', 'github.pr_draft', 'code.merge'] },
    { provider: 'webhook', name: 'Outbound webhook', description: 'Receives message.send, content.publish and ops.execute payloads (e.g. Slack/Teams incoming webhook or your own endpoint).', secretLabel: 'Webhook URL', tools: ['message.send', 'content.publish', 'ops.execute'] },
  ],
}));
route('POST', '/integrations', ({ db: d, body }) => {
  const input = parse(IntegrationSchema, body);
  const existing = d.integrations.find((i) => i.provider === input.provider);
  const dto = existing ?? { id: nextId(d, 'i'), provider: input.provider, name: input.name, config: input.config, status: 'CONNECTED' as const, lastCheckedAt: null, lastError: null, createdAt: nowIso() };
  Object.assign(dto, { name: input.name, config: input.config, status: 'CONNECTED', lastCheckedAt: nowIso(), lastError: null });
  if (!existing) d.integrations.push(dto);
  audit(d, 'integration.configured', 'integration', dto.id, { provider: input.provider, name: input.name });
  return dto;
});
route('POST', '/integrations/:id/check', ({ db: d, params }) => {
  const i = find(d.integrations, params.id, 'Integration');
  i.lastCheckedAt = nowIso();
  return i;
});
route('DELETE', '/integrations/:id', ({ db: d, params }) => {
  d.integrations = d.integrations.filter((i) => i.id !== params.id);
  audit(d, 'integration.removed', 'integration', params.id ?? null);
  return { ok: true };
});
let toolSummaries: Array<ReturnType<typeof toolSummary>> | null = null;
route('GET', '/tools', ({ db: d }) => {
  toolSummaries ??= Object.values(TOOL_CATALOG).map(toolSummary);
  const live = d.agents.filter((a) => !a.archivedAt);
  const items = toolSummaries.map((t) => {
    let reason: string | null = null;
    if (d.disabledTools.has(t.id)) reason = 'Tool disabled by administrator';
    else if (t.requiresIntegration && !d.integrations.some((i) => i.provider === t.requiresIntegration && i.status === 'CONNECTED')) reason = `Requires the ${t.requiresIntegration} integration to be configured`;
    return { ...t, available: reason === null, unavailableReason: reason, grantedAgents: live.filter((a) => a.tools.includes(t.id)).length };
  });
  return { items, groups: TOOL_GROUPS };
});
route('PATCH', '/tools/:id', ({ db: d, params, body }) => {
  if (!TOOL_CATALOG[params.id!]) notFound('Tool');
  if (body.enabled) d.disabledTools.delete(params.id!);
  else d.disabledTools.add(params.id!);
  audit(d, `tool.${body.enabled ? 'enabled' : 'disabled'}`, 'tool', params.id ?? null);
  return { id: params.id, enabled: Boolean(body.enabled) };
});

// ---- password flows: nothing to do without accounts
route('POST', '/auth/forgot-password', () => ({ ok: true }));
route('POST', '/auth/reset-password', () => ({ ok: true }));
route('POST', '/auth/verify-email', () => ({ ok: true }));

// ------------------------------------------------------------------ entry
interface RawFile {
  __raw: true;
  body: string;
  contentType: string;
  filename: string;
}
function rawFile(body: string, contentType: string, filename: string): RawFile {
  return { __raw: true, body, contentType, filename };
}
const isRaw = (v: unknown): v is RawFile => typeof v === 'object' && v !== null && (v as RawFile).__raw === true;

/** Answer one API request from the in-memory sample data. Never touches the network. */
export async function handleGuestRequest(method: string, pathWithQuery: string, body: unknown, form?: FormData): Promise<GuestResponse> {
  const url = new URL(pathWithQuery, 'http://guest.local');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const d = getDb();
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? '')));
    try {
      const result = await r.handler({ db: d, params, query: url.searchParams, body: (body ?? {}) as Body, form });
      if (isRaw(result)) return { status: 200, data: null, raw: { body: result.body, contentType: result.contentType, filename: result.filename } };
      return { status: method === 'POST' && /^\/(agents|agent-tasks|workflows|knowledge-sources|artifacts)$/.test(path) ? 201 : 200, data: result === undefined ? null : clone(result) };
    } catch (err) {
      if (err instanceof GuestApiError) return { status: err.status, data: { error: { code: err.code, message: err.message, details: err.details, requestId: 'guest' } } };
      return { status: 500, data: { error: { code: 'INTERNAL', message: err instanceof Error ? err.message : 'Guest mode error' } } };
    }
  }
  // Unknown endpoint: answer with a harmless empty payload rather than an error.
  return { status: 200, data: method === 'GET' ? { items: [], page: 1, pageSize: 20, total: 0 } : { ok: true } };
}
