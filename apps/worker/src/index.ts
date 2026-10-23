/**
 * CollabSpace AI Team worker process.
 * Runs agent task execution, chat replies, knowledge ingestion, workflow advancement
 * and maintenance jobs. Never serves HTTP.
 */
import { hostname } from 'node:os';
import { Worker, type Job } from 'bullmq';
import {
  advanceWorkflow,
  closeQueues,
  closeRedis,
  createRedis,
  disconnectDb,
  executeTask,
  expireApprovals,
  generateChatReply,
  getConfig,
  ingestKnowledgeSource,
  logger,
  promoteScheduledTasks,
  QUEUE_NAMES,
  recoverStaleTasks,
  registerBuiltinTools,
  scheduleMaintenance,
  syncToolDefinitions,
  type AgentTaskJob,
  type ChatJob,
  type KnowledgeJob,
  type MaintenanceJob,
  type WorkflowJob,
} from '@collabspace/core';

const cfg = getConfig();
const workerId = `${hostname()}-${process.pid}`;

async function main() {
  registerBuiltinTools();
  await syncToolDefinitions();
  await scheduleMaintenance();

  const connection = () => createRedis();

  const taskWorker = new Worker<AgentTaskJob>(
    QUEUE_NAMES.AGENT_TASKS,
    async (job: Job<AgentTaskJob>) => {
      const outcome = await executeTask(job.data.taskId, { workerId, resume: Boolean(job.data.resume) });
      logger.info({ taskId: job.data.taskId, outcome, jobId: job.id }, 'task job finished');
      return outcome;
    },
    { connection: connection(), concurrency: cfg.WORKER_CONCURRENCY, lockDuration: 120000, stalledInterval: 60000, maxStalledCount: 2 },
  );

  const chatWorker = new Worker<ChatJob>(
    QUEUE_NAMES.CHAT,
    async (job: Job<ChatJob>) => generateChatReply(job.data.conversationId, job.data.messageId),
    { connection: connection(), concurrency: Math.max(2, cfg.WORKER_CONCURRENCY) },
  );

  const knowledgeWorker = new Worker<KnowledgeJob>(
    QUEUE_NAMES.KNOWLEDGE,
    async (job: Job<KnowledgeJob>) => ingestKnowledgeSource(job.data.sourceId),
    { connection: connection(), concurrency: 2 },
  );

  const workflowWorker = new Worker<WorkflowJob>(
    QUEUE_NAMES.WORKFLOWS,
    async (job: Job<WorkflowJob>) => advanceWorkflow(job.data.executionId),
    { connection: connection(), concurrency: 2 },
  );

  const maintenanceWorker = new Worker<MaintenanceJob>(
    QUEUE_NAMES.MAINTENANCE,
    async (job: Job<MaintenanceJob>) => {
      if (job.data.kind === 'stale-tasks') {
        const n = await recoverStaleTasks();
        if (n) logger.warn({ recovered: n }, 'recovered stale tasks');
      } else if (job.data.kind === 'expire-approvals') {
        const n = await expireApprovals();
        if (n) logger.info({ expired: n }, 'expired approvals');
      } else if (job.data.kind === 'scheduled-tasks') {
        const n = await promoteScheduledTasks();
        if (n) logger.info({ promoted: n }, 'promoted scheduled tasks');
      }
    },
    { connection: connection(), concurrency: 1 },
  );

  const workers = [taskWorker, chatWorker, knowledgeWorker, workflowWorker, maintenanceWorker];
  for (const w of workers) {
    w.on('failed', (job, err) => logger.error({ queue: w.name, jobId: job?.id, err: err.message }, 'job failed'));
    w.on('error', (err) => logger.error({ queue: w.name, err: err.message }, 'worker error'));
  }
  logger.info({ workerId, concurrency: cfg.WORKER_CONCURRENCY, provider: cfg.AI_PROVIDER || 'not configured' }, 'worker started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    await closeRedis();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'worker failed to start');
  process.exit(1);
});
