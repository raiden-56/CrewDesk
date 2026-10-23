import { z, type ZodType } from 'zod';
import {
  ApprovalDecisionSchema,
  BudgetPolicySchema,
  CreateAgentSchema,
  CreateKnowledgeSchema,
  CreateProjectSchema,
  CreateTaskSchema,
  CreateWorkflowSchema,
  ExecuteWorkflowSchema,
  IntegrationSchema,
  InviteMemberSchema,
  LoginSchema,
  RegisterSchema,
  SendMessageSchema,
  UpdateAgentSchema,
  UpdateWorkflowSchema,
} from '@collabspace/shared';

type Op = { summary: string; tags: string[]; body?: ZodType; params?: string[]; query?: string[]; auth?: boolean };

const schema = (s: ZodType) => z.toJSONSchema(s, { unrepresentable: 'any' });

const ops: Record<string, Partial<Record<'get' | 'post' | 'patch' | 'delete', Op>>> = {
  '/health': { get: { summary: 'Service health and configuration status', tags: ['System'], auth: false } },
  '/auth/register': { post: { summary: 'Register a user (creates a workspace unless invited)', tags: ['Auth'], body: RegisterSchema, auth: false } },
  '/auth/login': { post: { summary: 'Login with email and password', tags: ['Auth'], body: LoginSchema, auth: false } },
  '/auth/logout': { post: { summary: 'Logout', tags: ['Auth'] } },
  '/auth/me': { get: { summary: 'Current user and workspaces', tags: ['Auth'] }, patch: { summary: 'Update profile / theme preference', tags: ['Auth'] } },
  '/auth/forgot-password': { post: { summary: 'Request a password reset', tags: ['Auth'], auth: false } },
  '/auth/reset-password': { post: { summary: 'Reset password with token', tags: ['Auth'], auth: false } },
  '/workspaces': { get: { summary: 'List my workspaces', tags: ['Workspaces'] } },
  '/workspaces/{id}': { patch: { summary: 'Update workspace settings', tags: ['Workspaces'], params: ['id'] } },
  '/workspaces/{id}/members': { get: { summary: 'List members and invites', tags: ['Workspaces'], params: ['id'] }, post: { summary: 'Invite a member', tags: ['Workspaces'], params: ['id'], body: InviteMemberSchema } },
  '/workspaces/{id}/projects': { get: { summary: 'List projects', tags: ['Workspaces'], params: ['id'] }, post: { summary: 'Create project', tags: ['Workspaces'], params: ['id'], body: CreateProjectSchema } },
  '/workspaces/{id}/budgets': { get: { summary: 'List budget policies', tags: ['Workspaces'], params: ['id'] }, post: { summary: 'Create/update budget policy', tags: ['Workspaces'], params: ['id'], body: BudgetPolicySchema } },
  '/agents': { get: { summary: 'List agents', tags: ['Agents'], query: ['page', 'pageSize', 'category', 'status', 'projectId', 'search', 'availability'] }, post: { summary: 'Create agent', tags: ['Agents'], body: CreateAgentSchema } },
  '/agents/templates': { get: { summary: 'Built-in role templates', tags: ['Agents'] } },
  '/agents/validate': { post: { summary: 'Validate an agent configuration', tags: ['Agents'], body: UpdateAgentSchema } },
  '/agents/test': { post: { summary: 'Run a sandboxed test prompt against a draft configuration', tags: ['Agents'] } },
  '/agents/{id}': { get: { summary: 'Get agent', tags: ['Agents'], params: ['id'] }, patch: { summary: 'Update agent (creates a new version)', tags: ['Agents'], params: ['id'], body: UpdateAgentSchema }, delete: { summary: 'Delete archived agent', tags: ['Agents'], params: ['id'] } },
  '/agents/{id}/versions': { get: { summary: 'Version history', tags: ['Agents'], params: ['id'] } },
  '/agents/{id}/duplicate': { post: { summary: 'Duplicate agent', tags: ['Agents'], params: ['id'] } },
  '/agents/{id}/pause': { post: { summary: 'Pause agent', tags: ['Agents'], params: ['id'] } },
  '/agents/{id}/resume': { post: { summary: 'Resume agent', tags: ['Agents'], params: ['id'] } },
  '/agents/{id}/archive': { post: { summary: 'Archive agent', tags: ['Agents'], params: ['id'] } },
  '/agent-tasks': { get: { summary: 'List tasks', tags: ['Tasks'], query: ['page', 'pageSize', 'status', 'agentId', 'projectId', 'search', 'sort', 'order'] }, post: { summary: 'Create and queue a task', tags: ['Tasks'], body: CreateTaskSchema } },
  '/agent-tasks/bulk-cancel': { post: { summary: 'Cancel several tasks', tags: ['Tasks'] } },
  '/agent-tasks/{id}': { get: { summary: 'Get task', tags: ['Tasks'], params: ['id'] } },
  '/agent-tasks/{id}/cancel': { post: { summary: 'Cancel task', tags: ['Tasks'], params: ['id'] } },
  '/agent-tasks/{id}/retry': { post: { summary: 'Retry failed task', tags: ['Tasks'], params: ['id'] } },
  '/agent-tasks/{id}/duplicate': { post: { summary: 'Duplicate task as draft', tags: ['Tasks'], params: ['id'] } },
  '/agent-tasks/{id}/publish': { post: { summary: 'Publish a draft task', tags: ['Tasks'], params: ['id'] } },
  '/agent-tasks/{id}/events': { get: { summary: 'Execution timeline (json or csv export)', tags: ['Tasks'], params: ['id'], query: ['search', 'type', 'level', 'format'] } },
  '/agent-tasks/{id}/artifacts': { get: { summary: 'Artifacts produced by the task', tags: ['Tasks'], params: ['id'] } },
  '/agent-tasks/{id}/invocations': { get: { summary: 'Tool invocations of the task', tags: ['Tasks'], params: ['id'] } },
  '/approvals': { get: { summary: 'List approval requests', tags: ['Approvals'], query: ['status', 'page', 'pageSize'] } },
  '/approvals/{id}': { get: { summary: 'Get approval request', tags: ['Approvals'], params: ['id'] } },
  '/approvals/{id}/approve': { post: { summary: 'Approve the exact proposal version', tags: ['Approvals'], params: ['id'], body: ApprovalDecisionSchema } },
  '/approvals/{id}/reject': { post: { summary: 'Reject', tags: ['Approvals'], params: ['id'], body: ApprovalDecisionSchema } },
  '/approvals/{id}/request-changes': { post: { summary: 'Request changes', tags: ['Approvals'], params: ['id'], body: ApprovalDecisionSchema } },
  '/workflows': { get: { summary: 'List workflows', tags: ['Workflows'] }, post: { summary: 'Create workflow', tags: ['Workflows'], body: CreateWorkflowSchema } },
  '/workflows/templates': { get: { summary: 'Workflow templates', tags: ['Workflows'] } },
  '/workflows/executions/{executionId}': { get: { summary: 'Get execution with node logs', tags: ['Workflows'], params: ['executionId'] } },
  '/workflows/{id}': { get: { summary: 'Get workflow', tags: ['Workflows'], params: ['id'] }, patch: { summary: 'Update workflow (new version)', tags: ['Workflows'], params: ['id'], body: UpdateWorkflowSchema }, delete: { summary: 'Archive workflow', tags: ['Workflows'], params: ['id'] } },
  '/workflows/{id}/validate': { post: { summary: 'Validate graph', tags: ['Workflows'], params: ['id'] } },
  '/workflows/{id}/dry-run': { post: { summary: 'Dry run (no side effects)', tags: ['Workflows'], params: ['id'], body: ExecuteWorkflowSchema } },
  '/workflows/{id}/execute': { post: { summary: 'Execute workflow', tags: ['Workflows'], params: ['id'], body: ExecuteWorkflowSchema } },
  '/workflows/{id}/executions': { get: { summary: 'Execution history', tags: ['Workflows'], params: ['id'] } },
  '/workflows/{id}/versions': { get: { summary: 'Version history', tags: ['Workflows'], params: ['id'] } },
  '/workflows/{id}/duplicate': { post: { summary: 'Duplicate workflow', tags: ['Workflows'], params: ['id'] } },
  '/knowledge-sources': { get: { summary: 'List knowledge sources', tags: ['Knowledge'] }, post: { summary: 'Add URL or text source', tags: ['Knowledge'], body: CreateKnowledgeSchema } },
  '/knowledge-sources/upload': { post: { summary: 'Upload a document (multipart/form-data: file, projectId?, agentIds?)', tags: ['Knowledge'] } },
  '/knowledge-sources/search': { get: { summary: 'Search indexed content', tags: ['Knowledge'], query: ['q', 'limit'] } },
  '/knowledge-sources/{id}': { delete: { summary: 'Revoke or delete source (?hard=true)', tags: ['Knowledge'], params: ['id'] } },
  '/knowledge-sources/{id}/reindex': { post: { summary: 'Re-index source', tags: ['Knowledge'], params: ['id'] } },
  '/knowledge-sources/{id}/agents': { post: { summary: 'Assign source to agents', tags: ['Knowledge'], params: ['id'] } },
  '/artifacts': { get: { summary: 'List artifacts', tags: ['Artifacts'], query: ['page', 'pageSize', 'taskId', 'agentId', 'type', 'search'] }, post: { summary: 'Upload an artifact (multipart/form-data: file)', tags: ['Artifacts'] } },
  '/artifacts/{id}': { get: { summary: 'Artifact metadata', tags: ['Artifacts'], params: ['id'] }, delete: { summary: 'Delete artifact', tags: ['Artifacts'], params: ['id'] } },
  '/artifacts/{id}/download': { get: { summary: 'Download artifact file', tags: ['Artifacts'], params: ['id'] } },
  '/artifacts/{id}/preview': { get: { summary: 'Text preview', tags: ['Artifacts'], params: ['id'] } },
  '/artifacts/{id}/duplicate': { post: { summary: 'Duplicate artifact', tags: ['Artifacts'], params: ['id'] } },
  '/conversations': { get: { summary: 'List my conversations', tags: ['Conversations'] }, post: { summary: 'Get or create a conversation with an agent', tags: ['Conversations'] } },
  '/conversations/{id}/messages': { get: { summary: 'List messages', tags: ['Conversations'], params: ['id'] }, post: { summary: 'Send a message (reply generated by the worker)', tags: ['Conversations'], params: ['id'], body: SendMessageSchema } },
  '/conversations/{id}/messages/{messageId}/retry': { post: { summary: 'Regenerate an agent reply', tags: ['Conversations'], params: ['id', 'messageId'] } },
  '/usage': { get: { summary: 'Usage summary', tags: ['Usage'], query: ['period', 'projectId', 'agentId'] } },
  '/usage/agents': { get: { summary: 'Usage by agent', tags: ['Usage'], query: ['period'] } },
  '/usage/dashboard': { get: { summary: 'Dashboard metrics', tags: ['Usage'], query: ['period'] } },
  '/audit-logs': { get: { summary: 'Audit log', tags: ['Audit'], query: ['page', 'pageSize', 'action', 'actorId', 'resourceType', 'search'] } },
  '/notifications': { get: { summary: 'My notifications', tags: ['Notifications'] } },
  '/notifications/read-all': { post: { summary: 'Mark all read', tags: ['Notifications'] } },
  '/notifications/{id}/read': { post: { summary: 'Mark read', tags: ['Notifications'], params: ['id'] } },
  '/integrations': { get: { summary: 'List integrations (secrets never returned)', tags: ['Integrations'] }, post: { summary: 'Create/update integration', tags: ['Integrations'], body: IntegrationSchema } },
  '/integrations/{id}/check': { post: { summary: 'Verify integration connectivity', tags: ['Integrations'], params: ['id'] } },
  '/integrations/{id}': { delete: { summary: 'Remove integration', tags: ['Integrations'], params: ['id'] } },
  '/tools': { get: { summary: 'Tool registry with availability for this workspace', tags: ['Tools'] } },
};

