import { prisma } from '../../db.js';
import { Errors } from '../../errors.js';
import { searchKnowledge } from '../../knowledge/retrieve.js';
import { readArtifactContent } from '../../services/artifacts.js';
import { githubRequest } from '../../services/integrations.js';
import { getStorage } from '../../storage.js';
import type { ToolAdapter, ToolContext } from '../registry.js';

export const webSearch: ToolAdapter<{ query: string; limit: number }, unknown> = {
  id: 'web.search',
  async execute(input, ctx) {
    const results = await searchKnowledge({ workspaceId: ctx.workspaceId, sourceIds: ctx.knowledgeSourceIds, query: input.query, limit: input.limit, types: ['URL'] });
    return { results: results.map((r) => ({ sourceId: r.sourceId, title: r.title, url: r.url, snippet: r.snippet, score: r.score })) };
  },
};

export const docsSearch: ToolAdapter<{ query: string; limit: number }, unknown> = {
  id: 'docs.search',
  async execute(input, ctx) {
    const types = ctx.allowPreviousReports ? ['DOCUMENT', 'TEXT', 'FOLDER', 'REPORT'] : ['DOCUMENT', 'TEXT', 'FOLDER'];
    const results = await searchKnowledge({ workspaceId: ctx.workspaceId, sourceIds: ctx.knowledgeSourceIds, query: input.query, limit: input.limit, types });
    return { results: results.map((r) => ({ sourceId: r.sourceId, title: r.title, snippet: r.snippet, score: r.score, chunkIndex: r.chunkIndex })) };
  },
};

/** Resolve a file the agent is authorized to read: task input artifact, workspace artifact or allowed knowledge source. */
async function readAuthorizedFile(fileId: string, ctx: ToolContext): Promise<{ name: string; content: string }> {
  const artifact = await prisma.artifact.findFirst({ where: { id: fileId, workspaceId: ctx.workspaceId, deletedAt: null } });
  if (artifact) {
    const allowed = ctx.inputArtifactIds.includes(artifact.id) || artifact.visibility === 'WORKSPACE' || (artifact.visibility === 'PROJECT' && artifact.projectId === ctx.projectId) || artifact.taskId === ctx.taskId;
    if (!allowed) throw Errors.forbidden('Agent is not authorized to read this artifact');
    if (artifact.type === 'PDF' || artifact.mimeType.startsWith('application/octet-stream')) throw Errors.badRequest('Binary artifacts cannot be read as text');
    const { body } = await readArtifactContent(artifact.id, ctx.workspaceId);
    return { name: artifact.name, content: body.toString('utf8') };
  }
  const source = await prisma.knowledgeSource.findFirst({ where: { id: fileId, workspaceId: ctx.workspaceId, revokedAt: null } });
  if (source) {
    if (!ctx.knowledgeSourceIds.includes(source.id)) throw Errors.forbidden('Agent is not authorized to read this knowledge source');
    if (source.storageKey) {
      const buf = await getStorage().get(source.storageKey);
      return { name: source.title, content: buf.toString('utf8') };
    }
    const chunks = await prisma.knowledgeChunk.findMany({ where: { sourceId: source.id }, orderBy: { index: 'asc' } });
    return { name: source.title, content: chunks.map((c) => c.content).join('\n\n') };
  }
  throw Errors.notFound('File');
}

export const fileRead: ToolAdapter<{ fileId: string; maxChars: number }, unknown> = {
  id: 'file.read',
  async execute(input, ctx) {
    const file = await readAuthorizedFile(input.fileId, ctx);
    const truncated = file.content.length > input.maxChars;
    return { name: file.name, content: truncated ? file.content.slice(0, input.maxChars) : file.content, truncated };
  },
};

export const taskGet: ToolAdapter<{ taskId: string }, unknown> = {
  id: 'task.get',
  async execute(input, ctx) {
    const task = await prisma.agentTask.findFirst({ where: { id: input.taskId, workspaceId: ctx.workspaceId }, select: { id: true, title: true, status: true, description: true, resultSummary: true } });
    if (!task) throw Errors.notFound('Task');
    return { id: task.id, title: task.title, status: task.status, description: task.description, result: task.resultSummary };
  },
};

function parseCsv(text: string, maxRows: number): { header: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  const delimiter = (lines[0] ?? '').includes('\t') ? '\t' : (lines[0] ?? '').split(';').length > (lines[0] ?? '').split(',').length ? ';' : ',';
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = !quoted;
      } else if (ch === delimiter && !quoted) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((v) => v.trim());
  };
  const header = parseLine(lines[0] ?? '');
  const rows = lines.slice(1, 1 + maxRows).map(parseLine);
  return { header, rows };
}

export const csvAnalyze: ToolAdapter<{ fileId: string; maxRows: number }, unknown> = {
  id: 'csv.analyze',
  async execute(input, ctx) {
    const file = await readAuthorizedFile(input.fileId, ctx);
    const { header, rows } = parseCsv(file.content, input.maxRows);
    if (header.length === 0) throw Errors.badRequest('CSV has no header row');
    const columns = header.map((name, idx) => {
      const values = rows.map((r) => r[idx] ?? '').filter((v) => v !== '');
      const nums = values.map(Number).filter((n) => Number.isFinite(n));
      const numeric = values.length > 0 && nums.length === values.length;
      const distinct = new Set(values).size;
      return {
        name,
        type: numeric ? 'number' : 'string',
        nonEmpty: values.length,
        distinct,
        min: numeric && nums.length ? Math.min(...nums) : null,
        max: numeric && nums.length ? Math.max(...nums) : null,
        mean: numeric && nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000 : null,
        sample: [...new Set(values)].slice(0, 5),
      };
    });
    return { rowCount: rows.length, columns };
  },
};

export const repoMetadata: ToolAdapter<{ repository: string }, unknown> = {
  id: 'repo.metadata',
  async execute(input, ctx) {
    const repo = await githubRequest<{ full_name: string; default_branch: string; description: string | null }>(ctx.workspaceId, `/repos/${input.repository}`);
    const pulls = await githubRequest<Array<unknown>>(ctx.workspaceId, `/repos/${input.repository}/pulls?state=open&per_page=50`);
    const commits = await githubRequest<Array<{ sha: string; commit: { message: string; author: { name: string } | null } }>>(ctx.workspaceId, `/repos/${input.repository}/commits?per_page=10`);
    return {
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      description: repo.description,
      openPullRequests: pulls.length,
      recentCommits: commits.map((c) => ({ sha: c.sha.slice(0, 7), message: c.commit.message.split('\n')[0] ?? '', author: c.commit.author?.name ?? 'unknown' })),
    };
  },
};

export const READ_ADAPTERS: ToolAdapter[] = [webSearch, docsSearch, fileRead, taskGet, csvAnalyze, repoMetadata] as ToolAdapter[];
