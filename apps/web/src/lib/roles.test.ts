import { describe, expect, it } from 'vitest';
import { ROLES, can, canManageRole, isRole, type Permission, type Role } from './roles';

const matrix: Record<Permission, Role[]> = {
  'envelopes.read': ['viewer', 'member', 'admin', 'owner'],
  'envelopes.write': ['member', 'admin', 'owner'],
  'workspace.manage': ['admin', 'owner'],
  'brand.manage': ['admin', 'owner'],
  'apiKeys.manage': ['admin', 'owner'],
  'team.manage': ['admin', 'owner'],
  'owners.manage': ['owner'],
  'workspace.delete': ['owner'],
};

describe('roles', () => {
  it.each(Object.entries(matrix))('%s is allowed for exactly %j', (permission, allowed) => {
    for (const role of ROLES) {
      expect(can(role, permission as Permission), role).toBe(allowed.includes(role));
    }
  });

  it('lets admins manage everyone but owners, and owners manage everyone', () => {
    expect(canManageRole('admin', 'admin')).toBe(true);
    expect(canManageRole('admin', 'viewer')).toBe(true);
    expect(canManageRole('admin', 'owner')).toBe(false);
    expect(canManageRole('owner', 'owner')).toBe(true);
    expect(canManageRole('member', 'viewer')).toBe(false);
    expect(canManageRole('viewer', 'viewer')).toBe(false);
  });

  it('recognises only known roles', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('root')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
