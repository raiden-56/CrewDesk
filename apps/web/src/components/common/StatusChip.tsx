import { Chip, type ChipProps } from '@mui/material';
import { TASK_STATUS_LABELS, type TaskStatus } from '@collabspace/shared';
import { statusColor } from '@/theme/tokens';
import { titleCase } from '@/lib/format';

const LABELS: Record<string, string> = { ...TASK_STATUS_LABELS, WAITING_APPROVAL: 'Awaiting approval', CHANGES_REQUESTED: 'Changes requested' };

export function StatusChip({ status, size = 'small', pulse, ...rest }: { status: string; pulse?: boolean } & Omit<ChipProps, 'label' | 'color'>) {
  const color = statusColor[status] ?? 'default';
  const label = LABELS[status as TaskStatus] ?? titleCase(status);
  return (
    <Chip
      size={size}
      color={color}
      variant={color === 'default' ? 'outlined' : 'filled'}
      label={
        <span className="inline-flex items-center gap-1.5">
          {pulse && <span className="relative inline-flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" /></span>}
          {label}
        </span>
      }
      sx={{ '& .MuiChip-label': { display: 'inline-flex', alignItems: 'center' }, ...(color !== 'default' ? { bgcolor: (t) => (t.palette.mode === 'dark' ? `${t.palette[color].main}26` : `${t.palette[color].main}1a`), color: (t) => (t.palette.mode === 'dark' ? t.palette[color].light ?? t.palette[color].main : t.palette[color].dark ?? t.palette[color].main) } : {}) }}
      {...rest}
    />
  );
}

export function RiskChip({ risk }: { risk: string }) {
  return <StatusChip status={risk} size="small" sx={{ fontSize: '0.68rem' }} />;
}
