import type { KnowledgeSourceDto, KnowledgeSourceType, KnowledgeStatus } from '@collabspace/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { sha256 } from '../crypto.js';
import { Errors } from '../errors.js';
import { publishRealtime } from '../events.js';
import { isSupportedUpload } from '../knowledge/ingest.js';
import { enqueueKnowledgeIngest } from '../queue.js';
import { getStorage } from '../storage.js';
import { audit } from './audit.js';

export const knowledgeInclude = { createdBy: { select: { id: true, name: true } }, agentLinks: { select: { agentId: true } } } as const;
type Row = Prisma.KnowledgeSourceGetPayload<{ include: typeof knowledgeInclude }>;

export function toKnowledgeDto(s: Row): KnowledgeSourceDto {
  return {
    id: s.id,
    workspaceId: s.workspaceId,
    projectId: s.projectId,
    type: s.type as KnowledgeSourceType,
    title: s.title,
    url: s.url,
    status: s.status as KnowledgeStatus,
    statusMessage: s.statusMessage,
    version: s.version,
    chunkCount: s.chunkCount,
    size: s.size,
    agentIds: s.agentLinks.map((l) => l.agentId),
    createdBy: s.createdBy,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    indexedAt: s.indexedAt?.toISOString() ?? null,
  };
}

