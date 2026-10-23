import { Router } from 'express';
import { CreateWorkflowSchema, ExecuteWorkflowSchema, UpdateWorkflowSchema, WorkflowGraphSchema, type WorkflowGraph } from '@collabspace/shared';
import { audit, cancelWorkflowExecution, completeHumanTask, createWorkflow, duplicateWorkflow, Errors, executeWorkflow, getExecution, listExecutions, listVersions, pauseWorkflowExecution, prisma, toWorkflowDto, updateWorkflow, validateWorkflow, workflowInclude, WORKFLOW_TEMPLATES } from '@collabspace/core';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth.js';
import { body, validate } from '../middleware/validate.js';

export const workflowsRouter = Router();

workflowsRouter.get('/templates', requirePermission('workflow.view'), async (req, res) => {
  const agents = await prisma.agent.findMany({ where: { workspaceId: req.ws!.workspaceId, archivedAt: null }, select: { id: true, category: true } });
  const ids: Record<string, string> = {};
  for (const a of agents) if (!ids[a.category]) ids[a.category] = a.id;
  res.json({ items: WORKFLOW_TEMPLATES.map((t) => ({ name: t.name, description: t.description, graph: t.graph(ids) })) });
});

workflowsRouter.get('/', requirePermission('workflow.view'), async (req, res) => {
  const rows = await prisma.workflow.findMany({ where: { workspaceId: req.ws!.workspaceId, archivedAt: null }, include: workflowInclude, orderBy: { updatedAt: 'desc' } });
  res.json({ items: rows.map(toWorkflowDto) });
});

workflowsRouter.post('/', requirePermission('workflow.edit'), validate(CreateWorkflowSchema), async (req, res) => {
  res.status(201).json(await createWorkflow(req.ws!.workspaceId, req.auth!.userId, body<z.infer<typeof CreateWorkflowSchema>>(req)));
});

workflowsRouter.get('/executions/:executionId', requirePermission('workflow.view'), async (req, res) => {
  res.json(await getExecution(req.ws!.workspaceId, req.params.executionId as string));
});

workflowsRouter.post('/executions/:executionId/cancel', requirePermission('workflow.execute'), async (req, res) => {
  await cancelWorkflowExecution(req.params.executionId as string, req.ws!.workspaceId);
  await audit({ workspaceId: req.ws!.workspaceId, actorId: req.auth!.userId, action: 'workflow.execution.cancelled', resourceType: 'workflowExecution', resourceId: req.params.executionId as string, requestId: req.requestId });
  res.json(await getExecution(req.ws!.workspaceId, req.params.executionId as string));
});

workflowsRouter.post('/executions/:executionId/pause', requirePermission('workflow.execute'), async (req, res) => {
  await pauseWorkflowExecution(req.params.executionId as string, req.ws!.workspaceId, false);
  res.json(await getExecution(req.ws!.workspaceId, req.params.executionId as string));
});

workflowsRouter.post('/executions/:executionId/resume', requirePermission('workflow.execute'), async (req, res) => {
  await pauseWorkflowExecution(req.params.executionId as string, req.ws!.workspaceId, true);
  res.json(await getExecution(req.ws!.workspaceId, req.params.executionId as string));
});

workflowsRouter.post('/executions/:executionId/nodes/:nodeId/complete', requirePermission('workflow.execute'), validate(z.object({ note: z.string().max(4000).optional() })), async (req, res) => {
  const execution = await prisma.workflowExecution.findFirst({ where: { id: req.params.executionId as string, workspaceId: req.ws!.workspaceId } });
  if (!execution) throw Errors.notFound('Workflow execution');
  await completeHumanTask(execution.id, req.params.nodeId as string, req.auth!.userId, body<{ note?: string }>(req).note ?? null);
  await audit({ workspaceId: req.ws!.workspaceId, actorId: req.auth!.userId, action: 'workflow.human_task.completed', resourceType: 'workflowExecution', resourceId: execution.id, metadata: { nodeId: req.params.nodeId }, requestId: req.requestId });
  res.json(await getExecution(req.ws!.workspaceId, execution.id));
});

workflowsRouter.get('/:id', requirePermission('workflow.view'), async (req, res) => {
  const row = await prisma.workflow.findFirst({ where: { id: req.params.id as string, workspaceId: req.ws!.workspaceId }, include: workflowInclude });
  if (!row) throw Errors.notFound('Workflow');
  res.json(toWorkflowDto(row));
});

workflowsRouter.patch('/:id', requirePermission('workflow.edit'), validate(UpdateWorkflowSchema), async (req, res) => {
  res.json(await updateWorkflow(req.ws!.workspaceId, req.params.id as string, req.auth!.userId, body<z.infer<typeof UpdateWorkflowSchema>>(req)));
});

workflowsRouter.delete('/:id', requirePermission('workflow.edit'), async (req, res) => {
  const row = await prisma.workflow.findFirst({ where: { id: req.params.id as string, workspaceId: req.ws!.workspaceId } });
  if (!row) throw Errors.notFound('Workflow');
  await prisma.workflow.update({ where: { id: row.id }, data: { archivedAt: new Date() } });
  await audit({ workspaceId: req.ws!.workspaceId, actorId: req.auth!.userId, action: 'workflow.archived', resourceType: 'workflow', resourceId: row.id, requestId: req.requestId });
  res.json({ ok: true });
});

workflowsRouter.post('/:id/validate', requirePermission('workflow.view'), validate(z.object({ graph: WorkflowGraphSchema.optional() })), async (req, res) => {
  const row = await prisma.workflow.findFirst({ where: { id: req.params.id as string, workspaceId: req.ws!.workspaceId }, include: workflowInclude });
  if (!row) throw Errors.notFound('Workflow');
  const graph = body<{ graph?: WorkflowGraph }>(req).graph ?? (row.currentVersion?.graph as WorkflowGraph);
  res.json(await validateWorkflow(req.ws!.workspaceId, graph));
});

workflowsRouter.post('/:id/dry-run', requirePermission('workflow.execute'), validate(ExecuteWorkflowSchema), async (req, res) => {
  const input = body<z.infer<typeof ExecuteWorkflowSchema>>(req);
  res.status(201).json(await executeWorkflow(req.ws!.workspaceId, req.params.id as string, req.auth!.userId, input.input, true));
});

workflowsRouter.post('/:id/execute', requirePermission('workflow.execute'), validate(ExecuteWorkflowSchema), async (req, res) => {
  const input = body<z.infer<typeof ExecuteWorkflowSchema>>(req);
  res.status(201).json(await executeWorkflow(req.ws!.workspaceId, req.params.id as string, req.auth!.userId, input.input, input.dryRun));
});

workflowsRouter.get('/:id/executions', requirePermission('workflow.view'), async (req, res) => {
  res.json({ items: await listExecutions(req.ws!.workspaceId, req.params.id as string) });
});

workflowsRouter.get('/:id/versions', requirePermission('workflow.view'), async (req, res) => {
  res.json({ items: await listVersions(req.ws!.workspaceId, req.params.id as string) });
});

workflowsRouter.post('/:id/duplicate', requirePermission('workflow.edit'), async (req, res) => {
  res.status(201).json(await duplicateWorkflow(req.ws!.workspaceId, req.params.id as string, req.auth!.userId));
});
