import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, Chip, IconButton, MenuItem, TextField, Tooltip } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Eye, FolderOpen, Search, Trash2, Upload } from 'lucide-react';
import { ArtifactType } from '@collabspace/shared';
import { useAgents, useArtifacts, useProjects } from '@/lib/queries';
import { api, errorMessage } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { useCan } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { PageHeader } from '@/components/common/PageHeader';
import { AgentAvatar } from '@/components/common/AgentAvatar';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState, InlineRefreshing } from '@/components/common/States';
import { Pager } from '@/components/common/Pager';
import { ShimmerTable } from '@/components/shimmer';
import { useDebounced } from '@/layout/CommandSearch';
import { bytes, timeAgo } from '@/lib/format';
import { ArtifactPreviewDialog } from './ArtifactPreviewDialog';

const PAGE_SIZE = 20;

export function FilesPage() {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const canUpload = useCan('task.create');
  const canDelete = useCan('artifact.delete');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [agentId, setAgentId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(search, 250);
  const artifacts = useArtifacts({ search: debounced || undefined, type: type || undefined, agentId: agentId || undefined, projectId: projectId || undefined, page, pageSize: PAGE_SIZE });
  const agents = useAgents();
  const projects = useProjects();

  const refresh = () => void qc.invalidateQueries({ queryKey: ['artifacts'] });

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (projectId) form.append('projectId', projectId);
      await api.upload('/artifacts', form);
      notify(`${file.name} uploaded`, 'success');
      refresh();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const duplicate = async (id: string) => {
    try {
      await api.post(`/artifacts/${id}/duplicate`);
      notify('File duplicated', 'success');
      refresh();
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    try {
      await api.delete(`/artifacts/${toDelete.id}`);
      notify(`${toDelete.name} deleted`, 'success');
      refresh();
    } catch (err) {
      notify(errorMessage(err), 'error');
    } finally {
      setToDelete(null);
    }
  };

  const items = artifacts.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Files"
        subtitle={<span className="inline-flex items-center gap-2">Reports, datasets and uploads produced or used by your team <InlineRefreshing active={artifacts.isFetching && !artifacts.isPending} /></span>}
        actions={
          canUpload && (
            <>
              <input ref={fileRef} type="file" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} data-testid="file-upload-input" />
              <Button variant="contained" size="small" startIcon={<Upload size={15} />} onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? 'Uploading…' : 'Upload file'}
              </Button>
            </>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <TextField size="small" placeholder="Search files" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} InputProps={{ startAdornment: <Search size={14} className="mr-1.5 text-text-3" /> }} sx={{ minWidth: 220 }} />
        <TextField size="small" select label="Type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} sx={{ minWidth: 130 }}>
          <MenuItem value="">All types</MenuItem>
          {Object.values(ArtifactType).map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Agent" value={agentId} onChange={(e) => { setAgentId(e.target.value); setPage(1); }} sx={{ minWidth: 150 }}>
          <MenuItem value="">All agents</MenuItem>
          {(agents.data?.items ?? []).map((a) => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Project" value={projectId} onChange={(e) => { setProjectId(e.target.value); setPage(1); }} sx={{ minWidth: 160 }}>
          <MenuItem value="">All projects</MenuItem>
          {(projects.data?.items ?? []).map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
        </TextField>
      </div>

      {artifacts.isPending && <ShimmerTable rows={6} headers={['Name', 'Type', 'Source', 'Size', 'Created', '']} />}
      {artifacts.isError && <ErrorState error={artifacts.error} onRetry={() => artifacts.refetch()} />}
      {artifacts.data && items.length === 0 && (
        <div className="cs-card">
          <EmptyState icon={FolderOpen} title="No files yet" description="Agents save their reports here. You can also upload files to use as task inputs." />
        </div>
      )}
      {items.length > 0 && (
        <div className="cs-card overflow-x-auto">
          <table className="w-full text-left text-[13px]" data-testid="files-table">
            <thead>
              <tr className="bg-surface-2 border-b border-border">
                {['Name', 'Type', 'Source', 'Size', 'Created', ''].map((h) => <th key={h} className="px-3 py-2 cs-label whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((a) => (
                <tr key={a.id} className="hover:bg-surface-2/60">
                  <td className="px-3 py-2.5 max-w-[320px]">
                    <button type="button" className="font-medium truncate block max-w-full text-left hover:text-primary" onClick={() => setPreview(a.id)}>{a.name}</button>
                    {a.version > 1 && <span className="text-[11px] text-text-3">v{a.version}</span>}
                  </td>
                  <td className="px-3 py-2.5"><Chip size="small" label={a.type} variant="outlined" /></td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {a.agent ? (
                      <span className="inline-flex items-center gap-1.5"><AgentAvatar avatar={a.agent.avatar} color={a.agent.color} name={a.agent.name} size={20} />{a.agent.name}{a.taskId && <Link to={`/tasks/${a.taskId}`} className="text-accent text-[11.5px] hover:underline">task</Link>}</span>
                    ) : (
                      <span className="text-text-3">Uploaded{a.createdBy ? ` by ${a.createdBy.name}` : ''}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-text-2 whitespace-nowrap">{bytes(a.size)}</td>
                  <td className="px-3 py-2.5 text-text-3 whitespace-nowrap">{timeAgo(a.createdAt)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right">
                    <Tooltip title="Preview"><IconButton size="small" onClick={() => setPreview(a.id)} aria-label={`Preview ${a.name}`}><Eye size={15} /></IconButton></Tooltip>
                    <Tooltip title="Download"><IconButton size="small" onClick={() => downloadFile(`/artifacts/${a.id}/download`, a.name).catch((err) => notify(errorMessage(err), 'error'))} aria-label={`Download ${a.name}`}><Download size={15} /></IconButton></Tooltip>
                    {canUpload && <Tooltip title="Duplicate"><IconButton size="small" onClick={() => duplicate(a.id)} aria-label={`Duplicate ${a.name}`}><Copy size={15} /></IconButton></Tooltip>}
                    {canDelete && <Tooltip title="Delete"><IconButton size="small" onClick={() => setToDelete({ id: a.id, name: a.name })} aria-label={`Delete ${a.name}`}><Trash2 size={15} /></IconButton></Tooltip>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} pageSize={PAGE_SIZE} total={artifacts.data?.total ?? 0} onPage={setPage} />
        </div>
      )}
      <ArtifactPreviewDialog artifactId={preview} onClose={() => setPreview(null)} />
      <ConfirmDialog open={Boolean(toDelete)} title={`Delete ${toDelete?.name ?? 'file'}?`} description="The file is removed from the workspace. Tasks that referenced it keep their history." confirmLabel="Delete" destructive onClose={() => setToDelete(null)} onConfirm={remove} />
    </div>
  );
}
