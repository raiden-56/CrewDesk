import { Router } from 'express';
import { ForgotPasswordSchema, LoginSchema, RegisterSchema, ResetPasswordSchema, UpdateProfileSchema } from '@collabspace/shared';
import { audit, createSession, destroySession, listUserWorkspaces, login, prisma, register, requestPasswordReset, resetPassword, toUserDto, verifyEmail, getConfig } from '@collabspace/core';
import { z } from 'zod';
import { clientIp, cookieOptions, limiter, requireAuth, SESSION_COOKIE } from '../middleware/auth.js';
import { body, validate } from '../middleware/validate.js';

export const authRouter = Router();

const authLimiter = limiter({ key: (req) => `auth:${clientIp(req)}`, limit: 20, windowSec: 60 });

authRouter.post('/register', authLimiter, validate(RegisterSchema), async (req, res) => {
  const input = body<z.infer<typeof RegisterSchema>>(req);
  const user = await register({ ...input, ip: clientIp(req) });
  const { token } = await createSession(user.id, { ip: clientIp(req), userAgent: req.header('user-agent') });
  res.cookie(SESSION_COOKIE, token, cookieOptions());
  res.status(201).json({ user: toUserDto(user), workspaces: await listUserWorkspaces(user.id) });
});

authRouter.post('/login', authLimiter, validate(LoginSchema), async (req, res) => {
  const input = body<z.infer<typeof LoginSchema>>(req);
  const user = await login(input.email, input.password);
  const { token } = await createSession(user.id, { ip: clientIp(req), userAgent: req.header('user-agent') });
  res.cookie(SESSION_COOKIE, token, cookieOptions());
  const workspaces = await listUserWorkspaces(user.id);
  for (const ws of workspaces) await audit({ workspaceId: ws.id, actorId: user.id, action: 'auth.login', resourceType: 'user', resourceId: user.id, ip: clientIp(req), requestId: req.requestId });
  res.json({ user: toUserDto(user), workspaces });
});

authRouter.post('/logout', async (req, res) => {
  if (req.auth) await destroySession(req.auth.token);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ user: toUserDto(req.auth!.user), workspaces: await listUserWorkspaces(req.auth!.userId) });
});

authRouter.patch('/me', requireAuth, validate(UpdateProfileSchema), async (req, res) => {
  const input = body<z.infer<typeof UpdateProfileSchema>>(req);
  const user = await prisma.user.update({ where: { id: req.auth!.userId }, data: { name: input.name, themePreference: input.themePreference } });
  res.json({ user: toUserDto(user) });
});

authRouter.post('/verify-email', authLimiter, validate(z.object({ token: z.string().min(5) })), async (req, res) => {
  await verifyEmail(body<{ token: string }>(req).token);
  res.json({ ok: true });
});

authRouter.post('/forgot-password', authLimiter, validate(ForgotPasswordSchema), async (req, res) => {
  const devToken = await requestPasswordReset(body<{ email: string }>(req).email);
  // Without SMTP configured the token is returned so local development can complete the flow.
  res.json({ ok: true, ...(devToken && getConfig().NODE_ENV !== 'production' ? { devResetToken: devToken } : {}) });
});

authRouter.post('/reset-password', authLimiter, validate(ResetPasswordSchema), async (req, res) => {
  const input = body<z.infer<typeof ResetPasswordSchema>>(req);
  await resetPassword(input.token, input.password);
  res.json({ ok: true });
});
