export const TaskStatus = {
  DRAFT: 'DRAFT',
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  TIMED_OUT: 'TIMED_OUT',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export const TASK_STATUSES = Object.values(TaskStatus) as TaskStatus[];
export const TERMINAL_TASK_STATUSES: TaskStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];
export const ACTIVE_TASK_STATUSES: TaskStatus[] = ['QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'PAUSED'];

export const AgentStatus = {
  ONLINE: 'ONLINE',
  IDLE: 'IDLE',
  WORKING: 'WORKING',
  PAUSED: 'PAUSED',
  OFFLINE: 'OFFLINE',
  ARCHIVED: 'ARCHIVED',
} as const;
export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

export const AgentCategory = {
  RESEARCHER: 'RESEARCHER',
  PROJECT_PLANNER: 'PROJECT_PLANNER',
  QA_REVIEWER: 'QA_REVIEWER',
  DOCUMENTATION: 'DOCUMENTATION',
  GENERAL_ASSISTANT: 'GENERAL_ASSISTANT',
  DATA_ANALYST: 'DATA_ANALYST',
  MEETING_ASSISTANT: 'MEETING_ASSISTANT',
  PRODUCT_MANAGER: 'PRODUCT_MANAGER',
  CODE_ASSISTANT: 'CODE_ASSISTANT',
  CUSTOMER_SUPPORT: 'CUSTOMER_SUPPORT',
  SECURITY_REVIEWER: 'SECURITY_REVIEWER',
  WORKFLOW_COORDINATOR: 'WORKFLOW_COORDINATOR',
} as const;
export type AgentCategory = (typeof AgentCategory)[keyof typeof AgentCategory];
export const AGENT_CATEGORIES = Object.values(AgentCategory) as AgentCategory[];

export const AGENT_CATEGORY_LABELS: Record<AgentCategory, string> = {
  RESEARCHER: 'Researcher',
  PROJECT_PLANNER: 'Project Planner',
  QA_REVIEWER: 'QA Reviewer',
  DOCUMENTATION: 'Documentation Assistant',
  GENERAL_ASSISTANT: 'General Assistant',
  DATA_ANALYST: 'Data Analyst',
  MEETING_ASSISTANT: 'Meeting Assistant',
  PRODUCT_MANAGER: 'Product Manager',
  CODE_ASSISTANT: 'Code Assistant',
  CUSTOMER_SUPPORT: 'Customer Support Assistant',
  SECURITY_REVIEWER: 'Security Reviewer',
  WORKFLOW_COORDINATOR: 'Workflow Coordinator',
};

export const WorkspaceRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  AGENT_MANAGER: 'AGENT_MANAGER',
  TASK_OPERATOR: 'TASK_OPERATOR',
  APPROVER: 'APPROVER',
  VIEWER: 'VIEWER',
} as const;
export type WorkspaceRole = (typeof WorkspaceRole)[keyof typeof WorkspaceRole];
export const WORKSPACE_ROLES = Object.values(WorkspaceRole) as WorkspaceRole[];

export const RiskLevel = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' } as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export const ToolCategory = { READ: 'READ', WRITE: 'WRITE', HIGH_RISK: 'HIGH_RISK' } as const;
export type ToolCategory = (typeof ToolCategory)[keyof typeof ToolCategory];

export const ApprovalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  EXPIRED: 'EXPIRED',
  SUPERSEDED: 'SUPERSEDED',
  EXECUTED: 'EXECUTED',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const TaskPriority = { LOW: 'LOW', NORMAL: 'NORMAL', HIGH: 'HIGH', URGENT: 'URGENT' } as const;
export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];

