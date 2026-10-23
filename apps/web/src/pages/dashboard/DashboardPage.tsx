import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { Activity, AlertTriangle, Bot, CheckCircle2, CheckSquare, Clock, Coins, ListPlus, MessageSquare, Plus, type LucideIcon } from 'lucide-react';
import { AGENT_CATEGORY_LABELS } from '@collabspace/shared';
import { useAgentActivity, useAgents, useApprovals, useDashboard, useTasks } from '@/lib/queries';
import { useCan } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { DashboardTabs } from '@/components/common/DashboardTabs';
import { AgentAvatar } from '@/components/common/AgentAvatar';
import { StatusChip, RiskChip } from '@/components/common/StatusChip';
import { EmptyState, ErrorState, InlineRefreshing } from '@/components/common/States';
import { ShimmerDashboard, ShimmerExecutionTimeline } from '@/components/shimmer';
import { AgentCard } from '@/pages/agents/AgentCard';
import { TaskComposer } from '@/pages/tasks/TaskComposer';
import { chartSeries, statusSeries } from '@/theme/tokens';
import { pct, timeAgo, tokens, usd } from '@/lib/format';

type Period = '24h' | '7d' | '30d';

const TONES = {
  primary: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  accent: 'bg-accent-soft text-accent',
} as const;

