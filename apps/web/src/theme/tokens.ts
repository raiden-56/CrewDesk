/**
 * Centralized design tokens. CSS variables in styles.css are the source of truth for
 * Tailwind; this module mirrors them for MUI so both systems render identical colors.
 */
export type Mode = 'light' | 'dark';

export const palette = {
  light: {
    bg: '#f4f5f9',
    surface: '#ffffff',
    surface2: '#f7f8fb',
    surface3: '#eef0f5',
    border: '#e4e7ee',
    borderStrong: '#cfd4df',
    text: '#0f172a',
    text2: '#475569',
    text3: '#64748b',
    primary: '#6d5df5',
    primaryStrong: '#5a49e6',
    primarySoft: '#eeebff',
    accent: '#2f6bff',
    success: '#16a34a',
    warning: '#d97706',
    danger: '#dc2626',
    info: '#0891b2',
    shimmerBase: '#e9ebf1',
    shimmerHighlight: '#f7f8fb',
  },
  dark: {
    bg: '#0b1020',
    surface: '#121831',
    surface2: '#171e38',
    surface3: '#1e2642',
    border: '#222b47',
    borderStrong: '#2f3a5c',
    text: '#e7eaf3',
    text2: '#b4bccf',
    text3: '#8d97b0',
    primary: '#8b7cff',
    primaryStrong: '#a194ff',
    primarySoft: '#26234a',
    accent: '#5f8bff',
    success: '#34d399',
    warning: '#fbbf24',
    danger: '#f87171',
    info: '#22d3ee',
    shimmerBase: '#1b2240',
    shimmerHighlight: '#273055',
  },
} as const;

export const radii = { sm: 8, md: 12, lg: 16 } as const;
export const spacing = 8;
export const fontFamily = "'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Status colors shared by chips, timelines and charts. */
export const statusColor: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info'> = {
  DRAFT: 'default',
  QUEUED: 'info',
  RUNNING: 'primary',
  WAITING_APPROVAL: 'warning',
  PAUSED: 'default',
  COMPLETED: 'success',
  FAILED: 'error',
  CANCELLED: 'default',
  TIMED_OUT: 'error',
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
  CHANGES_REQUESTED: 'warning',
  EXPIRED: 'default',
  SUPERSEDED: 'default',
  EXECUTED: 'success',
  ONLINE: 'success',
  IDLE: 'info',
  WORKING: 'primary',
  OFFLINE: 'default',
  ARCHIVED: 'default',
  READY: 'success',
  PROCESSING: 'info',
  REVOKED: 'default',
  WAITING: 'warning',
  SKIPPED: 'default',
  LOW: 'success',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'error',
};

/**
 * Categorical chart palette in fixed order (assign by entity, never cycle). Validated with the
 * dataviz palette checker: adjacent pairs separate under CVD in light and dark. Green/red stay
 * reserved for status (see statusSeries); more than five series fold into "Other".
 */
export const chartSeries = ['#2f6bff', '#d97706', '#0891b2', '#ec4899', '#6d5df5'];

/** Status colors for charted states (completed / warning / failed); follow the theme. */
export const statusSeries = { good: 'var(--cs-success)', warning: 'var(--cs-warning)', critical: 'var(--cs-danger)' } as const;
