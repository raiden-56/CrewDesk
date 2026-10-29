import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { RealtimeEvent } from '@collabspace/shared';
import { useAuthStore } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { GUEST_MODE_AVAILABLE, isGuestActive } from '@/guest/session';
import { setGuestRealtimeDispatcher } from '@/guest/events';

type Listener = (event: RealtimeEvent) => void;
const listeners = new Set<Listener>();
let socket: Socket | null = null;
let joinedWorkspace: string | null = null;

/** Subscribe to raw realtime events (used by chat streaming and timelines). */
export function onRealtime(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function invalidateFor(event: RealtimeEvent, qc: QueryClient) {
  switch (event.type) {
    case 'task.updated':
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['task', event.task.id] });
      void qc.invalidateQueries({ queryKey: ['agents'] });
      void qc.invalidateQueries({ queryKey: ['agent', event.task.agentId] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      break;
    case 'task.event':
      void qc.invalidateQueries({ queryKey: ['task-events', event.event.taskId] });
      void qc.invalidateQueries({ queryKey: ['task', event.event.taskId] });
      if (event.event.type === 'ARTIFACT_GENERATED') void qc.invalidateQueries({ queryKey: ['artifacts'] });
      break;
    case 'agent.updated':
      void qc.invalidateQueries({ queryKey: ['agents'] });
      void qc.invalidateQueries({ queryKey: ['agent', event.agentId] });
      break;
    case 'approval.updated':
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      void qc.invalidateQueries({ queryKey: ['approval', event.approvalId] });
      if (event.taskId) void qc.invalidateQueries({ queryKey: ['task', event.taskId] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      break;
    case 'message.created':
      void qc.invalidateQueries({ queryKey: ['messages', event.conversationId] });
      break;
    case 'notification':
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      break;
    case 'knowledge.updated':
      void qc.invalidateQueries({ queryKey: ['knowledge'] });
      break;
    case 'workflow.updated':
      void qc.invalidateQueries({ queryKey: ['workflows'] });
      void qc.invalidateQueries({ queryKey: ['workflow-execution', event.executionId] });
      void qc.invalidateQueries({ queryKey: ['workflow-executions'] });
      break;
    case 'artifact.created':
      void qc.invalidateQueries({ queryKey: ['artifacts'] });
      break;
    default:
      break;
  }
}

/** Mount once in the authenticated shell: connects the socket and keeps the workspace room in sync. */
export function useRealtime() {
  const qc = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const workspaceId = useAuthStore((s) => s.workspaceId);
  const notify = useUiStore((s) => s.notify);

  useEffect(() => {
    const handle = (event: RealtimeEvent) => {
      invalidateFor(event, qc);
      for (const l of listeners) l(event);
      if (event.type === 'notification') notify(event.notification.title, event.notification.type === 'TASK_FAILED' ? 'error' : event.notification.type === 'APPROVAL_REQUESTED' ? 'warning' : 'success');
    };
    if (status !== 'authenticated') {
      socket?.disconnect();
      socket = null;
      joinedWorkspace = null;
      if (GUEST_MODE_AVAILABLE) setGuestRealtimeDispatcher(null);
      return;
    }
    // Guest mode has no server: the mock API emits events locally instead of a socket.
    if (GUEST_MODE_AVAILABLE && isGuestActive()) {
      setGuestRealtimeDispatcher(handle);
      return;
    }
    if (!socket) {
      socket = io({ path: '/realtime', withCredentials: true, transports: ['websocket', 'polling'] });
      socket.on('event', handle);
      socket.on('connect', () => {
        if (joinedWorkspace) socket?.emit('workspace:join', joinedWorkspace);
      });
    }
    if (workspaceId && workspaceId !== joinedWorkspace) {
      joinedWorkspace = workspaceId;
      socket.emit('workspace:join', workspaceId);
    }
  }, [status, workspaceId, qc, notify]);
}
