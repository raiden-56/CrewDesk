import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { useUiStore } from '@/store/ui';
import { buildMuiTheme } from './mui';
import type { Mode } from './tokens';

function systemMode(): Mode {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useResolvedMode(): Mode {
  const pref = useUiStore((s) => s.themePreference);
  const [sys, setSys] = useState<Mode>(systemMode);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const handler = (e: MediaQueryListEvent) => setSys(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return pref === 'system' ? sys : pref;
}

/** Applies the resolved mode to <html data-theme> (Tailwind) and to MUI's theme. */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const mode = useResolvedMode();
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-theme');
    if (previous && previous !== mode) {
      root.classList.add('theme-transition');
      window.setTimeout(() => root.classList.remove('theme-transition'), 300);
    }
    root.setAttribute('data-theme', mode);
  }, [mode]);
  const theme = useMemo(() => buildMuiTheme(mode), [mode]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  );
}
