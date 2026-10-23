import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from '@collabspace/shared';
import { flowToGraph, graphToFlow } from './flow';

const graph: WorkflowGraph = {
  nodes: [
    { id: 'start', type: 'START', position: { x: 0, y: 0 }, data: { label: 'Start' } },
    { id: 'check', type: 'CONDITION', position: { x: 200.4, y: 10.6 }, data: { label: 'Check', expression: 'input.ok == true' } },
    { id: 'end', type: 'END', position: { x: 400, y: 0 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'check', sourceHandle: null },
    { id: 'e2', source: 'check', target: 'end', sourceHandle: 'true', label: 'true' },
    { id: 'e3', source: 'check', target: 'end', sourceHandle: 'false', label: 'false' },
  ],
  inputSchema: { ok: 'boolean' },
};

describe('workflow graph <-> React Flow conversion', () => {
  it('round-trips a graph, rounding positions and keeping the input schema', () => {
    const { nodes, edges } = graphToFlow(graph);
    const back = flowToGraph(nodes, edges, graph);
    expect(back.nodes.map((n) => n.type)).toEqual(['START', 'CONDITION', 'END']);
    expect(back.nodes[1]!.position).toEqual({ x: 200, y: 11 });
    expect(back.nodes[1]!.data).toEqual({ label: 'Check', expression: 'input.ok == true' });
    expect(back.edges.map((e) => e.sourceHandle)).toEqual([null, 'true', 'false']);
    expect(back.inputSchema).toEqual({ ok: 'boolean' });
  });

  it('strips view-only decoration and empty fields before saving', () => {
    const { nodes, edges } = graphToFlow(graph, () => ({ status: 'RUNNING', invalid: true }));
    nodes[2]!.data = { ...nodes[2]!.data, label: '' };
    const back = flowToGraph(nodes, edges);
    for (const n of back.nodes) {
      expect(n.data).not.toHaveProperty('status');
      expect(n.data).not.toHaveProperty('invalid');
      expect(n.data).not.toHaveProperty('nodeType');
    }
    expect(back.nodes[2]!.data).toEqual({});
  });

  it('prevents deleting the start node on the canvas', () => {
    const { nodes } = graphToFlow(graph);
    expect(nodes.find((n) => n.id === 'start')!.deletable).toBe(false);
    expect(nodes.find((n) => n.id === 'check')!.deletable).toBe(true);
  });
});
