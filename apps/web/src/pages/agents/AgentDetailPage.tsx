import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Chip, Collapse, LinearProgress, Tab, Tabs } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, ListPlus, MessageSquare, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { AGENT_CATEGORY_LABELS, renderInstructions, TOOL_CATALOG, type AgentDto } from '@collabspace/shared';
import { useAgent, useAgentActivity, useAgentVersions, useKnowledge, useTasks } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { AgentAvatar } from '@/components/common/AgentAvatar';
import { StatusChip, RiskChip } from '@/components/common/StatusChip';
import { Markdown } from '@/components/common/Markdown';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState } from '@/components/common/States';
import { ShimmerAgentDetail, ShimmerExecutionTimeline, ShimmerTable } from '@/components/shimmer';
import { TaskComposer } from '@/pages/tasks/TaskComposer';
import { dateTime, duration, timeAgo, usd } from '@/lib/format';

const TABS = ['Overview', 'Tasks', 'Activity', 'Versions', 'Knowledge'] as const;

export function AgentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const setWizardOpen = useUiStore((s) => s.setWizardOpen);
  const setChatAgentId = useUiStore((s) => s.setChatAgentId);
  const setChatOpen = useUiStore((s) => s.setChatOpen);
  const canEdit = useCan('agent.edit');
  const canCreate = useCan('agent.create');
  const canDelete = useCan('agent.delete');
  const canTask = useCan('task.create');
  const agent = useAgent(id);
  const [tab, setTab] = useState(0);
  const [assign, setAssign] = useState(false);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);

  const act = async (path: string, message: string, method: 'post' | 'delete' = 'post') => {
    try {
      await (method === 'post' ? api.post(path) : api.delete(path));
      void qc.invalidateQueries({ queryKey: ['agents'] });
      void qc.invalidateQueries({ queryKey: ['agent', id] });
      notify(message, 'success');
      return true;
    } catch (err) {
      notify(errorMessage(err), 'error');
      return false;
    }
  };

  const duplicate = async () => {
    try {
      const copy = await api.post<AgentDto>(`/agents/${id}/duplicate`);
      void qc.invalidateQueries({ queryKey: ['agents'] });
      notify(`${copy.name} created`, 'success');
      navigate(`/team/${copy.id}`);
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  if (agent.isPending) return <div className="cs-card p-4"><ShimmerAgentDetail /></div>;
  if (agent.isError) return <div className="cs-card"><ErrorState error={agent.error} onRetry={() => agent.refetch()} /></div>;
  const a = agent.data;
  const archived = a.status === 'ARCHIVED';

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'AI Team Members', to: '/team' }, { label: a.name }]}
        title={
          <span className="inline-flex items-center gap-3">
            <AgentAvatar avatar={a.avatar} color={a.color} name={a.name} size={40} status={a.status} />
            <span>
              {a.name}
              <span className="block text-[12.5px] font-normal text-text-3">{AGENT_CATEGORY_LABELS[a.category]} · version {a.currentVersion}{a.project ? ` · ${a.project.name}` : ''}</span>
            </span>
            <StatusChip status={a.status} pulse={a.status === 'WORKING'} />
          </span>
        }
        actions={
          <>
            {!archived && <Button size="small" variant="outlined" startIcon={<MessageSquare size={14} />} onClick={() => { setChatAgentId(a.id); setChatOpen(true); }}>Chat</Button>}
            {canTask && !archived && <Button size="small" variant="contained" startIcon={<ListPlus size={14} />} onClick={() => setAssign(true)} data-testid="agent-assign-task">Assign task</Button>}
            {canEdit && !archived && <Button size="small" variant="outlined" startIcon={<Pencil size={14} />} onClick={() => setWizardOpen(true, a.id)}>Edit</Button>}
            {canCreate && <Button size="small" variant="outlined" startIcon={<Copy size={14} />} onClick={duplicate}>Duplicate</Button>}
            {canEdit && !archived && a.status !== 'PAUSED' && <Button size="small" variant="outlined" startIcon={<Pause size={14} />} onClick={() => act(`/agents/${a.id}/pause`, 'Agent paused')}>Pause</Button>}
            {canEdit && a.status === 'PAUSED' && <Button size="small" variant="outlined" startIcon={<Play size={14} />} onClick={() => act(`/agents/${a.id}/resume`, 'Agent resumed')}>Resume</Button>}
            {canDelete && !archived && <Button size="small" variant="outlined" color="error" startIcon={<Archive size={14} />} onClick={() => setConfirm('archive')}>Archive</Button>}
            {canDelete && archived && <Button size="small" variant="outlined" color="error" startIcon={<Trash2 size={14} />} onClick={() => setConfirm('delete')}>Delete</Button>}
          </>
        }
      />
      {a.lastError && <div className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-[12.5px] mb-3"><span className="font-semibold text-danger">Last error:</span> <span className="text-text-2">{a.lastError}</span></div>}
      {a.currentTask && (
        <Link to={`/tasks/${a.currentTask.id}`} className="cs-card cs-card-hover p-3 mb-3 flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-[13px]"><span className="font-medium truncate">Current task: {a.currentTask.title}</span><StatusChip status={a.currentTask.status} /></div>
          {(a.currentTask.status === 'RUNNING' || a.currentTask.status === 'WAITING_APPROVAL') && <LinearProgress variant="determinate" value={a.currentTask.progress} color={a.currentTask.status === 'WAITING_APPROVAL' ? 'warning' : 'primary'} />}
          <span className="text-[11.5px] text-text-3">{a.currentTask.progressMessage ?? ''}</span>
        </Link>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-[12px]">
        {[['Total tasks', a.stats.totalTasks], ['Completed', a.stats.completedTasks], ['Active', a.stats.runningTasks], ['Failed', a.stats.failedTasks]].map(([label, value]) => (
          <div key={label} className="cs-card px-3 py-2.5"><div className="cs-label">{label}</div><div className="text-[18px] font-semibold">{value}</div></div>
        ))}
      </div>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2, borderBottom: '1px solid var(--cs-border)' }}>
        {TABS.map((t) => <Tab key={t} label={t} />)}
      </Tabs>
      {tab === 0 && <OverviewTab agent={a} />}
      {tab === 1 && <AgentTasksTab agentId={a.id} />}
      {tab === 2 && <ActivityTab agentId={a.id} />}
      {tab === 3 && <VersionsTab agentId={a.id} />}
      {tab === 4 && <KnowledgeTab agent={a} />}
      {assign && <TaskComposer open onClose={() => setAssign(false)} initial={{ agentId: a.id, projectId: a.projectId }} />}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'delete' ? `Delete ${a.name} permanently?` : `Archive ${a.name}?`}
        description={confirm === 'delete' ? 'The agent configuration is removed. Task history and audit records are kept.' : 'Queued tasks will be paused. Archived agents can be deleted afterwards.'}
        confirmLabel={confirm === 'delete' ? 'Delete' : 'Archive'}
        destructive
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const which = confirm;
          setConfirm(null);
          if (which === 'archive') await act(`/agents/${a.id}/archive`, 'Agent archived');
          if (which === 'delete' && (await act(`/agents/${a.id}`, 'Agent deleted', 'delete'))) navigate('/team');
        }}
      />
    </div>
  );
}

