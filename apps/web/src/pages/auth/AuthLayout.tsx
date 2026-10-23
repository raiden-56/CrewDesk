import type { ReactNode } from 'react';
import { Logo } from '@/layout/Sidebar';

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-full flex items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <div className="cs-card p-6">
          <h1 className="text-[18px] font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-[13px] text-text-3 mt-1 mb-4">{subtitle}</p>}
          {children}
        </div>
        {footer && <div className="text-center text-[13px] text-text-3 mt-4">{footer}</div>}
      </div>
    </div>
  );
}
