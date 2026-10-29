import {
  AGENT_TEMPLATES,
  estimateCostUsd,
  type AgentCategory,
  type AgentDto,
  type AgentStatus,
  type AgentVersionDto,
  type ApprovalDto,
  type ArtifactDto,
  type ArtifactType,
  type AuditLogDto,
  type ConversationDto,
  type ExecutionEventDto,
  type IntegrationDto,
  type KnowledgeSourceDto,
  type MessageDto,
  type ModelConfig,
  type NodeExecutionStatus,
  type NotificationDto,
  type ProjectDto,
  type TaskDto,
  type TaskPriority,
  type TaskStatus,
  type UserDto,
  type WorkflowDto,
  type WorkflowExecutionDto,
  type WorkflowExecutionStatus,
  type WorkflowGraph,
  type WorkspaceDto,
  type WorkspaceRole,
} from '@collabspace/shared';
import { GUEST_USER, GUEST_WORKSPACES, GUEST_WORKSPACE_ID } from './session';

/** In-memory database behind the guest mock API. Rebuilt on every page load (nothing persists). */
export interface GuestMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
}
export interface GuestBudget {
  id: string;
  scope: 'WORKSPACE' | 'AGENT' | 'PROJECT';
  scopeId: string | null;
  period: 'DAILY' | 'MONTHLY' | 'TOTAL';
  hardLimitUsd: number | null;
  warningRatio: number;
  maxTokens: number | null;
  enabled: boolean;
}
export interface GuestWorkflowVersion {
  id: string;
  version: number;
  changeSummary: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  graph: WorkflowGraph;
}
export type GuestArtifact = ArtifactDto & { content: string };

export interface GuestDb {
  user: UserDto;
  workspace: WorkspaceDto;
  projects: ProjectDto[];
  agents: AgentDto[];
  agentVersions: Record<string, AgentVersionDto[]>;
  tasks: TaskDto[];
  events: Record<string, ExecutionEventDto[]>;
  artifacts: GuestArtifact[];
  approvals: ApprovalDto[];
  workflows: WorkflowDto[];
  workflowVersions: Record<string, GuestWorkflowVersion[]>;
  executions: WorkflowExecutionDto[];
  knowledge: KnowledgeSourceDto[];
  conversations: ConversationDto[];
  messages: MessageDto[];
  notifications: NotificationDto[];
  audit: AuditLogDto[];
  members: GuestMember[];
  invites: Array<{ id: string; email: string; role: WorkspaceRole; createdAt: string }>;
  budgets: GuestBudget[];
  integrations: IntegrationDto[];
  disabledTools: Set<string>;
  seq: number;
}

// ------------------------------------------------------------------ helpers
const NOW = Date.now();
const MIN = 60_000;
export const ago = (minutes: number) => new Date(NOW - minutes * MIN).toISOString();
const later = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * MIN).toISOString();
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Small deterministic PRNG so the sample charts look the same on every visit. */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ME = { id: GUEST_USER.id, name: GUEST_USER.name };
const PRIYA = { id: 'u_priya', name: 'Priya Raman' };
const MARCO = { id: 'u_marco', name: 'Marco Silva' };
const LENA = { id: 'u_lena', name: 'Lena Fischer' };
const SAM = { id: 'u_sam', name: 'Sam Okafor' };

// ----------------------------------------------------------------- projects
const P_LAUNCH = { id: 'p_launch', name: 'Q4 Product Launch' };
const P_SUPPORT = { id: 'p_support', name: 'Customer Support Revamp' };
const P_PLATFORM = { id: 'p_platform', name: 'Platform Reliability' };
const PROJECTS = { p_launch: P_LAUNCH, p_support: P_SUPPORT, p_platform: P_PLATFORM } as const;
type ProjectKey = keyof typeof PROJECTS;

// ------------------------------------------------------------------- agents
interface AgentSpec {
  id: string;
  name: string;
  category: AgentCategory;
  status: AgentStatus;
  project: ProjectKey | null;
  provider: 'anthropic' | 'openai';
  model: string;
  description: string;
  versions: string[];
  createdDaysAgo: number;
  lastError?: string;
  archived?: boolean;
  knowledge: string[];
  extraTools?: string[];
}

const AGENT_SPECS: AgentSpec[] = [
  { id: 'a_nova', name: 'Nova', category: 'RESEARCHER', status: 'ONLINE', project: 'p_launch', provider: 'anthropic', model: 'claude-sonnet-5-5', description: 'Market and competitor research with cited sources.', versions: ['Initial version', 'Added pricing-page sources', 'Tightened citation rules'], createdDaysAgo: 96, knowledge: ['k_prd', 'k_pricing', 'k_board'] },
  { id: 'a_atlas', name: 'Atlas', category: 'PROJECT_PLANNER', status: 'WORKING', project: 'p_launch', provider: 'anthropic', model: 'claude-sonnet-5-5', description: 'Turns launch goals into milestones, owners and risk logs.', versions: ['Initial version', 'Sprint length set to two weeks'], createdDaysAgo: 92, knowledge: ['k_prd'] },
  { id: 'a_quinn', name: 'Quinn', category: 'QA_REVIEWER', status: 'IDLE', project: 'p_platform', provider: 'anthropic', model: 'claude-haiku-5-5', description: 'Reviews plans, specs and research for gaps and inconsistencies.', versions: ['Initial version'], createdDaysAgo: 80, knowledge: ['k_prd', 'k_api'] },
  { id: 'a_scribe', name: 'Scribe', category: 'DOCUMENTATION', status: 'WORKING', project: 'p_launch', provider: 'anthropic', model: 'claude-sonnet-5-5', description: 'Writes release notes, FAQs and API docs in the brand voice.', versions: ['Initial version', 'Brand voice guidelines attached', 'Output format: changelog sections'], createdDaysAgo: 75, knowledge: ['k_brand', 'k_api'] },
  { id: 'a_iris', name: 'Iris', category: 'DATA_ANALYST', status: 'ONLINE', project: 'p_support', provider: 'openai', model: 'gpt-5', description: 'Analyzes ticket exports and KPIs; produces charts-ready tables.', versions: ['Initial version', 'Weekly KPI digest format'], createdDaysAgo: 60, knowledge: ['k_macros', 'k_board'], extraTools: ['message.send'] },
  { id: 'a_echo', name: 'Echo', category: 'CUSTOMER_SUPPORT', status: 'PAUSED', project: 'p_support', provider: 'anthropic', model: 'claude-haiku-5-5', description: 'Drafts empathetic, accurate replies to customer tickets.', versions: ['Initial version'], createdDaysAgo: 54, knowledge: ['k_macros', 'k_brand'] },
  { id: 'a_forge', name: 'Forge', category: 'CODE_ASSISTANT', status: 'ONLINE', project: 'p_platform', provider: 'anthropic', model: 'claude-opus-5-5', description: 'Reads repositories and opens draft pull requests for review.', versions: ['Initial version', 'GitHub PR drafts enabled'], createdDaysAgo: 41, knowledge: ['k_api'] },
  { id: 'a_sentinel', name: 'Sentinel', category: 'SECURITY_REVIEWER', status: 'OFFLINE', project: 'p_platform', provider: 'anthropic', model: 'claude-opus-5-5', description: 'Dependency, permission and configuration security reviews.', versions: ['Initial version'], createdDaysAgo: 33, lastError: 'Model request timed out after 3 attempts (600 s). The agent was taken offline until it is resumed.', knowledge: ['k_api'] },
  { id: 'a_relay', name: 'Relay', category: 'WORKFLOW_COORDINATOR', status: 'ARCHIVED', project: null, provider: 'anthropic', model: 'claude-haiku-5-5', description: 'Pilot coordinator replaced by the workflow engine.', versions: ['Initial version'], createdDaysAgo: 110, archived: true, knowledge: [] },
];

function modelConfig(spec: AgentSpec): ModelConfig {
  return { provider: spec.provider, model: spec.model, temperature: spec.category === 'DOCUMENTATION' ? 0.6 : 0.2, maxOutputTokens: 4096, timeoutMs: 600000, maxRetries: 2, maxTokensPerTask: 250000, budgetUsd: spec.model.includes('opus') ? 8 : 3 };
}

function buildAgents(): { agents: AgentDto[]; versions: Record<string, AgentVersionDto[]> } {
  const agents: AgentDto[] = [];
  const versions: Record<string, AgentVersionDto[]> = {};
  for (const spec of AGENT_SPECS) {
    const t = AGENT_TEMPLATES[spec.category];
    const tools = [...t.defaultTools, ...(spec.extraTools ?? [])];
    const created = ago(spec.createdDaysAgo * 24 * 60);
    const list: AgentVersionDto[] = spec.versions.map((summary, i) => ({
      id: `av_${spec.id}_${i + 1}`,
      version: i + 1,
      changeSummary: summary,
      createdAt: ago(spec.createdDaysAgo * 24 * 60 - i * 9 * 24 * 60),
      createdBy: i % 2 === 0 ? ME : MARCO,
      instructions: { ...t.instructions },
      modelConfig: modelConfig(spec),
      tools: i === 0 ? tools.slice(0, Math.max(2, tools.length - 1)) : tools,
    }));
    versions[spec.id] = [...list].reverse();
    const current = list[list.length - 1]!;
    agents.push({
      id: spec.id,
      workspaceId: GUEST_WORKSPACE_ID,
      projectId: spec.project,
      project: spec.project ? { ...PROJECTS[spec.project] } : null,
      name: spec.name,
      avatar: t.avatar,
      color: t.color,
      description: spec.description,
      category: spec.category,
      status: spec.status,
      currentVersion: current.version,
      currentVersionId: current.id,
      instructions: { ...t.instructions },
      modelConfig: modelConfig(spec),
      tools,
      knowledge: { sourceIds: spec.knowledge, allowWorkspaceKnowledge: spec.category === 'RESEARCHER', allowProjectDocuments: true, allowPreviousReports: spec.category !== 'CUSTOMER_SUPPORT' },
      currentTask: null,
      lastActivityAt: null,
      lastError: spec.lastError ?? null,
      stats: { totalTasks: 0, completedTasks: 0, failedTasks: 0, runningTasks: 0 },
      createdAt: created,
      updatedAt: current.createdAt,
      archivedAt: spec.archived ? ago(12 * 24 * 60) : null,
    });
  }
  return { agents, versions };
}

