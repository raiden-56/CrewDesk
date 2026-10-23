import { Router } from 'express';
import { BudgetPolicySchema, CreateProjectSchema, InviteMemberSchema, UpdateMemberRoleSchema, UpdateWorkspaceSchema, roleHasPermission, type WorkspaceRole } from '@collabspace/shared';
import { audit, createProject, Errors, inviteMember, listMembers, listProjects, listUserWorkspaces, prisma, removeMember, updateMemberRole } from '@collabspace/core';
import type { z } from 'zod';
import type { NextFunction, Request, Response } from 'express';
import { body, validate } from '../middleware/validate.js';

export const workspacesRouter = Router();

/** Resolve membership for the :id in the path (workspace routes are not under requireWorkspace). */
async function member(req: Request, _res: Response, next: NextFunction) {
  const membership = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: req.params.id as string, userId: req.auth!.userId } } });
  if (!membership) return next(Errors.forbidden('You are not a member of this workspace'));
  req.ws = { workspaceId: membership.workspaceId, role: membership.role as WorkspaceRole };
  next();
}
const perm = (p: Parameters<typeof roleHasPermission>[1]) => (req: Request, _res: Response, next: NextFunction) => (roleHasPermission(req.ws!.role, p) ? next() : next(Errors.forbidden(`Missing permission ${p}`)));

workspacesRouter.get('/', async (req, res) => {
  res.json({ items: await listUserWorkspaces(req.auth!.userId) });
});

workspacesRouter.patch('/:id', member, perm('workspace.manage'), validate(UpdateWorkspaceSchema), async (req, res) => {
  const input = body<z.infer<typeof UpdateWorkspaceSchema>>(req);
  const ws = await prisma.workspace.update({ where: { id: req.ws!.workspaceId }, data: input });
  await audit({ workspaceId: ws.id, actorId: req.auth!.userId, action: 'workspace.updated', resourceType: 'workspace', resourceId: ws.id, metadata: input, requestId: req.requestId });
  res.json({ id: ws.id, name: ws.name, slug: ws.slug, maxConcurrentTasks: ws.maxConcurrentTasks, defaultAgentConcurrency: ws.defaultAgentConcurrency });
});

workspacesRouter.get('/:id/members', member, async (req, res) => {
  res.json(await listMembers(req.ws!.workspaceId));
});

workspacesRouter.post('/:id/members', member, perm('members.manage'), validate(InviteMemberSchema), async (req, res) => {
  const input = body<z.infer<typeof InviteMemberSchema>>(req);
  if (input.role === 'OWNER' && req.ws!.role !== 'OWNER') throw Errors.forbidden('Only owners can grant the owner role');
  res.status(201).json(await inviteMember(req.ws!.workspaceId, req.auth!.userId, input.email, input.role as WorkspaceRole));
});

workspacesRouter.patch('/:id/members/:userId', member, perm('members.manage'), validate(UpdateMemberRoleSchema), async (req, res) => {
  const input = body<z.infer<typeof UpdateMemberRoleSchema>>(req);
  if (input.role === 'OWNER' && req.ws!.role !== 'OWNER') throw Errors.forbidden('Only owners can grant the owner role');
  res.json(await updateMemberRole(req.ws!.workspaceId, req.auth!.userId, req.params.userId as string, input.role as WorkspaceRole));
});

workspacesRouter.delete('/:id/members/:userId', member, perm('members.manage'), async (req, res) => {
  res.json(await removeMember(req.ws!.workspaceId, req.auth!.userId, req.params.userId as string));
});

workspacesRouter.get('/:id/projects', member, async (req, res) => {
  res.json({ items: await listProjects(req.ws!.workspaceId) });
});

workspacesRouter.post('/:id/projects', member, perm('agent.create'), validate(CreateProjectSchema), async (req, res) => {
  res.status(201).json(await createProject(req.ws!.workspaceId, req.auth!.userId, body<z.infer<typeof CreateProjectSchema>>(req)));
});

workspacesRouter.get('/:id/budgets', member, perm('usage.view'), async (req, res) => {
  const items = await prisma.budgetPolicy.findMany({ where: { workspaceId: req.ws!.workspaceId }, orderBy: { createdAt: 'asc' } });
  res.json({ items });
});

workspacesRouter.post('/:id/budgets', member, perm('budget.manage'), validate(BudgetPolicySchema), async (req, res) => {
  const input = body<z.infer<typeof BudgetPolicySchema>>(req);
  const existing = await prisma.budgetPolicy.findFirst({ where: { workspaceId: req.ws!.workspaceId, scope: input.scope, scopeId: input.scopeId, period: input.period } });
  const data = { workspaceId: req.ws!.workspaceId, scope: input.scope, scopeId: input.scopeId, period: input.period, hardLimitUsd: input.hardLimitUsd, warningRatio: input.warningRatio, maxTokens: input.maxTokens, enabled: input.enabled };
  const policy = existing ? await prisma.budgetPolicy.update({ where: { id: existing.id }, data }) : await prisma.budgetPolicy.create({ data });
  await audit({ workspaceId: req.ws!.workspaceId, actorId: req.auth!.userId, action: 'budget.updated', resourceType: 'budgetPolicy', resourceId: policy.id, metadata: input, requestId: req.requestId });
  res.status(existing ? 200 : 201).json(policy);
});

workspacesRouter.delete('/:id/budgets/:budgetId', member, perm('budget.manage'), async (req, res) => {
  await prisma.budgetPolicy.deleteMany({ where: { id: req.params.budgetId as string, workspaceId: req.ws!.workspaceId } });
  res.json({ ok: true });
});
