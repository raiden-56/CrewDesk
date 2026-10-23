import { AGENT_TEMPLATES, TOOL_CATALOG, type AgentCategory, type AgentDto, type AgentStatus, type AgentVersionDto, type CreateAgentInput, type InstructionSet, type ModelConfig, type TaskStatus } from '@collabspace/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { Errors } from '../errors.js';
import { publishRealtime } from '../events.js';
import { audit } from './audit.js';

export const agentInclude = {
  project: { select: { id: true, name: true } },
  currentVersion: true,
} as const;

type AgentRow = Prisma.AgentGetPayload<{ include: typeof agentInclude }>;

export async function toAgentDto(a: AgentRow): Promise<AgentDto> {
  const [stats, current, grants] = await Promise.all([
    prisma.agentTask.groupBy({ by: ['status'], where: { agentId: a.id }, _count: { _all: true } }),
    prisma.agentTask.findFirst({ where: { agentId: a.id, status: { in: ['RUNNING', 'WAITING_APPROVAL', 'QUEUED'] } }, orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }], select: { id: true, title: true, status: true, progress: true, progressMessage: true } }),
    prisma.agentToolPermission.findMany({ where: { agentId: a.id }, select: { toolId: true } }),
  ]);
  const count = (s: TaskStatus) => stats.find((r) => r.status === s)?._count._all ?? 0;
  const v = a.currentVersion;
  const grantedSet = new Set(grants.map((g) => g.toolId));
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    projectId: a.projectId,
    project: a.project,
    name: a.name,
    avatar: a.avatar,
    color: a.color,
    description: a.description,
    category: a.category as AgentCategory,
    status: a.status as AgentStatus,
    currentVersion: v?.version ?? 0,
    currentVersionId: v?.id ?? '',
    instructions: (v?.instructions as unknown as InstructionSet) ?? AGENT_TEMPLATES.GENERAL_ASSISTANT.instructions,
    modelConfig: (v?.modelConfig as ModelConfig) ?? ({} as ModelConfig),
    tools: (v?.tools ?? []).filter((t) => grantedSet.has(t)),
    knowledge: (v?.knowledge as AgentDto['knowledge']) ?? { sourceIds: [], allowWorkspaceKnowledge: false, allowProjectDocuments: true, allowPreviousReports: false },
    currentTask: current ? { ...current, status: current.status as TaskStatus } : null,
    lastActivityAt: a.lastActivityAt?.toISOString() ?? null,
    lastError: a.lastError,
    stats: { totalTasks: stats.reduce((n, r) => n + r._count._all, 0), completedTasks: count('COMPLETED'), failedTasks: count('FAILED') + count('TIMED_OUT'), runningTasks: count('RUNNING') + count('QUEUED') + count('WAITING_APPROVAL') },
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    archivedAt: a.archivedAt?.toISOString() ?? null,
  };
}

export function toAgentVersionDto(v: { id: string; version: number; changeSummary: string | null; createdAt: Date; createdBy: { id: string; name: string } | null; instructions: unknown; modelConfig: unknown; tools: string[] }): AgentVersionDto {
  return { id: v.id, version: v.version, changeSummary: v.changeSummary, createdAt: v.createdAt.toISOString(), createdBy: v.createdBy, instructions: v.instructions as unknown as InstructionSet, modelConfig: v.modelConfig as ModelConfig, tools: v.tools };
}

async function assertProject(workspaceId: string, projectId: string | null) {
  if (!projectId) return;
  const p = await prisma.project.findFirst({ where: { id: projectId, workspaceId }, select: { id: true } });
  if (!p) throw Errors.badRequest('Project does not belong to this workspace');
}

async function assertKnowledgeSources(workspaceId: string, sourceIds: string[]) {
  if (!sourceIds.length) return;
  const count = await prisma.knowledgeSource.count({ where: { id: { in: sourceIds }, workspaceId } });
  if (count !== new Set(sourceIds).size) throw Errors.badRequest('One or more knowledge sources do not belong to this workspace');
}