// -------------------------------------------------------------------- tasks
interface TaskSpec {
  id: string;
  agent: string;
  project: ProjectKey | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdMinAgo: number;
  runMinutes?: number;
  progress?: number;
  progressMessage?: string;
  tokensIn?: number;
  tokensOut?: number;
  tools?: number;
  result?: string;
  summary?: string;
  error?: string;
  failureClass?: string;
  attempt?: number;
  approvalId?: string;
  workflowExecutionId?: string;
  createdBy?: { id: string; name: string } | null;
  deliverable?: string;
  deadlineDays?: number;
}

const RESULT_COMPETITORS = `## Summary
Five AI meeting assistants were compared on pricing, integrations and data controls. Two (MeetMate and Notewise) lead on integrations; only Notewise offers regional data residency.

## Findings
| Product | Starting price | Calendar & chat integrations | Data residency | Source |
|---|---|---|---|---|
| MeetMate | $12 / seat | 14 | US only | Competitor pricing pages #3 |
| Notewise | $15 / seat | 11 | US, EU | Competitor pricing pages #1 |
| Recapify | $9 / seat | 6 | US only | Competitor pricing pages #4 |
| Huddle AI | Free tier, $18 Pro | 8 | Not stated | Competitor pricing pages #2 |
| Minutely | $10 / seat | 5 | EU | Competitor pricing pages #5 |

## Recommendations
1. Position our EU hosting option prominently: only one major competitor matches it.
2. Price the Team plan between $11 and $13 per seat.
3. Ship the Slack and Teams connectors before launch; integrations are the main differentiator.

## Open questions
- Huddle AI does not publish retention terms; a follow-up request is needed.`;

const RESULT_TICKETS = `## October ticket analysis
**4,812 tickets** (+9% vs September). Median first response **2h 14m** (target: 2h).

| Category | Tickets | Share | Trend |
|---|---|---|---|
| Billing & invoices | 1,377 | 28.6% | ▲ 14% |
| Login / SSO | 902 | 18.7% | ▲ 6% |
| Integrations | 744 | 15.5% | ▼ 3% |
| Bug reports | 691 | 14.4% | ▲ 2% |
| How-to | 1,098 | 22.8% | ▼ 5% |

### Drivers
- The billing spike follows the invoice template change on Oct 7 (412 tickets mention "VAT").
- SSO tickets cluster around Monday mornings, mostly Okta session expiry.

### Suggested actions
1. Add a VAT explainer macro and link it from invoices.
2. Raise the Okta session length guidance in the admin docs.`;

const RESULT_REPO = `## Repository health: crewdesk-api
- **Open PRs:** 23 (6 older than 30 days)
- **Default branch CI:** passing, median 7m 40s
- **Dependencies:** 4 minor updates available, no known critical advisories
- **Test coverage trend:** 71% → 74% over the last 60 days

### Hotspots
| Path | Changes (90d) | Open issues |
|---|---|---|
| src/billing/ | 48 | 7 |
| src/auth/sso/ | 31 | 4 |
| src/workers/retry.ts | 19 | 3 |

### Recommendation
Prioritise the retry/backoff refactor in \`src/workers/retry.ts\`: it appears in 3 of the last 5 incident reviews.`;

const RESULT_EU = `## EU AI Act: obligations relevant to our assistants
- Our assistants are **limited-risk** systems: transparency duties apply (users must know they interact with AI).
- Generated content shown to customers should be labelled.
- Keep human oversight for decisions with material effect on customers (already covered by approvals).

### Gaps found
1. Chat widget lacks an "AI assistant" disclosure.
2. Retention policy for conversation logs is not documented.

_Sources: Product requirements v2.0, Q3 board report._`;

function genericResult(title: string, agentName: string): string {
  return `## ${title}\n\n${agentName} completed this task using approved workspace sources.\n\n### Key points\n- Scope confirmed against the project brief.\n- Three follow-ups identified and drafted as task suggestions.\n- No sensitive actions were required.\n\n### Next steps\n1. Review the attached notes.\n2. Assign follow-ups to the relevant owners.`;
}

const TASK_SPECS: TaskSpec[] = [
  { id: 't_101', agent: 'a_nova', project: 'p_launch', title: 'Competitive analysis: AI meeting assistants', description: 'Compare the five leading AI meeting assistants on pricing, integrations and data controls. Use only approved sources and cite every claim.', status: 'COMPLETED', priority: 'HIGH', createdMinAgo: 2 * 1440 + 200, runMinutes: 9, tokensIn: 48210, tokensOut: 6120, tools: 7, result: RESULT_COMPETITORS, summary: 'Notewise is the only competitor with EU residency; recommend pricing the Team plan at $11–13/seat.', deliverable: 'Comparison table and recommendations' },
  { id: 't_102', agent: 'a_atlas', project: 'p_launch', title: 'Launch plan: milestones and owners for v2.0', description: 'Turn the v2.0 PRD into a milestone plan with owners, dependencies and a risk log. Target launch: end of quarter.', status: 'RUNNING', priority: 'HIGH', createdMinAgo: 14, progress: 62, progressMessage: 'Drafting milestone dependencies', tokensIn: 21890, tokensOut: 2410, tools: 4, deliverable: 'Milestone plan + risk log', deadlineDays: 3 },
  { id: 't_103', agent: 'a_scribe', project: 'p_launch', title: 'Release notes draft for v2.0', description: 'Draft customer-facing release notes for v2.0 from the merged PR summaries. Follow the brand voice guidelines.', status: 'RUNNING', priority: 'NORMAL', createdMinAgo: 6, progress: 35, progressMessage: 'Reading merged PR summaries', tokensIn: 9120, tokensOut: 640, tools: 2, deliverable: 'Markdown release notes' },
  { id: 't_104', agent: 'a_forge', project: 'p_platform', title: 'Open draft PR: rate-limit retry backoff', description: 'Implement exponential backoff with jitter in the retry worker and open a draft pull request for review.', status: 'WAITING_APPROVAL', priority: 'URGENT', createdMinAgo: 38, progress: 80, progressMessage: 'Waiting for approval: open draft pull request', tokensIn: 35400, tokensOut: 5230, tools: 5, approvalId: 'ap_1' },
  { id: 't_105', agent: 'a_quinn', project: 'p_launch', title: 'Review onboarding checklist for gaps', description: 'Review the new-customer onboarding checklist and flag missing steps, unclear owners and risky assumptions.', status: 'COMPLETED', priority: 'NORMAL', createdMinAgo: 1440 + 320, runMinutes: 4, tokensIn: 12880, tokensOut: 2210, tools: 3 },
  { id: 't_106', agent: 'a_iris', project: 'p_support', title: 'Analyze October support tickets', description: 'Analyze the October ticket export: volumes by category, response times, drivers of change and suggested actions.', status: 'COMPLETED', priority: 'HIGH', createdMinAgo: 3 * 1440 + 90, runMinutes: 6, tokensIn: 61200, tokensOut: 4980, tools: 6, result: RESULT_TICKETS, summary: 'Billing tickets up 14% after the invoice template change; VAT explainer macro recommended.' },
  { id: 't_107', agent: 'a_echo', project: 'p_support', title: 'Draft replies for top 20 billing tickets', description: 'Draft replies for the 20 oldest open billing tickets using the approved macros. Do not send anything.', status: 'PAUSED', priority: 'NORMAL', createdMinAgo: 190, progress: 45, progressMessage: 'Paused by Lena Fischer', tokensIn: 14210, tokensOut: 3900, tools: 4, createdBy: LENA },
  { id: 't_108', agent: 'a_sentinel', project: 'p_platform', title: 'Dependency vulnerability sweep', description: 'Scan the API and worker dependencies for known advisories and summarise the required upgrades.', status: 'FAILED', priority: 'HIGH', createdMinAgo: 5 * 60, runMinutes: 31, tokensIn: 18750, tokensOut: 0, tools: 2, attempt: 3, error: 'Model request timed out after 3 attempts (600 s).', failureClass: 'TIMEOUT' },
  { id: 't_109', agent: 'a_nova', project: 'p_launch', title: 'Summarize analyst reports on agentic workflows', description: 'Summarize the three analyst reports in the knowledge base on agentic workflow adoption.', status: 'QUEUED', priority: 'NORMAL', createdMinAgo: 3 },
  { id: 't_110', agent: 'a_atlas', project: 'p_support', title: 'Break down Support Revamp into sprint tasks', description: 'Create sprint-sized task drafts for the support revamp epic.', status: 'QUEUED', priority: 'LOW', createdMinAgo: 2, createdBy: MARCO },
  { id: 't_111', agent: 'a_scribe', project: 'p_platform', title: 'API reference: webhooks section', description: 'Write the webhooks section of the public API reference (events, retries, signatures).', status: 'DRAFT', priority: 'NORMAL', createdMinAgo: 50, deliverable: 'Markdown doc page' },
  { id: 't_112', agent: 'a_quinn', project: 'p_platform', title: 'Regression review for billing service', description: 'Review the billing service changes since the last release for regression risk.', status: 'CANCELLED', priority: 'NORMAL', createdMinAgo: 1440 + 30, runMinutes: 2, tokensIn: 4100, tokensOut: 300, tools: 1, error: 'Cancelled by Guest Owner', failureClass: 'CANCELLED' },
  { id: 't_113', agent: 'a_iris', project: 'p_support', title: 'Forecast Q1 ticket volume', description: 'Forecast weekly ticket volume for Q1 using the last 18 months of exports.', status: 'TIMED_OUT', priority: 'LOW', createdMinAgo: 2 * 1440 + 60, runMinutes: 10, tokensIn: 72100, tokensOut: 1200, tools: 3, error: 'Task exceeded its 10 minute timeout.', failureClass: 'TIMEOUT' },
  { id: 't_114', agent: 'a_forge', project: 'p_platform', title: 'Repository health report: crewdesk-api', description: 'Produce a repository health report: open PRs, CI, dependencies, coverage and hotspots.', status: 'COMPLETED', priority: 'NORMAL', createdMinAgo: 4 * 1440 + 120, runMinutes: 7, tokensIn: 52300, tokensOut: 3880, tools: 6, result: RESULT_REPO, summary: 'CI healthy; retry worker is the main hotspot.' },
  { id: 't_115', agent: 'a_scribe', project: 'p_support', title: 'Customer FAQ refresh', description: 'Refresh the top 15 FAQ answers to match the new billing flow.', status: 'COMPLETED', priority: 'NORMAL', createdMinAgo: 5 * 1440 + 30, runMinutes: 5, tokensIn: 23900, tokensOut: 7400, tools: 4 },
  { id: 't_116', agent: 'a_nova', project: 'p_launch', title: 'Pricing page benchmark (5 competitors)', description: 'Benchmark the structure and messaging of five competitor pricing pages.', status: 'COMPLETED', priority: 'NORMAL', createdMinAgo: 6 * 1440, runMinutes: 8, tokensIn: 40100, tokensOut: 5100, tools: 6 },
  { id: 't_117', agent: 'a_atlas', project: 'p_launch', title: 'Retro summary: September sprint', description: 'Summarise the September retro notes into themes and actions.', status: 'COMPLETED', priority: 'LOW', createdMinAgo: 9 * 1440, runMinutes: 3, tokensIn: 8800, tokensOut: 1900, tools: 2 },
  { id: 't_118', agent: 'a_quinn', project: 'p_platform', title: 'Validate migration scripts', description: 'Check the pending database migrations for destructive operations.', status: 'FAILED', priority: 'HIGH', createdMinAgo: 3 * 1440 + 400, runMinutes: 1, tokensIn: 3100, tokensOut: 210, tools: 1, error: 'Tool repo.metadata denied: the GitHub integration token lacks the repo scope.', failureClass: 'PERMISSION' },
  { id: 't_119', agent: 'a_sentinel', project: 'p_platform', title: 'Access review: workspace permissions', description: 'Review workspace roles and tool grants for least privilege.', status: 'COMPLETED', priority: 'NORMAL', createdMinAgo: 7 * 1440, runMinutes: 6, tokensIn: 19400, tokensOut: 3300, tools: 3 },
  { id: 't_120', agent: 'a_echo', project: 'p_support', title: 'Macro library cleanup', description: 'Identify duplicate and outdated support macros.', status: 'COMPLETED', priority: 'LOW', createdMinAgo: 8 * 1440, runMinutes: 4, tokensIn: 11200, tokensOut: 2600, tools: 2 },
  { id: 't_121', agent: 'a_iris', project: 'p_support', title: 'Send weekly KPI digest to #leadership', description: 'Compile the weekly support KPI digest and post it to the #leadership channel.', status: 'WAITING_APPROVAL', priority: 'NORMAL', createdMinAgo: 55, progress: 90, progressMessage: 'Waiting for approval: post message to #leadership', tokensIn: 16300, tokensOut: 1450, tools: 3, approvalId: 'ap_2' },
  { id: 't_122', agent: 'a_nova', project: 'p_launch', title: 'Research: EU AI Act obligations', description: 'Research the topic "EU AI Act obligations for customer-facing assistants" using approved sources and produce a findings report with citations.', status: 'COMPLETED', priority: 'NORMAL', createdMinAgo: 1440 + 80, runMinutes: 7, tokensIn: 30500, tokensOut: 4200, tools: 5, result: RESULT_EU, summary: 'Limited-risk classification; two disclosure gaps found.', workflowExecutionId: 'wx_1' },
  { id: 't_123', agent: 'a_quinn', project: 'p_launch', title: 'Review research: EU AI Act obligations', description: 'Review the research findings for gaps, unsupported claims and inconsistencies.', status: 'COMPLETED', priority: 'NORMAL', createdMinAgo: 1440 + 70, runMinutes: 3, tokensIn: 9400, tokensOut: 1600, tools: 2, workflowExecutionId: 'wx_1' },
  { id: 't_124', agent: 'a_scribe', project: 'p_launch', title: 'Final report: EU AI Act obligations', description: 'Write the final polished report from the approved research and review notes.', status: 'COMPLETED', priority: 'NORMAL', createdMinAgo: 1440 + 20, runMinutes: 4, tokensIn: 14800, tokensOut: 5300, tools: 2, workflowExecutionId: 'wx_1' },
  { id: 't_125', agent: 'a_atlas', project: 'p_support', title: 'Plan: Self-serve onboarding', description: 'Create a project plan and task drafts for: Self-serve onboarding for small teams', status: 'COMPLETED', priority: 'NORMAL', createdMinAgo: 70, runMinutes: 5, tokensIn: 17700, tokensOut: 4100, tools: 4, workflowExecutionId: 'wx_2' },
];

