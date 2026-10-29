import type { UserDto, WorkspaceDto } from '@collabspace/shared';

/**
 * Guest mode: a frontend-only demo for static deployments (GitHub Pages) that have no API server.
 * Only compiled in when the build sets VITE_GUEST_MODE=true; otherwise every helper is inert.
 */
export const GUEST_MODE_AVAILABLE = import.meta.env.VITE_GUEST_MODE === 'true';

const KEY = 'crewdesk.guest';
const SEEDED_AT = new Date(Date.now() - 1000 * 60 * 60 * 24 * 120).toISOString();

export const GUEST_WORKSPACE_ID = 'ws_demo';

export const GUEST_USER: UserDto = {
  id: 'u_guest',
  name: 'Guest Owner',
  email: 'guest@example.com',
  avatarUrl: null,
  themePreference: 'system',
  emailVerified: true,
  createdAt: SEEDED_AT,
};

export const GUEST_WORKSPACES: WorkspaceDto[] = [
  { id: GUEST_WORKSPACE_ID, name: 'Northwind Product Team', slug: 'northwind', role: 'OWNER', maxConcurrentTasks: 10, defaultAgentConcurrency: 2, createdAt: SEEDED_AT },
];

let active: boolean | null = null;
const endListeners = new Set<() => void>();

function read(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** True while the browser is in a guest session (always false when the build has guest mode off). */
export function isGuestActive(): boolean {
  if (!GUEST_MODE_AVAILABLE) return false;
  if (active === null) active = read();
  return active;
}

/** Enter guest mode without any network call. Persists for this browser tab (sessionStorage). */
export function startGuestSession(): { user: UserDto; workspaces: WorkspaceDto[] } {
  active = true;
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    /* private mode: guest mode still works until reload */
  }
  return { user: { ...GUEST_USER }, workspaces: GUEST_WORKSPACES.map((w) => ({ ...w })) };
}

/** Leave guest mode and drop the in-memory sample data. */
export function endGuestSession(): void {
  active = false;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  for (const l of endListeners) l();
}

export function onGuestSessionEnd(listener: () => void): () => void {
  endListeners.add(listener);
  return () => endListeners.delete(listener);
}
