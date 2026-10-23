import {
  classifyError,
  computeBackoffMs,
  DEFAULT_RETRY_POLICY,
  ExecutionError,
  shouldRetry,
  TOOL_CATALOG,
  validateToolInput,
  type FailureClass,
  type RiskLevel,
  type TaskStatus,
} from '@collabspace/shared';
import { defaultModelFor, resolveProvider, textOf, toolUsesOf, type AiProvider, type ProviderContent, type ProviderMessage } from '../ai/index.js';
import { getConfig } from '../config.js';
import { prisma } from '../db.js';
import { hashProposal } from '../crypto.js';
import { publishRealtime, recordEvent } from '../events.js';
import { logger } from '../logger.js';
import { enqueueAgentTask, enqueueWorkflowAdvance } from '../queue.js';
import { acquireLock } from '../redis.js';
import { audit } from '../services/audit.js';
import { notifyUser } from '../services/notifications.js';
import { getAdapter, type ToolContext } from '../tools/registry.js';
import { createApproval } from './approvals.js';
import { buildExecutionContext, type ExecutionContextData } from './context.js';
import { refreshAgentStatus, setAgentStatus, transitionTask, updateTaskProgress } from './task-ops.js';
import { checkBudgets, recordUsage } from './usage.js';

const MAX_ITERATIONS = 30;
const MAX_TOOL_RESULT_CHARS = 24000;

interface PendingApproval {
  invocationId: string;
  approvalId: string;
  toolUseId: string;
  toolId: string;
  input: unknown;
  collected: ProviderContent[];
  remaining: Array<{ id: string; name: string; input: unknown }>;
}

interface ExecState {
  messages: ProviderMessage[];
  pending: PendingApproval | null;
  iteration: number;
  toolCalls: number;
}

export type ExecuteOutcome = 'completed' | 'failed' | 'paused' | 'requeued' | 'cancelled' | 'skipped';

class CancelledError extends ExecutionError {
  constructor() {
    super('Task cancelled by user', 'CANCELLED');
  }
}

