import type { NextFunction, Request, Response } from 'express';
import { canApproveRisk, roleHasPermission, type Permission, type RiskLevel, type WorkspaceRole } from '@collabspace/shared';
import { Errors, getConfig, prisma, rateLimit, resolveSession } from '@collabspace/core';

export const SESSION_COOKIE = 'csai_session';

export interface AuthContext {
  userId: string;
  user: { id: string; name: string; email: string; avatarUrl: string | null; themePreference: string; emailVerifiedAt: Date | null; createdAt: Date };
  sessionId: string;
  token: string;
}
export interface WorkspaceContext {
  workspaceId: string;
  role: WorkspaceRole;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    ws?: WorkspaceContext;
    requestId: string;
    validated: { body?: unknown; query?: unknown; params?: unknown };
  }
}

export function cookieOptions() {
  const cfg = getConfig();
  return { httpOnly: true, sameSite: 'lax' as const, secure: cfg.COOKIE_SECURE, path: '/', maxAge: 14 * 24 * 3600 * 1000 };
}

/** Attach the session user if a valid cookie is present (does not fail). */
export async function attachAuth(req: Request, _res: Response, next: NextFunction) {
  const token = (req.cookies as Record<string, string | undefined>)?.[SESSION_COOKIE];
  if (token) {
    const session = await resolveSession(token);
    if (session) req.auth = { userId: session.userId, user: session.user, sessionId: session.id, token };
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(Errors.unauthorized());
  next();
}

/**
 * Resolve the active workspace from the X-Workspace-Id header (or ?workspaceId=) and verify membership.
 * Every workspace-scoped route goes through this, which is what enforces workspace isolation.
 */
export async function requireWorkspace(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(Errors.unauthorized());
  const requested = (req.header('x-workspace-id') ?? (req.query.workspaceId as string | undefined))?.trim();
  let membership;
  if (requested) {
    membership = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: requested, userId: req.auth.userId } } });
    if (!membership) return next(Errors.forbidden('You are not a member of this workspace'));
  } else {
    membership = await prisma.workspaceMember.findFirst({ where: { userId: req.auth.userId }, orderBy: { createdAt: 'asc' } });
    if (!membership) return next(Errors.forbidden('You do not belong to any workspace'));
  }
  req.ws = { workspaceId: membership.workspaceId, role: membership.role as WorkspaceRole };
  next();
}

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.ws) return next(Errors.forbidden());
    for (const p of permissions) if (!roleHasPermission(req.ws.role, p)) return next(Errors.forbidden(`Missing permission ${p}`));
    next();
  };
}

export function hasPermission(req: Request, permission: Permission): boolean {
  return Boolean(req.ws && roleHasPermission(req.ws.role, permission));
}

export function canApprove(req: Request, risk: RiskLevel): boolean {
  return Boolean(req.ws && canApproveRisk(req.ws.role, risk));
}

/**
 * CSRF defence: session cookie is SameSite=Lax and every state-changing request must carry a
 * custom header that browsers never add on cross-site form submissions.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.header('x-requested-with') !== 'XMLHttpRequest') return next(Errors.forbidden('Missing X-Requested-With header'));
  next();
}

export function limiter(opts: { key: (req: Request) => string; limit: number; windowSec: number }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await rateLimit(opts.key(req), opts.limit, opts.windowSec);
      res.setHeader('X-RateLimit-Limit', String(opts.limit));
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.resetSec));
        return next(Errors.rateLimited(result.resetSec));
      }
      next();
    } catch {
      next(); // never block on rate-limiter outages
    }
  };
}

export const clientIp = (req: Request) => (req.header('x-forwarded-for')?.split(',')[0] ?? req.ip ?? 'unknown').trim();
