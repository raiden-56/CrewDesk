import { prisma } from '../../db.js';
import { Errors } from '../../errors.js';
import { readArtifactContent, softDeleteArtifact } from '../../services/artifacts.js';
import { githubRequest, postWebhook } from '../../services/integrations.js';
import type { ToolAdapter } from '../registry.js';

const ALLOWED_OPERATIONS = ['cache.flush', 'service.restart', 'feature-flag.set', 'deploy.trigger', 'job.rerun'];

export const contentPublish: ToolAdapter<{ artifactId: string; destination: string }, unknown> = {
  id: 'content.publish',
  async preview(input, ctx) {
    const { artifact, body } = await readArtifactContent(input.artifactId, ctx.workspaceId);
    return { targetResource: `${input.destination} <- artifact:${artifact.id} (${artifact.name})`, diff: { before: null, after: artifact.type === 'PDF' ? `[PDF ${artifact.size} bytes]` : body.toString('utf8').slice(0, 20000) }, evidence: { artifact: { id: artifact.id, name: artifact.name, type: artifact.type, size: artifact.size } } };
  },
  async execute(input, ctx) {
    const { artifact, body } = await readArtifactContent(input.artifactId, ctx.workspaceId);
    const res = await postWebhook(ctx.workspaceId, { event: 'content.publish', destination: input.destination, artifact: { id: artifact.id, name: artifact.name, type: artifact.type, content: artifact.type === 'PDF' ? body.toString('base64') : body.toString('utf8') }, approvalId: ctx.approval?.id ?? null, taskId: ctx.taskId }, ctx.idempotencyKey);
    if (!res.ok) throw new Error(`Publishing webhook responded with status ${res.statusCode}`);
    return { published: true, reference: res.body?.slice(0, 200) ?? null };
  },
};

export const permissionsModify: ToolAdapter<{ projectId: string; userId: string; role: 'VIEWER' | 'EDITOR' | 'MANAGER' }, unknown> = {
  id: 'permissions.modify',
  async preview(input, ctx) {
    const member = await prisma.projectMember.findFirst({ where: { projectId: input.projectId, userId: input.userId, project: { workspaceId: ctx.workspaceId } }, include: { user: { select: { name: true, email: true } } } });
    const user = member?.user ?? (await prisma.user.findUnique({ where: { id: input.userId }, select: { name: true, email: true } }));
    return { targetResource: `project:${input.projectId} member:${user?.email ?? input.userId}`, diff: { before: member ? `role=${member.role}` : 'not a member', after: `role=${input.role}` } };
  },
  async execute(input, ctx) {
    const project = await prisma.project.findFirst({ where: { id: input.projectId, workspaceId: ctx.workspaceId } });
    if (!project) throw Errors.notFound('Project');
    const membership = await prisma.workspaceMember.findFirst({ where: { workspaceId: ctx.workspaceId, userId: input.userId } });
    if (!membership) throw Errors.badRequest('User is not a member of this workspace');
    const row = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: input.projectId, userId: input.userId } },
      create: { projectId: input.projectId, userId: input.userId, role: input.role },
      update: { role: input.role },
    });
    return { projectId: row.projectId, userId: row.userId, role: row.role };
  },
};

export const codeMerge: ToolAdapter<{ repository: string; pullNumber: number }, unknown> = {
  id: 'code.merge',
  async preview(input, ctx) {
    const pr = await githubRequest<{ title: string; html_url: string; mergeable: boolean | null; head: { ref: string }; base: { ref: string } }>(ctx.workspaceId, `/repos/${input.repository}/pulls/${input.pullNumber}`);
    return { targetResource: `${input.repository}#${input.pullNumber} ${pr.head.ref} -> ${pr.base.ref}`, evidence: { title: pr.title, url: pr.html_url, mergeable: pr.mergeable } };
  },
  async execute(input, ctx) {
    const res = await githubRequest<{ merged: boolean; sha: string | null }>(ctx.workspaceId, `/repos/${input.repository}/pulls/${input.pullNumber}/merge`, { method: 'PUT', body: JSON.stringify({}) });
    return { merged: res.merged, sha: res.sha ?? null };
  },
  async verify(input, ctx) {
    const pr = await githubRequest<{ merged: boolean; merge_commit_sha: string | null }>(ctx.workspaceId, `/repos/${input.repository}/pulls/${input.pullNumber}`);
    return pr.merged ? { merged: true, sha: pr.merge_commit_sha } : null;
  },
};