async function linkAgents(workspaceId: string, sourceId: string, agentIds: string[]) {
  if (!agentIds.length) return;
  const agents = await prisma.agent.findMany({ where: { id: { in: agentIds }, workspaceId }, select: { id: true } });
  await prisma.agentKnowledgeSource.createMany({ data: agents.map((a) => ({ agentId: a.id, knowledgeSourceId: sourceId })), skipDuplicates: true });
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function createUrlSource(workspaceId: string, actorId: string, input: { url: string; title?: string; projectId: string | null; agentIds: string[] }) {
  const url = new URL(input.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw Errors.badRequest('Only http(s) URLs can be approved');
  const source = await prisma.knowledgeSource.create({ data: { workspaceId, projectId: input.projectId, type: 'URL', title: input.title ?? input.url, url: input.url, createdById: actorId }, include: knowledgeInclude });
  await linkAgents(workspaceId, source.id, input.agentIds);
  await enqueueKnowledgeIngest(source.id);
  await audit({ workspaceId, actorId, action: 'knowledge.url_added', resourceType: 'knowledgeSource', resourceId: source.id, metadata: { url: input.url } });
  return toKnowledgeDto(await prisma.knowledgeSource.findUniqueOrThrow({ where: { id: source.id }, include: knowledgeInclude }));
}

export async function createTextSource(workspaceId: string, actorId: string, input: { title: string; content: string; projectId: string | null; agentIds: string[]; type?: 'TEXT' | 'REPORT' }) {
  const body = Buffer.from(input.content, 'utf8');
  const source = await prisma.knowledgeSource.create({ data: { workspaceId, projectId: input.projectId, type: input.type ?? 'TEXT', title: input.title, mimeType: 'text/plain', size: body.length, contentHash: sha256(body), createdById: actorId, storageKey: 'pending' } });
  const storageKey = `workspaces/${workspaceId}/knowledge/${source.id}/content.txt`;
  await getStorage().put(storageKey, body, 'text/plain; charset=utf-8');
  await prisma.knowledgeSource.update({ where: { id: source.id }, data: { storageKey } });
  await linkAgents(workspaceId, source.id, input.agentIds);
  await enqueueKnowledgeIngest(source.id);
  await audit({ workspaceId, actorId, action: 'knowledge.text_added', resourceType: 'knowledgeSource', resourceId: source.id, metadata: { title: input.title, size: body.length } });
  return toKnowledgeDto(await prisma.knowledgeSource.findUniqueOrThrow({ where: { id: source.id }, include: knowledgeInclude }));
}

export async function createUploadSource(workspaceId: string, actorId: string, input: { fileName: string; mimeType: string; body: Buffer; projectId: string | null; agentIds: string[] }) {
  if (input.body.length === 0) throw Errors.badRequest('Uploaded file is empty');
  if (input.body.length > MAX_UPLOAD_BYTES) throw Errors.badRequest('Uploaded file exceeds 20MB');
  if (!isSupportedUpload(input.mimeType, input.fileName)) throw Errors.badRequest('Unsupported file type. Supported: txt, md, csv, json, html');
  const source = await prisma.knowledgeSource.create({ data: { workspaceId, projectId: input.projectId, type: 'DOCUMENT', title: input.fileName.slice(0, 200), mimeType: input.mimeType, size: input.body.length, contentHash: sha256(input.body), createdById: actorId, storageKey: 'pending' } });
  const safeName = input.fileName.replace(/[^\w.\-]+/g, '_').slice(0, 120);
  const storageKey = `workspaces/${workspaceId}/knowledge/${source.id}/${safeName}`;
  await getStorage().put(storageKey, input.body, input.mimeType);
  await prisma.knowledgeSource.update({ where: { id: source.id }, data: { storageKey } });
  await linkAgents(workspaceId, source.id, input.agentIds);
  await enqueueKnowledgeIngest(source.id);
  await audit({ workspaceId, actorId, action: 'knowledge.file_uploaded', resourceType: 'knowledgeSource', resourceId: source.id, metadata: { fileName: input.fileName, size: input.body.length, mimeType: input.mimeType } });
  return toKnowledgeDto(await prisma.knowledgeSource.findUniqueOrThrow({ where: { id: source.id }, include: knowledgeInclude }));
}

export async function setSourceAgents(workspaceId: string, sourceId: string, agentIds: string[]) {
  const source = await prisma.knowledgeSource.findFirst({ where: { id: sourceId, workspaceId } });
  if (!source) throw Errors.notFound('Knowledge source');
  await prisma.agentKnowledgeSource.deleteMany({ where: { knowledgeSourceId: sourceId } });
  await linkAgents(workspaceId, sourceId, agentIds);
  return toKnowledgeDto(await prisma.knowledgeSource.findUniqueOrThrow({ where: { id: sourceId }, include: knowledgeInclude }));
}

export async function reindexSource(workspaceId: string, sourceId: string) {
  const source = await prisma.knowledgeSource.findFirst({ where: { id: sourceId, workspaceId } });
  if (!source) throw Errors.notFound('Knowledge source');
  if (source.revokedAt) throw Errors.conflict('Source is revoked');
  await prisma.knowledgeSource.update({ where: { id: sourceId }, data: { status: 'PENDING', statusMessage: 'Re-index requested' } });
  await publishRealtime({ type: 'knowledge.updated', workspaceId, sourceId, status: 'PENDING' });
  await enqueueKnowledgeIngest(sourceId);
}

export async function revokeSource(workspaceId: string, sourceId: string, actorId: string, hardDelete: boolean) {
  const source = await prisma.knowledgeSource.findFirst({ where: { id: sourceId, workspaceId } });
  if (!source) throw Errors.notFound('Knowledge source');
  if (hardDelete) {
    if (source.storageKey && source.storageKey !== 'pending') await getStorage().delete(source.storageKey).catch(() => undefined);
    await prisma.knowledgeSource.delete({ where: { id: sourceId } });
  } else {
    await prisma.knowledgeSource.update({ where: { id: sourceId }, data: { revokedAt: new Date(), status: 'REVOKED', statusMessage: 'Access revoked' } });
    await prisma.agentKnowledgeSource.deleteMany({ where: { knowledgeSourceId: sourceId } });
  }
  await publishRealtime({ type: 'knowledge.updated', workspaceId, sourceId, status: 'REVOKED' });
  await audit({ workspaceId, actorId, action: hardDelete ? 'knowledge.deleted' : 'knowledge.revoked', resourceType: 'knowledgeSource', resourceId: sourceId, metadata: { title: source.title } });
}
