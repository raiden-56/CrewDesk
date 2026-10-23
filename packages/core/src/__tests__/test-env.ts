import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** DATABASE_URL from the environment or the monorepo .env, pointed at the `csai_test` schema. */
export function testDatabaseUrl(): string {
  let url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    let dir = process.cwd();
    for (let i = 0; i < 6 && !url; i++) {
      const candidate = join(dir, '.env');
      if (existsSync(candidate)) url = /^DATABASE_URL=(.+)$/m.exec(readFileSync(candidate, 'utf8'))?.[1]?.trim();
      dir = dirname(dir);
    }
  }
  if (!url) throw new Error('DATABASE_URL (or TEST_DATABASE_URL) is required for integration tests');
  const parsed = new URL(url);
  parsed.searchParams.set('schema', 'csai_test');
  return parsed.toString();
}
