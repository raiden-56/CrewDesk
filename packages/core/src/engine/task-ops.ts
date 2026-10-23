import { assertTransition, canCancel, canRetry, type AgentStatus, type TaskStatus } from '@collabspace/shared';
import { Prisma } from '@prisma/client';
import { getConfig } from '../config.js';
import { prisma } from '../db.js';
import { Errors } from '../errors.js';
import { publishRealtime, recordEvent } from '../events.js';
import { logger } from '../logger.js';
import { agentTaskQueue, enqueueAgentTask, enqueueWorkflowAdvance } from '../queue.js';
import { notifyUser } from '../services/notifications.js';

type TaskUpdate = Omit<Prisma.AgentTaskUncheckedUpdateInput, 'status'>;

/**
 * Transition a task to a new status with state-machine validation inside a transaction.
 * Returns the updated task or throws InvalidTransitionError.
 */
export async function transitionTask(taskId: string, to: TaskStatus, data: TaskUpdate = {}, opts: { expectFrom?: TaskStatus[] } = {}) {
  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.agentTask.findUnique({ where: { id: taskId }, select: { status: true } });
    if (!current) throw Errors.notFound('Task');
    if (opts.expectFrom && !opts.expectFrom.includes(current.status as TaskStatus)) {
      throw Errors.conflict(`Task is ${current.status}; expected ${opts.expectFrom.join('/')}`);
    }
    assertTransition(current.status as TaskStatus, to);
    return tx.agentTask.update({ where: { id: taskId }, data: { ...data, status: to } });
  });
  await publishRealtime({ type: 'task.updated', workspaceId: updated.workspaceId, task: { id: updated.id, status: updated.status as TaskStatus, progress: updated.progress, progressMessage: updated.progressMessage, agentId: updated.agentId, updatedAt: updated.updatedAt.toISOString() } });
  return updated;
}

export async function updateTaskProgress(taskId: string, progress: number, progressMessage: string | null) {
  const updated = await prisma.agentTask.update({ where: { id: taskId }, data: { progress: Math.max(0, Math.min(100, Math.round(progress))), progressMessage } });
  await publishRealtime({ type: 'task.updated', workspaceId: updated.workspaceId, task: { id: updated.id, status: updated.status as TaskStatus, progress: updated.progress, progressMessage: updated.progressMessage, agentId: updated.agentId, updatedAt: updated.updatedAt.toISOString() } });
}

export async function setAgentStatus(agentId: string, status: AgentStatus, extra: { lastError?: string | null; touch?: boolean } = {}) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { status: true, workspaceId: true } });
  if (!agent) return;
  // never override a human pause/archive with an automatic status
  if ((agent.status === 'PAUSED' || agent.status === 'ARCHIVED') && status !== 'PAUSED' && status !== 'ARCHIVED') {
    if (extra.lastError !== undefined) await prisma.agent.update({ where: { id: agentId }, data: { lastError: extra.lastError } });
    return;
  }
  await prisma.agent.update({ where: { id: agentId }, data: { status, ...(extra.lastError !== undefined ? { lastError: extra.lastError } : {}), ...(extra.touch ? { lastActivityAt: new Date() } : {}) } });
  await publishRealtime({ type: 'agent.updated', workspaceId: agent.workspaceId, agentId, status });
}

/** Re-derive an agent's automatic status from its running tasks. */
export async function refreshAgentStatus(agentId: string) {
  const running = await prisma.agentTask.count({ where: { agentId, status: 'RUNNING' } });
  await setAgentStatus(agentId, running > 0 ? 'WORKING' : 'ONLINE', { touch: true });
}

/** Request cancellation. Queued/paused/waiting tasks cancel immediately; running tasks are aborted by the worker. */
export async function requestCancel(taskId: string, actorId: string | null) {
  const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound('Task');
  if (!canCancel(task.status as TaskStatus)) throw Errors.conflict(`Task cannot be cancelled from status ${task.status}`);
  if (task.status === 'RUNNING') {
    await prisma.agentTask.update({ where: { id: taskId }, data: { cancelRequestedAt: new Date() } });
    await recordEvent({ taskId, workspaceId: task.workspaceId, type: 'PROGRESS', level: 'WARNING', message: 'Cancellation requested; waiting for the worker to stop safely', metadata: { actorId } });
    return { immediate: false };
  }
  await transitionTask(taskId, 'CANCELLED', { cancelRequestedAt: new Date(), completedAt: new Date(), progressMessage: 'Cancelled' });
  await removeQueuedJob(taskId);
  await prisma.approvalRequest.updateMany({ where: { taskId, status: 'PENDING' }, data: { status: 'SUPERSEDED' } });
  await prisma.agentExecution.updateMany({ where: { taskId, status: { in: ['RUNNING', 'WAITING_APPROVAL'] } }, data: { status: 'CANCELLED', completedAt: new Date() } });
  await recordEvent({ taskId, workspaceId: task.workspaceId, type: 'TASK_CANCELLED', level: 'WARNING', message: 'Task cancelled', metadata: { actorId } });
  await refreshAgentStatus(task.agentId);
  if (task.workflowExecutionId) await enqueueWorkflowAdvance(task.workflowExecutionId, undefined);
  return { immediate: true };
}

