import PDFDocument from 'pdfkit';
import type { ArtifactDto, ArtifactType } from '@collabspace/shared';
import { prisma } from '../db.js';
import { sha256 } from '../crypto.js';
import { Errors } from '../errors.js';
import { publishRealtime } from '../events.js';
import { getStorage } from '../storage.js';

const MIME: Record<ArtifactType, string> = {
  MARKDOWN: 'text/markdown; charset=utf-8',
  CSV: 'text/csv; charset=utf-8',
  JSON: 'application/json; charset=utf-8',
  PDF: 'application/pdf',
  TEXT: 'text/plain; charset=utf-8',
  UPLOAD: 'application/octet-stream',
};
const EXT: Record<ArtifactType, string> = { MARKDOWN: 'md', CSV: 'csv', JSON: 'json', PDF: 'pdf', TEXT: 'txt', UPLOAD: 'bin' };

export function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[^\w.\- ]+/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[. ]+|[. ]+$/g, '')
      .slice(0, 120) || 'artifact'
  );
}

const artifactInclude = {
  agent: { select: { id: true, name: true, avatar: true, color: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

type ArtifactRow = Awaited<ReturnType<typeof prisma.artifact.findFirstOrThrow<{ include: typeof artifactInclude }>>>;

export function toArtifactDto(a: ArtifactRow): ArtifactDto {
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    projectId: a.projectId,
    taskId: a.taskId,
    agentId: a.agentId,
    agent: a.agent,
    name: a.name,
    type: a.type as ArtifactType,
    mimeType: a.mimeType,
    size: a.size,
    version: a.version,
    sources: (a.sources as ArtifactDto['sources']) ?? [],
    visibility: a.visibility,
    createdBy: a.createdBy,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Render markdown-ish text to a simple PDF with pdfkit. */
export async function renderPdf(title: string, content: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: 'A4', info: { Title: title } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font('Helvetica-Bold').fontSize(20).text(title, { align: 'left' });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(9).fillColor('#666').text(`Generated ${new Date().toISOString()}`);
    doc.moveDown();
    doc.fillColor('#000');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.replace(/\t/g, '    ');
      if (/^#{1,2}\s/.test(line)) {
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').fontSize(14).text(line.replace(/^#{1,2}\s/, ''));
        doc.moveDown(0.2);
      } else if (/^#{3,6}\s/.test(line)) {
        doc.font('Helvetica-Bold').fontSize(11).text(line.replace(/^#{3,6}\s/, ''));
      } else if (/^\s*[-*]\s/.test(line)) {
        doc.font('Helvetica').fontSize(10).text(`• ${line.replace(/^\s*[-*]\s/, '')}`, { indent: 12 });
      } else if (/^```/.test(line)) {
        doc.moveDown(0.2);
      } else if (/^\|/.test(line)) {
        doc.font('Courier').fontSize(8).text(line);
      } else if (line.trim() === '') {
        doc.moveDown(0.5);
      } else {
        doc.font('Helvetica').fontSize(10).text(line.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1'));
      }
    }
    doc.end();
  });
}

function validateGenerated(type: ArtifactType, body: Buffer): void {
  if (body.length === 0) throw Errors.badRequest('Generated file is empty');
  if (type === 'PDF' && body.subarray(0, 4).toString() !== '%PDF') throw Errors.badRequest('Generated PDF is invalid');
  if (type === 'JSON') {
    try {
      JSON.parse(body.toString('utf8'));
    } catch {
      throw Errors.badRequest('Generated JSON is invalid');
    }
  }
  if (type === 'CSV') {
    const text = body.toString('utf8');
    const first = text.split('\n')[0] ?? '';
    if (!first.includes(',') && !first.includes(';') && !first.includes('\t')) throw Errors.badRequest('Generated CSV has no delimited header row');
  }
}

export interface CreateArtifactInput {
  workspaceId: string;
  projectId: string | null;
  taskId: string | null;
  agentId: string | null;
  createdById: string | null;
  name: string;
  type: ArtifactType;
  content: Buffer;
  mimeType?: string;
  sources?: Array<{ title: string; url?: string | null; sourceId?: string | null }>;
  visibility?: 'WORKSPACE' | 'PROJECT' | 'PRIVATE';
}

export async function createArtifact(input: CreateArtifactInput) {
  if (input.type !== 'UPLOAD') validateGenerated(input.type, input.content);
  const base = sanitizeFileName(input.name);
  const name = base.toLowerCase().endsWith(`.${EXT[input.type]}`) || input.type === 'UPLOAD' ? base : `${base}.${EXT[input.type]}`;
  const id = (await prisma.artifact.create({ data: { workspaceId: input.workspaceId, projectId: input.projectId, taskId: input.taskId, agentId: input.agentId, createdById: input.createdById, name, type: input.type, mimeType: input.mimeType ?? MIME[input.type], size: input.content.length, storageKey: 'pending', contentHash: sha256(input.content), sources: input.sources ?? [], visibility: input.visibility ?? 'WORKSPACE' }, select: { id: true } })).id;
  const storageKey = `workspaces/${input.workspaceId}/artifacts/${id}/v1/${name}`;
  await getStorage().put(storageKey, input.content, input.mimeType ?? MIME[input.type]);
  const artifact = await prisma.artifact.update({ where: { id }, data: { storageKey }, include: artifactInclude });
  const dto = toArtifactDto(artifact);
  await publishRealtime({ type: 'artifact.created', workspaceId: input.workspaceId, artifact: dto });
  return dto;
}

/** Create a new version of an existing text artifact (used by docs.update). */
export async function updateArtifactContent(artifactId: string, workspaceId: string, content: Buffer, opts: { actorId?: string | null } = {}) {
  const existing = await prisma.artifact.findFirst({ where: { id: artifactId, workspaceId, deletedAt: null } });
  if (!existing) throw Errors.notFound('Artifact');
  if (existing.type !== 'MARKDOWN' && existing.type !== 'TEXT' && existing.type !== 'JSON' && existing.type !== 'CSV') throw Errors.badRequest('Only text artifacts can be updated');
  validateGenerated(existing.type as ArtifactType, content);
  const version = existing.version + 1;
  const storageKey = `workspaces/${workspaceId}/artifacts/${artifactId}/v${version}/${existing.name}`;
  await getStorage().put(storageKey, content, existing.mimeType);
  const updated = await prisma.artifact.update({ where: { id: artifactId }, data: { storageKey, version, size: content.length, contentHash: sha256(content) }, include: artifactInclude });
  void opts;
  return toArtifactDto(updated);
}

export async function readArtifactContent(artifactId: string, workspaceId: string): Promise<{ artifact: ArtifactDto; body: Buffer }> {
  const a = await prisma.artifact.findFirst({ where: { id: artifactId, workspaceId, deletedAt: null }, include: artifactInclude });
  if (!a) throw Errors.notFound('Artifact');
  const body = await getStorage().get(a.storageKey);
  return { artifact: toArtifactDto(a), body };
}

export async function softDeleteArtifact(artifactId: string, workspaceId: string) {
  const a = await prisma.artifact.findFirst({ where: { id: artifactId, workspaceId, deletedAt: null } });
  if (!a) throw Errors.notFound('Artifact');
  await prisma.artifact.update({ where: { id: artifactId }, data: { deletedAt: new Date() } });
  try {
    await getStorage().delete(a.storageKey);
  } catch {
    /* object may already be gone; the DB row is the source of truth */
  }
  return true;
}

export async function duplicateArtifact(artifactId: string, workspaceId: string, actorId: string) {
  const { artifact, body } = await readArtifactContent(artifactId, workspaceId);
  return createArtifact({
    workspaceId,
    projectId: artifact.projectId,
    taskId: artifact.taskId,
    agentId: artifact.agentId,
    createdById: actorId,
    name: `Copy of ${artifact.name}`,
    type: artifact.type,
    content: body,
    mimeType: artifact.mimeType,
    sources: artifact.sources,
    visibility: artifact.visibility,
  });
}