const agentModel = (agentId: string) => AGENT_SPECS.find((a) => a.id === agentId)?.model ?? 'claude-sonnet-5-5';

function buildTask(spec: TaskSpec, agents: AgentDto[]): TaskDto {
  const agent = agents.find((a) => a.id === spec.agent)!;
  const createdAt = ago(spec.createdMinAgo);
  const started = spec.status === 'DRAFT' || spec.status === 'QUEUED' ? null : later(createdAt, 0.3);
  const terminal = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(spec.status);
  const completedAt = terminal && started ? later(started, spec.runMinutes ?? 3) : null;
  const tin = spec.tokensIn ?? null;
  const tout = spec.tokensOut ?? null;
  const cost = tin !== null && tout !== null ? estimateCostUsd(agentModel(spec.agent), tin, tout) : null;
  const result = spec.status === 'COMPLETED' ? (spec.result ?? genericResult(spec.title, agent.name)) : null;
  return {
    id: spec.id,
    workspaceId: GUEST_WORKSPACE_ID,
    projectId: spec.project,
    project: spec.project ? { ...PROJECTS[spec.project] } : null,
    agentId: agent.id,
    agent: { id: agent.id, name: agent.name, avatar: agent.avatar, color: agent.color, category: agent.category },
    agentVersionId: agent.currentVersionId,
    title: spec.title,
    description: spec.description,
    status: spec.status,
    priority: spec.priority,
    progress: spec.status === 'COMPLETED' ? 100 : (spec.progress ?? (terminal ? 40 : 0)),
    progressMessage: spec.progressMessage ?? (spec.status === 'COMPLETED' ? 'Done' : spec.status === 'QUEUED' ? 'Waiting for a free worker' : null),
    deadline: spec.deadlineDays ? new Date(NOW + spec.deadlineDays * 1440 * MIN).toISOString() : null,
    scheduledFor: null,
    expectedDeliverable: spec.deliverable ?? '',
    allowedTools: null,
    budgetUsd: null,
    requireApprovalForWrites: spec.agent === 'a_forge',
    attempt: spec.attempt ?? (started ? 1 : 0),
    maxAttempts: 3,
    failureClass: spec.failureClass ?? null,
    errorMessage: spec.error ?? null,
    resultSummary: result ? (spec.summary ?? `${spec.title}: completed with ${spec.tools ?? 2} tool calls.`) : null,
    resultContent: result,
    startedAt: started,
    completedAt,
    durationMs: completedAt && started ? new Date(completedAt).getTime() - new Date(started).getTime() : null,
    usage: { inputTokens: tin, outputTokens: tout, estimatedCostUsd: cost, requests: tin ? Math.max(1, Math.round(tin / 9000)) : 0, toolInvocations: spec.tools ?? 0, hasUnavailable: false },
    createdBy: spec.createdBy === undefined ? ME : spec.createdBy,
    conversationId: null,
    workflowExecutionId: spec.workflowExecutionId ?? null,
    pendingApprovalId: spec.status === 'WAITING_APPROVAL' ? (spec.approvalId ?? null) : null,
    artifactCount: 0,
    createdAt,
    updatedAt: completedAt ?? (started ? ago(Math.max(0, spec.createdMinAgo - 1)) : createdAt),
  };
}

const TOOL_BY_CATEGORY: Partial<Record<AgentCategory, string[]>> = {
  RESEARCHER: ['web.search', 'docs.search', 'report.generate'],
  PROJECT_PLANNER: ['docs.search', 'task.get', 'task.create_draft'],
  QA_REVIEWER: ['docs.search', 'file.read', 'repo.metadata'],
  DOCUMENTATION: ['docs.search', 'document.create_draft', 'report.generate'],
  DATA_ANALYST: ['file.read', 'csv.analyze', 'report.generate'],
  CUSTOMER_SUPPORT: ['docs.search', 'document.create_draft'],
  CODE_ASSISTANT: ['repo.metadata', 'file.read', 'github.pr_draft'],
  SECURITY_REVIEWER: ['repo.metadata', 'docs.search', 'report.generate'],
};