/** Validate an agent configuration and explain missing permissions/integrations without saving. */
export async function validateAgentConfig(workspaceId: string, input: Partial<CreateAgentInput>, canConfigureModel: boolean) {
  const warnings: string[] = [];
  const errors: string[] = [];
  for (const toolId of input.tools ?? []) {
    const def = TOOL_CATALOG[toolId];
    if (!def) {
      errors.push(`Unknown tool ${toolId}`);
      continue;
    }
    if (def.requiresIntegration) {
      const integration = await prisma.integrationConnection.findFirst({ where: { workspaceId, provider: def.requiresIntegration, status: 'CONNECTED' }, select: { id: true } });
      if (!integration) warnings.push(`${def.name} requires the ${def.requiresIntegration} integration, which is not configured. The tool will be unavailable until it is.`);
    }
    if (def.requiresApproval) warnings.push(`${def.name} always requires human approval before it executes.`);
  }
  if (!canConfigureModel && input.modelConfig && (input.modelConfig.provider || input.modelConfig.model)) {
    errors.push('Only workspace owners/admins may change the AI provider or model.');
  }
  if (input.knowledge?.sourceIds?.length) {
    const count = await prisma.knowledgeSource.count({ where: { id: { in: input.knowledge.sourceIds }, workspaceId } });
    if (count !== new Set(input.knowledge.sourceIds).size) errors.push('One or more knowledge sources are not in this workspace.');
  }
  if (!(input.tools ?? []).length) warnings.push('The agent has no tools; it can only answer from its instructions and retrieved knowledge.');
  return { valid: errors.length === 0, errors, warnings };
}

export async function createAgent(workspaceId: string, actorId: string, input: CreateAgentInput) {
  await assertProject(workspaceId, input.projectId);
  await assertKnowledgeSources(workspaceId, input.knowledge.sourceIds);
  const agent = await prisma.$transaction(async (tx) => {
    const a = await tx.agent.create({ data: { workspaceId, projectId: input.projectId, name: input.name, avatar: input.avatar, color: input.color, description: input.description, category: input.category as AgentCategory, createdById: actorId, status: 'ONLINE' } });
    const v = await tx.agentVersion.create({ data: { agentId: a.id, version: 1, instructions: input.instructions, modelConfig: input.modelConfig, tools: input.tools, knowledge: input.knowledge, changeSummary: input.changeSummary ?? 'Initial version', createdById: actorId } });
    await tx.agent.update({ where: { id: a.id }, data: { currentVersionId: v.id } });
    await tx.agentToolPermission.createMany({ data: input.tools.map((toolId) => ({ agentId: a.id, toolId, grantedById: actorId })) });
    await tx.agentKnowledgeSource.createMany({ data: input.knowledge.sourceIds.map((knowledgeSourceId) => ({ agentId: a.id, knowledgeSourceId })) });
    return tx.agent.findUniqueOrThrow({ where: { id: a.id }, include: agentInclude });
  });
  await audit({ workspaceId, actorId, action: 'agent.created', resourceType: 'agent', resourceId: agent.id, metadata: { name: agent.name, category: agent.category, tools: input.tools } });
  await publishRealtime({ type: 'agent.updated', workspaceId, agentId: agent.id, status: 'ONLINE' });
  return toAgentDto(agent);
}

/** Every edit creates a new immutable version; running tasks keep the version they started with. */
export async function updateAgent(workspaceId: string, agentId: string, actorId: string, input: Partial<CreateAgentInput>) {
  const existing = await prisma.agent.findFirst({ where: { id: agentId, workspaceId }, include: agentInclude });
  if (!existing) throw Errors.notFound('Agent');
  if (existing.archivedAt) throw Errors.conflict('Archived agents cannot be edited');
  if (input.projectId !== undefined) await assertProject(workspaceId, input.projectId);
  if (input.knowledge?.sourceIds) await assertKnowledgeSources(workspaceId, input.knowledge.sourceIds);
  const cur = existing.currentVersion;
  const nextInstructions = input.instructions ?? (cur?.instructions as unknown as InstructionSet);
  const nextModel = input.modelConfig ?? (cur?.modelConfig as ModelConfig);
  const nextTools = input.tools ?? cur?.tools ?? [];
  const nextKnowledge = input.knowledge ?? (cur?.knowledge as CreateAgentInput['knowledge']);
  const configChanged = input.instructions !== undefined || input.modelConfig !== undefined || input.tools !== undefined || input.knowledge !== undefined;
  const agent = await prisma.$transaction(async (tx) => {
    await tx.agent.update({ where: { id: agentId }, data: { name: input.name, avatar: input.avatar, color: input.color, description: input.description, category: input.category as AgentCategory | undefined, projectId: input.projectId } });
    if (configChanged) {
      const v = await tx.agentVersion.create({ data: { agentId, version: (cur?.version ?? 0) + 1, instructions: nextInstructions as object, modelConfig: nextModel as object, tools: nextTools, knowledge: nextKnowledge as object, changeSummary: input.changeSummary ?? 'Configuration updated', createdById: actorId } });
      await tx.agent.update({ where: { id: agentId }, data: { currentVersionId: v.id } });
      if (input.tools !== undefined) {
        await tx.agentToolPermission.deleteMany({ where: { agentId, toolId: { notIn: nextTools } } });
        for (const toolId of nextTools) await tx.agentToolPermission.upsert({ where: { agentId_toolId: { agentId, toolId } }, create: { agentId, toolId, grantedById: actorId }, update: {} });
      }
      if (input.knowledge?.sourceIds) {
        await tx.agentKnowledgeSource.deleteMany({ where: { agentId } });
        await tx.agentKnowledgeSource.createMany({ data: input.knowledge.sourceIds.map((knowledgeSourceId) => ({ agentId, knowledgeSourceId })) });
      }
    }
    return tx.agent.findUniqueOrThrow({ where: { id: agentId }, include: agentInclude });
  });
  await audit({ workspaceId, actorId, action: 'agent.updated', resourceType: 'agent', resourceId: agentId, metadata: { fields: Object.keys(input), newVersion: configChanged ? (cur?.version ?? 0) + 1 : null } });
  await publishRealtime({ type: 'agent.updated', workspaceId, agentId, status: agent.status as AgentStatus });
  return toAgentDto(agent);
}