function OverviewTab({ agent: a }: { agent: AgentDto }) {
  return (
    <div className="grid gap-4 grid-cols-1 xl:grid-cols-[1.3fr_1fr]">
      <div className="cs-card p-4">
        <div className="cs-label mb-2">Instructions</div>
        {a.description && <p className="text-[13px] text-text-2 mb-3">{a.description}</p>}
        <Markdown>{renderInstructions(a.instructions)}</Markdown>
      </div>
      <div className="flex flex-col gap-4">
        <div className="cs-card p-4 text-[12.5px] flex flex-col gap-1.5">
          <div className="cs-label mb-1">Model</div>
          <div>Provider: <strong>{a.modelConfig.provider ?? 'server default'}</strong></div>
          <div>Model: <strong>{a.modelConfig.model ?? 'server default'}</strong></div>
          <div>Max output tokens: {a.modelConfig.maxOutputTokens} · timeout {Math.round(a.modelConfig.timeoutMs / 60000)} min · retries {a.modelConfig.maxRetries}</div>
          <div>Per-task token limit: {a.modelConfig.maxTokensPerTask ?? 'none'} · budget {a.modelConfig.budgetUsd !== null ? usd(a.modelConfig.budgetUsd) : 'workspace policies'}</div>
        </div>
        <div className="cs-card p-4">
          <div className="cs-label mb-2">Tools ({a.tools.length})</div>
          {a.tools.length === 0 && <div className="text-[12.5px] text-text-3">No tools granted. The agent can only reason over its context.</div>}
          <div className="flex flex-col gap-1.5">
            {a.tools.map((t) => {
              const def = TOOL_CATALOG[t];
              return (
                <div key={t} className="flex items-center gap-2 text-[12.5px]">
                  <span className="flex-1 truncate">{def?.name ?? t}</span>
                  {def && <RiskChip risk={def.risk} />}
                  {def?.requiresApproval && <Chip size="small" label="approval" variant="outlined" color="warning" />}
                </div>
              );
            })}
          </div>
        </div>
        <div className="cs-card p-4 text-[12.5px] text-text-2">
          <div className="cs-label mb-1">Lifecycle</div>
          <div>Created {dateTime(a.createdAt)} · updated {timeAgo(a.updatedAt)}</div>
          <div>Last activity {a.lastActivityAt ? timeAgo(a.lastActivityAt) : 'never'}</div>
          {a.archivedAt && <div>Archived {dateTime(a.archivedAt)}</div>}
        </div>
      </div>
    </div>
  );
}

