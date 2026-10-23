/**
 * Development seed: demo workspace, users for every role, the six example agents,
 * knowledge sources, a workflow template and budget policies.
 * Idempotent: re-running updates existing records instead of duplicating them.
 */
import { AGENT_TEMPLATES, type AgentCategory } from '@collabspace/shared';
import { prisma } from '../src/db.js';
import { hashPassword } from '../src/services/auth.js';
import { createAgent } from '../src/services/agents.js';
import { createTextSource } from '../src/services/knowledge.js';
import { createWorkflow, WORKFLOW_TEMPLATES } from '../src/services/workflows.js';
import { syncToolDefinitions } from '../src/tools/registry.js';
import { closeRedis } from '../src/redis.js';
import { closeQueues } from '../src/queue.js';
import { disconnectDb } from '../src/db.js';

const DEMO_PASSWORD = 'demo-password-123';

const USERS: Array<{ name: string; email: string; role: 'OWNER' | 'ADMIN' | 'AGENT_MANAGER' | 'TASK_OPERATOR' | 'APPROVER' | 'VIEWER' }> = [
  { name: 'Olivia Owner', email: 'owner@demo.local', role: 'OWNER' },
  { name: 'Adam Admin', email: 'admin@demo.local', role: 'ADMIN' },
  { name: 'Maya Manager', email: 'manager@demo.local', role: 'AGENT_MANAGER' },
  { name: 'Omar Operator', email: 'operator@demo.local', role: 'TASK_OPERATOR' },
  { name: 'Ava Approver', email: 'approver@demo.local', role: 'APPROVER' },
  { name: 'Vic Viewer', email: 'viewer@demo.local', role: 'VIEWER' },
];

const AGENTS: Array<{ name: string; category: AgentCategory; description: string }> = [
  { name: 'Alex', category: 'RESEARCHER', description: 'Researches approved sources and writes evidence-based reports with citations.' },
  { name: 'Priya', category: 'PROJECT_PLANNER', description: 'Turns objectives into milestones, task drafts, dependencies and risks.' },
  { name: 'Quinn', category: 'QA_REVIEWER', description: 'Reviews requirements and deliverables, writes test cases and findings.' },
  { name: 'Docu', category: 'DOCUMENTATION', description: 'Drafts READMEs, specs, API docs and release notes from approved sources.' },
  { name: 'Nova', category: 'GENERAL_ASSISTANT', description: 'Everyday assistant for questions, summaries and small deliverables.' },
  { name: 'Sage', category: 'DATA_ANALYST', description: 'Analyzes CSV data and explains trends, anomalies and statistics.' },
];