export async function duplicateAgent(workspaceId: string, agentId: string, actorId: string) {
  const existing = await prisma.agent.findFirst({ where: { id: agentId, workspaceId }, include: agentInclude });
  if (!existing?.currentVersion) throw Errors.notFound('Agent');
  const v = existing.currentVersion;
  return createAgent(workspaceId, actorId, {
    name: `${existing.name} (copy)`,
    avatar: existing.avatar,
    color: existing.color,
    description: existing.description,
    category: existing.category,
    projectId: existing.projectId,
    instructions: v.instructions as unknown as InstructionSet,
    modelConfig: v.modelConfig as ModelConfig,
    tools: v.tools,
    knowledge: v.knowledge as CreateAgentInput['knowledge'],
    changeSummary: `Duplicated from ${existing.name} v${v.version}`,
  });
}

export async function setAgentLifecycle(workspaceId: string, agentId: string, actorId: string, action: 'pause' | 'resume' | 'archive') {
  const existing = await prisma.agent.findFirst({ where: { id: agentId, workspaceId } });
  if (!existing) throw Errors.notFound('Agent');
  let status: AgentStatus = existing.status as AgentStatus;
  let archivedAt: Date | null = existing.archivedAt;
  if (action === 'pause') status = 'PAUSED';
  if (action === 'resume') {
    if (existing.archivedAt) throw Errors.conflict('Archived agents cannot be resumed; restore them first');
    status = 'ONLINE';
  }
  if (action === 'archive') {
    status = 'ARCHIVED';
    archivedAt = new Date();
  }
  const agent = await prisma.agent.update({ where: { id: agentId }, data: { status, archivedAt }, include: agentInclude });
  if (action === 'pause' || action === 'archive') {
    // queued tasks for a paused agent are paused too (they resume when the agent resumes)
    const queued = await prisma.agentTask.findMany({ where: { agentId, status: 'QUEUED' }, select: { id: true } });
    for (const t of queued) await prisma.agentTask.update({ where: { id: t.id }, data: { status: 'PAUSED', progressMessage: `Agent ${action}d` } });
  }
  if (action === 'resume') {
    const paused = await prisma.agentTask.findMany({ where: { agentId, status: 'PAUSED' }, select: { id: true, priority: true, attempt: true } });
    const { enqueueAgentTask } = await import('../queue.js');
    for (const t of paused) {
      await prisma.agentTask.update({ where: { id: t.id }, data: { status: 'QUEUED', progressMessage: 'Queued' } });
      await enqueueAgentTask(t.id, { priority: t.priority, attempt: t.attempt });
    }
  }
  await audit({ workspaceId, actorId, action: `agent.${action}`, resourceType: 'agent', resourceId: agentId });
  await publishRealtime({ type: 'agent.updated', workspaceId, agentId, status });
  return toAgentDto(agent);
}

/** Delete according to retention rules: only archived agents with no active tasks are hard-deleted. */
export async function deleteAgent(workspaceId: string, agentId: string, actorId: string) {
  const existing = await prisma.agent.findFirst({ where: { id: agentId, workspaceId } });
  if (!existing) throw Errors.notFound('Agent');
  const active = await prisma.agentTask.count({ where: { agentId, status: { in: ['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'PAUSED'] } } });
  if (active > 0) throw Errors.conflict('Agent has active tasks. Cancel them before deleting.');
  if (!existing.archivedAt) throw Errors.conflict('Archive the agent before deleting it (retention rule).');
  await prisma.agent.delete({ where: { id: agentId } });
  await audit({ workspaceId, actorId, action: 'agent.deleted', resourceType: 'agent', resourceId: agentId, metadata: { name: existing.name } });
  return true;
}
