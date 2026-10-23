import { Router } from 'express';
import { AuditQuery, type AuditLogDto } from '@collabspace/shared';
import { prisma } from '@collabspace/core';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { query, validate } from '../middleware/validate.js';

export const auditRouter = Router();

auditRouter.get('/', requirePermission('audit.view'), validate(AuditQuery, 'query'), async (req, res) => {
  const q = query<z.infer<typeof AuditQuery>>(req);
  const where: Prisma.AuditLogWhereInput = {
    workspaceId: req.ws!.workspaceId,
    ...(q.action ? { action: { startsWith: q.action } } : {}),
    ...(q.actorId ? { actorId: q.actorId } : {}),
    ...(q.resourceType ? { resourceType: q.resourceType } : {}),
    ...(q.search ? { OR: [{ action: { contains: q.search, mode: 'insensitive' } }, { resourceId: { contains: q.search, mode: 'insensitive' } }, { actor: { name: { contains: q.search, mode: 'insensitive' } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, include: { actor: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  const items: AuditLogDto[] = rows.map((r) => ({ id: r.id, action: r.action, resourceType: r.resourceType, resourceId: r.resourceId, actor: r.actor, actorType: r.actorType, metadata: (r.metadata as Record<string, unknown> | null) ?? null, ip: r.ip, createdAt: r.createdAt.toISOString() }));
  res.json({ items, page: q.page, pageSize: q.pageSize, total });
});
