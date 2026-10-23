import { useEffect, type ReactNode } from 'react';
import { Drawer, useMediaQuery, useTheme } from '@mui/material';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ChatPanel } from './ChatPanel';
import { Toast } from './Toast';
import { CommandSearch } from './CommandSearch';
import { AgentWizard } from '@/pages/agents/wizard/AgentWizard';
import { useUiStore } from '@/store/ui';
import { useRealtime } from '@/lib/realtime';

export function AppShell({ children }: { children: ReactNode }) {
  useRealtime();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);
  const chatOpen = useUiStore((s) => s.chatOpen);
  const setChatOpen = useUiStore((s) => s.setChatOpen);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSearchOpen]);

  const sidebarWidth = isMobile ? 0 : sidebarOpen ? 'var(--cs-sidebar-w)' : 'var(--cs-sidebar-collapsed-w)';

  return (
    <div className="min-h-full bg-bg flex">
      {isMobile ? (
        <Drawer open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} PaperProps={{ sx: { width: 280, borderRight: '1px solid var(--cs-border)' } }}>
          <Sidebar collapsed={false} onNavigate={() => setMobileNavOpen(false)} />
        </Drawer>
      ) : (
        <aside className="fixed inset-y-0 left-0 z-30 border-r border-border bg-surface transition-[width] duration-200 ease-out overflow-hidden" style={{ width: sidebarWidth }}>
          <Sidebar collapsed={!sidebarOpen} />
        </aside>
      )}
      <div className="flex-1 min-w-0 flex flex-col transition-[margin] duration-200 ease-out" style={{ marginLeft: sidebarWidth }}>
        <Header />
        <main className="flex-1 min-w-0 px-4 py-4 md:px-6 md:py-5 max-w-[1680px] w-full mx-auto">{children}</main>
      </div>
      {isMobile ? (
        <Drawer anchor="bottom" open={chatOpen} onClose={() => setChatOpen(false)} PaperProps={{ sx: { height: '92vh', borderTopLeftRadius: 16, borderTopRightRadius: 16, borderTop: '1px solid var(--cs-border)' } }}>
          <ChatPanel onClose={() => setChatOpen(false)} />
        </Drawer>
      ) : (
        <Drawer anchor="right" open={chatOpen} onClose={() => setChatOpen(false)} PaperProps={{ sx: { width: 420, maxWidth: '100vw' } }}>
          <ChatPanel onClose={() => setChatOpen(false)} />
        </Drawer>
      )}
      <AgentWizard />
      <CommandSearch />
      <Toast />
    </div>
  );
}
