import bcrypt from 'bcryptjs';
import type { UserDto, WorkspaceDto, WorkspaceRole } from '@collabspace/shared';
import { getConfig } from '../config.js';
import { prisma } from '../db.js';
import { randomToken, sha256 } from '../crypto.js';
import { Errors } from '../errors.js';
import { logger } from '../logger.js';
import { audit } from './audit.js';

const SESSION_TTL_MS = 14 * 24 * 3600 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

export function toUserDto(u: { id: string; name: string; email: string; avatarUrl: string | null; themePreference: string; emailVerifiedAt: Date | null; createdAt: Date }): UserDto {
  return { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl, themePreference: u.themePreference as UserDto['themePreference'], emailVerified: Boolean(u.emailVerifiedAt), createdAt: u.createdAt.toISOString() };
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'workspace';
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function register(input: { name: string; email: string; password: string; workspaceName?: string; ip?: string | null }) {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw Errors.conflict('An account with this email already exists');
  const passwordHash = await hashPassword(input.password);
  const cfg = getConfig();
  const verificationToken = cfg.SMTP_URL ? randomToken(24) : null;
  const user = await prisma.user.create({ data: { name: input.name, email, passwordHash, verificationToken, emailVerifiedAt: cfg.SMTP_URL ? null : new Date() } });
  // Accept pending invites, otherwise create a personal workspace
  const invites = await prisma.workspaceInvite.findMany({ where: { email, acceptedAt: null } });
  for (const inv of invites) {
    await prisma.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId: user.id } }, create: { workspaceId: inv.workspaceId, userId: user.id, role: inv.role }, update: {} });
    await prisma.workspaceInvite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
  }
  if (invites.length === 0 || input.workspaceName) {
    const base = slugify(input.workspaceName ?? `${input.name}'s workspace`);
    let slug = base;
    for (let i = 2; await prisma.workspace.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
    const ws = await prisma.workspace.create({ data: { name: input.workspaceName ?? `${input.name}'s workspace`, slug, members: { create: { userId: user.id, role: 'OWNER' } } } });
    await audit({ workspaceId: ws.id, actorId: user.id, action: 'workspace.created', resourceType: 'workspace', resourceId: ws.id, ip: input.ip });
  }
  if (verificationToken) {
    await sendMail(email, 'Verify your CollabSpace AI Team account', `Verify your email: ${cfg.WEB_ORIGIN}/verify-email?token=${verificationToken}`);
  }
  return user;
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw Errors.unauthorized('Invalid email or password');
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw Errors.unauthorized('Invalid email or password');
  return user;
}

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = randomToken(32);
  const session = await prisma.session.create({ data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS), ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null } });
  return { token, session };
}

export async function resolveSession(token: string) {
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return session;
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function verifyEmail(token: string) {
  const user = await prisma.user.findUnique({ where: { verificationToken: token } });
  if (!user) throw Errors.badRequest('Invalid verification token');
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), verificationToken: null } });
  return user;
}

export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return; // do not reveal account existence
  const token = randomToken(24);
  await prisma.user.update({ where: { id: user.id }, data: { resetTokenHash: sha256(token), resetTokenExpiresAt: new Date(Date.now() + RESET_TTL_MS) } });
  const cfg = getConfig();
  await sendMail(user.email, 'Reset your password', `Reset your password: ${cfg.WEB_ORIGIN}/reset-password?token=${token}`);
  return cfg.SMTP_URL ? null : token; // without SMTP the token is returned for local development only
}

export async function resetPassword(token: string, password: string) {
  const user = await prisma.user.findFirst({ where: { resetTokenHash: sha256(token), resetTokenExpiresAt: { gt: new Date() } } });
  if (!user) throw Errors.badRequest('Invalid or expired reset token');
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), resetTokenHash: null, resetTokenExpiresAt: null } });
  await prisma.session.deleteMany({ where: { userId: user.id } });
  return user;
}

/** Minimal mail transport: logs when SMTP is not configured (documented behaviour). */
async function sendMail(to: string, subject: string, body: string) {
  const cfg = getConfig();
  if (!cfg.SMTP_URL) {
    logger.info({ to, subject }, `[mail not configured] ${body}`);
    return;
  }
  // SMTP delivery is intentionally minimal: operators can plug a transport here.
  logger.warn({ to, subject }, 'SMTP_URL set but no transport is bundled; mail was not sent');
}

export async function listUserWorkspaces(userId: string): Promise<WorkspaceDto[]> {
  const memberships = await prisma.workspaceMember.findMany({ where: { userId }, include: { workspace: true }, orderBy: { createdAt: 'asc' } });
  return memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, slug: m.workspace.slug, role: m.role as WorkspaceRole, maxConcurrentTasks: m.workspace.maxConcurrentTasks, defaultAgentConcurrency: m.workspace.defaultAgentConcurrency, createdAt: m.workspace.createdAt.toISOString() }));
}