/** Execution timeline consistent with the task's status. */
export function buildEvents(task: TaskDto): ExecutionEventDto[] {
  const out: ExecutionEventDto[] = [];
  const start = new Date(task.createdAt).getTime();
  const end = task.completedAt ? new Date(task.completedAt).getTime() : Math.min(Date.now(), start + 12 * MIN);
  const steps: Array<Omit<ExecutionEventDto, 'id' | 'taskId' | 'executionId' | 'sequence' | 'createdAt'>> = [];
  const push = (type: ExecutionEventDto['type'], level: ExecutionEventDto['level'], message: string, metadata: Record<string, unknown> | null = null, durationMs: number | null = null) => steps.push({ type, level, message, metadata, durationMs, diagnostics: null });
  push('TASK_ACCEPTED', 'INFO', `Task accepted by ${task.agent.name}`);
  push('TASK_QUEUED', 'INFO', 'Queued for execution', { priority: task.priority });
  if (task.status === 'DRAFT') return [];
  if (task.status !== 'QUEUED') {
    const tools = TOOL_BY_CATEGORY[task.agent.category] ?? ['docs.search'];
    push('CONTEXT_RETRIEVED', 'INFO', 'Retrieved 6 knowledge chunks from 3 approved sources', { chunks: 6, sources: 3 }, 420);
    push('MODEL_REQUEST_STARTED', 'INFO', `Model request started (${agentModel(task.agentId)})`, { model: agentModel(task.agentId) });
    const n = task.status === 'COMPLETED' ? tools.length : Math.min(2, tools.length);
    for (let i = 0; i < n; i++) {
      const tool = tools[i]!;
      push('TOOL_REQUESTED', 'INFO', `Requested tool ${tool}`, { toolId: tool });
      if (task.failureClass === 'PERMISSION' && i === 0) {
        push('TOOL_DENIED', 'ERROR', `Tool ${tool} denied: integration token lacks the required scope`, { toolId: tool });
        break;
      }
      push('TOOL_AUTHORIZED', 'INFO', `Tool ${tool} authorized`, { toolId: tool });
      push('TOOL_EXECUTED', 'SUCCESS', `Tool ${tool} returned results`, { toolId: tool }, 300 + i * 250);
    }
    push('MODEL_RESPONSE_RECEIVED', 'INFO', 'Model response received', { inputTokens: task.usage.inputTokens, outputTokens: task.usage.outputTokens }, 4200);
    if (task.progress > 0 && task.status !== 'COMPLETED') push('PROGRESS', 'INFO', task.progressMessage ?? `Progress ${task.progress}%`, { progress: task.progress });
  }
  switch (task.status) {
    case 'COMPLETED':
      push('ARTIFACT_GENERATED', 'SUCCESS', 'Generated report artifact', null);
      push('TASK_COMPLETED', 'SUCCESS', 'Task completed', { durationMs: task.durationMs });
      break;
    case 'WAITING_APPROVAL':
      push('APPROVAL_REQUESTED', 'WARNING', 'Approval requested before running a write action', { approvalId: task.pendingApprovalId });
      break;
    case 'PAUSED':
      push('TASK_PAUSED', 'WARNING', 'Task paused by a team member');
      break;
    case 'FAILED':
      if (task.failureClass === 'TIMEOUT') push('RETRY_PERFORMED', 'WARNING', 'Retrying after model timeout (attempt 2 of 3)', { attempt: 2 });
      push('TASK_FAILED', 'ERROR', task.errorMessage ?? 'Task failed', { failureClass: task.failureClass });
      break;
    case 'CANCELLED':
      push('TASK_CANCELLED', 'WARNING', 'Task cancelled by a team member');
      break;
    case 'TIMED_OUT':
      push('TASK_TIMED_OUT', 'ERROR', task.errorMessage ?? 'Task timed out');
      break;
    default:
      break;
  }
  const span = Math.max(steps.length - 1, 1);
  return steps.map((s, i) => ({ ...s, id: `ev_${task.id}_${i + 1}`, taskId: task.id, executionId: `ex_${task.id}`, sequence: i + 1, createdAt: new Date(start + ((end - start) * i) / span).toISOString() }));
}

// ---------------------------------------------------------------- artifacts
const CSV_TICKETS = `category,tickets,share,trend
Billing & invoices,1377,28.6%,+14%
Login / SSO,902,18.7%,+6%
Integrations,744,15.5%,-3%
Bug reports,691,14.4%,+2%
How-to,1098,22.8%,-5%`;

const CSV_COMPETITORS = `product,starting_price_usd,integrations,data_residency
MeetMate,12,14,US
Notewise,15,11,"US, EU"
Recapify,9,6,US
Huddle AI,18,8,Not stated
Minutely,10,5,EU`;

const JSON_PRICING = JSON.stringify({ benchmark: 'pricing-pages', competitors: [{ name: 'MeetMate', tiers: 3, annualDiscount: '20%' }, { name: 'Notewise', tiers: 4, annualDiscount: '15%' }, { name: 'Recapify', tiers: 2, annualDiscount: null }, { name: 'Huddle AI', tiers: 3, annualDiscount: '25%' }, { name: 'Minutely', tiers: 3, annualDiscount: '10%' }] }, null, 2);

interface ArtifactSpec {
  id: string;
  name: string;
  type: ArtifactType;
  task: string | null;
  content: string;
  minAgo: number;
  version?: number;
}

const ARTIFACT_SPECS: ArtifactSpec[] = [
  { id: 'ar_1', name: 'competitive-analysis-meeting-assistants.md', type: 'MARKDOWN', task: 't_101', content: RESULT_COMPETITORS, minAgo: 2 * 1440 + 190 },
  { id: 'ar_2', name: 'competitor-matrix.csv', type: 'CSV', task: 't_101', content: CSV_COMPETITORS, minAgo: 2 * 1440 + 190 },
  { id: 'ar_3', name: 'october-tickets-by-category.csv', type: 'CSV', task: 't_106', content: CSV_TICKETS, minAgo: 3 * 1440 + 84 },
  { id: 'ar_4', name: 'october-ticket-analysis.md', type: 'MARKDOWN', task: 't_106', content: RESULT_TICKETS, minAgo: 3 * 1440 + 84 },
  { id: 'ar_5', name: 'repo-health-crewdesk-api.md', type: 'MARKDOWN', task: 't_114', content: RESULT_REPO, minAgo: 4 * 1440 + 112 },
  { id: 'ar_6', name: 'faq-refresh-draft.md', type: 'MARKDOWN', task: 't_115', content: genericResult('Customer FAQ refresh', 'Scribe'), minAgo: 5 * 1440 + 24, version: 2 },
  { id: 'ar_7', name: 'pricing-benchmark.json', type: 'JSON', task: 't_116', content: JSON_PRICING, minAgo: 6 * 1440 - 9 },
  { id: 'ar_8', name: 'access-review-oct.pdf', type: 'PDF', task: 't_119', content: '%PDF-1.4\n% sample file (guest mode)\n', minAgo: 7 * 1440 - 7 },
  { id: 'ar_9', name: 'eu-ai-act-final-report.md', type: 'MARKDOWN', task: 't_124', content: RESULT_EU, minAgo: 1440 + 15 },
  { id: 'ar_10', name: 'onboarding-checklist-review.md', type: 'MARKDOWN', task: 't_105', content: genericResult('Review onboarding checklist for gaps', 'Quinn'), minAgo: 1440 + 314 },
  { id: 'ar_11', name: 'october-ticket-export.csv', type: 'CSV', task: null, content: `ticket_id,created,category,first_response_min\n48211,2025-10-01,Billing,96\n48212,2025-10-01,SSO,142\n48213,2025-10-02,How-to,51\n48214,2025-10-02,Billing,188`, minAgo: 3 * 1440 + 120 },
  { id: 'ar_12', name: 'v2-launch-brief.txt', type: 'TEXT', task: null, content: 'v2.0 launch brief\n\nGoal: launch workflows and approvals to all paid plans by end of quarter.\nOwners: Priya (product), Marco (agents), Lena (support).', minAgo: 10 * 1440 },
];

const MIME: Record<ArtifactType, string> = { MARKDOWN: 'text/markdown', CSV: 'text/csv', JSON: 'application/json', PDF: 'application/pdf', TEXT: 'text/plain', UPLOAD: 'application/octet-stream' };
export const mimeFor = (t: ArtifactType) => MIME[t];

function buildArtifacts(tasks: TaskDto[], agents: AgentDto[]): GuestArtifact[] {
  return ARTIFACT_SPECS.map((s) => {
    const task = s.task ? tasks.find((t) => t.id === s.task) ?? null : null;
    const agent = task ? agents.find((a) => a.id === task.agentId) ?? null : null;
    return {
      id: s.id,
      workspaceId: GUEST_WORKSPACE_ID,
      projectId: task?.projectId ?? 'p_support',
      taskId: task?.id ?? null,
      agentId: agent?.id ?? null,
      agent: agent ? { id: agent.id, name: agent.name, avatar: agent.avatar, color: agent.color } : null,
      name: s.name,
      type: s.type,
      mimeType: MIME[s.type],
      size: s.type === 'PDF' ? 184_320 : new TextEncoder().encode(s.content).length,
      version: s.version ?? 1,
      sources: task ? [{ title: 'Product requirements: v2.0', sourceId: 'k_prd', url: null }, { title: 'Competitor pricing pages', sourceId: 'k_pricing', url: null }] : [],
      visibility: 'WORKSPACE',
      createdBy: task ? null : ME,
      createdAt: ago(s.minAgo),
      content: s.content,
    };
  });
}

// ---------------------------------------------------------------- approvals
function approval(p: Partial<ApprovalDto> & Pick<ApprovalDto, 'id' | 'actionTitle' | 'actionDescription' | 'risk' | 'status' | 'createdAt'>, agents: AgentDto[], tasks: TaskDto[]): ApprovalDto {
  const task = p.taskId ? tasks.find((t) => t.id === p.taskId) ?? null : null;
  const agent = p.agentId ? agents.find((a) => a.id === p.agentId) ?? null : null;
  return {
    workspaceId: GUEST_WORKSPACE_ID,
    taskId: null,
    workflowExecutionId: null,
    agentId: null,
    toolId: null,
    targetResource: null,
    proposal: {},
    proposalVersion: 1,
    proposalHash: `${p.id}9f3c2a7d41b8e6c05a1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b`,
    evidence: null,
    diff: null,
    expiresAt: null,
    decisions: [],
    updatedAt: p.createdAt,
    ...p,
    task: task ? { id: task.id, title: task.title, status: task.status } : null,
    agent: agent ? { id: agent.id, name: agent.name, avatar: agent.avatar, color: agent.color } : null,
  };
}

