import { create } from 'zustand';

export type ThemePreference = 'light' | 'dark' | 'system';

const THEME_KEY = 'csai.theme';
const SIDEBAR_KEY = 'csai.sidebar';

function readTheme(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function readSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== 'collapsed';
  } catch {
    return true;
  }
}

interface UiState {
  themePreference: ThemePreference;
  setThemePreference: (p: ThemePreference) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  chatAgentId: string | null;
  setChatAgentId: (id: string | null) => void;
  wizardOpen: boolean;
  wizardAgentId: string | null;
  setWizardOpen: (open: boolean, agentId?: string | null) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  toast: { message: string; severity: 'success' | 'error' | 'info' | 'warning'; key: number } | null;
  notify: (message: string, severity?: 'success' | 'error' | 'info' | 'warning') => void;
  clearToast: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  themePreference: readTheme(),
  setThemePreference: (p) => {
    try {
      localStorage.setItem(THEME_KEY, p);
    } catch {
      /* ignore */
    }
    set({ themePreference: p });
  },
  sidebarOpen: readSidebar(),
  toggleSidebar: () => {
    const next = !get().sidebarOpen;
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? 'open' : 'collapsed');
    } catch {
      /* ignore */
    }
    set({ sidebarOpen: next });
  },
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  chatOpen: false,
  setChatOpen: (open) => set({ chatOpen: open }),
  chatAgentId: null,
  setChatAgentId: (id) => set({ chatAgentId: id }),
  wizardOpen: false,
  wizardAgentId: null,
  setWizardOpen: (open, agentId = null) => set({ wizardOpen: open, wizardAgentId: open ? agentId : null }),
  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),
  toast: null,
  notify: (message, severity = 'info') => set({ toast: { message, severity, key: Date.now() } }),
  clearToast: () => set({ toast: null }),
}));
