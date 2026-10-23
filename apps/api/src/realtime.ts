import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { RealtimeEvent } from '@collabspace/shared';
import { createRedis, getConfig, logger, prisma, REALTIME_CHANNEL, resolveSession } from '@collabspace/core';
import { SESSION_COOKIE } from './middleware/auth.js';

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/**
 * Socket.IO server. Clients authenticate with the session cookie, then join a workspace
 * room after a membership check. Events are fanned out from the Redis channel that the
 * worker and API publish to, so any number of API instances can serve clients.
 */
export function attachRealtime(server: HttpServer) {
  const cfg = getConfig();
  const io = new Server(server, { path: '/realtime', cors: { origin: cfg.WEB_ORIGIN, credentials: true } });

  io.use(async (socket, next) => {
    const token = parseCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
    if (!token) return next(new Error('unauthorized'));
    const session = await resolveSession(token);
    if (!session) return next(new Error('unauthorized'));
    socket.data.userId = session.userId;
    next();
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    void socket.join(`user:${userId}`);
    socket.on('workspace:join', async (workspaceId: string, ack?: (ok: boolean) => void) => {
      const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
      if (!member) return ack?.(false);
      for (const room of socket.rooms) if (room.startsWith('workspace:')) void socket.leave(room);
      void socket.join(`workspace:${workspaceId}`);
      ack?.(true);
    });
  });

  const sub = createRedis();
  sub.subscribe(REALTIME_CHANNEL).catch((err) => logger.error({ err }, 'realtime subscribe failed'));
  sub.on('message', (_channel: string, raw: string) => {
    try {
      const event = JSON.parse(raw) as RealtimeEvent;
      if (event.type === 'notification') io.to(`user:${event.userId}`).emit('event', event);
      else io.to(`workspace:${event.workspaceId}`).emit('event', event);
    } catch (err) {
      logger.warn({ err }, 'bad realtime payload');
    }
  });

  return io;
}
