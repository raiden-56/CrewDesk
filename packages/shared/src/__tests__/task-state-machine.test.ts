import { describe, expect, it } from 'vitest';
import { assertTransition, canCancel, canRetry, canTransition, InvalidTransitionError, isTerminal, TASK_TRANSITIONS } from '../task-state-machine.js';
import { TASK_STATUSES } from '../enums.js';

describe('task state machine', () => {
  it('allows the happy path', () => {
    expect(canTransition('DRAFT', 'QUEUED')).toBe(true);
    expect(canTransition('QUEUED', 'RUNNING')).toBe(true);
    expect(canTransition('RUNNING', 'WAITING_APPROVAL')).toBe(true);
    expect(canTransition('WAITING_APPROVAL', 'QUEUED')).toBe(true);
    expect(canTransition('RUNNING', 'COMPLETED')).toBe(true);
  });

  it('rejects illegal jumps', () => {
    expect(canTransition('COMPLETED', 'RUNNING')).toBe(false);
    expect(canTransition('DRAFT', 'RUNNING')).toBe(false);
    expect(canTransition('QUEUED', 'COMPLETED')).toBe(false);
    expect(() => assertTransition('COMPLETED', 'QUEUED')).toThrow(InvalidTransitionError);
  });

  it('terminal states have no exits except retry', () => {
    expect(TASK_TRANSITIONS.COMPLETED).toEqual([]);
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('FAILED')).toBe(true);
    expect(isTerminal('RUNNING')).toBe(false);
    expect(canRetry('FAILED')).toBe(true);
    expect(canRetry('TIMED_OUT')).toBe(true);
    expect(canRetry('COMPLETED')).toBe(false);
  });

  it('cancellation is allowed from every non-terminal state', () => {
    for (const s of TASK_STATUSES) {
      if (isTerminal(s)) expect(canCancel(s)).toBe(false);
      else expect(canCancel(s)).toBe(true);
    }
  });

  it('every target in the table is a known status', () => {
    for (const targets of Object.values(TASK_TRANSITIONS)) {
      for (const t of targets) expect(TASK_STATUSES).toContain(t);
    }
  });
});