function AgentTasksTab({ agentId }: { agentId: string }) {
  const navigate = useNavigate();
  const tasks = useTasks({ agentId, pageSize: 25 });
  if (tasks.isPending) return <ShimmerTable rows={5} headers={['Task', 'Status', 'Duration', 'Cost', 'Created']} />;
  if (tasks.isError) return <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />;
  if (tasks.data.items.length === 0) return <div className="cs-card"><EmptyState title="No tasks yet" description="Assign a task to see it here." compact /></div>;
  return (
    <div className="cs-card overflow-x-auto">
      <table className="w-full text-left text-[13px]">
        <thead><tr className="bg-surface-2 border-b border-border">{['Task', 'Status', 'Duration', 'Est. cost', 'Created'].map((h) => <th key={h} className="px-3 py-2 cs-label">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-border">
          {tasks.data.items.map((t) => (
            <tr key={t.id} className="hover:bg-surface-2/60 cursor-pointer" onClick={() => navigate(`/tasks/${t.id}`)}>
              <td className="px-3 py-2.5 max-w-[380px]"><div className="font-medium truncate">{t.title}</div></td>
              <td className="px-3 py-2.5"><StatusChip status={t.status} pulse={t.status === 'RUNNING'} /></td>
              <td className="px-3 py-2.5 text-text-2">{duration(t.durationMs)}</td>
              <td className="px-3 py-2.5 text-text-2">{usd(t.usage.estimatedCostUsd, { estimate: true })}</td>
              <td className="px-3 py-2.5 text-text-3 whitespace-nowrap">{timeAgo(t.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {tasks.data.total > tasks.data.items.length && <div className="px-3 py-2 text-[12px]"><Link to={`/tasks?agentId=${agentId}`} className="text-accent hover:underline">View all {tasks.data.total} tasks</Link></div>}
    </div>
  );
}

function ActivityTab({ agentId }: { agentId: string }) {
  const activity = useAgentActivity(agentId);
  if (activity.isPending) return <div className="cs-card p-4"><ShimmerExecutionTimeline /></div>;
  if (activity.isError) return <ErrorState error={activity.error} onRetry={() => activity.refetch()} />;
  if (activity.data.items.length === 0) return <div className="cs-card"><EmptyState title="No activity yet" compact /></div>;
  return (
    <div className="cs-card divide-y divide-border">
      {activity.data.items.map((e) => (
        <Link key={e.id} to={`/tasks/${e.taskId}`} className="flex items-start gap-3 px-4 py-2.5 hover:bg-surface-2/60">
          <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${e.level === 'ERROR' ? 'bg-danger' : e.level === 'WARNING' ? 'bg-warning' : e.level === 'SUCCESS' ? 'bg-success' : 'bg-text-3'}`} aria-label={e.level.toLowerCase()} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px]">{e.message}</div>
            <div className="text-[11.5px] text-text-3 truncate">{e.type.toLowerCase().replace(/_/g, ' ')} · {e.taskTitle} · {dateTime(e.createdAt)}{e.durationMs !== null ? ` · ${duration(e.durationMs)}` : ''}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function VersionsTab({ agentId }: { agentId: string }) {
  const versions = useAgentVersions(agentId);
  const [open, setOpen] = useState<string | null>(null);
  if (versions.isPending) return <ShimmerTable rows={4} headers={['Version', 'Change', 'Author', 'Date']} />;
  if (versions.isError) return <ErrorState error={versions.error} onRetry={() => versions.refetch()} />;
  return (
    <div className="cs-card divide-y divide-border">
      {versions.data.items.map((v) => (
        <div key={v.id} className="px-4 py-3">
          <button type="button" className="w-full flex items-center gap-3 text-left" onClick={() => setOpen(open === v.id ? null : v.id)} aria-expanded={open === v.id}>
            <Chip size="small" label={`v${v.version}`} color="primary" variant="outlined" />
            <span className="flex-1 text-[13px] truncate">{v.changeSummary ?? 'No summary'}</span>
            <span className="text-[11.5px] text-text-3 whitespace-nowrap">{v.createdBy?.name ?? 'system'} · {dateTime(v.createdAt)}</span>
          </button>
          <Collapse in={open === v.id} unmountOnExit>
            <div className="mt-3 grid gap-3 grid-cols-1 lg:grid-cols-[1.4fr_1fr]">
              <div className="rounded-lg border border-border bg-surface-2 p-3 max-h-80 overflow-y-auto"><Markdown>{renderInstructions(v.instructions)}</Markdown></div>
              <div className="text-[12.5px] text-text-2 flex flex-col gap-1">
                <div><span className="cs-label">Model</span> {v.modelConfig.provider ?? 'default'} / {v.modelConfig.model ?? 'default'}</div>
                <div><span className="cs-label">Tools</span> {v.tools.map((t) => TOOL_CATALOG[t]?.name ?? t).join(', ') || 'none'}</div>
              </div>
            </div>
          </Collapse>
        </div>
      ))}
    </div>
  );
}

function KnowledgeTab({ agent: a }: { agent: AgentDto }) {
  const knowledge = useKnowledge({ pageSize: 100 });
  const linked = (knowledge.data?.items ?? []).filter((k) => a.knowledge.sourceIds.includes(k.id) || k.agentIds.includes(a.id));
  return (
    <div className="flex flex-col gap-3">
      <div className="cs-card p-4 text-[12.5px] flex flex-wrap gap-2">
        <Chip size="small" label="Project documents" color={a.knowledge.allowProjectDocuments ? 'success' : 'default'} variant={a.knowledge.allowProjectDocuments ? 'filled' : 'outlined'} />
        <Chip size="small" label="Workspace knowledge base" color={a.knowledge.allowWorkspaceKnowledge ? 'success' : 'default'} variant={a.knowledge.allowWorkspaceKnowledge ? 'filled' : 'outlined'} />
        <Chip size="small" label="Previous reports" color={a.knowledge.allowPreviousReports ? 'success' : 'default'} variant={a.knowledge.allowPreviousReports ? 'filled' : 'outlined'} />
      </div>
      {knowledge.isPending && <ShimmerTable rows={3} headers={['Source', 'Type', 'Status']} />}
      {knowledge.data && linked.length === 0 && <div className="cs-card"><EmptyState title="No specific sources" description="Grant sources in the agent editor or from the Knowledge Base page." compact /></div>}
      {linked.length > 0 && (
        <div className="cs-card divide-y divide-border">
          {linked.map((k) => (
            <div key={k.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              <span className="flex-1 truncate font-medium">{k.title}</span>
              <span className="text-[11.5px] text-text-3">{k.type.toLowerCase()} · {k.chunkCount} chunks</span>
              <StatusChip status={k.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
