import { evaluateBudget, sumUsage, type DashboardMetricsDto, type UsageSummaryDto } from '@collabspace/shared';
import { providerStatus } from '../ai/index.js';
import { prisma } from '../db.js';

function periodRange(period: '24h' | '7d' | '30d'): { from: Date; to: Date; label: string; buckets: number; bucketMs: number } {
  const to = new Date();
  if (period === '24h') return { from: new Date(to.getTime() - 24 * 3600 * 1000), to, label: 'Last 24 hours', buckets: 24, bucketMs: 3600 * 1000 };
  if (period === '30d') return { from: new Date(to.getTime() - 30 * 24 * 3600 * 1000), to, label: 'Last 30 days', buckets: 30, bucketMs: 24 * 3600 * 1000 };
  return { from: new Date(to.getTime() - 7 * 24 * 3600 * 1000), to, label: 'Last 7 days', buckets: 7, bucketMs: 24 * 3600 * 1000 };
}

/** Dashboard metrics computed from live records. Rates/usage use the stated window; counts are current. */
export async function dashboardMetrics(workspaceId: string, period: '24h' | '7d' | '30d' = '7d'): Promise<DashboardMetricsDto> {
  const range = periodRange(period);
  const [agents, activeAgents, statusCounts, windowTasks, usage] = await Promise.all([
    prisma.agent.count({ where: { workspaceId, archivedAt: null } }),
    prisma.agent.count({ where: { workspaceId, archivedAt: null, status: { in: ['ONLINE', 'WORKING', 'IDLE'] } } }),
    prisma.agentTask.groupBy({ by: ['status'], where: { workspaceId }, _count: { _all: true } }),
    prisma.agentTask.findMany({ where: { workspaceId, createdAt: { gte: range.from } }, select: { status: true, createdAt: true, completedAt: true } }),
    prisma.usageRecord.findMany({ where: { workspaceId, kind: 'MODEL', createdAt: { gte: range.from } }, select: { inputTokens: true, outputTokens: true, estimatedCostUsd: true } }),
  ]);
  const count = (s: string) => statusCounts.find((r) => r.status === s)?._count._all ?? 0;
  const finished = windowTasks.filter((t) => ['COMPLETED', 'FAILED', 'TIMED_OUT'].includes(t.status));
  const successRate = finished.length ? finished.filter((t) => t.status === 'COMPLETED').length / finished.length : null;
  const labels: string[] = [];
  const created = new Array<number>(range.buckets).fill(0);
  const completed = new Array<number>(range.buckets).fill(0);
  const failed = new Array<number>(range.buckets).fill(0);
  for (let i = 0; i < range.buckets; i++) {
    const d = new Date(range.from.getTime() + i * range.bucketMs);
    labels.push(period === '24h' ? `${d.getUTCHours()}:00` : d.toISOString().slice(5, 10));
  }
  const bucketOf = (d: Date) => Math.min(range.buckets - 1, Math.max(0, Math.floor((d.getTime() - range.from.getTime()) / range.bucketMs)));
  for (const t of windowTasks) {
    created[bucketOf(t.createdAt)]! += 1;
    if (t.status === 'COMPLETED' && t.completedAt) completed[bucketOf(t.completedAt)]! += 1;
    if ((t.status === 'FAILED' || t.status === 'TIMED_OUT') && t.completedAt) failed[bucketOf(t.completedAt)]! += 1;
  }
  const totals = sumUsage(usage);
  const provider = providerStatus();
  return {
    window: { label: range.label, from: range.from.toISOString(), to: range.to.toISOString() },
    totalAgents: agents,
    activeAgents,
    totalTasks: statusCounts.reduce((n, r) => n + r._count._all, 0),
    runningTasks: count('RUNNING'),
    queuedTasks: count('QUEUED'),
    completedTasks: count('COMPLETED'),
    awaitingApproval: count('WAITING_APPROVAL'),
    failedTasks: count('FAILED') + count('TIMED_OUT'),
    successRate,
    usage: { inputTokens: totals.inputTokens, outputTokens: totals.outputTokens, estimatedCostUsd: totals.estimatedCostUsd, requests: totals.requests, hasUnavailable: totals.hasUnavailable },
    trends: { tasksCreated: created, tasksCompleted: completed, tasksFailed: failed, labels },
    aiProvider: { configured: provider.configured, provider: provider.provider, model: provider.defaultModel, isMock: provider.isMock },
  };
}

