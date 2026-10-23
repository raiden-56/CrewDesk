import { describe, expect, it } from 'vitest';
import { validateWorkflowGraph, type WorkflowGraph } from '../workflow/validate.js';

const linear: WorkflowGraph = {
  nodes: [
    { id: 'start', type: 'START', position: { x: 0, y: 0 }, data: {} },
    { id: 'a1', type: 'AGENT', position: { x: 0, y: 0 }, data: { agentId: 'agent-1', instructions: 'Research' } },
    { id: 'end', type: 'END', position: { x: 0, y: 0 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'a1' },
    { id: 'e2', source: 'a1', target: 'end' },
  ],
};

describe('workflow graph validation', () => {
  it('accepts a valid linear workflow and returns topological order', () => {
    const r = validateWorkflowGraph(linear);
    expect(r.valid).toBe(true);
    expect(r.order).toEqual(['start', 'a1', 'end']);
  });

  it('rejects cycles', () => {
    const g: WorkflowGraph = { ...linear, edges: [...linear.edges, { id: 'e3', source: 'a1', target: 'a1' }] };
    const r = validateWorkflowGraph(g);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.message.includes('self loop') || i.message.includes('cycle'))).toBe(true);
  });

  it('rejects a cycle through multiple nodes', () => {
    const g: WorkflowGraph = {
      nodes: [
        ...linear.nodes,
        { id: 'p1', type: 'PROMPT', position: { x: 0, y: 0 }, data: { template: 'x' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'a1' },
        { id: 'e2', source: 'a1', target: 'p1' },
        { id: 'e3', source: 'p1', target: 'a1' },
      ],
    };
    const r = validateWorkflowGraph(g);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.message.includes('cycle'))).toBe(true);
  });

  it('requires exactly one start and reachable end', () => {
    const r = validateWorkflowGraph({ nodes: [{ id: 'end', type: 'END', position: { x: 0, y: 0 }, data: {} }], edges: [] });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.message.includes('exactly one Start'))).toBe(true);
  });

  it('requires both branches on condition nodes', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'start', type: 'START', position: { x: 0, y: 0 }, data: {} },
        { id: 'c', type: 'CONDITION', position: { x: 0, y: 0 }, data: { expression: 'input.ok' } },
        { id: 'end', type: 'END', position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'c' },
        { id: 'e2', source: 'c', target: 'end', sourceHandle: 'true' },
      ],
    };
    const r = validateWorkflowGraph(g);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.nodeId === 'c')).toBe(true);
  });

  it('bounds parallel fan-out', () => {
    const branches = Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, type: 'PROMPT', position: { x: 0, y: 0 }, data: { template: 't' } }));
    const g: WorkflowGraph = {
      nodes: [
        { id: 'start', type: 'START', position: { x: 0, y: 0 }, data: {} },
        { id: 'par', type: 'PARALLEL', position: { x: 0, y: 0 }, data: {} },
        { id: 'merge', type: 'MERGE', position: { x: 0, y: 0 }, data: {} },
        { id: 'end', type: 'END', position: { x: 0, y: 0 }, data: {} },
        ...branches,
      ],
      edges: [
        { id: 'e0', source: 'start', target: 'par' },
        ...branches.map((b, i) => ({ id: `pe${i}`, source: 'par', target: b.id })),
        ...branches.map((b, i) => ({ id: `me${i}`, source: b.id, target: 'merge' })),
        { id: 'ee', source: 'merge', target: 'end' },
      ],
    };
    const r = validateWorkflowGraph(g);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.message.includes('fan-out'))).toBe(true);
  });

  it('flags unreachable nodes', () => {
    const g: WorkflowGraph = { ...linear, nodes: [...linear.nodes, { id: 'orphan', type: 'PROMPT', position: { x: 0, y: 0 }, data: { template: 'x' } }] };
    const r = validateWorkflowGraph(g);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.nodeId === 'orphan' && i.message.includes('not reachable'))).toBe(true);
  });
});
