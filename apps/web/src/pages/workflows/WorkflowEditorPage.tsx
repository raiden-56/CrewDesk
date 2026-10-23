import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Tab, Tabs, TextField, Tooltip } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addEdge, Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, type Connection, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CheckCircle2, FlaskConical, History, Play, Save, Trash2 } from 'lucide-react';
import { TOOL_CATALOG, WORKFLOW_NODE_TYPES, type WorkflowDto, type WorkflowExecutionDto, type WorkflowGraph, type WorkflowNodeType, type WorkflowValidationIssue } from '@collabspace/shared';
import { useAgents, useMembers, useWorkflow, useWorkflowExecutions } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { useResolvedMode } from '@/theme/ThemeProvider';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusChip } from '@/components/common/StatusChip';
import { EmptyState, ErrorState } from '@/components/common/States';
import { ShimmerPage } from '@/components/shimmer';
import { dateTime, timeAgo } from '@/lib/format';
import { flowToGraph, graphToFlow, NODE_META, nodeTypes, type CsNode, type CsNodeData } from './flow';

const READ_TOOLS = Object.values(TOOL_CATALOG).filter((t) => t.category === 'READ');
const PALETTE = WORKFLOW_NODE_TYPES.filter((t) => t !== 'START');

export function WorkflowEditorPage() {
  const { id } = useParams();
  const workflow = useWorkflow(id);
  if (workflow.isPending) return <ShimmerPage />;
  if (workflow.isError) return <div className="cs-card"><ErrorState error={workflow.error} onRetry={() => workflow.refetch()} /></div>;
  return (
    <ReactFlowProvider>
      <Editor key={`${workflow.data.id}-${workflow.data.currentVersion}`} workflow={workflow.data} />
    </ReactFlowProvider>
  );
}

