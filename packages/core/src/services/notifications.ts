import type { NotificationDto, NotificationType, WorkspaceRole } from '@collabspace/shared';
import { prisma } from '../db.js';
import { publishRealtime } from '../events.js';

export function toNotificationDto(n: { id: string; type: string; title: string; body: string; link: string | null; readAt: Date | null; createdAt: Date }): NotificationDto {
  return { id: n.id, type: n.type as NotificationType, title: n.title, body: n.body, link: n.link, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() };
}

export async function notifyUser(input: { workspaceId: string; userId: string; type: NotificationType; title: string; body: string; link?: string | null }) {
  const n = await prisma.notification.create({ data: { workspaceId: input.workspaceId, userId: input.userId, type: input.type, title: input.title, body: input.body, link: input.link ?? null } });
  await publishRealtime({ type: 'notification', workspaceId: input.workspaceId, userId: input.userId, notification: toNotificationDto(n) });
  return n;
}

/** Notify every member holding one of the given roles. */
export async function notifyRoles(input: { workspaceId: string; roles: WorkspaceRole[]; type: NotificationType; title: string; body: string; link?: string | null; excludeUserId?: string | null }) {
  const members = await prisma.workspaceMember.findMany({ where: { workspaceId: input.workspaceId, role: { in: input.roles } }, select: { userId: true } });
  const targets = members.map((m) => m.userId).filter((id) => id !== input.excludeUserId);
  await Promise.all(targets.map((userId) => notifyUser({ ...input, userId })));
  return targets.length;
}
