import { z } from 'zod';
import type { RiskLevel, ToolCategory } from '../enums.js';
import { DEFAULT_RETRY_POLICY, NO_RETRY_POLICY, type RetryPolicy } from '../retry-policy.js';

/**
 * Tool definitions shared between the API (permission UI, validation), the worker
 * (execution) and the web client (display). Adapters that implement the behaviour
 * live in @collabspace/core; this catalog is metadata + schemas only.
 */
export interface ToolDefinition<I extends z.ZodTypeAny = z.ZodTypeAny, O extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  risk: RiskLevel;
  inputSchema: I;
  outputSchema: O;
  requiredPermission: string;
  requiresApproval: boolean;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  idempotent: boolean;
  audit: 'STANDARD' | 'DETAILED';
  /** integration key required for the tool to be available (e.g. github, webhook) */
  requiresIntegration?: string;
}

const WRITE_RETRY: RetryPolicy = { ...NO_RETRY_POLICY };

export const TOOL_CATALOG: Record<string, ToolDefinition> = {
  // ---------------------------------------------------------------- read-only
  'web.search': {
    id: 'web.search',
    name: 'Search approved web sources',
    description: 'Search the indexed content of URLs approved in the knowledge base. Only approved sources are searched.',
    category: 'READ',
    risk: 'LOW',
    inputSchema: z.object({ query: z.string().min(2).max(500), limit: z.number().int().min(1).max(10).default(5) }),
    outputSchema: z.object({
      results: z.array(z.object({ sourceId: z.string(), title: z.string(), url: z.string().nullable(), snippet: z.string(), score: z.number() })),
    }),
    requiredPermission: 'tool.web.search',
    requiresApproval: false,
    timeoutMs: 20000,
    retryPolicy: DEFAULT_RETRY_POLICY,
    idempotent: true,
    audit: 'STANDARD',
  },
  'docs.search': {
    id: 'docs.search',
    name: 'Search workspace documents',
    description: 'Search indexed workspace documents and uploaded files the agent is permitted to read.',
    category: 'READ',
    risk: 'LOW',
    inputSchema: z.object({ query: z.string().min(2).max(500), limit: z.number().int().min(1).max(10).default(5) }),
    outputSchema: z.object({
      results: z.array(z.object({ sourceId: z.string(), title: z.string(), snippet: z.string(), score: z.number(), chunkIndex: z.number() })),
    }),
    requiredPermission: 'tool.docs.search',
    requiresApproval: false,
    timeoutMs: 20000,
    retryPolicy: DEFAULT_RETRY_POLICY,
    idempotent: true,
    audit: 'STANDARD',
  },
  'file.read': {
    id: 'file.read',
    name: 'Read an authorized file',
    description: 'Read the text content of an artifact or knowledge document the agent is allowed to access.',
    category: 'READ',
    risk: 'LOW',
    inputSchema: z.object({ fileId: z.string().min(1), maxChars: z.number().int().min(100).max(50000).default(12000) }),
    outputSchema: z.object({ name: z.string(), content: z.string(), truncated: z.boolean() }),
    requiredPermission: 'tool.file.read',
    requiresApproval: false,
    timeoutMs: 15000,
    retryPolicy: DEFAULT_RETRY_POLICY,
    idempotent: true,
    audit: 'STANDARD',
  },
  'task.get': {
    id: 'task.get',
    name: 'Retrieve task details',
    description: 'Retrieve details of a task in the same workspace.',
    category: 'READ',
    risk: 'LOW',
    inputSchema: z.object({ taskId: z.string().min(1) }),
    outputSchema: z.object({ id: z.string(), title: z.string(), status: z.string(), description: z.string().nullable(), result: z.string().nullable() }),
    requiredPermission: 'tool.task.get',
    requiresApproval: false,
    timeoutMs: 10000,
    retryPolicy: DEFAULT_RETRY_POLICY,
    idempotent: true,
    audit: 'STANDARD',
  },
  'csv.analyze': {
    id: 'csv.analyze',
    name: 'Analyze uploaded CSV',
    description: 'Parse a CSV artifact and compute column statistics (count, min, max, mean, distinct values).',
    category: 'READ',
    risk: 'LOW',
    inputSchema: z.object({ fileId: z.string().min(1), maxRows: z.number().int().min(1).max(50000).default(10000) }),
    outputSchema: z.object({
      rowCount: z.number(),
      columns: z.array(z.object({ name: z.string(), type: z.string(), nonEmpty: z.number(), distinct: z.number(), min: z.number().nullable(), max: z.number().nullable(), mean: z.number().nullable(), sample: z.array(z.string()) })),
    }),
    requiredPermission: 'tool.csv.analyze',
    requiresApproval: false,
    timeoutMs: 30000,
    retryPolicy: DEFAULT_RETRY_POLICY,
    idempotent: true,
    audit: 'STANDARD',
  },
  'repo.metadata': {
    id: 'repo.metadata',
    name: 'Read repository metadata',
    description: 'Read repository metadata (default branch, open PRs, recent commits) through the GitHub integration.',
    category: 'READ',
    risk: 'LOW',
    inputSchema: z.object({ repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'owner/repo') }),
    outputSchema: z.object({ fullName: z.string(), defaultBranch: z.string(), description: z.string().nullable(), openPullRequests: z.number(), recentCommits: z.array(z.object({ sha: z.string(), message: z.string(), author: z.string() })) }),
    requiredPermission: 'tool.repo.metadata',
    requiresApproval: false,
    timeoutMs: 20000,
    retryPolicy: DEFAULT_RETRY_POLICY,
    idempotent: true,
    audit: 'STANDARD',
    requiresIntegration: 'github',
  },
  // ------------------------------------------------------------------- write
  'document.create_draft': {
    id: 'document.create_draft',
    name: 'Create a document draft',
    description: 'Create a Markdown document draft as an artifact linked to the current task.',
    category: 'WRITE',
    risk: 'LOW',
    inputSchema: z.object({ title: z.string().min(1).max(200), content: z.string().min(1).max(200000), sources: z.array(z.string()).optional() }),
    outputSchema: z.object({ artifactId: z.string(), name: z.string(), size: z.number() }),
    requiredPermission: 'tool.document.create_draft',
    requiresApproval: false,
    timeoutMs: 15000,
    retryPolicy: WRITE_RETRY,
    idempotent: false,
    audit: 'DETAILED',
  },
  'report.generate': {
    id: 'report.generate',
    name: 'Generate a report file',
    description: 'Generate a downloadable report (Markdown, PDF, CSV or JSON) from structured content.',
    category: 'WRITE',
    risk: 'LOW',
    inputSchema: z.object({
      title: z.string().min(1).max(200),
      format: z.enum(['MARKDOWN', 'PDF', 'CSV', 'JSON']).default('MARKDOWN'),
      content: z.string().min(1).max(300000),
      sources: z.array(z.object({ title: z.string(), url: z.string().nullable().optional(), sourceId: z.string().nullable().optional() })).optional(),
    }),
    outputSchema: z.object({ artifactId: z.string(), name: z.string(), size: z.number(), type: z.string() }),
    requiredPermission: 'tool.report.generate',
    requiresApproval: false,
    timeoutMs: 30000,
    retryPolicy: WRITE_RETRY,
    idempotent: false,
    audit: 'DETAILED',
  },
  'task.create_draft': {
    id: 'task.create_draft',
    name: 'Create a task draft',
    description: 'Create a task in DRAFT state for a human to review and publish. Drafts never execute automatically.',
    category: 'WRITE',
    risk: 'LOW',
    inputSchema: z.object({ title: z.string().min(1).max(200), description: z.string().max(5000).optional(), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'), agentId: z.string().optional() }),
    outputSchema: z.object({ taskId: z.string(), status: z.string() }),
    requiredPermission: 'tool.task.create_draft',
    requiresApproval: false,
    timeoutMs: 10000,
    retryPolicy: WRITE_RETRY,
    idempotent: false,
    audit: 'DETAILED',
  },
  'project.comment': {
    id: 'project.comment',
    name: 'Add a project comment',
    description: 'Add a comment to the current project activity feed.',
    category: 'WRITE',
    risk: 'LOW',
    inputSchema: z.object({ body: z.string().min(1).max(5000) }),
    outputSchema: z.object({ commentId: z.string() }),
    requiredPermission: 'tool.project.comment',
    requiresApproval: false,
    timeoutMs: 10000,
    retryPolicy: WRITE_RETRY,
    idempotent: false,
    audit: 'DETAILED',
  },
  'docs.update': {
    id: 'docs.update',
    name: 'Update approved documentation',
    description: 'Replace the content of an existing documentation artifact. Shows a diff and requires human approval.',
    category: 'WRITE',
    risk: 'MEDIUM',
    inputSchema: z.object({ artifactId: z.string().min(1), newContent: z.string().min(1).max(300000), summary: z.string().max(1000) }),
    outputSchema: z.object({ artifactId: z.string(), version: z.number() }),
    requiredPermission: 'tool.docs.update',
    requiresApproval: true,
    timeoutMs: 15000,
    retryPolicy: WRITE_RETRY,
    idempotent: false,
    audit: 'DETAILED',
  },
  'github.pr_draft': {
    id: 'github.pr_draft',
    name: 'Create a pull request draft',
    description: 'Open a draft pull request through the GitHub integration. Requires approval.',
    category: 'WRITE',
    risk: 'MEDIUM',
    inputSchema: z.object({ repository: z.string(), title: z.string().min(1).max(200), body: z.string().max(20000), head: z.string(), base: z.string() }),
    outputSchema: z.object({ number: z.number(), url: z.string() }),
    requiredPermission: 'tool.github.pr_draft',
    requiresApproval: true,
    timeoutMs: 30000,
    retryPolicy: WRITE_RETRY,
    idempotent: false,
    audit: 'DETAILED',
    requiresIntegration: 'github',
  },
  // --------------------------------------------------------------- high risk
  'content.publish': {
    id: 'content.publish',
    name: 'Publish external content',
    description: 'Publish an artifact to the configured external publishing webhook.',
    category: 'HIGH_RISK',
    risk: 'HIGH',
    inputSchema: z.object({ artifactId: z.string().min(1), destination: z.string().min(1).max(200) }),
    outputSchema: z.object({ published: z.boolean(), reference: z.string().nullable() }),
    requiredPermission: 'tool.content.publish',
    requiresApproval: true,
    timeoutMs: 30000,
    retryPolicy: WRITE_RETRY,
    idempotent: false,
    audit: 'DETAILED',
    requiresIntegration: 'webhook',
  },
  'permissions.modify': {
    id: 'permissions.modify',
    name: 'Modify project permissions',
    description: 'Change a member role on a project. Requires owner/admin approval. Agents can never target their own permissions.',
    category: 'HIGH_RISK',
    risk: 'CRITICAL',
    inputSchema: z.object({ projectId: z.string(), userId: z.string(), role: z.enum(['VIEWER', 'EDITOR', 'MANAGER']) }),
    outputSchema: z.object({ projectId: z.string(), userId: z.string(), role: z.string() }),
    requiredPermission: 'tool.permissions.modify',
    requiresApproval: true,
    timeoutMs: 10000,
    retryPolicy: WRITE_RETRY,
    idempotent: true,
    audit: 'DETAILED',
  },
  'code.merge': {
    id: 'code.merge',
    name: 'Merge code',
    description: 'Merge a pull request through the GitHub integration. Requires approval.',
    category: 'HIGH_RISK',
    risk: 'CRITICAL',
    inputSchema: z.object({ repository: z.string(), pullNumber: z.number().int().positive() }),
    outputSchema: z.object({ merged: z.boolean(), sha: z.string().nullable() }),
    requiredPermission: 'tool.code.merge',
    requiresApproval: true,
    timeoutMs: 30000,
    retryPolicy: WRITE_RETRY,
    idempotent: true,
    audit: 'DETAILED',
    requiresIntegration: 'github',
  },
  'resource.delete': {
    id: 'resource.delete',
    name: 'Delete a resource',
    description: 'Delete an artifact or knowledge source in the workspace. Requires approval.',
    category: 'HIGH_RISK',
    risk: 'HIGH',
    inputSchema: z.object({ resourceType: z.enum(['artifact', 'knowledgeSource']), resourceId: z.string().min(1), reason: z.string().max(500).optional() }),
    outputSchema: z.object({ deleted: z.boolean() }),
    requiredPermission: 'tool.resource.delete',
    requiresApproval: true,
    timeoutMs: 15000,
    retryPolicy: WRITE_RETRY,
    idempotent: true,
    audit: 'DETAILED',
  },
  'message.send': {
    id: 'message.send',
    name: 'Send external message',
    description: 'Send a message to the configured outbound webhook (e.g. Slack/Teams incoming webhook). Requires approval.',
    category: 'HIGH_RISK',
    risk: 'HIGH',
    inputSchema: z.object({ channel: z.string().max(100).optional(), text: z.string().min(1).max(4000) }),
    outputSchema: z.object({ delivered: z.boolean(), statusCode: z.number().nullable() }),
    requiredPermission: 'tool.message.send',
    requiresApproval: true,
    timeoutMs: 15000,
    retryPolicy: WRITE_RETRY,
    idempotent: false,
    audit: 'DETAILED',
    requiresIntegration: 'webhook',
  },
  'ops.execute': {
    id: 'ops.execute',
    name: 'Execute production operation',
    description: 'Trigger an allowlisted production operation through the operations webhook. Requires owner/admin approval.',
    category: 'HIGH_RISK',
    risk: 'CRITICAL',
    inputSchema: z.object({ operation: z.string().min(1).max(100), parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}) }),
    outputSchema: z.object({ accepted: z.boolean(), reference: z.string().nullable() }),
    requiredPermission: 'tool.ops.execute',
    requiresApproval: true,
    timeoutMs: 30000,
    retryPolicy: WRITE_RETRY,
    idempotent: false,
    audit: 'DETAILED',
    requiresIntegration: 'webhook',
  },
};

