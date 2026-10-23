import { Router } from 'express';
import multer from 'multer';
import { PaginationQuery } from '@collabspace/shared';
import { audit, createArtifact, duplicateArtifact, Errors, prisma, readArtifactContent, softDeleteArtifact, toArtifactDto } from '@collabspace/core';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { query, validate } from '../middleware/validate.js';

export const artifactsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const include = { agent: { select: { id: true, name: true, avatar: true, color: true } }, createdBy: { select: { id: true, name: true } } } as const;

const ListQuery = PaginationQuery.extend({ taskId: z.string().optional(), agentId: z.string().optional(), projectId: z.string().optional(), type: z.string().optional(), search: z.string().max(100).optional() });

artifactsRouter.get('/', requirePermission('artifact.view'), validate(ListQuery, 'query'), async (req, res) => {
  const q = query<z.infer<typeof ListQuery>>(req);
  const where: Prisma.ArtifactWhereInput = {
    workspaceId: req.ws!.workspaceId,
    deletedAt: null,
    ...(q.taskId ? { taskId: q.taskId } : {}),
    ...(q.agentId ? { agentId: q.agentId } : {}),
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.type ? { type: q.type as Prisma.ArtifactWhereInput['type'] } : {}),
    ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.artifact.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.artifact.count({ where }),
  ]);
  res.json({ items: rows.map(toArtifactDto), page: q.page, pageSize: q.pageSize, total });
});

/** Upload a file as an artifact (used as task input). */
artifactsRouter.post('/', requirePermission('task.create'), upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) throw Errors.badRequest('Missing file field');
  const ext = file.originalname.split('.').pop()?.toLowerCase();
  const type = ext === 'md' ? 'MARKDOWN' : ext === 'csv' ? 'CSV' : ext === 'json' ? 'JSON' : ext === 'txt' ? 'TEXT' : ext === 'pdf' ? 'PDF' : 'UPLOAD';
  const projectId = typeof req.body?.projectId === 'string' && req.body.projectId ? req.body.projectId : null;
  const artifact = await createArtifact({ workspaceId: req.ws!.workspaceId, projectId, taskId: null, agentId: null, createdById: req.auth!.userId, name: file.originalname, type, content: file.buffer, mimeType: file.mimetype });
  await audit({ workspaceId: req.ws!.workspaceId, actorId: req.auth!.userId, action: 'artifact.uploaded', resourceType: 'artifact', resourceId: artifact.id, metadata: { name: artifact.name, size: artifact.size }, requestId: req.requestId });
  res.status(201).json(artifact);
});

artifactsRouter.get('/:id', requirePermission('artifact.view'), async (req, res) => {
  const row = await prisma.artifact.findFirst({ where: { id: req.params.id as string, workspaceId: req.ws!.workspaceId, deletedAt: null }, include });
  if (!row) throw Errors.notFound('Artifact');
  res.json(toArtifactDto(row));
});

artifactsRouter.get('/:id/download', requirePermission('artifact.view'), async (req, res) => {
  const { artifact, body } = await readArtifactContent(req.params.id as string, req.ws!.workspaceId);
  await audit({ workspaceId: req.ws!.workspaceId, actorId: req.auth!.userId, action: 'artifact.downloaded', resourceType: 'artifact', resourceId: artifact.id, requestId: req.requestId });
  res.setHeader('Content-Type', artifact.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(artifact.name)}"`);
  res.setHeader('Content-Length', String(body.length));
  res.send(body);
});

artifactsRouter.get('/:id/preview', requirePermission('artifact.view'), async (req, res) => {
  const { artifact, body } = await readArtifactContent(req.params.id as string, req.ws!.workspaceId);
  if (artifact.type === 'PDF' || artifact.type === 'UPLOAD') {
    res.json({ artifact, previewable: false, content: null });
    return;
  }
  const text = body.toString('utf8');
  res.json({ artifact, previewable: true, content: text.length > 200000 ? text.slice(0, 200000) : text, truncated: text.length > 200000 });
});

artifactsRouter.post('/:id/duplicate', requirePermission('task.create'), async (req, res) => {
  res.status(201).json(await duplicateArtifact(req.params.id as string, req.ws!.workspaceId, req.auth!.userId));
});

artifactsRouter.delete('/:id', requirePermission('artifact.delete'), async (req, res) => {
  await softDeleteArtifact(req.params.id as string, req.ws!.workspaceId);
  await audit({ workspaceId: req.ws!.workspaceId, actorId: req.auth!.userId, action: 'artifact.deleted', resourceType: 'artifact', resourceId: req.params.id as string, requestId: req.requestId });
  res.json({ ok: true });
});
