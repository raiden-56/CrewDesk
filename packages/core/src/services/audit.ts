import { prisma } from '../db.js';
import { scrubSecrets } from '../logger.js';

export interface AuditInput {
  workspaceId: string;
  actorId?: string | null;
  actorType?: 'USER' | 'AGENT' | 'SYSTEM';
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  requestId?: string | null;
}

export async function audit(input: AuditInput) {
  return prisma.auditLog.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId ?? null,
      actorType: input.actorType ?? (input.actorId ? 'USER' : 'SYSTEM'),
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata: input.metadata ? (scrubSecrets(input.metadata) as object) : undefined,
      ip: input.ip ?? null,
      requestId: input.requestId ?? null,
    },
  });
}