function Editor({ workflow }: { workflow: WorkflowDto }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const mode = useResolvedMode();
  const canEdit = useCan('workflow.edit');
  const canExecute = useCan('workflow.execute');
  const initial = useMemo(() => graphToFlow(workflow.graph), [workflow.graph]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CsNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [issues, setIssues] = useState<WorkflowValidationIssue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [side, setSide] = useState<'node' | 'runs' | 'versions'>('node');

  const graph = useMemo(() => flowToGraph(nodes, edges, workflow.graph), [nodes, edges, workflow.graph]);
  const dirty = name !== workflow.name || description !== workflow.description || JSON.stringify(graph) !== JSON.stringify(flowToGraph(initial.nodes, initial.edges, workflow.graph));
  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Reflect validation issues on the canvas.
  useEffect(() => {
    const bad = new Set((issues ?? []).filter((i) => i.level === 'error' && i.nodeId).map((i) => i.nodeId!));
    setNodes((ns) => ns.map((n) => (Boolean(n.data.invalid) === bad.has(n.id) ? n : { ...n, data: { ...n.data, invalid: bad.has(n.id) } })));
  }, [issues, setNodes]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!canEdit) return;
      const label = c.sourceHandle === 'true' || c.sourceHandle === 'false' ? c.sourceHandle : undefined;
      setEdges((es) => addEdge({ ...c, id: `e-${c.source}-${c.sourceHandle ?? 'out'}-${c.target}-${Date.now().toString(36)}`, label }, es));
    },
    [canEdit, setEdges],
  );

  const addNode = (type: WorkflowNodeType) => {
    const id = `${type.toLowerCase()}-${Date.now().toString(36)}`;
    const maxX = Math.max(0, ...nodes.map((n) => n.position.x));
    const data: CsNodeData = { nodeType: type, label: NODE_META[type].label, ...(type === 'DELAY' ? { delayMs: 60000 } : {}), ...(type === 'APPROVAL' ? { risk: 'MEDIUM' as const, approvalTitle: 'Approve to continue' } : {}) };
    setNodes((ns) => [...ns, { id, type: 'cs', position: { x: maxX + 60, y: 260 + (ns.length % 3) * 40 }, data }]);
    setSelectedId(id);
    setSide('node');
  };

  const updateSelected = (patch: Partial<CsNodeData>) => {
    if (!selectedId) return;
    setNodes((ns) => ns.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, ...patch } } : n)));
  };

  const removeSelected = () => {
    if (!selected || selected.data.nodeType === 'START') return;
    setNodes((ns) => ns.filter((n) => n.id !== selected.id));
    setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id));
    setSelectedId(null);
  };

  const validate = async (): Promise<boolean> => {
    try {
      const res = await api.post<{ valid: boolean; issues: WorkflowValidationIssue[] }>(`/workflows/${workflow.id}/validate`, { graph });
      setIssues(res.issues);
      if (res.valid) notify(res.issues.length ? 'Valid, with warnings' : 'Workflow is valid', 'success');
      return res.valid;
    } catch (err) {
      notify(errorMessage(err), 'error');
      return false;
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.patch<WorkflowDto>(`/workflows/${workflow.id}`, { name: name.trim(), description, graph, changeSummary: 'Edited in workflow editor' });
      qc.setQueryData(['workflow', workflow.id], updated);
      void qc.invalidateQueries({ queryKey: ['workflows'] });
      notify(`Saved version ${updated.currentVersion}`, 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const issuesFor = (nodeId: string) => (issues ?? []).filter((i) => i.nodeId === nodeId);
  const globalIssues = (issues ?? []).filter((i) => !i.nodeId);

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        crumbs={[{ label: 'Agent Workflows', to: '/workflows' }, { label: workflow.name }]}
        title={canEdit ? <input value={name} onChange={(e) => setName(e.target.value)} className="bg-transparent outline-none border-b border-transparent focus:border-primary w-full max-w-lg" aria-label="Workflow name" /> : workflow.name}
        subtitle={`Version ${workflow.currentVersion} · updated ${timeAgo(workflow.updatedAt)}${dirty ? ' · unsaved changes' : ''}`}
        actions={
          <>
            <Button size="small" variant="outlined" startIcon={<CheckCircle2 size={14} />} onClick={validate} data-testid="workflow-validate">Validate</Button>
            {canEdit && <Button size="small" variant="contained" startIcon={<Save size={14} />} onClick={save} disabled={busy || !dirty || name.trim().length < 2} data-testid="workflow-save">Save</Button>}
            {canExecute && (
              <Tooltip title={dirty ? 'Save your changes before running' : ''}>
                <span><Button size="small" variant="contained" color="success" startIcon={<Play size={14} />} disabled={dirty} onClick={() => setRunOpen(true)} data-testid="workflow-run">Run</Button></span>
              </Tooltip>
            )}
          </>
        }
      />
      {globalIssues.map((i, k) => <Alert key={k} severity={i.level === 'error' ? 'error' : 'warning'}>{i.message}</Alert>)}
      {issues && issues.length > 0 && <div className="text-[12px] text-text-3">{issues.filter((i) => i.level === 'error').length} error(s), {issues.filter((i) => i.level === 'warning').length} warning(s). Nodes with errors are outlined in red.</div>}

      <div className="grid gap-3 grid-cols-1 xl:grid-cols-[180px_1fr_340px]">
        {canEdit && (
          <aside className="cs-card p-2 flex xl:flex-col gap-1 overflow-x-auto" aria-label="Node palette">
            <div className="cs-label px-1.5 py-1 hidden xl:block">Add step</div>
            {PALETTE.map((t) => {
              const Icon = NODE_META[t].icon;
              return (
                <Tooltip key={t} title={NODE_META[t].description} placement="right">
                  <button type="button" onClick={() => addNode(t)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-surface-2 whitespace-nowrap text-left" data-testid={`palette-${t}`}>
                    <span className="h-5 w-5 rounded flex items-center justify-center text-white shrink-0" style={{ background: NODE_META[t].color }}><Icon size={11} /></span>
                    {NODE_META[t].label}
                  </button>
                </Tooltip>
              );
            })}
          </aside>
        )}
        <div className={`cs-card overflow-hidden ${canEdit ? '' : 'xl:col-span-2'}`} style={{ height: 'calc(100vh - 250px)', minHeight: 460 }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={canEdit ? onNodesChange : undefined}
            onEdgesChange={canEdit ? onEdgesChange : undefined}
            onConnect={onConnect}
            onNodeClick={(_, n) => { setSelectedId(n.id); setSide('node'); }}
            onPaneClick={() => setSelectedId(null)}
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
            colorMode={mode}
            fitView
            fitViewOptions={{ padding: 0.2 }}
          >
            <Background gap={18} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeStrokeWidth={3} />
          </ReactFlow>
        </div>
        <aside className="cs-card p-3 flex flex-col gap-3 self-start" aria-label="Inspector">
          <Tabs value={side} onChange={(_, v) => setSide(v)} variant="fullWidth">
            <Tab value="node" label="Step" />
            <Tab value="runs" label="Runs" />
            <Tab value="versions" label="Versions" />
          </Tabs>
          {side === 'node' && (
            selected ? (
              <NodeInspector node={selected} readOnly={!canEdit} issues={issuesFor(selected.id)} onChange={updateSelected} onDelete={removeSelected} />
            ) : (
              <div className="flex flex-col gap-3">
                <TextField label="Description" size="small" multiline minRows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} />
                <div className="text-[12px] text-text-3">Select a step to configure it. Drag from a step's right handle to another step to connect them. Use <code>{'{{input.field}}'}</code> or <code>{'{{nodes.<id>.output.text}}'}</code> in instructions to pass data along.</div>
                {workflow.graph.inputSchema && <div className="text-[12px]"><span className="cs-label">Run input fields</span> {Object.keys(workflow.graph.inputSchema).join(', ')}</div>}
              </div>
            )
          )}
          {side === 'runs' && <RunsList workflowId={workflow.id} />}
          {side === 'versions' && <VersionsList workflowId={workflow.id} canRestore={canEdit} onRestore={(g) => { const f = graphToFlow(g); setNodes(f.nodes); setEdges(f.edges); setIssues(null); notify('Version loaded into the editor. Save to make it current.', 'info'); }} />}
        </aside>
      </div>
      {runOpen && <RunDialog workflow={workflow} onClose={() => setRunOpen(false)} onStarted={(ex) => navigate(`/workflows/executions/${ex.id}`)} onInvalid={setIssues} />}
    </div>
  );
}

function NodeInspector({ node, readOnly, issues, onChange, onDelete }: { node: CsNode; readOnly: boolean; issues: WorkflowValidationIssue[]; onChange: (patch: Partial<CsNodeData>) => void; onDelete: () => void }) {
  const agents = useAgents();
  const members = useMembers();
  const d = node.data;
  const t = d.nodeType;
  const num = (v: string) => (v === '' ? undefined : Number(v));
  return (
    <div className="flex flex-col gap-3" data-testid="node-inspector">
      <div className="flex items-center gap-2">
        <span className="cs-label flex-1">{NODE_META[t].label} · <code className="normal-case">{node.id}</code></span>
        {!readOnly && t !== 'START' && <Tooltip title="Delete step"><IconButton size="small" onClick={onDelete} aria-label="Delete step"><Trash2 size={15} /></IconButton></Tooltip>}
      </div>
      {issues.map((i, k) => <Alert key={k} severity={i.level === 'error' ? 'error' : 'warning'} sx={{ py: 0 }}>{i.message}</Alert>)}
      <TextField label="Label" size="small" value={d.label ?? ''} onChange={(e) => onChange({ label: e.target.value })} disabled={readOnly} />
      {t === 'AGENT' && (
        <>
          <TextField select label="Agent" size="small" value={d.agentId ?? ''} onChange={(e) => onChange({ agentId: e.target.value })} disabled={readOnly} inputProps={{ 'data-testid': 'node-agent' }}>
            {(agents.data?.items ?? []).filter((a) => a.status !== 'ARCHIVED').map((a) => <MenuItem key={a.id} value={a.id}>{a.name} · {a.category.toLowerCase().replace(/_/g, ' ')}</MenuItem>)}
          </TextField>
          <TextField label="Task title" size="small" value={d.taskTitle ?? ''} onChange={(e) => onChange({ taskTitle: e.target.value })} disabled={readOnly} />
          <TextField label="Instructions" size="small" multiline minRows={4} value={d.instructions ?? ''} onChange={(e) => onChange({ instructions: e.target.value })} disabled={readOnly} helperText="The previous step's output is appended automatically." />
        </>
      )}
      {t === 'PROMPT' && <TextField label="Template" size="small" multiline minRows={4} value={d.template ?? ''} onChange={(e) => onChange({ template: e.target.value })} disabled={readOnly} helperText="Supports {{input.x}} and {{nodes.<id>.output.text}}" />}
      {t === 'TOOL' && (
        <>
          <TextField select label="Read-only tool" size="small" value={d.toolId ?? ''} onChange={(e) => onChange({ toolId: e.target.value })} disabled={readOnly}>
            {READ_TOOLS.map((tool) => <MenuItem key={tool.id} value={tool.id}>{tool.name}</MenuItem>)}
          </TextField>
          <JsonField label="Tool input (JSON)" value={d.toolInput ?? {}} onChange={(v) => onChange({ toolInput: v })} disabled={readOnly} />
        </>
      )}
      {t === 'CONDITION' && <TextField label="Expression" size="small" value={d.expression ?? ''} onChange={(e) => onChange({ expression: e.target.value })} disabled={readOnly} helperText={'e.g. nodes.review.output.text contains "approved" — connect both the true and false handles'} />}
      {t === 'APPROVAL' && (
        <>
          <TextField label="Approval title" size="small" value={d.approvalTitle ?? ''} onChange={(e) => onChange({ approvalTitle: e.target.value })} disabled={readOnly} />
          <TextField select label="Risk" size="small" value={d.risk ?? 'MEDIUM'} onChange={(e) => onChange({ risk: e.target.value as CsNodeData['risk'] })} disabled={readOnly} helperText="Higher risk requires more senior approvers">
            {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
          </TextField>
        </>
      )}
      {t === 'DELAY' && <TextField label="Delay (seconds)" type="number" size="small" value={d.delayMs !== undefined ? Math.round(d.delayMs / 1000) : ''} onChange={(e) => onChange({ delayMs: e.target.value === '' ? undefined : Number(e.target.value) * 1000 })} disabled={readOnly} inputProps={{ min: 0 }} />}
      {t === 'HUMAN_TASK' && (
        <TextField select label="Assignee (optional)" size="small" value={d.assigneeUserId ?? ''} onChange={(e) => onChange({ assigneeUserId: e.target.value || undefined })} disabled={readOnly}>
          <MenuItem value="">Anyone with execute permission</MenuItem>
          {(members.data?.members ?? []).map((m) => <MenuItem key={m.userId} value={m.userId}>{m.name}</MenuItem>)}
        </TextField>
      )}
      {t !== 'START' && t !== 'END' && (
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Retries" type="number" size="small" value={d.retries ?? ''} onChange={(e) => onChange({ retries: num(e.target.value) })} disabled={readOnly} inputProps={{ min: 0, max: 5 }} />
          <TextField label="Timeout (s)" type="number" size="small" value={d.timeoutMs !== undefined ? Math.round(d.timeoutMs / 1000) : ''} onChange={(e) => onChange({ timeoutMs: e.target.value === '' ? undefined : Number(e.target.value) * 1000 })} disabled={readOnly} inputProps={{ min: 1 }} />
          <TextField select label="On error" size="small" value={d.onError ?? 'FAIL'} onChange={(e) => onChange({ onError: e.target.value as 'FAIL' | 'CONTINUE' })} disabled={readOnly} className="col-span-2">
            <MenuItem value="FAIL">Fail the workflow</MenuItem>
            <MenuItem value="CONTINUE">Continue to next step</MenuItem>
          </TextField>
        </div>
      )}
    </div>
  );
}

function JsonField({ label, value, onChange, disabled }: { label: string; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; disabled?: boolean }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);
  return (
    <TextField
      label={label}
      size="small"
      multiline
      minRows={3}
      value={text}
      disabled={disabled}
      error={Boolean(error)}
      helperText={error ?? 'Must be a JSON object'}
      onChange={(e) => {
        setText(e.target.value);
        try {
          const parsed = JSON.parse(e.target.value || '{}');
          if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) throw new Error('Must be a JSON object');
          setError(null);
          onChange(parsed as Record<string, unknown>);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
      InputProps={{ sx: { fontFamily: 'ui-monospace, monospace', fontSize: 12 } }}
    />
  );
}

function RunsList({ workflowId }: { workflowId: string }) {
  const navigate = useNavigate();
  const runs = useWorkflowExecutions(workflowId);
  if (runs.isPending) return <div className="text-[12.5px] text-text-3">Loading…</div>;
  if (runs.isError) return <ErrorState error={runs.error} compact />;
  if (runs.data.items.length === 0) return <EmptyState title="No runs yet" compact />;
  return (
    <div className="flex flex-col gap-1.5 max-h-[60vh] overflow-y-auto">
      {runs.data.items.map((r) => (
        <button key={r.id} type="button" onClick={() => navigate(`/workflows/executions/${r.id}`)} className="text-left rounded-lg border border-border px-2.5 py-2 hover:bg-surface-2 flex items-center gap-2">
          <StatusChip status={r.status} pulse={r.status === 'RUNNING'} />
          <span className="text-[12px] flex-1">v{r.version}{r.dryRun ? ' · dry run' : ''}</span>
          <span className="text-[11px] text-text-3">{timeAgo(r.createdAt)}</span>
        </button>
      ))}
    </div>
  );
}

function VersionsList({ workflowId, canRestore, onRestore }: { workflowId: string; canRestore: boolean; onRestore: (g: WorkflowGraph) => void }) {
  const versions = useQuery({ queryKey: ['workflow-versions', workflowId], queryFn: () => api.get<{ items: Array<{ id: string; version: number; changeSummary: string | null; createdAt: string; createdBy: { name: string } | null; graph: WorkflowGraph }> }>(`/workflows/${workflowId}/versions`) });
  if (versions.isPending) return <div className="text-[12.5px] text-text-3">Loading…</div>;
  if (versions.isError) return <ErrorState error={versions.error} compact />;
  return (
    <div className="flex flex-col gap-1.5 max-h-[60vh] overflow-y-auto">
      {versions.data.items.map((v, i) => (
        <div key={v.id} className="rounded-lg border border-border px-2.5 py-2 text-[12px]">
          <div className="flex items-center gap-2"><History size={12} className="text-text-3" /><span className="font-semibold">v{v.version}</span>{i === 0 && <span className="text-success text-[11px]">current</span>}<span className="flex-1" />{canRestore && i > 0 && <Button size="small" onClick={() => onRestore(v.graph)}>Load</Button>}</div>
          <div className="text-text-2">{v.changeSummary ?? '—'}</div>
          <div className="text-text-3 text-[11px]">{v.createdBy?.name ?? 'system'} · {dateTime(v.createdAt)}</div>
        </div>
      ))}
    </div>
  );
}

function RunDialog({ workflow, onClose, onStarted, onInvalid }: { workflow: WorkflowDto; onClose: () => void; onStarted: (ex: WorkflowExecutionDto) => void; onInvalid: (issues: WorkflowValidationIssue[]) => void }) {
  const notify = useUiStore((s) => s.notify);
  const fields = Object.keys(workflow.graph.inputSchema ?? {});
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f, ''])));
  const [extra, setExtra] = useState('{}');
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsedExtra = JSON.parse(extra || '{}') as Record<string, unknown>;
      const ex = await api.post<WorkflowExecutionDto>(`/workflows/${workflow.id}/${dryRun ? 'dry-run' : 'execute'}`, { input: { ...parsedExtra, ...values }, dryRun });
      notify(dryRun ? 'Dry run finished' : 'Workflow started', 'success');
      onStarted(ex);
    } catch (err) {
      const details = (err as { details?: unknown }).details;
      if (Array.isArray(details)) onInvalid(details as WorkflowValidationIssue[]);
      setError(err instanceof SyntaxError ? 'Additional input must be valid JSON' : errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>Run {workflow.name}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <div className="flex flex-col gap-3 pt-1">
          {fields.map((f, i) => <TextField key={f} label={f} size="small" value={values[f] ?? ''} onChange={(e) => setValues({ ...values, [f]: e.target.value })} autoFocus={i === 0} inputProps={{ 'data-testid': `run-input-${f}` }} />)}
          <TextField label={fields.length ? 'Additional input (JSON, optional)' : 'Input (JSON)'} size="small" multiline minRows={2} value={extra} onChange={(e) => setExtra(e.target.value)} InputProps={{ sx: { fontFamily: 'ui-monospace, monospace', fontSize: 12 } }} />
          <FormControlLabel control={<Checkbox size="small" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />} label={<span className="text-[13px] inline-flex items-center gap-1"><FlaskConical size={13} /> Dry run: simulate every step without calling agents or tools</span>} />
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={busy}>Cancel</Button>
        <Button variant="contained" color="success" startIcon={<Play size={14} />} onClick={run} disabled={busy} data-testid="workflow-run-confirm">{busy ? 'Starting…' : dryRun ? 'Dry run' : 'Run'}</Button>
      </DialogActions>
    </Dialog>
  );
}
