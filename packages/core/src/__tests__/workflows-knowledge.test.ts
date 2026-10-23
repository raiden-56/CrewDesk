import { beforeAll, describe, expect, it } from 'vitest';
import type { WorkflowGraph } from '@collabspace/shared';
import { createTextSource, createWorkflow, executeWorkflow, ingestKnowledgeSource, prisma, revokeSource, searchKnowledge, validateWorkflow } from '../index.js';
import { createTestAgent, createWorkspace } from './fixtures.js';

describe('workflows', () => {
  let workspaceId: string;
  let ownerId: string;
  let graph: WorkflowGraph;

  beforeAll(async () => {
    ({ workspaceId, ownerId } = await createWorkspace());
    const agent = await createTestAgent(workspaceId, ownerId);
    graph = {
      nodes: [
        { id: 'start', type: 'START', position: { x: 0, y: 0 }, data: {} },
        { id: 'research', type: 'AGENT', position: { x: 200, y: 0 }, data: { agentId: agent.id, taskTitle: 'Research {{input.topic}}', instructions: 'Research {{input.topic}}' } },
        { id: 'check', type: 'CONDITION', position: { x: 400, y: 0 }, data: { expression: 'input.topic == "storage"' } },
        { id: 'approve', type: 'APPROVAL', position: { x: 600, y: -80 }, data: { approvalTitle: 'Publish?', risk: 'LOW' } },
        { id: 'end', type: 'END', position: { x: 800, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'research' },
        { id: 'e2', source: 'research', target: 'check' },
        { id: 'e3', source: 'check', target: 'approve', sourceHandle: 'true' },
        { id: 'e4', source: 'check', target: 'end', sourceHandle: 'false' },
        { id: 'e5', source: 'approve', target: 'end' },
      ],
    };
  });

  it('validates structure and referenced agents', async () => {
    expect((await validateWorkflow(workspaceId, graph)).valid).toBe(true);
    const broken: WorkflowGraph = { ...graph, edges: graph.edges.filter((e) => e.id !== 'e4') };
    const result = await validateWorkflow(workspaceId, broken);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.nodeId === 'check')).toBe(true);
  });

  it('dry-runs synchronously, following the condition branch and creating no tasks', async () => {
    const wf = await createWorkflow(workspaceId, ownerId, { name: 'Dry run test', description: '', projectId: null, graph });
    const ex = await executeWorkflow(workspaceId, wf.id, ownerId, { topic: 'storage' }, true);
    expect(ex.status).toBe('COMPLETED');
    const byNode = Object.fromEntries(ex.nodes.map((n) => [n.nodeId, n.status]));
    expect(byNode).toMatchObject({ start: 'COMPLETED', research: 'COMPLETED', check: 'COMPLETED', approve: 'COMPLETED', end: 'COMPLETED' });
    expect(await prisma.agentTask.count({ where: { workflowExecutionId: ex.id } })).toBe(0);

    const other = await executeWorkflow(workspaceId, wf.id, ownerId, { topic: 'other' }, true);
    expect(other.nodes.find((n) => n.nodeId === 'approve')?.status).toBe('SKIPPED');
  });

  it('refuses to execute an invalid workflow', async () => {
    const wf = await createWorkflow(workspaceId, ownerId, { name: 'Invalid', description: '', projectId: null, graph: { nodes: [graph.nodes[0]!], edges: [] } });
    await expect(executeWorkflow(workspaceId, wf.id, ownerId, {}, true)).rejects.toThrow(/invalid/i);
  });
});

describe('knowledge ingestion and retrieval', () => {
  it('indexes text sources, retrieves them, and drops revoked sources from results', async () => {
    const { workspaceId, ownerId } = await createWorkspace();
    const created = await createTextSource(workspaceId, ownerId, { title: 'Retention policy', content: 'Invoices from Fabrikam are retained for seven years in archival storage.', projectId: null, agentIds: [] });
    const sourceId = (created as { id: string }).id;
    await ingestKnowledgeSource(sourceId);
    const source = await prisma.knowledgeSource.findUniqueOrThrow({ where: { id: sourceId } });
    expect(source.status).toBe('READY');

    const hits = await searchKnowledge({ workspaceId, sourceIds: [sourceId], query: 'Fabrikam invoices retained', limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.sourceId).toBe(sourceId);

    await revokeSource(workspaceId, sourceId, ownerId, false);
    expect((await prisma.knowledgeSource.findUniqueOrThrow({ where: { id: sourceId } })).status).toBe('REVOKED');
  });
});