function buildApprovals(agents: AgentDto[], tasks: TaskDto[]): ApprovalDto[] {
  return [
    approval({ id: 'ap_1', taskId: 't_104', agentId: 'a_forge', toolId: 'github.pr_draft', actionTitle: 'Open draft pull request in northwind/crewdesk-api', actionDescription: 'Forge wants to open a draft PR that adds exponential backoff with jitter to the retry worker.', targetResource: 'github:northwind/crewdesk-api#draft', risk: 'MEDIUM', status: 'PENDING', createdAt: ago(31), expiresAt: new Date(NOW + 2 * 1440 * MIN).toISOString(), proposal: { repo: 'northwind/crewdesk-api', base: 'main', head: 'agent/forge/retry-backoff', title: 'Add exponential backoff with jitter to retry worker', draft: true, files: ['src/workers/retry.ts', 'src/workers/retry.test.ts'] }, evidence: { incidents: ['INC-2291', 'INC-2307'], testsAdded: 4 }, diff: { before: "const delay = attempt * 1000;\nawait sleep(delay);", after: "const base = Math.min(30_000, 2 ** attempt * 250);\nconst delay = base / 2 + Math.random() * (base / 2);\nawait sleep(delay);" } }, agents, tasks),
    approval({ id: 'ap_2', taskId: 't_121', agentId: 'a_iris', toolId: 'message.send', actionTitle: 'Post weekly KPI digest to #leadership', actionDescription: 'Iris wants to post the weekly support KPI digest to the #leadership Slack channel via the outbound webhook.', targetResource: 'slack:#leadership', risk: 'HIGH', status: 'PENDING', createdAt: ago(48), proposal: { channel: '#leadership', text: 'Weekly support KPIs: 1,128 tickets (+4%), median first response 2h 05m, CSAT 92%. Billing remains the top driver (VAT questions).' }, evidence: { sourceArtifact: 'october-ticket-analysis.md' } }, agents, tasks),
    approval({ id: 'ap_3', workflowExecutionId: 'wx_2', actionTitle: 'Approve generated task drafts', actionDescription: 'The "Plan → Draft tasks → Approve → Notify" workflow is waiting for approval of 9 task drafts created by Atlas.', targetResource: 'workflow:wf_plan', risk: 'LOW', status: 'PENDING', createdAt: ago(64), proposal: { taskDrafts: 9, project: 'Customer Support Revamp' } }, agents, tasks),
    approval({ id: 'ap_4', taskId: 't_114', agentId: 'a_forge', toolId: 'github.pr_draft', actionTitle: 'Open draft PR: update CI cache keys', actionDescription: 'Open a draft PR that updates CI cache keys to include the lockfile hash.', targetResource: 'github:northwind/crewdesk-api', risk: 'MEDIUM', status: 'EXECUTED', createdAt: ago(4 * 1440 + 110), decisions: [{ id: 'd_1', decision: 'APPROVED', comment: 'Looks good, thanks.', decidedBy: PRIYA, createdAt: ago(4 * 1440 + 100) }], proposal: { repo: 'northwind/crewdesk-api', title: 'ci: include lockfile hash in cache key', draft: true } }, agents, tasks),
    approval({ id: 'ap_5', taskId: 't_120', agentId: 'a_echo', toolId: 'message.send', actionTitle: 'Notify support team about macro changes', actionDescription: 'Echo wants to post a summary of removed macros to #support.', targetResource: 'slack:#support', risk: 'MEDIUM', status: 'REJECTED', createdAt: ago(8 * 1440 - 5), decisions: [{ id: 'd_2', decision: 'REJECTED', comment: 'I will announce this in the team meeting instead.', decidedBy: SAM, createdAt: ago(8 * 1440 - 30) }], proposal: { channel: '#support', text: '12 duplicate macros were archived.' } }, agents, tasks),
    approval({ id: 'ap_6', taskId: 't_115', agentId: 'a_scribe', toolId: 'docs.update', actionTitle: 'Update published FAQ page', actionDescription: 'Scribe wants to replace 15 FAQ answers on the help center.', targetResource: 'docs:help-center/faq', risk: 'HIGH', status: 'APPROVED', createdAt: ago(5 * 1440 + 26), decisions: [{ id: 'd_3', decision: 'APPROVED', comment: null, decidedBy: ME, createdAt: ago(5 * 1440 + 20) }], diff: { before: 'Invoices are emailed on the 1st of each month.', after: 'Invoices are emailed on the 1st of each month and include VAT where applicable. You can download past invoices from Billing → History.' } }, agents, tasks),
    approval({ id: 'ap_7', taskId: 't_117', agentId: 'a_atlas', toolId: 'project.comment', actionTitle: 'Comment retro actions on the sprint board', actionDescription: 'Post the five retro actions as a comment on the September sprint.', targetResource: 'project:p_launch', risk: 'LOW', status: 'EXPIRED', createdAt: ago(9 * 1440 - 10), expiresAt: ago(7 * 1440) }, agents, tasks),
  ];
}

// ---------------------------------------------------------------- workflows
const GRAPH_RESEARCH: WorkflowGraph = {
  nodes: [
    { id: 'start', type: 'START', position: { x: 0, y: 160 }, data: { label: 'Start' } },
    { id: 'research', type: 'AGENT', position: { x: 240, y: 160 }, data: { label: 'Research', agentId: 'a_nova', taskTitle: 'Research: {{input.topic}}', instructions: 'Research the topic "{{input.topic}}" using approved sources and produce a findings report with citations.' } },
    { id: 'review', type: 'AGENT', position: { x: 520, y: 160 }, data: { label: 'QA review', agentId: 'a_quinn', taskTitle: 'Review research: {{input.topic}}', instructions: 'Review the research findings below for gaps, unsupported claims and inconsistencies.' } },
    { id: 'approve', type: 'APPROVAL', position: { x: 800, y: 160 }, data: { label: 'Human approval', approvalTitle: 'Approve research for publication', risk: 'MEDIUM' } },
    { id: 'document', type: 'AGENT', position: { x: 1080, y: 160 }, data: { label: 'Final report', agentId: 'a_scribe', taskTitle: 'Final report: {{input.topic}}', instructions: 'Write the final polished report from the approved research and review notes below.' } },
    { id: 'end', type: 'END', position: { x: 1360, y: 160 }, data: { label: 'End' } },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'research' },
    { id: 'e2', source: 'research', target: 'review' },
    { id: 'e3', source: 'review', target: 'approve' },
    { id: 'e4', source: 'approve', target: 'document' },
    { id: 'e5', source: 'document', target: 'end' },
  ],
  inputSchema: { topic: 'string' },
};

const GRAPH_PLAN: WorkflowGraph = {
  nodes: [
    { id: 'start', type: 'START', position: { x: 0, y: 160 }, data: { label: 'Start' } },
    { id: 'plan', type: 'AGENT', position: { x: 240, y: 160 }, data: { label: 'Plan', agentId: 'a_atlas', taskTitle: 'Plan: {{input.objective}}', instructions: 'Create a project plan and task drafts for: {{input.objective}}' } },
    { id: 'approve', type: 'APPROVAL', position: { x: 520, y: 160 }, data: { label: 'Approve plan', approvalTitle: 'Approve generated task drafts', risk: 'LOW' } },
    { id: 'notify', type: 'HUMAN_TASK', position: { x: 800, y: 160 }, data: { label: 'Notify project owner' } },
    { id: 'end', type: 'END', position: { x: 1080, y: 160 }, data: { label: 'End' } },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'plan' },
    { id: 'e2', source: 'plan', target: 'approve' },
    { id: 'e3', source: 'approve', target: 'notify' },
    { id: 'e4', source: 'notify', target: 'end' },
  ],
  inputSchema: { objective: 'string' },
};

const GRAPH_TRIAGE: WorkflowGraph = {
  nodes: [
    { id: 'start', type: 'START', position: { x: 0, y: 200 }, data: { label: 'New ticket' } },
    { id: 'lookup', type: 'TOOL', position: { x: 220, y: 200 }, data: { label: 'Find similar tickets', toolId: 'docs.search', toolInput: { query: '{{input.subject}}', limit: 5 } } },
    { id: 'classify', type: 'AGENT', position: { x: 440, y: 200 }, data: { label: 'Classify severity', agentId: 'a_iris', taskTitle: 'Classify ticket: {{input.subject}}', instructions: 'Classify the ticket severity (low/high) and category. Respond with JSON {"severity": "...", "category": "..."}.' } },
    { id: 'severity', type: 'CONDITION', position: { x: 680, y: 200 }, data: { label: 'High severity?', expression: "output.severity == 'high'" } },
    { id: 'fanout', type: 'PARALLEL', position: { x: 900, y: 80 }, data: { label: 'Escalate' } },
    { id: 'draft', type: 'AGENT', position: { x: 1120, y: 0 }, data: { label: 'Draft customer reply', agentId: 'a_echo', taskTitle: 'Reply: {{input.subject}}', instructions: 'Draft an empathetic reply acknowledging the issue and next steps.' } },
    { id: 'oncall', type: 'HUMAN_TASK', position: { x: 1120, y: 160 }, data: { label: 'Page on-call engineer' } },
    { id: 'merge', type: 'MERGE', position: { x: 1340, y: 80 }, data: { label: 'Both done' } },
    { id: 'end_high', type: 'END', position: { x: 1560, y: 80 }, data: { label: 'Escalated' } },
    { id: 'wait', type: 'DELAY', position: { x: 900, y: 320 }, data: { label: 'Batch for 1 hour', delayMs: 3600000 } },
    { id: 'summary', type: 'PROMPT', position: { x: 1120, y: 320 }, data: { label: 'Summarize for digest', template: 'Summarize ticket "{{input.subject}}" in one sentence for the daily digest.' } },
    { id: 'end_low', type: 'END', position: { x: 1340, y: 320 }, data: { label: 'Queued for digest' } },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'lookup' },
    { id: 'e2', source: 'lookup', target: 'classify' },
    { id: 'e3', source: 'classify', target: 'severity' },
    { id: 'e4', source: 'severity', target: 'fanout', sourceHandle: 'true', label: 'true' },
    { id: 'e5', source: 'severity', target: 'wait', sourceHandle: 'false', label: 'false' },
    { id: 'e6', source: 'fanout', target: 'draft' },
    { id: 'e7', source: 'fanout', target: 'oncall' },
    { id: 'e8', source: 'draft', target: 'merge' },
    { id: 'e9', source: 'oncall', target: 'merge' },
    { id: 'e10', source: 'merge', target: 'end_high' },
    { id: 'e11', source: 'wait', target: 'summary' },
    { id: 'e12', source: 'summary', target: 'end_low' },
  ],
  inputSchema: { subject: 'string', customer: 'string' },
};

