import { createTheme, type Theme } from '@mui/material/styles';
import { fontFamily, palette, radii, type Mode } from './tokens';

export function buildMuiTheme(mode: Mode): Theme {
  const p = palette[mode];
  return createTheme({
    palette: {
      mode,
      primary: { main: p.primary, dark: p.primaryStrong, light: p.primarySoft, contrastText: '#ffffff' },
      secondary: { main: p.accent },
      success: { main: p.success },
      warning: { main: p.warning },
      error: { main: p.danger },
      info: { main: p.info },
      background: { default: p.bg, paper: p.surface },
      text: { primary: p.text, secondary: p.text2, disabled: p.text3 },
      divider: p.border,
    },
    shape: { borderRadius: radii.sm },
    typography: {
      fontFamily,
      fontSize: 13,
      h1: { fontSize: '1.5rem', fontWeight: 650, letterSpacing: '-0.01em' },
      h2: { fontSize: '1.25rem', fontWeight: 650, letterSpacing: '-0.01em' },
      h3: { fontSize: '1.1rem', fontWeight: 600 },
      h4: { fontSize: '1rem', fontWeight: 600 },
      h5: { fontSize: '0.95rem', fontWeight: 600 },
      h6: { fontSize: '0.875rem', fontWeight: 600 },
      subtitle1: { fontSize: '0.875rem', fontWeight: 500 },
      subtitle2: { fontSize: '0.8125rem', fontWeight: 600 },
      body1: { fontSize: '0.875rem' },
      body2: { fontSize: '0.8125rem' },
      caption: { fontSize: '0.75rem' },
      button: { textTransform: 'none', fontWeight: 600, fontSize: '0.8125rem' },
    },
    components: {
      MuiCssBaseline: { styleOverrides: { body: { backgroundColor: p.bg } } },
      MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none', border: `1px solid ${p.border}`, borderRadius: radii.md } } },
      MuiCard: { styleOverrides: { root: { border: `1px solid ${p.border}`, borderRadius: radii.md, boxShadow: 'none' } } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: radii.sm, paddingInline: 14, minHeight: 34 },
          sizeSmall: { minHeight: 30, paddingInline: 10 },
          outlined: { borderColor: p.borderStrong },
        },
      },
      MuiIconButton: { styleOverrides: { root: { borderRadius: radii.sm } } },
      MuiChip: { styleOverrides: { root: { borderRadius: 6, fontWeight: 600, fontSize: '0.72rem', height: 22 }, label: { paddingInline: 8 } } },
      MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: mode === 'dark' ? '#2a335a' : '#0f172a', color: '#fff', fontSize: '0.75rem', borderRadius: 8, padding: '6px 10px' }, arrow: { color: mode === 'dark' ? '#2a335a' : '#0f172a' } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: radii.lg, border: `1px solid ${p.border}`, backgroundImage: 'none', boxShadow: mode === 'dark' ? '0 24px 60px rgba(0,0,0,.6)' : '0 24px 60px rgba(15,23,42,.18)' } } },
      MuiDrawer: { styleOverrides: { paper: { backgroundImage: 'none', border: 'none', borderLeft: `1px solid ${p.border}` } } },
      MuiMenu: { styleOverrides: { paper: { borderRadius: radii.md, border: `1px solid ${p.border}`, boxShadow: mode === 'dark' ? '0 12px 32px rgba(0,0,0,.5)' : '0 12px 32px rgba(15,23,42,.12)' } } },
      MuiMenuItem: { styleOverrides: { root: { borderRadius: 6, marginInline: 6, fontSize: '0.8125rem', minHeight: 34 } } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: radii.sm, backgroundColor: mode === 'dark' ? p.surface2 : '#fff', fontSize: '0.875rem' },
          notchedOutline: { borderColor: p.border },
          input: { paddingBlock: 9 },
        },
      },
      MuiInputLabel: { styleOverrides: { root: { fontSize: '0.875rem' } } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, fontSize: '0.8125rem', minHeight: 40, paddingInline: 12 } } },
      MuiTabs: { styleOverrides: { root: { minHeight: 40 }, indicator: { height: 2, borderRadius: 2 } } },
      MuiTableCell: { styleOverrides: { root: { borderBottomColor: p.border, fontSize: '0.8125rem', paddingBlock: 10 }, head: { fontWeight: 600, color: p.text2, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', backgroundColor: p.surface2 } } },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: 6, height: 6, backgroundColor: p.surface3 } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: radii.sm, fontSize: '0.8125rem' } } },
      MuiSwitch: { styleOverrides: { root: { padding: 8 } } },
      MuiAvatar: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: radii.sm } } },
      MuiBadge: { styleOverrides: { badge: { fontSize: '0.65rem', fontWeight: 700, minWidth: 16, height: 16 } } },
    },
  });
}
