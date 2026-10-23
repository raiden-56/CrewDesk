import { Router } from 'express';
import { TOOL_CATALOG, TOOL_GROUPS, toolSummary } from '@collabspace/shared';
import { prisma, toolAvailability } from '@collabspace/core';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { body, validate } from '../middleware/validate.js';

export const toolsRouter = Router();

toolsRouter.get('/', requirePermission('agent.view'), async (req, res) => {
  const items = await Promise.all(
    Object.values(TOOL_CATALOG).map(async (def) => {
      const availability = await toolAvailability(def.id, req.ws!.workspaceId);
      const grants = await prisma.agentToolPermission.count({ where: { toolId: def.id, agent: { workspaceId: req.ws!.workspaceId, archivedAt: null } } });
      return { ...toolSummary(def), available: availability.available, unavailableReason: availability.reason, grantedAgents: grants };
    }),
  );
  res.json({ items, groups: TOOL_GROUPS });
});

toolsRouter.patch('/:id', requirePermission('workspace.manage'), validate(z.object({ enabled: z.boolean() })), async (req, res) => {
  const def = TOOL_CATALOG[req.params.id as string];
  if (!def) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Tool not found' } });
    return;
  }
  const row = await prisma.toolDefinition.update({ where: { id: def.id }, data: { enabled: body<{ enabled: boolean }>(req).enabled } });
  res.json({ id: row.id, enabled: row.enabled });
});
