import { z } from 'zod';
import { AGENT_CATEGORIES, AI_PROVIDERS, TASK_STATUSES, WORKSPACE_ROLES } from '../enums.js';
import { TOOL_IDS } from '../tools/catalog.js';
import { WorkflowGraphSchema } from '../workflow/validate.js';

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ------------------------------------------------------------------ auth
export const RegisterSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().max(200),
  password: z.string().min(10).max(200),
  workspaceName: z.string().min(2).max(80).optional(),
});
export const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
export const ForgotPasswordSchema = z.object({ email: z.string().email() });
export const ResetPasswordSchema = z.object({ token: z.string().min(10), password: z.string().min(10).max(200) });

// ----------------------------------------------------------------- agents
export const InstructionSetSchema = z.object({
  role: z.string().max(4000).default(''),
  responsibilities: z.string().max(8000).default(''),
  goals: z.string().max(4000).default(''),
  operatingRules: z.string().max(8000).default(''),
  outputFormat: z.string().max(8000).default(''),
  constraints: z.string().max(4000).default(''),
  escalationRules: z.string().max(4000).default(''),
  examples: z.string().max(8000).default(''),
});

export const ModelConfigSchema = z.object({
  provider: z.enum(AI_PROVIDERS).nullable().default(null),
  model: z.string().min(1).max(100).nullable().default(null),
  temperature: z.number().min(0).max(2).nullable().default(null),
  maxOutputTokens: z.number().int().min(256).max(64000).default(4096),
  timeoutMs: z.number().int().min(10000).max(3600000).default(600000),
  maxRetries: z.number().int().min(0).max(5).default(2),
  maxTokensPerTask: z.number().int().min(1000).max(5000000).nullable().default(null),
  budgetUsd: z.number().min(0).max(10000).nullable().default(null),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const KnowledgeSelectionSchema = z.object({
  sourceIds: z.array(z.string()).default([]),
  allowWorkspaceKnowledge: z.boolean().default(false),
  allowProjectDocuments: z.boolean().default(true),
  allowPreviousReports: z.boolean().default(false),
});

export const CreateAgentSchema = z.object({
  name: z.string().min(2).max(60),
  avatar: z.string().max(40).default('general'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
  description: z.string().max(500).default(''),
  category: z.enum(AGENT_CATEGORIES as [string, ...string[]]),
  projectId: z.string().nullable().default(null),
  instructions: InstructionSetSchema,
  modelConfig: ModelConfigSchema,
  tools: z.array(z.enum(TOOL_IDS as [string, ...string[]])).default([]),
  knowledge: KnowledgeSelectionSchema.default({ sourceIds: [], allowWorkspaceKnowledge: false, allowProjectDocuments: true, allowPreviousReports: false }),
  changeSummary: z.string().max(300).optional(),
});
export type CreateAgentInput = z.infer<typeof CreateAgentSchema>;
export const UpdateAgentSchema = CreateAgentSchema.partial();

export const AgentTestPromptSchema = z.object({
  prompt: z.string().min(1).max(4000),
  config: CreateAgentSchema.partial().optional(),
});

export const AgentListQuery = PaginationQuery.extend({
  category: z.string().optional(),
  status: z.string().optional(),
  projectId: z.string().optional(),
  search: z.string().max(100).optional(),
  availability: z.enum(['available', 'busy']).optional(),
  includeArchived: z.coerce.boolean().default(false),
});

// ------------------------------------------------------------------ tasks
export const CreateTaskSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(20000).default(''),
  agentId: z.string().min(1),
  projectId: z.string().nullable().default(null),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  deadline: z.string().datetime().nullable().default(null),
  inputArtifactIds: z.array(z.string()).default([]),
  expectedDeliverable: z.string().max(1000).default(''),
  allowedTools: z.array(z.string()).nullable().default(null),
  budgetUsd: z.number().min(0).max(10000).nullable().default(null),
  requireApprovalForWrites: z.boolean().default(false),
  scheduledFor: z.string().datetime().nullable().default(null),
  idempotencyKey: z.string().max(100).optional(),
  conversationId: z.string().optional(),
  asDraft: z.boolean().default(false),
});
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;

export const TaskListQuery = PaginationQuery.extend({
  status: z.enum(TASK_STATUSES as [string, ...string[]]).optional(),
  agentId: z.string().optional(),
  projectId: z.string().optional(),
  search: z.string().max(100).optional(),
  priority: z.string().optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'priority', 'status', 'title', 'duration', 'cost']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const BulkCancelSchema = z.object({ taskIds: z.array(z.string()).min(1).max(100) });

// -------------------------------------------------------------- approvals
export const ApprovalDecisionSchema = z.object({
  comment: z.string().max(2000).optional(),
  /** must match the proposal version shown to the reviewer */
  proposalVersion: z.number().int().min(1),
});

// -------------------------------------------------------------- workflows
export const CreateWorkflowSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).default(''),
  projectId: z.string().nullable().default(null),
  graph: WorkflowGraphSchema,
  changeSummary: z.string().max(300).optional(),
});
export const UpdateWorkflowSchema = CreateWorkflowSchema.partial();
export const ExecuteWorkflowSchema = z.object({
  input: z.record(z.string(), z.unknown()).default({}),
  dryRun: z.boolean().default(false),
});

