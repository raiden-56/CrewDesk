import { Avatar, Badge, Tooltip } from '@mui/material';
import { BookOpen, Bot, BarChart3, Bug, Code2, FileText, Headphones, Map, Mic, ShieldCheck, Sparkles, Workflow, type LucideIcon } from 'lucide-react';
import type { AgentStatus } from '@collabspace/shared';

/** Original illustrated avatars: a role icon on the agent's identity color. */
const ICONS: Record<string, LucideIcon> = {
  researcher: BookOpen,
  planner: Map,
  qa: Bug,
  docs: FileText,
  general: Sparkles,
  analyst: BarChart3,
  meeting: Mic,
  product: Workflow,
  code: Code2,
  support: Headphones,
  security: ShieldCheck,
  coordinator: Workflow,
};

const STATUS_DOT: Record<AgentStatus, string> = {
  ONLINE: 'var(--cs-success)',
  IDLE: 'var(--cs-info)',
  WORKING: 'var(--cs-primary)',
  PAUSED: 'var(--cs-warning)',
  OFFLINE: 'var(--cs-text-3)',
  ARCHIVED: 'var(--cs-text-3)',
};

export function AgentAvatar({ avatar, color, name, size = 36, status, className }: { avatar: string; color: string; name: string; size?: number; status?: AgentStatus; className?: string }) {
  const Icon = ICONS[avatar] ?? Bot;
  const node = (
    <Avatar
      className={className}
      alt={name}
      sx={{ width: size, height: size, bgcolor: color, color: '#fff', borderRadius: size >= 40 ? '14px' : '10px', boxShadow: `inset 0 -2px 0 rgba(0,0,0,.12)` }}
    >
      <Icon size={Math.round(size * 0.52)} strokeWidth={2.2} />
    </Avatar>
  );
  if (!status) return node;
  return (
    <Tooltip title={`${name}: ${status.toLowerCase()}`} arrow>
      <Badge
        overlap="circular"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        variant="dot"
        sx={{ '& .MuiBadge-badge': { backgroundColor: STATUS_DOT[status], width: Math.max(8, size / 4), height: Math.max(8, size / 4), borderRadius: '50%', border: '2px solid var(--cs-surface)', ...(status === 'WORKING' ? { animation: 'cs-pulse 1.4s ease-in-out infinite' } : {}) } }}
      >
        {node}
      </Badge>
    </Tooltip>
  );
}