async function removeQueuedJob(taskId: string) {
  try {
    const q = agentTaskQueue();
    const jobs = await q.getJobs(['waiting', 'delayed', 'prioritized', 'paused']);
    for (const job of jobs) if (job.data.taskId === taskId) await job.remove().catch(() => undefined);
  } catch (err) {
    logger.warn({ err, taskId }, 'failed to remove queued job');
  }
}

/** Manual retry of a failed/cancelled/timed-out task. Starts a fresh attempt from the same versioned config. */
export async function retryTask(taskId: string, actorId: string | null) {
  const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound('Task');
  if (!canRetry(task.status as TaskStatus)) throw Errors.conflict(`Task cannot be retried from status ${task.status}`);
  const updated = await transitionTask(taskId, 'QUEUED', { cancelRequestedAt: null, errorMessage: null, failureClass: null, progress: 0, progressMessage: 'Queued for retry', completedAt: null, maxAttempts: Math.max(task.maxAttempts, task.attempt + 1) });
  await recordEvent({ taskId, workspaceId: task.workspaceId, type: 'TASK_QUEUED', message: 'Task re-queued by manual retry', metadata: { actorId, previousStatus: task.status } });
  await enqueueAgentTask(taskId, { priority: task.priority, attempt: task.attempt + 1 });
  return updated;
}

/** Enqueue a task that is in DRAFT or QUEUED (initial submission). */
export async function submitTask(taskId: string) {
  const task = await prisma.agentTask.findUnique({ where: { id: taskId } });
  if (!task) throw Errors.notFound('Task');
  if (task.status === 'DRAFT') await transitionTask(taskId, 'QUEUED', { progressMessage: 'Queued' });
  else if (task.status !== 'QUEUED') throw Errors.conflict(`Task is ${task.status}`);
  await recordEvent({ taskId, workspaceId: task.workspaceId, type: 'TASK_QUEUED', message: task.scheduledFor && task.scheduledFor > new Date() ? `Scheduled for ${task.scheduledFor.toISOString()}` : 'Task queued for execution' });
  if (task.scheduledFor && task.scheduledFor > new Date()) return; // picked up by the scheduler
  await enqueueAgentTask(taskId, { priority: task.priority, attempt: task.attempt });
}

/** Maintenance: enqueue scheduled tasks whose time has come. */
export async function promoteScheduledTasks() {
  const due = await prisma.agentTask.findMany({ where: { status: 'QUEUED', scheduledFor: { lte: new Date() }, jobId: null }, select: { id: true, priority: true, attempt: true } });
  for (const t of due) {
    const jobId = await enqueueAgentTask(t.id, { priority: t.priority, attempt: t.attempt });
    await prisma.agentTask.update({ where: { id: t.id }, data: { jobId } });
  }
  return due.length;
}

/** Maintenance: detect RUNNING tasks whose worker stopped sending heartbeats and recover them. */
export async function recoverStaleTasks() {
  const cfg = getConfig();
  const cutoff = new Date(Date.now() - cfg.TASK_STALE_AFTER_MS);
  const stale = await prisma.agentTask.findMany({ where: { status: 'RUNNING', heartbeatAt: { lt: cutoff } } });
  for (const task of stale) {
    await prisma.agentExecution.updateMany({ where: { taskId: task.id, status: 'RUNNING' }, data: { status: 'ABANDONED', completedAt: new Date(), errorMessage: 'Worker heartbeat lost' } });
    await recordEvent({ taskId: task.id, workspaceId: task.workspaceId, type: 'WORKER_RECOVERED', level: 'WARNING', message: `Worker ${task.workerId ?? 'unknown'} stopped responding; recovering task`, metadata: { lastHeartbeat: task.heartbeatAt?.toISOString() ?? null } });
    if (task.attempt >= task.maxAttempts) {
      await transitionTask(task.id, 'FAILED', { errorMessage: 'Worker lost and retry limit reached', failureClass: 'TRANSIENT', completedAt: new Date(), progressMessage: 'Failed after worker loss' });
      await recordEvent({ taskId: task.id, workspaceId: task.workspaceId, type: 'TASK_FAILED', level: 'ERROR', message: 'Task failed: worker lost and no retries remain' });
      if (task.createdById) await notifyUser({ workspaceId: task.workspaceId, userId: task.createdById, type: 'TASK_FAILED', title: 'Task failed', body: `${task.title} failed after the worker was lost.`, link: `/tasks/${task.id}` });
      await refreshAgentStatus(task.agentId);
    } else {
      await transitionTask(task.id, 'QUEUED', { workerId: null, progressMessage: 'Recovering after worker loss' });
      await enqueueAgentTask(task.id, { priority: task.priority, attempt: task.attempt, delayMs: 2000 });
    }
  }
  return stale.length;
}
