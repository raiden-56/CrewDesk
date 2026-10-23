import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Switch, TextField, Chip, Collapse } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { TOOL_CATALOG, type TaskDto } from '@collabspace/shared';
import { useAgents, useArtifacts, useProjects } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { useUiStore } from '@/store/ui';
import { AgentAvatar } from '@/components/common/AgentAvatar';

export interface TaskComposerInitial {
  agentId?: string;
  projectId?: string | null;
  title?: string;
  description?: string;
  conversationId?: string;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  expectedDeliverable?: string;
  inputArtifactIds?: string[];
  allowedTools?: string[] | null;
  budgetUsd?: number | null;
  requireApprovalForWrites?: boolean;
}

/** Task mode: a defined job with deliverable, tools, budget, deadline and approval requirements. */
export function TaskComposer({ open, onClose, initial, onCreated }: { open: boolean; onClose: () => void; initial?: TaskComposerInitial; onCreated?: (task: TaskDto) => void }) {
  const agents = useAgents();
  const projects = useProjects();
  const artifacts = useArtifacts({ pageSize: 50 });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const notify = useUiStore((s) => s.notify);
  const [form, setForm] = useState({
    agentId: initial?.agentId ?? '',
    projectId: initial?.projectId ?? '',
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    priority: initial?.priority ?? 'NORMAL',
    deadline: '',
    scheduledFor: '',
    expectedDeliverable: initial?.expectedDeliverable ?? '',
    inputArtifactIds: initial?.inputArtifactIds ?? [],
    restrictTools: Boolean(initial?.allowedTools),
    allowedTools: initial?.allowedTools ?? [],
    budgetUsd: initial?.budgetUsd ?? null,
    requireApprovalForWrites: initial?.requireApprovalForWrites ?? false,
  });
  const [advanced, setAdvanced] = useState(false);
  const [review, setReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const agentList = useMemo(() => (agents.data?.items ?? []).filter((a) => a.status !== 'ARCHIVED'), [agents.data]);
  const agent = agentList.find((a) => a.id === form.agentId) ?? null;
  useEffect(() => {
    if (!form.agentId && agentList[0]) setForm((f) => ({ ...f, agentId: agentList[0]!.id, projectId: f.projectId || (agentList[0]!.projectId ?? '') }));
  }, [agentList, form.agentId]);

  const complex = form.description.length > 400 || form.inputArtifactIds.length > 0 || form.restrictTools || form.budgetUsd !== null;

  const submit = async () => {
    if (complex && !review) {
      setReview(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const task = await api.post<TaskDto>('/agent-tasks', {
        agentId: form.agentId,
        projectId: form.projectId || null,
        title: form.title,
        description: form.description,
        priority: form.priority,
        deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
        scheduledFor: form.scheduledFor ? new Date(form.scheduledFor).toISOString() : null,
        expectedDeliverable: form.expectedDeliverable,
        inputArtifactIds: form.inputArtifactIds,
        allowedTools: form.restrictTools ? form.allowedTools : null,
        budgetUsd: form.budgetUsd,
        requireApprovalForWrites: form.requireApprovalForWrites,
        conversationId: initial?.conversationId,
        idempotencyKey: `ui-${form.agentId}-${form.title}-${Date.now().toString(36)}`,
      });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['agents'] });
      notify(task.status === 'PAUSED' ? 'Task created but the agent is paused' : 'Task queued', 'success');
      onCreated?.(task);
      onClose();
      if (!onCreated) navigate(`/tasks/${task.id}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>{review ? 'Review task before submitting' : 'Assign a task'}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {review ? (
          <div className="flex flex-col gap-2 text-[13px]">
            <div className="flex items-center gap-2">{agent && <AgentAvatar avatar={agent.avatar} color={agent.color} name={agent.name} size={28} />}<span className="font-semibold">{agent?.name}</span> will execute:</div>
            <div className="cs-card p-3 bg-surface-2">
              <div className="font-semibold">{form.title}</div>
              <div className="text-text-2 whitespace-pre-wrap mt-1">{form.description || '(no description)'}</div>
            </div>
            <ul className="list-disc pl-5 text-text-2">
              <li>Priority: {form.priority}{form.deadline ? ` · deadline ${form.deadline}` : ''}{form.scheduledFor ? ` · scheduled ${form.scheduledFor}` : ''}</li>
              <li>Deliverable: {form.expectedDeliverable || 'agent decides'}</li>
              <li>Input files: {form.inputArtifactIds.length}</li>
              <li>Tools: {form.restrictTools ? form.allowedTools.map((t) => TOOL_CATALOG[t]?.name ?? t).join(', ') || 'none' : `all granted (${agent?.tools.length ?? 0})`}</li>
              <li>Budget: {form.budgetUsd !== null ? `$${form.budgetUsd}` : 'workspace default'} · approvals: {form.requireApprovalForWrites ? 'required for every write tool' : 'high-risk tools only'}</li>
            </ul>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pt-1">
            <TextField select label="Agent" value={form.agentId} onChange={(e) => { const a = agentList.find((x) => x.id === e.target.value); setForm({ ...form, agentId: e.target.value, projectId: form.projectId || (a?.projectId ?? ''), allowedTools: [] }); }} size="small" inputProps={{ 'data-testid': 'task-agent' }}>
              {agentList.map((a) => (
                <MenuItem key={a.id} value={a.id}><span className="flex items-center gap-2"><AgentAvatar avatar={a.avatar} color={a.color} name={a.name} size={20} /> {a.name} <span className="text-text-3 text-[11px]">· {a.category.toLowerCase().replace(/_/g, ' ')}{a.status === 'PAUSED' ? ' · paused' : ''}</span></span></MenuItem>
              ))}
            </TextField>
            <TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} size="small" autoFocus inputProps={{ 'data-testid': 'task-title' }} />
            <TextField label="Description / instructions" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} multiline minRows={3} size="small" inputProps={{ 'data-testid': 'task-description' }} />
            <div className="grid grid-cols-2 gap-3">
              <TextField select label="Project" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} size="small">
                <MenuItem value="">No project</MenuItem>
                {(projects.data?.items ?? []).map((p) => (<MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>))}
              </TextField>
              <TextField select label="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as typeof form.priority })} size="small">
                {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => (<MenuItem key={p} value={p}>{p}</MenuItem>))}
              </TextField>
            </div>
            <TextField label="Expected deliverable" placeholder="e.g. Markdown report with comparison table and sources" value={form.expectedDeliverable} onChange={(e) => setForm({ ...form, expectedDeliverable: e.target.value })} size="small" />
            <Button size="small" onClick={() => setAdvanced(!advanced)} sx={{ alignSelf: 'flex-start' }}>{advanced ? 'Hide' : 'Show'} advanced options</Button>
            <Collapse in={advanced}>
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <TextField label="Deadline" type="datetime-local" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} size="small" InputLabelProps={{ shrink: true }} />
                  <TextField label="Schedule execution" type="datetime-local" value={form.scheduledFor} onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })} size="small" InputLabelProps={{ shrink: true }} helperText="Leave empty to run now" />
                </div>
                <TextField select label="Input files" SelectProps={{ multiple: true, renderValue: (v) => (v as string[]).map((id) => artifacts.data?.items.find((a) => a.id === id)?.name ?? id).join(', ') }} value={form.inputArtifactIds} onChange={(e) => setForm({ ...form, inputArtifactIds: e.target.value as unknown as string[] })} size="small" helperText="Upload files on the Files page first">
                  {(artifacts.data?.items ?? []).map((a) => (<MenuItem key={a.id} value={a.id}><Checkbox size="small" checked={form.inputArtifactIds.includes(a.id)} />{a.name}</MenuItem>))}
                </TextField>
                <TextField label="Budget limit (USD, estimated cost)" type="number" value={form.budgetUsd ?? ''} onChange={(e) => setForm({ ...form, budgetUsd: e.target.value === '' ? null : Number(e.target.value) })} size="small" inputProps={{ min: 0, step: 0.5 }} />
                <FormControlLabel control={<Switch size="small" checked={form.requireApprovalForWrites} onChange={(e) => setForm({ ...form, requireApprovalForWrites: e.target.checked })} />} label={<span className="text-[13px]">Require human approval for every write action (not just high-risk)</span>} />
                <FormControlLabel control={<Switch size="small" checked={form.restrictTools} onChange={(e) => setForm({ ...form, restrictTools: e.target.checked, allowedTools: e.target.checked ? [...(agent?.tools ?? [])] : [] })} />} label={<span className="text-[13px]">Restrict tools for this task</span>} />
                {form.restrictTools && (
                  <div className="flex flex-wrap gap-1">
                    {(agent?.tools ?? []).map((t) => (
                      <Chip key={t} size="small" label={TOOL_CATALOG[t]?.name ?? t} color={form.allowedTools.includes(t) ? 'primary' : 'default'} variant={form.allowedTools.includes(t) ? 'filled' : 'outlined'} onClick={() => setForm({ ...form, allowedTools: form.allowedTools.includes(t) ? form.allowedTools.filter((x) => x !== t) : [...form.allowedTools, t] })} />
                    ))}
                  </div>
                )}
              </div>
            </Collapse>
          </div>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {review && <Button onClick={() => setReview(false)} color="inherit">Back</Button>}
        <Button onClick={onClose} color="inherit" disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !form.agentId || form.title.trim().length < 2} data-testid="task-submit">{review ? 'Submit task' : complex ? 'Review' : 'Submit task'}</Button>
      </DialogActions>
    </Dialog>
  );
}
