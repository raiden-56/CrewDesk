import { useState } from 'react';
import { Link } from 'react-router';
import { Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Switch, Tooltip } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Wrench } from 'lucide-react';
import { useTools, type ToolWithAvailability } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { DashboardTabs } from '@/components/common/DashboardTabs';
import { RiskChip } from '@/components/common/StatusChip';
import { EmptyState, ErrorState } from '@/components/common/States';
import { ShimmerTable } from '@/components/shimmer';
import { duration } from '@/lib/format';

const DISABLED_REASON = 'Tool disabled by administrator';

export function ToolsPage() {
  const tools = useTools();
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const canManage = useCan('workspace.manage');
  const [inspect, setInspect] = useState<ToolWithAvailability | null>(null);

  const toggle = async (t: ToolWithAvailability, enabled: boolean) => {
    try {
      await api.patch(`/tools/${t.id}`, { enabled });
      notify(`${t.name} ${enabled ? 'enabled' : 'disabled'}`, 'success');
      void qc.invalidateQueries({ queryKey: ['tools'] });
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <div>
      <PageHeader title="Tool Registry" subtitle="Every capability an agent can be granted, its risk level and whether it is available in this workspace" tabs={<DashboardTabs />} />
      {tools.isPending && <ShimmerTable rows={8} headers={['Tool', 'Risk', 'Approval', 'Agents', 'Availability', '']} />}
      {tools.isError && <ErrorState error={tools.error} onRetry={() => tools.refetch()} />}
      {tools.data && tools.data.items.length === 0 && <div className="cs-card"><EmptyState icon={Wrench} title="No tools registered" /></div>}
      {tools.data && (
        <div className="flex flex-col gap-4">
          {tools.data.groups.map((g) => {
            const items = tools.data.items.filter((t) => t.category === g.category);
            if (items.length === 0) return null;
            return (
              <section key={g.category} className="cs-card overflow-x-auto" aria-label={g.label}>
                <div className="px-4 pt-3 pb-2"><h2 className="text-[14px] font-semibold">{g.label}</h2><div className="text-[12px] text-text-3">{g.description}</div></div>
                <table className="w-full text-left text-[13px]">
                  <thead><tr className="bg-surface-2 border-y border-border">{['Tool', 'Risk', 'Approval', 'Granted to', 'Availability', canManage ? 'Enabled' : ''].map((h) => <th key={h} className="px-3 py-2 cs-label whitespace-nowrap">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-border">
                    {items.map((t) => {
                      const disabledByAdmin = t.unavailableReason === DISABLED_REASON;
                      return (
                        <tr key={t.id} className="hover:bg-surface-2/60">
                          <td className="px-3 py-2.5 max-w-[420px]">
                            <button type="button" className="font-medium text-left hover:text-primary" onClick={() => setInspect(t)}>{t.name}</button>
                            <div className="text-[11.5px] text-text-3"><code>{t.id}</code> · {t.description}</div>
                          </td>
                          <td className="px-3 py-2.5"><RiskChip risk={t.risk} /></td>
                          <td className="px-3 py-2.5">{t.requiresApproval ? <Chip size="small" label="required" color="warning" variant="outlined" /> : <span className="text-text-3 text-[12px]">no</span>}</td>
                          <td className="px-3 py-2.5 text-text-2 whitespace-nowrap">{t.grantedAgents} agent(s)</td>
                          <td className="px-3 py-2.5">
                            {t.available ? (
                              <Chip size="small" label="available" color="success" variant="outlined" />
                            ) : (
                              <Tooltip title={t.unavailableReason ?? ''}>
                                <span className="inline-flex items-center gap-1.5">
                                  <Chip size="small" label="unavailable" variant="outlined" />
                                  {t.requiresIntegration && !disabledByAdmin && <Link to="/integrations" className="text-[11.5px] text-accent hover:underline">connect</Link>}
                                </span>
                              </Tooltip>
                            )}
                          </td>
                          <td className="px-3 py-2.5">{canManage && <Switch size="small" checked={!disabledByAdmin} onChange={(e) => toggle(t, e.target.checked)} inputProps={{ 'aria-label': `Enable ${t.name}` }} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            );
          })}
        </div>
      )}
      <Dialog open={Boolean(inspect)} onClose={() => setInspect(null)} maxWidth="md" fullWidth>
        {inspect && (
          <>
            <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>{inspect.name} <RiskChip risk={inspect.risk} /></DialogTitle>
            <DialogContent dividers>
              <p className="text-[13px] text-text-2 mb-3">{inspect.description}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[12.5px] mb-3">
                <div className="rounded-lg border border-border bg-surface-2 px-3 py-2"><div className="cs-label">Category</div>{inspect.category.replace('_', ' ').toLowerCase()}</div>
                <div className="rounded-lg border border-border bg-surface-2 px-3 py-2"><div className="cs-label">Timeout</div>{duration(inspect.timeoutMs)}</div>
                <div className="rounded-lg border border-border bg-surface-2 px-3 py-2"><div className="cs-label">Idempotent</div>{inspect.idempotent ? 'yes' : 'no'}</div>
                <div className="rounded-lg border border-border bg-surface-2 px-3 py-2"><div className="cs-label">Integration</div>{inspect.requiresIntegration ?? 'none'}</div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><div className="cs-label mb-1">Input schema</div><pre className="text-[11px] rounded-lg border border-border bg-surface-2 p-2 overflow-auto max-h-80">{JSON.stringify(inspect.inputSchema, null, 2)}</pre></div>
                <div><div className="cs-label mb-1">Output schema</div><pre className="text-[11px] rounded-lg border border-border bg-surface-2 p-2 overflow-auto max-h-80">{JSON.stringify(inspect.outputSchema, null, 2)}</pre></div>
              </div>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 1.5 }}><Button onClick={() => setInspect(null)}>Close</Button></DialogActions>
          </>
        )}
      </Dialog>
    </div>
  );
}
