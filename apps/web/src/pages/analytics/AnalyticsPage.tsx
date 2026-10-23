import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { MenuItem, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, BarChart3, CheckCircle2, Table2, XCircle } from 'lucide-react';
import type { UsageSummaryDto } from '@collabspace/shared';
import { useAgents, useProjects, useUsage } from '@/lib/queries';
import { useCan } from '@/store/auth';
import { PageHeader } from '@/components/common/PageHeader';
import { DashboardTabs } from '@/components/common/DashboardTabs';
import { EmptyState, ErrorState, InlineRefreshing } from '@/components/common/States';
import { ShimmerDashboard } from '@/components/shimmer';
import { chartSeries, statusSeries } from '@/theme/tokens';
import { dateTime, duration, tokens, usd } from '@/lib/format';

type Period = '24h' | '7d' | '30d';
const TOOLTIP_STYLE = { background: 'var(--cs-surface)', border: '1px solid var(--cs-border)', borderRadius: 8, fontSize: 12, color: 'var(--cs-text)' };
const AXIS_TICK = { fontSize: 11, fill: 'var(--cs-text-3)' };

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="cs-card p-4">
      <div className="cs-label">{label}</div>
      <div className="text-[22px] font-semibold tracking-tight mt-1">{value}</div>
      {hint && <div className="text-[11.5px] text-text-3 mt-0.5">{hint}</div>}
    </div>
  );
}

function BudgetMeter({ b }: { b: UsageSummaryDto['budgets'][number] }) {
  const ratio = b.hardLimitUsd ? Math.min(1, b.usedUsd / b.hardLimitUsd) : 0;
  const color = b.state === 'EXCEEDED' ? statusSeries.critical : b.state === 'WARNING' ? statusSeries.warning : statusSeries.good;
  const Icon = b.state === 'EXCEEDED' ? XCircle : b.state === 'WARNING' ? AlertTriangle : CheckCircle2;
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-[12.5px]">
        <span className="font-medium truncate">{b.scopeName} · {b.period.toLowerCase()}</span>
        <span className="inline-flex items-center gap-1 text-text-2"><Icon size={13} style={{ color }} />{b.state === 'OK' ? 'within budget' : b.state === 'WARNING' ? 'near limit' : 'exceeded'}</span>
      </div>
      <div className="h-1.5 rounded-full bg-surface-3 mt-2 overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={b.hardLimitUsd ?? 0} aria-valuenow={b.usedUsd} aria-label={`${b.scopeName} budget`}>
        <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: color }} />
      </div>
      <div className="text-[11.5px] text-text-3 mt-1">{usd(b.usedUsd, { estimate: true })} of {b.hardLimitUsd !== null ? usd(b.hardLimitUsd) : 'no hard limit'} · warns at {Math.round(b.warningRatio * 100)}%{b.enabled ? '' : ' · disabled'}</div>
    </div>
  );
}

