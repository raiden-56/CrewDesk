import { useState } from 'react';
import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Github, Plug, RefreshCw, Trash2, Webhook } from 'lucide-react';
import { TOOL_CATALOG, type IntegrationDto } from '@collabspace/shared';
import { useIntegrations } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusChip } from '@/components/common/StatusChip';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ErrorState } from '@/components/common/States';
import { ShimmerAgentList } from '@/components/shimmer';
import { timeAgo } from '@/lib/format';

type Provider = { provider: string; name: string; description: string; secretLabel: string; tools: string[] };
const ICONS: Record<string, typeof Plug> = { github: Github, webhook: Webhook };
const STATUS_MAP: Record<IntegrationDto['status'], string> = { CONNECTED: 'COMPLETED', ERROR: 'FAILED', DISCONNECTED: 'OFFLINE' };

export function IntegrationsPage() {
  const integrations = useIntegrations();
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const canManage = useCan('integration.manage');
  const [configure, setConfigure] = useState<Provider | null>(null);
  const [remove, setRemove] = useState<IntegrationDto | null>(null);
  const [checking, setChecking] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['integrations'] });
    void qc.invalidateQueries({ queryKey: ['tools'] });
  };

  const check = async (i: IntegrationDto) => {
    setChecking(i.id);
    try {
      const res = await api.post<IntegrationDto>(`/integrations/${i.id}/check`);
      notify(res.status === 'CONNECTED' ? `${i.name} is connected` : `${i.name}: ${res.lastError ?? 'check failed'}`, res.status === 'CONNECTED' ? 'success' : 'error');
      refresh();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setChecking(null);
    }
  };

  const doRemove = async () => {
    if (!remove) return;
    try {
      await api.delete(`/integrations/${remove.id}`);
      notify(`${remove.name} removed`, 'success');
      refresh();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setRemove(null);
    }
  };

  return (
    <div>
      <PageHeader title="Integrations" subtitle="External systems your agents may reach. Secrets are encrypted at rest and never returned to the browser." />
      {integrations.isPending && <ShimmerAgentList count={2} />}
      {integrations.isError && <ErrorState error={integrations.error} onRetry={() => integrations.refetch()} />}
      {integrations.data && (
        <div className="grid gap-3 grid-cols-1 lg:grid-cols-2">
          {integrations.data.available.map((p) => {
            const Icon = ICONS[p.provider] ?? Plug;
            const connections = integrations.data.items.filter((i) => i.provider === p.provider);
            return (
              <section key={p.provider} className="cs-card p-4 flex flex-col gap-3" data-testid={`integration-${p.provider}`}>
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary-soft text-primary flex items-center justify-center"><Icon size={20} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-[14px]">{p.name}</div>
                    <div className="text-[12.5px] text-text-3">{p.description}</div>
                  </div>
                  {canManage && <Button size="small" variant={connections.length ? 'outlined' : 'contained'} onClick={() => setConfigure(p)}>{connections.length ? 'Reconfigure' : 'Connect'}</Button>}
                </div>
                <div className="flex flex-wrap gap-1">{p.tools.map((t) => <Chip key={t} size="small" variant="outlined" label={TOOL_CATALOG[t]?.name ?? t} />)}</div>
                {connections.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-2 text-[12.5px] text-text-3">Not connected. Tools that need it stay unavailable to agents.</div>
                ) : (
                  connections.map((i) => (
                    <div key={i.id} className="rounded-lg border border-border bg-surface-2 px-3 py-2 flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-[13px]">{i.name}</span>
                      <StatusChip status={STATUS_MAP[i.status]} />
                      <span className="text-[11.5px] text-text-3 flex-1 min-w-0 truncate">{i.status.toLowerCase()}{i.lastCheckedAt ? ` · checked ${timeAgo(i.lastCheckedAt)}` : ''}{i.lastError ? ` · ${i.lastError}` : ''}</span>
                      {canManage && (
                        <>
                          <Button size="small" startIcon={<RefreshCw size={13} className={checking === i.id ? 'animate-spin' : ''} />} onClick={() => check(i)} disabled={checking === i.id}>Test</Button>
                          <Button size="small" color="error" startIcon={<Trash2 size={13} />} onClick={() => setRemove(i)}>Remove</Button>
                        </>
                      )}
                    </div>
                  ))
                )}
              </section>
            );
          })}
        </div>
      )}
      {!canManage && <div className="text-[12px] text-text-3 mt-3">Only workspace owners and admins can manage integrations.</div>}
      {configure && <ConfigureDialog provider={configure} existing={integrations.data?.items.find((i) => i.provider === configure.provider) ?? null} onClose={() => setConfigure(null)} onSaved={refresh} />}
      <ConfirmDialog open={Boolean(remove)} title={`Remove ${remove?.name ?? 'integration'}?`} description="The stored secret is deleted and dependent tools become unavailable immediately." confirmLabel="Remove" destructive onClose={() => setRemove(null)} onConfirm={doRemove} />
    </div>
  );
}

function ConfigureDialog({ provider, existing, onClose, onSaved }: { provider: Provider; existing: IntegrationDto | null; onClose: () => void; onSaved: () => void }) {
  const notify = useUiStore((s) => s.notify);
  const [name, setName] = useState(existing?.name ?? provider.name);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<IntegrationDto>('/integrations', { provider: provider.provider, name, secret, config: existing?.config ?? {} });
      notify(res.status === 'CONNECTED' ? `${provider.name} connected` : `${provider.name} saved, but the connection check failed: ${res.lastError ?? 'unknown error'}`, res.status === 'CONNECTED' ? 'success' : 'warning');
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>{existing ? 'Reconfigure' : 'Connect'} {provider.name}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <div className="flex flex-col gap-3 pt-1">
          <TextField label="Display name" value={name} onChange={(e) => setName(e.target.value)} size="small" />
          <TextField label={provider.secretLabel} value={secret} onChange={(e) => setSecret(e.target.value)} size="small" type={provider.provider === 'webhook' ? 'url' : 'password'} autoComplete="off" helperText={existing ? 'Enter a new value to replace the stored secret.' : 'Stored encrypted. It is never shown again.'} />        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy || !name.trim() || !secret.trim()}>{busy ? 'Checking…' : 'Save & test'}</Button>
      </DialogActions>
    </Dialog>
  );
}
