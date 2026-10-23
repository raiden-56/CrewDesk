import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Dialog, TextField, List, ListItemButton, ListItemText, InputAdornment } from '@mui/material';
import { Bot, ClipboardList, Search, BookOpen, FolderOpen, Workflow, CheckSquare } from 'lucide-react';
import { useUiStore } from '@/store/ui';
import { useAgents, useArtifacts, useKnowledge, useTasks, useWorkflows } from '@/lib/queries';

export function CommandSearch() {
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 200);
  const agents = useAgents({ search: debounced || undefined, pageSize: 5 });
  const tasks = useTasks({ search: debounced || undefined, pageSize: 5 });
  const knowledge = useKnowledge({ search: debounced || undefined, pageSize: 5 });
  const artifacts = useArtifacts({ search: debounced || undefined, pageSize: 5 });
  const workflows = useWorkflows();

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const results = useMemo(() => {
    const items: Array<{ key: string; label: string; secondary: string; to: string; icon: typeof Bot }> = [];
    const term = debounced.toLowerCase();
    const pages = [
      { label: 'Approvals', to: '/approvals', icon: CheckSquare },
      { label: 'Tasks', to: '/tasks', icon: ClipboardList },
      { label: 'AI Team Members', to: '/team', icon: Bot },
      { label: 'Knowledge Base', to: '/knowledge', icon: BookOpen },
      { label: 'Workflows', to: '/workflows', icon: Workflow },
    ];
    for (const p of pages) if (!term || p.label.toLowerCase().includes(term)) items.push({ key: `page-${p.to}`, label: p.label, secondary: 'Page', to: p.to, icon: p.icon });
    for (const a of agents.data?.items ?? []) items.push({ key: `agent-${a.id}`, label: a.name, secondary: `Agent · ${a.category.toLowerCase().replace('_', ' ')}`, to: `/team/${a.id}`, icon: Bot });
    for (const t of tasks.data?.items ?? []) items.push({ key: `task-${t.id}`, label: t.title, secondary: `Task · ${t.status.toLowerCase()} · ${t.agent.name}`, to: `/tasks/${t.id}`, icon: ClipboardList });
    for (const w of workflows.data?.items ?? []) if (!term || w.name.toLowerCase().includes(term)) items.push({ key: `wf-${w.id}`, label: w.name, secondary: 'Workflow', to: `/workflows/${w.id}`, icon: Workflow });
    for (const k of knowledge.data?.items ?? []) items.push({ key: `k-${k.id}`, label: k.title, secondary: `Knowledge · ${k.type.toLowerCase()}`, to: '/knowledge', icon: BookOpen });
    for (const f of artifacts.data?.items ?? []) items.push({ key: `f-${f.id}`, label: f.name, secondary: `File · ${f.type.toLowerCase()}`, to: '/files', icon: FolderOpen });
    return items.slice(0, 20);
  }, [agents.data, tasks.data, knowledge.data, artifacts.data, workflows.data, debounced]);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm" PaperProps={{ sx: { mt: '8vh', alignSelf: 'flex-start' } }}>
      <div className="p-2">
        <TextField autoFocus fullWidth placeholder="Search agents, tasks, workflows, knowledge, files…" value={q} onChange={(e) => setQ(e.target.value)} InputProps={{ startAdornment: (<InputAdornment position="start"><Search size={16} /></InputAdornment>) }} inputProps={{ 'aria-label': 'Global search' }} />
      </div>
      <List dense sx={{ maxHeight: 400, overflow: 'auto', pb: 1 }}>
        {results.map((r) => {
          const Icon = r.icon;
          return (
            <ListItemButton key={r.key} onClick={() => { setOpen(false); navigate(r.to); }} sx={{ mx: 1, borderRadius: 1.5 }}>
              <Icon size={15} className="mr-3 text-text-3" />
              <ListItemText primary={<span className="text-[13px] font-medium">{r.label}</span>} secondary={<span className="text-[11.5px]">{r.secondary}</span>} />
            </ListItemButton>
          );
        })}
        {results.length === 0 && <div className="px-4 py-6 text-center text-text-3 text-[13px]">No matches.</div>}
      </List>
    </Dialog>
  );
}

export function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
