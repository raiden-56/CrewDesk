import { Router } from 'express';
import { BulkCancelSchema, CreateTaskSchema, EventsQuery, TaskListQuery, type CreateTaskInput } from '@collabspace/shared';
import { createTask, duplicateTask, Errors, prisma, publishDraftTask, requestCancel, retryTask, taskInclude, toArtifactDto, toEventDto, toTaskDto, audit } from '@collabspace/core';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import type { z } from 'zod';
import { hasPermission, requirePermission } from '../middleware/auth.js';
import { body, query, validate } from '../middleware/validate.js';

export const tasksRouter = Router();

const artifactInclude = { agent: { select: { id: true, name: true, avatar: true, color: true } }, createdBy: { select: { id: true, name: true } } } as const;

async function loadTask(req: Request) {
  const task = await prisma.agentTask.findFirst({ where: { id: req.params.id as string, workspaceId: req.ws!.workspaceId }, include: taskInclude });
  if (!task) throw Errors.notFound('Task');
  return task;
}

tasksRouter.get('/', requirePermission('task.view'), validate(TaskListQuery, 'query'), async (req, res) => {
  const q = query<z.infer<typeof TaskListQuery>>(req);
  const where: Prisma.AgentTaskWhereInput = {
    workspaceId: req.ws!.workspaceId,
    ...(q.status ? { status: q.status as Prisma.AgentTaskWhereInput['status'] } : {}),
    ...(q.agentId ? { agentId: q.agentId } : {}),
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.priority ? { priority: q.priority as Prisma.AgentTaskWhereInput['priority'] } : {}),
    ...(q.search ? { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }] } : {}),
  };
  const orderBy: Prisma.AgentTaskOrderByWithRelationInput = q.sort === 'duration' ? { durationMs: q.order } : q.sort === 'cost' ? { createdAt: q.order } : { [q.sort]: q.order };
  const [rows, total] = await Promise.all([
    prisma.agentTask.findMany({ where, include: taskInclude, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.agentTask.count({ where }),
  ]);
  res.json({ items: await Promise.all(rows.map(toTaskDto)), page: q.page, pageSize: q.pageSize, total });
});

tasksRouter.post('/', requirePermission('task.create'), validate(CreateTaskSchema), async (req, res) => {
  const input = body<CreateTaskInput>(req);
  const { task, duplicate } = await createTask(req.ws!.workspaceId, req.auth!.userId, input);
  res.status(duplicate ? 200 : 201).json(task);
});

tasksRouter.post('/bulk-cancel', requirePermission('task.cancel'), validate(BulkCancelSchema), async (req, res) => {
  const { taskIds } = body<{ taskIds: string[] }>(req);
  const tasks = await prisma.agentTask.findMany({ where: { id: { in: taskIds }, workspaceId: req.ws!.workspaceId }, select: { id: true, status: true } });
  const results: Array<{ id: string; ok: boolean; message?: string }> = [];
  for (const t of tasks) {
    try {
      await requestCancel(t.id, req.auth!.userId);
      results.push({ id: t.id, ok: true });
    } catch (err) {
      results.push({ id: t.id, ok: false, message: (err as Error).message });
    }
  }
  await audit({ workspaceId: req.ws!.workspaceId, actorId: req.auth!.userId, action: 'task.bulk_cancel', resourceType: 'task', metadata: { taskIds, results }, requestId: req.requestId });
  res.json({ results });
});

tasksRouter.get('/:id', requirePermission('task.view'), async (req, res) => {
  res.json(await toTaskDto(await loadTask(req)));
});

tasksRouter.post('/:id/cancel', requirePermission('task.cancel'), async (req, res) => {
  const task = await loadTask(req);
  const result = await requestCancel(task.id, req.auth!.userId);
  await audit({ workspaceId: req.ws!.workspaceId, actorId: req.auth!.userId, action: 'task.cancel', resourceType: 'task', resourceId: task.id, metadata: result, requestId: req.requestId });
  res.json({ ...result, task: await toTaskDto(await loadTask(req)) });
});

