import { describe, expect, it } from 'vitest';
import { canApproveRisk, roleHasPermission, ROLE_PERMISSIONS } from '../permissions.js';
import { WORKSPACE_ROLES } from '../enums.js';

describe('permissions', () => {
  it('owner has everything, viewer only views', () => {
    expect(roleHasPermission('OWNER', 'workspace.manage')).toBe(true);
    expect(roleHasPermission('ADMIN', 'workspace.manage')).toBe(false);
    expect(roleHasPermission('VIEWER', 'agent.view')).toBe(true);
    expect(roleHasPermission('VIEWER', 'agent.create')).toBe(false);
    expect(roleHasPermission('VIEWER', 'approval.decide')).toBe(false);
  });

  it('task operators cannot approve', () => {
    expect(roleHasPermission('TASK_OPERATOR', 'task.create')).toBe(true);
    expect(roleHasPermission('TASK_OPERATOR', 'approval.decide')).toBe(false);
  });

  it('risk-based approval gating', () => {
    expect(canApproveRisk('APPROVER', 'LOW')).toBe(true);
    expect(canApproveRisk('APPROVER', 'HIGH')).toBe(true);
    expect(canApproveRisk('APPROVER', 'CRITICAL')).toBe(false);
    expect(canApproveRisk('ADMIN', 'CRITICAL')).toBe(true);
    expect(canApproveRisk('VIEWER', 'LOW')).toBe(false);
    expect(canApproveRisk('AGENT_MANAGER', 'LOW')).toBe(false);
  });

  it('every role has a permission list', () => {
    for (const r of WORKSPACE_ROLES) expect(Array.isArray(ROLE_PERMISSIONS[r])).toBe(true);
  });
});
