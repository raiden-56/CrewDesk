import { create } from 'zustand';
import type { UserDto, WorkspaceDto, WorkspaceRole } from '@collabspace/shared';
import { roleHasPermission, type Permission } from '@collabspace/shared';

const WS_KEY = 'csai.workspace';

interface AuthState {
  status: 'unknown' | 'anonymous' | 'authenticated';
  user: UserDto | null;
  workspaces: WorkspaceDto[];
  workspaceId: string | null;
  setSession: (user: UserDto, workspaces: WorkspaceDto[]) => void;
  setAnonymous: () => void;
  setWorkspace: (id: string) => void;
  updateUser: (user: Partial<UserDto>) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'unknown',
  user: null,
  workspaces: [],
  workspaceId: null,
  setSession: (user, workspaces) => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(WS_KEY);
    } catch {
      /* ignore */
    }
    const current = get().workspaceId ?? stored;
    const workspaceId = workspaces.find((w) => w.id === current)?.id ?? workspaces[0]?.id ?? null;
    set({ status: 'authenticated', user, workspaces, workspaceId });
  },
  setAnonymous: () => set({ status: 'anonymous', user: null, workspaces: [], workspaceId: null }),
  setWorkspace: (id) => {
    try {
      localStorage.setItem(WS_KEY, id);
    } catch {
      /* ignore */
    }
    set({ workspaceId: id });
  },
  updateUser: (user) => set((s) => ({ user: s.user ? { ...s.user, ...user } : s.user })),
}));

export function useWorkspace(): WorkspaceDto | null {
  return useAuthStore((s) => s.workspaces.find((w) => w.id === s.workspaceId) ?? null);
}

export function useRole(): WorkspaceRole | null {
  return useWorkspace()?.role ?? null;
}

export function useCan(permission: Permission): boolean {
  const role = useRole();
  return role ? roleHasPermission(role, permission) : false;
}
