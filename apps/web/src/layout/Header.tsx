import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Badge, Button, Divider, IconButton, Menu, MenuItem, Tooltip, useMediaQuery, useTheme, ListItemText, Avatar } from '@mui/material';
import { Bell, Menu as MenuIcon, Moon, Plus, Search, Sun, Monitor, Check, FlaskConical } from 'lucide-react';
import { useUiStore } from '@/store/ui';
import { useAuthStore, useCan } from '@/store/auth';
import { useHealth, useNotifications } from '@/lib/queries';
import { api } from '@/lib/api';
import { timeAgo, initials } from '@/lib/format';
import { useQueryClient } from '@tanstack/react-query';
import { GUEST_MODE_AVAILABLE, isGuestActive } from '@/guest/session';
import { GuestModeChip } from '@/guest/GuestModeChip';

const TITLES: Array<{ match: RegExp; title: string; subtitle: string }> = [
  { match: /^\/$/, title: 'AI Team Overview', subtitle: 'Live status of your digital team members and their work' },
  { match: /^\/team\/.+/, title: 'Team member', subtitle: 'Configuration, activity and conversation' },
  { match: /^\/team/, title: 'AI Team Members', subtitle: 'Create, configure and monitor your agents' },
  { match: /^\/tasks/, title: 'Tasks', subtitle: 'Queue, execution timeline and results' },
  { match: /^\/workflows\/executions/, title: 'Workflow execution', subtitle: 'Node-level status and logs' },
  { match: /^\/workflows\/.+/, title: 'Workflow editor', subtitle: 'Design, validate and run multi-agent workflows' },
  { match: /^\/workflows/, title: 'Agent Workflows', subtitle: 'Orchestrate agents, approvals and humans' },
  { match: /^\/tools/, title: 'Tools', subtitle: 'Registry, risk levels and availability' },
  { match: /^\/knowledge/, title: 'Knowledge Base', subtitle: 'Approved documents and URLs your agents can read' },
  { match: /^\/files/, title: 'Files', subtitle: 'Reports and artifacts produced by your team' },
  { match: /^\/approvals/, title: 'Approvals', subtitle: 'Human review of sensitive agent actions' },
  { match: /^\/activity/, title: 'Activity History', subtitle: 'Audit trail of everything that happened' },
  { match: /^\/analytics/, title: 'Analytics', subtitle: 'Usage, cost estimates and budgets' },
  { match: /^\/integrations/, title: 'Integrations', subtitle: 'External systems your agents may use' },
  { match: /^\/settings/, title: 'Settings', subtitle: 'Workspace, members, budgets and preferences' },
];

