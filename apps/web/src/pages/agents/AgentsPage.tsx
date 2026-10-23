import { useState } from 'react';
import { Button, FormControlLabel, MenuItem, Switch, TextField } from '@mui/material';
import { Bot, Plus, Search } from 'lucide-react';
import { AGENT_CATEGORIES, AGENT_CATEGORY_LABELS, AgentStatus } from '@collabspace/shared';
import { useAgents, useProjects } from '@/lib/queries';
import { useCan } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { DashboardTabs } from '@/components/common/DashboardTabs';
import { EmptyState, ErrorState, InlineRefreshing } from '@/components/common/States';
import { ShimmerAgentList } from '@/components/shimmer';
import { useDebounced } from '@/layout/CommandSearch';
import { TaskComposer } from '@/pages/tasks/TaskComposer';
import { titleCase } from '@/lib/format';
import { AgentCard } from './AgentCard';

export function AgentsPage() {
  const setWizardOpen = useUiStore((s) => s.setWizardOpen);
  const canCreate = useCan('agent.create');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [projectId, setProjectId] = useState('');
  const [availability, setAvailability] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const debounced = useDebounced(search, 250);
  const agents = useAgents({ search: debounced || undefined, category: category || undefined, status: status || undefined, projectId: projectId || undefined, availability: availability || undefined, includeArchived: includeArchived || undefined });
  const projects = useProjects();
  const items = agents.data?.items ?? [];
  const filtered = Boolean(debounced || category || status || projectId || availability);

  return (
    <div>
      <PageHeader
        title="AI Team Members"
        subtitle={<span className="inline-flex items-center gap-2">{agents.data ? `${agents.data.total} member(s)` : 'Create, configure and monitor your agents'} <InlineRefreshing active={agents.isFetching && !agents.isPending} /></span>}
        actions={canCreate && <Button variant="contained" size="small" startIcon={<Plus size={15} />} onClick={() => setWizardOpen(true)}>New agent</Button>}
        tabs={<DashboardTabs />}
      />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <TextField size="small" placeholder="Search by name or description" value={search} onChange={(e) => setSearch(e.target.value)} InputProps={{ startAdornment: <Search size={14} className="mr-1.5 text-text-3" /> }} sx={{ minWidth: 240 }} inputProps={{ 'aria-label': 'Search agents' }} />
        <TextField size="small" select label="Role" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ minWidth: 170 }}>
          <MenuItem value="">All roles</MenuItem>
          {AGENT_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{AGENT_CATEGORY_LABELS[c]}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 130 }}>
          <MenuItem value="">Any status</MenuItem>
          {Object.values(AgentStatus).filter((s) => s !== 'ARCHIVED').map((s) => <MenuItem key={s} value={s}>{titleCase(s)}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Availability" value={availability} onChange={(e) => setAvailability(e.target.value)} sx={{ minWidth: 130 }}>
          <MenuItem value="">Any</MenuItem>
          <MenuItem value="available">Available</MenuItem>
          <MenuItem value="busy">Busy</MenuItem>
        </TextField>
        <TextField size="small" select label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">All projects</MenuItem>
          {(projects.data?.items ?? []).map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
        </TextField>
        <FormControlLabel control={<Switch size="small" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />} label={<span className="text-[12.5px]">Show archived</span>} />
      </div>

      {agents.isPending && <ShimmerAgentList count={6} />}
      {agents.isError && <ErrorState error={agents.error} onRetry={() => agents.refetch()} />}
      {agents.data && items.length === 0 && (
        <div className="cs-card">
          <EmptyState icon={Bot} title={filtered ? 'No agents match these filters' : 'No team members yet'} description={filtered ? 'Try a broader search.' : 'Create an agent from a role template: researcher, planner, QA reviewer and more.'} action={canCreate && !filtered ? <Button variant="contained" size="small" onClick={() => setWizardOpen(true)}>Create your first agent</Button> : undefined} />
        </div>
      )}
      {items.length > 0 && (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" data-testid="agents-grid">
          {items.map((a) => (
            <AgentCard key={a.id} agent={a} onAssign={a.status !== 'ARCHIVED' ? () => setAssignTo(a.id) : undefined} onEdit={a.status !== 'ARCHIVED' ? () => setWizardOpen(true, a.id) : undefined} />
          ))}
        </div>
      )}
      {assignTo && <TaskComposer open onClose={() => setAssignTo(null)} initial={{ agentId: assignTo }} />}
    </div>
  );
}
