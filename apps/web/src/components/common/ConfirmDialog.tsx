import { useState, type ReactNode } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material';

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive,
  withComment,
  commentLabel = 'Comment (optional)',
  onConfirm,
  onClose,
  busy,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  withComment?: boolean;
  commentLabel?: string;
  onConfirm: (comment?: string) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [comment, setComment] = useState('');
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>{title}</DialogTitle>
      <DialogContent>
        {description && <div className="text-[13px] text-text-2">{description}</div>}
        {withComment && <TextField autoFocus fullWidth multiline minRows={2} label={commentLabel} value={comment} onChange={(e) => setComment(e.target.value)} sx={{ mt: 2 }} />}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy} color="inherit">
          Cancel
        </Button>
        <Button onClick={() => onConfirm(withComment ? comment : undefined)} disabled={busy} variant="contained" color={destructive ? 'error' : 'primary'}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
