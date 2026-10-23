import { IconButton } from '@mui/material';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Compact page navigation for server-paginated lists. */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-end gap-2 text-[12px] text-text-3 px-1 py-2">
      <span>
        {from}–{to} of {total}
      </span>
      <IconButton size="small" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft size={15} />
      </IconButton>
      <span>
        Page {page} / {pages}
      </span>
      <IconButton size="small" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight size={15} />
      </IconButton>
    </div>
  );
}
