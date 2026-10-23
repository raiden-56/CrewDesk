import type { WorkspaceRole, RiskLevel } from './enums.js';

export const Permission = {
  WORKSPACE_MANAGE: 'workspace.manage',
  MEMBERS_MANAGE: 'members.manage',
  AGENT_VIEW: 'agent.view',
  AGENT_CREATE: 'agent.create',
  AGENT_EDIT: 'agent.edit',
  AGENT_DELETE: 'agent.delete',
  AGENT_MODEL_CONFIGURE: 'agent.model.configure',
  TASK_VIEW: 'task.view',
  TASK_CREATE: 'task.create',
  TASK_CANCEL: 'task.cancel',
  TASK_RETRY: 'task.retry',
  APPROVAL_VIEW: 'approval.view',
  APPROVAL_DECIDE: 'approval.decide',
  APPROVAL_DECIDE_HIGH_RISK: 'approval.decide.highRisk',
  WORKFLOW_VIEW: 'workflow.view',
  WORKFLOW_EDIT: 'workflow.edit',
  WORKFLOW_EXECUTE: 'workflow.execute',
  KNOWLEDGE_VIEW: 'knowledge.view',
  KNOWLEDGE_MANAGE: 'knowledge.manage',
  ARTIFACT_VIEW: 'artifact.view',
  ARTIFACT_DELETE: 'artifact.delete',
  USAGE_VIEW: 'usage.view',
  AUDIT_VIEW: 'audit.view',
  AUDIT_VIEW_DIAGNOSTICS: 'audit.view.diagnostics',
  INTEGRATION_MANAGE: 'integration.manage',
  BUDGET_MANAGE: 'budget.manage',
  CHAT: 'chat.use',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const ALL = Object.values(Permission) as Permission[];
const VIEW: Permission[] = [
  'agent.view',
  'task.view',
  'approval.view',
  'workflow.view',
  'knowledge.view',
  'artifact.view',
  'usage.view',
  'audit.view',
];

export const ROLE_PERMISSIONS: Record<WorkspaceRole, readonly Permission[]> = {
  OWNER: ALL,
  ADMIN: ALL.filter((p) => p !== 'workspace.manage'),
  AGENT_MANAGER: [
    ...VIEW,
    'agent.create',
    'agent.edit',
    'agent.delete',
    'task.create',
    'task.cancel',
    'task.retry',
    'workflow.edit',
    'workflow.execute',
    'knowledge.manage',
    'chat.use',
    'artifact.delete',
  ],
  TASK_OPERATOR: [...VIEW, 'task.create', 'task.cancel', 'task.retry', 'workflow.execute', 'chat.use'],
  APPROVER: [...VIEW, 'approval.decide', 'approval.decide.highRisk', 'chat.use'],
  VIEWER: VIEW,
};

export function roleHasPermission(role: WorkspaceRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/** Which roles may approve a request of a given risk level. */
export function canApproveRisk(role: WorkspaceRole, risk: RiskLevel): boolean {
  if (risk === 'CRITICAL') return role === 'OWNER' || role === 'ADMIN';
  if (risk === 'HIGH') return roleHasPermission(role, 'approval.decide.highRisk');
  return roleHasPermission(role, 'approval.decide');
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  OWNER: 'Workspace Owner',
  ADMIN: 'Workspace Admin',
  AGENT_MANAGER: 'Agent Manager',
  TASK_OPERATOR: 'Task Operator',
  APPROVER: 'Approver',
  VIEWER: 'Viewer',
};
