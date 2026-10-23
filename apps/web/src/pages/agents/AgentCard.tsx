import { useState } from 'react';
import { useNavigate } from 'react-router';
import { IconButton, LinearProgress, Menu, MenuItem, ListItemIcon, Tooltip } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Copy, MessageSquare, MoreHorizontal, Pause, Play, Pencil, ListPlus, AlertTriangle } from 'lucide-react';
import { AGENT_CATEGORY_LABELS, type AgentDto } from '@collabspace/shared';
import { AgentAvatar } from '@/components/common/AgentAvatar';
import { StatusChip } from '@/components/common/StatusChip';
import { api, errorMessage } from '@/lib/api';
import { useUiStore } from '@/store/ui';
import { useCan } from '@/store/auth';
import { timeAgo } from '@/lib/format';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';

export function AgentCard({ agent, selected, onSelect, onAssign, onEdit }: { agent: AgentDto; selected?: boolean; onSelect?: () => void; onAssign?: () => void; onEdit?: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const setChatAgentId = useUiStore((s) => s.setChatAgentId);
  const setChatOpen = useUiStore((s) => s.setChatOpen);
  const canEdit = useCan('agent.edit');
  const canDelete = useCan('agent.delete');
  const canTask = useCan('task.create');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const action = async (path: string, message: string) => {
    setAnchor(null);
    try {
      await api.post(path);
      void qc.invalidateQueries({ queryKey: ['agents'] });
      void qc.invalidateQueries({ queryKey: ['agent', agent.id] });
      notify(message, 'success');
    } catch (err) {
      notify(errorMessage(err), 'error');
    }
  };

  const running = agent.currentTask && (agent.currentTask.status === 'RUNNING' || agent.currentTask.status === 'WAITING_APPROVAL');
  return (
    <div
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={(e) => { if (onSelect && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(); } }}
      className={`cs-card cs-card-hover p-3.5 flex flex-col gap-2.5 text-left ${selected ? 'ring-2 ring-primary/60 border-primary/50' : ''} ${onSelect ? 'cursor-pointer' : ''}`}
      data-testid={`agent-card-${agent.name}`}
    >
      <div className="flex items-start gap-3">
        <AgentAvatar avatar={agent.avatar} color={agent.color} name={agent.name} size={40} status={agent.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[14px] truncate">{agent.name}</span>
            <StatusChip status={agent.status} pulse={agent.status === 'WORKING'} />
          </div>
          <div className="text-[12px] text-text-3 truncate">{AGENT_CATEGORY_LABELS[agent.category]}{agent.project ? ` · ${agent.project.name}` : ''}</div>
        </div>
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); setAnchor(e.currentTarget); }} aria-label={`Actions for ${agent.name}`}><MoreHorizontal size={16} /></IconButton>
      </div>
      <div className="text-[12.5px] text-text-2 line-clamp-2 min-h-[2.4em]">{agent.description || 'No description'}</div>
      {agent.currentTask ? (
        <div className="rounded-lg bg-surface-2 border border-border px-2.5 py-2">
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <span className="truncate font-medium">{agent.currentTask.title}</span>
            <StatusChip status={agent.currentTask.status} />
          </div>
          {running && (
            <div className="mt-1.5">
              <LinearProgress variant="determinate" value={agent.currentTask.progress} color={agent.currentTask.status === 'WAITING_APPROVAL' ? 'warning' : 'primary'} />
              <div className="text-[11px] text-text-3 mt-1 truncate">{agent.currentTask.progressMessage ?? 'Working…'}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg bg-surface-2 border border-dashed border-border px-2.5 py-2 text-[12px] text-text-3">No current task</div>
      )}
      <div className="flex items-center justify-between text-[11.5px] text-text-3">
        <span>{agent.stats.completedTasks} done · {agent.stats.failedTasks} failed</span>
        <span className="inline-flex items-center gap-1">{agent.lastError && <Tooltip title={agent.lastError}><AlertTriangle size={12} className="text-danger" /></Tooltip>}{agent.lastActivityAt ? `active ${timeAgo(agent.lastActivityAt)}` : 'no activity yet'}</span>
      </div>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} onClick={(e) => e.stopPropagation()}>
        <MenuItem onClick={() => { setAnchor(null); navigate(`/team/${agent.id}`); }}><ListItemIcon><Pencil size={15} /></ListItemIcon>Open workspace</MenuItem>
        <MenuItem onClick={() => { setAnchor(null); setChatAgentId(agent.id); setChatOpen(true); }}><ListItemIcon><MessageSquare size={15} /></ListItemIcon>Chat</MenuItem>
        {canTask && onAssign && <MenuItem onClick={() => { setAnchor(null); onAssign(); }}><ListItemIcon><ListPlus size={15} /></ListItemIcon>Assign task</MenuItem>}
        {canEdit && onEdit && <MenuItem onClick={() => { setAnchor(null); onEdit(); }}><ListItemIcon><Pencil size={15} /></ListItemIcon>Edit configuration</MenuItem>}
        {canEdit && <MenuItem onClick={() => action(`/agents/${agent.id}/duplicate`, 'Agent duplicated')}><ListItemIcon><Copy size={15} /></ListItemIcon>Duplicate</MenuItem>}
        {canEdit && agent.status !== 'PAUSED' && agent.status !== 'ARCHIVED' && <MenuItem onClick={() => action(`/agents/${agent.id}/pause`, 'Agent paused')}><ListItemIcon><Pause size={15} /></ListItemIcon>Pause</MenuItem>}
        {canEdit && agent.status === 'PAUSED' && <MenuItem onClick={() => action(`/agents/${agent.id}/resume`, 'Agent resumed')}><ListItemIcon><Play size={15} /></ListItemIcon>Resume</MenuItem>}
        {canDelete && agent.status !== 'ARCHIVED' && <MenuItem onClick={() => { setAnchor(null); setConfirmArchive(true); }}><ListItemIcon><Archive size={15} /></ListItemIcon>Archive</MenuItem>}
      </Menu>
      <ConfirmDialog open={confirmArchive} title={`Archive ${agent.name}?`} description="Queued tasks will be paused. Archived agents can be deleted later according to retention rules." confirmLabel="Archive" destructive onClose={() => setConfirmArchive(false)} onConfirm={() => { setConfirmArchive(false); void action(`/agents/${agent.id}/archive`, 'Agent archived'); }} />
    </div>
  );
}
