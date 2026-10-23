import { Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, useMediaQuery, useTheme } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import type { ArtifactDto } from '@collabspace/shared';
import { api, errorMessage } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { useUiStore } from '@/store/ui';
import { Markdown } from '@/components/common/Markdown';
import { ShimmerText } from '@/components/shimmer';
import { EmptyState, ErrorState } from '@/components/common/States';
import { bytes, dateTime } from '@/lib/format';

interface PreviewDto {
  artifact: ArtifactDto;
  previewable: boolean;
  content: string | null;
  truncated?: boolean;
}

function CsvTable({ text }: { text: string }) {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .slice(0, 200)
    .map((line) => line.split(',').map((c) => c.replace(/^"|"$/g, '')));
  const [head, ...body] = rows;
  return (
    <div className="overflow-auto max-h-[60vh] rounded-lg border border-border">
      <table className="w-full text-[12px]">
        <thead className="bg-surface-2 sticky top-0">
          <tr>{head?.map((h, i) => <th key={i} className="px-2 py-1.5 text-left font-semibold border-b border-border">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {body.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className="px-2 py-1">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ArtifactPreviewDialog({ artifactId, onClose }: { artifactId: string | null; onClose: () => void }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('md'));
  const notify = useUiStore((s) => s.notify);
  const preview = useQuery({ queryKey: ['artifact-preview', artifactId], queryFn: () => api.get<PreviewDto>(`/artifacts/${artifactId}/preview`), enabled: Boolean(artifactId) });
  const a = preview.data?.artifact;

  const body = () => {
    if (preview.isPending) return <ShimmerText lines={8} />;
    if (preview.isError) return <ErrorState error={preview.error} onRetry={() => preview.refetch()} compact />;
    const p = preview.data;
    if (!p.previewable || p.content === null) return <EmptyState title="No inline preview" description="This file type cannot be previewed in the browser. Download it instead." compact />;
    if (p.artifact.type === 'MARKDOWN') return <Markdown>{p.content}</Markdown>;
    if (p.artifact.type === 'CSV') return <CsvTable text={p.content} />;
    if (p.artifact.type === 'JSON') {
      let pretty = p.content;
      try {
        pretty = JSON.stringify(JSON.parse(p.content), null, 2);
      } catch {
        /* show raw */
      }
      return <pre className="text-[12px] rounded-lg border border-border bg-surface-2 p-3 overflow-auto max-h-[60vh]">{pretty}</pre>;
    }
    return <pre className="text-[12px] whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3 overflow-auto max-h-[60vh]">{p.content}</pre>;
  };

  return (
    <Dialog open={Boolean(artifactId)} onClose={onClose} maxWidth="md" fullWidth fullScreen={fullScreen} data-testid="artifact-preview">
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="truncate">{a?.name ?? 'Preview'}</span>
          {a && <Chip size="small" label={a.type} variant="outlined" />}
        </div>
        {a && <div className="text-[11.5px] text-text-3 font-normal mt-0.5">{bytes(a.size)} · v{a.version} · {dateTime(a.createdAt)}{a.agent ? ` · by ${a.agent.name}` : a.createdBy ? ` · uploaded by ${a.createdBy.name}` : ''}</div>}
      </DialogTitle>
      <DialogContent dividers>
        {body()}
        {preview.data?.truncated && <div className="text-[11.5px] text-text-3 mt-2">Preview truncated. Download the file for the full content.</div>}
        {a && a.sources.length > 0 && (
          <div className="mt-3">
            <div className="cs-label mb-1">Sources</div>
            <ul className="text-[12px] text-text-2 list-disc pl-5">
              {a.sources.map((s, i) => (
                <li key={i}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">{s.title}</a> : s.title}</li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} color="inherit">Close</Button>
        {a && (
          <Button variant="contained" startIcon={<Download size={14} />} onClick={() => downloadFile(`/artifacts/${a.id}/download`, a.name).catch((err) => notify(errorMessage(err), 'error'))}>
            Download
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
