import { Router } from 'express';
import { UsageQuery } from '@collabspace/shared';
import { dashboardMetrics, usageSummary } from '@collabspace/core';
import type { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { query, validate } from '../middleware/validate.js';

export const usageRouter = Router();

usageRouter.get('/', requirePermission('usage.view'), validate(UsageQuery, 'query'), async (req, res) => {
  const q = query<z.infer<typeof UsageQuery>>(req);
  res.json(await usageSummary(req.ws!.workspaceId, { period: q.period, projectId: q.projectId, agentId: q.agentId }));
});

usageRouter.get('/agents', requirePermission('usage.view'), validate(UsageQuery, 'query'), async (req, res) => {
  const q = query<z.infer<typeof UsageQuery>>(req);
  const summary = await usageSummary(req.ws!.workspaceId, { period: q.period });
  res.json({ period: summary.period, items: summary.byAgent, hasUnavailable: summary.totals.hasUnavailable });
});

usageRouter.get('/dashboard', requirePermission('usage.view'), validate(UsageQuery, 'query'), async (req, res) => {
  const q = query<z.infer<typeof UsageQuery>>(req);
  res.json(await dashboardMetrics(req.ws!.workspaceId, q.period));
});
