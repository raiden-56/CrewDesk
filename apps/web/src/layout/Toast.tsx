import { Alert, Snackbar } from '@mui/material';
import { useUiStore } from '@/store/ui';

export function Toast() {
  const toast = useUiStore((s) => s.toast);
  const clear = useUiStore((s) => s.clearToast);
  return (
    <Snackbar key={toast?.key} open={Boolean(toast)} autoHideDuration={4000} onClose={clear} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
      <Alert onClose={clear} severity={toast?.severity ?? 'info'} variant="filled" sx={{ borderRadius: 2 }}>
        {toast?.message}
      </Alert>
    </Snackbar>
  );
}
