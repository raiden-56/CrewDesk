import type { CSSProperties, ReactNode } from 'react';

/**
 * Shimmer loading system. All placeholders share the `.cs-shimmer` animation defined in
 * styles.css (tokens: --cs-shimmer-base / --cs-shimmer-highlight), respect reduced motion,
 * and keep the geometry of the component they stand in for so content never shifts.
 */
export interface ShimmerBlockProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
}

export function ShimmerBlock({ width = '100%', height = 14, radius = 8, className = '', style }: ShimmerBlockProps) {
  return <div aria-hidden className={`cs-shimmer ${className}`} style={{ width, height, borderRadius: radius, ...style }} />;
}

export function ShimmerText({ lines = 3, widths = ['100%', '92%', '70%'], lineHeight = 12, gap = 8, className = '' }: { lines?: number; widths?: Array<number | string>; lineHeight?: number; gap?: number; className?: string }) {
  return (
    <div aria-hidden className={`flex flex-col ${className}`} style={{ gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <ShimmerBlock key={i} height={lineHeight} width={widths[i % widths.length]} radius={6} />
      ))}
    </div>
  );
}

export function ShimmerAvatar({ size = 36, className = '' }: { size?: number; className?: string }) {
  return <ShimmerBlock width={size} height={size} radius="50%" className={className} />;
}

export function ShimmerMetricCard() {
  return (
    <div className="cs-card p-4 flex flex-col gap-3" aria-hidden>
      <div className="flex items-center justify-between">
        <ShimmerBlock width={96} height={10} radius={5} />
        <ShimmerBlock width={28} height={28} radius={8} />
      </div>
      <ShimmerBlock width={72} height={26} radius={6} />
      <ShimmerBlock width={120} height={10} radius={5} />
    </div>
  );
}

export function ShimmerAgentCard() {
  return (
    <div className="cs-card p-4 flex flex-col gap-3" aria-hidden>
      <div className="flex items-center gap-3">
        <ShimmerAvatar size={40} />
        <div className="flex-1 flex flex-col gap-2">
          <ShimmerBlock width="55%" height={12} radius={6} />
          <ShimmerBlock width="35%" height={10} radius={5} />
        </div>
        <ShimmerBlock width={56} height={20} radius={6} />
      </div>
      <ShimmerText lines={2} widths={['90%', '60%']} lineHeight={10} />
      <ShimmerBlock height={6} radius={4} />
    </div>
  );
}

export function ShimmerAgentList({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <ShimmerAgentCard key={i} />
      ))}
    </div>
  );
}

export function ShimmerTaskRow({ columns = 7 }: { columns?: number }) {
  return (
    <tr aria-hidden>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <ShimmerBlock height={12} width={i === 0 ? '80%' : i === columns - 1 ? 40 : '60%'} radius={6} />
        </td>
      ))}
    </tr>
  );
}

export function ShimmerTable({ rows = 6, columns = 7, headers }: { rows?: number; columns?: number; headers?: string[] }) {
  const cols = headers?.length ?? columns;
  return (
    <div className="cs-card overflow-hidden" aria-busy="true" aria-live="polite">
      <table className="w-full text-left">
        <thead>
          <tr className="bg-surface-2 border-b border-border">
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i} className="px-3 py-2 cs-label">
                {headers?.[i] ?? <ShimmerBlock height={10} width={60} radius={5} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {Array.from({ length: rows }).map((_, i) => (
            <ShimmerTaskRow key={i} columns={cols} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ShimmerChatMessage({ side = 'left' }: { side?: 'left' | 'right' }) {
  return (
    <div aria-hidden className={`flex gap-2 ${side === 'right' ? 'justify-end' : ''}`}>
      {side === 'left' && <ShimmerAvatar size={28} />}
      <div className={`flex flex-col gap-2 ${side === 'right' ? 'items-end' : ''}`} style={{ width: side === 'right' ? '55%' : '70%' }}>
        <ShimmerBlock height={12} width="100%" radius={6} />
        <ShimmerBlock height={12} width="80%" radius={6} />
        {side === 'left' && <ShimmerBlock height={12} width="40%" radius={6} />}
      </div>
    </div>
  );
}

export function ShimmerConversation({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4 p-3">
      {Array.from({ length: count }).map((_, i) => (
        <ShimmerChatMessage key={i} side={i % 2 === 0 ? 'right' : 'left'} />
      ))}
    </div>
  );
}

export function ShimmerExecutionTimeline({ steps = 6 }: { steps?: number }) {
  return (
    <div aria-hidden className="flex flex-col">
      {Array.from({ length: steps }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <ShimmerBlock width={14} height={14} radius="50%" />
            {i < steps - 1 && <div className="w-px flex-1 bg-border my-1" style={{ minHeight: 28 }} />}
          </div>
          <div className="flex-1 pb-4 flex flex-col gap-2">
            <ShimmerBlock height={12} width={`${60 + ((i * 13) % 30)}%`} radius={6} />
            <ShimmerBlock height={10} width="30%" radius={5} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ShimmerAgentDetail() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="flex items-center gap-3">
        <ShimmerAvatar size={48} />
        <div className="flex-1 flex flex-col gap-2">
          <ShimmerBlock width="40%" height={16} radius={6} />
          <ShimmerBlock width="25%" height={10} radius={5} />
        </div>
      </div>
      <ShimmerBlock height={36} radius={8} />
      <ShimmerText lines={3} />
      <div className="grid grid-cols-2 gap-3">
        <ShimmerBlock height={64} radius={10} />
        <ShimmerBlock height={64} radius={10} />
      </div>
      <ShimmerExecutionTimeline steps={3} />
    </div>
  );
}

export function ShimmerDashboard() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <ShimmerMetricCard key={i} />
        ))}
      </div>
      <div className="grid gap-4 grid-cols-1 xl:grid-cols-[1.4fr_1fr]">
        <ShimmerAgentList count={4} />
        <div className="cs-card p-4">
          <ShimmerAgentDetail />
        </div>
      </div>
      <ShimmerTable rows={4} />
    </div>
  );
}

export function ShimmerPage({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <ShimmerBlock width={200} height={20} radius={6} />
          <ShimmerBlock width={300} height={12} radius={5} />
        </div>
        <ShimmerBlock width={110} height={34} radius={8} />
      </div>
      {children ?? <ShimmerTable rows={6} />}
    </div>
  );
}