async function main() {
  await syncToolDefinitions();
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const workspace = await prisma.workspace.upsert({ where: { slug: 'demo' }, create: { name: 'Demo Workspace', slug: 'demo', maxConcurrentTasks: 4, defaultAgentConcurrency: 2 }, update: {} });
  const users: Record<string, { id: string }> = {};
  for (const u of USERS) {
    const user = await prisma.user.upsert({ where: { email: u.email }, create: { email: u.email, name: u.name, passwordHash, emailVerifiedAt: new Date() }, update: { name: u.name } });
    users[u.role] = user;
    await prisma.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } }, create: { workspaceId: workspace.id, userId: user.id, role: u.role }, update: { role: u.role } });
  }
  const owner = users.OWNER!;
  const project =
    (await prisma.project.findFirst({ where: { workspaceId: workspace.id, name: 'Customer Portal Relaunch' } })) ??
    (await prisma.project.create({ data: { workspaceId: workspace.id, name: 'Customer Portal Relaunch', description: 'Relaunch of the self-service customer portal with a new onboarding flow.', members: { create: { userId: owner.id, role: 'MANAGER' } } } }));

  const agentIds: Record<string, string> = {};
  for (const a of AGENTS) {
    const existing = await prisma.agent.findFirst({ where: { workspaceId: workspace.id, name: a.name } });
    if (existing) {
      agentIds[a.category] = existing.id;
      continue;
    }
    const t = AGENT_TEMPLATES[a.category];
    const created = await createAgent(workspace.id, owner.id, {
      name: a.name,
      avatar: t.avatar,
      color: t.color,
      description: a.description,
      category: a.category,
      projectId: project.id,
      instructions: t.instructions,
      modelConfig: { provider: null, model: null, temperature: null, maxOutputTokens: 4096, timeoutMs: 600000, maxRetries: 2, maxTokensPerTask: null, budgetUsd: null },
      tools: a.category === 'RESEARCHER' ? [...t.defaultTools, 'content.publish', 'message.send', 'resource.delete'] : t.defaultTools,
      knowledge: { sourceIds: [], allowWorkspaceKnowledge: true, allowProjectDocuments: true, allowPreviousReports: a.category === 'DOCUMENTATION' },
      changeSummary: 'Seeded from template',
    });
    agentIds[a.category] = created.id;
  }

  const existingSources = await prisma.knowledgeSource.count({ where: { workspaceId: workspace.id } });
  if (existingSources === 0) {
    await createTextSource(workspace.id, owner.id, {
      title: 'Customer Portal Relaunch — Project Brief',
      projectId: project.id,
      agentIds: Object.values(agentIds),
      content: `# Customer Portal Relaunch — Project Brief

## Objective
Relaunch the self-service customer portal by Q3 with a redesigned onboarding flow, single sign-on (SSO) and a new billing page.

## Scope
- Onboarding: progressive profile completion, guided tour, email verification.
- Authentication: SSO via SAML and OIDC; passwordless magic links as fallback.
- Billing: invoice history, downloadable PDFs, payment method management.
- Support: in-app ticket creation linked to the knowledge base.

## Constraints
- Must support 50,000 monthly active users with p95 page load under 1.5 seconds.
- WCAG 2.2 AA accessibility is mandatory.
- Data residency: EU customers must be served from the Frankfurt region.

## Stakeholders
- Product owner: Dana Reyes.
- Engineering lead: Sam Okafor.
- Support lead: Lina Haddad.

## Risks
- SSO integration depends on the identity provider vendor roadmap (medium risk).
- Billing PDF generation library licence renewal pending (low risk).
- Onboarding copy requires legal review (medium risk).`,
    });
    await createTextSource(workspace.id, owner.id, {
      title: 'Cloud Storage Vendor Comparison Notes',
      projectId: project.id,
      agentIds: Object.values(agentIds),
      content: `# Cloud storage vendor comparison (internal notes, April)

| Vendor | Price per GB-month | Egress per GB | Regions | SLA |
| --- | --- | --- | --- | --- |
| NorthCloud Object Store | $0.021 | $0.08 | 12 (incl. Frankfurt) | 99.95% |
| Harbor Storage | $0.019 | $0.10 | 8 (no EU region) | 99.9% |
| Meridian Blob | $0.023 | $0.05 | 20 (incl. Frankfurt, Dublin) | 99.99% |

Observations:
- Meridian Blob has the lowest egress cost which matters for invoice PDF downloads.
- Harbor Storage cannot satisfy the EU data residency constraint.
- NorthCloud offers lifecycle rules that would reduce storage cost for archived invoices by roughly 40%.

Open questions: Meridian enterprise discount tiers; NorthCloud support response times.`,
    });
    await createTextSource(workspace.id, owner.id, {
      title: 'Login Requirements v2',
      projectId: project.id,
      agentIds: Object.values(agentIds),
      content: `# Login requirements v2

1. Users can sign in with email and password.
2. After five failed attempts within ten minutes the account is locked for fifteen minutes.
3. SSO users are redirected to their identity provider; local passwords are disabled for them.
4. Sessions expire after fourteen days of inactivity.
5. Password reset links expire after one hour.
6. All login events are written to the audit log with IP address and user agent.

Acceptance criteria are missing for: locked-account messaging, SSO failure fallback, and accessibility of the lock-out notice.`,
    });
  }

  const existingWorkflows = await prisma.workflow.count({ where: { workspaceId: workspace.id } });
  if (existingWorkflows === 0) {
    for (const t of WORKFLOW_TEMPLATES) {
      await createWorkflow(workspace.id, owner.id, { name: t.name, description: t.description, projectId: project.id, graph: t.graph(agentIds), changeSummary: 'Seeded template', isTemplate: true });
    }
  }

  const existingBudget = await prisma.budgetPolicy.findFirst({ where: { workspaceId: workspace.id, scope: 'WORKSPACE', period: 'MONTHLY' } });
  if (!existingBudget) await prisma.budgetPolicy.create({ data: { workspaceId: workspace.id, scope: 'WORKSPACE', period: 'MONTHLY', hardLimitUsd: 50, warningRatio: 0.8 } });

  console.log('Seed complete.');
  console.log(`Workspace: ${workspace.name} (${workspace.slug})`);
  for (const u of USERS) console.log(`  ${u.role.padEnd(14)} ${u.email}  /  ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueues();
    await closeRedis();
    await disconnectDb();
  });
