import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { Errors } from '@collabspace/core';

type Part = 'body' | 'query' | 'params';

/** Validate a request part with a Zod schema; parsed values land in req.validated[part]. */
export function validate<T extends ZodType>(schema: T, part: Part = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(part === 'body' ? req.body : part === 'query' ? req.query : req.params);
    if (!result.success) {
      return next(Errors.validation(result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))));
    }
    req.validated = req.validated ?? {};
    req.validated[part] = result.data;
    next();
  };
}

export function body<T>(req: Request): T {
  return req.validated.body as T;
}
export function query<T>(req: Request): T {
  return req.validated.query as T;
}
