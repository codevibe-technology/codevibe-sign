import { describe, expect, it } from 'vitest';
import {
  ROLES,
  can,
  canManageBilling,
  canManageRole,
  canVoidEnvelope,
  isRole,
  type Permission,
  type Role,
} from './roles';

const matrix: Record<Permission, Role[]> = {
  'envelopes.read': ['viewer', 'member', 'billing', 'admin', 'owner'],
  'envelopes.write': ['member', 'billing', 'admin', 'owner'],
  'envelopes.voidAny': ['admin', 'owner'],
  'links.share': ['admin', 'owner'],
  'workspace.manage': ['admin', 'owner'],
  'brand.manage': ['admin', 'owner'],
  'apiKeys.manage': ['admin', 'owner'],
  'esign.manage': ['admin', 'owner'],
  'webhooks.manage': ['admin', 'owner'],
  'team.manage': ['admin', 'owner'],
  'billing.manage': ['billing', 'owner'],
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

  it('lets only owners name or change a billing admin', () => {
    expect(canManageRole('owner', 'billing')).toBe(true);
    expect(canManageRole('admin', 'billing')).toBe(false);
    expect(canManageRole('billing', 'billing')).toBe(false);
    expect(canManageRole('billing', 'member')).toBe(false);
  });

  it('opens billing to the account holder and billing admins only', () => {
    expect(canManageBilling('owner', true)).toBe(true);
    expect(canManageBilling('billing', false)).toBe(true);
    expect(canManageBilling('owner', false)).toBe(false);
    expect(canManageBilling('admin', false)).toBe(false);
    expect(canManageBilling('member', false)).toBe(false);
    expect(canManageBilling('viewer', false)).toBe(false);
  });

  it('lets members void their own envelopes and admins void any', () => {
    expect(canVoidEnvelope('viewer', true)).toBe(false);
    expect(canVoidEnvelope('member', true)).toBe(true);
    expect(canVoidEnvelope('member', false)).toBe(false);
    expect(canVoidEnvelope('admin', false)).toBe(true);
    expect(canVoidEnvelope('owner', false)).toBe(true);
  });

  it('recognises only known roles', () => {
    expect(isRole('admin')).toBe(true);
    expect(isRole('billing')).toBe(true);
    expect(isRole('root')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