export function Header() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const setWizardOpen = useUiStore((s) => s.setWizardOpen);
  const themePref = useUiStore((s) => s.themePreference);
  const setThemePref = useUiStore((s) => s.setThemePreference);
  const user = useAuthStore((s) => s.user);
  const canCreate = useCan('agent.create');
  const notifications = useNotifications();
  const health = useHealth();
  const [themeAnchor, setThemeAnchor] = useState<HTMLElement | null>(null);
  const [notifAnchor, setNotifAnchor] = useState<HTMLElement | null>(null);
  const page = TITLES.find((t) => t.match.test(location.pathname)) ?? TITLES[0]!;

  const chooseTheme = (p: 'light' | 'dark' | 'system') => {
    setThemePref(p);
    setThemeAnchor(null);
    void api.patch('/auth/me', { themePreference: p }).catch(() => undefined);
  };
  const ThemeIcon = themePref === 'dark' ? Moon : themePref === 'light' ? Sun : Monitor;

  const openNotification = async (id: string, link: string | null) => {
    setNotifAnchor(null);
    await api.post(`/notifications/${id}/read`).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    if (link) navigate(link);
  };

  return (
    <header className="sticky top-0 z-20 h-[var(--cs-header-h)] bg-surface/85 backdrop-blur border-b border-border px-4 md:px-6 flex items-center gap-3">
      {isMobile && (
        <IconButton size="small" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
          <MenuIcon size={18} />
        </IconButton>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold leading-tight truncate">{page.title}</div>
        <div className="text-[11.5px] text-text-3 truncate hidden sm:block">{page.subtitle}</div>
      </div>
      {GUEST_MODE_AVAILABLE && isGuestActive() && <GuestModeChip />}
      {health.data?.aiProvider.isMock && (
        <Tooltip title="The server is running the deterministic mock AI provider. Outputs are placeholders. Configure AI_PROVIDER for real results.">
          <span className="hidden sm:inline-flex items-center gap-1 rounded-md bg-warning-soft text-warning px-2 py-1 text-[11px] font-semibold">
            <FlaskConical size={12} /> Mock provider
          </span>
        </Tooltip>
      )}
      {health.data && !health.data.aiProvider.configured && (
        <Tooltip title={health.data.aiProvider.reason ?? 'AI provider not configured'}>
          <span className="hidden sm:inline-flex items-center gap-1 rounded-md bg-danger-soft text-danger px-2 py-1 text-[11px] font-semibold">AI provider not configured</span>
        </Tooltip>
      )}
      <Tooltip title="Search (⌘K)">
        <IconButton size="small" onClick={() => setSearchOpen(true)} aria-label="Global search">
          <Search size={17} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Notifications">
        <IconButton size="small" onClick={(e) => setNotifAnchor(e.currentTarget)} aria-label="Notifications">
          <Badge badgeContent={notifications.data?.unread ?? 0} color="error" max={99}>
            <Bell size={17} />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu anchorEl={notifAnchor} open={Boolean(notifAnchor)} onClose={() => setNotifAnchor(null)} slotProps={{ paper: { sx: { width: 360, maxHeight: 440 } } }}>
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-[12.5px] font-semibold">Notifications</span>
          <Button size="small" onClick={async () => { await api.post('/notifications/read-all'); void qc.invalidateQueries({ queryKey: ['notifications'] }); }}>Mark all read</Button>
        </div>
        <Divider />
        {(notifications.data?.items ?? []).length === 0 && <div className="px-3 py-6 text-center text-[12.5px] text-text-3">You're all caught up.</div>}
        {(notifications.data?.items ?? []).slice(0, 12).map((n) => (
          <MenuItem key={n.id} onClick={() => openNotification(n.id, n.link)} sx={{ alignItems: 'flex-start', whiteSpace: 'normal', opacity: n.readAt ? 0.65 : 1 }}>
            <ListItemText primary={<span className="text-[12.5px] font-medium">{n.title}</span>} secondary={<span className="text-[11.5px]">{n.body} · {timeAgo(n.createdAt)}</span>} />
          </MenuItem>
        ))}
      </Menu>
      <Tooltip title={`Theme: ${themePref}`}>
        <IconButton size="small" onClick={(e) => setThemeAnchor(e.currentTarget)} aria-label="Toggle theme" data-testid="theme-toggle">
          <ThemeIcon size={17} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={themeAnchor} open={Boolean(themeAnchor)} onClose={() => setThemeAnchor(null)}>
        {([['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]] as const).map(([value, label, Icon]) => (
          <MenuItem key={value} onClick={() => chooseTheme(value)} data-testid={`theme-${value}`}>
            <Icon size={15} className="mr-2" /> {label} {themePref === value && <Check size={14} className="ml-auto text-primary" />}
          </MenuItem>
        ))}
      </Menu>
      <Avatar sx={{ width: 30, height: 30, fontSize: 12, bgcolor: 'var(--cs-accent)' }} className="hidden sm:flex">{user ? initials(user.name) : '?'}</Avatar>
      {canCreate && (
        <Button variant="contained" size="small" startIcon={<Plus size={15} />} onClick={() => setWizardOpen(true)} data-testid="new-agent-button">
          {isMobile ? 'Agent' : 'New Agent'}
        </Button>
      )}
    </header>
  );
}
