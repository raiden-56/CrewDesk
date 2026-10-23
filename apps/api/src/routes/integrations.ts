import { Router } from 'express';
import { IntegrationSchema } from '@collabspace/shared';
import { audit, checkIntegration, prisma, toIntegrationDto, upsertIntegration } from '@collabspace/core';
import type { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { body, validate } from '../middleware/validate.js';

export const integrationsRouter = Router();

integrationsRouter.get('/', requirePermission('agent.view'), async (req, res) => {
  const rows = await prisma.integrationConnection.findMany({ where: { workspaceId: req.ws!.workspaceId }, orderBy: { createdAt: 'asc' } });
  res.json({
    items: rows.map(toIntegrationDto),
    available: [
      { provider: 'github', name: 'GitHub', description: 'Repository metadata, draft pull requests and merges (code.merge requires approval).', secretLabel: 'Personal access token', tools: ['repo.metadata', 'github.pr_draft', 'code.merge'] },
      { provider: 'webhook', name: 'Outbound webhook', description: 'Receives message.send, content.publish and ops.execute payloads (e.g. Slack/Teams incoming webhook or your own endpoint).', secretLabel: 'Webhook URL', tools: ['message.send', 'content.publish', 'ops.execute'] },
    ],
  });
});

integrationsRouter.post('/', requirePermission('integration.manage'), validate(IntegrationSchema), async (req, res) => {
  const input = body<z.infer<typeof IntegrationSchema>>(req);
  const dto = await upsertIntegration({ workspaceId: req.ws!.workspaceId, provider: input.provider, name: input.name, secret: input.secret, config: input.config, createdById: req.auth!.userId });
  await audit({ workspaceId: req.ws!.workspaceId, actorId: req.auth!.userId, action: 'integration.configured', resourceType: 'integration', resourceId: dto.id, metadata: { provider: input.provider, name: input.name }, requestId: req.requestId });
  res.status(201).json(await checkIntegration(req.ws!.workspaceId, dto.id));
});

integrationsRouter.post('/:id/check', requirePermission('integration.manage'), async (req, res) => {
  res.json(await checkIntegration(req.ws!.workspaceId, req.params.id as string));
});

integrationsRouter.delete('/:id', requirePermission('integration.manage'), async (req, res) => {
  await prisma.integrationConnection.deleteMany({ where: { id: req.params.id as string, workspaceId: req.ws!.workspaceId } });
  await audit({ workspaceId: req.ws!.workspaceId, actorId: req.auth!.userId, action: 'integration.removed', resourceType: 'integration', resourceId: req.params.id as string, requestId: req.requestId });
  res.json({ ok: true });
});
