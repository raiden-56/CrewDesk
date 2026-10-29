import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { Avatar, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip, Badge } from '@mui/material';
import { BarChart3, BookOpen, Bot, CheckSquare, ChevronsLeft, ChevronsRight, ClipboardList, FolderOpen, History, Home, LogOut, Plug, Search, Settings, User, Workflow, ChevronDown, Briefcase } from 'lucide-react';
import { useAuthStore, useWorkspace } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { useApprovals, useProjects } from '@/lib/queries';
import { api } from '@/lib/api';
import { initials } from '@/lib/format';
import { ROLE_LABELS } from '@collabspace/shared';
import { GUEST_MODE_AVAILABLE, isGuestActive } from '@/guest/session';
import { useLeaveGuestMode } from '@/guest/GuestModeChip';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/team', label: 'AI Team Members', icon: Bot },
  { to: '/tasks', label: 'Tasks', icon: ClipboardList },
  { to: '/workflows', label: 'Agent Workflows', icon: Workflow },
  { to: '/knowledge', label: 'Knowledge Base', icon: BookOpen },
  { to: '/files', label: 'Files', icon: FolderOpen },
  { to: '/approvals', label: 'Approvals', icon: CheckSquare, badge: true },
  { to: '/activity', label: 'Activity History', icon: History },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="h-8 w-8 shrink-0 rounded-lg bg-primary text-white flex items-center justify-center shadow-sm">
        <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden>
          <circle cx="12" cy="13" r="4" fill="white" />
          <circle cx="21" cy="13" r="4" fill="white" opacity=".75" />
          <rect x="8" y="20" width="16" height="5" rx="2.5" fill="white" opacity=".9" />
        </svg>
      </div>
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className="font-semibold text-[13.5px] truncate">CollabSpace AI Team</div>
          <div className="text-[10.5px] text-text-3 truncate">Your AI team. Your rules. Real work.</div>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const workspace = useWorkspace();
  const workspaces = useAuthStore((s) => s.workspaces);
  const setWorkspace = useAuthStore((s) => s.setWorkspace);
  const user = useAuthStore((s) => s.user);
  const setAnonymous = useAuthStore((s) => s.setAnonymous);
  const navigate = useNavigate();
  const [wsAnchor, setWsAnchor] = useState<HTMLElement | null>(null);
  const [userAnchor, setUserAnchor] = useState<HTMLElement | null>(null);
  const approvals = useApprovals({ status: 'PENDING', pageSize: 1 });
  const projects = useProjects();
  const pending = approvals.data?.pending ?? 0;
  const leaveGuestMode = useLeaveGuestMode();

  const logout = async () => {
    if (GUEST_MODE_AVAILABLE && isGuestActive()) return leaveGuestMode();
    await api.post('/auth/logout').catch(() => undefined);
    setAnonymous();
    navigate('/login');
  };

  return (
    <div className="h-full flex flex-col">
      <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} px-3 h-[var(--cs-header-h)] border-b border-border`}>
        <Logo compact={collapsed} />
        {!collapsed && (
          <Tooltip title="Collapse sidebar">
            <IconButton size="small" onClick={toggleSidebar} className="hidden md:inline-flex" aria-label="Collapse sidebar">
              <ChevronsLeft size={16} />
            </IconButton>
          </Tooltip>
        )}
      </div>
      {collapsed && (
        <div className="flex justify-center py-2">
          <Tooltip title="Expand sidebar" placement="right">
            <IconButton size="small" onClick={toggleSidebar} aria-label="Expand sidebar">
              <ChevronsRight size={16} />
            </IconButton>
          </Tooltip>
        </div>
      )}

      <div className="px-2.5 pt-2.5">
        <button
          type="button"
          onClick={(e) => setWsAnchor(e.currentTarget)}
          className={`w-full flex items-center gap-2 rounded-lg border border-border bg-surface-2 hover:bg-surface-3 transition-colors px-2 py-1.5 text-left ${collapsed ? 'justify-center' : ''}`}
          aria-label="Switch workspace"
        >
          <div className="h-6 w-6 rounded-md bg-accent-soft text-accent flex items-center justify-center text-[11px] font-bold shrink-0">{workspace ? initials(workspace.name) : '—'}</div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-semibold truncate">{workspace?.name ?? 'Workspace'}</div>
                <div className="text-[10.5px] text-text-3 truncate">{workspace ? ROLE_LABELS[workspace.role] : ''}</div>
              </div>
              <ChevronDown size={14} className="text-text-3" />
            </>
          )}
        </button>
        <Menu anchorEl={wsAnchor} open={Boolean(wsAnchor)} onClose={() => setWsAnchor(null)}>
          {workspaces.map((w) => (
            <MenuItem key={w.id} selected={w.id === workspace?.id} onClick={() => { setWorkspace(w.id); setWsAnchor(null); }}>
              <ListItemIcon><Briefcase size={15} /></ListItemIcon>
              <ListItemText primary={w.name} secondary={ROLE_LABELS[w.role]} />
            </MenuItem>
          ))}
        </Menu>
        <button type="button" onClick={() => setSearchOpen(true)} className={`mt-2 w-full flex items-center gap-2 rounded-lg border border-border bg-surface hover:bg-surface-2 transition-colors px-2 py-1.5 text-text-3 ${collapsed ? 'justify-center' : ''}`} aria-label="Search">
          <Search size={15} />
          {!collapsed && (
            <>
              <span className="text-[12.5px] flex-1 text-left">Search…</span>
              <kbd className="cs-kbd">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3 flex flex-col gap-0.5" aria-label="Main navigation">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate} className={({ isActive }) => `group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors ${isActive ? 'bg-primary-soft text-primary' : 'text-text-2 hover:bg-surface-2 hover:text-text'} ${collapsed ? 'justify-center' : ''}`} title={collapsed ? item.label : undefined}>
              {item.badge && pending > 0 ? (
                <Badge badgeContent={pending} color="warning" overlap="circular"><Icon size={17} /></Badge>
              ) : (
                <Icon size={17} />
              )}
              {!collapsed && <span className="truncate">{item.label}</span>}
              {!collapsed && item.badge && pending > 0 && <span className="ml-auto text-[11px] font-semibold text-warning">{pending}</span>}
            </NavLink>
          );
        })}
        {!collapsed && (
          <div className="mt-4">
            <div className="cs-label px-2.5 mb-1">Recent projects</div>
            {(projects.data?.items ?? []).slice(0, 4).map((p) => (
              <NavLink key={p.id} to={`/tasks?projectId=${p.id}`} onClick={onNavigate} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] text-text-2 hover:bg-surface-2 hover:text-text transition-colors">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" /> <span className="truncate">{p.name}</span>
              </NavLink>
            ))}
            {projects.data && projects.data.items.length === 0 && <div className="px-2.5 text-[12px] text-text-3">No projects yet</div>}
          </div>
        )}
      </nav>

      <Divider />
      <div className="p-2.5">
        <button type="button" onClick={(e) => setUserAnchor(e.currentTarget)} className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2 transition-colors ${collapsed ? 'justify-center' : ''}`} aria-label="User menu">
          <Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: 'var(--cs-accent)' }}>{user ? initials(user.name) : '?'}</Avatar>
          {!collapsed && (
            <div className="min-w-0 flex-1 text-left">
              <div className="text-[12.5px] font-semibold truncate">{user?.name}</div>
              <div className="text-[10.5px] text-text-3 truncate">{user?.email}</div>
            </div>
          )}
        </button>
        <Menu anchorEl={userAnchor} open={Boolean(userAnchor)} onClose={() => setUserAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'right' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
          <MenuItem onClick={() => { setUserAnchor(null); navigate('/settings/profile'); }}>
            <ListItemIcon><User size={15} /></ListItemIcon>Profile & preferences
          </MenuItem>
          <MenuItem onClick={logout}>
            <ListItemIcon><LogOut size={15} /></ListItemIcon>Sign out
          </MenuItem>
        </Menu>
      </div>
    </div>
  );
}
