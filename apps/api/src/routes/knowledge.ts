import { Router } from 'express';
import multer from 'multer';
import { CreateKnowledgeSchema, PaginationQuery } from '@collabspace/shared';
import { createTextSource, createUploadSource, createUrlSource, Errors, knowledgeInclude, prisma, reindexSource, resolveAllowedSources, revokeSource, searchKnowledge, setSourceAgents, toKnowledgeDto } from '@collabspace/core';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { body, query, validate } from '../middleware/validate.js';

export const knowledgeRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

const ListQuery = PaginationQuery.extend({ projectId: z.string().optional(), status: z.string().optional(), type: z.string().optional(), search: z.string().max(100).optional(), agentId: z.string().optional() });

knowledgeRouter.get('/', requirePermission('knowledge.view'), validate(ListQuery, 'query'), async (req, res) => {
  const q = query<z.infer<typeof ListQuery>>(req);
  const where: Prisma.KnowledgeSourceWhereInput = {
    workspaceId: req.ws!.workspaceId,
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.status ? { status: q.status as Prisma.KnowledgeSourceWhereInput['status'] } : {}),
    ...(q.type ? { type: q.type as Prisma.KnowledgeSourceWhereInput['type'] } : {}),
    ...(q.agentId ? { agentLinks: { some: { agentId: q.agentId } } } : {}),
    ...(q.search ? { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { url: { contains: q.search, mode: 'insensitive' } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.knowledgeSource.findMany({ where, include: knowledgeInclude, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.knowledgeSource.count({ where }),
  ]);
  res.json({ items: rows.map(toKnowledgeDto), page: q.page, pageSize: q.pageSize, total });
});

knowledgeRouter.get('/search', requirePermission('knowledge.view'), validate(z.object({ q: z.string().min(2).max(300), limit: z.coerce.number().int().min(1).max(20).default(8), agentId: z.string().optional() }), 'query'), async (req, res) => {
  const q = query<{ q: string; limit: number; agentId?: string }>(req);
  let sourceIds: string[];
  if (q.agentId) {
    const agent = await prisma.agent.findFirst({ where: { id: q.agentId, workspaceId: req.ws!.workspaceId }, include: { currentVersion: { select: { knowledge: true } } } });
    if (!agent) throw Errors.notFound('Agent');
    sourceIds = await resolveAllowedSources({ workspaceId: req.ws!.workspaceId, projectId: agent.projectId, agentId: agent.id, knowledge: (agent.currentVersion?.knowledge as Parameters<typeof resolveAllowedSources>[0]['knowledge']) ?? {} });
  } else {
    sourceIds = (await prisma.knowledgeSource.findMany({ where: { workspaceId: req.ws!.workspaceId, revokedAt: null }, select: { id: true } })).map((s) => s.id);
  }
  res.json({ items: await searchKnowledge({ workspaceId: req.ws!.workspaceId, sourceIds, query: q.q, limit: q.limit }) });
});

knowledgeRouter.post('/', requirePermission('knowledge.manage'), validate(CreateKnowledgeSchema), async (req, res) => {
  const input = body<z.infer<typeof CreateKnowledgeSchema>>(req);
  const result = input.type === 'URL' ? await createUrlSource(req.ws!.workspaceId, req.auth!.userId, input) : await createTextSource(req.ws!.workspaceId, req.auth!.userId, input);
  res.status(201).json(result);
});

knowledgeRouter.post('/upload', requirePermission('knowledge.manage'), upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) throw Errors.badRequest('Missing file field');
  const projectId = typeof req.body?.projectId === 'string' && req.body.projectId ? req.body.projectId : null;
  const agentIds = typeof req.body?.agentIds === 'string' && req.body.agentIds ? String(req.body.agentIds).split(',').filter(Boolean) : [];
  const result = await createUploadSource(req.ws!.workspaceId, req.auth!.userId, { fileName: file.originalname, mimeType: file.mimetype, body: file.buffer, projectId, agentIds });
  res.status(201).json(result);
});

knowledgeRouter.get('/:id', requirePermission('knowledge.view'), async (req, res) => {
  const row = await prisma.knowledgeSource.findFirst({ where: { id: req.params.id as string, workspaceId: req.ws!.workspaceId }, include: knowledgeInclude });
  if (!row) throw Errors.notFound('Knowledge source');
  const chunks = await prisma.knowledgeChunk.findMany({ where: { sourceId: row.id }, orderBy: { index: 'asc' }, take: 5, select: { index: true, content: true, tokens: true } });
  res.json({ ...toKnowledgeDto(row), sampleChunks: chunks.map((c) => ({ ...c, content: c.content.slice(0, 500) })) });
});

knowledgeRouter.post('/:id/reindex', requirePermission('knowledge.manage'), async (req, res) => {
  await reindexSource(req.ws!.workspaceId, req.params.id as string);
  res.json({ ok: true });
});

knowledgeRouter.post('/:id/agents', requirePermission('knowledge.manage'), validate(z.object({ agentIds: z.array(z.string()).max(100) })), async (req, res) => {
  res.json(await setSourceAgents(req.ws!.workspaceId, req.params.id as string, body<{ agentIds: string[] }>(req).agentIds));
});

knowledgeRouter.delete('/:id', requirePermission('knowledge.manage'), async (req, res) => {
  await revokeSource(req.ws!.workspaceId, req.params.id as string, req.auth!.userId, req.query.hard === 'true');
  res.json({ ok: true });
});
