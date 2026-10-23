import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  to?: string;
}

export function PageHeader({ title, subtitle, crumbs, actions, tabs }: { title: ReactNode; subtitle?: ReactNode; crumbs?: Crumb[]; actions?: ReactNode; tabs?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 mb-4">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[12px] text-text-3 flex-wrap">
          {crumbs.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {c.to ? (
                <Link to={c.to} className="hover:text-text transition-colors">
                  {c.label}
                </Link>
              ) : (
                <span className="text-text-2">{c.label}</span>
              )}
              {i < crumbs.length - 1 && <ChevronRight size={12} />}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-tight text-text leading-tight">{title}</h1>
          {subtitle && <div className="text-[13px] text-text-3 mt-0.5">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {tabs}
    </div>
  );
}
