import { TaskStatus, TERMINAL_TASK_STATUSES } from './enums.js';

/**
 * Allowed task state transitions. Every transition made by the API or worker is
 * validated against this table so illegal jumps (e.g. COMPLETED -> RUNNING) are rejected.
 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  DRAFT: ['QUEUED', 'CANCELLED'],
  QUEUED: ['RUNNING', 'CANCELLED', 'PAUSED', 'FAILED'],
  RUNNING: ['WAITING_APPROVAL', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'QUEUED'],
  WAITING_APPROVAL: ['QUEUED', 'RUNNING', 'CANCELLED', 'FAILED', 'TIMED_OUT'],
  PAUSED: ['QUEUED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: ['QUEUED'],
  CANCELLED: ['QUEUED'],
  TIMED_OUT: ['QUEUED'],
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: TaskStatus,
    public readonly to: TaskStatus,
  ) {
    super(`Invalid task transition ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (TASK_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}

/** Manual retry is allowed from FAILED, CANCELLED and TIMED_OUT (-> QUEUED). */
export function canRetry(status: TaskStatus): boolean {
  return status === 'FAILED' || status === 'TIMED_OUT' || status === 'CANCELLED';
}

/** Cancellation is allowed from any non-terminal state. */
export function canCancel(status: TaskStatus): boolean {
  return canTransition(status, 'CANCELLED');
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  DRAFT: 'Draft',
  QUEUED: 'Queued',
  RUNNING: 'Running',
  WAITING_APPROVAL: 'Waiting for approval',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  TIMED_OUT: 'Timed out',
};
