import type { NextFunction, Request, Response } from 'express';
import { InvalidTransitionError } from '@collabspace/shared';
import { isAppError, logger } from '@collabspace/core';
import { Prisma } from '@prisma/client';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found`, requestId: req.requestId } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  void _next;
  const requestId = req.requestId;
  if (isAppError(err)) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId } });
    return;
  }
  if (err instanceof InvalidTransitionError) {
    res.status(409).json({ error: { code: 'INVALID_TRANSITION', message: err.message, requestId } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with the same unique value already exists', requestId } });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found', requestId } });
      return;
    }
  }
  const e = err as { type?: string; status?: number; message?: string };
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large', requestId } });
    return;
  }
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body', requestId } });
    return;
  }
  logger.error({ err, requestId, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId } });
}
