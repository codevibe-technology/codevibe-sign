import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ member: true }));
const pdf = new TextEncoder().encode('%PDF-1.7');

vi.mock('@/server/auth/guards', () => ({
  findWorkspaceAccess: async (slug: string) =>
    state.member && slug === 'acme' ? { workspace: { id: 'ws_1' }, role: 'viewer' } : null,
}));
vi.mock('@/server/db', () => ({ db: () => ({}) }));
vi.mock('@/server/runtime', () => ({ appRuntime: () => ({ files: {} }) }));
vi.mock('@/server/templates', () => ({
  getTemplate: async (_sql: unknown, workspaceId: string, id: string) =>
    workspaceId === 'ws_1' && id === 'tpl_1' ? { id, workspaceId } : null,
  readTemplateDocument: async (_files: unknown, _template: unknown, docId: string) =>
    docId === 'd1' ? pdf : null,
}));

const { GET } = await import('@/app/w/[slug]/templates/[id]/documents/[docId]/route');
const get = (slug: string, id: string, docId: string) =>
  GET(new Request('http://x/'), { params: Promise.resolve({ slug, id, docId }) });

beforeEach(() => {
  state.member = true;
});

describe('template document route', () => {
  it('serves the PDF to members, locked down', async () => {
    const res = await get('acme', 'tpl_1', 'd1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-security-policy')).toMatch(/sandbox/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pdf);
  });

  it('answers 404 for anyone else and for anything missing', async () => {
    expect((await get('acme', 'tpl_1', 'd2')).status).toBe(404);
    expect((await get('acme', 'tpl_2', 'd1')).status).toBe(404);
    expect((await get('other', 'tpl_1', 'd1')).status).toBe(404);
    state.member = false;
    expect((await get('acme', 'tpl_1', 'd1')).status).toBe(404);
  });
});
