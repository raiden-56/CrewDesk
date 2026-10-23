import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  AgentDto,
  AgentVersionDto,
  ApprovalDto,
  ArtifactDto,
  AuditLogDto,
  ConversationDto,
  DashboardMetricsDto,
  ExecutionEventDto,
  KnowledgeSourceDto,
  MessageDto,
  NotificationDto,
  Paginated,
  ProjectDto,
  TaskDto,
  ToolSummary,
  UsageSummaryDto,
  WorkflowDto,
  WorkflowExecutionDto,
  IntegrationDto,
  WorkspaceDto,
  UserDto,
} from '@collabspace/shared';
import { api } from './api';
import { useAuthStore } from '@/store/auth';

export type ApprovalWithPermission = ApprovalDto & { canDecide: boolean };
export type ToolWithAvailability = ToolSummary & { available: boolean; unavailableReason: string | null; grantedAgents: number };
export interface HealthDto {
  ok: boolean;
  aiProvider: { configured: boolean; provider: string | null; reason: string | null; isMock: boolean; defaultModel: string | null; models: Array<{ id: string; label: string; provider: string }>; embeddings: boolean };
  storage: { driver: string; ok: boolean; message: string | null };
  checks: Record<string, { ok: boolean; message: string | null }>;
}

const ws = () => useAuthStore.getState().workspaceId ?? 'none';

export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: () => api.get<HealthDto>('/health'), staleTime: 60_000 });
}

export function useDashboard(period: '24h' | '7d' | '30d' = '7d') {
  return useQuery({ queryKey: ['dashboard', ws(), period], queryFn: () => api.get<DashboardMetricsDto>('/usage/dashboard', { period }), refetchInterval: 30_000 });
}

export function useAgents(params: Record<string, string | number | boolean | undefined> = {}) {
  return useQuery({ queryKey: ['agents', ws(), params], queryFn: () => api.get<Paginated<AgentDto>>('/agents', { pageSize: 100, ...params }), placeholderData: keepPreviousData });
}
export function useAgent(id: string | null | undefined) {
  return useQuery({ queryKey: ['agent', id], queryFn: () => api.get<AgentDto>(`/agents/${id}`), enabled: Boolean(id) });
}
export function useAgentVersions(id: string | null | undefined) {
  return useQuery({ queryKey: ['agent-versions', id], queryFn: () => api.get<{ items: AgentVersionDto[] }>(`/agents/${id}/versions`), enabled: Boolean(id) });
}
export function useAgentActivity(id: string | null | undefined) {
  return useQuery({ queryKey: ['agent-activity', id], queryFn: () => api.get<{ items: Array<{ id: string; taskId: string; taskTitle: string; type: string; level: string; message: string; createdAt: string; durationMs: number | null }> }>(`/agents/${id}/activity`), enabled: Boolean(id), refetchInterval: 15_000 });
}

export function useTasks(params: Record<string, string | number | boolean | undefined> = {}) {
  return useQuery({ queryKey: ['tasks', ws(), params], queryFn: () => api.get<Paginated<TaskDto>>('/agent-tasks', params), placeholderData: keepPreviousData, refetchInterval: 20_000 });
}
export function useTask(id: string | null | undefined) {
  return useQuery({ queryKey: ['task', id], queryFn: () => api.get<TaskDto>(`/agent-tasks/${id}`), enabled: Boolean(id) });
}
export function useTaskEvents(id: string | null | undefined, params: Record<string, string | undefined> = {}) {
  return useQuery({ queryKey: ['task-events', id, params], queryFn: () => api.get<{ items: ExecutionEventDto[]; includeDiagnostics: boolean }>(`/agent-tasks/${id}/events`, params), enabled: Boolean(id) });
}
export function useTaskArtifacts(id: string | null | undefined) {
  return useQuery({ queryKey: ['artifacts', 'task', id], queryFn: () => api.get<{ items: ArtifactDto[] }>(`/agent-tasks/${id}/artifacts`), enabled: Boolean(id) });
}

export function useApprovals(params: Record<string, string | number | undefined> = {}) {
  return useQuery({ queryKey: ['approvals', ws(), params], queryFn: () => api.get<Paginated<ApprovalWithPermission> & { pending: number }>('/approvals', params), placeholderData: keepPreviousData, refetchInterval: 30_000 });
}
export function useApproval(id: string | null | undefined) {
  return useQuery({ queryKey: ['approval', id], queryFn: () => api.get<ApprovalWithPermission>(`/approvals/${id}`), enabled: Boolean(id) });
}

