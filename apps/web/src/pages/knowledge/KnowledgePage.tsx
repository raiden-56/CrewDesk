import { useRef, useState } from 'react';
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, ListItemText, MenuItem, Tab, Tabs, TextField, Tooltip } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, FileText, Globe, Plus, RefreshCw, Search, Trash2, Upload, Users } from 'lucide-react';
import { KnowledgeSourceType, KnowledgeStatus, type KnowledgeSourceDto } from '@collabspace/shared';
import { useAgents, useKnowledge, useProjects } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { useCan } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusChip } from '@/components/common/StatusChip';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState, InlineRefreshing } from '@/components/common/States';
import { Pager } from '@/components/common/Pager';
import { ShimmerTable } from '@/components/shimmer';
import { useDebounced } from '@/layout/CommandSearch';
import { bytes, timeAgo } from '@/lib/format';

const PAGE_SIZE = 25;
const TYPE_ICON = { URL: Globe, DOCUMENT: FileText, TEXT: FileText, REPORT: FileText, FOLDER: BookOpen } as const;

export function KnowledgePage() {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const canManage = useCan('knowledge.manage');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [access, setAccess] = useState<KnowledgeSourceDto | null>(null);
  const [revoke, setRevoke] = useState<KnowledgeSourceDto | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const debounced = useDebounced(search, 250);
  const knowledge = useKnowledge({ search: debounced || undefined, type: type || undefined, status: status || undefined, page, pageSize: PAGE_SIZE });
  const agents = useAgents();
  const items = knowledge.data?.items ?? [];
  const agentName = (id: string) => agents.data?.items.find((a) => a.id === id)?.name ?? 'Unknown agent';

  const reindex = async (k: KnowledgeSourceDto) => {
    try {
      await api.post(`/knowledge-sources/${k.id}/reindex`);
      notify(`Re-indexing ${k.title}`, 'success');
      void qc.invalidateQueries({ queryKey: ['knowledge'] });
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const doRevoke = async (hard: boolean) => {
    if (!revoke) return;
    try {
      await api.delete(`/knowledge-sources/${revoke.id}`, hard ? { hard: 'true' } : undefined);
      notify(hard ? 'Source deleted' : 'Source revoked. Agents can no longer read it.', 'success');
      void qc.invalidateQueries({ queryKey: ['knowledge'] });
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setRevoke(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Knowledge Base"
        subtitle={<span className="inline-flex items-center gap-2">Approved documents, notes and URLs your agents may read <InlineRefreshing active={knowledge.isFetching && !knowledge.isPending} /></span>}
        actions={
          <>
            <Button size="small" variant="outlined" startIcon={<Search size={15} />} onClick={() => setSearchOpen(true)}>Test retrieval</Button>
            {canManage && <Button size="small" variant="contained" startIcon={<Plus size={15} />} onClick={() => setAdding(true)} data-testid="knowledge-add">Add source</Button>}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <TextField size="small" placeholder="Search sources" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} InputProps={{ startAdornment: <Search size={14} className="mr-1.5 text-text-3" /> }} sx={{ minWidth: 220 }} />
        <TextField size="small" select label="Type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} sx={{ minWidth: 130 }}>
          <MenuItem value="">All types</MenuItem>
          {Object.values(KnowledgeSourceType).map((t) => <MenuItem key={t} value={t}>{t.toLowerCase()}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 130 }}>
          <MenuItem value="">Any status</MenuItem>
          {Object.values(KnowledgeStatus).map((s) => <MenuItem key={s} value={s}>{s.toLowerCase()}</MenuItem>)}
        </TextField>
      </div>

      {knowledge.isPending && <ShimmerTable rows={6} headers={['Source', 'Status', 'Chunks', 'Agents', 'Updated', '']} />}
      {knowledge.isError && <ErrorState error={knowledge.error} onRetry={() => knowledge.refetch()} />}
      {knowledge.data && items.length === 0 && (
        <div className="cs-card"><EmptyState icon={BookOpen} title="No knowledge sources" description="Upload documents, paste notes or approve URLs. Agents only read sources you grant them." action={canManage ? <Button variant="contained" size="small" onClick={() => setAdding(true)}>Add a source</Button> : undefined} /></div>
      )}
      {items.length > 0 && (
        <div className="cs-card overflow-x-auto">
          <table className="w-full text-left text-[13px]" data-testid="knowledge-table">
            <thead><tr className="bg-surface-2 border-b border-border">{['Source', 'Status', 'Chunks', 'Agents', 'Updated', ''].map((h) => <th key={h} className="px-3 py-2 cs-label whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {items.map((k) => {
                const Icon = TYPE_ICON[k.type] ?? FileText;
                return (
                  <tr key={k.id} className="hover:bg-surface-2/60">
                    <td className="px-3 py-2.5 max-w-[380px]">
                      <div className="flex items-center gap-2"><Icon size={15} className="text-text-3 shrink-0" /><span className="font-medium truncate">{k.title}</span></div>
                      <div className="text-[11.5px] text-text-3 truncate pl-6">{k.url ?? `${k.type.toLowerCase()}${k.size ? ` · ${bytes(k.size)}` : ''}`} · v{k.version}</div>
                    </td>
                    <td className="px-3 py-2.5"><Tooltip title={k.statusMessage ?? ''}><span><StatusChip status={k.status} pulse={k.status === 'PROCESSING'} /></span></Tooltip></td>
                    <td className="px-3 py-2.5 text-text-2">{k.chunkCount}</td>
                    <td className="px-3 py-2.5 text-text-2 max-w-[200px] truncate">{k.agentIds.length === 0 ? <span className="text-text-3">via agent settings</span> : k.agentIds.map(agentName).join(', ')}</td>
                    <td className="px-3 py-2.5 text-text-3 whitespace-nowrap">{timeAgo(k.indexedAt ?? k.updatedAt)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {canManage && k.status !== 'REVOKED' && (
                        <>
                          <Tooltip title="Agent access"><IconButton size="small" onClick={() => setAccess(k)} aria-label={`Agent access for ${k.title}`}><Users size={15} /></IconButton></Tooltip>
                          <Tooltip title="Re-index"><IconButton size="small" onClick={() => reindex(k)} aria-label={`Re-index ${k.title}`}><RefreshCw size={15} /></IconButton></Tooltip>
                        </>
                      )}
                      {canManage && <Tooltip title={k.status === 'REVOKED' ? 'Delete' : 'Revoke'}><IconButton size="small" onClick={() => setRevoke(k)} aria-label={`Revoke ${k.title}`}><Trash2 size={15} /></IconButton></Tooltip>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager page={page} pageSize={PAGE_SIZE} total={knowledge.data?.total ?? 0} onPage={setPage} />
        </div>
      )}
      {adding && <AddSourceDialog onClose={() => setAdding(false)} />}
      {access && <AgentAccessDialog source={access} onClose={() => setAccess(null)} />}
      {searchOpen && <RetrievalTestDialog onClose={() => setSearchOpen(false)} />}
      <ConfirmDialog
        open={Boolean(revoke)}
        title={revoke?.status === 'REVOKED' ? `Delete ${revoke?.title}?` : `Revoke ${revoke?.title ?? 'source'}?`}
        description={revoke?.status === 'REVOKED' ? 'The stored content and its index are removed permanently.' : 'Agents immediately lose access. The source stays listed as revoked so the decision is auditable.'}
        confirmLabel={revoke?.status === 'REVOKED' ? 'Delete' : 'Revoke'}
        destructive
        onClose={() => setRevoke(null)}
        onConfirm={() => doRevoke(revoke?.status === 'REVOKED')}
      />
    </div>
  );
}

function AddSourceDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const projects = useProjects();
  const agents = useAgents();
  const [tab, setTab] = useState<'URL' | 'TEXT' | 'FILE'>('URL');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [projectId, setProjectId] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const valid = tab === 'URL' ? /^https?:\/\/.+/.test(url) : tab === 'TEXT' ? title.trim().length > 0 && content.trim().length > 0 : Boolean(file);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (tab === 'FILE' && file) {
        const form = new FormData();
        form.append('file', file);
        if (projectId) form.append('projectId', projectId);
        if (agentIds.length) form.append('agentIds', agentIds.join(','));
        await api.upload('/knowledge-sources/upload', form);
      } else if (tab === 'URL') {
        await api.post('/knowledge-sources', { type: 'URL', url, title: title || undefined, projectId: projectId || null, agentIds });
      } else {
        await api.post('/knowledge-sources', { type: 'TEXT', title, content, projectId: projectId || null, agentIds });
      }
      notify('Source added. Indexing runs in the background.', 'success');
      void qc.invalidateQueries({ queryKey: ['knowledge'] });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>Add knowledge source</DialogTitle>
      <DialogContent>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab value="URL" label="Approved URL" icon={<Globe size={14} />} iconPosition="start" />
          <Tab value="TEXT" label="Paste text" icon={<FileText size={14} />} iconPosition="start" />
          <Tab value="FILE" label="Upload file" icon={<Upload size={14} />} iconPosition="start" />
        </Tabs>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <div className="flex flex-col gap-3">
          {tab === 'URL' && <TextField label="URL" placeholder="https://example.com/docs" value={url} onChange={(e) => setUrl(e.target.value)} size="small" autoFocus helperText="The page is fetched once and indexed. Only http(s) URLs can be approved." inputProps={{ 'data-testid': 'knowledge-url' }} />}
          {tab !== 'FILE' && <TextField label={tab === 'URL' ? 'Title (optional)' : 'Title'} value={title} onChange={(e) => setTitle(e.target.value)} size="small" inputProps={{ 'data-testid': 'knowledge-title' }} />}
          {tab === 'TEXT' && <TextField label="Content" value={content} onChange={(e) => setContent(e.target.value)} size="small" multiline minRows={6} maxRows={14} inputProps={{ 'data-testid': 'knowledge-content' }} />}
          {tab === 'FILE' && (
            <div className="rounded-lg border border-dashed border-border-strong p-4 flex flex-col items-center gap-2 text-center">
              <input ref={fileRef} type="file" hidden accept=".txt,.md,.csv,.json,.html,.htm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <Button variant="outlined" size="small" startIcon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>Choose file</Button>
              <div className="text-[12px] text-text-3">{file ? `${file.name} · ${bytes(file.size)}` : 'Text, Markdown, CSV, JSON or HTML up to 20 MB'}</div>
            </div>
          )}
          <TextField select label="Project (optional)" value={projectId} onChange={(e) => setProjectId(e.target.value)} size="small">
            <MenuItem value="">Workspace-wide</MenuItem>
            {(projects.data?.items ?? []).map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </TextField>
          <TextField select label="Grant to agents (optional)" value={agentIds} onChange={(e) => setAgentIds(e.target.value as unknown as string[])} size="small" SelectProps={{ multiple: true, renderValue: (v) => (v as string[]).map((id) => agents.data?.items.find((a) => a.id === id)?.name ?? id).join(', ') }}>
            {(agents.data?.items ?? []).map((a) => <MenuItem key={a.id} value={a.id}><Checkbox size="small" checked={agentIds.includes(a.id)} />{a.name}</MenuItem>)}
          </TextField>
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !valid} data-testid="knowledge-submit">{busy ? 'Adding…' : 'Add source'}</Button>
      </DialogActions>
    </Dialog>
  );
}

function AgentAccessDialog({ source, onClose }: { source: KnowledgeSourceDto; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const agents = useAgents();
  const [selected, setSelected] = useState<string[]>(source.agentIds);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.post(`/knowledge-sources/${source.id}/agents`, { agentIds: selected });
      notify('Agent access updated', 'success');
      void qc.invalidateQueries({ queryKey: ['knowledge'] });
      void qc.invalidateQueries({ queryKey: ['agents'] });
      onClose();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>Agent access: {source.title}</DialogTitle>
      <DialogContent dividers>
        <div className="text-[12px] text-text-3 mb-2">Selected agents may retrieve this source during tasks and chat.</div>
        {(agents.data?.items ?? []).map((a) => (
          <label key={a.id} className="flex items-center gap-2 py-1 cursor-pointer">
            <Checkbox size="small" checked={selected.includes(a.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, a.id] : selected.filter((x) => x !== a.id))} />
            <ListItemText primary={<span className="text-[13px]">{a.name}</span>} secondary={<span className="text-[11px]">{a.category.toLowerCase().replace(/_/g, ' ')}</span>} />
          </label>
        ))}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} color="inherit" disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function RetrievalTestDialog({ onClose }: { onClose: () => void }) {
  const agents = useAgents();
  const [q, setQ] = useState('');
  const [agentId, setAgentId] = useState('');
  const [submitted, setSubmitted] = useState<{ q: string; agentId: string } | null>(null);
  const results = useQuery({
    queryKey: ['knowledge-search', submitted],
    queryFn: () => api.get<{ items: Array<{ sourceId: string; title: string; url: string | null; index: number; content: string; score: number }> }>('/knowledge-sources/search', { q: submitted!.q, agentId: submitted!.agentId || undefined }),
    enabled: Boolean(submitted),
  });

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>Test retrieval</DialogTitle>
      <DialogContent dividers>
        <form className="flex flex-wrap gap-2 mb-3" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 2) setSubmitted({ q: q.trim(), agentId }); }}>
          <TextField size="small" label="Query" value={q} onChange={(e) => setQ(e.target.value)} sx={{ flex: 1, minWidth: 220 }} autoFocus />
          <TextField size="small" select label="As agent" value={agentId} onChange={(e) => setAgentId(e.target.value)} sx={{ minWidth: 170 }} helperText="Applies that agent's access rules">
            <MenuItem value="">All workspace sources</MenuItem>
            {(agents.data?.items ?? []).map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
          </TextField>
          <Button type="submit" variant="contained" disabled={q.trim().length < 2}>Search</Button>
        </form>
        {results.isFetching && <ShimmerTable rows={3} headers={['Result']} />}
        {results.isError && <ErrorState error={results.error} compact />}
        {results.data && results.data.items.length === 0 && <EmptyState title="No matching passages" description="Make sure sources are READY and granted to the agent." compact />}
        <div className="flex flex-col gap-2">
          {results.data?.items.map((r, i) => (
            <div key={`${r.sourceId}-${r.index}-${i}`} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2 text-[12.5px]"><span className="font-semibold truncate">{r.title} · chunk {r.index + 1}</span><span className="text-text-3">score {r.score.toFixed(3)}</span></div>
              <div className="text-[12.5px] text-text-2 mt-1 whitespace-pre-wrap line-clamp-6">{r.content}</div>
            </div>
          ))}
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
}
