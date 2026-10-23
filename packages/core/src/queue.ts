import { Queue, type JobsOptions } from 'bullmq';
import { createRedis } from './redis.js';

export const QUEUE_NAMES = {
  AGENT_TASKS: 'agent-tasks',
  KNOWLEDGE: 'knowledge-ingest',
  WORKFLOWS: 'workflow-advance',
  MAINTENANCE: 'maintenance',
  CHAT: 'chat-messages',
} as const;

export interface ChatJob {
  conversationId: string;
  messageId: string;
}

export interface AgentTaskJob {
  taskId: string;
  /** set when a job resumes an execution after approval */
  resume?: boolean;
}
export interface KnowledgeJob {
  sourceId: string;
}
export interface WorkflowJob {
  executionId: string;
  /** optional node id that triggered the advance (approval/agent/delay completion) */
  completedNodeId?: string;
}
export interface MaintenanceJob {
  kind: 'stale-tasks' | 'expire-approvals' | 'scheduled-tasks';
}

const queues = new Map<string, Queue>();

function queue<T>(name: string): Queue<T> {
  let q = queues.get(name) as Queue<T> | undefined;
  if (!q) {
    q = new Queue<T>(name, { connection: createRedis(), defaultJobOptions: { removeOnComplete: 500, removeOnFail: 1000 } });
    queues.set(name, q as Queue);
  }
  return q;
}

export const agentTaskQueue = () => queue<AgentTaskJob>(QUEUE_NAMES.AGENT_TASKS);
export const knowledgeQueue = () => queue<KnowledgeJob>(QUEUE_NAMES.KNOWLEDGE);
export const workflowQueue = () => queue<WorkflowJob>(QUEUE_NAMES.WORKFLOWS);
export const maintenanceQueue = () => queue<MaintenanceJob>(QUEUE_NAMES.MAINTENANCE);
export const chatQueue = () => queue<ChatJob>(QUEUE_NAMES.CHAT);

export async function enqueueChatMessage(conversationId: string, messageId: string) {
  const job = await chatQueue().add('respond', { conversationId, messageId }, { jobId: `chat-${messageId}`, attempts: 1 });
  return job.id;
}

const PRIORITY_MAP: Record<string, number> = { URGENT: 1, HIGH: 2, NORMAL: 3, LOW: 4 };

export async function enqueueAgentTask(taskId: string, opts: { priority?: string; delayMs?: number; resume?: boolean; attempt?: number } = {}) {
  const jobOpts: JobsOptions = {
    // BullMQ job id must be unique per queue; include attempt so manual retries create a fresh job
    jobId: `task-${taskId}-${opts.attempt ?? 0}-${opts.resume ? 'r' + Date.now() : 'i'}`,
    priority: PRIORITY_MAP[opts.priority ?? 'NORMAL'] ?? 3,
    delay: opts.delayMs ?? 0,
    attempts: 1, // retries are managed by the execution engine, not BullMQ
  };
  const job = await agentTaskQueue().add('execute', { taskId, resume: opts.resume ?? false }, jobOpts);
  return job.id ?? jobOpts.jobId!;
}

export async function enqueueKnowledgeIngest(sourceId: string) {
  const job = await knowledgeQueue().add('ingest', { sourceId }, { jobId: `knowledge-${sourceId}-${Date.now()}`, attempts: 3, backoff: { type: 'exponential', delay: 3000 } });
  return job.id;
}

export async function enqueueWorkflowAdvance(executionId: string, completedNodeId?: string, delayMs = 0) {
  const job = await workflowQueue().add(
    'advance',
    { executionId, completedNodeId },
    { jobId: `wf-${executionId}-${completedNodeId ?? 'start'}-${Date.now()}`, delay: delayMs, attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
  );
  return job.id;
}

export async function scheduleMaintenance() {
  const q = maintenanceQueue();
  await q.add('stale-tasks', { kind: 'stale-tasks' }, { repeat: { every: 30000 }, jobId: 'maint-stale-tasks' });
  await q.add('expire-approvals', { kind: 'expire-approvals' }, { repeat: { every: 60000 }, jobId: 'maint-expire-approvals' });
  await q.add('scheduled-tasks', { kind: 'scheduled-tasks' }, { repeat: { every: 15000 }, jobId: 'maint-scheduled-tasks' });
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close().catch(() => undefined)));
  queues.clear();
}
