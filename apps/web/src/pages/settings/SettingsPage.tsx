import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Alert, Avatar, Button, FormControlLabel, IconButton, MenuItem, Switch, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Monitor, Moon, Plus, Sun, Trash2 } from 'lucide-react';
import { ROLE_LABELS, WORKSPACE_ROLES, type UserDto, type WorkspaceRole } from '@collabspace/shared';
import { useAgents, useBudgets, useHealth, useMembers, useProjects } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { useAuthStore, useCan, useWorkspace } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { DashboardTabs } from '@/components/common/DashboardTabs';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState } from '@/components/common/States';
import { ShimmerTable } from '@/components/shimmer';
import { dateTime, initials, usd } from '@/lib/format';

const TABS = [
  { key: 'profile', label: 'Profile & preferences' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'members', label: 'Members' },
  { key: 'projects', label: 'Projects' },
  { key: 'budgets', label: 'Budgets' },
  { key: 'system', label: 'System status' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function SettingsPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const current: TabKey = TABS.some((t) => t.key === tab) ? (tab as TabKey) : 'profile';
  return (
    <div>
      <PageHeader title="Settings" subtitle="Workspace, members, budgets and personal preferences" tabs={<DashboardTabs />} />
      <Tabs value={current} onChange={(_, v) => navigate(`/settings/${v}`)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2 }}>
        {TABS.map((t) => <Tab key={t.key} value={t.key} label={t.label} />)}
      </Tabs>
      {current === 'profile' && <ProfileTab />}
      {current === 'workspace' && <WorkspaceTab />}
      {current === 'members' && <MembersTab />}
      {current === 'projects' && <ProjectsTab />}
      {current === 'budgets' && <BudgetsTab />}
      {current === 'system' && <SystemTab />}
    </div>
  );
}

