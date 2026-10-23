import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, ListItemIcon, Menu, MenuItem, TextField } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, LayoutTemplate, MoreHorizontal, Pencil, Plus, Trash2, Workflow } from 'lucide-react';
import type { WorkflowDto, WorkflowGraph } from '@collabspace/shared';
import { useProjects, useWorkflows } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { DashboardTabs } from '@/components/common/DashboardTabs';
import { StatusChip } from '@/components/common/StatusChip';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState } from '@/components/common/States';
import { ShimmerAgentList } from '@/components/shimmer';
import { timeAgo } from '@/lib/format';

/** Minimal valid starting graph for a blank workflow. */
export const BLANK_GRAPH: WorkflowGraph = {
  nodes: [
    { id: 'start', type: 'START', position: { x: 0, y: 120 }, data: { label: 'Start' } },
    { id: 'end', type: 'END', position: { x: 520, y: 120 }, data: { label: 'End' } },
  ],
  edges: [],
};

export function WorkflowsPage() {
  const workflows = useWorkflows();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const canEdit = useCan('workflow.edit');
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; wf: WorkflowDto } | null>(null);
  const [archive, setArchive] = useState<WorkflowDto | null>(null);

  const duplicate = async (wf: WorkflowDto) => {
    setMenu(null);
    try {
      const copy = await api.post<WorkflowDto>(`/workflows/${wf.id}/duplicate`);
      void qc.invalidateQueries({ queryKey: ['workflows'] });
      notify('Workflow duplicated', 'success');
      navigate(`/workflows/${copy.id}`);
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const doArchive = async () => {
    const wf = archive;
    setArchive(null);
    if (!wf) return;
    try {
      await api.delete(`/workflows/${wf.id}`);
      void qc.invalidateQueries({ queryKey: ['workflows'] });
      notify(`${wf.name} archived`, 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const items = workflows.data?.items ?? [];
  return (
    <div>
      <PageHeader title="Agent Workflows" subtitle="Chain agents, approvals, conditions and human steps into repeatable processes" actions={canEdit && <Button variant="contained" size="small" startIcon={<Plus size={15} />} onClick={() => setCreating(true)} data-testid="new-workflow">New workflow</Button>} tabs={<DashboardTabs />} />
      {workflows.isPending && <ShimmerAgentList count={3} />}
      {workflows.isError && <ErrorState error={workflows.error} onRetry={() => workflows.refetch()} />}
      {workflows.data && items.length === 0 && (
        <div className="cs-card"><EmptyState icon={Workflow} title="No workflows yet" description="Start from a template like Research → Review → Approve → Document." action={canEdit ? <Button variant="contained" size="small" onClick={() => setCreating(true)}>Create workflow</Button> : undefined} /></div>
      )}
      {items.length > 0 && (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3" data-testid="workflows-grid">
          {items.map((wf) => (
            <div key={wf.id} role="button" tabIndex={0} onClick={() => navigate(`/workflows/${wf.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/workflows/${wf.id}`)} className="cs-card cs-card-hover p-4 flex flex-col gap-2 cursor-pointer">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0"><Workflow size={18} /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[14px] truncate">{wf.name}</div>
                  <div className="text-[11.5px] text-text-3">v{wf.currentVersion} · {wf.graph.nodes.length} steps{wf.isTemplate ? ' · template' : ''}</div>
                </div>
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); setMenu({ anchor: e.currentTarget, wf }); }} aria-label={`Actions for ${wf.name}`}><MoreHorizontal size={16} /></IconButton>
              </div>
              <div className="text-[12.5px] text-text-2 line-clamp-2 min-h-[2.4em]">{wf.description || 'No description'}</div>
              <div className="flex items-center justify-between text-[11.5px] text-text-3">
                {wf.lastExecution ? <span className="inline-flex items-center gap-1.5">Last run <StatusChip status={wf.lastExecution.status} /> {timeAgo(wf.lastExecution.createdAt)}</span> : <span>Never run</span>}
                <span>updated {timeAgo(wf.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { const id = menu!.wf.id; setMenu(null); navigate(`/workflows/${id}`); }}><ListItemIcon><Pencil size={15} /></ListItemIcon>Open editor</MenuItem>
        {canEdit && <MenuItem onClick={() => duplicate(menu!.wf)}><ListItemIcon><Copy size={15} /></ListItemIcon>Duplicate</MenuItem>}
        {canEdit && <MenuItem onClick={() => { setArchive(menu!.wf); setMenu(null); }}><ListItemIcon><Trash2 size={15} /></ListItemIcon>Archive</MenuItem>}
      </Menu>
      {creating && <CreateWorkflowDialog onClose={() => setCreating(false)} />}
      <ConfirmDialog open={Boolean(archive)} title={`Archive ${archive?.name ?? 'workflow'}?`} description="It disappears from this list. Past executions stay in the audit log." confirmLabel="Archive" destructive onClose={() => setArchive(null)} onConfirm={doArchive} />
    </div>
  );
}

function CreateWorkflowDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const projects = useProjects();
  const templates = useQuery({ queryKey: ['workflow-templates'], queryFn: () => api.get<{ items: Array<{ name: string; description: string; graph: WorkflowGraph }> }>('/workflows/templates') });
  const [choice, setChoice] = useState<number>(-1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = (i: number) => {
    setChoice(i);
    const t = templates.data?.items[i];
    if (t) {
      setName(t.name);
      setDescription(t.description);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const graph = choice >= 0 ? templates.data!.items[choice]!.graph : BLANK_GRAPH;
      const wf = await api.post<WorkflowDto>('/workflows', { name: name.trim(), description, projectId: projectId || null, graph, changeSummary: choice >= 0 ? 'Created from template' : 'Created blank' });
      void qc.invalidateQueries({ queryKey: ['workflows'] });
      notify('Workflow created', 'success');
      navigate(`/workflows/${wf.id}`);
    } catch (err) {
      notify(errorMessage(err), 'error');
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>New workflow</DialogTitle>
      <DialogContent>
        <div className="cs-label mb-2">Start from</div>
        <div className="grid grid-cols-1 gap-2 mb-4">
          <button type="button" onClick={() => setChoice(-1)} className={`text-left rounded-lg border px-3 py-2 ${choice === -1 ? 'border-primary bg-primary-soft/40' : 'border-border hover:bg-surface-2'}`}>
            <div className="font-medium text-[13px]">Blank canvas</div><div className="text-[12px] text-text-3">Start and End nodes only</div>
          </button>
          {(templates.data?.items ?? []).map((t, i) => (
            <button key={t.name} type="button" onClick={() => pick(i)} className={`text-left rounded-lg border px-3 py-2 ${choice === i ? 'border-primary bg-primary-soft/40' : 'border-border hover:bg-surface-2'}`}>
              <div className="font-medium text-[13px] inline-flex items-center gap-1.5"><LayoutTemplate size={13} />{t.name}</div><div className="text-[12px] text-text-3">{t.description}</div>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <TextField label="Name" size="small" value={name} onChange={(e) => setName(e.target.value)} autoFocus inputProps={{ 'data-testid': 'workflow-name' }} />
          <TextField label="Description" size="small" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2} />
          <TextField select label="Project (optional)" size="small" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <MenuItem value="">No project</MenuItem>
            {(projects.data?.items ?? []).map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </TextField>
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={create} disabled={busy || name.trim().length < 2} data-testid="workflow-create">Create & open editor</Button>
      </DialogActions>
    </Dialog>
  );
}
