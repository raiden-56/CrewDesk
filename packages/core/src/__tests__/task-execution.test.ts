import { beforeAll, describe, expect, it } from 'vitest';
import { CreateTaskSchema } from '@collabspace/shared';
import { createTask, executeTask, prisma, requestCancel } from '../index.js';
import { createTestAgent, createWorkspace } from './fixtures.js';

const run = (taskId: string) => executeTask(taskId, { workerId: 'test-worker', resume: false });

describe('task execution with the mock provider', () => {
  let workspaceId: string;
  let ownerId: string;
  let agentId: string;

  beforeAll(async () => {
    ({ workspaceId, ownerId } = await createWorkspace());
    agentId = (await createTestAgent(workspaceId, ownerId)).id;
  });

  it('runs a task to completion, records events, usage and a report artifact', async () => {
    const { task } = await createTask(workspaceId, ownerId, CreateTaskSchema.parse({ agentId, title: 'Compare storage vendors', description: 'Write a short report.' }));
    expect(task.status).toBe('QUEUED');

    expect(await run(task.id)).toBe('completed');

    const done = await prisma.agentTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(done.status).toBe('COMPLETED');
    expect(done.progress).toBe(100);
    expect(done.resultContent).toBeTruthy();
    const types = (await prisma.executionEvent.findMany({ where: { taskId: task.id }, orderBy: { sequence: 'asc' } })).map((e) => e.type);
    expect(types).toContain('TASK_ACCEPTED');
    expect(types).toContain('MODEL_REQUEST_STARTED');
    expect(types).toContain('TOOL_EXECUTED');
    expect(types).toContain('ARTIFACT_GENERATED');
    expect(types.at(-1)).toBe('TASK_COMPLETED');
    expect(await prisma.artifact.count({ where: { taskId: task.id } })).toBeGreaterThan(0);
    expect(await prisma.usageRecord.count({ where: { taskId: task.id } })).toBeGreaterThan(0);
  });

  it('fails permanently once retries are exhausted', async () => {
    const { task } = await createTask(workspaceId, ownerId, CreateTaskSchema.parse({ agentId, title: 'Always failing [mock:fail]', description: '[mock:fail]' }), { maxAttempts: 1 });
    expect(await run(task.id)).toBe('failed');
    const failed = await prisma.agentTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.errorMessage).toBeTruthy();
  });

  it('honours cancellation requested before a worker picks the task up', async () => {
    const { task } = await createTask(workspaceId, ownerId, CreateTaskSchema.parse({ agentId, title: 'Cancel me' }));
    await requestCancel(task.id, ownerId);
    const after = await prisma.agentTask.findUniqueOrThrow({ where: { id: task.id } });
    if (after.status === 'QUEUED') expect(await run(task.id)).toBe('cancelled');
    expect((await prisma.agentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('CANCELLED');
  });

  it('never lets a task allowlist widen the agent tool grants', async () => {
    const { task } = await createTask(workspaceId, ownerId, CreateTaskSchema.parse({ agentId, title: 'Sneaky', allowedTools: ['resource.delete', 'report.generate'] }));
    expect(task.allowedTools).toEqual(['report.generate']);
  });
});
