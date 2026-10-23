import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, Collapse, TextField } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Background, Controls, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronDown, ChevronRight, Pause, Play, UserCheck, XCircle } from 'lucide-react';
import type { WorkflowExecutionDto, WorkflowNodeType } from '@collabspace/shared';
import { useWorkflow, useWorkflowExecution } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { useResolvedMode } from '@/theme/ThemeProvider';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusChip } from '@/components/common/StatusChip';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ErrorState, InlineRefreshing } from '@/components/common/States';
import { ShimmerPage } from '@/components/shimmer';
import { dateTime, duration } from '@/lib/format';
import { graphToFlow, NODE_META, nodeTypes } from './flow';

const ACTIVE = ['PENDING', 'RUNNING', 'WAITING'];

export function WorkflowExecutionPage() {
  const { executionId } = useParams();
  const execution = useWorkflowExecution(executionId);
  const workflow = useWorkflow(execution.data?.workflowId);
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const mode = useResolvedMode();
  const canExecute = useCan('workflow.execute');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const flow = useMemo(() => {
    if (!workflow.data || !execution.data) return null;
    const byNode = new Map(execution.data.nodes.map((n) => [n.nodeId, n]));
    return graphToFlow(workflow.data.graph, (id) => ({ status: byNode.get(id)?.status ?? 'PENDING' }));
  }, [workflow.data, execution.data]);

  const act = async (path: string, message: string, body?: unknown) => {
    try {
      const res = await api.post<WorkflowExecutionDto>(`/workflows/executions/${executionId}/${path}`, body);
      qc.setQueryData(['workflow-execution', executionId], res);
      void qc.invalidateQueries({ queryKey: ['workflow-executions'] });
      notify(message, 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  if (execution.isPending) return <ShimmerPage />;
  if (execution.isError) return <div className="cs-card"><ErrorState error={execution.error} onRetry={() => execution.refetch()} /></div>;
  const ex = execution.data;
  const active = ACTIVE.includes(ex.status);
  const ordered = [...ex.nodes].sort((a, b) => (a.startedAt ?? '9').localeCompare(b.startedAt ?? '9'));

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        crumbs={[{ label: 'Agent Workflows', to: '/workflows' }, { label: workflow.data?.name ?? 'Workflow', to: `/workflows/${ex.workflowId}` }, { label: 'Execution' }]}
        title={<span className="inline-flex items-center gap-2">{workflow.data?.name ?? 'Workflow'} run <StatusChip status={ex.status} pulse={ex.status === 'RUNNING'} /></span>}
        subtitle={<span className="inline-flex items-center gap-2">v{ex.version}{ex.dryRun ? ' · dry run (no agents or tools were called)' : ''} · started {dateTime(ex.startedAt ?? ex.createdAt)}{ex.completedAt ? ` · finished ${dateTime(ex.completedAt)}` : ''} <InlineRefreshing active={execution.isFetching} /></span>}
        actions={
          canExecute && (
            <>
              {ex.status === 'PAUSED' && <Button size="small" variant="contained" startIcon={<Play size={14} />} onClick={() => act('resume', 'Execution resumed')}>Resume</Button>}
              {active && <Button size="small" variant="outlined" startIcon={<Pause size={14} />} onClick={() => act('pause', 'Execution paused')}>Pause</Button>}
              {(active || ex.status === 'PAUSED') && <Button size="small" variant="outlined" color="error" startIcon={<XCircle size={14} />} onClick={() => setConfirmCancel(true)}>Cancel</Button>}
            </>
          )
        }
      />
      {ex.errorMessage && <div className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-[12.5px]"><span className="font-semibold text-danger">Failed:</span> <span className="text-text-2">{ex.errorMessage}</span></div>}

      <div className="grid gap-3 grid-cols-1 xl:grid-cols-[1.2fr_1fr]">
        <div className="cs-card overflow-hidden" style={{ height: 460 }}>
          {flow ? (
            <ReactFlowProvider>
              <ReactFlow nodes={flow.nodes} edges={flow.edges.map((e) => ({ ...e, animated: ex.nodes.some((n) => n.nodeId === e.source && n.status === 'COMPLETED') && ex.nodes.some((n) => n.nodeId === e.target && ACTIVE.includes(n.status)) }))} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} colorMode={mode} fitView fitViewOptions={{ padding: 0.2 }}>
                <Background gap={18} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </ReactFlowProvider>
          ) : (
            <div className="p-4"><ShimmerPage /></div>
          )}
        </div>
        <div className="cs-card p-3 flex flex-col gap-2 text-[12.5px]">
          <div className="cs-label">Input</div>
          <pre className="text-[11.5px] rounded-lg border border-border bg-surface-2 p-2 overflow-auto max-h-40">{JSON.stringify(ex.input, null, 2)}</pre>
          {ex.output && (
            <>
              <div className="cs-label">Output</div>
              <pre className="text-[11.5px] rounded-lg border border-border bg-surface-2 p-2 overflow-auto max-h-64 whitespace-pre-wrap">{typeof ex.output.text === 'string' ? ex.output.text : JSON.stringify(ex.output, null, 2)}</pre>
            </>
          )}
        </div>
      </div>

      <section className="cs-card divide-y divide-border" aria-label="Steps" data-testid="execution-steps">
        {ordered.map((n) => {
          const type = n.nodeType as WorkflowNodeType;
          const meta = NODE_META[type];
          const Icon = meta?.icon;
          const expanded = open === n.id;
          const took = n.startedAt && n.completedAt ? new Date(n.completedAt).getTime() - new Date(n.startedAt).getTime() : null;
          return (
            <div key={n.id} className="px-4 py-2.5">
              <button type="button" className="w-full flex items-center gap-3 text-left" onClick={() => setOpen(expanded ? null : n.id)} aria-expanded={expanded}>
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {Icon && <span className="h-6 w-6 rounded-md flex items-center justify-center text-white shrink-0" style={{ background: meta.color }}><Icon size={13} /></span>}
                <span className="flex-1 min-w-0"><span className="text-[13px] font-medium">{n.label ?? meta?.label ?? n.nodeId}</span><span className="text-[11.5px] text-text-3"> · {meta?.label ?? n.nodeType}{n.attempt > 1 ? ` · attempt ${n.attempt}` : ''}{took !== null ? ` · ${duration(took)}` : ''}</span></span>
                <StatusChip status={n.status} pulse={n.status === 'RUNNING'} />
              </button>
              {n.status === 'WAITING' && (
                <div className="mt-2 ml-7 flex flex-wrap items-center gap-2 text-[12.5px]">
                  {n.approvalId && <Link to={`/approvals/${n.approvalId}`} className="text-accent hover:underline">Waiting for approval: review it</Link>}
                  {n.taskId && <Link to={`/tasks/${n.taskId}`} className="text-accent hover:underline">Open the agent task</Link>}
                  {type === 'HUMAN_TASK' && canExecute && <HumanTaskComplete onComplete={(note) => act(`nodes/${n.nodeId}/complete`, 'Step completed', { note: note || undefined })} />}
                </div>
              )}
              <Collapse in={expanded} unmountOnExit>
                <div className="mt-2 ml-7 flex flex-col gap-2 text-[12px]">
                  {n.taskId && <Link to={`/tasks/${n.taskId}`} className="text-accent hover:underline">Agent task</Link>}
                  {n.errorMessage && <div className="text-danger">{n.errorMessage}</div>}
                  {n.logs.length > 0 && (
                    <ol className="flex flex-col gap-0.5">
                      {n.logs.map((l, i) => <li key={i} className={l.level === 'error' ? 'text-danger' : l.level === 'warn' ? 'text-warning' : 'text-text-2'}><span className="text-text-3">{dateTime(l.at, 'HH:mm:ss')}</span> {l.message}</li>)}
                    </ol>
                  )}
                  {n.output && <pre className="text-[11px] rounded-lg border border-border bg-surface-2 p-2 overflow-auto max-h-56 whitespace-pre-wrap">{JSON.stringify(n.output, null, 2)}</pre>}
                </div>
              </Collapse>
            </div>
          );
        })}
      </section>
      <ConfirmDialog open={confirmCancel} title="Cancel this run?" description="Running agent tasks are cancelled and pending approvals withdrawn." confirmLabel="Cancel run" destructive onClose={() => setConfirmCancel(false)} onConfirm={() => { setConfirmCancel(false); void act('cancel', 'Execution cancelled'); }} />
    </div>
  );
}

function HumanTaskComplete({ onComplete }: { onComplete: (note: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <span className="inline-flex items-center gap-2">
      <TextField size="small" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} sx={{ minWidth: 220 }} />
      <Button size="small" variant="contained" startIcon={<UserCheck size={14} />} onClick={() => onComplete(note)} data-testid="human-task-complete">Mark done</Button>
    </span>
  );
}
