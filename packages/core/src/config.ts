import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

let projectRoot = process.cwd();

/** Load the first .env found walking up from cwd (monorepo root holds the shared .env). */
export function loadEnvFile(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate, quiet: true });
      projectRoot = dir;
      return candidate;
    }
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) projectRoot = dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
loadEnvFile();

/** Directory that relative paths in configuration (e.g. STORAGE_LOCAL_DIR) resolve against. */
export function getProjectRoot(): string {
  return projectRoot;
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  API_PORT: z.coerce.number().default(4120),
  API_PUBLIC_URL: z.string().default('http://localhost:4120'),
  WEB_ORIGIN: z.string().default('http://localhost:5190'),
  SESSION_SECRET: z.string().min(16).default('dev-only-session-secret-change-me'),
  CREDENTIALS_ENCRYPTION_KEY: z.string().default(''),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('csai-artifacts'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  STORAGE_LOCAL_DIR: z.string().default('.storage'),
  AI_PROVIDER: z.enum(['anthropic', 'openai', 'mock', '']).default(''),
  AI_DEFAULT_MODEL: z.string().default('claude-opus-5-5'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  EMBEDDINGS_PROVIDER: z.enum(['openai', '']).default(''),
  EMBEDDINGS_MODEL: z.string().default('text-embedding-3-small'),
  WORKER_CONCURRENCY: z.coerce.number().default(4),
  WORKSPACE_MAX_CONCURRENT_TASKS: z.coerce.number().default(5),
  TASK_DEFAULT_TIMEOUT_MS: z.coerce.number().default(600000),
  TASK_HEARTBEAT_MS: z.coerce.number().default(15000),
  TASK_STALE_AFTER_MS: z.coerce.number().default(90000),
  TASK_MAX_RETRIES: z.coerce.number().default(2),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('no-reply@collabspace.local'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetConfigForTests(): void {
  cached = null;
}

export function aiProviderConfigured(cfg: AppConfig = getConfig()): { configured: boolean; provider: string | null; reason: string | null } {
  if (!cfg.AI_PROVIDER) return { configured: false, provider: null, reason: 'AI_PROVIDER is not set' };
  if (cfg.AI_PROVIDER === 'anthropic' && !cfg.ANTHROPIC_API_KEY) return { configured: false, provider: 'anthropic', reason: 'ANTHROPIC_API_KEY is missing' };
  if (cfg.AI_PROVIDER === 'openai' && !cfg.OPENAI_API_KEY) return { configured: false, provider: 'openai', reason: 'OPENAI_API_KEY is missing' };
  return { configured: true, provider: cfg.AI_PROVIDER, reason: null };
}