tasksRouter.post('/:id/retry', requirePermission('task.retry'), async (req, res) => {
  const task = await loadTask(req);
  await retryTask(task.id, req.auth!.userId);
  await audit({ workspaceId: req.ws!.workspaceId, actorId: req.auth!.userId, action: 'task.retry', resourceType: 'task', resourceId: task.id, requestId: req.requestId });
  res.json(await toTaskDto(await loadTask(req)));
});

tasksRouter.post('/:id/duplicate', requirePermission('task.create'), async (req, res) => {
  const task = await loadTask(req);
  const { task: copy } = await duplicateTask(req.ws!.workspaceId, task.id, req.auth!.userId);
  res.status(201).json(copy);
});

tasksRouter.post('/:id/publish', requirePermission('task.create'), async (req, res) => {
  const task = await loadTask(req);
  res.json(await publishDraftTask(req.ws!.workspaceId, task.id, req.auth!.userId));
});

tasksRouter.get('/:id/events', requirePermission('task.view'), validate(EventsQuery, 'query'), async (req, res) => {
  const task = await loadTask(req);
  const q = query<z.infer<typeof EventsQuery>>(req);
  const rows = await prisma.executionEvent.findMany({
    where: {
      taskId: task.id,
      ...(q.type ? { type: q.type } : {}),
      ...(q.level ? { level: q.level as Prisma.ExecutionEventWhereInput['level'] } : {}),
      ...(q.search ? { message: { contains: q.search, mode: 'insensitive' } } : {}),
    },
    orderBy: { sequence: 'asc' },
  });
  const includeDiagnostics = hasPermission(req, 'audit.view.diagnostics');
  const items = rows.map((e) => toEventDto(e, includeDiagnostics));
  if (q.format === 'csv') {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['sequence,timestamp,type,level,message,durationMs,metadata', ...items.map((e) => [e.sequence, e.createdAt, e.type, e.level, esc(e.message), e.durationMs ?? '', esc(JSON.stringify(e.metadata ?? {}))].join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="task-${task.id}-events.csv"`);
    res.send(csv);
    return;
  }
  if (q.format === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="task-${task.id}-events.json"`);
  }
  res.json({ items, includeDiagnostics });
});

tasksRouter.get('/:id/artifacts', requirePermission('task.view'), async (req, res) => {
  const task = await loadTask(req);
  const rows = await prisma.artifact.findMany({ where: { taskId: task.id, deletedAt: null }, include: artifactInclude, orderBy: { createdAt: 'asc' } });
  res.json({ items: rows.map(toArtifactDto) });
});

tasksRouter.get('/:id/invocations', requirePermission('task.view'), async (req, res) => {
  const task = await loadTask(req);
  const rows = await prisma.toolInvocation.findMany({ where: { taskId: task.id }, orderBy: { createdAt: 'asc' }, include: { tool: { select: { name: true, category: true, risk: true } } } });
  const includeDiagnostics = hasPermission(req, 'audit.view.diagnostics');
  res.json({
    items: rows.map((i) => ({ id: i.id, toolId: i.toolId, toolName: i.tool.name, category: i.tool.category, risk: i.tool.risk, status: i.status, input: includeDiagnostics ? i.input : undefined, output: includeDiagnostics ? i.output : undefined, errorMessage: i.errorMessage, approvalId: i.approvalId, durationMs: i.durationMs, createdAt: i.createdAt.toISOString(), completedAt: i.completedAt?.toISOString() ?? null })),
  });
});

tasksRouter.get('/:id/executions', requirePermission('task.view'), async (req, res) => {
  const task = await loadTask(req);
  const rows = await prisma.agentExecution.findMany({ where: { taskId: task.id }, orderBy: { attempt: 'asc' } });
  res.json({ items: rows.map((e) => ({ id: e.id, attempt: e.attempt, status: e.status, workerId: e.workerId, errorMessage: e.errorMessage, failureClass: e.failureClass, startedAt: e.startedAt.toISOString(), heartbeatAt: e.heartbeatAt.toISOString(), completedAt: e.completedAt?.toISOString() ?? null })) });
});