function Metric({ label, value, hint, icon: Icon, tone = 'primary', to }: { label: string; value: string | number; hint?: string; icon: LucideIcon; tone?: keyof typeof TONES; to?: string }) {
  const inner = (
    <div className={`cs-card p-4 flex flex-col gap-1.5 h-full ${to ? 'cs-card-hover' : ''}`}>
      <div className="flex items-center justify-between">
        <span className="cs-label">{label}</span>
        <span className={`h-7 w-7 rounded-lg flex items-center justify-center ${TONES[tone]}`}><Icon size={15} /></span>
      </div>
      <div className="text-[24px] font-semibold tracking-tight leading-none">{value}</div>
      {hint && <div className="text-[11.5px] text-text-3">{hint}</div>}
    </div>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('7d');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const setWizardOpen = useUiStore((s) => s.setWizardOpen);
  const setChatAgentId = useUiStore((s) => s.setChatAgentId);
  const setChatOpen = useUiStore((s) => s.setChatOpen);
  const canCreateAgent = useCan('agent.create');
  const canCreateTask = useCan('task.create');
  const canUsage = useCan('usage.view');
  const dashboard = useDashboard(period);
  const agents = useAgents();
  const recent = useTasks({ pageSize: 8, sort: 'updatedAt', order: 'desc' });
  const approvals = useApprovals({ status: 'PENDING', pageSize: 5 });
  const agentList = useMemo(() => (agents.data?.items ?? []).filter((a) => a.status !== 'ARCHIVED'), [agents.data]);
  const selected = agentList.find((a) => a.id === selectedId) ?? agentList[0] ?? null;
  const activity = useAgentActivity(selected?.id);

  const trend = useMemo(() => {
    const t = dashboard.data?.trends;
    if (!t) return [];
    return t.labels.map((label, i) => ({ label, Created: t.tasksCreated[i] ?? 0, Completed: t.tasksCompleted[i] ?? 0, Failed: t.tasksFailed[i] ?? 0 }));
  }, [dashboard.data]);

  if (dashboard.isPending && agents.isPending) {
    return (
      <div>
        <PageHeader title="AI Team Overview" tabs={<DashboardTabs />} />
        <ShimmerDashboard />
      </div>
    );
  }

  const m = dashboard.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="AI Team Overview"
        subtitle={<span className="inline-flex items-center gap-2">{m ? `${m.window.label} · ` : ''}live status of your digital team <InlineRefreshing active={dashboard.isFetching && !dashboard.isPending} /></span>}
        actions={
          <>
            <ToggleButtonGroup size="small" exclusive value={period} onChange={(_, v) => v && setPeriod(v)} aria-label="Time window">
              <ToggleButton value="24h">24h</ToggleButton>
              <ToggleButton value="7d">7d</ToggleButton>
              <ToggleButton value="30d">30d</ToggleButton>
            </ToggleButtonGroup>
            {canCreateTask && <Button size="small" variant="outlined" startIcon={<ListPlus size={15} />} onClick={() => setAssignTo(selected?.id ?? '')}>Assign task</Button>}
          </>
        }
        tabs={<DashboardTabs />}
      />

      {dashboard.isError && !canUsage && <div className="cs-card p-3 text-[12.5px] text-text-3">Usage metrics are not available for your role.</div>}
      {dashboard.isError && canUsage && <div className="cs-card"><ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} compact /></div>}
      {m && (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6" data-testid="dashboard-metrics">
          <Metric label="Team members" value={m.totalAgents} hint={`${m.activeAgents} active`} icon={Bot} to="/team" />
          <Metric label="Running" value={m.runningTasks} hint={`${m.queuedTasks} queued`} icon={Activity} tone="info" to="/tasks?status=RUNNING" />
          <Metric label="Awaiting approval" value={m.awaitingApproval} hint="human review needed" icon={CheckSquare} tone="warning" to="/approvals" />
          <Metric label="Completed" value={m.completedTasks} hint={`success rate ${pct(m.successRate)}`} icon={CheckCircle2} tone="success" to="/tasks?status=COMPLETED" />
          <Metric label="Failed" value={m.failedTasks} hint={`${m.totalTasks} tasks in window`} icon={AlertTriangle} tone="danger" to="/tasks?status=FAILED" />
          <Metric label="Est. cost" value={usd(m.usage.estimatedCostUsd, { estimate: true })} hint={`${tokens(m.usage.inputTokens + m.usage.outputTokens)} tokens${m.usage.hasUnavailable ? ' · partial' : ''}`} icon={Coins} tone="accent" to="/analytics" />
        </div>
      )}

      <div className="grid gap-4 grid-cols-1 xl:grid-cols-[1.4fr_1fr]">
        <section className="flex flex-col gap-3" aria-label="Team members">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold">Your AI team</h2>
            <Link to="/team" className="text-[12.5px] text-accent hover:underline">View all</Link>
          </div>
          {agents.isError && <div className="cs-card"><ErrorState error={agents.error} onRetry={() => agents.refetch()} compact /></div>}
          {agents.data && agentList.length === 0 && (
            <div className="cs-card">
              <EmptyState icon={Bot} title="No team members yet" description="Create your first AI team member from a role template." action={canCreateAgent ? <Button variant="contained" size="small" startIcon={<Plus size={15} />} onClick={() => setWizardOpen(true)}>New agent</Button> : undefined} />
            </div>
          )}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            {agentList.slice(0, 6).map((a) => (
              <AgentCard key={a.id} agent={a} selected={a.id === selected?.id} onSelect={() => setSelectedId(a.id)} onAssign={() => setAssignTo(a.id)} onEdit={() => setWizardOpen(true, a.id)} />
            ))}
          </div>
        </section>

        <section className="cs-card p-4 flex flex-col gap-3 self-start" aria-label="Selected agent">
          {selected ? (
            <>
              <div className="flex items-center gap-3">
                <AgentAvatar avatar={selected.avatar} color={selected.color} name={selected.name} size={44} status={selected.status} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[15px] truncate">{selected.name}</div>
                  <div className="text-[12px] text-text-3 truncate">{AGENT_CATEGORY_LABELS[selected.category]} · v{selected.currentVersion}</div>
                </div>
                <StatusChip status={selected.status} pulse={selected.status === 'WORKING'} />
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-surface-2 border border-border py-2"><div className="text-[16px] font-semibold">{selected.stats.completedTasks}</div><div className="text-[10.5px] text-text-3">completed</div></div>
                <div className="rounded-lg bg-surface-2 border border-border py-2"><div className="text-[16px] font-semibold">{selected.stats.runningTasks}</div><div className="text-[10.5px] text-text-3">active</div></div>
                <div className="rounded-lg bg-surface-2 border border-border py-2"><div className="text-[16px] font-semibold">{selected.stats.failedTasks}</div><div className="text-[10.5px] text-text-3">failed</div></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="small" variant="outlined" onClick={() => navigate(`/team/${selected.id}`)}>Open workspace</Button>
                <Button size="small" variant="outlined" startIcon={<MessageSquare size={14} />} onClick={() => { setChatAgentId(selected.id); setChatOpen(true); }}>Chat</Button>
                {canCreateTask && selected.status !== 'ARCHIVED' && <Button size="small" variant="contained" startIcon={<ListPlus size={14} />} onClick={() => setAssignTo(selected.id)}>Assign</Button>}
              </div>
              <div>
                <div className="cs-label mb-2">Recent activity</div>
                {activity.isPending && <ShimmerExecutionTimeline steps={4} />}
                {activity.data && activity.data.items.length === 0 && <div className="text-[12.5px] text-text-3">No activity yet.</div>}
                <ol className="flex flex-col gap-2 max-h-72 overflow-y-auto">
                  {activity.data?.items.slice(0, 10).map((e) => (
                    <li key={e.id} className="text-[12.5px]">
                      <Link to={`/tasks/${e.taskId}`} className="hover:text-primary">
                        <span className={`font-medium ${e.level === 'ERROR' ? 'text-danger' : e.level === 'WARNING' ? 'text-warning' : ''}`}>{e.message}</span>
                      </Link>
                      <div className="text-[11px] text-text-3 truncate">{e.taskTitle} · {timeAgo(e.createdAt)}</div>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          ) : (
            <EmptyState icon={Bot} title="Select a team member" compact />
          )}
        </section>
      </div>

      <div className="grid gap-4 grid-cols-1 xl:grid-cols-[1.4fr_1fr]">
        <section className="cs-card p-4" aria-label="Task trend">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[14px] font-semibold">Task throughput</h2>
            <span className="text-[11.5px] text-text-3">{m?.aiProvider.isMock ? 'mock provider' : m?.aiProvider.model ?? ''}</span>
          </div>
          {trend.length > 0 ? (
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--cs-border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--cs-text-3)' }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--cs-text-3)' }} tickLine={false} axisLine={false} />
                  <ChartTooltip contentStyle={{ background: 'var(--cs-surface)', border: '1px solid var(--cs-border)', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span style={{ color: 'var(--cs-text-2)' }}>{value}</span>} />
                  <Area type="monotone" dataKey="Created" stroke={chartSeries[0]} fill={chartSeries[0]} fillOpacity={0.12} strokeWidth={2} />
                  <Area type="monotone" dataKey="Completed" stroke={statusSeries.good} fill={statusSeries.good} fillOpacity={0.12} strokeWidth={2} />
                  <Area type="monotone" dataKey="Failed" stroke={statusSeries.critical} fill={statusSeries.critical} fillOpacity={0.08} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No data in this window" compact />
          )}
        </section>

        <section className="cs-card p-4 flex flex-col gap-2" aria-label="Pending approvals">
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold">Pending approvals</h2>
            <Link to="/approvals" className="text-[12.5px] text-accent hover:underline">Approval center</Link>
          </div>
          {approvals.data && approvals.data.items.length === 0 && <EmptyState icon={CheckSquare} title="Nothing to review" description="Sensitive actions requested by agents appear here." compact />}
          {approvals.data?.items.map((a) => (
            <Link key={a.id} to={`/approvals/${a.id}`} className="rounded-lg border border-border px-3 py-2 hover:bg-surface-2 transition-colors flex items-start gap-2">
              {a.agent && <AgentAvatar avatar={a.agent.avatar} color={a.agent.color} name={a.agent.name} size={24} />}
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium truncate">{a.actionTitle}</div>
                <div className="text-[11.5px] text-text-3 truncate">{a.targetResource ?? a.task?.title ?? '—'} · {timeAgo(a.createdAt)}</div>
              </div>
              <RiskChip risk={a.risk} />
            </Link>
          ))}
        </section>
      </div>

      <section className="cs-card overflow-x-auto" aria-label="Recent tasks">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <h2 className="text-[14px] font-semibold">Recent tasks</h2>
          <Link to="/tasks" className="text-[12.5px] text-accent hover:underline">All tasks</Link>
        </div>
        {recent.data && recent.data.items.length === 0 && <EmptyState icon={Clock} title="No tasks yet" compact />}
        {recent.data && recent.data.items.length > 0 && (
          <table className="w-full text-left text-[13px]">
            <tbody className="divide-y divide-border border-t border-border">
              {recent.data.items.map((t) => (
                <tr key={t.id} className="hover:bg-surface-2/60 cursor-pointer" onClick={() => navigate(`/tasks/${t.id}`)}>
                  <td className="px-4 py-2.5 max-w-[360px]"><div className="font-medium truncate">{t.title}</div></td>
                  <td className="px-3 py-2.5 whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><AgentAvatar avatar={t.agent.avatar} color={t.agent.color} name={t.agent.name} size={20} />{t.agent.name}</span></td>
                  <td className="px-3 py-2.5"><StatusChip status={t.status} pulse={t.status === 'RUNNING'} /></td>
                  <td className="px-4 py-2.5 text-text-3 whitespace-nowrap text-right">{timeAgo(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {assignTo !== null && <TaskComposer open onClose={() => setAssignTo(null)} initial={{ agentId: assignTo || undefined }} />}
    </div>
  );
}
