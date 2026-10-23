import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import { testDatabaseUrl } from './test-env.js';

// Must run before @collabspace/core is imported: dotenv never overrides variables already set.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.AI_PROVIDER = 'mock';
process.env.EMBEDDINGS_PROVIDER = '';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = mkdtempSync(join(tmpdir(), 'csai-test-'));
process.env.SMTP_URL = '';

// Same boot sequence as the API and worker: tool adapters in memory, catalog rows in the database.
beforeAll(async () => {
  const core = await import('../index.js');
  core.registerBuiltinTools();
  await core.syncToolDefinitions();
});

afterAll(async () => {
  const core = await import('../index.js');
  await core.closeQueues().catch(() => undefined);
  await core.prisma.$disconnect();
});