export async function usageSummary(workspaceId: string, opts: { period: '24h' | '7d' | '30d'; projectId?: string; agentId?: string }): Promise<UsageSummaryDto> {
  const range = periodRange(opts.period);
  const where = { workspaceId, createdAt: { gte: range.from }, ...(opts.projectId ? { projectId: opts.projectId } : {}), ...(opts.agentId ? { agentId: opts.agentId } : {}) };
  const records = await prisma.usageRecord.findMany({ where, include: { agent: { select: { id: true, name: true, color: true } }, project: { select: { id: true, name: true } } } });
  const model = records.filter((r) => r.kind === 'MODEL');
  const tools = records.filter((r) => r.kind === 'TOOL');
  const totals = sumUsage(model);
  const daily = new Map<string, UsageSummaryDto['daily'][number]>();
  for (const r of model) {
    const key = opts.period === '24h' ? r.createdAt.toISOString().slice(0, 13) + ':00' : r.createdAt.toISOString().slice(0, 10);
    const d = daily.get(key) ?? { date: key, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, requests: 0, failed: 0 };
    d.inputTokens += r.inputTokens ?? 0;
    d.outputTokens += r.outputTokens ?? 0;
    d.estimatedCostUsd += r.estimatedCostUsd ?? 0;
    d.requests += 1;
    if (!r.success) d.failed += 1;
    daily.set(key, d);
  }
  const byAgent = new Map<string, UsageSummaryDto['byAgent'][number]>();
  const taskSets = new Map<string, Set<string>>();
  for (const r of model) {
    if (!r.agent) continue;
    const a = byAgent.get(r.agent.id) ?? { agentId: r.agent.id, name: r.agent.name, color: r.agent.color, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, requests: 0, tasks: 0 };
    a.inputTokens += r.inputTokens ?? 0;
    a.outputTokens += r.outputTokens ?? 0;
    a.estimatedCostUsd += r.estimatedCostUsd ?? 0;
    a.requests += 1;
    if (r.taskId) {
      const set = taskSets.get(r.agent.id) ?? new Set<string>();
      set.add(r.taskId);
      taskSets.set(r.agent.id, set);
    }
    byAgent.set(r.agent.id, a);
  }
  for (const [id, a] of byAgent) a.tasks = taskSets.get(id)?.size ?? 0;
  const byProject = new Map<string, UsageSummaryDto['byProject'][number]>();
  for (const r of model) {
    const key = r.projectId ?? 'none';
    const p = byProject.get(key) ?? { projectId: r.projectId, name: r.project?.name ?? 'No project', inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, requests: 0 };
    p.inputTokens += r.inputTokens ?? 0;
    p.outputTokens += r.outputTokens ?? 0;
    p.estimatedCostUsd += r.estimatedCostUsd ?? 0;
    p.requests += 1;
    byProject.set(key, p);
  }
  const byModel = new Map<string, UsageSummaryDto['byModel'][number]>();
  for (const r of model) {
    const m = byModel.get(r.model) ?? { model: r.model, requests: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
    m.requests += 1;
    m.inputTokens += r.inputTokens ?? 0;
    m.outputTokens += r.outputTokens ?? 0;
    m.estimatedCostUsd += r.estimatedCostUsd ?? 0;
    byModel.set(r.model, m);
  }
  const policies = await prisma.budgetPolicy.findMany({ where: { workspaceId } });
  const budgets: UsageSummaryDto['budgets'] = [];
  for (const p of policies) {
    const from = p.period === 'DAILY' ? new Date(new Date().toISOString().slice(0, 10)) : p.period === 'MONTHLY' ? new Date(new Date().toISOString().slice(0, 7) + '-01') : null;
    const rows = await prisma.usageRecord.findMany({ where: { workspaceId, kind: 'MODEL', ...(p.scope === 'AGENT' ? { agentId: p.scopeId ?? '' } : {}), ...(p.scope === 'PROJECT' ? { projectId: p.scopeId ?? '' } : {}), ...(from ? { createdAt: { gte: from } } : {}) }, select: { inputTokens: true, outputTokens: true, estimatedCostUsd: true } });
    const ev = evaluateBudget({ hardLimitUsd: p.hardLimitUsd, warningRatio: p.warningRatio, maxTokens: p.maxTokens }, sumUsage(rows));
    let scopeName = 'Workspace';
    if (p.scope === 'AGENT') scopeName = (await prisma.agent.findUnique({ where: { id: p.scopeId ?? '' }, select: { name: true } }))?.name ?? 'Unknown agent';
    if (p.scope === 'PROJECT') scopeName = (await prisma.project.findUnique({ where: { id: p.scopeId ?? '' }, select: { name: true } }))?.name ?? 'Unknown project';
    budgets.push({ id: p.id, scope: p.scope, scopeId: p.scopeId, scopeName, period: p.period, hardLimitUsd: p.hardLimitUsd, warningRatio: p.warningRatio, usedUsd: ev.usedUsd, state: ev.state, enabled: p.enabled });
  }
  return {
    period: { label: range.label, from: range.from.toISOString(), to: range.to.toISOString() },
    totals: { inputTokens: totals.inputTokens, outputTokens: totals.outputTokens, requests: model.length, toolInvocations: tools.length, durationMs: records.reduce((n, r) => n + r.durationMs, 0), estimatedCostUsd: totals.estimatedCostUsd, failed: model.filter((r) => !r.success).length, retries: model.filter((r) => r.isRetry).length, hasUnavailable: totals.hasUnavailable },
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byAgent: [...byAgent.values()].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd),
    byProject: [...byProject.values()].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd),
    byModel: [...byModel.values()].sort((a, b) => b.requests - a.requests),
    budgets,
  };
}
