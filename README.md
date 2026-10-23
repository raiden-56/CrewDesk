# CollabSpace AI Team

Create AI team members (agents), give them tools and knowledge, assign them tasks, chain them into workflows, and keep humans in control through approvals, budgets and an audit trail.

## Stack

| Part | Location | Tech |
| --- | --- | --- |
| Web app | `apps/web` | React 19, Vite, MUI + Tailwind, TanStack Query, React Flow, Recharts |
| API | `apps/api` | Express, session cookies, Socket.IO realtime, OpenAPI at `/api/docs` |
| Worker | `apps/worker` | BullMQ: agent tasks, workflows, knowledge ingestion, chat, maintenance |
| Core | `packages/core` | Prisma (Postgres), AI providers, tool adapters, execution engine |
| Shared | `packages/shared` | Types, zod schemas, permissions, tool catalog, workflow validation |

## Getting started

Requirements: Node 20+, pnpm 10, Docker.

```bash
cp .env.example .env          # AI_PROVIDER=mock works with no API key
pnpm run setup                # install, start Postgres/Redis/MinIO, migrate, seed
pnpm dev                      # API :4120, worker, web :5190
```

Open http://localhost:5190. Set `STORAGE_DRIVER=local` in `.env` if you don't run MinIO (`docker compose up -d postgres redis`).

### Demo accounts

All use the password `demo-password-123`:

| Role | Email |
| --- | --- |
| Owner | `owner@demo.local` |
| Admin | `admin@demo.local` |
| Agent manager | `manager@demo.local` |
| Task operator | `operator@demo.local` |
| Approver | `approver@demo.local` |
| Viewer | `viewer@demo.local` |

### AI provider

`AI_PROVIDER=mock` is deterministic and offline; the UI labels it clearly. For real output set `AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY`, or `AI_PROVIDER=openai` with `OPENAI_API_KEY`.

## What's in the app

- **Overview**: live metrics, team cards, task throughput, pending approvals, recent tasks.
- **AI Team Members**: create/edit agents with the 6-step wizard (role template, instructions, model, tools, knowledge, sandbox test); pause, resume, duplicate, archive, delete; per-agent tasks, activity, version history.
- **Tasks**: filter, sort, bulk-cancel; task drawer with live execution timeline (CSV/JSON export), result, artifacts, retry/duplicate/publish draft.
- **Agent Workflows**: visual editor (agent, prompt, tool, condition, approval, parallel/merge, delay, human task), validation, versions, dry runs, live execution view with pause/resume/cancel and human-task completion.
- **Approval Center**: exact proposal, diff and evidence; approve, reject or request changes (bound to the proposal version and risk-based roles).
- **Knowledge Base**: approved URLs, pasted text and uploads; per-agent access; re-index, revoke; retrieval test.
- **Files**: agent reports and uploads with preview (Markdown, CSV, JSON, text), download, duplicate, delete.
- **Activity History**, **Analytics** (usage, estimated cost, budgets), **Tools**, **Integrations** (GitHub, outbound webhook), **Settings** (profile, workspace, members, projects, budgets, system status).
- Chat panel (conversation or task mode), global search (Ctrl/⌘+K), notifications, light/dark theme.

## Tests

```bash
pnpm test             # shared unit, web unit, core integration (uses the csai_test schema)
pnpm test:e2e         # Playwright, against a running `pnpm dev` stack with the demo seed
```

Core integration tests migrate and use a separate `csai_test` Postgres schema, so development data is untouched. E2E tests create uniquely named records in the development database.

## Useful commands

```bash
pnpm typecheck        # all packages
pnpm build            # typecheck + web production build
pnpm db:migrate       # create/apply migrations (dev)
pnpm db:seed          # (re)seed demo data; idempotent
```
