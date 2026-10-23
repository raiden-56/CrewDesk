import { Handle, Position, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { Bot, Clock, Flag, GitBranch, GitMerge, Play, ShieldCheck, Split, Sparkles, User, Wrench, type LucideIcon } from 'lucide-react';
import type { WorkflowGraph, WorkflowNodeData, WorkflowNodeType } from '@collabspace/shared';

export const NODE_META: Record<WorkflowNodeType, { label: string; icon: LucideIcon; description: string; color: string }> = {
  START: { label: 'Start', icon: Play, description: 'Entry point; receives the run input', color: 'var(--cs-success)' },
  AGENT: { label: 'Agent task', icon: Bot, description: 'An AI team member runs a task with its tools and approvals', color: 'var(--cs-primary)' },
  PROMPT: { label: 'Prompt', icon: Sparkles, description: 'Render a text template from previous outputs', color: 'var(--cs-accent)' },
  TOOL: { label: 'Tool', icon: Wrench, description: 'Call a read-only tool directly', color: 'var(--cs-info)' },
  CONDITION: { label: 'Condition', icon: GitBranch, description: 'Branch on an expression (true / false)', color: 'var(--cs-warning)' },
  APPROVAL: { label: 'Approval', icon: ShieldCheck, description: 'Pause until a human approves', color: 'var(--cs-warning)' },
  PARALLEL: { label: 'Parallel', icon: Split, description: 'Run branches at the same time', color: 'var(--cs-accent)' },
  MERGE: { label: 'Merge', icon: GitMerge, description: 'Wait for all incoming branches', color: 'var(--cs-accent)' },
  DELAY: { label: 'Delay', icon: Clock, description: 'Wait for a fixed duration', color: 'var(--cs-text-3)' },
  HUMAN_TASK: { label: 'Human task', icon: User, description: 'A person completes a step and adds a note', color: 'var(--cs-info)' },
  END: { label: 'End', icon: Flag, description: 'Finishes the run', color: 'var(--cs-danger)' },
};

const STATUS_RING: Record<string, string> = {
  RUNNING: 'var(--cs-primary)',
  WAITING: 'var(--cs-warning)',
  COMPLETED: 'var(--cs-success)',
  FAILED: 'var(--cs-danger)',
  SKIPPED: 'var(--cs-border-strong)',
  PENDING: 'var(--cs-border)',
};

export type CsNodeData = WorkflowNodeData & {
  nodeType: WorkflowNodeType;
  /** execution view: node status */
  status?: string;
  /** editor view: has a validation error */
  invalid?: boolean;
  subtitle?: string;
};
export type CsNode = Node<CsNodeData, 'cs'>;

export function CsFlowNode({ data, selected }: NodeProps<CsNode>) {
  const meta = NODE_META[data.nodeType];
  const Icon = meta.icon;
  const ring = data.status ? STATUS_RING[data.status] : data.invalid ? 'var(--cs-danger)' : selected ? 'var(--cs-primary)' : 'var(--cs-border)';
  return (
    <div
      className={`relative rounded-xl bg-surface shadow-sm px-3 py-2 min-w-[170px] max-w-[220px] ${data.status === 'RUNNING' ? 'animate-pulse' : ''}`}
      style={{ border: `2px solid ${ring}`, opacity: data.status === 'SKIPPED' ? 0.55 : 1 }}
      data-testid={`flow-node-${data.nodeType}`}
    >
      {data.nodeType !== 'START' && <Handle type="target" position={Position.Left} />}
      <div className="flex items-center gap-2">
        <span className="h-6 w-6 rounded-md flex items-center justify-center text-white shrink-0" style={{ background: meta.color }}><Icon size={13} /></span>
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold truncate text-text">{data.label || meta.label}</div>
          <div className="text-[10.5px] text-text-3 truncate">{data.status ? data.status.toLowerCase() : data.subtitle ?? meta.label}</div>
        </div>
      </div>
      {data.nodeType === 'CONDITION' ? (
        <>
          <Handle type="source" id="true" position={Position.Right} style={{ top: '35%', background: 'var(--cs-success)' }} />
          <Handle type="source" id="false" position={Position.Right} style={{ top: '75%', background: 'var(--cs-danger)' }} />
          <div className="absolute -right-9 text-[9.5px] text-text-3" style={{ top: '22%' }}>true</div>
          <div className="absolute -right-9 text-[9.5px] text-text-3" style={{ top: '62%' }}>false</div>
        </>
      ) : (
        data.nodeType !== 'END' && <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
}

export const nodeTypes = { cs: CsFlowNode };

export function graphToFlow(graph: WorkflowGraph, decorate?: (id: string) => Partial<CsNodeData>): { nodes: CsNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({ id: n.id, type: 'cs', position: n.position, data: { ...n.data, nodeType: n.type as WorkflowNodeType, ...decorate?.(n.id) }, deletable: n.type !== 'START' })),
    edges: graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, label: e.label ?? (e.sourceHandle === 'true' || e.sourceHandle === 'false' ? e.sourceHandle : undefined) })),
  };
}

export function flowToGraph(nodes: CsNode[], edges: Edge[], base?: WorkflowGraph): WorkflowGraph {
  return {
    nodes: nodes.map((n) => {
      const { nodeType, status: _s, invalid: _i, subtitle: _t, ...data } = n.data;
      void _s;
      void _i;
      void _t;
      const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== '')) as WorkflowNodeData;
      return { id: n.id, type: nodeType, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: clean };
    }),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, ...(typeof e.label === 'string' && e.label ? { label: e.label } : {}) })),
    ...(base?.inputSchema ? { inputSchema: base.inputSchema } : {}),
    ...(base?.outputSchema ? { outputSchema: base.outputSchema } : {}),
  };
}
