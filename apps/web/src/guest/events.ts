import type { RealtimeEvent } from '@collabspace/shared';

/**
 * Bridge between the guest mock layer and the realtime hook. In guest mode no socket is opened;
 * instead the mock layer emits the same events the server would push, and the realtime hook
 * routes them through its normal handler (query invalidation, listeners, notifications).
 */
type Dispatcher = (event: RealtimeEvent) => void;
let dispatcher: Dispatcher | null = null;

export function setGuestRealtimeDispatcher(d: Dispatcher | null): void {
  dispatcher = d;
}

export function emitGuestEvent(event: RealtimeEvent): void {
  dispatcher?.(event);
}
