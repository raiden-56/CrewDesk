import { createServer } from 'node:http';
import { closeQueues, closeRedis, disconnectDb, getConfig, getStorage, logger, registerBuiltinTools, syncToolDefinitions } from '@collabspace/core';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';

async function main() {
  const cfg = getConfig();
  registerBuiltinTools();
  await syncToolDefinitions();
  const storage = await getStorage().health();
  if (!storage.ok) logger.warn({ message: storage.message }, 'object storage is not healthy; artifact operations will fail until fixed');
  const app = createApp();
  const server = createServer(app);
  attachRealtime(server);
  server.listen(cfg.API_PORT, () => {
    logger.info({ port: cfg.API_PORT, web: cfg.WEB_ORIGIN, provider: cfg.AI_PROVIDER || 'not configured', storage: storage.message }, 'api listening');
  });
  const shutdown = async () => {
    server.close();
    await closeQueues();
    await closeRedis();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  logger.error({ err }, 'api failed to start');
  process.exit(1);
});
