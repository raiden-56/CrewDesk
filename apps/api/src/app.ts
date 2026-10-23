import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { getConfig, logger } from '@collabspace/core';
import { attachAuth, csrfGuard, limiter, requireAuth, requireWorkspace } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { buildOpenApiDocument } from './openapi.js';
import { agentsRouter } from './routes/agents.js';
import { approvalsRouter } from './routes/approvals.js';
import { artifactsRouter } from './routes/artifacts.js';
import { auditRouter } from './routes/audit.js';
import { authRouter } from './routes/auth.js';
import { conversationsRouter } from './routes/conversations.js';
import { integrationsRouter } from './routes/integrations.js';
import { knowledgeRouter } from './routes/knowledge.js';
import { notificationsRouter } from './routes/notifications.js';
import { systemRouter } from './routes/system.js';
import { tasksRouter } from './routes/tasks.js';
import { toolsRouter } from './routes/tools.js';
import { usageRouter } from './routes/usage.js';
import { workflowsRouter } from './routes/workflows.js';
import { workspacesRouter } from './routes/workspaces.js';

export function createApp() {
  const cfg = getConfig();
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, _res, next) => {
    req.requestId = req.header('x-request-id') ?? randomUUID();
    req.validated = {};
    next();
  });
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: cfg.WEB_ORIGIN, credentials: true, exposedHeaders: ['X-Request-Id', 'Content-Disposition'] }));
  app.use((req, res, next) => {
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });
  app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).requestId, autoLogging: { ignore: (req) => req.url === '/api/v1/health' }, customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info') }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(attachAuth);
  app.use(csrfGuard);

  const doc = buildOpenApiDocument();
  app.get('/api/openapi.json', (_req, res) => res.json(doc));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(doc, { customSiteTitle: 'CollabSpace AI Team API' }));

  const v1 = express.Router();
  v1.use('/health', systemRouter);
  v1.use('/auth', authRouter);
  v1.use(requireAuth, limiter({ key: (req) => `user:${req.auth?.userId}`, limit: 600, windowSec: 60 }));
  v1.use('/workspaces', workspacesRouter);
  v1.use('/notifications', notificationsRouter);
  // workspace-scoped resources
  v1.use(requireWorkspace);
  v1.use('/agents', agentsRouter);
  v1.use('/agent-tasks', tasksRouter);
  v1.use('/approvals', approvalsRouter);
  v1.use('/workflows', workflowsRouter);
  v1.use('/knowledge-sources', knowledgeRouter);
  v1.use('/artifacts', artifactsRouter);
  v1.use('/conversations', conversationsRouter);
  v1.use('/usage', usageRouter);
  v1.use('/audit-logs', auditRouter);
  v1.use('/integrations', integrationsRouter);
  v1.use('/tools', toolsRouter);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
