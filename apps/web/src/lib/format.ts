import { formatDistanceToNowStrict, format as fmt, isValid, parseISO } from 'date-fns';

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  if (!isValid(d)) return '—';
  return `${formatDistanceToNowStrict(d)} ago`;
}

export function dateTime(iso: string | null | undefined, pattern = 'MMM d, HH:mm:ss'): string {
  if (!iso) return '—';
  const d = parseISO(iso);
  return isValid(d) ? fmt(d, pattern) : '—';
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function tokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'n/a';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function usd(n: number | null | undefined, opts: { estimate?: boolean } = {}): string {
  if (n === null || n === undefined) return 'n/a';
  const v = n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
  return opts.estimate ? `~${v}` : v;
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'n/a';
  return `${Math.round(n * 100)}%`;
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
