import { api } from './api';

/** Download an API resource through the authenticated client and save it under `name`. */
export async function downloadFile(path: string, name: string): Promise<void> {
  const res = await api.download(path);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
