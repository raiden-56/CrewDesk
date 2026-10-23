// Runs the Prisma CLI with the monorepo root .env loaded (Prisma only reads .env next to the schema).
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { config } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
let dir = here;
for (let i = 0; i < 5; i++) {
  const candidate = join(dir, '.env');
  if (existsSync(candidate)) {
    config({ path: candidate, quiet: true });
    break;
  }
  dir = dirname(dir);
}
const args = process.argv.slice(2);
const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['prisma', ...args], { stdio: 'inherit', env: process.env, shell: true, cwd: join(here, '..') });
process.exit(result.status ?? 1);
