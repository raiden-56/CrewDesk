import { Router } from 'express';
import { ApprovalDecisionSchema, PaginationQuery, type RiskLevel } from '@collabspace/shared';
import { approvalInclude, decideApproval, Errors, prisma, toApprovalDto } from '@collabspace/core';
import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { canApprove, clientIp, requirePermission } from '../middleware/auth.js';
import { body, query, validate } from '../middleware/validate.js';

export const approvalsRouter = Router();

const ListQuery = PaginationQuery.extend({ status: z.string().optional(), taskId: z.string().optional() });

approvalsRouter.get('/', requirePermission('approval.view'), validate(ListQuery, 'query'), async (req, res) => {
  const q = query<z.infer<typeof ListQuery>>(req);
  const where: Prisma.ApprovalRequestWhereInput = { workspaceId: req.ws!.workspaceId, ...(q.status ? { status: q.status as Prisma.ApprovalRequestWhereInput['status'] } : {}), ...(q.taskId ? { taskId: q.taskId } : {}) };
  const [rows, total, pending] = await Promise.all([
    prisma.approvalRequest.findMany({ where, include: approvalInclude, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.approvalRequest.count({ where }),
    prisma.approvalRequest.count({ where: { workspaceId: req.ws!.workspaceId, status: 'PENDING' } }),
  ]);
  res.json({ items: rows.map((r) => ({ ...toApprovalDto(r), canDecide: canApprove(req, r.risk as RiskLevel) })), page: q.page, pageSize: q.pageSize, total, pending });
});

approvalsRouter.get('/:id', requirePermission('approval.view'), async (req, res) => {
  const row = await prisma.approvalRequest.findFirst({ where: { id: req.params.id as string, workspaceId: req.ws!.workspaceId }, include: approvalInclude });
  if (!row) throw Errors.notFound('Approval request');
  res.json({ ...toApprovalDto(row), canDecide: canApprove(req, row.risk as RiskLevel) });
});

function decide(decision: 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED') {
  return [
    requirePermission('approval.decide'),
    validate(ApprovalDecisionSchema),
    async (req: Request, res: Response) => {
      const input = body<z.infer<typeof ApprovalDecisionSchema>>(req);
      const result = await decideApproval({ approvalId: req.params.id as string, workspaceId: req.ws!.workspaceId, userId: req.auth!.userId, userRole: req.ws!.role, decision, comment: input.comment ?? null, proposalVersion: input.proposalVersion, ip: clientIp(req), requestId: req.requestId });
      res.json(result);
    },
  ] as const;
}

approvalsRouter.post('/:id/approve', ...decide('APPROVED'));
approvalsRouter.post('/:id/reject', ...decide('REJECTED'));
approvalsRouter.post('/:id/request-changes', ...decide('CHANGES_REQUESTED'));