// -------------------------------------------------------------- knowledge
export const CreateKnowledgeUrlSchema = z.object({
  type: z.literal('URL'),
  url: z.string().url().max(2000),
  title: z.string().max(200).optional(),
  projectId: z.string().nullable().default(null),
  agentIds: z.array(z.string()).default([]),
});
export const CreateKnowledgeTextSchema = z.object({
  type: z.literal('TEXT'),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(500000),
  projectId: z.string().nullable().default(null),
  agentIds: z.array(z.string()).default([]),
});
export const CreateKnowledgeSchema = z.discriminatedUnion('type', [CreateKnowledgeUrlSchema, CreateKnowledgeTextSchema]);

// ------------------------------------------------------------ conversation
export const SendMessageSchema = z.object({
  content: z.string().min(1).max(20000),
  attachmentArtifactIds: z.array(z.string()).default([]),
});

// --------------------------------------------------------------- workspace
export const UpdateMemberRoleSchema = z.object({ role: z.enum(WORKSPACE_ROLES as [string, ...string[]]) });
export const InviteMemberSchema = z.object({ email: z.string().email(), role: z.enum(WORKSPACE_ROLES as [string, ...string[]]) });
export const CreateProjectSchema = z.object({ name: z.string().min(2).max(80), description: z.string().max(500).default('') });
export const UpdateWorkspaceSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  maxConcurrentTasks: z.number().int().min(1).max(100).optional(),
  defaultAgentConcurrency: z.number().int().min(1).max(20).optional(),
});
export const BudgetPolicySchema = z.object({
  scope: z.enum(['WORKSPACE', 'AGENT', 'PROJECT']),
  scopeId: z.string().nullable().default(null),
  period: z.enum(['DAILY', 'MONTHLY', 'TOTAL']),
  hardLimitUsd: z.number().min(0).max(100000).nullable().default(null),
  warningRatio: z.number().min(0.1).max(1).default(0.8),
  maxTokens: z.number().int().min(0).nullable().default(null),
  enabled: z.boolean().default(true),
});
export const IntegrationSchema = z.object({
  provider: z.enum(['github', 'webhook']),
  name: z.string().min(1).max(80),
  /** secret (token or webhook URL). Stored encrypted, never returned. */
  secret: z.string().min(1).max(4000),
  config: z.record(z.string(), z.string()).default({}),
});
export const UpdateProfileSchema = z.object({ name: z.string().min(2).max(80).optional(), themePreference: z.enum(['light', 'dark', 'system']).optional() });
export const UsageQuery = z.object({
  period: z.enum(['24h', '7d', '30d']).default('7d'),
  projectId: z.string().optional(),
  agentId: z.string().optional(),
});
export const AuditQuery = PaginationQuery.extend({
  action: z.string().optional(),
  actorId: z.string().optional(),
  resourceType: z.string().optional(),
  search: z.string().max(100).optional(),
});
export const EventsQuery = z.object({
  search: z.string().max(100).optional(),
  type: z.string().optional(),
  level: z.string().optional(),
  format: z.enum(['json', 'csv']).optional(),
});
