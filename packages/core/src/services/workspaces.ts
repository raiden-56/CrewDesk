import type { ProjectDto, WorkspaceRole } from '@collabspace/shared';
import { prisma } from '../db.js';
import { Errors } from '../errors.js';
import { audit } from './audit.js';

export function toProjectDto(p: { id: string; workspaceId: string; name: string; description: string; createdAt: Date; updatedAt: Date }): ProjectDto {
  return { id: p.id, workspaceId: p.workspaceId, name: p.name, description: p.description, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
}

export async function listMembers(workspaceId: string) {
  const members = await prisma.workspaceMember.findMany({ where: { workspaceId }, include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } }, orderBy: { createdAt: 'asc' } });
  const invites = await prisma.workspaceInvite.findMany({ where: { workspaceId, acceptedAt: null }, orderBy: { createdAt: 'asc' } });
  return {
    members: members.map((m) => ({ id: m.id, userId: m.user.id, name: m.user.name, email: m.user.email, avatarUrl: m.user.avatarUrl, role: m.role as WorkspaceRole, joinedAt: m.createdAt.toISOString() })),
    invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role as WorkspaceRole, createdAt: i.createdAt.toISOString() })),
  };
}

export async function inviteMember(workspaceId: string, actorId: string, email: string, role: WorkspaceRole) {
  const normalized = email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (user) {
    await prisma.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId, userId: user.id } }, create: { workspaceId, userId: user.id, role }, update: { role } });
  } else {
    await prisma.workspaceInvite.upsert({ where: { workspaceId_email: { workspaceId, email: normalized } }, create: { workspaceId, email: normalized, role, invitedById: actorId }, update: { role } });
  }
  await audit({ workspaceId, actorId, action: 'member.invited', resourceType: 'workspace', resourceId: workspaceId, metadata: { email: normalized, role, existingUser: Boolean(user) } });
  return listMembers(workspaceId);
}

export async function updateMemberRole(workspaceId: string, actorId: string, userId: string, role: WorkspaceRole) {
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!member) throw Errors.notFound('Member');
  if (member.role === 'OWNER' && role !== 'OWNER') {
    const owners = await prisma.workspaceMember.count({ where: { workspaceId, role: 'OWNER' } });
    if (owners <= 1) throw Errors.conflict('A workspace must keep at least one owner');
  }
  await prisma.workspaceMember.update({ where: { id: member.id }, data: { role } });
  await audit({ workspaceId, actorId, action: 'member.role_changed', resourceType: 'workspace', resourceId: workspaceId, metadata: { userId, from: member.role, to: role } });
  return listMembers(workspaceId);
}

export async function removeMember(workspaceId: string, actorId: string, userId: string) {
  const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
  if (!member) throw Errors.notFound('Member');
  if (member.role === 'OWNER') {
    const owners = await prisma.workspaceMember.count({ where: { workspaceId, role: 'OWNER' } });
    if (owners <= 1) throw Errors.conflict('A workspace must keep at least one owner');
  }
  await prisma.workspaceMember.delete({ where: { id: member.id } });
  await audit({ workspaceId, actorId, action: 'member.removed', resourceType: 'workspace', resourceId: workspaceId, metadata: { userId } });
  return listMembers(workspaceId);
}

export async function createProject(workspaceId: string, actorId: string, input: { name: string; description: string }) {
  const project = await prisma.project.create({ data: { workspaceId, name: input.name, description: input.description, members: { create: { userId: actorId, role: 'MANAGER' } } } });
  await audit({ workspaceId, actorId, action: 'project.created', resourceType: 'project', resourceId: project.id, metadata: { name: project.name } });
  return toProjectDto(project);
}

export async function listProjects(workspaceId: string) {
  const projects = await prisma.project.findMany({ where: { workspaceId, archivedAt: null }, orderBy: { updatedAt: 'desc' } });
  return projects.map(toProjectDto);
}