function ProfileTab() {
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const notify = useUiStore((s) => s.notify);
  const themePref = useUiStore((s) => s.themePreference);
  const setThemePref = useUiStore((s) => s.setThemePreference);
  const [name, setName] = useState(user?.name ?? '');
  const [busy, setBusy] = useState(false);

  const save = async (patch: { name?: string; themePreference?: 'light' | 'dark' | 'system' }) => {
    setBusy(true);
    try {
      const res = await api.patch<{ user: UserDto }>('/auth/me', patch);
      updateUser({ name: res.user.name, themePreference: res.user.themePreference });
      notify('Profile saved', 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
      <section className="cs-card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Avatar sx={{ width: 44, height: 44, bgcolor: 'var(--cs-accent)' }}>{user ? initials(user.name) : '?'}</Avatar>
          <div><div className="font-semibold">{user?.name}</div><div className="text-[12.5px] text-text-3">{user?.email}{user?.emailVerified ? ' · verified' : ' · not verified'}</div></div>
        </div>
        <TextField label="Display name" size="small" value={name} onChange={(e) => setName(e.target.value)} inputProps={{ 'data-testid': 'profile-name' }} />
        <div><Button variant="contained" size="small" disabled={busy || name.trim().length < 2 || name === user?.name} onClick={() => save({ name: name.trim() })}>Save profile</Button></div>
        <div className="text-[11.5px] text-text-3">Member since {dateTime(user?.createdAt, 'MMM d, yyyy')}</div>
      </section>
      <section className="cs-card p-4 flex flex-col gap-3">
        <div className="font-semibold text-[14px]">Theme</div>
        <ToggleButtonGroup exclusive size="small" value={themePref} onChange={(_, v) => { if (!v) return; setThemePref(v); void save({ themePreference: v }); }} aria-label="Theme preference">
          <ToggleButton value="light"><Sun size={14} className="mr-1.5" />Light</ToggleButton>
          <ToggleButton value="dark"><Moon size={14} className="mr-1.5" />Dark</ToggleButton>
          <ToggleButton value="system"><Monitor size={14} className="mr-1.5" />System</ToggleButton>
        </ToggleButtonGroup>
        <div className="text-[12px] text-text-3">Your choice is saved to your account and applied on every device.</div>
      </section>
    </div>
  );
}

function WorkspaceTab() {
  const workspace = useWorkspace();
  const workspaces = useAuthStore((s) => s.workspaces);
  const user = useAuthStore((s) => s.user);
  const setSession = useAuthStore((s) => s.setSession);
  const notify = useUiStore((s) => s.notify);
  const canManage = useCan('workspace.manage');
  const [form, setForm] = useState({ name: '', maxConcurrentTasks: 5, defaultAgentConcurrency: 2 });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (workspace) setForm({ name: workspace.name, maxConcurrentTasks: workspace.maxConcurrentTasks, defaultAgentConcurrency: workspace.defaultAgentConcurrency });
  }, [workspace]);
  if (!workspace) return null;

  const save = async () => {
    setBusy(true);
    try {
      const res = await api.patch<{ name: string; maxConcurrentTasks: number; defaultAgentConcurrency: number }>(`/workspaces/${workspace.id}`, form);
      if (user) setSession(user, workspaces.map((w) => (w.id === workspace.id ? { ...w, ...res } : w)));
      notify('Workspace updated', 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cs-card p-4 flex flex-col gap-3 max-w-xl">
      {!canManage && <Alert severity="info">Only the workspace owner can change these settings.</Alert>}
      <TextField label="Workspace name" size="small" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!canManage} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField label="Max concurrent tasks" type="number" size="small" value={form.maxConcurrentTasks} onChange={(e) => setForm({ ...form, maxConcurrentTasks: Number(e.target.value) })} disabled={!canManage} inputProps={{ min: 1, max: 100 }} helperText="Across all agents in the workspace" />
        <TextField label="Default per-agent concurrency" type="number" size="small" value={form.defaultAgentConcurrency} onChange={(e) => setForm({ ...form, defaultAgentConcurrency: Number(e.target.value) })} disabled={!canManage} inputProps={{ min: 1, max: 20 }} />
      </div>
      <div className="text-[12px] text-text-3">Slug: <code>{workspace.slug}</code> · your role: {ROLE_LABELS[workspace.role]}</div>
      {canManage && <div><Button variant="contained" size="small" onClick={save} disabled={busy || form.name.trim().length < 2}>Save workspace</Button></div>}
    </section>
  );
}

function MembersTab() {
  const members = useMembers();
  const workspace = useWorkspace();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const canManage = useCan('members.manage');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('VIEWER');
  const [remove, setRemove] = useState<{ userId: string; name: string } | null>(null);
  const roles = WORKSPACE_ROLES.filter((r) => r !== 'OWNER' || workspace?.role === 'OWNER');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['members'] });

  const run = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      notify(message, 'success');
      refresh();
      return true;
    } catch (err) {
      notify(errorMessage(err), 'error');
      return false;
    }
  };

  if (members.isPending) return <ShimmerTable rows={5} headers={['Member', 'Role', 'Joined', '']} />;
  if (members.isError) return <ErrorState error={members.error} onRetry={() => members.refetch()} />;
  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <form className="cs-card p-4 flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run(() => api.post(`/workspaces/${workspace!.id}/members`, { email, role }), `Invitation sent to ${email}`)) setEmail(''); }}>
          <TextField label="Invite by email" type="email" size="small" value={email} onChange={(e) => setEmail(e.target.value)} sx={{ minWidth: 260, flex: 1 }} inputProps={{ 'data-testid': 'invite-email' }} />
          <TextField select label="Role" size="small" value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)} sx={{ minWidth: 170 }}>
            {roles.map((r) => <MenuItem key={r} value={r}>{ROLE_LABELS[r]}</MenuItem>)}
          </TextField>
          <Button type="submit" variant="contained" startIcon={<Plus size={15} />} disabled={!/^\S+@\S+\.\S+$/.test(email)}>Invite</Button>
          <div className="w-full text-[11.5px] text-text-3">Existing users are added immediately; new users join when they register with this email.</div>
        </form>
      )}
      <section className="cs-card overflow-x-auto">
        <table className="w-full text-left text-[13px]" data-testid="members-table">
          <thead><tr className="bg-surface-2 border-b border-border">{['Member', 'Role', 'Joined', ''].map((h) => <th key={h} className="px-3 py-2 cs-label">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            {members.data.members.map((m) => {
              const self = m.userId === user?.id;
              const editable = canManage && !self && (m.role !== 'OWNER' || workspace?.role === 'OWNER');
              return (
                <tr key={m.id}>
                  <td className="px-3 py-2.5"><div className="flex items-center gap-2"><Avatar sx={{ width: 28, height: 28, fontSize: 11, bgcolor: 'var(--cs-accent)' }}>{initials(m.name)}</Avatar><div><div className="font-medium">{m.name}{self ? ' (you)' : ''}</div><div className="text-[11.5px] text-text-3">{m.email}</div></div></div></td>
                  <td className="px-3 py-2.5">
                    {editable ? (
                      <TextField select size="small" value={m.role} onChange={(e) => run(() => api.patch(`/workspaces/${workspace!.id}/members/${m.userId}`, { role: e.target.value }), `${m.name} is now ${ROLE_LABELS[e.target.value as WorkspaceRole]}`)} sx={{ minWidth: 170 }} inputProps={{ 'aria-label': `Role for ${m.name}` }}>
                        {roles.map((r) => <MenuItem key={r} value={r}>{ROLE_LABELS[r]}</MenuItem>)}
                      </TextField>
                    ) : (
                      ROLE_LABELS[m.role as WorkspaceRole] ?? m.role
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-text-3">{dateTime(m.joinedAt, 'MMM d, yyyy')}</td>
                  <td className="px-3 py-2.5 text-right">{editable && <Tooltip title="Remove from workspace"><IconButton size="small" onClick={() => setRemove({ userId: m.userId, name: m.name })} aria-label={`Remove ${m.name}`}><Trash2 size={15} /></IconButton></Tooltip>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {members.data.invites.length > 0 && (
        <section className="cs-card p-4">
          <div className="cs-label mb-2">Pending invitations</div>
          <ul className="flex flex-col gap-1 text-[13px]">
            {members.data.invites.map((i) => <li key={i.id} className="flex justify-between gap-2"><span>{i.email}</span><span className="text-text-3">{ROLE_LABELS[i.role as WorkspaceRole] ?? i.role} · invited {dateTime(i.createdAt, 'MMM d')}</span></li>)}
          </ul>
        </section>
      )}
      <ConfirmDialog open={Boolean(remove)} title={`Remove ${remove?.name ?? 'member'}?`} description="They lose access to this workspace immediately. Their past actions stay in the audit log." confirmLabel="Remove" destructive onClose={() => setRemove(null)} onConfirm={async () => { const r = remove; setRemove(null); if (r) await run(() => api.delete(`/workspaces/${workspace!.id}/members/${r.userId}`), `${r.name} removed`); }} />
    </div>
  );
}

function ProjectsTab() {
  const projects = useProjects();
  const workspace = useWorkspace();
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const canCreate = useCan('agent.create');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/workspaces/${workspace!.id}/projects`, { name: name.trim(), description });
      notify(`Project ${name} created`, 'success');
      setName('');
      setDescription('');
      void qc.invalidateQueries({ queryKey: ['projects'] });
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {canCreate && (
        <form className="cs-card p-4 flex flex-wrap items-end gap-2" onSubmit={create}>
          <TextField label="Project name" size="small" value={name} onChange={(e) => setName(e.target.value)} sx={{ minWidth: 220 }} inputProps={{ 'data-testid': 'project-name' }} />
          <TextField label="Description" size="small" value={description} onChange={(e) => setDescription(e.target.value)} sx={{ flex: 1, minWidth: 240 }} />
          <Button type="submit" variant="contained" startIcon={<Plus size={15} />} disabled={name.trim().length < 2}>Create project</Button>
        </form>
      )}
      {projects.isPending && <ShimmerTable rows={3} headers={['Project', 'Description', 'Created']} />}
      {projects.isError && <ErrorState error={projects.error} onRetry={() => projects.refetch()} />}
      {projects.data && projects.data.items.length === 0 && <div className="cs-card"><EmptyState title="No projects" description="Projects group agents, tasks, knowledge and budgets." compact /></div>}
      {projects.data && projects.data.items.length > 0 && (
        <section className="cs-card divide-y divide-border">
          {projects.data.items.map((p) => (
            <div key={p.id} className="px-4 py-3 flex items-start gap-3">
              <span className="mt-1.5 h-2 w-2 rounded-full bg-accent shrink-0" />
              <div className="min-w-0 flex-1"><div className="font-medium text-[13.5px]">{p.name}</div><div className="text-[12.5px] text-text-3">{p.description || 'No description'}</div></div>
              <span className="text-[11.5px] text-text-3 whitespace-nowrap">created {dateTime(p.createdAt, 'MMM d, yyyy')}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function BudgetsTab() {
  const budgets = useBudgets();
  const workspace = useWorkspace();
  const projects = useProjects();
  const agents = useAgents();
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const canManage = useCan('budget.manage');
  const [form, setForm] = useState({ scope: 'WORKSPACE' as 'WORKSPACE' | 'PROJECT' | 'AGENT', scopeId: '', period: 'MONTHLY' as 'DAILY' | 'MONTHLY' | 'TOTAL', hardLimitUsd: '' as string, warningRatio: 0.8, maxTokens: '' as string, enabled: true });
  const [remove, setRemove] = useState<string | null>(null);

  const scopeName = (scope: string, scopeId: string | null) => {
    if (scope === 'WORKSPACE') return 'Workspace';
    if (scope === 'PROJECT') return `Project: ${projects.data?.items.find((p) => p.id === scopeId)?.name ?? scopeId}`;
    return `Agent: ${agents.data?.items.find((a) => a.id === scopeId)?.name ?? scopeId}`;
  };
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['budgets'] });
    void qc.invalidateQueries({ queryKey: ['usage'] });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post(`/workspaces/${workspace!.id}/budgets`, {
        scope: form.scope,
        scopeId: form.scope === 'WORKSPACE' ? null : form.scopeId,
        period: form.period,
        hardLimitUsd: form.hardLimitUsd === '' ? null : Number(form.hardLimitUsd),
        warningRatio: form.warningRatio,
        maxTokens: form.maxTokens === '' ? null : Number(form.maxTokens),
        enabled: form.enabled,
      });
      notify('Budget policy saved', 'success');
      refresh();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const doRemove = async () => {
    const id = remove;
    setRemove(null);
    try {
      await api.delete(`/workspaces/${workspace!.id}/budgets/${id}`);
      notify('Budget policy removed', 'success');
      refresh();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <form className="cs-card p-4 flex flex-col gap-3" onSubmit={save}>
          <div className="font-semibold text-[14px]">Add or update a budget policy</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <TextField select label="Scope" size="small" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as typeof form.scope, scopeId: '' })}>
              <MenuItem value="WORKSPACE">Workspace</MenuItem>
              <MenuItem value="PROJECT">Project</MenuItem>
              <MenuItem value="AGENT">Agent</MenuItem>
            </TextField>
            {form.scope !== 'WORKSPACE' && (
              <TextField select label={form.scope === 'PROJECT' ? 'Project' : 'Agent'} size="small" value={form.scopeId} onChange={(e) => setForm({ ...form, scopeId: e.target.value })}>
                {(form.scope === 'PROJECT' ? projects.data?.items ?? [] : agents.data?.items ?? []).map((x) => <MenuItem key={x.id} value={x.id}>{x.name}</MenuItem>)}
              </TextField>
            )}
            <TextField select label="Period" size="small" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value as typeof form.period })}>
              <MenuItem value="DAILY">Daily</MenuItem>
              <MenuItem value="MONTHLY">Monthly</MenuItem>
              <MenuItem value="TOTAL">Lifetime</MenuItem>
            </TextField>
            <TextField label="Hard limit (USD, est.)" type="number" size="small" value={form.hardLimitUsd} onChange={(e) => setForm({ ...form, hardLimitUsd: e.target.value })} inputProps={{ min: 0, step: 1 }} helperText="Tasks stop when exceeded" />
            <TextField label="Warn at (%)" type="number" size="small" value={Math.round(form.warningRatio * 100)} onChange={(e) => setForm({ ...form, warningRatio: Math.min(1, Math.max(0.1, Number(e.target.value) / 100)) })} inputProps={{ min: 10, max: 100 }} />
            <TextField label="Max tokens (optional)" type="number" size="small" value={form.maxTokens} onChange={(e) => setForm({ ...form, maxTokens: e.target.value })} inputProps={{ min: 0 }} />
            <FormControlLabel control={<Switch size="small" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />} label={<span className="text-[13px]">Enabled</span>} />
          </div>
          <div><Button type="submit" variant="contained" size="small" disabled={form.scope !== 'WORKSPACE' && !form.scopeId}>Save policy</Button></div>
          <div className="text-[11.5px] text-text-3">One policy per scope and period; saving the same combination updates it.</div>
        </form>
      )}
      {budgets.isPending && <ShimmerTable rows={3} headers={['Scope', 'Period', 'Limit', 'Warn at', '']} />}
      {budgets.isError && <ErrorState error={budgets.error} onRetry={() => budgets.refetch()} />}
      {budgets.data && budgets.data.items.length === 0 && <div className="cs-card"><EmptyState title="No budget policies" description="Without policies, only per-agent and per-task limits apply." compact /></div>}
      {budgets.data && budgets.data.items.length > 0 && (
        <section className="cs-card overflow-x-auto">
          <table className="w-full text-left text-[13px]" data-testid="budgets-table">
            <thead><tr className="bg-surface-2 border-b border-border">{['Scope', 'Period', 'Hard limit', 'Warn at', 'Max tokens', 'State', ''].map((h) => <th key={h} className="px-3 py-2 cs-label">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {budgets.data.items.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2.5 font-medium">{scopeName(b.scope, b.scopeId)}</td>
                  <td className="px-3 py-2.5">{b.period.toLowerCase()}</td>
                  <td className="px-3 py-2.5">{b.hardLimitUsd !== null ? usd(Number(b.hardLimitUsd)) : '—'}</td>
                  <td className="px-3 py-2.5">{Math.round(Number(b.warningRatio) * 100)}%</td>
                  <td className="px-3 py-2.5">{b.maxTokens ?? '—'}</td>
                  <td className="px-3 py-2.5">{b.enabled ? 'enabled' : 'disabled'}</td>
                  <td className="px-3 py-2.5 text-right">{canManage && <IconButton size="small" onClick={() => setRemove(b.id)} aria-label="Delete budget policy"><Trash2 size={15} /></IconButton>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <ConfirmDialog open={Boolean(remove)} title="Delete this budget policy?" confirmLabel="Delete" destructive onClose={() => setRemove(null)} onConfirm={doRemove} />
    </div>
  );
}

function SystemTab() {
  const health = useHealth();
  if (health.isPending) return <ShimmerTable rows={4} headers={['Check', 'Status']} />;
  if (health.isError) return <ErrorState error={health.error} onRetry={() => health.refetch()} />;
  const h = health.data;
  return (
    <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
      <section className="cs-card p-4">
        <div className="font-semibold text-[14px] mb-2">Services</div>
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {Object.entries(h.checks).map(([k, c]) => (
            <li key={k} className="flex items-center justify-between gap-2"><span className="capitalize">{k}</span><span className={c.ok ? 'text-success' : 'text-danger'}>{c.ok ? 'healthy' : c.message ?? 'unavailable'}</span></li>
          ))}
          <li className="flex items-center justify-between gap-2"><span>Storage driver</span><span>{h.storage.driver}</span></li>
        </ul>
      </section>
      <section className="cs-card p-4 text-[13px] flex flex-col gap-1.5">
        <div className="font-semibold text-[14px] mb-1">AI provider</div>
        {!h.aiProvider.configured && <Alert severity="warning">{h.aiProvider.reason ?? 'No AI provider configured'}</Alert>}
        {h.aiProvider.isMock && <Alert severity="warning">Running the deterministic mock provider. Outputs are placeholders.</Alert>}
        <div>Provider: <strong>{h.aiProvider.provider ?? 'none'}</strong></div>
        <div>Default model: <strong>{h.aiProvider.defaultModel ?? '—'}</strong></div>
        <div>Embeddings: {h.aiProvider.embeddings ? 'enabled' : 'Postgres full-text search only'}</div>
        <div className="text-[12px] text-text-3">Models: {h.aiProvider.models.map((m) => m.label).join(', ') || '—'}</div>
      </section>
    </div>
  );
}
