import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Button, Checkbox, LinearProgress, MenuItem, TextField, Tooltip } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ClipboardList, Plus, Search, XCircle } from 'lucide-react';
import { canCancel, TASK_STATUSES, TASK_STATUS_LABELS, type TaskDto } from '@collabspace/shared';
import { useAgents, useProjects, useTasks } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { DashboardTabs } from '@/components/common/DashboardTabs';
import { AgentAvatar } from '@/components/common/AgentAvatar';
import { StatusChip } from '@/components/common/StatusChip';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState, InlineRefreshing } from '@/components/common/States';
import { Pager } from '@/components/common/Pager';
import { ShimmerTable } from '@/components/shimmer';
import { useDebounced } from '@/layout/CommandSearch';
import { duration, timeAgo, usd } from '@/lib/format';
import { TaskComposer } from './TaskComposer';
import { TaskDetailDrawer } from './TaskDetailDrawer';

const PAGE_SIZE = 25;
type SortKey = 'createdAt' | 'priority' | 'status' | 'title' | 'duration';
const COLUMNS: Array<{ label: string; sort?: SortKey }> = [
  { label: 'Task', sort: 'title' },
  { label: 'Agent' },
  { label: 'Status', sort: 'status' },
  { label: 'Priority', sort: 'priority' },
  { label: 'Duration', sort: 'duration' },
  { label: 'Est. cost' },
  { label: 'Created', sort: 'createdAt' },
];