function execNodes(graph: WorkflowGraph, startedAt: string, states: Record<string, { status: NodeExecutionStatus; taskId?: string; approvalId?: string; error?: string; output?: Record<string, unknown> }>): WorkflowExecutionDto['nodes'] {
  let t = 0;
  return graph.nodes.map((n, i) => {
    const s = states[n.id] ?? { status: 'PENDING' as NodeExecutionStatus };
    const ran = s.status !== 'PENDING' && s.status !== 'SKIPPED';
    const st = ran ? later(startedAt, t) : null;
    if (ran) t += n.type === 'AGENT' ? 6 : 0.5;
    const done = s.status === 'COMPLETED' || s.status === 'FAILED' ? later(startedAt, t) : null;
    const logs: Array<{ at: string; level: string; message: string }> = [];
    if (st) logs.push({ at: st, level: 'info', message: `${n.data.label ?? n.type} started` });
    if (s.status === 'WAITING') logs.push({ at: st ?? startedAt, level: 'warn', message: n.type === 'APPROVAL' ? 'Waiting for human approval' : 'Waiting for a person to complete this step' });
    if (s.status === 'FAILED') logs.push({ at: done ?? startedAt, level: 'error', message: s.error ?? 'Step failed' });
    if (s.status === 'COMPLETED' && done) logs.push({ at: done, level: 'info', message: 'Completed' });
    return {
      id: `nx_${i}_${n.id}_${startedAt.slice(11, 19)}`,
      nodeId: n.id,
      nodeType: n.type,
      label: n.data.label ?? null,
      status: s.status,
      attempt: 1,
      input: ran ? { from: 'previous step' } : null,
      output: s.output ?? (s.status === 'COMPLETED' ? { ok: true } : null),
      errorMessage: s.error ?? null,
      taskId: s.taskId ?? null,
      approvalId: s.approvalId ?? null,
      logs,
      startedAt: st,
      completedAt: done,
    };
  });
}

function buildWorkflows(): { workflows: WorkflowDto[]; versions: Record<string, GuestWorkflowVersion[]>; executions: WorkflowExecutionDto[] } {
  const executions: WorkflowExecutionDto[] = [];
  const mkExec = (id: string, wf: string, version: number, status: WorkflowExecutionStatus, startedMinAgo: number, graph: WorkflowGraph, input: Record<string, unknown>, states: Parameters<typeof execNodes>[2], extra: Partial<WorkflowExecutionDto> = {}) => {
    const started = ago(startedMinAgo);
    const nodes = execNodes(graph, started, states);
    const last = nodes.map((n) => n.completedAt).filter(Boolean).sort().pop() ?? null;
    executions.push({ id, workflowId: wf, workflowVersionId: `wv_${wf}_${version}`, version, status, dryRun: false, input, output: null, errorMessage: null, startedAt: started, completedAt: ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status) ? last : null, createdAt: started, nodes, ...extra });
  };
  mkExec('wx_1', 'wf_research', 2, 'COMPLETED', 1440 + 85, GRAPH_RESEARCH, { topic: 'EU AI Act obligations for customer-facing assistants' }, { start: { status: 'COMPLETED' }, research: { status: 'COMPLETED', taskId: 't_122' }, review: { status: 'COMPLETED', taskId: 't_123' }, approve: { status: 'COMPLETED', output: { approvedBy: 'Guest Owner' } }, document: { status: 'COMPLETED', taskId: 't_124' }, end: { status: 'COMPLETED' } }, { output: { text: RESULT_EU } });
  mkExec('wx_5', 'wf_research', 1, 'CANCELLED', 6 * 1440, GRAPH_RESEARCH, { topic: 'Usage-based pricing models' }, { start: { status: 'COMPLETED' }, research: { status: 'COMPLETED', taskId: 't_116' }, review: { status: 'SKIPPED' }, approve: { status: 'SKIPPED' }, document: { status: 'SKIPPED' }, end: { status: 'SKIPPED' } }, { errorMessage: 'Cancelled by Guest Owner' });
  mkExec('wx_2', 'wf_plan', 1, 'WAITING', 72, GRAPH_PLAN, { objective: 'Self-serve onboarding for small teams' }, { start: { status: 'COMPLETED' }, plan: { status: 'COMPLETED', taskId: 't_125' }, approve: { status: 'WAITING', approvalId: 'ap_3' } });
  mkExec('wx_3', 'wf_triage', 3, 'FAILED', 3 * 1440 + 30, GRAPH_TRIAGE, { subject: 'SSO login loop after Okta update', customer: 'Contoso' }, { start: { status: 'COMPLETED' }, lookup: { status: 'COMPLETED', output: { results: 4 } }, classify: { status: 'COMPLETED', output: { severity: 'high', category: 'Login / SSO' } }, severity: { status: 'COMPLETED', output: { branch: 'true' } }, fanout: { status: 'COMPLETED' }, draft: { status: 'FAILED', error: 'Agent Echo is paused; resume it to run this step.' }, oncall: { status: 'COMPLETED', output: { note: 'Paged Marco' } }, wait: { status: 'SKIPPED' }, summary: { status: 'SKIPPED' }, end_low: { status: 'SKIPPED' } }, { errorMessage: 'Step "Draft customer reply" failed: Agent Echo is paused.' });
  executions.push({ ...clone(executions.find((e) => e.id === 'wx_3')!), id: 'wx_4', dryRun: true, status: 'COMPLETED', errorMessage: null, startedAt: ago(4 * 1440), createdAt: ago(4 * 1440), completedAt: ago(4 * 1440 - 1), input: { subject: 'Refund request for duplicate charge', customer: 'Fabrikam' }, nodes: execNodes(GRAPH_TRIAGE, ago(4 * 1440), { start: { status: 'COMPLETED' }, lookup: { status: 'COMPLETED' }, classify: { status: 'COMPLETED', output: { dryRun: true } }, severity: { status: 'COMPLETED', output: { branch: 'false' } }, fanout: { status: 'SKIPPED' }, draft: { status: 'SKIPPED' }, oncall: { status: 'SKIPPED' }, merge: { status: 'SKIPPED' }, end_high: { status: 'SKIPPED' }, wait: { status: 'COMPLETED' }, summary: { status: 'COMPLETED' }, end_low: { status: 'COMPLETED' } }) });

  const versions: Record<string, GuestWorkflowVersion[]> = {};
  const wfs: Array<{ id: string; name: string; description: string; project: ProjectKey | null; graph: WorkflowGraph; versions: string[]; createdDaysAgo: number; template?: boolean }> = [
    { id: 'wf_research', name: 'Research → Review → Approve → Document', description: 'Nova researches, Quinn reviews, a human approves and Scribe writes the final report.', project: 'p_launch', graph: GRAPH_RESEARCH, versions: ['Created from template', 'Swapped reviewer to Quinn'], createdDaysAgo: 40 },
    { id: 'wf_plan', name: 'Plan → Draft tasks → Approve → Notify', description: 'Atlas drafts a plan and tasks, a human approves them, then the project owner is notified.', project: 'p_support', graph: GRAPH_PLAN, versions: ['Created from template'], createdDaysAgo: 20 },
    { id: 'wf_triage', name: 'Support ticket triage', description: 'Classify incoming tickets; escalate high-severity ones in parallel, batch the rest into a daily digest.', project: 'p_support', graph: GRAPH_TRIAGE, versions: ['Created blank', 'Added parallel escalation', 'Delay before digest'], createdDaysAgo: 15 },
  ];
  const workflows = wfs.map((w) => {
    versions[w.id] = w.versions
      .map((summary, i) => ({ id: `wv_${w.id}_${i + 1}`, version: i + 1, changeSummary: summary, createdAt: ago((w.createdDaysAgo - i * 3) * 1440), createdBy: i % 2 ? MARCO : ME, graph: clone(w.graph) }))
      .reverse();
    const last = executions.filter((e) => e.workflowId === w.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const dto: WorkflowDto = {
      id: w.id,
      workspaceId: GUEST_WORKSPACE_ID,
      projectId: w.project,
      name: w.name,
      description: w.description,
      currentVersion: w.versions.length,
      currentVersionId: `wv_${w.id}_${w.versions.length}`,
      graph: clone(w.graph),
      isTemplate: Boolean(w.template),
      lastExecution: last ? { id: last.id, status: last.status, createdAt: last.createdAt } : null,
      createdAt: ago(w.createdDaysAgo * 1440),
      updatedAt: versions[w.id]![0]!.createdAt,
    };
    return dto;
  });
  return { workflows, versions, executions };
}

export const WORKFLOW_TEMPLATES = [
  { name: 'Research → Review → Approve → Document', description: 'Researcher produces findings, QA reviews them, a human approves, Documentation writes the final report.', graph: GRAPH_RESEARCH },
  { name: 'Plan → Draft tasks → Approve → Notify', description: 'Planner creates task drafts, a human approves them, then the project owner is notified.', graph: GRAPH_PLAN },
];

// ---------------------------------------------------------------- knowledge
function buildKnowledge(): KnowledgeSourceDto[] {
  const k = (p: Partial<KnowledgeSourceDto> & Pick<KnowledgeSourceDto, 'id' | 'type' | 'title' | 'status'> & { daysAgo: number }): KnowledgeSourceDto => {
    const { daysAgo, ...rest } = p;
    return {
      workspaceId: GUEST_WORKSPACE_ID,
      projectId: null,
      url: null,
      statusMessage: null,
      version: 1,
      chunkCount: 0,
      size: null,
      agentIds: [],
      createdBy: ME,
      createdAt: ago(daysAgo * 1440),
      updatedAt: ago(daysAgo * 1440 - 30),
      indexedAt: p.status === 'READY' ? ago(daysAgo * 1440 - 30) : null,
      ...rest,
    };
  };
  return [
    k({ id: 'k_prd', type: 'DOCUMENT', title: 'Product requirements: v2.0', status: 'READY', chunkCount: 48, size: 412_000, projectId: 'p_launch', agentIds: ['a_nova', 'a_atlas', 'a_quinn'], version: 3, daysAgo: 30 }),
    k({ id: 'k_brand', type: 'DOCUMENT', title: 'Brand voice guidelines', status: 'READY', chunkCount: 22, size: 96_400, agentIds: ['a_scribe', 'a_echo'], daysAgo: 70 }),
    k({ id: 'k_api', type: 'URL', title: 'Public API reference', url: 'https://docs.example.com/api', status: 'READY', chunkCount: 131, agentIds: ['a_quinn', 'a_scribe', 'a_forge', 'a_sentinel'], version: 2, daysAgo: 45, createdBy: MARCO }),
    k({ id: 'k_pricing', type: 'FOLDER', title: 'Competitor pricing pages', status: 'READY', chunkCount: 64, size: 1_240_000, projectId: 'p_launch', agentIds: ['a_nova'], daysAgo: 12 }),
    k({ id: 'k_macros', type: 'TEXT', title: 'Support macros export', status: 'READY', chunkCount: 37, size: 58_100, projectId: 'p_support', agentIds: ['a_iris', 'a_echo'], daysAgo: 20, createdBy: LENA }),
    k({ id: 'k_board', type: 'REPORT', title: 'Q3 board report', status: 'READY', chunkCount: 19, size: 220_000, agentIds: ['a_nova', 'a_iris'], daysAgo: 25, createdBy: PRIYA }),
    k({ id: 'k_status', type: 'URL', title: 'Status page history', url: 'https://status.example.com/history', status: 'PROCESSING', statusMessage: 'Fetching and chunking (step 2 of 3)', daysAgo: 0.01 }),
    k({ id: 'k_wiki', type: 'DOCUMENT', title: 'Legacy wiki export.zip', status: 'FAILED', statusMessage: 'Unsupported archive format. Upload individual PDF, Markdown or text files.', size: 8_400_000, daysAgo: 3, createdBy: MARCO }),
    k({ id: 'k_oldpricing', type: 'DOCUMENT', title: 'Old pricing (2024)', status: 'REVOKED', statusMessage: 'Revoked: superseded by the v2.0 pricing model', chunkCount: 0, size: 44_000, daysAgo: 90 }),
  ];
}

