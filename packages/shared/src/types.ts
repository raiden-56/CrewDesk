/**
 * API response shapes shared by the server and the web client.
 */
import type {
  AgentCategory,
  AgentStatus,
  ApprovalStatus,
  ArtifactType,
  EventLevel,
  ExecutionEventType,
  KnowledgeSourceType,
  KnowledgeStatus,
  NodeExecutionStatus,
  NotificationType,
  RiskLevel,
  TaskPriority,
  TaskStatus,
  WorkflowExecutionStatus,
  WorkspaceRole,
} from './enums.js';
import type { InstructionSet } from './agent-templates.js';
import type { ModelConfig } from './schemas/api.js';
import type { WorkflowGraph } from './workflow/validate.js';

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

export interface UserDto {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  themePreference: 'light' | 'dark' | 'system';
  emailVerified: boolean;
  createdAt: string;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  maxConcurrentTasks: number;
  defaultAgentConcurrency: number;
  createdAt: string;
}

export interface ProjectDto {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  project: { id: string; name: string } | null;
  name: string;
  avatar: string;
  color: string;
  description: string;
  category: AgentCategory;
  status: AgentStatus;
  currentVersion: number;
  currentVersionId: string;
  instructions: InstructionSet;
  modelConfig: ModelConfig;
  tools: string[];
  knowledge: { sourceIds: string[]; allowWorkspaceKnowledge: boolean; allowProjectDocuments: boolean; allowPreviousReports: boolean };
  currentTask: { id: string; title: string; status: TaskStatus; progress: number; progressMessage: string | null } | null;
  lastActivityAt: string | null;
  lastError: string | null;
  stats: { totalTasks: number; completedTasks: number; failedTasks: number; runningTasks: number };
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface AgentVersionDto {
  id: string;
  version: number;
  changeSummary: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  instructions: InstructionSet;
  modelConfig: ModelConfig;
  tools: string[];
}

export interface TaskDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  project: { id: string; name: string } | null;
  agentId: string;
  agent: { id: string; name: string; avatar: string; color: string; category: AgentCategory };
  agentVersionId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  progressMessage: string | null;
  deadline: string | null;
  scheduledFor: string | null;
  expectedDeliverable: string;
  allowedTools: string[] | null;
  budgetUsd: number | null;
  requireApprovalForWrites: boolean;
  attempt: number;
  maxAttempts: number;
  failureClass: string | null;
  errorMessage: string | null;
  resultSummary: string | null;
  resultContent: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  usage: { inputTokens: number | null; outputTokens: number | null; estimatedCostUsd: number | null; requests: number; toolInvocations: number; hasUnavailable: boolean };
  createdBy: { id: string; name: string } | null;
  conversationId: string | null;
  workflowExecutionId: string | null;
  pendingApprovalId: string | null;
  artifactCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionEventDto {
  id: string;
  taskId: string;
  executionId: string | null;
  type: ExecutionEventType;
  level: EventLevel;
  message: string;
  metadata: Record<string, unknown> | null;
  /** only present for users with diagnostics permission */
  diagnostics?: Record<string, unknown> | null;
  durationMs: number | null;
  sequence: number;
  createdAt: string;
}

export interface ArtifactDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  taskId: string | null;
  agentId: string | null;
  agent: { id: string; name: string; avatar: string; color: string } | null;
  name: string;
  type: ArtifactType;
  mimeType: string;
  size: number;
  version: number;
  sources: Array<{ title: string; url?: string | null; sourceId?: string | null }>;
  visibility: 'WORKSPACE' | 'PROJECT' | 'PRIVATE';
  createdBy: { id: string; name: string } | null;
  createdAt: string;
}