export function buildOpenApiDocument() {
  const paths: Record<string, unknown> = {};
  for (const [path, methods] of Object.entries(ops)) {
    const entry: Record<string, unknown> = {};
    for (const [method, op] of Object.entries(methods)) {
      if (!op) continue;
      entry[method] = {
        summary: op.summary,
        tags: op.tags,
        security: op.auth === false ? [] : [{ cookieAuth: [] }],
        parameters: [
          ...(op.params ?? []).map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
          ...(op.query ?? []).map((name) => ({ name, in: 'query', required: false, schema: { type: 'string' } })),
          ...(op.auth === false ? [] : [{ name: 'X-Workspace-Id', in: 'header', required: false, schema: { type: 'string' }, description: 'Active workspace (defaults to first membership)' }]),
        ],
        ...(op.body ? { requestBody: { required: true, content: { 'application/json': { schema: schema(op.body) } } } } : {}),
        responses: {
          '200': { description: 'Success' },
          '400': { description: 'Bad request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '401': { description: 'Unauthorized' },
          '403': { description: 'Forbidden' },
          '404': { description: 'Not found' },
          '409': { description: 'Conflict / invalid state transition' },
          '422': { description: 'Validation error' },
          '429': { description: 'Rate limited' },
        },
      };
    }
    paths[path] = entry;
  }
  return {
    openapi: '3.1.0',
    info: { title: 'CollabSpace AI Team API', version: '1.0.0', description: 'REST API for managing AI digital team members, tasks, approvals, workflows and knowledge. All state-changing requests require the `X-Requested-With: XMLHttpRequest` header (CSRF protection) and a session cookie.' },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'csai_session' } },
      schemas: { Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {}, requestId: { type: 'string' } } } } } },
    },
    paths,
  };
}