export const KNOWLEDGE_SNIPPETS: Record<string, string[]> = {
  k_prd: ['v2.0 introduces multi-agent workflows with human approval steps. Every write action must be approvable and auditable.', 'Launch target: end of quarter for all paid plans. Self-serve onboarding is in scope for small teams (≤ 10 seats).', 'Non-goals: autonomous merges to protected branches; agents may only open draft pull requests.'],
  k_brand: ['Voice: clear, warm, direct. Prefer short sentences. Avoid jargon unless the reader is technical.', 'Never promise dates we have not published. Say "we are working on it" instead of "soon".'],
  k_api: ['Webhooks are retried with exponential backoff for up to 24 hours. Each delivery is signed with an HMAC-SHA256 header.', 'Rate limits: 600 requests per minute per user; 429 responses include a Retry-After header.'],
  k_pricing: ['Notewise Team: $15 per seat per month, EU and US data residency, 11 integrations.', 'MeetMate Starter: $12 per seat per month, 14 integrations, US hosting only.'],
  k_macros: ['VAT explainer: Invoices include VAT for EU customers based on the billing address. Business customers can add a VAT ID under Billing → Details.', 'SSO loop: ask the admin to extend the Okta session lifetime to at least 8 hours.'],
  k_board: ['Q3 revenue grew 18% QoQ; net revenue retention 116%. Support cost per ticket decreased 9%.', 'Board priorities for Q4: launch v2.0, EU hosting GA, reduce first response time below 2 hours.'],
};

// ------------------------------------------------------------ conversations
function buildConversations(): { conversations: ConversationDto[]; messages: MessageDto[] } {
  const conversations: ConversationDto[] = [
    { id: 'c_nova', agentId: 'a_nova', projectId: null, title: 'Chat with Nova', createdAt: ago(3 * 1440), updatedAt: ago(40) },
    { id: 'c_atlas', agentId: 'a_atlas', projectId: null, title: 'Chat with Atlas', createdAt: ago(2 * 1440), updatedAt: ago(14) },
    { id: 'c_iris', agentId: 'a_iris', projectId: null, title: 'Chat with Iris', createdAt: ago(5 * 1440), updatedAt: ago(3 * 1440) },
  ];
  const m = (id: string, conversationId: string, role: MessageDto['role'], content: string, minAgo: number, extra: Partial<MessageDto> = {}): MessageDto => ({ id, conversationId, role, kind: 'TEXT', content, metadata: null, taskId: null, status: 'COMPLETE', usage: role === 'AGENT' ? { inputTokens: 2400 + content.length, outputTokens: Math.round(content.length / 3.6) } : null, createdAt: ago(minAgo), ...extra });
  const messages: MessageDto[] = [
    m('m_1', 'c_nova', 'USER', 'Which competitors offer EU data residency?', 45),
    m('m_2', 'c_nova', 'AGENT', 'Based on the approved sources, **Notewise** (US and EU) and **Minutely** (EU only) offer EU data residency. MeetMate and Recapify host in the US only, and Huddle AI does not state where data is stored.\n\nWould you like me to turn this into a task and produce a comparison table?', 44, { metadata: { sources: [{ title: 'Competitor pricing pages', url: null }, { title: 'Product requirements: v2.0', url: null }] } }),
    m('m_3', 'c_nova', 'USER', 'Not yet. What does the PRD say about autonomous merges?', 41),
    m('m_4', 'c_nova', 'AGENT', 'The PRD lists autonomous merges to protected branches as a **non-goal**: agents may only open *draft* pull requests, and every write action must be approvable and auditable.', 40, { metadata: { sources: [{ title: 'Product requirements: v2.0', url: null }] } }),
    m('m_5', 'c_atlas', 'USER', 'Please build the v2.0 launch plan with owners and a risk log.', 15),
    m('m_6', 'c_atlas', 'AGENT', 'I created a task for this and started working on it. You can follow progress below.', 14, { kind: 'EXECUTION', taskId: 't_102' }),
    m('m_7', 'c_iris', 'USER', 'What drove the increase in billing tickets last month?', 3 * 1440 + 5),
    m('m_8', 'c_iris', 'AGENT', 'Most of the increase follows the **invoice template change on Oct 7**: 412 billing tickets mention "VAT". I recommend a VAT explainer macro linked from the invoice email.', 3 * 1440, { metadata: { sources: [{ title: 'Support macros export', url: null }] } }),
  ];
  return { conversations, messages };
}

// ------------------------------------------------------------ notifications
function buildNotifications(): NotificationDto[] {
  return [
    { id: 'n_1', type: 'APPROVAL_REQUESTED', title: 'Approval needed: draft pull request', body: 'Forge wants to open a draft PR in northwind/crewdesk-api.', link: '/approvals/ap_1', readAt: null, createdAt: ago(31) },
    { id: 'n_2', type: 'APPROVAL_REQUESTED', title: 'Approval needed: post to #leadership', body: 'Iris wants to post the weekly KPI digest.', link: '/approvals/ap_2', readAt: null, createdAt: ago(48) },
    { id: 'n_3', type: 'TASK_FAILED', title: 'Task failed: Dependency vulnerability sweep', body: 'Model request timed out after 3 attempts.', link: '/tasks/t_108', readAt: null, createdAt: ago(4 * 60) },
    { id: 'n_4', type: 'WORKFLOW_COMPLETED', title: 'Workflow finished: Research → Review → Approve → Document', body: 'EU AI Act obligations report is ready.', link: '/workflows/executions/wx_1', readAt: ago(1000), createdAt: ago(1440) },
    { id: 'n_5', type: 'TASK_COMPLETED', title: 'Task completed: Competitive analysis', body: 'Nova produced 2 artifacts.', link: '/tasks/t_101', readAt: ago(2 * 1440), createdAt: ago(2 * 1440 + 180) },
    { id: 'n_6', type: 'BUDGET_WARNING', title: 'Budget warning: Sentinel daily limit', body: 'Sentinel used 100% of its $5.00 daily budget.', link: '/analytics', readAt: null, createdAt: ago(5 * 60) },
    { id: 'n_7', type: 'HUMAN_TASK', title: 'Workflow step assigned to you', body: 'Notify project owner (Plan → Draft tasks → Approve → Notify).', link: '/workflows/executions/wx_2', readAt: ago(60), createdAt: ago(65) },
  ];
}

