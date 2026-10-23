import { Router } from 'express';
import { SendMessageSchema } from '@collabspace/shared';
import { getOrCreateConversation, listConversations, listMessages, retryMessage, sendMessage } from '@collabspace/core';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { body, validate } from '../middleware/validate.js';

export const conversationsRouter = Router();

conversationsRouter.get('/', requirePermission('chat.use'), async (req, res) => {
  res.json({ items: await listConversations(req.ws!.workspaceId, req.auth!.userId, typeof req.query.agentId === 'string' ? req.query.agentId : undefined) });
});

conversationsRouter.post('/', requirePermission('chat.use'), validate(z.object({ agentId: z.string().min(1), projectId: z.string().nullable().default(null) })), async (req, res) => {
  const input = body<{ agentId: string; projectId: string | null }>(req);
  res.json(await getOrCreateConversation(req.ws!.workspaceId, req.auth!.userId, input.agentId, input.projectId));
});

conversationsRouter.get('/:id/messages', requirePermission('chat.use'), async (req, res) => {
  res.json({ items: await listMessages(req.ws!.workspaceId, req.params.id as string, req.auth!.userId) });
});

conversationsRouter.post('/:id/messages', requirePermission('chat.use'), validate(SendMessageSchema), async (req, res) => {
  res.status(201).json(await sendMessage(req.ws!.workspaceId, req.params.id as string, req.auth!.userId, body<z.infer<typeof SendMessageSchema>>(req)));
});

conversationsRouter.post('/:id/messages/:messageId/retry', requirePermission('chat.use'), async (req, res) => {
  res.json(await retryMessage(req.ws!.workspaceId, req.params.id as string, req.auth!.userId, req.params.messageId as string));
});
