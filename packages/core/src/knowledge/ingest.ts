import type { KnowledgeStatus } from '@collabspace/shared';
import { resolveEmbeddings } from '../ai/index.js';
import { prisma } from '../db.js';
import { sha256 } from '../crypto.js';
import { publishRealtime } from '../events.js';
import { logger } from '../logger.js';
import { getStorage } from '../storage.js';
import { chunkText, estimateChunkTokens as estimateTokens, htmlToText } from './chunk.js';

const MAX_SOURCE_CHARS = 2_000_000;
const SUPPORTED_UPLOAD_TYPES = ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/html'];

export function isSupportedUpload(mimeType: string, fileName: string): boolean {
  if (SUPPORTED_UPLOAD_TYPES.some((t) => mimeType.startsWith(t))) return true;
  return /\.(txt|md|markdown|csv|json|html?)$/i.test(fileName);
}

async function setStatus(sourceId: string, workspaceId: string, status: KnowledgeStatus, statusMessage: string | null = null, extra: Record<string, unknown> = {}) {
  await prisma.knowledgeSource.update({ where: { id: sourceId }, data: { status, statusMessage, ...extra } });
  await publishRealtime({ type: 'knowledge.updated', workspaceId, sourceId, status });
}

/** Fetch an approved URL with safety limits (no redirects to private hosts, size caps). */
async function fetchUrlText(url: string): Promise<{ title: string | null; text: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only http(s) URLs are supported');
  const host = parsed.hostname;
  if (host === 'localhost' || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === '[::1]') {
    throw new Error('URLs pointing to private networks are not allowed');
  }
  const res = await fetch(url, { headers: { 'User-Agent': 'collabspace-ai-team-indexer/1.0', Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
  const contentType = res.headers.get('content-type') ?? '';
  const raw = await res.text();
  if (raw.length > MAX_SOURCE_CHARS) throw new Error('Source is too large to index (limit 2MB of text)');
  if (contentType.includes('html') || /^\s*<(!doctype|html)/i.test(raw)) return htmlToText(raw);
  return { title: null, text: raw };
}

/**
 * Ingest a knowledge source: validate -> extract text -> chunk -> (embed) -> store.
 * Runs in the worker. Safe to retry: chunks are replaced atomically per version.
 */
export async function ingestKnowledgeSource(sourceId: string): Promise<void> {
  const source = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } });
  if (!source) return;
  if (source.revokedAt) return;
  await setStatus(source.id, source.workspaceId, 'PROCESSING', 'Extracting text');
  try {
    let text = '';
    let title = source.title;
    if (source.type === 'URL') {
      if (!source.url) throw new Error('URL source has no url');
      const fetched = await fetchUrlText(source.url);
      text = fetched.text;
      if (!title || title === source.url) title = fetched.title ?? source.url;
    } else if (source.type === 'TEXT' || source.type === 'DOCUMENT' || source.type === 'REPORT') {
      if (!source.storageKey) throw new Error('Source has no stored content');
      const buf = await getStorage().get(source.storageKey);
      const raw = buf.toString('utf8');
      text = source.mimeType?.includes('html') ? htmlToText(raw).text : raw;
    } else {
      throw new Error(`Unsupported source type ${source.type}`);
    }
    if (!text.trim()) throw new Error('No extractable text found in source');
    if (text.length > MAX_SOURCE_CHARS) text = text.slice(0, MAX_SOURCE_CHARS);
    const hash = sha256(text);
    const chunks = chunkText(text);
    let embeddings: number[][] | null = null;
    const embedder = resolveEmbeddings();
    if (embedder?.embed) {
      try {
        await setStatus(source.id, source.workspaceId, 'PROCESSING', `Embedding ${chunks.length} chunks`);
        embeddings = [];
        for (let i = 0; i < chunks.length; i += 32) {
          const batch = chunks.slice(i, i + 32);
          embeddings.push(...(await embedder.embed(batch)));
        }
      } catch (err) {
        logger.warn({ err, sourceId }, 'embedding failed; indexing with full-text search only');
        embeddings = null;
      }
    }
    await prisma.$transaction(async (tx) => {
      await tx.knowledgeChunk.deleteMany({ where: { sourceId: source.id } });
      await tx.knowledgeChunk.createMany({
        data: chunks.map((content, index) => ({ sourceId: source.id, index, content, tokens: estimateTokens(content), embedding: embeddings?.[index] ?? undefined })),
      });
      await tx.knowledgeSource.update({
        where: { id: source.id },
        data: { title, status: 'READY', statusMessage: `Indexed ${chunks.length} chunks${embeddings ? ' with embeddings' : ' (full-text search)'}`, chunkCount: chunks.length, contentHash: hash, size: text.length, indexedAt: new Date(), version: source.contentHash && source.contentHash !== hash ? source.version + 1 : source.version },
      });
    });
    await publishRealtime({ type: 'knowledge.updated', workspaceId: source.workspaceId, sourceId: source.id, status: 'READY' });
  } catch (err) {
    logger.error({ err, sourceId }, 'knowledge ingestion failed');
    await setStatus(source.id, source.workspaceId, 'FAILED', (err as Error).message.slice(0, 500));
    throw err;
  }
}