function truncate(s: string, max = MAX_TOOL_RESULT_CHARS): string {
  return s.length > max ? `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]` : s;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ExecutionError(`${label} timed out after ${ms}ms`, 'TIMEOUT')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Execute (or resume) a task. Called by the worker for every agent-task job.
 * The function is idempotent with respect to stale jobs: it refuses to run tasks that
 * are not in a runnable state.
 */
export async function executeTask(taskId: string, opts: { workerId: string; resume: boolean }): Promise<ExecuteOutcome> {
  const cfg = getConfig();
  const task = await prisma.agentTask.findUnique({ where: { id: taskId }, include: { workspace: true } });
  if (!task) return 'skipped';
  if (task.status !== 'QUEUED') {
    logger.info({ taskId, status: task.status }, 'skipping job: task not queued');
    return 'skipped';
  }
  if (task.cancelRequestedAt) {
    await transitionTask(taskId, 'CANCELLED', { completedAt: new Date(), progressMessage: 'Cancelled' });
    await recordEvent({ taskId, workspaceId: task.workspaceId, type: 'TASK_CANCELLED', level: 'WARNING', message: 'Task cancelled before execution started' });
    return 'cancelled';
  }

  // ---- fair scheduling: workspace + per-agent concurrency limits (atomic via lock)
  const release = await acquireLock(`sched:${task.workspaceId}`, 5000);
  if (!release) {
    await enqueueAgentTask(taskId, { priority: task.priority, attempt: task.attempt, delayMs: 500 + Math.random() * 1000, resume: opts.resume });
    return 'requeued';
  }
  let execution: { id: string; attempt: number; state: ExecState } | null = null;
  try {
    const wsRunning = await prisma.agentTask.count({ where: { workspaceId: task.workspaceId, status: 'RUNNING' } });
    const agentRunning = await prisma.agentTask.count({ where: { agentId: task.agentId, status: 'RUNNING' } });
    const wsLimit = Math.min(task.workspace.maxConcurrentTasks, cfg.WORKSPACE_MAX_CONCURRENT_TASKS);
    if (wsRunning >= wsLimit || agentRunning >= task.workspace.defaultAgentConcurrency) {
      await enqueueAgentTask(taskId, { priority: task.priority, attempt: task.attempt, delayMs: 3000 + Math.random() * 3000, resume: opts.resume });
      return 'requeued';
    }
    // ---- claim the task
    const attempt = opts.resume ? task.attempt : task.attempt + 1;
    const isResume = opts.resume && task.attempt > 0;
    await transitionTask(taskId, 'RUNNING', {
      attempt,
      workerId: opts.workerId,
      heartbeatAt: new Date(),
      startedAt: task.startedAt ?? new Date(),
      progressMessage: isResume ? 'Resuming execution' : attempt > 1 ? `Retrying (attempt ${attempt})` : 'Starting execution',
      ...(isResume ? {} : { progress: 5 }),
    });
    if (isResume) {
      const existing = await prisma.agentExecution.findUnique({ where: { taskId_attempt: { taskId, attempt } } });
      if (existing && existing.state && existing.status === 'WAITING_APPROVAL') {
        await prisma.agentExecution.update({ where: { id: existing.id }, data: { status: 'RUNNING', workerId: opts.workerId, heartbeatAt: new Date() } });
        execution = { id: existing.id, attempt, state: existing.state as unknown as ExecState };
      }
    }
    if (!execution) {
      const created = await prisma.agentExecution.upsert({
        where: { taskId_attempt: { taskId, attempt } },
        create: { taskId, attempt, workerId: opts.workerId, status: 'RUNNING' },
        update: { workerId: opts.workerId, status: 'RUNNING', heartbeatAt: new Date(), completedAt: null, errorMessage: null },
      });
      execution = { id: created.id, attempt, state: { messages: [], pending: null, iteration: 0, toolCalls: 0 } };
    }
  } finally {
    await release();
  }

  await setAgentStatus(task.agentId, 'WORKING', { touch: true, lastError: null });
  return runExecution(taskId, execution, opts.workerId);
}

async function runExecution(taskId: string, execution: { id: string; attempt: number; state: ExecState }, workerId: string): Promise<ExecuteOutcome> {
  const cfg = getConfig();
  const state = execution.state;
  const abort = new AbortController();
  let cancelled = false;
  let ctx: ExecutionContextData | null = null;
  const startedAt = Date.now();

  const saveState = async (status: 'RUNNING' | 'WAITING_APPROVAL' = 'RUNNING') => {
    await prisma.agentExecution.update({ where: { id: execution.id }, data: { state: state as unknown as object, status, heartbeatAt: new Date() } });
  };

  // ---- heartbeat + cancellation watcher
  const heartbeat = setInterval(async () => {
    try {
      const t = await prisma.agentTask.update({ where: { id: taskId }, data: { heartbeatAt: new Date() }, select: { cancelRequestedAt: true, workspaceId: true } });
      await prisma.agentExecution.update({ where: { id: execution.id }, data: { heartbeatAt: new Date() } });
      if (t.cancelRequestedAt && !cancelled) {
        cancelled = true;
        abort.abort();
      }
    } catch (err) {
      logger.warn({ err, taskId }, 'heartbeat failed');
    }
  }, cfg.TASK_HEARTBEAT_MS);

  let timeoutHandle: NodeJS.Timeout | null = null;
  try {
    const taskRow = await prisma.agentTask.findUniqueOrThrow({ where: { id: taskId }, select: { timeoutMs: true, workspaceId: true, agentId: true, projectId: true, createdById: true, title: true, conversationId: true, workflowExecutionId: true, requireApprovalForWrites: true, budgetUsd: true, inputArtifactIds: true, priority: true, maxAttempts: true, attempt: true } });
    const workspaceId = taskRow.workspaceId;
    timeoutHandle = setTimeout(() => abort.abort(), taskRow.timeoutMs);

    const provider = resolveProvider();
    if (!provider) throw new ExecutionError('No AI provider is configured. Set AI_PROVIDER and the matching API key.', 'PERMANENT');
    const agentProvider = await resolveAgentProvider(taskId, provider);

    await recordEvent({ taskId, workspaceId, executionId: execution.id, type: 'TASK_ACCEPTED', message: `Worker ${workerId} accepted the task (attempt ${execution.attempt})`, metadata: { workerId, attempt: execution.attempt, provider: agentProvider.provider.name, resume: state.messages.length > 0 } });

    const t0 = Date.now();
    ctx = await buildExecutionContext(taskId, agentProvider.provider.isMock);
    await recordEvent({ taskId, workspaceId, executionId: execution.id, type: 'CONTEXT_RETRIEVED', message: `Context prepared: ${ctx.knowledgeSourceIds.length} knowledge source(s), ${ctx.allowedToolIds.length} tool(s) available`, metadata: { knowledgeSources: ctx.knowledgeSourceIds.length, tools: ctx.allowedToolIds, unavailableTools: ctx.unavailableTools, agentVersion: ctx.task.agentVersion.version }, durationMs: Date.now() - t0 });
    if (state.messages.length === 0) {
      state.messages.push({ role: 'user', content: [{ type: 'text', text: buildUserPrompt(ctx) }] });
      await updateTaskProgress(taskId, 10, 'Context prepared');
    }

    const model = agentProvider.model;
    const toolCtxBase: Omit<ToolContext, 'idempotencyKey' | 'approval'> = {
      workspaceId,
      projectId: ctx.task.projectId,
      agentId: ctx.task.agentId,
      agentName: ctx.task.agent.name,
      taskId,
      executionId: execution.id,
      knowledgeSourceIds: ctx.knowledgeSourceIds,
      allowPreviousReports: Boolean(ctx.knowledge.allowPreviousReports),
      inputArtifactIds: taskRow.inputArtifactIds,
      actorUserId: ctx.task.createdById,
    };

    // ---- resume after an approval decision
    if (state.pending) {
      const outcome = await resolvePendingApproval(state, ctx, toolCtxBase, execution.id, abort.signal);
      if (outcome === 'paused') return 'paused';
      await saveState();
    }

    // ---- main model/tool loop
    while (true) {
      if (abort.signal.aborted) throw cancelled ? new CancelledError() : new ExecutionError(`Task exceeded its timeout of ${taskRow.timeoutMs}ms`, 'TIMEOUT');
      if (state.iteration >= MAX_ITERATIONS) throw new ExecutionError(`Execution exceeded ${MAX_ITERATIONS} model iterations`, 'PERMANENT');
      state.iteration += 1;

      const budget = await checkBudgets({ workspaceId, agentId: ctx.task.agentId, projectId: ctx.task.projectId, taskId, taskBudgetUsd: taskRow.budgetUsd, maxTokensPerTask: ctx.modelConfig.maxTokensPerTask ?? null, agentBudgetUsd: ctx.modelConfig.budgetUsd ?? null });
      if (budget.state === 'EXCEEDED') {
        await recordEvent({ taskId, workspaceId, executionId: execution.id, type: 'BUDGET_EXCEEDED', level: 'ERROR', message: budget.message, metadata: { evaluations: budget.evaluations } });
        throw new ExecutionError(budget.message, 'BUDGET');
      }
      if (budget.state === 'WARNING') {
        await recordEvent({ taskId, workspaceId, executionId: execution.id, type: 'BUDGET_WARNING', level: 'WARNING', message: budget.message, metadata: { evaluations: budget.evaluations } });
      }

      await recordEvent({ taskId, workspaceId, executionId: execution.id, type: 'MODEL_REQUEST_STARTED', message: `Model request ${state.iteration} to ${agentProvider.provider.name}/${model}`, metadata: { iteration: state.iteration, messages: state.messages.length, tools: ctx.providerTools.length } });
      await updateTaskProgress(taskId, Math.min(85, 10 + state.iteration * 12), `Thinking (step ${state.iteration})`);
      const reqStart = Date.now();
      let result;
      try {
        result = await agentProvider.provider.complete({
          model,
          system: ctx.systemPrompt,
          messages: state.messages,
          tools: ctx.providerTools,
          maxOutputTokens: ctx.modelConfig.maxOutputTokens,
          temperature: agentProvider.provider.supportsTemperature(model) ? ctx.modelConfig.temperature : null,
          timeoutMs: Math.max(10000, Math.min(taskRow.timeoutMs, 300000)),
          signal: abort.signal,
          metadata: { taskId, attempt: execution.attempt, agentName: ctx.task.agent.name },
        });
      } catch (err) {
        await recordUsage({ workspaceId, projectId: ctx.task.projectId, agentId: ctx.task.agentId, taskId, executionId: execution.id, kind: 'MODEL', provider: agentProvider.provider.name, model, inputTokens: null, outputTokens: null, usageAvailable: false, durationMs: Date.now() - reqStart, success: false, isRetry: execution.attempt > 1 });
        throw err;
      }
      const usageRecord = await recordUsage({ workspaceId, projectId: ctx.task.projectId, agentId: ctx.task.agentId, taskId, executionId: execution.id, kind: 'MODEL', provider: result.provider, model: result.model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, usageAvailable: result.usage.available, durationMs: Date.now() - reqStart, success: true, isRetry: execution.attempt > 1 });
      await recordEvent({ taskId, workspaceId, executionId: execution.id, type: 'MODEL_RESPONSE_RECEIVED', level: 'SUCCESS', message: `Model responded (${result.stopReason}${result.usage.available ? `, ${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens` : ', usage unavailable'})`, metadata: { stopReason: result.stopReason, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, usageAvailable: result.usage.available, estimatedCostUsd: usageRecord.estimatedCostUsd, toolCalls: toolUsesOf(result.content).length }, diagnostics: { textPreview: textOf(result.content).slice(0, 2000) }, durationMs: Date.now() - reqStart });

      if (result.stopReason === 'refusal') {
        throw new ExecutionError(`The model declined the request${result.refusal?.category ? ` (category: ${result.refusal.category})` : ''}.${result.refusal?.explanation ? ` ${result.refusal.explanation}` : ''}`, 'PERMANENT');
      }

      state.messages.push({ role: 'assistant', content: result.content });
      const toolUses = toolUsesOf(result.content);

      if (result.stopReason !== 'tool_use' || toolUses.length === 0) {
        if (result.stopReason === 'max_tokens') {
          await recordEvent({ taskId, workspaceId, executionId: execution.id, type: 'PROGRESS', level: 'WARNING', message: 'Model output was cut off by the max output token limit' });
        }
        await saveState();
        return finishTask(taskId, ctx, execution, state, result.content, startedAt);
      }

      // ---- execute tool calls sequentially (an approval pause can interrupt the sequence)
      const collected: ProviderContent[] = [];
      for (let i = 0; i < toolUses.length; i++) {
        const call = toolUses[i]!;
        const outcome = await handleToolCall(call, ctx, toolCtxBase, execution, state, abort.signal);
        if (outcome.kind === 'result') {
          collected.push(outcome.block);
          continue;
        }
        // approval required: persist everything and pause
        state.pending = { invocationId: outcome.invocationId, approvalId: outcome.approvalId, toolUseId: call.id, toolId: call.name, input: call.input, collected, remaining: toolUses.slice(i + 1) };
        await saveState('WAITING_APPROVAL');
        await transitionTask(taskId, 'WAITING_APPROVAL', { progressMessage: `Waiting for approval: ${TOOL_CATALOG[call.name]?.name ?? call.name}` });
        await refreshAgentStatus(ctx.task.agentId);
        return 'paused';
      }
      state.messages.push({ role: 'user', content: collected });
      await saveState();
    }
  } catch (err) {
    return await handleFailure(taskId, execution, err, cancelled, ctx, startedAt);
  } finally {
    clearInterval(heartbeat);
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function resolveAgentProvider(taskId: string, envProvider: AiProvider): Promise<{ provider: AiProvider; model: string }> {
  const task = await prisma.agentTask.findUniqueOrThrow({ where: { id: taskId }, select: { agentVersion: { select: { modelConfig: true } } } });
  const mc = task.agentVersion.modelConfig as { provider?: string | null; model?: string | null };
  const provider = mc.provider ? resolveProvider(mc.provider) : envProvider;
  if (!provider) throw new ExecutionError(`The agent is configured for provider "${mc.provider}" which is not available on this server.`, 'PERMANENT');
  const model = mc.model && mc.model.trim() ? mc.model : defaultModelFor(provider.name);
  return { provider, model };
}

function buildUserPrompt(ctx: ExecutionContextData): string {
  const t = ctx.task;
  const lines = [`Please complete this task.`, '', `Task: ${t.title}`];
  if (t.description) lines.push('', t.description);
  if (t.expectedDeliverable) lines.push('', `Expected deliverable: ${t.expectedDeliverable}`);
  if (t.inputArtifactIds.length) lines.push('', `Input file ids: ${t.inputArtifactIds.map((id) => `[file:${id}]`).join(' ')}`);
  lines.push('', 'When you are done, reply with a concise final summary.');
  return lines.join('\n');
}

type ToolOutcome = { kind: 'result'; block: ProviderContent } | { kind: 'approval'; invocationId: string; approvalId: string };

async function handleToolCall(
  call: { id: string; name: string; input: unknown },
  ctx: ExecutionContextData,
  base: Omit<ToolContext, 'idempotencyKey' | 'approval'>,
  execution: { id: string; attempt: number },
  state: ExecState,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const taskId = base.taskId;
  const workspaceId = base.workspaceId;
  const def = TOOL_CATALOG[call.name];
  state.toolCalls += 1;
  await recordEvent({ taskId, workspaceId, executionId: execution.id, type: 'TOOL_REQUESTED', message: `Agent requested ${def?.name ?? call.name}`, metadata: { toolId: call.name, toolUseId: call.id }, diagnostics: { input: call.input } });

  const deny = async (reason: string) => {
    await recordEvent({ taskId, workspaceId, executionId: execution.id, type: 'TOOL_DENIED', level: 'WARNING', message: `${call.name} denied: ${reason}`, metadata: { toolId: call.name, reason } });
    await audit({ workspaceId, actorType: 'AGENT', action: 'tool.denied', resourceType: 'task', resourceId: taskId, metadata: { toolId: call.name, reason, agentId: base.agentId } });
    if (def) await prisma.toolInvocation.create({ data: { taskId, executionId: execution.id, toolId: call.name, status: 'DENIED', input: (call.input ?? {}) as object, errorMessage: reason, completedAt: new Date() } }).catch(() => undefined);
    return { kind: 'result', block: { type: 'tool_result', toolUseId: call.id, content: `Tool call denied: ${reason}`, isError: true } } as ToolOutcome;
  };

  if (!def) return deny('unknown tool');
  if (!ctx.allowedToolIds.includes(call.name)) {
    const unavailable = ctx.unavailableTools.find((u) => u.id === call.name);
    return deny(unavailable ? `tool unavailable (${unavailable.reason})` : 'tool is not granted to this agent for this task');
  }
  const validated = validateToolInput(call.name, call.input);
  if (!validated.ok) return deny(`invalid input: ${validated.error}`);
  const input = validated.data;
  const adapter = getAdapter(call.name);
  if (!adapter) return deny('no adapter registered');

  const needsApproval = def.requiresApproval || (ctx.task.requireApprovalForWrites && def.category !== 'READ');
  const idempotencyKey = `${taskId}:${execution.attempt}:${call.id}`;
  const invocation = await prisma.toolInvocation.create({ data: { taskId, executionId: execution.id, toolId: call.name, status: needsApproval ? 'AWAITING_APPROVAL' : 'AUTHORIZED', input: input as object, idempotencyKey } });

  if (needsApproval) {
    let preview: { targetResource: string | null; diff?: { before: string | null; after: string | null }; evidence?: Record<string, unknown> } = { targetResource: null };
    try {
      if (adapter.preview) preview = await adapter.preview(input, { ...base, idempotencyKey, approval: null });
    } catch (err) {
      await prisma.toolInvocation.update({ where: { id: invocation.id }, data: { status: 'FAILED', errorMessage: (err as Error).message, completedAt: new Date() } });
      return deny(`cannot prepare approval: ${(err as Error).message}`);
    }
    const approval = await createApproval({
      workspaceId,
      taskId,
      agentId: base.agentId,
      toolId: call.name,
      invocationId: invocation.id,
      actionTitle: def.name,
      actionDescription: `${ctx.task.agent.name} wants to run ${def.name} (${call.name}) as part of task "${ctx.task.title}".`,
      targetResource: preview.targetResource,
      risk: def.risk as RiskLevel,
      proposal: { toolId: call.name, input },
      evidence: { ...(preview.evidence ?? {}), toolUseId: call.id, modelExplanation: textOf(state.messages[state.messages.length - 1]?.content ?? []).slice(0, 1000) },
      diff: preview.diff ?? null,
    });
    await recordEvent({ taskId, workspaceId, executionId: execution.id, type: 'APPROVAL_REQUESTED', level: 'WARNING', message: `Approval requested for ${def.name}${preview.targetResource ? ` on ${preview.targetResource}` : ''}`, metadata: { toolId: call.name, approvalId: approval.id, risk: def.risk, targetResource: preview.targetResource } });
    return { kind: 'approval', invocationId: invocation.id, approvalId: approval.id };
  }

  await recordEvent({ taskId, workspaceId, executionId: execution.id, type: 'TOOL_AUTHORIZED', message: `${def.name} authorized (${def.category.toLowerCase()}, ${def.risk.toLowerCase()} risk)`, metadata: { toolId: call.name, invocationId: invocation.id } });
  const block = await runAdapter(adapter, def, input, { ...base, idempotencyKey, approval: null }, invocation.id, call.id, execution, signal);
  return { kind: 'result', block };
}

async function runAdapter(
  adapter: NonNullable<ReturnType<typeof getAdapter>>,
  def: (typeof TOOL_CATALOG)[string],
  input: unknown,
  toolCtx: ToolContext,
  invocationId: string,
  toolUseId: string,
  execution: { id: string; attempt: number },
  signal: AbortSignal,
): Promise<ProviderContent> {
  const { taskId, workspaceId } = toolCtx;
  const started = Date.now();
  await prisma.toolInvocation.update({ where: { id: invocationId }, data: { status: 'AUTHORIZED', startedAt: new Date() } });
  let attempt = 0;
  let lastErr: unknown;
  while (attempt < def.retryPolicy.maxAttempts) {
    attempt += 1;
    if (signal.aborted) throw new ExecutionError('Task aborted during tool execution', 'TIMEOUT');
    try {
      const output = await withTimeout(adapter.execute(input, toolCtx), def.timeoutMs, def.name);
      const parsedOut = def.outputSchema.safeParse(output);
      const finalOut = parsedOut.success ? parsedOut.data : output;
      const durationMs = Date.now() - started;
      await prisma.toolInvocation.update({ where: { id: invocationId }, data: { status: 'EXECUTED', output: finalOut as object, durationMs, completedAt: new Date() } });
      await recordUsage({ workspaceId, projectId: toolCtx.projectId, agentId: toolCtx.agentId, taskId, executionId: execution.id, kind: 'TOOL', provider: 'platform', model: 'tool', toolId: def.id, inputTokens: null, outputTokens: null, usageAvailable: false, durationMs, success: true });
      const artifactId = (finalOut as { artifactId?: string } | null)?.artifactId;
      await recordEvent({ taskId, workspaceId, executionId: execution.id, type: 'TOOL_EXECUTED', level: 'SUCCESS', message: `${def.name} executed${attempt > 1 ? ` (after ${attempt} attempts)` : ''}`, metadata: { toolId: def.id, invocationId, attempt, artifactId: artifactId ?? null, approvalId: toolCtx.approval?.id ?? null }, diagnostics: { output: finalOut }, durationMs });
      if (artifactId) {
        const a = await prisma.artifact.findUnique({ where: { id: artifactId }, select: { name: true, type: true, size: true } });
        await recordEvent({ taskId, workspaceId, executionId: execution.id, type: 'ARTIFACT_GENERATED', level: 'SUCCESS', message: `Artifact generated: ${a?.name ?? artifactId}`, metadata: { artifactId, name: a?.name, type: a?.type, size: a?.size } });
      }
      if (def.audit === 'DETAILED') await audit({ workspaceId, actorType: 'AGENT', action: 'tool.executed', resourceType: 'task', resourceId: taskId, metadata: { toolId: def.id, invocationId, agentId: toolCtx.agentId, approvalId: toolCtx.approval?.id ?? null, targetArtifact: artifactId ?? null } });
      return { type: 'tool_result', toolUseId, content: truncate(JSON.stringify(finalOut)) };
    } catch (err) {
      lastErr = err;
      const failure = classifyError(err);
      // Non-idempotent tools: after an uncertain timeout, verify instead of blindly retrying
      if (!def.idempotent && failure === 'TIMEOUT' && adapter.verify) {
        try {
          const verified = await adapter.verify(input, toolCtx);
          if (verified) {
            await prisma.toolInvocation.update({ where: { id: invocationId }, data: { status: 'EXECUTED', output: verified as object, durationMs: Date.now() - started, completedAt: new Date(), errorMessage: 'Completed (verified after timeout)' } });
            await recordEvent({ taskId, workspaceId, executionId: execution.id, type: 'TOOL_EXECUTED', level: 'WARNING', message: `${def.name} timed out but the action was verified as completed`, metadata: { toolId: def.id, invocationId } });
            return { type: 'tool_result', toolUseId, content: truncate(JSON.stringify(verified)) };
          }
        } catch {
          /* verification failed; fall through */
        }
      }
      const canRetryTool = def.idempotent && shouldRetry(def.retryPolicy, attempt, failure);
      await recordEvent({ taskId, workspaceId, executionId: execution.id, type: canRetryTool ? 'RETRY_PERFORMED' : 'TOOL_FAILED', level: canRetryTool ? 'WARNING' : 'ERROR', message: `${def.name} failed (${failure.toLowerCase()}): ${(err as Error).message}${canRetryTool ? ' — retrying' : ''}`, metadata: { toolId: def.id, invocationId, attempt, failureClass: failure }, diagnostics: { stack: (err as Error).stack?.slice(0, 2000) } });
      if (!canRetryTool) break;
      await new Promise((r) => setTimeout(r, computeBackoffMs(def.retryPolicy, attempt)));
    }
  }
  const message = (lastErr as Error)?.message ?? 'unknown error';
  const uncertain = !def.idempotent && classifyError(lastErr) === 'TIMEOUT';
  await prisma.toolInvocation.update({ where: { id: invocationId }, data: { status: 'FAILED', errorMessage: uncertain ? `Uncertain outcome (timeout): ${message}` : message, durationMs: Date.now() - started, completedAt: new Date() } });
  await recordUsage({ workspaceId, projectId: toolCtx.projectId, agentId: toolCtx.agentId, taskId, executionId: execution.id, kind: 'TOOL', provider: 'platform', model: 'tool', toolId: def.id, inputTokens: null, outputTokens: null, usageAvailable: false, durationMs: Date.now() - started, success: false });
  return {
    type: 'tool_result',
    toolUseId,
    content: uncertain
      ? `Tool ${def.id} timed out and its result could not be verified. The action may or may not have happened. Do NOT retry it; report this to the user for human review.`
      : `Tool ${def.id} failed: ${message}`,
    isError: true,
  };
}

/** After an approval decision the task is re-queued; this applies the decision with fresh checks. */
async function resolvePendingApproval(state: ExecState, ctx: ExecutionContextData, base: Omit<ToolContext, 'idempotencyKey' | 'approval'>, executionId: string, signal: AbortSignal): Promise<'continue' | 'paused'> {
  const pending = state.pending!;
  const { taskId, workspaceId } = base;
  const approval = await prisma.approvalRequest.findUnique({ where: { id: pending.approvalId }, include: { decisions: { orderBy: { createdAt: 'desc' }, take: 1, include: { decidedBy: { select: { id: true, name: true } } } } } });
  const def = TOOL_CATALOG[pending.toolId];
  let block: ProviderContent;
  if (!approval || !def) {
    block = { type: 'tool_result', toolUseId: pending.toolUseId, content: 'Approval record missing; action not executed.', isError: true };
  } else if (approval.status === 'PENDING') {
    // still pending (e.g. requeued by recovery): keep waiting
    await prisma.agentExecution.update({ where: { id: executionId }, data: { status: 'WAITING_APPROVAL' } });
    await transitionTask(taskId, 'WAITING_APPROVAL', { progressMessage: `Waiting for approval: ${def.name}` });
    return 'paused';
  } else if (approval.status === 'APPROVED') {
    const decision = approval.decisions[0];
    // Fresh validation: tool still granted + available, proposal unchanged, approval not expired.
    const freshCtx = await buildExecutionContext(taskId, false);
    const stillAllowed = freshCtx.allowedToolIds.includes(pending.toolId);
    const expectedHash = hashProposal({ toolId: pending.toolId, proposal: { toolId: pending.toolId, input: pending.input }, targetResource: approval.targetResource });
    const hashOk = expectedHash === approval.proposalHash;
    const expired = approval.expiresAt ? approval.expiresAt < new Date() : false;
    if (!stillAllowed || !hashOk || expired || !decision) {
      const reason = !stillAllowed ? 'tool is no longer granted to the agent' : !hashOk ? 'proposal no longer matches the approved version' : expired ? 'approval expired' : 'no decision found';
      await prisma.approvalRequest.update({ where: { id: approval.id }, data: { status: 'SUPERSEDED' } });
      await prisma.toolInvocation.update({ where: { id: pending.invocationId }, data: { status: 'DENIED', errorMessage: reason, completedAt: new Date() } });
      await recordEvent({ taskId, workspaceId, executionId, type: 'TOOL_DENIED', level: 'ERROR', message: `Approved action not executed: ${reason}`, metadata: { toolId: pending.toolId, approvalId: approval.id } });
      block = { type: 'tool_result', toolUseId: pending.toolUseId, content: `Approved action was not executed: ${reason}.`, isError: true };
    } else {
      const adapter = getAdapter(pending.toolId);
      if (!adapter) block = { type: 'tool_result', toolUseId: pending.toolUseId, content: 'No adapter registered', isError: true };
      else {
        await recordEvent({ taskId, workspaceId, executionId, type: 'TOOL_AUTHORIZED', level: 'SUCCESS', message: `${def.name} authorized by ${decision.decidedBy.name} (approval ${approval.id})`, metadata: { toolId: pending.toolId, approvalId: approval.id, decidedBy: decision.decidedBy.id } });
        block = await runAdapter(adapter, def, pending.input, { ...base, idempotencyKey: `${taskId}:approval:${approval.id}`, approval: { id: approval.id, approvedById: decision.decidedById } }, pending.invocationId, pending.toolUseId, { id: executionId, attempt: ctx.task.attempt }, signal);
        const invocation = await prisma.toolInvocation.findUnique({ where: { id: pending.invocationId }, select: { status: true, output: true, errorMessage: true } });
        await prisma.approvalRequest.update({ where: { id: approval.id }, data: { status: 'EXECUTED', executedAt: new Date(), executionResult: { status: invocation?.status, output: invocation?.output ?? null, error: invocation?.errorMessage ?? null } as object } });
        await audit({ workspaceId, actorId: decision.decidedById, actorType: 'USER', action: 'approval.executed', resourceType: 'approval', resourceId: approval.id, metadata: { toolId: pending.toolId, invocationStatus: invocation?.status, taskId } });
        await publishRealtime({ type: 'approval.updated', workspaceId, approvalId: approval.id, status: 'EXECUTED', taskId });
      }
    }
  } else {
    const decision = approval.decisions[0];
    const verb = approval.status === 'REJECTED' ? 'rejected' : approval.status === 'CHANGES_REQUESTED' ? 'returned with change requests' : approval.status.toLowerCase();
    await prisma.toolInvocation.update({ where: { id: pending.invocationId }, data: { status: 'DENIED', errorMessage: `Reviewer ${verb}${decision?.comment ? `: ${decision.comment}` : ''}`, completedAt: new Date() } });
    block = {
      type: 'tool_result',
      toolUseId: pending.toolUseId,
      content: `The reviewer ${verb} this action.${decision?.comment ? ` Reviewer comment: "${decision.comment}".` : ''} ${approval.status === 'CHANGES_REQUESTED' ? 'You may propose a revised action that addresses the comment (it will require a new approval).' : 'Do not retry this action. Continue with the remaining work and report the outcome.'}`,
      isError: approval.status === 'REJECTED',
    };
  }

  const collected = [...pending.collected, block];
  const remaining = pending.remaining;
  state.pending = null;
  // execute any tool calls that followed the paused one in the same model turn
  for (let i = 0; i < remaining.length; i++) {
    const call = remaining[i]!;
    const outcome = await handleToolCall(call, ctx, base, { id: executionId, attempt: ctx.task.attempt }, state, signal);
    if (outcome.kind === 'result') collected.push(outcome.block);
    else {
      state.pending = { invocationId: outcome.invocationId, approvalId: outcome.approvalId, toolUseId: call.id, toolId: call.name, input: call.input, collected, remaining: remaining.slice(i + 1) };
      await prisma.agentExecution.update({ where: { id: executionId }, data: { state: state as unknown as object, status: 'WAITING_APPROVAL' } });
      await transitionTask(taskId, 'WAITING_APPROVAL', { progressMessage: `Waiting for approval: ${TOOL_CATALOG[call.name]?.name ?? call.name}` });
      return 'paused';
    }
  }
  state.messages.push({ role: 'user', content: collected });
  return 'continue';
}

async function finishTask(taskId: string, ctx: ExecutionContextData, execution: { id: string; attempt: number }, state: ExecState, finalContent: ProviderContent[], startedAt: number): Promise<ExecuteOutcome> {
  const workspaceId = ctx.task.workspaceId;
  const text = textOf(finalContent) || '(The agent finished without a final message.)';
  const artifacts = await prisma.artifact.count({ where: { taskId, deletedAt: null } });
  const task = await prisma.agentTask.findUniqueOrThrow({ where: { id: taskId }, select: { startedAt: true, createdById: true, title: true, conversationId: true, workflowExecutionId: true, workflowNodeExecutionId: true } });
  const durationMs = task.startedAt ? Date.now() - task.startedAt.getTime() : Date.now() - startedAt;
  await prisma.agentExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', completedAt: new Date(), state: state as unknown as object } });
  await transitionTask(taskId, 'COMPLETED', { progress: 100, progressMessage: 'Completed', resultContent: text, resultSummary: text.slice(0, 300), completedAt: new Date(), durationMs, errorMessage: null, failureClass: null });
  await recordEvent({ taskId, workspaceId, executionId: execution.id, type: 'TASK_COMPLETED', level: 'SUCCESS', message: `Task completed with ${artifacts} artifact(s) after ${state.iteration} model step(s) and ${state.toolCalls} tool call(s)`, metadata: { artifacts, iterations: state.iteration, toolCalls: state.toolCalls }, durationMs });
  await setAgentStatus(ctx.task.agentId, 'ONLINE', { touch: true });
  await refreshAgentStatus(ctx.task.agentId);
  if (task.createdById) await notifyUser({ workspaceId, userId: task.createdById, type: 'TASK_COMPLETED', title: 'Task completed', body: `${ctx.task.agent.name} completed "${task.title}"`, link: `/tasks/${taskId}` });
  if (task.conversationId) {
    const msg = await prisma.conversationMessage.create({ data: { conversationId: task.conversationId, role: 'AGENT', kind: 'EXECUTION', content: text, taskId, status: 'COMPLETE', metadata: { status: 'COMPLETED', artifacts } } });
    await publishRealtime({ type: 'message.created', workspaceId, conversationId: task.conversationId, message: { id: msg.id, conversationId: msg.conversationId, role: 'AGENT', kind: 'EXECUTION', content: msg.content, metadata: msg.metadata as Record<string, unknown>, taskId, status: 'COMPLETE', usage: null, createdAt: msg.createdAt.toISOString() } });
  }
  if (task.workflowExecutionId) await enqueueWorkflowAdvance(task.workflowExecutionId, task.workflowNodeExecutionId ?? undefined);
  return 'completed';
}

async function handleFailure(taskId: string, execution: { id: string; attempt: number }, err: unknown, cancelled: boolean, ctx: ExecutionContextData | null, startedAt: number): Promise<ExecuteOutcome> {
  const task = await prisma.agentTask.findUniqueOrThrow({ where: { id: taskId }, select: { workspaceId: true, agentId: true, createdById: true, title: true, maxAttempts: true, priority: true, startedAt: true, conversationId: true, workflowExecutionId: true, workflowNodeExecutionId: true, status: true } });
  const failure: FailureClass = cancelled ? 'CANCELLED' : classifyError(err);
  const message = (err as Error)?.message ?? String(err);
  const durationMs = task.startedAt ? Date.now() - task.startedAt.getTime() : Date.now() - startedAt;
  logger.warn({ taskId, failure, err: message }, 'task execution failed');

  if (task.status !== 'RUNNING') {
    // e.g. already cancelled by API; just close the execution record
    await prisma.agentExecution.update({ where: { id: execution.id }, data: { status: 'FAILED', errorMessage: message, failureClass: failure, completedAt: new Date() } }).catch(() => undefined);
    return 'failed';
  }

  const policy = { ...DEFAULT_RETRY_POLICY, maxAttempts: task.maxAttempts };
  const retry = !cancelled && shouldRetry(policy, execution.attempt, failure);
  const terminal: TaskStatus = cancelled ? 'CANCELLED' : failure === 'TIMEOUT' ? 'TIMED_OUT' : 'FAILED';

  await prisma.agentExecution.update({ where: { id: execution.id }, data: { status: cancelled ? 'CANCELLED' : failure === 'TIMEOUT' ? 'TIMED_OUT' : 'FAILED', errorMessage: message, failureClass: failure, completedAt: new Date() } });
  await prisma.toolInvocation.updateMany({ where: { executionId: execution.id, status: { in: ['REQUESTED', 'AUTHORIZED'] } }, data: { status: 'CANCELLED', completedAt: new Date() } });

  if (retry) {
    const delayMs = computeBackoffMs(policy, execution.attempt);
    await recordEvent({ taskId, workspaceId: task.workspaceId, executionId: execution.id, type: 'RETRY_PERFORMED', level: 'WARNING', message: `Attempt ${execution.attempt} failed (${failure.toLowerCase()}): ${message}. Retrying in ${Math.round(delayMs / 1000)}s`, metadata: { failureClass: failure, attempt: execution.attempt, maxAttempts: task.maxAttempts, delayMs }, diagnostics: { stack: (err as Error)?.stack?.slice(0, 3000) } });
    await transitionTask(taskId, 'QUEUED', { errorMessage: message, failureClass: failure, progressMessage: `Retry scheduled (attempt ${execution.attempt + 1} of ${task.maxAttempts})` });
    await enqueueAgentTask(taskId, { priority: task.priority, attempt: execution.attempt + 1, delayMs });
    await refreshAgentStatus(task.agentId);
    return 'requeued';
  }

  await transitionTask(taskId, terminal, { errorMessage: message, failureClass: failure, completedAt: new Date(), durationMs, progressMessage: terminal === 'CANCELLED' ? 'Cancelled' : terminal === 'TIMED_OUT' ? 'Timed out' : 'Failed' });
  await recordEvent({ taskId, workspaceId: task.workspaceId, executionId: execution.id, type: terminal === 'CANCELLED' ? 'TASK_CANCELLED' : terminal === 'TIMED_OUT' ? 'TASK_TIMED_OUT' : 'TASK_FAILED', level: 'ERROR', message: terminal === 'CANCELLED' ? 'Task cancelled by user' : `Task ${terminal === 'TIMED_OUT' ? 'timed out' : 'failed'} (${failure.toLowerCase()}): ${message}`, metadata: { failureClass: failure, attempt: execution.attempt, maxAttempts: task.maxAttempts, retriesExhausted: !cancelled && failure !== 'PERMANENT' && failure !== 'BUDGET' && failure !== 'PERMISSION' }, diagnostics: { stack: (err as Error)?.stack?.slice(0, 3000) }, durationMs });
  await prisma.approvalRequest.updateMany({ where: { taskId, status: 'PENDING' }, data: { status: 'SUPERSEDED' } });
  await setAgentStatus(task.agentId, 'ONLINE', { lastError: terminal === 'CANCELLED' ? null : message.slice(0, 500), touch: true });
  await refreshAgentStatus(task.agentId);
  if (task.createdById && terminal !== 'CANCELLED') await notifyUser({ workspaceId: task.workspaceId, userId: task.createdById, type: 'TASK_FAILED', title: terminal === 'TIMED_OUT' ? 'Task timed out' : 'Task failed', body: `${ctx?.task.agent.name ?? 'Agent'}: "${task.title}" — ${message.slice(0, 160)}`, link: `/tasks/${taskId}` });
  if (task.conversationId) {
    const msg = await prisma.conversationMessage.create({ data: { conversationId: task.conversationId, role: 'AGENT', kind: 'ERROR', content: `Task ${terminal.toLowerCase().replace('_', ' ')}: ${message}`, taskId, status: 'FAILED', metadata: { status: terminal, failureClass: failure } } });
    await publishRealtime({ type: 'message.created', workspaceId: task.workspaceId, conversationId: task.conversationId, message: { id: msg.id, conversationId: msg.conversationId, role: 'AGENT', kind: 'ERROR', content: msg.content, metadata: msg.metadata as Record<string, unknown>, taskId, status: 'FAILED', usage: null, createdAt: msg.createdAt.toISOString() } });
  }
  if (task.workflowExecutionId) await enqueueWorkflowAdvance(task.workflowExecutionId, task.workflowNodeExecutionId ?? undefined);
  return terminal === 'CANCELLED' ? 'cancelled' : 'failed';
}
