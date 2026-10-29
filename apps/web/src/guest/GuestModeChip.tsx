import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Tooltip } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { Compass } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { endGuestSession } from './session';

const TOOLTIP = 'You are exploring a sample workspace. Everything runs in your browser; changes last only until you reload or sign out.';

/** Leave guest mode: drop the sample data and cached queries, then return to the login page. */
export function useLeaveGuestMode() {
  const qc = useQueryClient();
  const setAnonymous = useAuthStore((s) => s.setAnonymous);
  const navigate = useNavigate();
  return () => {
    endGuestSession();
    setAnonymous();
    navigate('/login');
    qc.clear();
  };
}

function Chip({ className, label }: { className: string; label: ReactNode }) {
  const leave = useLeaveGuestMode();
  return (
    <Tooltip title={TOOLTIP}>
      <span role="status" className={`items-center gap-1.5 rounded-md bg-info-soft text-info pl-2 pr-1 py-1 text-[11px] font-semibold whitespace-nowrap ${className}`} data-testid="guest-mode-chip">
        <Compass size={12} />
        {label}
        <button type="button" onClick={leave} className="ml-0.5 rounded px-1.5 py-0.5 hover:bg-info/15 hover:underline underline-offset-2" aria-label="Exit guest mode">
          Exit
        </button>
      </span>
    </Tooltip>
  );
}

/** Header chip (tablet and desktop). */
export function GuestModeChip() {
  return (
    <Chip
      className="hidden sm:inline-flex"
      label={
        <>
          <span className="xl:hidden">Guest mode · sample data</span>
          <span className="hidden xl:inline">Guest mode – sample data, changes aren't saved</span>
        </>
      }
    />
  );
}

/** Floating pill for phones, where the header has no room. Render outside the (backdrop-filtered) header. */
export function GuestModeMobileBanner() {
  return <Chip className="sm:hidden inline-flex fixed bottom-3 left-3 z-[1100] shadow-md border border-info/30" label="Guest mode – sample data" />;
}
