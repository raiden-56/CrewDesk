import { PrismaClient } from '@prisma/client';
import { getConfig } from './config.js';

declare global {
  // eslint-disable-next-line no-var
  var __csaiPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__csaiPrisma ??
  new PrismaClient({
    log: getConfig().NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (getConfig().NODE_ENV !== 'production') globalThis.__csaiPrisma = prisma;

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