export const TOOL_IDS = Object.keys(TOOL_CATALOG);

export function getToolDefinition(id: string): ToolDefinition | undefined {
  return TOOL_CATALOG[id];
}

export function validateToolInput(id: string, input: unknown): { ok: true; data: unknown } | { ok: false; error: string } {
  const def = TOOL_CATALOG[id];
  if (!def) return { ok: false, error: `Unknown tool ${id}` };
  const parsed = def.inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { ok: true, data: parsed.data };
}

/** Serializable summary used by the API and UI (no zod objects). */
export function toolSummary(def: ToolDefinition) {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    category: def.category,
    risk: def.risk,
    requiresApproval: def.requiresApproval,
    requiresIntegration: def.requiresIntegration ?? null,
    timeoutMs: def.timeoutMs,
    idempotent: def.idempotent,
    inputSchema: z.toJSONSchema(def.inputSchema),
    outputSchema: z.toJSONSchema(def.outputSchema),
  };
}
export type ToolSummary = ReturnType<typeof toolSummary>;

export const TOOL_GROUPS: Array<{ label: string; description: string; category: ToolCategory }> = [
  { label: 'Read-only tools', description: 'Retrieve information. No side effects.', category: 'READ' },
  { label: 'Write tools', description: 'Create drafts and artifacts inside the workspace.', category: 'WRITE' },
  { label: 'High-risk tools', description: 'External or destructive actions. Always require human approval.', category: 'HIGH_RISK' },
];
