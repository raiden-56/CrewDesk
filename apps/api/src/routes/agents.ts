import { Router } from 'express';
import { AGENT_TEMPLATES, AgentListQuery, AgentTestPromptSchema, CreateAgentSchema, renderInstructions, TOOL_CATALOG, UpdateAgentSchema, type AgentCategory, type CreateAgentInput, type InstructionSet, type ModelConfig } from '@collabspace/shared';
import { agentInclude, audit, createAgent, defaultModelFor, deleteAgent, duplicateAgent, Errors, prisma, recordUsage, resolveProvider, setAgentLifecycle, toAgentDto, toAgentVersionDto, updateAgent, validateAgentConfig, textOf } from '@collabspace/core';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { hasPermission, requirePermission } from '../middleware/auth.js';
import { body, query, validate } from '../middleware/validate.js';

export const agentsRouter = Router();

agentsRouter.get('/templates', (_req, res) => {
  res.json({ items: Object.values(AGENT_TEMPLATES).map((t) => ({ ...t, renderedInstructions: renderInstructions(t.instructions) })) });
});

agentsRouter.get('/', requirePermission('agent.view'), validate(AgentListQuery, 'query'), async (req, res) => {
  const q = query<z.infer<typeof AgentListQuery>>(req);
  const where: Prisma.AgentWhereInput = {
    workspaceId: req.ws!.workspaceId,
    ...(q.includeArchived ? {} : { archivedAt: null }),
    ...(q.category ? { category: q.category as AgentCategory } : {}),
    ...(q.status ? { status: q.status as Prisma.AgentWhereInput['status'] } : {}),
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }] } : {}),
    ...(q.availability === 'available' ? { status: { in: ['ONLINE', 'IDLE'] }, tasks: { none: { status: { in: ['RUNNING', 'WAITING_APPROVAL'] } } } } : {}),
    ...(q.availability === 'busy' ? { tasks: { some: { status: { in: ['RUNNING', 'WAITING_APPROVAL', 'QUEUED'] } } } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.agent.findMany({ where, include: agentInclude, orderBy: { createdAt: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.agent.count({ where }),
  ]);
  res.json({ items: await Promise.all(rows.map(toAgentDto)), page: q.page, pageSize: q.pageSize, total });
});

agentsRouter.post('/validate', requirePermission('agent.view'), validate(UpdateAgentSchema), async (req, res) => {
  res.json(await validateAgentConfig(req.ws!.workspaceId, body<Partial<CreateAgentInput>>(req), hasPermission(req, 'agent.model.configure')));
});

/**
 * Sandboxed test prompt: runs the draft configuration against the provider with NO tools
 * and no persistence besides a usage record, so nothing can be created or changed.
 */
agentsRouter.post('/test', requirePermission('agent.create'), validate(AgentTestPromptSchema), async (req, res) => {
  const input = body<z.infer<typeof AgentTestPromptSchema>>(req);
  const config = input.config ?? {};
  const modelConfig = (config.modelConfig ?? {}) as Partial<ModelConfig>;
  const provider = modelConfig.provider ? resolveProvider(modelConfig.provider) : resolveProvider();
  if (!provider) throw Errors.unavailable('No AI provider is configured on this server. Set AI_PROVIDER and an API key.');
  const model = modelConfig.model?.trim() || defaultModelFor(provider.name);
  const instructions = (config.instructions ?? AGENT_TEMPLATES.GENERAL_ASSISTANT.instructions) as InstructionSet;
  const started = Date.now();
  const result = await provider.complete({
    model,
    system: `${renderInstructions(instructions)}\n\n## Sandbox\nThis is a configuration test. You have no tools and no access to workspace data. Respond as you would to a real request and mention which tools you would have used (${(config.tools ?? []).map((t) => TOOL_CATALOG[t]?.name ?? t).join(', ') || 'none granted'}).`,
    messages: [{ role: 'user', content: [{ type: 'text', text: `[mock:no-tools] ${input.prompt}` }] }],
    tools: [],
    maxOutputTokens: Math.min(modelConfig.maxOutputTokens ?? 1024, 2048),
    temperature: provider.supportsTemperature(model) ? (modelConfig.temperature ?? null) : null,
    timeoutMs: 60000,
    metadata: { agentName: config.name ?? 'Draft agent' },
  });
  await recordUsage({ workspaceId: req.ws!.workspaceId, kind: 'MODEL', provider: result.provider, model: result.model, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, usageAvailable: result.usage.available, durationMs: Date.now() - started, success: true });
  res.json({ text: textOf(result.content), provider: result.provider, model: result.model, isMock: provider.isMock, usage: result.usage, stopReason: result.stopReason, durationMs: Date.now() - started });
});

agentsRouter.post('/', requirePermission('agent.create'), validate(CreateAgentSchema), async (req, res) => {
  const input = body<CreateAgentInput>(req);
  if ((input.modelConfig.provider || input.modelConfig.model) && !hasPermission(req, 'agent.model.configure')) throw Errors.forbidden('Only workspace owners/admins may configure the AI provider or model');
  const agent = await createAgent(req.ws!.workspaceId, req.auth!.userId, input);
  res.status(201).json(agent);
});

agentsRouter.get('/:id', requirePermission('agent.view'), async (req, res) => {
  const row = await prisma.agent.findFirst({ where: { id: req.params.id as string, workspaceId: req.ws!.workspaceId }, include: agentInclude });
  if (!row) throw Errors.notFound('Agent');
  res.json(await toAgentDto(row));
});

agentsRouter.get('/:id/versions', requirePermission('agent.view'), async (req, res) => {
  const agent = await prisma.agent.findFirst({ where: { id: req.params.id as string, workspaceId: req.ws!.workspaceId }, select: { id: true } });
  if (!agent) throw Errors.notFound('Agent');
  const versions = await prisma.agentVersion.findMany({ where: { agentId: agent.id }, orderBy: { version: 'desc' }, include: { createdBy: { select: { id: true, name: true } } } });
  res.json({ items: versions.map(toAgentVersionDto) });
});

agentsRouter.get('/:id/activity', requirePermission('agent.view'), async (req, res) => {
  const agent = await prisma.agent.findFirst({ where: { id: req.params.id as string, workspaceId: req.ws!.workspaceId }, select: { id: true } });
  if (!agent) throw Errors.notFound('Agent');
  const events = await prisma.executionEvent.findMany({ where: { task: { agentId: agent.id } }, orderBy: { createdAt: 'desc' }, take: 40, include: { task: { select: { id: true, title: true } } } });
  res.json({ items: events.map((e) => ({ id: e.id, taskId: e.taskId, taskTitle: e.task.title, type: e.type, level: e.level, message: e.message, createdAt: e.createdAt.toISOString(), durationMs: e.durationMs })) });
});

agentsRouter.patch('/:id', requirePermission('agent.edit'), validate(UpdateAgentSchema), async (req, res) => {
  const input = body<Partial<CreateAgentInput>>(req);
  if (input.modelConfig && (input.modelConfig.provider || input.modelConfig.model) && !hasPermission(req, 'agent.model.configure')) {
    const existing = await prisma.agent.findFirst({ where: { id: req.params.id as string, workspaceId: req.ws!.workspaceId }, include: { currentVersion: { select: { modelConfig: true } } } });
    const cur = (existing?.currentVersion?.modelConfig ?? {}) as Partial<ModelConfig>;
    if (cur.provider !== input.modelConfig.provider || cur.model !== input.modelConfig.model) throw Errors.forbidden('Only workspace owners/admins may change the AI provider or model');
  }
  res.json(await updateAgent(req.ws!.workspaceId, req.params.id as string, req.auth!.userId, input));
});

agentsRouter.post('/:id/duplicate', requirePermission('agent.create'), async (req, res) => {
  res.status(201).json(await duplicateAgent(req.ws!.workspaceId, req.params.id as string, req.auth!.userId));
});
agentsRouter.post('/:id/pause', requirePermission('agent.edit'), async (req, res) => {
  res.json(await setAgentLifecycle(req.ws!.workspaceId, req.params.id as string, req.auth!.userId, 'pause'));
});
agentsRouter.post('/:id/resume', requirePermission('agent.edit'), async (req, res) => {
  res.json(await setAgentLifecycle(req.ws!.workspaceId, req.params.id as string, req.auth!.userId, 'resume'));
});
agentsRouter.post('/:id/archive', requirePermission('agent.delete'), async (req, res) => {
  res.json(await setAgentLifecycle(req.ws!.workspaceId, req.params.id as string, req.auth!.userId, 'archive'));
});
agentsRouter.delete('/:id', requirePermission('agent.delete'), async (req, res) => {
  await deleteAgent(req.ws!.workspaceId, req.params.id as string, req.auth!.userId);
  await audit({ workspaceId: req.ws!.workspaceId, actorId: req.auth!.userId, action: 'agent.delete.request', resourceType: 'agent', resourceId: req.params.id as string, requestId: req.requestId });
  res.json({ ok: true });
});
