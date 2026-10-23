import { TOOL_CATALOG, type ToolDefinition } from '@collabspace/shared';
import { z } from 'zod';
import { prisma } from '../db.js';

/** Scoped execution context passed to every tool adapter. Adapters must only act within it. */
export interface ToolContext {
  workspaceId: string;
  projectId: string | null;
  agentId: string;
  agentName: string;
  taskId: string;
  executionId: string | null;
  /** knowledge sources the agent is allowed to read (resolved from the agent version + project) */
  knowledgeSourceIds: string[];
  allowPreviousReports: boolean;
  /** artifacts attached as task inputs */
  inputArtifactIds: string[];
  /** user who created the task; used for attribution of created records */
  actorUserId: string | null;
  /** present when the invocation executes an approved proposal */
  approval?: { id: string; approvedById: string } | null;
  /** invocation-scoped idempotency key */
  idempotencyKey: string;
}

export interface ToolPreview {
  targetResource: string | null;
  diff?: { before: string | null; after: string | null };
  evidence?: Record<string, unknown>;
}

export interface ToolAdapter<I = unknown, O = unknown> {
  id: string;
  execute(input: I, ctx: ToolContext): Promise<O>;
  /** Called before approval to describe the target and show proposed changes. */
  preview?(input: I, ctx: ToolContext): Promise<ToolPreview>;
  /**
   * After an uncertain failure (timeout) of a non-idempotent tool, adapters may verify
   * whether the side effect already happened using the idempotency key.
   */
  verify?(input: I, ctx: ToolContext): Promise<O | null>;
}

const adapters = new Map<string, ToolAdapter>();

export function registerAdapter(adapter: ToolAdapter): void {
  if (!TOOL_CATALOG[adapter.id]) throw new Error(`Adapter ${adapter.id} has no catalog definition`);
  adapters.set(adapter.id, adapter);
}

export function getAdapter(id: string): ToolAdapter | undefined {
  return adapters.get(id);
}

export function getDefinition(id: string): ToolDefinition | undefined {
  return TOOL_CATALOG[id];
}

export function listDefinitions(): ToolDefinition[] {
  return Object.values(TOOL_CATALOG);
}

/** Upsert catalog definitions into the database so permissions can reference them. */
export async function syncToolDefinitions(): Promise<void> {
  for (const def of Object.values(TOOL_CATALOG)) {
    const inputSchema = z.toJSONSchema(def.inputSchema) as object;
    const outputSchema = z.toJSONSchema(def.outputSchema) as object;
    await prisma.toolDefinition.upsert({
      where: { id: def.id },
      create: {
        id: def.id,
        name: def.name,
        description: def.description,
        category: def.category,
        risk: def.risk,
        requiresApproval: def.requiresApproval,
        requiresIntegration: def.requiresIntegration ?? null,
        timeoutMs: def.timeoutMs,
        idempotent: def.idempotent,
        inputSchema,
        outputSchema,
      },
      update: {
        name: def.name,
        description: def.description,
        category: def.category,
        risk: def.risk,
        requiresApproval: def.requiresApproval,
        requiresIntegration: def.requiresIntegration ?? null,
        timeoutMs: def.timeoutMs,
        idempotent: def.idempotent,
        inputSchema,
        outputSchema,
      },
    });
  }
}

/** Whether a tool can run in a workspace (enabled + required integration connected). */
export async function toolAvailability(toolId: string, workspaceId: string): Promise<{ available: boolean; reason: string | null }> {
  const def = TOOL_CATALOG[toolId];
  if (!def) return { available: false, reason: 'Unknown tool' };
  const row = await prisma.toolDefinition.findUnique({ where: { id: toolId }, select: { enabled: true } });
  if (row && !row.enabled) return { available: false, reason: 'Tool disabled by administrator' };
  if (def.requiresIntegration) {
    const integration = await prisma.integrationConnection.findFirst({ where: { workspaceId, provider: def.requiresIntegration, status: 'CONNECTED' }, select: { id: true } });
    if (!integration) return { available: false, reason: `Requires the ${def.requiresIntegration} integration to be configured` };
  }
  return { available: true, reason: null };
}
