import type { EventLevel, ExecutionEventType, RealtimeEvent } from '@collabspace/shared';
import { prisma } from './db.js';
import { scrubSecrets } from './logger.js';
import { getRedis, REALTIME_CHANNEL } from './redis.js';

/** Publish a realtime event to every API instance (fan-out to websocket rooms happens there). */
export async function publishRealtime(event: RealtimeEvent): Promise<void> {
  try {
    await getRedis().publish(REALTIME_CHANNEL, JSON.stringify(event));
  } catch {
    // realtime is best-effort; persistence is the source of truth
  }
}

export interface RecordEventInput {
  taskId: string;
  workspaceId: string;
  executionId?: string | null;
  type: ExecutionEventType;
  level?: EventLevel;
  message: string;
  metadata?: Record<string, unknown> | null;
  /** detailed diagnostics shown only to users with audit.view.diagnostics */
  diagnostics?: Record<string, unknown> | null;
  durationMs?: number | null;
}

/** Persist an execution event with a monotonically increasing per-task sequence and broadcast it. */
export async function recordEvent(input: RecordEventInput) {
  const metadata = input.metadata ? scrubSecrets(input.metadata) : null;
  const diagnostics = input.diagnostics ? scrubSecrets(input.diagnostics) : null;
  // The API and the worker may append events concurrently; retry on sequence collisions.
  let event: Awaited<ReturnType<typeof prisma.executionEvent.create>> | null = null;
  for (let attempt = 0; attempt < 5 && !event; attempt++) {
    try {
      event = await prisma.$transaction(async (tx) => {
        const last = await tx.executionEvent.findFirst({ where: { taskId: input.taskId }, orderBy: { sequence: 'desc' }, select: { sequence: true } });
        return tx.executionEvent.create({
          data: {
            taskId: input.taskId,
            executionId: input.executionId ?? null,
            sequence: (last?.sequence ?? 0) + 1,
            type: input.type,
            level: input.level ?? 'INFO',
            message: input.message,
            metadata: metadata as object | undefined,
            diagnostics: diagnostics as object | undefined,
            durationMs: input.durationMs ?? null,
          },
        });
      });
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002' || attempt === 4) throw err;
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 40));
    }
  }
  if (!event) throw new Error('Failed to record execution event');
  await publishRealtime({
    type: 'task.event',
    workspaceId: input.workspaceId,
    event: {
      id: event.id,
      taskId: event.taskId,
      executionId: event.executionId,
      type: event.type as ExecutionEventType,
      level: event.level,
      message: event.message,
      metadata: (event.metadata as Record<string, unknown> | null) ?? null,
      durationMs: event.durationMs,
      sequence: event.sequence,
      createdAt: event.createdAt.toISOString(),
    },
  });
  return event;
}
