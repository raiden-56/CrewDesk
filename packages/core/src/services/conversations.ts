import type { ConversationDto } from '@collabspace/shared';
import { prisma } from '../db.js';
import { Errors } from '../errors.js';
import { publishRealtime } from '../events.js';
import { enqueueChatMessage } from '../queue.js';
import { toMessageDto } from './chat.js';

export function toConversationDto(c: { id: string; agentId: string; projectId: string | null; title: string | null; createdAt: Date; updatedAt: Date }): ConversationDto {
  return { id: c.id, agentId: c.agentId, projectId: c.projectId, title: c.title, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() };
}

/** Get (or create) the user's conversation with an agent, optionally scoped to a project. */
export async function getOrCreateConversation(workspaceId: string, userId: string, agentId: string, projectId: string | null) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true, name: true } });
  if (!agent) throw Errors.notFound('Agent');
  const existing = await prisma.conversation.findFirst({ where: { workspaceId, userId, agentId, projectId }, orderBy: { updatedAt: 'desc' } });
  if (existing) return toConversationDto(existing);
  const created = await prisma.conversation.create({ data: { workspaceId, userId, agentId, projectId, title: `Chat with ${agent.name}` } });
  return toConversationDto(created);
}

export async function listMessages(workspaceId: string, conversationId: string, userId: string, limit = 100) {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId, userId } });
  if (!conversation) throw Errors.notFound('Conversation');
  const messages = await prisma.conversationMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' }, take: limit });
  return messages.map(toMessageDto);
}

/** Persist the user message, create the pending agent reply and hand generation to the worker. */
export async function sendMessage(workspaceId: string, conversationId: string, userId: string, input: { content: string; attachmentArtifactIds: string[] }) {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId, userId }, include: { agent: { select: { status: true } } } });
  if (!conversation) throw Errors.notFound('Conversation');
  const attachments = input.attachmentArtifactIds.length ? await prisma.artifact.findMany({ where: { id: { in: input.attachmentArtifactIds }, workspaceId, deletedAt: null }, select: { id: true, name: true } }) : [];
  const content = attachments.length ? `${input.content}\n\nAttached files: ${attachments.map((a) => `${a.name} [file:${a.id}]`).join(', ')}` : input.content;
  const userMessage = await prisma.conversationMessage.create({ data: { conversationId, role: 'USER', kind: 'TEXT', content, status: 'COMPLETE', metadata: attachments.length ? { attachments } : undefined } });
  const reply = await prisma.conversationMessage.create({ data: { conversationId, role: 'AGENT', kind: 'TEXT', content: '', status: 'PENDING' } });
  await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  await publishRealtime({ type: 'message.created', workspaceId, conversationId, message: toMessageDto(userMessage) });
  await publishRealtime({ type: 'message.created', workspaceId, conversationId, message: toMessageDto(reply) });
  await enqueueChatMessage(conversationId, reply.id);
  return { userMessage: toMessageDto(userMessage), reply: toMessageDto(reply) };
}

/** Re-generate a failed/complete agent reply. */
export async function retryMessage(workspaceId: string, conversationId: string, userId: string, messageId: string) {
  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, workspaceId, userId } });
  if (!conversation) throw Errors.notFound('Conversation');
  const message = await prisma.conversationMessage.findFirst({ where: { id: messageId, conversationId, role: 'AGENT' } });
  if (!message) throw Errors.notFound('Message');
  const updated = await prisma.conversationMessage.update({ where: { id: messageId }, data: { status: 'PENDING', kind: 'TEXT', content: '' } });
  await publishRealtime({ type: 'message.created', workspaceId, conversationId, message: toMessageDto(updated) });
  await enqueueChatMessage(conversationId, messageId);
  return toMessageDto(updated);
}

export async function listConversations(workspaceId: string, userId: string, agentId?: string) {
  const rows = await prisma.conversation.findMany({ where: { workspaceId, userId, ...(agentId ? { agentId } : {}) }, orderBy: { updatedAt: 'desc' }, take: 50 });
  return rows.map(toConversationDto);
}
