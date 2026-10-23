import { useState } from 'react';
import { Link } from 'react-router';
import { Button, Drawer, IconButton, LinearProgress, Tab, Tabs, Tooltip, useMediaQuery, useTheme, Chip } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Download, RefreshCw, X, XCircle, Eye, Send } from 'lucide-react';
import { TOOL_CATALOG } from '@collabspace/shared';
import { useTask, useTaskArtifacts, useApprovals } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { AgentAvatar } from '@/components/common/AgentAvatar';
import { StatusChip } from '@/components/common/StatusChip';
import { Markdown } from '@/components/common/Markdown';
import { ShimmerAgentDetail } from '@/components/shimmer';
import { ErrorState, EmptyState } from '@/components/common/States';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { ExecutionTimeline } from './ExecutionTimeline';
import { ArtifactPreviewDialog } from '@/pages/files/ArtifactPreviewDialog';
import { bytes, dateTime, duration, timeAgo, tokens, usd } from '@/lib/format';
import { canCancel, canRetry } from '@collabspace/shared';

export function TaskDetailDrawer({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('md'));
  const task = useTask(taskId);
  const artifacts = useTaskArtifacts(taskId);
  const approvals = useApprovals({ taskId: taskId ?? undefined, status: 'PENDING', pageSize: 5 });
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const canCancelPerm = useCan('task.cancel');
  const canRetryPerm = useCan('task.retry');
  const canCreate = useCan('task.create');
  const [tab, setTab] = useState(0);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const t = task.data;

  const act = async (path: string, message: string) => {
    try {
      await api.post(path);
      void qc.invalidateQueries({ queryKey: ['task', taskId] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      notify(message, 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const download = async (id: string, name: string) => {
    const res = await api.download(`/artifacts/${id}/download`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Drawer anchor="right" open={Boolean(taskId)} onClose={onClose} PaperProps={{ sx: { width: fullScreen ? '100vw' : 640, maxWidth: '100vw' } }}>
      <div className="h-full flex flex-col" data-testid="task-drawer">
        <div className="flex items-center gap-2 px-4 h-[var(--cs-header-h)] border-b border-border">
          <span className="cs-label">Task</span>
          {t && <StatusChip status={t.status} pulse={t.status === 'RUNNING'} />}
          <div className="flex-1" />
          <IconButton size="small" onClick={onClose} aria-label="Close task"><X size={16} /></IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {task.isPending && <ShimmerAgentDetail />}
          {task.isError && <ErrorState error={task.error} onRetry={() => task.refetch()} />}
          {t && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-[17px] font-semibold leading-snug">{t.title}</h2>
                <div className="flex items-center gap-2 mt-1.5 text-[12.5px] text-text-3 flex-wrap">
                  <Link to={`/team/${t.agent.id}`} className="inline-flex items-center gap-1.5 hover:text-text"><AgentAvatar avatar={t.agent.avatar} color={t.agent.color} name={t.agent.name} size={20} /> {t.agent.name}</Link>
                  {t.project && <span>· {t.project.name}</span>}
                  <span>· {t.priority.toLowerCase()} priority</span>
                  <span>· created {timeAgo(t.createdAt)}{t.createdBy ? ` by ${t.createdBy.name}` : ''}</span>
                </div>
              </div>
              {(t.status === 'RUNNING' || t.status === 'QUEUED' || t.status === 'WAITING_APPROVAL') && (
                <div>
                  <LinearProgress variant={t.status === 'QUEUED' ? 'indeterminate' : 'determinate'} value={t.progress} color={t.status === 'WAITING_APPROVAL' ? 'warning' : 'primary'} />
                  <div className="text-[12px] text-text-3 mt-1">{t.progressMessage ?? '—'}{t.attempt > 1 ? ` · attempt ${t.attempt}/${t.maxAttempts}` : ''}</div>
                </div>
              )}
              {approvals.data && approvals.data.items.length > 0 && (
                <div className="rounded-lg border border-warning/40 bg-warning-soft p-3 text-[12.5px]">
                  <div className="font-semibold text-warning mb-1">Waiting for human approval</div>
                  {approvals.data.items.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-2"><span>{a.actionTitle}{a.targetResource ? ` → ${a.targetResource}` : ''}</span><Button size="small" component={Link} to={`/approvals/${a.id}`}>Review</Button></div>
                  ))}
                </div>
              )}
              {t.errorMessage && (t.status === 'FAILED' || t.status === 'TIMED_OUT') && (
                <div className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-[12.5px]"><div className="font-semibold text-danger">{t.status === 'TIMED_OUT' ? 'Timed out' : 'Failed'} ({t.failureClass?.toLowerCase()})</div><div className="text-text-2 break-words">{t.errorMessage}</div></div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
                <Stat label="Duration" value={duration(t.durationMs)} />
                <Stat label="Tokens in/out" value={`${tokens(t.usage.inputTokens)} / ${tokens(t.usage.outputTokens)}`} hint={t.usage.hasUnavailable ? 'Some requests returned no usage metadata' : undefined} />
                <Stat label="Est. cost" value={usd(t.usage.estimatedCostUsd, { estimate: true })} />
                <Stat label="Tool calls" value={String(t.usage.toolInvocations)} />
              </div>
              <div className="flex flex-wrap gap-2">
                {canCancelPerm && canCancel(t.status) && <Button size="small" variant="outlined" color="error" startIcon={<XCircle size={14} />} onClick={() => setConfirmCancel(true)}>Cancel</Button>}
                {canRetryPerm && canRetry(t.status) && <Button size="small" variant="contained" startIcon={<RefreshCw size={14} />} onClick={() => act(`/agent-tasks/${t.id}/retry`, 'Task re-queued')} data-testid="task-retry">Retry</Button>}
                {canCreate && t.status === 'DRAFT' && <Button size="small" variant="contained" startIcon={<Send size={14} />} onClick={() => act(`/agent-tasks/${t.id}/publish`, 'Draft published')}>Publish draft</Button>}
                {canCreate && <Button size="small" variant="outlined" startIcon={<Copy size={14} />} onClick={() => act(`/agent-tasks/${t.id}/duplicate`, 'Task duplicated as draft')}>Duplicate</Button>}
              </div>
              <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile>
                <Tab label="Timeline" /><Tab label={`Result`} /><Tab label={`Artifacts (${t.artifactCount})`} /><Tab label="Details" />
              </Tabs>
              {tab === 0 && <ExecutionTimeline taskId={t.id} status={t.status} />}
              {tab === 1 && (t.resultContent ? <div className="cs-card p-3"><Markdown>{t.resultContent}</Markdown></div> : <EmptyState title="No result yet" description={t.status === 'COMPLETED' ? 'The agent finished without a final message.' : 'The result appears here once the task completes.'} compact />)}
              {tab === 2 && (
                <div className="flex flex-col gap-2">
                  {artifacts.data?.items.map((a) => (
                    <div key={a.id} className="cs-card p-3 flex items-center gap-3">
                      <Chip size="small" label={a.type} variant="outlined" />
                      <div className="min-w-0 flex-1"><div className="text-[13px] font-medium truncate">{a.name}</div><div className="text-[11.5px] text-text-3">{bytes(a.size)} · v{a.version} · {dateTime(a.createdAt)}{a.sources.length ? ` · ${a.sources.length} source(s)` : ''}</div></div>
                      <Tooltip title="Preview"><IconButton size="small" onClick={() => setPreview(a.id)} aria-label="Preview"><Eye size={15} /></IconButton></Tooltip>
                      <Tooltip title="Download"><IconButton size="small" onClick={() => download(a.id, a.name)} aria-label="Download" data-testid="artifact-download"><Download size={15} /></IconButton></Tooltip>
                    </div>
                  ))}
                  {artifacts.data && artifacts.data.items.length === 0 && <EmptyState title="No artifacts" description="Reports and files generated by the agent appear here." compact />}
                </div>
              )}
              {tab === 3 && (
                <div className="flex flex-col gap-2 text-[12.5px]">
                  <Detail label="Description"><div className="whitespace-pre-wrap">{t.description || '—'}</div></Detail>
                  <Detail label="Expected deliverable">{t.expectedDeliverable || '—'}</Detail>
                  <Detail label="Allowed tools">{t.allowedTools ? t.allowedTools.map((x) => TOOL_CATALOG[x]?.name ?? x).join(', ') || 'none' : 'All tools granted to the agent'}</Detail>
                  <Detail label="Approval policy">{t.requireApprovalForWrites ? 'Every write action requires approval' : 'High-risk tools require approval'}</Detail>
                  <Detail label="Budget">{t.budgetUsd !== null ? usd(t.budgetUsd) : 'Workspace policies'}</Detail>
                  <Detail label="Scheduling">{t.scheduledFor ? `Scheduled for ${dateTime(t.scheduledFor)}` : 'Immediate'}{t.deadline ? ` · deadline ${dateTime(t.deadline)}` : ''}</Detail>
                  <Detail label="Attempts">{t.attempt} of {t.maxAttempts}</Detail>
                  <Detail label="Agent version">{t.agentVersionId}</Detail>
                  <Detail label="Timestamps">started {dateTime(t.startedAt)} · completed {dateTime(t.completedAt)}</Detail>
                  <Detail label="Task id"><code className="text-[11px]">{t.id}</code></Detail>
                </div>
              )}
            </div>
          )}
        </div>
        <ConfirmDialog open={confirmCancel} title="Cancel this task?" description="Running tasks stop at the next safe point. Pending approvals are withdrawn." confirmLabel="Cancel task" destructive onClose={() => setConfirmCancel(false)} onConfirm={() => { setConfirmCancel(false); void act(`/agent-tasks/${taskId}/cancel`, 'Cancellation requested'); }} />
        <ArtifactPreviewDialog artifactId={preview} onClose={() => setPreview(null)} />
      </div>
    </Drawer>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Tooltip title={hint ?? ''} disableHoverListener={!hint}>
      <div className="rounded-lg border border-border bg-surface-2 px-2.5 py-2"><div className="cs-label">{label}</div><div className="font-semibold text-[13px] mt-0.5">{value}{hint ? '*' : ''}</div></div>
    </Tooltip>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[140px_1fr] gap-2 border-b border-border pb-2"><span className="cs-label">{label}</span><span className="text-text-2 break-words">{children}</span></div>;
}
