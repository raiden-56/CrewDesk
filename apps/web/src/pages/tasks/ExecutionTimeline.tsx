import { useMemo, useState } from 'react';
import { Button, IconButton, MenuItem, TextField, Tooltip, Collapse } from '@mui/material';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Circle, Download, Info, Search, XCircle } from 'lucide-react';
import type { ExecutionEventDto, TaskStatus } from '@collabspace/shared';
import { useTaskEvents } from '@/lib/queries';
import { api } from '@/lib/api';
import { dateTime, duration } from '@/lib/format';
import { ShimmerExecutionTimeline } from '@/components/shimmer';
import { EmptyState, ErrorState } from '@/components/common/States';

const FRIENDLY: Record<string, string> = {
  TASK_QUEUED: 'Queued',
  TASK_ACCEPTED: 'Task accepted by worker',
  CONTEXT_RETRIEVED: 'Context prepared',
  MODEL_REQUEST_STARTED: 'Thinking…',
  MODEL_RESPONSE_RECEIVED: 'Model responded',
  TOOL_REQUESTED: 'Tool requested',
  TOOL_AUTHORIZED: 'Tool authorized',
  TOOL_DENIED: 'Tool denied',
  TOOL_EXECUTED: 'Tool executed',
  TOOL_FAILED: 'Tool failed',
  APPROVAL_REQUESTED: 'Waiting for human approval',
  APPROVAL_GRANTED: 'Approved',
  APPROVAL_REJECTED: 'Rejected',
  APPROVAL_CHANGES_REQUESTED: 'Changes requested',
  PROGRESS: 'Progress',
  RETRY_PERFORMED: 'Retry',
  ARTIFACT_GENERATED: 'Artifact generated',
  BUDGET_WARNING: 'Budget warning',
  BUDGET_EXCEEDED: 'Budget exceeded',
  TASK_COMPLETED: 'Completed',
  TASK_FAILED: 'Failed',
  TASK_CANCELLED: 'Cancelled',
  TASK_TIMED_OUT: 'Timed out',
  WORKER_RECOVERED: 'Recovered after worker loss',
};

function LevelIcon({ level }: { level: string }) {
  if (level === 'SUCCESS') return <CheckCircle2 size={15} className="text-success" />;
  if (level === 'WARNING') return <AlertTriangle size={15} className="text-warning" />;
  if (level === 'ERROR') return <XCircle size={15} className="text-danger" />;
  return <Circle size={13} className="text-text-3" />;
}

export function ExecutionTimeline({ taskId, status, compact }: { taskId: string; status: TaskStatus; compact?: boolean }) {
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const events = useTaskEvents(taskId, { search: search || undefined, level: level || undefined });
  const items = useMemo(() => events.data?.items ?? [], [events.data]);
  const live = status === 'RUNNING' || status === 'QUEUED';

  const exportAs = async (format: 'json' | 'csv') => {
    const res = await api.download(`/agent-tasks/${taskId}/events?format=${format}`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `task-${taskId}-events.${format}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="execution-timeline">
      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          <TextField size="small" placeholder="Search events" value={search} onChange={(e) => setSearch(e.target.value)} InputProps={{ startAdornment: <Search size={14} className="mr-1.5 text-text-3" /> }} sx={{ minWidth: 200 }} />
          <TextField size="small" select value={level} onChange={(e) => setLevel(e.target.value)} sx={{ minWidth: 130 }} label="Level">
            <MenuItem value="">All levels</MenuItem>
            {['INFO', 'SUCCESS', 'WARNING', 'ERROR'].map((l) => (<MenuItem key={l} value={l}>{l}</MenuItem>))}
          </TextField>
          <div className="flex-1" />
          <Tooltip title="Export JSON"><IconButton size="small" onClick={() => exportAs('json')} aria-label="Export JSON"><Download size={15} /></IconButton></Tooltip>
          <Button size="small" variant="outlined" onClick={() => exportAs('csv')}>Export CSV</Button>
        </div>
      )}
      {events.isPending && <ShimmerExecutionTimeline steps={compact ? 3 : 6} />}
      {events.isError && <ErrorState error={events.error} onRetry={() => events.refetch()} compact />}
      {events.data && items.length === 0 && <EmptyState title="No events yet" description={live ? 'The worker will publish events as soon as it picks up the task.' : 'Nothing was recorded for this task.'} compact />}
      {items.length > 0 && (
        <ol className="flex flex-col" aria-live={live ? 'polite' : undefined}>
          {items.map((e, i) => {
            const isOpen = open[e.id] ?? false;
            const hasDetails = Boolean(e.metadata && Object.keys(e.metadata).length) || Boolean(e.diagnostics && Object.keys(e.diagnostics).length);
            return (
              <li key={e.id} className="flex gap-3">
                <div className="flex flex-col items-center pt-0.5">
                  <LevelIcon level={e.level} />
                  {i < items.length - 1 && <div className="w-px flex-1 bg-border my-1" />}
                </div>
                <div className={`flex-1 min-w-0 ${compact ? 'pb-2.5' : 'pb-3.5'}`}>
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className="text-[13px] font-medium">{FRIENDLY[e.type] ?? e.type}</span>
                    <span className="text-[11px] text-text-3">{dateTime(e.createdAt)}{e.durationMs !== null ? ` · ${duration(e.durationMs)}` : ''}</span>
                    {hasDetails && (
                      <button type="button" className="ml-auto text-text-3 hover:text-text inline-flex items-center gap-0.5 text-[11px]" onClick={() => setOpen({ ...open, [e.id]: !isOpen })} aria-expanded={isOpen}>
                        {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />} details
                      </button>
                    )}
                  </div>
                  <div className="text-[12.5px] text-text-2 break-words">{e.message}</div>
                  <Collapse in={isOpen} unmountOnExit>
                    <EventDetails event={e} />
                  </Collapse>
                </div>
              </li>
            );
          })}
          {live && (
            <li className="flex gap-3 text-text-3">
              <div className="flex flex-col items-center pt-0.5"><span className="relative inline-flex h-3.5 w-3.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" /><span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-primary/60" /></span></div>
              <div className="text-[12px] pb-2">{status === 'QUEUED' ? 'Waiting for a worker…' : 'Execution in progress…'}</div>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

function EventDetails({ event }: { event: ExecutionEventDto }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {event.metadata && Object.keys(event.metadata).length > 0 && (
        <pre className="text-[11px] rounded-lg border border-border bg-surface-2 p-2 overflow-x-auto max-h-56">{JSON.stringify(event.metadata, null, 2)}</pre>
      )}
      {event.diagnostics && Object.keys(event.diagnostics).length > 0 && (
        <div>
          <div className="text-[10.5px] inline-flex items-center gap-1 text-text-3 mb-1"><Info size={11} /> Diagnostics (visible to administrators)</div>
          <pre className="text-[11px] rounded-lg border border-border bg-surface-2 p-2 overflow-x-auto max-h-72">{JSON.stringify(event.diagnostics, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
