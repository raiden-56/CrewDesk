import type { IntegrationDto } from '@collabspace/shared';
import { prisma } from '../db.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import { Errors } from '../errors.js';

export function toIntegrationDto(i: { id: string; provider: string; name: string; config: unknown; status: string; lastCheckedAt: Date | null; lastError: string | null; createdAt: Date }): IntegrationDto {
  return {
    id: i.id,
    provider: i.provider,
    name: i.name,
    config: (i.config as Record<string, string>) ?? {},
    status: i.status as IntegrationDto['status'],
    lastCheckedAt: i.lastCheckedAt?.toISOString() ?? null,
    lastError: i.lastError,
    createdAt: i.createdAt.toISOString(),
  };
}

/** Resolve the decrypted secret for a workspace integration. Never returned to clients. */
export async function getIntegrationSecret(workspaceId: string, provider: string): Promise<{ id: string; secret: string; config: Record<string, string> } | null> {
  const row = await prisma.integrationConnection.findFirst({ where: { workspaceId, provider, status: 'CONNECTED' }, orderBy: { createdAt: 'asc' } });
  if (!row) return null;
  return { id: row.id, secret: decryptSecret(row.encryptedSecret), config: (row.config as Record<string, string>) ?? {} };
}

export async function upsertIntegration(input: { workspaceId: string; provider: string; name: string; secret: string; config: Record<string, string>; createdById: string }) {
  const encryptedSecret = encryptSecret(input.secret);
  const row = await prisma.integrationConnection.upsert({
    where: { workspaceId_provider_name: { workspaceId: input.workspaceId, provider: input.provider, name: input.name } },
    create: { workspaceId: input.workspaceId, provider: input.provider, name: input.name, encryptedSecret, config: input.config, createdById: input.createdById, status: 'CONNECTED' },
    update: { encryptedSecret, config: input.config, status: 'CONNECTED', lastError: null },
  });
  return toIntegrationDto(row);
}

/** Validate an integration by making a harmless request. */
export async function checkIntegration(workspaceId: string, id: string) {
  const row = await prisma.integrationConnection.findFirst({ where: { id, workspaceId } });
  if (!row) throw Errors.notFound('Integration');
  const secret = decryptSecret(row.encryptedSecret);
  let status: 'CONNECTED' | 'ERROR' = 'CONNECTED';
  let lastError: string | null = null;
  try {
    if (row.provider === 'github') {
      const res = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${secret}`, 'User-Agent': 'collabspace-ai-team', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    } else if (row.provider === 'webhook') {
      const url = new URL(secret);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Webhook URL must be http(s)');
    }
  } catch (err) {
    status = 'ERROR';
    lastError = (err as Error).message;
  }
  const updated = await prisma.integrationConnection.update({ where: { id }, data: { status, lastError, lastCheckedAt: new Date() } });
  return toIntegrationDto(updated);
}

/** POST a JSON payload to the workspace webhook integration. Used by message.send / content.publish / ops.execute. */
export async function postWebhook(workspaceId: string, payload: Record<string, unknown>, idempotencyKey: string): Promise<{ ok: boolean; statusCode: number | null; body: string | null }> {
  const integration = await getIntegrationSecret(workspaceId, 'webhook');
  if (!integration) throw Errors.unavailable('Webhook integration is not configured for this workspace');
  const res = await fetch(integration.secret, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey, 'User-Agent': 'collabspace-ai-team' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.text().catch(() => null);
  return { ok: res.ok, statusCode: res.status, body: body ? body.slice(0, 2000) : null };
}

export async function githubRequest<T>(workspaceId: string, path: string, init: RequestInit = {}): Promise<T> {
  const integration = await getIntegrationSecret(workspaceId, 'github');
  if (!integration) throw Errors.unavailable('GitHub integration is not configured for this workspace');
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${integration.secret}`, Accept: 'application/vnd.github+json', 'User-Agent': 'collabspace-ai-team', 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`GitHub API ${res.status}: ${text.slice(0, 300)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}
