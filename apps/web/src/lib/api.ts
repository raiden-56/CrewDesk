import { useAuthStore } from '@/store/auth';
import { GUEST_MODE_AVAILABLE, isGuestActive } from '@/guest/session';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const PREFIX = `${BASE}/api/v1`;

type Query = Record<string, string | number | boolean | undefined | null>;

function qs(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Guest mode: answer the request in the browser from sample data (no network). */
async function guestRequest<T>(method: string, path: string, body: unknown, opts: { query?: Query; raw?: boolean; form?: FormData }): Promise<T> {
  const { handleGuestRequest } = await import('@/guest/mockApi');
  await new Promise((resolve) => setTimeout(resolve, 120 + Math.random() * 180));
  const res = await handleGuestRequest(method, `${path}${qs(opts.query)}`, opts.form ? undefined : body, opts.form);
  if (opts.raw) {
    const file = res.raw;
    const response = file
      ? new Response(file.body, { status: 200, headers: { 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${encodeURIComponent(file.filename)}"` } })
      : new Response(JSON.stringify(res.data), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    return response as unknown as T;
  }
  if (res.status >= 400) {
    const err = (res.data as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | null)?.error;
    throw new ApiClientError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status})`, err?.details, err?.requestId);
  }
  return res.data as T;
}

async function request<T>(method: string, path: string, body?: unknown, opts: { query?: Query; raw?: boolean; form?: FormData } = {}): Promise<T> {
  if (GUEST_MODE_AVAILABLE && isGuestActive()) return guestRequest<T>(method, path, body, opts);
  const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' };
  const workspaceId = useAuthStore.getState().workspaceId;
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
  if (body !== undefined && !opts.form) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${PREFIX}${path}${qs(opts.query)}`, {
    method,
    headers,
    credentials: 'include',
    body: opts.form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401 && useAuthStore.getState().status === 'authenticated' && !path.startsWith('/auth/')) {
    useAuthStore.getState().setAnonymous();
  }
  if (opts.raw) return res as unknown as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | null)?.error;
    throw new ApiClientError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status})`, err?.details, err?.requestId);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, { query }),
  post: <T>(path: string, body?: unknown, query?: Query) => request<T>('POST', path, body ?? {}, { query }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string, query?: Query) => request<T>('DELETE', path, undefined, { query }),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, undefined, { form }),
  download: (path: string) => request<Response>('GET', path, undefined, { raw: true }),
  url: (path: string) => `${PREFIX}${path}`,
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
      return (err.details as Array<{ path: string; message: string }>).map((d) => `${d.path ? d.path + ': ' : ''}${d.message}`).join('; ');
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
