import { afterEach, describe, expect, it } from 'vitest';
import { TASK_STATUSES, type TaskDto, type WorkflowDto } from '@collabspace/shared';
import { handleGuestRequest } from './mockApi';
import { endGuestSession, GUEST_MODE_AVAILABLE, isGuestActive } from './session';

const get = async <T = Record<string, unknown>>(path: string) => {
  const res = await handleGuestRequest('GET', path, undefined);
  expect(res.status, path).toBe(200);
  return res.data as T;
};

afterEach(() => endGuestSession());

describe('guest mode mock API', () => {
  it('is inert unless the build enables it', () => {
    expect(GUEST_MODE_AVAILABLE).toBe(false);
    expect(isGuestActive()).toBe(false);
  });

  it('serves non-empty data for every main screen', async () => {
    const lists = ['/agents?pageSize=100', '/agent-tasks', '/approvals', '/workflows', '/knowledge-sources', '/artifacts', '/audit-logs', '/notifications', '/integrations', '/tools', '/workspaces/ws_demo/projects', '/workspaces/ws_demo/budgets', '/conversations'];
    for (const path of lists) {
      const data = await get<{ items: unknown[] }>(path);
      expect(data.items.length, path).toBeGreaterThan(0);
    }
    const members = await get<{ members: unknown[] }>('/workspaces/ws_demo/members');
    expect(members.members.length).toBeGreaterThan(3);
    const dash = await get<{ totalAgents: number; trends: { labels: string[] } }>('/usage/dashboard?period=7d');
    expect(dash.totalAgents).toBeGreaterThan(0);
    expect(dash.trends.labels).toHaveLength(7);
    const usage = await get<{ daily: unknown[]; byAgent: unknown[]; budgets: unknown[] }>('/usage?period=30d');
    expect(usage.daily).toHaveLength(30);
    expect(usage.byAgent.length).toBeGreaterThan(0);
    expect(usage.budgets.length).toBeGreaterThan(0);
    expect((await get<{ ok: boolean }>('/health')).ok).toBe(true);
    expect((await get<{ user: { id: string } }>('/auth/me')).user.id).toBe('u_guest');
  });

  it('covers every task status and links detail endpoints', async () => {
    const tasks = await get<{ items: TaskDto[] }>('/agent-tasks?pageSize=100');
    for (const status of TASK_STATUSES) expect(tasks.items.some((t) => t.status === status), status).toBe(true);
    const done = tasks.items.find((t) => t.status === 'COMPLETED' && t.artifactCount > 0)!;
    expect((await get<{ items: unknown[] }>(`/agent-tasks/${done.id}/events`)).items.length).toBeGreaterThan(3);
    expect((await get<{ items: unknown[] }>(`/agent-tasks/${done.id}/artifacts`)).items.length).toBeGreaterThan(0);
    const agentId = done.agentId;
    expect((await get<{ items: unknown[] }>(`/agents/${agentId}/activity`)).items.length).toBeGreaterThan(0);
    expect((await get<{ items: unknown[] }>(`/agents/${agentId}/versions`)).items.length).toBeGreaterThan(0);
  });

  it('ships workflows whose graphs validate and whose runs reference real nodes', async () => {
    const { items } = await get<{ items: WorkflowDto[] }>('/workflows');
    for (const wf of items) {
      const res = await handleGuestRequest('POST', `/workflows/${wf.id}/validate`, {});
      expect((res.data as { valid: boolean; issues: unknown[] }).valid, `${wf.name}: ${JSON.stringify((res.data as { issues: unknown[] }).issues)}`).toBe(true);
      const runs = await get<{ items: Array<{ nodes: Array<{ nodeId: string }> }> }>(`/workflows/${wf.id}/executions`);
      expect(runs.items.length).toBeGreaterThan(0);
      for (const run of runs.items) for (const n of run.nodes) expect(wf.graph.nodes.some((g) => g.id === n.nodeId)).toBe(true);
    }
  });

  it('applies writes to the in-memory state and resets when the session ends', async () => {
    const created = await handleGuestRequest('POST', '/agent-tasks', { title: 'Guest smoke task', agentId: 'a_nova', asDraft: true });
    expect(created.status).toBe(201);
    const id = (created.data as TaskDto).id;
    expect((await get<TaskDto>(`/agent-tasks/${id}`)).status).toBe('DRAFT');
    const invalid = await handleGuestRequest('POST', '/agent-tasks', { title: 'x', agentId: 'a_nova' });
    expect(invalid.status).toBe(400);
    endGuestSession();
    expect((await handleGuestRequest('GET', `/agent-tasks/${id}`, undefined)).status).toBe(404);
  });

  it('dry-runs a workflow synchronously', async () => {
    const res = await handleGuestRequest('POST', '/workflows/wf_triage/dry-run', { input: { subject: 'Printer on fire', customer: 'Acme' }, dryRun: true });
    const ex = res.data as { status: string; nodes: Array<{ status: string }> };
    expect(ex.status).toBe('COMPLETED');
    expect(ex.nodes.some((n) => n.status === 'SKIPPED')).toBe(true);
  });

  it('answers unknown endpoints with an empty payload and serves downloads as files', async () => {
    expect((await handleGuestRequest('GET', '/does-not-exist', undefined)).data).toMatchObject({ items: [] });
    expect((await handleGuestRequest('POST', '/does-not-exist', {})).data).toEqual({ ok: true });
    const file = await handleGuestRequest('GET', '/artifacts/ar_2/download', undefined);
    expect(file.raw?.contentType).toBe('text/csv');
    expect(file.raw?.body).toContain('Notewise');
  });
});
