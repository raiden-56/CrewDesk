import { prisma } from '../../db.js';
import { Errors } from '../../errors.js';
import { createArtifact, readArtifactContent, renderPdf, updateArtifactContent } from '../../services/artifacts.js';
import { githubRequest } from '../../services/integrations.js';
import type { ToolAdapter } from '../registry.js';

type Sources = Array<{ title: string; url?: string | null; sourceId?: string | null }>;

export const documentCreateDraft: ToolAdapter<{ title: string; content: string; sources?: string[] }, unknown> = {
  id: 'document.create_draft',
  async execute(input, ctx) {
    const artifact = await createArtifact({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      taskId: ctx.taskId,
      agentId: ctx.agentId,
      createdById: ctx.actorUserId,
      name: input.title,
      type: 'MARKDOWN',
      content: Buffer.from(input.content, 'utf8'),
      sources: (input.sources ?? []).map((s) => ({ title: s })),
    });
    return { artifactId: artifact.id, name: artifact.name, size: artifact.size };
  },
};

export const reportGenerate: ToolAdapter<{ title: string; format: 'MARKDOWN' | 'PDF' | 'CSV' | 'JSON'; content: string; sources?: Sources }, unknown> = {
  id: 'report.generate',
  async execute(input, ctx) {
    let body: Buffer;
    if (input.format === 'PDF') body = await renderPdf(input.title, input.content);
    else if (input.format === 'JSON') {
      try {
        body = Buffer.from(JSON.stringify(JSON.parse(input.content), null, 2), 'utf8');
      } catch {
        throw Errors.badRequest('report.generate JSON content is not valid JSON');
      }
    } else body = Buffer.from(input.content, 'utf8');
    const artifact = await createArtifact({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      taskId: ctx.taskId,
      agentId: ctx.agentId,
      createdById: ctx.actorUserId,
      name: input.title,
      type: input.format,
      content: body,
      sources: input.sources ?? [],
    });
    return { artifactId: artifact.id, name: artifact.name, size: artifact.size, type: artifact.type };
  },
};

export const taskCreateDraft: ToolAdapter<{ title: string; description?: string; priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'; agentId?: string }, unknown> = {
  id: 'task.create_draft',
  async execute(input, ctx) {
    const agentId = input.agentId ?? ctx.agentId;
    const agent = await prisma.agent.findFirst({ where: { id: agentId, workspaceId: ctx.workspaceId, archivedAt: null }, select: { id: true, currentVersionId: true } });
    if (!agent?.currentVersionId) throw Errors.notFound('Target agent');
    const task = await prisma.agentTask.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId: ctx.projectId,
        agentId: agent.id,
        agentVersionId: agent.currentVersionId,
        title: input.title,
        description: `${input.description ?? ''}\n\n_Draft created by agent ${ctx.agentName} during task ${ctx.taskId}._`.trim(),
        status: 'DRAFT',
        priority: input.priority,
        createdById: ctx.actorUserId,
      },
      select: { id: true, status: true },
    });
    return { taskId: task.id, status: task.status };
  },
};

export const projectComment: ToolAdapter<{ body: string }, unknown> = {
  id: 'project.comment',
  async execute(input, ctx) {
    if (!ctx.projectId) throw Errors.badRequest('Task is not associated with a project');
    const comment = await prisma.projectComment.create({ data: { workspaceId: ctx.workspaceId, projectId: ctx.projectId, body: input.body, authorType: 'AGENT', agentId: ctx.agentId, taskId: ctx.taskId } });
    return { commentId: comment.id };
  },
};

export const docsUpdate: ToolAdapter<{ artifactId: string; newContent: string; summary: string }, unknown> = {
  id: 'docs.update',
  async preview(input, ctx) {
    const { artifact, body } = await readArtifactContent(input.artifactId, ctx.workspaceId);
    return { targetResource: `artifact:${artifact.id} (${artifact.name} v${artifact.version})`, diff: { before: body.toString('utf8'), after: input.newContent }, evidence: { summary: input.summary } };
  },
  async execute(input, ctx) {
    const updated = await updateArtifactContent(input.artifactId, ctx.workspaceId, Buffer.from(input.newContent, 'utf8'), { actorId: ctx.approval?.approvedById ?? null });
    return { artifactId: updated.id, version: updated.version };
  },
};

export const githubPrDraft: ToolAdapter<{ repository: string; title: string; body: string; head: string; base: string }, unknown> = {
  id: 'github.pr_draft',
  async preview(input) {
    return { targetResource: `github:${input.repository} ${input.head} -> ${input.base}`, diff: { before: null, after: `${input.title}\n\n${input.body}` } };
  },
  async execute(input, ctx) {
    const pr = await githubRequest<{ number: number; html_url: string }>(ctx.workspaceId, `/repos/${input.repository}/pulls`, {
      method: 'POST',
      body: JSON.stringify({ title: input.title, body: input.body, head: input.head, base: input.base, draft: true }),
    });
    return { number: pr.number, url: pr.html_url };
  },
  async verify(input, ctx) {
    // Check whether a PR with the same head already exists (idempotency after an uncertain failure)
    const [owner] = input.repository.split('/');
    const prs = await githubRequest<Array<{ number: number; html_url: string }>>(ctx.workspaceId, `/repos/${input.repository}/pulls?state=open&head=${owner}:${encodeURIComponent(input.head)}`);
    return prs[0] ? { number: prs[0].number, url: prs[0].html_url } : null;
  },
};

export const WRITE_ADAPTERS: ToolAdapter[] = [documentCreateDraft, reportGenerate, taskCreateDraft, projectComment, docsUpdate, githubPrDraft] as ToolAdapter[];
