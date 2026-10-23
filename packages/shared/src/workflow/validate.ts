import { z } from 'zod';
import { WorkflowNodeType } from '../enums.js';

export const WorkflowNodeDataSchema = z.object({
  label: z.string().max(120).optional(),
  // AGENT
  agentId: z.string().optional(),
  taskTitle: z.string().max(200).optional(),
  instructions: z.string().max(20000).optional(),
  // PROMPT
  template: z.string().max(20000).optional(),
  // TOOL
  toolId: z.string().optional(),
  toolInput: z.record(z.string(), z.unknown()).optional(),
  // CONDITION
  expression: z.string().max(2000).optional(),
  // APPROVAL
  approvalTitle: z.string().max(200).optional(),
  risk: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  // DELAY
  delayMs: z.number().int().min(0).max(7 * 24 * 3600 * 1000).optional(),
  // HUMAN_TASK
  assigneeUserId: z.string().optional(),
  // common
  retries: z.number().int().min(0).max(5).optional(),
  timeoutMs: z.number().int().min(1000).max(24 * 3600 * 1000).optional(),
  onError: z.enum(['FAIL', 'CONTINUE']).optional(),
});
export type WorkflowNodeData = z.infer<typeof WorkflowNodeDataSchema>;

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(Object.values(WorkflowNodeType) as [string, ...string[]]),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  data: WorkflowNodeDataSchema.default({}),
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
  id: z.string().min(1).max(64),
  source: z.string().min(1),
  target: z.string().min(1),
  /** for CONDITION nodes: 'true' | 'false'; otherwise undefined */
  sourceHandle: z.string().nullable().optional(),
  label: z.string().max(60).optional(),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowGraphSchema = z.object({
  nodes: z.array(WorkflowNodeSchema).max(200),
  edges: z.array(WorkflowEdgeSchema).max(400),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
});
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

export interface WorkflowValidationIssue {
  level: 'error' | 'warning';
  nodeId?: string;
  edgeId?: string;
  message: string;
}
export interface WorkflowValidationResult {
  valid: boolean;
  issues: WorkflowValidationIssue[];
  /** topological order when the graph is acyclic */
  order: string[];
}

export const MAX_PARALLEL_FANOUT = 10;

/**
 * Validates workflow structure: exactly one START, at least one END, every node reachable,
 * no cycles (infinite loop protection), bounded fan-out, and per-type configuration.
 */
