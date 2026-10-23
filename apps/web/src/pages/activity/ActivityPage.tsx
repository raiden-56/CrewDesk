import { useState } from 'react';
import { Link } from 'react-router';
import { Avatar, Collapse, MenuItem, TextField } from '@mui/material';
import { Bot, ChevronDown, ChevronRight, History, Search, Server } from 'lucide-react';
import type { AuditLogDto } from '@collabspace/shared';
import { useAuditLogs, useMembers } from '@/lib/queries';
import { PageHeader } from '@/components/common/PageHeader';
import { DashboardTabs } from '@/components/common/DashboardTabs';
import { EmptyState, ErrorState, InlineRefreshing } from '@/components/common/States';
import { Pager } from '@/components/common/Pager';
import { ShimmerTable } from '@/components/shimmer';
import { useDebounced } from '@/layout/CommandSearch';
import { dateTime, initials, timeAgo } from '@/lib/format';

const PAGE_SIZE = 30;
const RESOURCE_TYPES = ['agent', 'task', 'approval', 'workflow', 'workflowExecution', 'knowledgeSource', 'artifact', 'integration', 'budgetPolicy', 'workspace', 'member', 'project', 'user'];
const ACTION_PREFIXES = ['agent.', 'task.', 'approval.', 'workflow.', 'knowledge.', 'artifact.', 'integration.', 'budget.', 'workspace.', 'member.', 'auth.'];

function resourceLink(log: AuditLogDto): string | null {
  if (!log.resourceId) return null;
  switch (log.resourceType) {
    case 'agent':
      return `/team/${log.resourceId}`;
    case 'task':
      return `/tasks/${log.resourceId}`;
    case 'approval':
      return `/approvals/${log.resourceId}`;
    case 'workflow':
      return `/workflows/${log.resourceId}`;
    case 'workflowExecution':
      return `/workflows/executions/${log.resourceId}`;
    default:
      return null;
  }
}

export function ActivityPage() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [actorId, setActorId] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const debounced = useDebounced(search, 250);
  const logs = useAuditLogs({ search: debounced || undefined, action: action || undefined, resourceType: resourceType || undefined, actorId: actorId || undefined, page, pageSize: PAGE_SIZE });
  const members = useMembers();
  const items = logs.data?.items ?? [];
  const reset = () => setPage(1);

  return (
    <div>
      <PageHeader title="Activity History" subtitle={<span className="inline-flex items-center gap-2">Immutable audit trail of human, agent and system actions <InlineRefreshing active={logs.isFetching && !logs.isPending} /></span>} tabs={<DashboardTabs />} />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <TextField size="small" placeholder="Search action, id or person" value={search} onChange={(e) => { setSearch(e.target.value); reset(); }} InputProps={{ startAdornment: <Search size={14} className="mr-1.5 text-text-3" /> }} sx={{ minWidth: 240 }} />
        <TextField size="small" select label="Action" value={action} onChange={(e) => { setAction(e.target.value); reset(); }} sx={{ minWidth: 140 }}>
          <MenuItem value="">All actions</MenuItem>
          {ACTION_PREFIXES.map((a) => <MenuItem key={a} value={a}>{a.replace('.', '')}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Resource" value={resourceType} onChange={(e) => { setResourceType(e.target.value); reset(); }} sx={{ minWidth: 150 }}>
          <MenuItem value="">All resources</MenuItem>
          {RESOURCE_TYPES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Person" value={actorId} onChange={(e) => { setActorId(e.target.value); reset(); }} sx={{ minWidth: 160 }}>
          <MenuItem value="">Anyone</MenuItem>
          {(members.data?.members ?? []).map((m) => <MenuItem key={m.userId} value={m.userId}>{m.name}</MenuItem>)}
        </TextField>
      </div>
      {logs.isPending && <ShimmerTable rows={10} headers={['When', 'Actor', 'Action', 'Resource']} />}
      {logs.isError && <ErrorState error={logs.error} onRetry={() => logs.refetch()} />}
      {logs.data && items.length === 0 && <div className="cs-card"><EmptyState icon={History} title="No activity recorded" description="Actions appear here as people and agents work." /></div>}
      {items.length > 0 && (
        <div className="cs-card" data-testid="audit-list">
          <ol className="divide-y divide-border">
            {items.map((log) => {
              const link = resourceLink(log);
              const expanded = open === log.id;
              const hasMeta = Boolean(log.metadata && Object.keys(log.metadata).length);
              return (
                <li key={log.id} className="px-4 py-2.5">
                  <div className="flex items-start gap-3">
                    {log.actorType === 'USER' ? (
                      <Avatar sx={{ width: 26, height: 26, fontSize: 11, bgcolor: 'var(--cs-accent)' }}>{log.actor ? initials(log.actor.name) : '?'}</Avatar>
                    ) : (
                      <div className="h-[26px] w-[26px] rounded-full bg-surface-3 text-text-2 flex items-center justify-center">{log.actorType === 'AGENT' ? <Bot size={14} /> : <Server size={14} />}</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px]">
                        <span className="font-medium">{log.actor?.name ?? (log.actorType === 'AGENT' ? 'Agent' : 'System')}</span>{' '}
                        <code className="text-[12px] text-primary">{log.action}</code>{' '}
                        <span className="text-text-3">on {log.resourceType}</span>{' '}
                        {link ? <Link to={link} className="text-accent hover:underline text-[12px]">open</Link> : log.resourceId && <span className="text-text-3 text-[11.5px]">{log.resourceId}</span>}
                      </div>
                      <div className="text-[11.5px] text-text-3" title={dateTime(log.createdAt)}>{timeAgo(log.createdAt)} · {dateTime(log.createdAt, 'MMM d yyyy, HH:mm:ss')}{log.ip ? ` · ${log.ip}` : ''}</div>
                    </div>
                    {hasMeta && (
                      <button type="button" className="text-text-3 hover:text-text inline-flex items-center gap-0.5 text-[11px]" onClick={() => setOpen(expanded ? null : log.id)} aria-expanded={expanded}>
                        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />} details
                      </button>
                    )}
                  </div>
                  <Collapse in={expanded} unmountOnExit>
                    <pre className="mt-2 ml-9 text-[11px] rounded-lg border border-border bg-surface-2 p-2 overflow-x-auto max-h-64">{JSON.stringify(log.metadata, null, 2)}</pre>
                  </Collapse>
                </li>
              );
            })}
          </ol>
          <Pager page={page} pageSize={PAGE_SIZE} total={logs.data?.total ?? 0} onPage={setPage} />
        </div>
      )}
    </div>
  );
}
