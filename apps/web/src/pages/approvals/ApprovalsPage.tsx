import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Alert, Button, Tab, Tabs } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Check, CheckSquare, MessageSquareWarning, X } from 'lucide-react';
import { TOOL_CATALOG } from '@collabspace/shared';
import { useApproval, useApprovals, type ApprovalWithPermission } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { useUiStore } from '@/store/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { DashboardTabs } from '@/components/common/DashboardTabs';
import { AgentAvatar } from '@/components/common/AgentAvatar';
import { StatusChip, RiskChip } from '@/components/common/StatusChip';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState, InlineRefreshing } from '@/components/common/States';
import { Pager } from '@/components/common/Pager';
import { ShimmerAgentDetail, ShimmerTable } from '@/components/shimmer';
import { dateTime, timeAgo, titleCase } from '@/lib/format';

const FILTERS = [
  { label: 'Pending', value: 'PENDING' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Executed', value: 'EXECUTED' },
  { label: 'Changes requested', value: 'CHANGES_REQUESTED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'All', value: '' },
];
const PAGE_SIZE = 20;

export function ApprovalsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('PENDING');
  const [page, setPage] = useState(1);
  const approvals = useApprovals({ status: filter || undefined, page, pageSize: PAGE_SIZE });
  const items = approvals.data?.items ?? [];
  const activeId = id ?? null;

  return (
    <div>
      <PageHeader
        title="Approval Center"
        subtitle={<span className="inline-flex items-center gap-2">{approvals.data ? `${approvals.data.pending} pending` : 'Human review of sensitive agent actions'} <InlineRefreshing active={approvals.isFetching && !approvals.isPending} /></span>}
        tabs={<DashboardTabs />}
      />
      <Tabs value={filter} onChange={(_, v) => { setFilter(v); setPage(1); }} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2 }}>
        {FILTERS.map((f) => <Tab key={f.label} value={f.value} label={f.label} />)}
      </Tabs>
      <div className={`grid gap-4 grid-cols-1 ${activeId ? 'xl:grid-cols-[1fr_1.2fr]' : ''}`}>
        <div className={activeId ? 'hidden xl:block' : ''}>
          {approvals.isPending && <ShimmerTable rows={5} headers={['Action', 'Agent', 'Risk', 'Status', 'Requested']} />}
          {approvals.isError && <ErrorState error={approvals.error} onRetry={() => approvals.refetch()} />}
          {approvals.data && items.length === 0 && (
            <div className="cs-card"><EmptyState icon={CheckSquare} title={filter === 'PENDING' ? 'Nothing waiting for review' : 'No approvals here'} description="When an agent asks to perform a sensitive action, the request lands here for a human decision." /></div>
          )}
          {items.length > 0 && (
            <div className="cs-card divide-y divide-border" data-testid="approvals-list">
              {items.map((a) => (
                <button key={a.id} type="button" onClick={() => navigate(`/approvals/${a.id}`)} className={`w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-surface-2/60 transition-colors ${a.id === activeId ? 'bg-primary-soft/40' : ''}`}>
                  {a.agent ? <AgentAvatar avatar={a.agent.avatar} color={a.agent.color} name={a.agent.name} size={30} /> : <div className="h-[30px] w-[30px] rounded-lg bg-surface-3" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{a.actionTitle}</div>
                    <div className="text-[11.5px] text-text-3 truncate">{a.agent?.name ?? 'Workflow'}{a.targetResource ? ` → ${a.targetResource}` : ''} · {timeAgo(a.createdAt)}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <RiskChip risk={a.risk} />
                    {a.status !== 'PENDING' && <StatusChip status={a.status} />}
                  </div>
                </button>
              ))}
              <Pager page={page} pageSize={PAGE_SIZE} total={approvals.data?.total ?? 0} onPage={setPage} />
            </div>
          )}
        </div>
        {activeId && <ApprovalDetail id={activeId} onClose={() => navigate('/approvals')} />}
      </div>
    </div>
  );
}

function ApprovalDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const approval = useApproval(id);
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const [dialog, setDialog] = useState<'approve' | 'reject' | 'request-changes' | null>(null);
  const [busy, setBusy] = useState(false);

  const decide = async (action: 'approve' | 'reject' | 'request-changes', a: ApprovalWithPermission, comment?: string) => {
    setBusy(true);
    try {
      await api.post(`/approvals/${a.id}/${action}`, { comment: comment || undefined, proposalVersion: a.proposalVersion });
      notify(action === 'approve' ? 'Approved. The agent will continue.' : action === 'reject' ? 'Rejected' : 'Changes requested from the agent', 'success');
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      void qc.invalidateQueries({ queryKey: ['approval', a.id] });
      if (a.taskId) void qc.invalidateQueries({ queryKey: ['task', a.taskId] });
    } catch (err) {
      notify(errorMessage(err), 'error');
      void qc.invalidateQueries({ queryKey: ['approval', a.id] });
    } finally {
      setBusy(false);
      setDialog(null);
    }
  };

  if (approval.isPending) return <div className="cs-card p-4"><ShimmerAgentDetail /></div>;
  if (approval.isError) return <div className="cs-card"><ErrorState error={approval.error} onRetry={() => approval.refetch()} /></div>;
  const a = approval.data;
  const tool = a.toolId ? TOOL_CATALOG[a.toolId] : undefined;
  const pending = a.status === 'PENDING';

  return (
    <div className="cs-card p-4 flex flex-col gap-4 self-start" data-testid="approval-detail">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap"><h2 className="text-[16px] font-semibold">{a.actionTitle}</h2><RiskChip risk={a.risk} /><StatusChip status={a.status} /></div>
          <div className="text-[12px] text-text-3 mt-1 flex items-center gap-1.5 flex-wrap">
            {a.agent && <><AgentAvatar avatar={a.agent.avatar} color={a.agent.color} name={a.agent.name} size={18} />{a.agent.name} ·</>}
            requested {dateTime(a.createdAt)}{a.expiresAt ? ` · expires ${dateTime(a.expiresAt)}` : ''} · proposal v{a.proposalVersion}
          </div>
        </div>
        <Button size="small" color="inherit" onClick={onClose} aria-label="Close approval" sx={{ minWidth: 0 }}><X size={16} /></Button>
      </div>
      {pending && !a.canDecide && <Alert severity="info">Your role cannot decide {a.risk.toLowerCase()}-risk approvals. An owner or admin must review this request.</Alert>}
      <div className="text-[13px] text-text-2 whitespace-pre-wrap">{a.actionDescription}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12.5px]">
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2"><div className="cs-label">Tool</div>{tool?.name ?? a.toolId ?? 'Workflow approval step'}</div>
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2"><div className="cs-label">Target</div><span className="break-all">{a.targetResource ?? '—'}</span></div>
        {a.task && <div className="rounded-lg border border-border bg-surface-2 px-3 py-2"><div className="cs-label">Task</div><Link to={`/tasks/${a.task.id}`} className="text-accent hover:underline">{a.task.title}</Link> <StatusChip status={a.task.status} /></div>}
        {a.workflowExecutionId && <div className="rounded-lg border border-border bg-surface-2 px-3 py-2"><div className="cs-label">Workflow</div><Link to={`/workflows/executions/${a.workflowExecutionId}`} className="text-accent hover:underline">Open execution</Link></div>}
      </div>
      {a.diff && (a.diff.before !== null || a.diff.after !== null) && (
        <div>
          <div className="cs-label mb-1">Proposed change</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <pre className="text-[11.5px] rounded-lg border border-danger/30 bg-danger-soft/50 p-2 overflow-auto max-h-72 whitespace-pre-wrap">{a.diff.before ?? '(empty)'}</pre>
            <pre className="text-[11.5px] rounded-lg border border-success/30 bg-success-soft/50 p-2 overflow-auto max-h-72 whitespace-pre-wrap">{a.diff.after ?? '(empty)'}</pre>
          </div>
        </div>
      )}
      <div>
        <div className="cs-label mb-1">Exact proposal (what will run if approved)</div>
        <pre className="text-[11.5px] rounded-lg border border-border bg-surface-2 p-2 overflow-auto max-h-72">{JSON.stringify(a.proposal, null, 2)}</pre>
        <div className="text-[10.5px] text-text-3 mt-1">Hash {a.proposalHash.slice(0, 16)}… The decision is bound to this version; if the agent revises the proposal you will be asked again.</div>
      </div>
      {a.evidence && Object.keys(a.evidence).length > 0 && (
        <div>
          <div className="cs-label mb-1">Evidence</div>
          <pre className="text-[11.5px] rounded-lg border border-border bg-surface-2 p-2 overflow-auto max-h-56">{JSON.stringify(a.evidence, null, 2)}</pre>
        </div>
      )}
      {a.decisions.length > 0 && (
        <div>
          <div className="cs-label mb-1">Decisions</div>
          <ul className="flex flex-col gap-1.5">
            {a.decisions.map((d) => (
              <li key={d.id} className="text-[12.5px] rounded-lg border border-border px-3 py-2">
                <span className="font-medium">{titleCase(d.decision)}</span> by {d.decidedBy.name} · {dateTime(d.createdAt)}
                {d.comment && <div className="text-text-2 mt-0.5 whitespace-pre-wrap">“{d.comment}”</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {pending && a.canDecide && (
        <div className="flex flex-wrap gap-2 pt-1 border-t border-border">
          <Button variant="contained" color="success" startIcon={<Check size={15} />} onClick={() => setDialog('approve')} disabled={busy} data-testid="approval-approve">Approve</Button>
          <Button variant="outlined" color="warning" startIcon={<MessageSquareWarning size={15} />} onClick={() => setDialog('request-changes')} disabled={busy}>Request changes</Button>
          <Button variant="outlined" color="error" startIcon={<X size={15} />} onClick={() => setDialog('reject')} disabled={busy} data-testid="approval-reject">Reject</Button>
        </div>
      )}
      <ConfirmDialog
        key={dialog ?? 'none'}
        open={dialog !== null}
        title={dialog === 'approve' ? 'Approve this action?' : dialog === 'reject' ? 'Reject this action?' : 'Request changes?'}
        description={dialog === 'approve' ? 'The agent will execute exactly the proposal shown.' : dialog === 'reject' ? 'The agent is told the action was rejected and continues without it.' : 'The agent receives your comment and may submit a revised proposal.'}
        confirmLabel={dialog === 'approve' ? 'Approve' : dialog === 'reject' ? 'Reject' : 'Send'}
        destructive={dialog === 'reject'}
        withComment
        commentLabel={dialog === 'request-changes' ? 'What should change?' : 'Comment (optional)'}
        busy={busy}
        onClose={() => setDialog(null)}
        onConfirm={(comment) => dialog && decide(dialog, a, comment)}
      />
    </div>
  );
}
