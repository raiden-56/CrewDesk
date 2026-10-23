import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { resolveEmbeddings } from '../ai/index.js';

export interface RetrievedChunk {
  sourceId: string;
  title: string;
  url: string | null;
  type: string;
  chunkIndex: number;
  snippet: string;
  score: number;
}

/**
 * Search knowledge chunks the caller is allowed to read. Access control is enforced
 * by the `sourceIds` allowlist: callers must resolve permitted sources first.
 * Uses Postgres full-text search; when embeddings exist and a provider is configured,
 * results are re-ranked by cosine similarity.
 */
export async function searchKnowledge(opts: {
  workspaceId: string;
  sourceIds: string[];
  query: string;
  limit?: number;
  types?: string[];
}): Promise<RetrievedChunk[]> {
  const limit = Math.min(opts.limit ?? 5, 20);
  if (opts.sourceIds.length === 0) return [];
  const typeFilter = opts.types && opts.types.length ? Prisma.sql`AND s.type::text IN (${Prisma.join(opts.types)})` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ sourceId: string; title: string; url: string | null; type: string; index: number; content: string; score: number; embedding: unknown }>>(Prisma.sql`
    SELECT c."sourceId", s."title", s."url", s."type"::text as "type", c."index", c."content", c."embedding",
           ts_rank(to_tsvector('english', c."content"), plainto_tsquery('english', ${opts.query})) AS "score"
    FROM "KnowledgeChunk" c
    JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
    WHERE s."workspaceId" = ${opts.workspaceId}
      AND s."status" = 'READY'
      AND s."revokedAt" IS NULL
      AND s."id" IN (${Prisma.join(opts.sourceIds)})
      ${typeFilter}
      AND to_tsvector('english', c."content") @@ plainto_tsquery('english', ${opts.query})
    ORDER BY "score" DESC
    LIMIT ${limit * 3}
  `);

  let results = rows.map((r) => ({ ...r, score: Number(r.score) }));

  // Fallback: simple ILIKE match on individual words when full-text finds nothing
  if (results.length === 0) {
    const words = opts.query.split(/\s+/).filter((w) => w.length > 3).slice(0, 5);
    if (words.length) {
      const like = words.map((w) => Prisma.sql`c."content" ILIKE ${'%' + w + '%'}`);
      const fallback = await prisma.$queryRaw<typeof rows>(Prisma.sql`
        SELECT c."sourceId", s."title", s."url", s."type"::text as "type", c."index", c."content", c."embedding", 0.1::float AS "score"
        FROM "KnowledgeChunk" c
        JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
        WHERE s."workspaceId" = ${opts.workspaceId}
          AND s."status" = 'READY' AND s."revokedAt" IS NULL
          AND s."id" IN (${Prisma.join(opts.sourceIds)})
          ${typeFilter}
          AND (${Prisma.join(like, ' OR ')})
        LIMIT ${limit * 2}
      `);
      results = fallback.map((r) => ({ ...r, score: Number(r.score) }));
    }
  }

  // Optional embedding re-rank
  const embedder = resolveEmbeddings();
  if (embedder?.embed && results.some((r) => Array.isArray(r.embedding))) {
    try {
      const [q] = await embedder.embed([opts.query]);
      if (q) {
        results = results.map((r) => {
          const e = Array.isArray(r.embedding) ? (r.embedding as number[]) : null;
          if (!e || e.length !== q.length) return r;
          let dot = 0;
          for (let i = 0; i < q.length; i++) dot += (q[i] ?? 0) * (e[i] ?? 0);
          return { ...r, score: r.score * 0.5 + Math.max(0, dot) * 0.5 };
        });
        results.sort((a, b) => b.score - a.score);
      }
    } catch {
      /* embeddings are best-effort */
    }
  }

  return results.slice(0, limit).map((r) => ({
    sourceId: r.sourceId,
    title: r.title,
    url: r.url,
    type: r.type,
    chunkIndex: r.index,
    snippet: r.content.length > 800 ? `${r.content.slice(0, 800)}…` : r.content,
    score: Math.round(r.score * 1000) / 1000,
  }));
}

/**
 * Resolve which knowledge sources an agent version may read. Explicit sources +
 * project documents (if enabled) + workspace-wide knowledge (if enabled).
 */
export async function resolveAllowedSources(opts: {
  workspaceId: string;
  projectId: string | null;
  agentId: string;
  knowledge: { sourceIds?: string[]; allowWorkspaceKnowledge?: boolean; allowProjectDocuments?: boolean; allowPreviousReports?: boolean };
}): Promise<string[]> {
  const ids = new Set<string>();
  const explicit = await prisma.knowledgeSource.findMany({
    where: { workspaceId: opts.workspaceId, id: { in: opts.knowledge.sourceIds ?? [] }, revokedAt: null },
    select: { id: true },
  });
  explicit.forEach((s) => ids.add(s.id));
  const linked = await prisma.agentKnowledgeSource.findMany({ where: { agentId: opts.agentId, knowledgeSource: { workspaceId: opts.workspaceId, revokedAt: null } }, select: { knowledgeSourceId: true } });
  linked.forEach((l) => ids.add(l.knowledgeSourceId));
  if (opts.knowledge.allowProjectDocuments && opts.projectId) {
    const proj = await prisma.knowledgeSource.findMany({ where: { workspaceId: opts.workspaceId, projectId: opts.projectId, revokedAt: null }, select: { id: true } });
    proj.forEach((s) => ids.add(s.id));
  }
  if (opts.knowledge.allowWorkspaceKnowledge) {
    const all = await prisma.knowledgeSource.findMany({ where: { workspaceId: opts.workspaceId, revokedAt: null, type: { not: 'REPORT' } }, select: { id: true } });
    all.forEach((s) => ids.add(s.id));
  }
  if (opts.knowledge.allowPreviousReports) {
    const reports = await prisma.knowledgeSource.findMany({ where: { workspaceId: opts.workspaceId, revokedAt: null, type: 'REPORT' }, select: { id: true } });
    reports.forEach((s) => ids.add(s.id));
  }
  return [...ids];
}
