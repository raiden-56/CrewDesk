import { Router } from 'express';
import { getConfig, getRedis, getStorage, prisma, providerStatus } from '@collabspace/core';

export const systemRouter = Router();

systemRouter.get('/', async (_req, res) => {
  const cfg = getConfig();
  const checks: Record<string, { ok: boolean; message: string | null }> = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true, message: null };
  } catch (err) {
    checks.database = { ok: false, message: (err as Error).message };
  }
  try {
    await getRedis().ping();
    checks.redis = { ok: true, message: null };
  } catch (err) {
    checks.redis = { ok: false, message: (err as Error).message };
  }
  const storage = await getStorage().health();
  checks.storage = storage;
  const provider = providerStatus();
  const ok = Object.values(checks).every((c) => c.ok);
  res.status(ok ? 200 : 503).json({
    ok,
    version: '1.0.0',
    environment: cfg.NODE_ENV,
    checks,
    aiProvider: { configured: provider.configured, provider: provider.provider, reason: provider.reason, isMock: provider.isMock, defaultModel: provider.defaultModel, models: provider.models, embeddings: provider.embeddings },
    storage: { driver: getStorage().driver, ok: storage.ok, message: storage.message },
  });
});