export function useWorkflows() {
  return useQuery({ queryKey: ['workflows', ws()], queryFn: () => api.get<{ items: WorkflowDto[] }>('/workflows') });
}
export function useWorkflow(id: string | null | undefined) {
  return useQuery({ queryKey: ['workflow', id], queryFn: () => api.get<WorkflowDto>(`/workflows/${id}`), enabled: Boolean(id) });
}
export function useWorkflowExecutions(id: string | null | undefined) {
  return useQuery({ queryKey: ['workflow-executions', id], queryFn: () => api.get<{ items: WorkflowExecutionDto[] }>(`/workflows/${id}/executions`), enabled: Boolean(id) });
}
export function useWorkflowExecution(id: string | null | undefined) {
  return useQuery({ queryKey: ['workflow-execution', id], queryFn: () => api.get<WorkflowExecutionDto>(`/workflows/executions/${id}`), enabled: Boolean(id), refetchInterval: (q) => (q.state.data && ['RUNNING', 'WAITING', 'PENDING'].includes(q.state.data.status) ? 5000 : false) });
}

export function useKnowledge(params: Record<string, string | number | undefined> = {}) {
  return useQuery({ queryKey: ['knowledge', ws(), params], queryFn: () => api.get<Paginated<KnowledgeSourceDto>>('/knowledge-sources', { pageSize: 100, ...params }), placeholderData: keepPreviousData });
}
export function useArtifacts(params: Record<string, string | number | undefined> = {}) {
  return useQuery({ queryKey: ['artifacts', ws(), params], queryFn: () => api.get<Paginated<ArtifactDto>>('/artifacts', params), placeholderData: keepPreviousData });
}
export function useUsage(params: { period: '24h' | '7d' | '30d'; projectId?: string; agentId?: string }) {
  return useQuery({ queryKey: ['usage', ws(), params], queryFn: () => api.get<UsageSummaryDto>('/usage', params) });
}
export function useAuditLogs(params: Record<string, string | number | undefined> = {}) {
  return useQuery({ queryKey: ['audit', ws(), params], queryFn: () => api.get<Paginated<AuditLogDto>>('/audit-logs', params), placeholderData: keepPreviousData });
}
export function useNotifications() {
  const status = useAuthStore((s) => s.status);
  return useQuery({ queryKey: ['notifications', ws()], queryFn: () => api.get<{ items: NotificationDto[]; unread: number }>('/notifications'), enabled: status === 'authenticated', refetchInterval: 60_000 });
}
export function useIntegrations() {
  return useQuery({ queryKey: ['integrations', ws()], queryFn: () => api.get<{ items: IntegrationDto[]; available: Array<{ provider: string; name: string; description: string; secretLabel: string; tools: string[] }> }>('/integrations') });
}
export function useTools() {
  return useQuery({ queryKey: ['tools', ws()], queryFn: () => api.get<{ items: ToolWithAvailability[]; groups: Array<{ label: string; description: string; category: string }> }>('/tools'), staleTime: 60_000 });
}
export function useProjects() {
  const workspaceId = useAuthStore((s) => s.workspaceId);
  return useQuery({ queryKey: ['projects', workspaceId], queryFn: () => api.get<{ items: ProjectDto[] }>(`/workspaces/${workspaceId}/projects`), enabled: Boolean(workspaceId) });
}
export function useMembers() {
  const workspaceId = useAuthStore((s) => s.workspaceId);
  return useQuery({ queryKey: ['members', workspaceId], queryFn: () => api.get<{ members: Array<{ id: string; userId: string; name: string; email: string; role: string; joinedAt: string }>; invites: Array<{ id: string; email: string; role: string; createdAt: string }> }>(`/workspaces/${workspaceId}/members`), enabled: Boolean(workspaceId) });
}
export function useBudgets() {
  const workspaceId = useAuthStore((s) => s.workspaceId);
  return useQuery({ queryKey: ['budgets', workspaceId], queryFn: () => api.get<{ items: Array<{ id: string; scope: string; scopeId: string | null; period: string; hardLimitUsd: number | null; warningRatio: number; maxTokens: number | null; enabled: boolean }> }>(`/workspaces/${workspaceId}/budgets`), enabled: Boolean(workspaceId) });
}
export function useConversation(agentId: string | null | undefined, projectId: string | null = null) {
  return useQuery({ queryKey: ['conversation', ws(), agentId, projectId], queryFn: () => api.post<ConversationDto>('/conversations', { agentId, projectId }), enabled: Boolean(agentId) });
}
export function useMessages(conversationId: string | null | undefined) {
  return useQuery({ queryKey: ['messages', conversationId], queryFn: () => api.get<{ items: MessageDto[] }>(`/conversations/${conversationId}/messages`), enabled: Boolean(conversationId) });
}

/** Generic mutation helper that invalidates the given query keys on success. */
export function useInvalidatingMutation<TVars, TData = unknown>(fn: (vars: TVars) => Promise<TData>, keys: string[][]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const k of keys) void qc.invalidateQueries({ queryKey: k });
    },
  });
}

export async function fetchMe(): Promise<{ user: UserDto; workspaces: WorkspaceDto[] }> {
  return api.get('/auth/me');
}
