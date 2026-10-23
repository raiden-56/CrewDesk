import type { ReactNode } from 'react';
import { Button } from '@mui/material';
import { AlertTriangle, Inbox, RefreshCw, type LucideIcon } from 'lucide-react';
import { errorMessage } from '@/lib/api';

export function EmptyState({ icon: Icon = Inbox, title, description, action, compact }: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6 px-4' : 'py-14 px-6'}`} role="status">
      <div className="h-11 w-11 rounded-xl bg-primary-soft text-primary flex items-center justify-center mb-3">
        <Icon size={22} />
      </div>
      <div className="font-semibold text-text">{title}</div>
      {description && <div className="text-text-3 text-[13px] mt-1 max-w-md">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Something went wrong', compact }: { error: unknown; onRetry?: () => void; title?: string; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6 px-4' : 'py-14 px-6'}`} role="alert">
      <div className="h-11 w-11 rounded-xl bg-danger-soft text-danger flex items-center justify-center mb-3">
        <AlertTriangle size={22} />
      </div>
      <div className="font-semibold text-text">{title}</div>
      <div className="text-text-3 text-[13px] mt-1 max-w-md break-words">{errorMessage(error)}</div>
      {onRetry && (
        <Button size="small" variant="outlined" startIcon={<RefreshCw size={14} />} onClick={onRetry} sx={{ mt: 2 }}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function InlineRefreshing({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-3" aria-live="polite">
      <RefreshCw size={11} className="animate-spin" /> refreshing
    </span>
  );
}