export function TasksPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const canCreate = useCan('task.create');
  const canCancelPerm = useCan('task.cancel');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortKey>('createdAt');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = useState<string[]>([]);
  const [composer, setComposer] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const debounced = useDebounced(search, 250);
  const status = params.get('status') ?? '';
  const agentId = params.get('agentId') ?? '';
  const projectId = params.get('projectId') ?? '';
  const priority = params.get('priority') ?? '';
  const tasks = useTasks({ search: debounced || undefined, status: status || undefined, agentId: agentId || undefined, projectId: projectId || undefined, priority: priority || undefined, sort, order, page, pageSize: PAGE_SIZE });
  const agents = useAgents();
  const projects = useProjects();
  const items = tasks.data?.items ?? [];
  const cancellable = items.filter((t) => selected.includes(t.id) && canCancel(t.status));

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setPage(1);
    setSelected([]);
  };

  const toggleSort = (key: SortKey) => {
    if (sort === key) setOrder(order === 'asc' ? 'desc' : 'asc');
    else {
      setSort(key);
      setOrder('desc');
    }
  };

  const bulkCancel = async () => {
    setConfirmBulk(false);
    try {
      const res = await api.post<{ results: Array<{ id: string; ok: boolean; message?: string }> }>('/agent-tasks/bulk-cancel', { taskIds: cancellable.map((t) => t.id) });
      const failed = res.results.filter((r) => !r.ok).length;
      notify(`Cancellation requested for ${res.results.length - failed} task(s)${failed ? `, ${failed} could not be cancelled` : ''}`, failed ? 'warning' : 'success');
      setSelected([]);
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const openTask = (t: TaskDto) => navigate({ pathname: `/tasks/${t.id}`, search: params.toString() });
  const closeTask = () => navigate({ pathname: '/tasks', search: params.toString() });

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle={<span className="inline-flex items-center gap-2">Every job your agents have queued, run or finished <InlineRefreshing active={tasks.isFetching && !tasks.isPending} /></span>}
        actions={
          <>
            {canCancelPerm && selected.length > 0 && (
              <Button size="small" variant="outlined" color="error" startIcon={<XCircle size={14} />} disabled={cancellable.length === 0} onClick={() => setConfirmBulk(true)}>
                Cancel {cancellable.length} selected
              </Button>
            )}
            {canCreate && (
              <Button variant="contained" size="small" startIcon={<Plus size={15} />} onClick={() => setComposer(true)} data-testid="new-task-button">
                New task
              </Button>
            )}
          </>
        }
        tabs={<DashboardTabs />}
      />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <TextField size="small" placeholder="Search tasks" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} InputProps={{ startAdornment: <Search size={14} className="mr-1.5 text-text-3" /> }} sx={{ minWidth: 220 }} inputProps={{ 'aria-label': 'Search tasks' }} />
        <TextField size="small" select label="Status" value={status} onChange={(e) => setFilter('status', e.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value="">All statuses</MenuItem>
          {TASK_STATUSES.map((s) => <MenuItem key={s} value={s}>{TASK_STATUS_LABELS[s]}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Agent" value={agentId} onChange={(e) => setFilter('agentId', e.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value="">All agents</MenuItem>
          {(agents.data?.items ?? []).map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Project" value={projectId} onChange={(e) => setFilter('projectId', e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">All projects</MenuItem>
          {(projects.data?.items ?? []).map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Priority" value={priority} onChange={(e) => setFilter('priority', e.target.value)} sx={{ minWidth: 120 }}>
          <MenuItem value="">Any</MenuItem>
          {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
        </TextField>
        {(status || agentId || projectId || priority) && <Button size="small" onClick={() => { setParams({}, { replace: true }); setPage(1); }}>Clear filters</Button>}
      </div>

      {tasks.isPending && <ShimmerTable rows={8} headers={['', ...COLUMNS.map((c) => c.label)]} />}
      {tasks.isError && <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />}
      {tasks.data && items.length === 0 && (
        <div className="cs-card">
          <EmptyState icon={ClipboardList} title="No tasks match" description={status || agentId || search ? 'Try clearing the filters.' : 'Assign work to an AI team member to get started.'} action={canCreate ? <Button variant="contained" size="small" onClick={() => setComposer(true)}>Assign a task</Button> : undefined} />
        </div>
      )}
      {items.length > 0 && (
        <div className="cs-card overflow-x-auto">
          <table className="w-full text-left text-[13px]" data-testid="tasks-table">
            <thead>
              <tr className="bg-surface-2 border-b border-border">
                <th className="px-3 py-2 w-8">
                  <Checkbox size="small" sx={{ p: 0 }} checked={selected.length > 0 && selected.length === items.length} indeterminate={selected.length > 0 && selected.length < items.length} onChange={(e) => setSelected(e.target.checked ? items.map((t) => t.id) : [])} inputProps={{ 'aria-label': 'Select all tasks' }} />
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.label} className="px-3 py-2 cs-label whitespace-nowrap">
                    {c.sort ? (
                      <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-text" onClick={() => toggleSort(c.sort!)}>
                        {c.label}
                        {sort === c.sort && (order === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((t) => (
                <tr key={t.id} className={`hover:bg-surface-2/60 cursor-pointer ${t.id === id ? 'bg-primary-soft/40' : ''}`} onClick={() => openTask(t)} data-testid={`task-row-${t.id}`}>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <Checkbox size="small" sx={{ p: 0 }} checked={selected.includes(t.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, t.id] : selected.filter((x) => x !== t.id))} inputProps={{ 'aria-label': `Select ${t.title}` }} />
                  </td>
                  <td className="px-3 py-2.5 max-w-[360px]">
                    <div className="font-medium truncate">{t.title}</div>
                    {t.status === 'RUNNING' ? (
                      <div className="mt-1 flex items-center gap-2"><LinearProgress variant="determinate" value={t.progress} sx={{ flex: 1, maxWidth: 160 }} /><span className="text-[11px] text-text-3 truncate">{t.progressMessage}</span></div>
                    ) : (
                      <div className="text-[11.5px] text-text-3 truncate">{t.project?.name ?? 'No project'}{t.errorMessage && t.status === 'FAILED' ? ` · ${t.errorMessage}` : ''}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><AgentAvatar avatar={t.agent.avatar} color={t.agent.color} name={t.agent.name} size={22} />{t.agent.name}</span></td>
                  <td className="px-3 py-2.5"><StatusChip status={t.status} pulse={t.status === 'RUNNING'} /></td>
                  <td className="px-3 py-2.5 text-text-2">{t.priority.toLowerCase()}</td>
                  <td className="px-3 py-2.5 text-text-2 whitespace-nowrap">{duration(t.durationMs)}</td>
                  <td className="px-3 py-2.5 text-text-2 whitespace-nowrap"><Tooltip title={t.usage.hasUnavailable ? 'Some requests returned no usage metadata' : ''}><span>{usd(t.usage.estimatedCostUsd, { estimate: true })}</span></Tooltip></td>
                  <td className="px-3 py-2.5 text-text-3 whitespace-nowrap">{timeAgo(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} pageSize={PAGE_SIZE} total={tasks.data?.total ?? 0} onPage={(p) => { setPage(p); setSelected([]); }} />
        </div>
      )}
      {composer && <TaskComposer open onClose={() => setComposer(false)} initial={{ agentId: agentId || undefined, projectId: projectId || null }} />}
      <TaskDetailDrawer taskId={id ?? null} onClose={closeTask} />
      <ConfirmDialog open={confirmBulk} title={`Cancel ${cancellable.length} task(s)?`} description="Running tasks stop at the next safe point. Completed or already-cancelled tasks in the selection are skipped." confirmLabel="Cancel tasks" destructive onClose={() => setConfirmBulk(false)} onConfirm={bulkCancel} />
    </div>
  );
}