export interface ApprovalDto {
  id: string;
  workspaceId: string;
  taskId: string | null;
  task: { id: string; title: string; status: TaskStatus } | null;
  workflowExecutionId: string | null;
  agentId: string | null;
  agent: { id: string; name: string; avatar: string; color: string } | null;
  toolId: string | null;
  actionTitle: string;
  actionDescription: string;
  targetResource: string | null;
  risk: RiskLevel;
  proposal: Record<string, unknown>;
  proposalVersion: number;
  proposalHash: string;
  evidence: Record<string, unknown> | null;
  diff: { before: string | null; after: string | null } | null;
  status: ApprovalStatus;
  expiresAt: string | null;
  decisions: Array<{ id: string; decision: string; comment: string | null; decidedBy: { id: string; name: string }; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDto {
  id: string;
  agentId: string;
  projectId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  role: 'USER' | 'AGENT' | 'SYSTEM';
  kind: 'TEXT' | 'EXECUTION' | 'APPROVAL' | 'ERROR' | 'TOOL' | 'ARTIFACT';
  content: string;
  metadata: Record<string, unknown> | null;
  taskId: string | null;
  status: 'PENDING' | 'STREAMING' | 'COMPLETE' | 'FAILED';
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
  createdAt: string;
}

export interface KnowledgeSourceDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  type: KnowledgeSourceType;
  title: string;
  url: string | null;
  status: KnowledgeStatus;
  statusMessage: string | null;
  version: number;
  chunkCount: number;
  size: number | null;
  agentIds: string[];
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  indexedAt: string | null;
}

export interface WorkflowDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  description: string;
  currentVersion: number;
  currentVersionId: string;
  graph: WorkflowGraph;
  isTemplate: boolean;
  lastExecution: { id: string; status: WorkflowExecutionStatus; createdAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowExecutionDto {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  version: number;
  status: WorkflowExecutionStatus;
  dryRun: boolean;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  nodes: Array<{
    id: string;
    nodeId: string;
    nodeType: string;
    label: string | null;
    status: NodeExecutionStatus;
    attempt: number;
    input: Record<string, unknown> | null;
    output: Record<string, unknown> | null;
    errorMessage: string | null;
    taskId: string | null;
    approvalId: string | null;
    logs: Array<{ at: string; level: string; message: string }>;
    startedAt: string | null;
    completedAt: string | null;
  }>;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AuditLogDto {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actor: { id: string; name: string } | null;
  actorType: 'USER' | 'AGENT' | 'SYSTEM';
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface DashboardMetricsDto {
  window: { label: string; from: string; to: string };
  totalAgents: number;
  activeAgents: number;
  totalTasks: number;
  runningTasks: number;
  queuedTasks: number;
  completedTasks: number;
  awaitingApproval: number;
  failedTasks: number;
  successRate: number | null;
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number; requests: number; hasUnavailable: boolean };
  trends: { tasksCreated: number[]; tasksCompleted: number[]; tasksFailed: number[]; labels: string[] };
  aiProvider: { configured: boolean; provider: string | null; model: string | null; isMock: boolean };
}

export interface UsageSummaryDto {
  period: { label: string; from: string; to: string };
  totals: { inputTokens: number; outputTokens: number; requests: number; toolInvocations: number; durationMs: number; estimatedCostUsd: number; failed: number; retries: number; hasUnavailable: boolean };
  daily: Array<{ date: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number; requests: number; failed: number }>;
  byAgent: Array<{ agentId: string; name: string; color: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number; requests: number; tasks: number }>;
  byProject: Array<{ projectId: string | null; name: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number; requests: number }>;
  byModel: Array<{ model: string; requests: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number }>;
  budgets: Array<{ id: string; scope: string; scopeId: string | null; scopeName: string; period: string; hardLimitUsd: number | null; warningRatio: number; usedUsd: number; state: 'OK' | 'WARNING' | 'EXCEEDED'; enabled: boolean }>;
}

export interface IntegrationDto {
  id: string;
  provider: string;
  name: string;
  config: Record<string, string>;
  status: 'CONNECTED' | 'ERROR' | 'DISCONNECTED';
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface AiProviderStatusDto {
  configured: boolean;
  provider: string | null;
  defaultModel: string | null;
  isMock: boolean;
  models: Array<{ id: string; label: string; provider: string }>;
  embeddings: boolean;
  storage: { driver: string; ok: boolean; message: string | null };
}

export type RealtimeEvent =
  | { type: 'task.updated'; workspaceId: string; task: Pick<TaskDto, 'id' | 'status' | 'progress' | 'progressMessage' | 'agentId' | 'updatedAt'> }
  | { type: 'task.event'; workspaceId: string; event: ExecutionEventDto }
  | { type: 'agent.updated'; workspaceId: string; agentId: string; status: AgentStatus }
  | { type: 'approval.updated'; workspaceId: string; approvalId: string; status: ApprovalStatus; taskId: string | null }
  | { type: 'message.created'; workspaceId: string; conversationId: string; message: MessageDto }
  | { type: 'message.delta'; workspaceId: string; conversationId: string; messageId: string; delta: string }
  | { type: 'notification'; workspaceId: string; userId: string; notification: NotificationDto }
  | { type: 'knowledge.updated'; workspaceId: string; sourceId: string; status: KnowledgeStatus }
  | { type: 'workflow.updated'; workspaceId: string; executionId: string; status: WorkflowExecutionStatus }
  | { type: 'artifact.created'; workspaceId: string; artifact: ArtifactDto };
