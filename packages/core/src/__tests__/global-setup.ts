import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testDatabaseUrl } from './test-env.js';

/**
 * Apply migrations to the dedicated `csai_test` schema once per run (creating it if needed).
 * Non-destructive: development data in the default schema is never touched, and tests use
 * unique fixtures so leftovers from earlier runs do not interfere.
 */
export default function globalSetup() {
  const coreDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  execSync('npx prisma migrate deploy', {
    cwd: coreDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testDatabaseUrl(), PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
}
