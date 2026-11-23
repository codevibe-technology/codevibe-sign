import { describe, expect, it } from 'vitest';
import { isSlugConflict, movedPath } from './workspace-address';

describe('movedPath', () => {
  it('swaps the old address for the new one and keeps the rest', () => {
    expect(movedPath('/dashboard/old', 'old', 'new')).toBe('/dashboard/new');
    expect(movedPath('/dashboard/old/settings/team', 'old', 'new')).toBe(
      '/dashboard/new/settings/team',
    );
    expect(movedPath('/dashboard/old?tab=sent', 'old', 'new')).toBe('/dashboard/new?tab=sent');
  });

  it('does not match an address that only starts the same way', () => {
    expect(movedPath('/dashboard/older/settings', 'old', 'new')).toBe('/dashboard/new');
  });

  it('goes to the workspace home for anything else', () => {
    expect(movedPath(null, 'old', 'new')).toBe('/dashboard/new');
    expect(movedPath('https://evil.example/dashboard/old', 'old', 'new')).toBe('/dashboard/new');
    expect(movedPath('/sign-in', 'old', 'new')).toBe('/dashboard/new');
  });
});

describe('isSlugConflict', () => {
  it('recognises the unique index on workspace addresses only', () => {
    expect(isSlugConflict({ code: '23505', constraint_name: 'app_workspaces_slug_key' })).toBe(
      true,
    );
    expect(isSlugConflict({ code: '23505', constraint_name: 'app_api_keys_key_hash_key' })).toBe(
      false,
    );
    expect(isSlugConflict({ code: '23503' })).toBe(false);
    expect(isSlugConflict(new Error('boom'))).toBe(false);
    expect(isSlugConflict(null)).toBe(false);
  });
});
