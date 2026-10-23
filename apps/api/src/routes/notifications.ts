import { Router } from 'express';
import { prisma, toNotificationDto } from '@collabspace/core';

export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res) => {
  const workspaceId = req.header('x-workspace-id') ?? undefined;
  const rows = await prisma.notification.findMany({ where: { userId: req.auth!.userId, ...(workspaceId ? { workspaceId } : {}) }, orderBy: { createdAt: 'desc' }, take: 50 });
  const unread = await prisma.notification.count({ where: { userId: req.auth!.userId, readAt: null, ...(workspaceId ? { workspaceId } : {}) } });
  res.json({ items: rows.map(toNotificationDto), unread });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.auth!.userId, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  await prisma.notification.updateMany({ where: { id: req.params.id as string, userId: req.auth!.userId }, data: { readAt: new Date() } });
  res.json({ ok: true });
});