export const resourceDelete: ToolAdapter<{ resourceType: 'artifact' | 'knowledgeSource'; resourceId: string; reason?: string }, unknown> = {
  id: 'resource.delete',
  async preview(input, ctx) {
    if (input.resourceType === 'artifact') {
      const a = await prisma.artifact.findFirst({ where: { id: input.resourceId, workspaceId: ctx.workspaceId, deletedAt: null } });
      if (!a) throw Errors.notFound('Artifact');
      return { targetResource: `artifact:${a.id} (${a.name}, ${a.size} bytes)`, evidence: { reason: input.reason ?? null } };
    }
    const s = await prisma.knowledgeSource.findFirst({ where: { id: input.resourceId, workspaceId: ctx.workspaceId } });
    if (!s) throw Errors.notFound('Knowledge source');
    return { targetResource: `knowledgeSource:${s.id} (${s.title})`, evidence: { reason: input.reason ?? null } };
  },
  async execute(input, ctx) {
    if (input.resourceType === 'artifact') {
      await softDeleteArtifact(input.resourceId, ctx.workspaceId);
      return { deleted: true };
    }
    const s = await prisma.knowledgeSource.findFirst({ where: { id: input.resourceId, workspaceId: ctx.workspaceId } });
    if (!s) throw Errors.notFound('Knowledge source');
    await prisma.knowledgeSource.update({ where: { id: s.id }, data: { revokedAt: new Date(), status: 'REVOKED' } });
    return { deleted: true };
  },
};

export const messageSend: ToolAdapter<{ channel?: string; text: string }, unknown> = {
  id: 'message.send',
  async preview(input) {
    return { targetResource: `webhook${input.channel ? ` channel:${input.channel}` : ''}`, diff: { before: null, after: input.text } };
  },
  async execute(input, ctx) {
    const res = await postWebhook(ctx.workspaceId, { event: 'message.send', channel: input.channel ?? null, text: input.text, taskId: ctx.taskId, agent: ctx.agentName, approvalId: ctx.approval?.id ?? null }, ctx.idempotencyKey);
    return { delivered: res.ok, statusCode: res.statusCode };
  },
};

export const opsExecute: ToolAdapter<{ operation: string; parameters: Record<string, string | number | boolean> }, unknown> = {
  id: 'ops.execute',
  async preview(input) {
    if (!ALLOWED_OPERATIONS.includes(input.operation)) throw Errors.badRequest(`Operation ${input.operation} is not allowlisted. Allowed: ${ALLOWED_OPERATIONS.join(', ')}`);
    return { targetResource: `operation:${input.operation}`, evidence: { parameters: input.parameters, allowlisted: true } };
  },
  async execute(input, ctx) {
    if (!ALLOWED_OPERATIONS.includes(input.operation)) throw Errors.forbidden(`Operation ${input.operation} is not allowlisted`);
    const res = await postWebhook(ctx.workspaceId, { event: 'ops.execute', operation: input.operation, parameters: input.parameters, taskId: ctx.taskId, approvalId: ctx.approval?.id ?? null }, ctx.idempotencyKey);
    if (!res.ok) throw new Error(`Operations webhook responded with status ${res.statusCode}`);
    return { accepted: true, reference: res.body?.slice(0, 200) ?? null };
  },
};

export const HIGH_RISK_ADAPTERS: ToolAdapter[] = [contentPublish, permissionsModify, codeMerge, resourceDelete, messageSend, opsExecute] as ToolAdapter[];