export const ExecutionEventType = {
  TASK_ACCEPTED: 'TASK_ACCEPTED',
  TASK_QUEUED: 'TASK_QUEUED',
  CONTEXT_RETRIEVED: 'CONTEXT_RETRIEVED',
  MODEL_REQUEST_STARTED: 'MODEL_REQUEST_STARTED',
  MODEL_RESPONSE_RECEIVED: 'MODEL_RESPONSE_RECEIVED',
  TOOL_REQUESTED: 'TOOL_REQUESTED',
  TOOL_AUTHORIZED: 'TOOL_AUTHORIZED',
  TOOL_DENIED: 'TOOL_DENIED',
  TOOL_EXECUTED: 'TOOL_EXECUTED',
  TOOL_FAILED: 'TOOL_FAILED',
  APPROVAL_REQUESTED: 'APPROVAL_REQUESTED',
  APPROVAL_GRANTED: 'APPROVAL_GRANTED',
  APPROVAL_REJECTED: 'APPROVAL_REJECTED',
  APPROVAL_CHANGES_REQUESTED: 'APPROVAL_CHANGES_REQUESTED',
  PROGRESS: 'PROGRESS',
  RETRY_PERFORMED: 'RETRY_PERFORMED',
  ARTIFACT_GENERATED: 'ARTIFACT_GENERATED',
  BUDGET_WARNING: 'BUDGET_WARNING',
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  TASK_PAUSED: 'TASK_PAUSED',
  TASK_RESUMED: 'TASK_RESUMED',
  TASK_COMPLETED: 'TASK_COMPLETED',
  TASK_FAILED: 'TASK_FAILED',
  TASK_CANCELLED: 'TASK_CANCELLED',
  TASK_TIMED_OUT: 'TASK_TIMED_OUT',
  WORKER_RECOVERED: 'WORKER_RECOVERED',
} as const;
export type ExecutionEventType = (typeof ExecutionEventType)[keyof typeof ExecutionEventType];

export const EventLevel = { INFO: 'INFO', SUCCESS: 'SUCCESS', WARNING: 'WARNING', ERROR: 'ERROR' } as const;
export type EventLevel = (typeof EventLevel)[keyof typeof EventLevel];

export const FailureClass = {
  TRANSIENT: 'TRANSIENT',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  PERMANENT: 'PERMANENT',
  PERMISSION: 'PERMISSION',
  BUDGET: 'BUDGET',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN',
} as const;
export type FailureClass = (typeof FailureClass)[keyof typeof FailureClass];

export const KnowledgeSourceType = { DOCUMENT: 'DOCUMENT', URL: 'URL', FOLDER: 'FOLDER', REPORT: 'REPORT', TEXT: 'TEXT' } as const;
export type KnowledgeSourceType = (typeof KnowledgeSourceType)[keyof typeof KnowledgeSourceType];
export const KnowledgeStatus = { PENDING: 'PENDING', PROCESSING: 'PROCESSING', READY: 'READY', FAILED: 'FAILED', REVOKED: 'REVOKED' } as const;
export type KnowledgeStatus = (typeof KnowledgeStatus)[keyof typeof KnowledgeStatus];

export const ArtifactType = { MARKDOWN: 'MARKDOWN', CSV: 'CSV', JSON: 'JSON', PDF: 'PDF', TEXT: 'TEXT', UPLOAD: 'UPLOAD' } as const;
export type ArtifactType = (typeof ArtifactType)[keyof typeof ArtifactType];

export const WorkflowNodeType = {
  START: 'START',
  AGENT: 'AGENT',
  PROMPT: 'PROMPT',
  TOOL: 'TOOL',
  CONDITION: 'CONDITION',
  APPROVAL: 'APPROVAL',
  PARALLEL: 'PARALLEL',
  MERGE: 'MERGE',
  DELAY: 'DELAY',
  HUMAN_TASK: 'HUMAN_TASK',
  END: 'END',
} as const;
export type WorkflowNodeType = (typeof WorkflowNodeType)[keyof typeof WorkflowNodeType];
export const WORKFLOW_NODE_TYPES = Object.values(WorkflowNodeType) as WorkflowNodeType[];

export const WorkflowExecutionStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  WAITING: 'WAITING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type WorkflowExecutionStatus = (typeof WorkflowExecutionStatus)[keyof typeof WorkflowExecutionStatus];

export const NodeExecutionStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  WAITING: 'WAITING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type NodeExecutionStatus = (typeof NodeExecutionStatus)[keyof typeof NodeExecutionStatus];

export const AI_PROVIDERS = ['anthropic', 'openai', 'mock'] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

export const NotificationType = {
  TASK_COMPLETED: 'TASK_COMPLETED',
  TASK_FAILED: 'TASK_FAILED',
  APPROVAL_REQUESTED: 'APPROVAL_REQUESTED',
  APPROVAL_DECIDED: 'APPROVAL_DECIDED',
  BUDGET_WARNING: 'BUDGET_WARNING',
  HUMAN_TASK: 'HUMAN_TASK',
  WORKFLOW_COMPLETED: 'WORKFLOW_COMPLETED',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
