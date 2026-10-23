import { AGENT_TEMPLATES, CreateAgentSchema, type AgentCategory, type WorkspaceRole } from '@collabspace/shared';
import { createAgent, prisma, register } from '../index.js';

let n = 0;
const unique = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

/** A fresh workspace with an owner. */
export async function createWorkspace() {
  const id = unique();
  const owner = await register({ name: `Owner ${id}`, email: `owner-${id}@test.local`, password: 'test-password-123', workspaceName: `Test ${id}` });
  const member = await prisma.workspaceMember.findFirstOrThrow({ where: { userId: owner.id } });
  return { workspaceId: member.workspaceId, ownerId: owner.id };
}

export async function addMember(workspaceId: string, role: WorkspaceRole) {
  const id = unique();
  const user = await prisma.user.create({ data: { name: `${role} ${id}`, email: `${role.toLowerCase()}-${id}@test.local`, passwordHash: 'x', emailVerifiedAt: new Date() } });
  await prisma.workspaceMember.create({ data: { workspaceId, userId: user.id, role } });
  return user.id;
}

export async function createTestAgent(workspaceId: string, actorId: string, category: AgentCategory = 'RESEARCHER', tools?: string[]) {
  const t = AGENT_TEMPLATES[category];
  const input = CreateAgentSchema.parse({ name: `${t.name} ${unique()}`.slice(0, 60), category, instructions: t.instructions, modelConfig: { maxRetries: 0 }, tools: tools ?? t.defaultTools, knowledge: { allowWorkspaceKnowledge: true } });
  return createAgent(workspaceId, actorId, input);
}
