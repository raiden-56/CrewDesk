import { beforeAll, describe, expect, it } from 'vitest';
import { CreateTaskSchema } from '@collabspace/shared';
import { createTask, decideApproval, executeTask, prisma } from '../index.js';
import { addMember, createTestAgent, createWorkspace } from './fixtures.js';

/** Runs a task that asks for docs.update (a write tool that requires approval) and returns the pending approval. */
async function taskAwaitingApproval(workspaceId: string, ownerId: string, agentId: string) {
  const { task } = await createTask(workspaceId, ownerId, CreateTaskSchema.parse({ agentId, title: 'Draft and update [mock:docs-update]', description: '[mock:docs-update]' }));
  expect(await executeTask(task.id, { workerId: 'test-worker', resume: false })).toBe('paused');
  expect((await prisma.agentTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('WAITING_APPROVAL');
  const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { taskId: task.id, status: 'PENDING' } });
  return { taskId: task.id, approval };
}

describe('human approval of sensitive tool calls', () => {
  let workspaceId: string;
  let ownerId: string;
  let agentId: string;

  beforeAll(async () => {
    ({ workspaceId, ownerId } = await createWorkspace());
    agentId = (await createTestAgent(workspaceId, ownerId, 'DOCUMENTATION', ['report.generate', 'docs.update'])).id;
  });

  const decide = (approvalId: string, userId: string, userRole: 'OWNER' | 'VIEWER' | 'APPROVER', proposalVersion: number, decision: 'APPROVED' | 'REJECTED' = 'APPROVED') =>
    decideApproval({ approvalId, workspaceId, userId, userRole, decision, proposalVersion, comment: 'test' });

  it('pauses the task, then executes exactly the approved action after approval', async () => {
    const { taskId, approval } = await taskAwaitingApproval(workspaceId, ownerId, agentId);
    expect(approval.toolId).toBe('docs.update');
    expect(approval.diff).toBeTruthy();

    const decided = await decide(approval.id, ownerId, 'OWNER', approval.proposalVersion);
    expect(decided.status).toBe('APPROVED');
    expect((await prisma.agentTask.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('QUEUED');

    expect(await executeTask(taskId, { workerId: 'test-worker', resume: true })).toBe('completed');
    const types = (await prisma.executionEvent.findMany({ where: { taskId } })).map((e) => e.type);
    expect(types).toContain('APPROVAL_GRANTED');
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe('EXECUTED');
  });

  it('rejects stale proposal versions, unauthorised roles, tampered proposals and double decisions', async () => {
    const { approval } = await taskAwaitingApproval(workspaceId, ownerId, agentId);
    await expect(decide(approval.id, ownerId, 'OWNER', approval.proposalVersion + 1)).rejects.toThrow(/changed/);

    const viewerId = await addMember(workspaceId, 'VIEWER');
    await expect(decide(approval.id, viewerId, 'VIEWER', approval.proposalVersion)).rejects.toThrow(/cannot decide/);

    const original = approval.proposal;
    await prisma.approvalRequest.update({ where: { id: approval.id }, data: { proposal: { ...(original as object), injected: true } } });
    await expect(decide(approval.id, ownerId, 'OWNER', approval.proposalVersion)).rejects.toThrow(/integrity/);
    await prisma.approvalRequest.update({ where: { id: approval.id }, data: { proposal: original as object } });

    const approverId = await addMember(workspaceId, 'APPROVER');
    expect((await decide(approval.id, approverId, 'APPROVER', approval.proposalVersion, 'REJECTED')).status).toBe('REJECTED');
    await expect(decide(approval.id, ownerId, 'OWNER', approval.proposalVersion)).rejects.toThrow(/already/);
  });
});