export function AnalyticsPage() {
  const canUsage = useCan('usage.view');
  const [period, setPeriod] = useState<Period>('7d');
  const [projectId, setProjectId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [asTable, setAsTable] = useState(false);
  const usage = useUsage({ period, projectId: projectId || undefined, agentId: agentId || undefined });
  const projects = useProjects();
  const agents = useAgents();
  const u = usage.data;

  const daily = useMemo(() => (u?.daily ?? []).map((d) => ({ ...d, label: dateTime(d.date, period === '24h' ? 'HH:mm' : 'MMM d'), cost: Number(d.estimatedCostUsd.toFixed(4)) })), [u, period]);
  // Agents beyond the categorical palette fold into "Other" rather than generating new hues.
  const byAgent = useMemo(() => {
    const rows = [...(u?.byAgent ?? [])].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
    const top = rows.slice(0, 8).map((r) => ({ name: r.name, cost: Number(r.estimatedCostUsd.toFixed(4)), tasks: r.tasks, tokens: r.inputTokens + r.outputTokens }));
    const rest = rows.slice(8);
    if (rest.length) top.push({ name: `Other (${rest.length})`, cost: Number(rest.reduce((s, r) => s + r.estimatedCostUsd, 0).toFixed(4)), tasks: rest.reduce((s, r) => s + r.tasks, 0), tokens: rest.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0) });
    return top;
  }, [u]);

  if (!canUsage) return <div><PageHeader title="Analytics" tabs={<DashboardTabs />} /><div className="cs-card"><EmptyState icon={BarChart3} title="Usage analytics are not available for your role" /></div></div>;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Usage & Cost Analytics"
        subtitle={<span className="inline-flex items-center gap-2">{u ? `${u.period.label} · costs are estimates from published model prices` : 'Usage, cost estimates and budgets'} <InlineRefreshing active={usage.isFetching && !usage.isPending} /></span>}
        actions={
          <ToggleButtonGroup size="small" exclusive value={period} onChange={(_, v) => v && setPeriod(v)} aria-label="Time window">
            <ToggleButton value="24h">24h</ToggleButton>
            <ToggleButton value="7d">7d</ToggleButton>
            <ToggleButton value="30d">30d</ToggleButton>
          </ToggleButtonGroup>
        }
        tabs={<DashboardTabs />}
      />
      <div className="flex flex-wrap items-center gap-2">
        <TextField size="small" select label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} sx={{ minWidth: 170 }}>
          <MenuItem value="">All projects</MenuItem>
          {(projects.data?.items ?? []).map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Agent" value={agentId} onChange={(e) => setAgentId(e.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value="">All agents</MenuItem>
          {(agents.data?.items ?? []).map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
        </TextField>
        <div className="flex-1" />
        <ToggleButtonGroup size="small" exclusive value={asTable ? 'table' : 'chart'} onChange={(_, v) => v && setAsTable(v === 'table')} aria-label="Display">
          <ToggleButton value="chart" aria-label="Charts"><BarChart3 size={14} /></ToggleButton>
          <ToggleButton value="table" aria-label="Tables"><Table2 size={14} /></ToggleButton>
        </ToggleButtonGroup>
      </div>

      {usage.isPending && <ShimmerDashboard />}
      {usage.isError && <div className="cs-card"><ErrorState error={usage.error} onRetry={() => usage.refetch()} /></div>}
      {u && (
        <>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6" data-testid="usage-totals">
            <Tile label="Est. cost" value={usd(u.totals.estimatedCostUsd, { estimate: true })} hint={u.totals.hasUnavailable ? 'some requests had no usage data' : undefined} />
            <Tile label="Input tokens" value={tokens(u.totals.inputTokens)} />
            <Tile label="Output tokens" value={tokens(u.totals.outputTokens)} />
            <Tile label="Model requests" value={String(u.totals.requests)} hint={`${u.totals.retries} retries`} />
            <Tile label="Tool calls" value={String(u.totals.toolInvocations)} />
            <Tile label="Failures" value={String(u.totals.failed)} hint={`compute ${duration(u.totals.durationMs)}`} />
          </div>

          {asTable ? (
            <div className="cs-card overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead><tr className="bg-surface-2 border-b border-border">{['Date', 'Input tokens', 'Output tokens', 'Requests', 'Failed', 'Est. cost'].map((h) => <th key={h} className="px-3 py-2 cs-label">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">
                  {daily.map((d) => (
                    <tr key={d.date}><td className="px-3 py-2">{d.label}</td><td className="px-3 py-2">{tokens(d.inputTokens)}</td><td className="px-3 py-2">{tokens(d.outputTokens)}</td><td className="px-3 py-2">{d.requests}</td><td className="px-3 py-2">{d.failed}</td><td className="px-3 py-2">{usd(d.estimatedCostUsd, { estimate: true })}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
              <section className="cs-card p-4" aria-label="Estimated cost over time">
                <h2 className="text-[14px] font-semibold mb-2">Estimated cost (USD)</h2>
                {daily.length === 0 ? <EmptyState title="No usage in this window" compact /> : (
                  <div style={{ height: 240 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={daily} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--cs-border)" vertical={false} />
                        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${v}`} />
                        <ChartTooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [usd(Number(v), { estimate: true }), 'Est. cost']} />
                        <Line type="monotone" dataKey="cost" name="Est. cost" stroke={chartSeries[0]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5, stroke: 'var(--cs-surface)', strokeWidth: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>
              <section className="cs-card p-4" aria-label="Tokens over time">
                <h2 className="text-[14px] font-semibold mb-2">Tokens</h2>
                {daily.length === 0 ? <EmptyState title="No usage in this window" compact /> : (
                  <div style={{ height: 240 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={daily} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--cs-border)" vertical={false} />
                        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => tokens(v)} />
                        <ChartTooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => [tokens(Number(v)), name]} cursor={{ fill: 'var(--cs-surface-3)' }} />
                        <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span style={{ color: 'var(--cs-text-2)' }}>{value}</span>} />
                        <Bar dataKey="inputTokens" name="Input" stackId="t" fill={chartSeries[0]} stroke="var(--cs-surface)" strokeWidth={2} />
                        <Bar dataKey="outputTokens" name="Output" stackId="t" fill={chartSeries[1]} stroke="var(--cs-surface)" strokeWidth={2} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </section>
            </div>
          )}

          <div className="grid gap-4 grid-cols-1 xl:grid-cols-[1.3fr_1fr]">
            <section className="cs-card p-4" aria-label="Cost by agent">
              <h2 className="text-[14px] font-semibold mb-2">Estimated cost by agent</h2>
              {byAgent.length === 0 ? <EmptyState title="No agent usage yet" compact /> : asTable ? (
                <table className="w-full text-left text-[13px]">
                  <thead><tr className="border-b border-border">{['Agent', 'Tasks', 'Tokens', 'Est. cost'].map((h) => <th key={h} className="py-1.5 cs-label">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-border">{byAgent.map((r) => <tr key={r.name}><td className="py-1.5">{r.name}</td><td className="py-1.5">{r.tasks}</td><td className="py-1.5">{tokens(r.tokens)}</td><td className="py-1.5">{usd(r.cost, { estimate: true })}</td></tr>)}</tbody>
                </table>
              ) : (
                <div style={{ height: Math.max(160, byAgent.length * 36 + 30) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byAgent} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--cs-border)" horizontal={false} />
                      <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${v}`} />
                      <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fill: 'var(--cs-text-2)' }} tickLine={false} axisLine={false} width={110} />
                      <ChartTooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--cs-surface-3)' }} formatter={(v) => [usd(Number(v), { estimate: true }), 'Est. cost']} />
                      <Bar dataKey="cost" name="Est. cost" fill={chartSeries[0]} radius={[0, 4, 4, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
            <section className="cs-card p-4 flex flex-col gap-2" aria-label="Budgets">
              <div className="flex items-center justify-between"><h2 className="text-[14px] font-semibold">Budgets</h2><Link to="/settings/budgets" className="text-[12.5px] text-accent hover:underline">Manage</Link></div>
              {u.budgets.length === 0 && <EmptyState title="No budget policies" description="Set workspace, project or agent spending limits in Settings." compact />}
              {u.budgets.map((b) => <BudgetMeter key={b.id} b={b} />)}
            </section>
          </div>

          <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
            <section className="cs-card overflow-x-auto" aria-label="Usage by model">
              <h2 className="text-[14px] font-semibold px-4 pt-3 pb-2">By model</h2>
              <table className="w-full text-left text-[13px]">
                <thead><tr className="bg-surface-2 border-y border-border">{['Model', 'Requests', 'Input', 'Output', 'Est. cost'].map((h) => <th key={h} className="px-4 py-2 cs-label">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">
                  {u.byModel.map((m) => <tr key={m.model}><td className="px-4 py-2 font-medium">{m.model}</td><td className="px-4 py-2">{m.requests}</td><td className="px-4 py-2">{tokens(m.inputTokens)}</td><td className="px-4 py-2">{tokens(m.outputTokens)}</td><td className="px-4 py-2">{usd(m.estimatedCostUsd, { estimate: true })}</td></tr>)}
                  {u.byModel.length === 0 && <tr><td colSpan={5} className="px-4 py-4 text-center text-text-3">No model requests</td></tr>}
                </tbody>
              </table>
            </section>
            <section className="cs-card overflow-x-auto" aria-label="Usage by project">
              <h2 className="text-[14px] font-semibold px-4 pt-3 pb-2">By project</h2>
              <table className="w-full text-left text-[13px]">
                <thead><tr className="bg-surface-2 border-y border-border">{['Project', 'Requests', 'Tokens', 'Est. cost'].map((h) => <th key={h} className="px-4 py-2 cs-label">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">
                  {u.byProject.map((p) => <tr key={p.projectId ?? 'none'}><td className="px-4 py-2 font-medium">{p.name}</td><td className="px-4 py-2">{p.requests}</td><td className="px-4 py-2">{tokens(p.inputTokens + p.outputTokens)}</td><td className="px-4 py-2">{usd(p.estimatedCostUsd, { estimate: true })}</td></tr>)}
                  {u.byProject.length === 0 && <tr><td colSpan={4} className="px-4 py-4 text-center text-text-3">No project usage</td></tr>}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
