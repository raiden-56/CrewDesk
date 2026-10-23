import { estimateCostUsd, evaluateBudget, sumUsage, type BudgetEvaluation } from '@collabspace/shared';
import { prisma } from '../db.js';

export interface RecordUsageInput {
  workspaceId: string;
  projectId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
  executionId?: string | null;
  conversationId?: string | null;
  kind: 'MODEL' | 'TOOL' | 'EMBEDDING';
  provider: string;
  model: string;
  toolId?: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  usageAvailable: boolean;
  durationMs: number;
  success: boolean;
  isRetry?: boolean;
}

export async function recordUsage(input: RecordUsageInput) {
  const estimatedCostUsd = input.kind === 'MODEL' ? estimateCostUsd(input.model, input.inputTokens, input.outputTokens) : 0;
  return prisma.usageRecord.create({
    data: {
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      agentId: input.agentId ?? null,
      taskId: input.taskId ?? null,
      executionId: input.executionId ?? null,
      conversationId: input.conversationId ?? null,
      kind: input.kind,
      provider: input.provider,
      model: input.model,
      toolId: input.toolId ?? null,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      estimatedCostUsd,
      usageAvailable: input.usageAvailable,
      durationMs: input.durationMs,
      success: input.success,
      isRetry: input.isRetry ?? false,
    },
  });
}

export async function taskUsageTotals(taskId: string) {
  const records = await prisma.usageRecord.findMany({ where: { taskId, kind: 'MODEL' }, select: { inputTokens: true, outputTokens: true, estimatedCostUsd: true } });
  const toolInvocations = await prisma.usageRecord.count({ where: { taskId, kind: 'TOOL' } });
  return { ...sumUsage(records), toolInvocations };
}

function periodStart(period: 'DAILY' | 'MONTHLY' | 'TOTAL'): Date | null {
  const now = new Date();
  if (period === 'DAILY') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === 'MONTHLY') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return null;
}

export interface BudgetCheckResult {
  state: 'OK' | 'WARNING' | 'EXCEEDED';
  message: string;
  evaluations: Array<{ scope: string; evaluation: BudgetEvaluation }>;
}

/**
 * Evaluate every budget that applies to a task: the task's own budget, the agent's
 * configured budget/token cap, and workspace budget policies (workspace/agent/project).
 */
export async function checkBudgets(opts: {
  workspaceId: string;
  agentId: string;
  projectId: string | null;
  taskId: string;
  taskBudgetUsd: number | null;
  maxTokensPerTask: number | null;
  agentBudgetUsd: number | null;
}): Promise<BudgetCheckResult> {
  const evaluations: BudgetCheckResult['evaluations'] = [];
  const task = await taskUsageTotals(opts.taskId);
  if (opts.taskBudgetUsd !== null || opts.maxTokensPerTask !== null) {
    evaluations.push({ scope: 'task', evaluation: evaluateBudget({ hardLimitUsd: opts.taskBudgetUsd, warningRatio: 0.8, maxTokens: opts.maxTokensPerTask }, task) });
  }
  if (opts.agentBudgetUsd !== null) {
    const records = await prisma.usageRecord.findMany({ where: { agentId: opts.agentId, kind: 'MODEL' }, select: { inputTokens: true, outputTokens: true, estimatedCostUsd: true } });
    evaluations.push({ scope: 'agent', evaluation: evaluateBudget({ hardLimitUsd: opts.agentBudgetUsd, warningRatio: 0.8 }, sumUsage(records)) });
  }
  const policies = await prisma.budgetPolicy.findMany({ where: { workspaceId: opts.workspaceId, enabled: true } });
  for (const p of policies) {
    if (p.scope === 'AGENT' && p.scopeId !== opts.agentId) continue;
    if (p.scope === 'PROJECT' && p.scopeId !== opts.projectId) continue;
    const from = periodStart(p.period);
    const where = {
      workspaceId: opts.workspaceId,
      kind: 'MODEL' as const,
      ...(p.scope === 'AGENT' ? { agentId: opts.agentId } : {}),
      ...(p.scope === 'PROJECT' ? { projectId: opts.projectId } : {}),
      ...(from ? { createdAt: { gte: from } } : {}),
    };
    const records = await prisma.usageRecord.findMany({ where, select: { inputTokens: true, outputTokens: true, estimatedCostUsd: true } });
    evaluations.push({ scope: `${p.scope.toLowerCase()}:${p.period.toLowerCase()}`, evaluation: evaluateBudget({ hardLimitUsd: p.hardLimitUsd, warningRatio: p.warningRatio, maxTokens: p.maxTokens }, sumUsage(records)) });
  }
  const exceeded = evaluations.find((e) => e.evaluation.state === 'EXCEEDED');
  if (exceeded) return { state: 'EXCEEDED', message: `${exceeded.scope} budget exceeded: ${exceeded.evaluation.message}`, evaluations };
  const warning = evaluations.find((e) => e.evaluation.state === 'WARNING');
  if (warning) return { state: 'WARNING', message: `${warning.scope} budget warning: ${warning.evaluation.message}`, evaluations };
  return { state: 'OK', message: 'Within budget', evaluations };
}