export function validateWorkflowGraph(graph: WorkflowGraph): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];
  const nodes = graph.nodes;
  const edges = graph.edges;
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) issues.push({ level: 'error', nodeId: n.id, message: `Duplicate node id ${n.id}` });
    ids.add(n.id);
  }
  const starts = nodes.filter((n) => n.type === 'START');
  const ends = nodes.filter((n) => n.type === 'END');
  if (starts.length !== 1) issues.push({ level: 'error', message: `Workflow must have exactly one Start node (found ${starts.length})` });
  if (ends.length < 1) issues.push({ level: 'error', message: 'Workflow must have at least one End node' });

  const outgoing = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, WorkflowEdge[]>();
  for (const e of edges) {
    if (!ids.has(e.source)) issues.push({ level: 'error', edgeId: e.id, message: `Edge ${e.id} references missing source ${e.source}` });
    if (!ids.has(e.target)) issues.push({ level: 'error', edgeId: e.id, message: `Edge ${e.id} references missing target ${e.target}` });
    if (e.source === e.target) issues.push({ level: 'error', edgeId: e.id, message: `Edge ${e.id} is a self loop` });
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e]);
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);
  }

  for (const n of nodes) {
    const out = outgoing.get(n.id) ?? [];
    const inn = incoming.get(n.id) ?? [];
    switch (n.type) {
      case 'START':
        if (inn.length > 0) issues.push({ level: 'error', nodeId: n.id, message: 'Start node cannot have incoming edges' });
        if (out.length === 0) issues.push({ level: 'error', nodeId: n.id, message: 'Start node must connect to another node' });
        break;
      case 'END':
        if (out.length > 0) issues.push({ level: 'error', nodeId: n.id, message: 'End node cannot have outgoing edges' });
        if (inn.length === 0) issues.push({ level: 'warning', nodeId: n.id, message: 'End node is not reachable' });
        break;
      case 'AGENT':
        if (!n.data.agentId) issues.push({ level: 'error', nodeId: n.id, message: 'Agent node must select an agent' });
        if (!n.data.instructions && !n.data.taskTitle) issues.push({ level: 'warning', nodeId: n.id, message: 'Agent node has no instructions; it will receive the previous node output only' });
        if (out.length === 0) issues.push({ level: 'error', nodeId: n.id, message: 'Agent node must have an outgoing edge' });
        break;
      case 'PROMPT':
        if (!n.data.template) issues.push({ level: 'error', nodeId: n.id, message: 'Prompt node needs a template' });
        if (out.length === 0) issues.push({ level: 'error', nodeId: n.id, message: 'Prompt node must have an outgoing edge' });
        break;
      case 'TOOL':
        if (!n.data.toolId) issues.push({ level: 'error', nodeId: n.id, message: 'Tool node must select a tool' });
        if (out.length === 0) issues.push({ level: 'error', nodeId: n.id, message: 'Tool node must have an outgoing edge' });
        break;
      case 'CONDITION': {
        if (!n.data.expression) issues.push({ level: 'error', nodeId: n.id, message: 'Condition node needs an expression' });
        const handles = new Set(out.map((e) => e.sourceHandle ?? ''));
        if (!handles.has('true') || !handles.has('false')) issues.push({ level: 'error', nodeId: n.id, message: 'Condition node needs both a "true" and a "false" branch' });
        break;
      }
      case 'APPROVAL':
        if (out.length === 0) issues.push({ level: 'error', nodeId: n.id, message: 'Approval node must have an outgoing edge' });
        break;
      case 'PARALLEL':
        if (out.length < 2) issues.push({ level: 'error', nodeId: n.id, message: 'Parallel node needs at least two branches' });
        if (out.length > MAX_PARALLEL_FANOUT) issues.push({ level: 'error', nodeId: n.id, message: `Parallel node fan-out exceeds ${MAX_PARALLEL_FANOUT}` });
        break;
      case 'MERGE':
        if (inn.length < 2) issues.push({ level: 'error', nodeId: n.id, message: 'Merge node needs at least two incoming branches' });
        if (out.length === 0) issues.push({ level: 'error', nodeId: n.id, message: 'Merge node must have an outgoing edge' });
        break;
      case 'DELAY':
        if (n.data.delayMs === undefined) issues.push({ level: 'error', nodeId: n.id, message: 'Delay node needs a duration' });
        if (out.length === 0) issues.push({ level: 'error', nodeId: n.id, message: 'Delay node must have an outgoing edge' });
        break;
      case 'HUMAN_TASK':
        if (out.length === 0) issues.push({ level: 'error', nodeId: n.id, message: 'Human task node must have an outgoing edge' });
        break;
      default:
        issues.push({ level: 'error', nodeId: n.id, message: `Unknown node type ${n.type}` });
    }
    if (n.type !== 'START' && n.type !== 'END' && out.length > 1 && n.type !== 'PARALLEL' && n.type !== 'CONDITION') {
      issues.push({ level: 'error', nodeId: n.id, message: 'Only Parallel and Condition nodes may have multiple outgoing edges' });
    }
  }

  // reachability from start
  const start = starts[0];
  const reachable = new Set<string>();
  if (start) {
    const stack = [start.id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (reachable.has(cur)) continue;
      reachable.add(cur);
      for (const e of outgoing.get(cur) ?? []) stack.push(e.target);
    }
    for (const n of nodes) {
      if (!reachable.has(n.id)) issues.push({ level: 'error', nodeId: n.id, message: `Node ${n.data.label ?? n.id} is not reachable from Start` });
    }
  }

  // cycle detection via Kahn's algorithm
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n.id, 0);
  for (const e of edges) if (ids.has(e.target)) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of outgoing.get(id) ?? []) {
      const d = (indeg.get(e.target) ?? 0) - 1;
      indeg.set(e.target, d);
      if (d === 0) queue.push(e.target);
    }
  }
  if (order.length !== nodes.length) issues.push({ level: 'error', message: 'Workflow contains a cycle. Loops are not allowed.' });

  return { valid: !issues.some((i) => i.level === 'error'), issues, order };
}
