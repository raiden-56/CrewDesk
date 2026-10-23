export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  badRequest: (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details),
  validation: (details: unknown) => new AppError(422, 'VALIDATION_ERROR', 'Request validation failed', details),
  unauthorized: (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'You do not have permission to perform this action') => new AppError(403, 'FORBIDDEN', message),
  notFound: (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`),
  conflict: (message: string, details?: unknown) => new AppError(409, 'CONFLICT', message, details),
  rateLimited: (resetSec: number) => new AppError(429, 'RATE_LIMITED', 'Too many requests', { resetSec }),
  unavailable: (message: string) => new AppError(503, 'SERVICE_UNAVAILABLE', message),
  internal: (message = 'Internal server error') => new AppError(500, 'INTERNAL_ERROR', message),
};

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