// -------------------------------------------------------------------- audit
function buildAudit(): AuditLogDto[] {
  const agentActor = (id: string, name: string) => ({ actor: { id, name }, actorType: 'AGENT' as const });
  const user = (u: { id: string; name: string }) => ({ actor: u, actorType: 'USER' as const });
  const rows: Array<Omit<AuditLogDto, 'id' | 'createdAt' | 'ip'> & { minAgo: number }> = [
    { action: 'task.created', resourceType: 'task', resourceId: 't_103', metadata: { title: 'Release notes draft for v2.0', agent: 'Scribe' }, ...user(ME), minAgo: 6 },
    { action: 'task.created', resourceType: 'task', resourceId: 't_102', metadata: { title: 'Launch plan: milestones and owners for v2.0' }, ...user(ME), minAgo: 14 },
    { action: 'approval.requested', resourceType: 'approval', resourceId: 'ap_1', metadata: { tool: 'github.pr_draft', risk: 'MEDIUM' }, ...agentActor('a_forge', 'Forge'), minAgo: 31 },
    { action: 'task.created', resourceType: 'task', resourceId: 't_104', metadata: { title: 'Open draft PR: rate-limit retry backoff' }, ...user(MARCO), minAgo: 38 },
    { action: 'approval.requested', resourceType: 'approval', resourceId: 'ap_2', metadata: { tool: 'message.send', risk: 'HIGH' }, ...agentActor('a_iris', 'Iris'), minAgo: 48 },
    { action: 'auth.login', resourceType: 'user', resourceId: ME.id, metadata: null, ...user(ME), minAgo: 58 },
    { action: 'workflow.approval.requested', resourceType: 'workflowExecution', resourceId: 'wx_2', metadata: { node: 'approve' }, actor: null, actorType: 'SYSTEM', minAgo: 64 },
    { action: 'workflow.executed', resourceType: 'workflow', resourceId: 'wf_plan', metadata: { executionId: 'wx_2', version: 1 }, ...user(PRIYA), minAgo: 72 },
    { action: 'task.paused', resourceType: 'task', resourceId: 't_107', metadata: { reason: 'Waiting for new refund policy' }, ...user(LENA), minAgo: 180 },
    { action: 'task.failed', resourceType: 'task', resourceId: 't_108', metadata: { failureClass: 'TIMEOUT', attempts: 3 }, actor: null, actorType: 'SYSTEM', minAgo: 4 * 60 },
    { action: 'budget.exceeded', resourceType: 'budgetPolicy', resourceId: 'b_4', metadata: { scope: 'AGENT', agent: 'Sentinel', limitUsd: 5 }, actor: null, actorType: 'SYSTEM', minAgo: 5 * 60 },
    { action: 'agent.updated', resourceType: 'agent', resourceId: 'a_scribe', metadata: { version: 3, changeSummary: 'Output format: changelog sections' }, ...user(MARCO), minAgo: 9 * 60 },
    { action: 'knowledge.created', resourceType: 'knowledgeSource', resourceId: 'k_status', metadata: { type: 'URL', url: 'https://status.example.com/history' }, ...user(ME), minAgo: 15 },
    { action: 'task.completed', resourceType: 'task', resourceId: 't_124', metadata: { durationMs: 240000 }, ...agentActor('a_scribe', 'Scribe'), minAgo: 1440 + 16 },
    { action: 'approval.approved', resourceType: 'approval', resourceId: 'ap_6', metadata: { risk: 'HIGH' }, ...user(ME), minAgo: 1440 + 40 },
    { action: 'workflow.executed', resourceType: 'workflow', resourceId: 'wf_research', metadata: { executionId: 'wx_1', version: 2 }, ...user(ME), minAgo: 1440 + 85 },
    { action: 'task.cancel', resourceType: 'task', resourceId: 't_112', metadata: { reason: 'Superseded by release freeze' }, ...user(ME), minAgo: 1440 + 25 },
    { action: 'artifact.downloaded', resourceType: 'artifact', resourceId: 'ar_1', metadata: { name: 'competitive-analysis-meeting-assistants.md' }, ...user(PRIYA), minAgo: 2 * 1440 },
    { action: 'task.completed', resourceType: 'task', resourceId: 't_101', metadata: { artifacts: 2 }, ...agentActor('a_nova', 'Nova'), minAgo: 2 * 1440 + 190 },
    { action: 'member.role_changed', resourceType: 'member', resourceId: 'u_sam', metadata: { from: 'VIEWER', to: 'APPROVER' }, ...user(ME), minAgo: 2 * 1440 + 600 },
    { action: 'knowledge.failed', resourceType: 'knowledgeSource', resourceId: 'k_wiki', metadata: { reason: 'Unsupported archive format' }, actor: null, actorType: 'SYSTEM', minAgo: 3 * 1440 },
    { action: 'workflow.execution.failed', resourceType: 'workflowExecution', resourceId: 'wx_3', metadata: { node: 'draft' }, actor: null, actorType: 'SYSTEM', minAgo: 3 * 1440 + 10 },
    { action: 'task.failed', resourceType: 'task', resourceId: 't_118', metadata: { failureClass: 'PERMISSION', tool: 'repo.metadata' }, actor: null, actorType: 'SYSTEM', minAgo: 3 * 1440 + 398 },
    { action: 'integration.check_failed', resourceType: 'integration', resourceId: 'i_webhook', metadata: { status: 404 }, actor: null, actorType: 'SYSTEM', minAgo: 3 * 1440 + 700 },
    { action: 'approval.approved', resourceType: 'approval', resourceId: 'ap_4', metadata: { risk: 'MEDIUM' }, ...user(PRIYA), minAgo: 4 * 1440 + 100 },
    { action: 'agent.paused', resourceType: 'agent', resourceId: 'a_echo', metadata: null, ...user(LENA), minAgo: 4 * 1440 + 200 },
    { action: 'budget.updated', resourceType: 'budgetPolicy', resourceId: 'b_1', metadata: { scope: 'WORKSPACE', period: 'MONTHLY', hardLimitUsd: 250 }, ...user(ME), minAgo: 6 * 1440 },
    { action: 'workflow.updated', resourceType: 'workflow', resourceId: 'wf_triage', metadata: { version: 3 }, ...user(MARCO), minAgo: 9 * 1440 },
    { action: 'approval.rejected', resourceType: 'approval', resourceId: 'ap_5', metadata: { comment: 'I will announce this in the team meeting instead.' }, ...user(SAM), minAgo: 8 * 1440 - 30 },
    { action: 'member.invited', resourceType: 'workspace', resourceId: GUEST_WORKSPACE_ID, metadata: { email: 'devon@example.com', role: 'TASK_OPERATOR' }, ...user(PRIYA), minAgo: 10 * 1440 },
    { action: 'integration.configured', resourceType: 'integration', resourceId: 'i_github', metadata: { provider: 'github' }, ...user(ME), minAgo: 30 * 1440 },
    { action: 'agent.created', resourceType: 'agent', resourceId: 'a_sentinel', metadata: { category: 'SECURITY_REVIEWER' }, ...user(ME), minAgo: 33 * 1440 },
    { action: 'agent.created', resourceType: 'agent', resourceId: 'a_forge', metadata: { category: 'CODE_ASSISTANT' }, ...user(MARCO), minAgo: 41 * 1440 },
    { action: 'agent.archived', resourceType: 'agent', resourceId: 'a_relay', metadata: null, ...user(ME), minAgo: 12 * 1440 },
    { action: 'workspace.updated', resourceType: 'workspace', resourceId: GUEST_WORKSPACE_ID, metadata: { maxConcurrentTasks: 10 }, ...user(ME), minAgo: 50 * 1440 },
  ];
  return rows
    .map(({ minAgo, ...r }, i) => ({ ...r, id: `al_${i + 1}`, ip: r.actorType === 'USER' ? '203.0.113.24' : null, createdAt: ago(minAgo) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ------------------------------------------------------------------ assemble
export function createGuestDb(): GuestDb {
  const { agents, versions } = buildAgents();
  const tasks = TASK_SPECS.map((s) => buildTask(s, agents));
  const events: Record<string, ExecutionEventDto[]> = {};
  for (const t of tasks) events[t.id] = buildEvents(t);
  const artifacts = buildArtifacts(tasks, agents);
  for (const t of tasks) t.artifactCount = artifacts.filter((a) => a.taskId === t.id).length;
  tasks.find((t) => t.id === 't_102')!.conversationId = 'c_atlas';
  const { workflows, versions: workflowVersions, executions } = buildWorkflows();
  const { conversations, messages } = buildConversations();
  return {
    user: { ...GUEST_USER },
    workspace: { ...GUEST_WORKSPACES[0]! },
    projects: [
      { id: 'p_launch', workspaceId: GUEST_WORKSPACE_ID, name: P_LAUNCH.name, description: 'Everything needed to ship v2.0 (workflows, approvals, EU hosting) by end of quarter.', createdAt: ago(100 * 1440), updatedAt: ago(2 * 1440) },
      { id: 'p_support', workspaceId: GUEST_WORKSPACE_ID, name: P_SUPPORT.name, description: 'Cut first response time below 2 hours and refresh macros and FAQ.', createdAt: ago(70 * 1440), updatedAt: ago(3 * 1440) },
      { id: 'p_platform', workspaceId: GUEST_WORKSPACE_ID, name: P_PLATFORM.name, description: 'Retry/backoff hardening, dependency hygiene and access reviews.', createdAt: ago(50 * 1440), updatedAt: ago(1440) },
    ],
    agents,
    agentVersions: versions,
    tasks,
    events,
    artifacts,
    approvals: buildApprovals(agents, tasks),
    workflows,
    workflowVersions,
    executions,
    knowledge: buildKnowledge(),
    conversations,
    messages,
    notifications: buildNotifications(),
    audit: buildAudit(),
    members: [
      { id: 'wm_1', userId: ME.id, name: ME.name, email: GUEST_USER.email, role: 'OWNER', joinedAt: ago(120 * 1440) },
      { id: 'wm_2', userId: PRIYA.id, name: PRIYA.name, email: 'priya@example.com', role: 'ADMIN', joinedAt: ago(118 * 1440) },
      { id: 'wm_3', userId: MARCO.id, name: MARCO.name, email: 'marco@example.com', role: 'AGENT_MANAGER', joinedAt: ago(100 * 1440) },
      { id: 'wm_4', userId: LENA.id, name: LENA.name, email: 'lena@example.com', role: 'TASK_OPERATOR', joinedAt: ago(70 * 1440) },
      { id: 'wm_5', userId: SAM.id, name: SAM.name, email: 'sam@example.com', role: 'APPROVER', joinedAt: ago(40 * 1440) },
      { id: 'wm_6', userId: 'u_jules', name: 'Jules Moreau', email: 'jules@example.com', role: 'VIEWER', joinedAt: ago(14 * 1440) },
    ],
    invites: [{ id: 'wi_1', email: 'devon@example.com', role: 'TASK_OPERATOR', createdAt: ago(10 * 1440) }],
    budgets: [
      { id: 'b_1', scope: 'WORKSPACE', scopeId: null, period: 'MONTHLY', hardLimitUsd: 250, warningRatio: 0.8, maxTokens: null, enabled: true },
      { id: 'b_2', scope: 'AGENT', scopeId: 'a_nova', period: 'MONTHLY', hardLimitUsd: 40, warningRatio: 0.75, maxTokens: 8_000_000, enabled: true },
      { id: 'b_3', scope: 'PROJECT', scopeId: 'p_launch', period: 'TOTAL', hardLimitUsd: 150, warningRatio: 0.8, maxTokens: null, enabled: true },
      { id: 'b_4', scope: 'AGENT', scopeId: 'a_sentinel', period: 'DAILY', hardLimitUsd: 5, warningRatio: 0.8, maxTokens: null, enabled: true },
    ],
    integrations: [
      { id: 'i_github', provider: 'github', name: 'GitHub (northwind)', config: { owner: 'northwind', repo: 'crewdesk-api' }, status: 'CONNECTED', lastCheckedAt: ago(20), lastError: null, createdAt: ago(30 * 1440) },
      { id: 'i_webhook', provider: 'webhook', name: 'Slack #leadership webhook', config: {}, status: 'ERROR', lastCheckedAt: ago(3 * 1440 + 700), lastError: 'Webhook endpoint returned HTTP 404 (channel archived?)', createdAt: ago(25 * 1440) },
    ],
    disabledTools: new Set(['resource.delete']),
    seq: 1000,
  };
}
