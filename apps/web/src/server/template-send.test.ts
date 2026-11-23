import { describe, expect, it } from 'vitest';
import type { TemplateDefinition } from '@/lib/templates';
import { AppError } from './errors';
import { RateLimitedError, sendFromTemplate } from './template-send';

const definition = {
  roles: [
    { id: 'r_emp', name: 'Employee', type: 'signer', auth: 'email_link' },
    { id: 'r_mgr', name: 'Manager', type: 'approver', auth: 'email_otp' },
    { id: 'r_hr', name: 'HR', type: 'viewer', auth: 'email_link' },
  ],
} as TemplateDefinition;
const template = { id: 'tpl 1', workspaceId: 'ws_1', definition };
const people = {
  r_emp: { name: ' Asha Rao ', email: 'ASHA@example.com', phone: '' },
  r_mgr: { name: 'Meera', email: 'meera@example.com', phone: '+91 98123 45678' },
  r_hr: { name: 'HR desk', email: 'hr@example.com', phone: '' },
  r_gone: { name: 'Nobody', email: 'nobody@example.com', phone: '' },
};

function setup(response: () => Response) {
  const calls: { principal: unknown; path: string; body: unknown }[] = [];
  const senders: unknown[] = [];
  return {
    calls,
    senders,
    deps: {
      request: async (principal: unknown, path: string, init: RequestInit) => {
        calls.push({ principal, path, body: JSON.parse(String(init.body)) });
        return response();
      },
      recordSender: async (input: unknown) => void senders.push(input),
    },
  };
}

describe('sendFromTemplate', () => {
  it('asks the sign API for an envelope from the template, as the member', async () => {
    const { calls, senders, deps } = setup(() => Response.json({ id: 'env_1' }, { status: 201 }));
    const envelope = await sendFromTemplate(deps, {
      template,
      userId: 'u_1',
      people,
      title: '  Offer for Asha ',
      message: '',
      metadata: { ref: 'R1' },
    });
    expect(envelope.id).toBe('env_1');
    expect(calls).toEqual([
      {
        principal: { id: 'user:u_1', workspaceId: 'ws_1' },
        path: '/v1/templates/tpl%201/envelopes',
        body: {
          roles: {
            r_emp: { name: 'Asha Rao', email: 'asha@example.com' },
            r_mgr: { name: 'Meera', email: 'meera@example.com', phone: '+919812345678' },
            r_hr: { name: 'HR desk', email: 'hr@example.com' },
          },
          title: 'Offer for Asha',
          message: null,
          metadata: { ref: 'R1' },
          send: true,
        },
      },
    ]);
    expect(senders).toEqual([{ workspaceId: 'ws_1', envelopeId: 'env_1', userId: 'u_1' }]);
  });

  it('leaves the title and message to the template unless they are given', async () => {
    const { calls, deps } = setup(() => Response.json({ id: 'env_1' }, { status: 201 }));
    await sendFromTemplate(deps, { template, userId: 'u_1', people, title: ' ' });
    expect(calls[0]!.body).not.toHaveProperty('title');
    expect(calls[0]!.body).not.toHaveProperty('message');
    await sendFromTemplate(deps, { template, userId: 'u_1', people, message: ' Hello ' });
    expect(calls[1]!.body).toMatchObject({ message: 'Hello' });
  });

  it('turns refusals into errors the form can show, and records no sender', async () => {
    const limited = setup(
      () => new Response('{}', { status: 429, headers: { 'retry-after': '7' } }),
    );
    await expect(
      sendFromTemplate(limited.deps, { template, userId: 'u_1', people }),
    ).rejects.toMatchObject({ name: 'RateLimitedError', retryAfterSeconds: 7 });
    expect(new RateLimitedError(1)).toBeInstanceOf(Error);

    const gone = setup(() =>
      Response.json(
        { error: { code: 'NOT_FOUND', message: 'Template not found' } },
        { status: 404 },
      ),
    );
    const missing = await sendFromTemplate(gone.deps, { template, userId: 'u_1', people }).catch(
      (e: unknown) => e,
    );
    expect(missing).toBeInstanceOf(AppError);
    expect(missing).toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringMatching(/template/),
    });

    const invalid = setup(() =>
      Response.json(
        {
          error: {
            code: 'VALIDATION',
            message: 'roles.r_emp.email is not a valid email address',
            details: { issues: [{ path: 'roles.r_emp.email', message: 'Not a valid email' }] },
          },
        },
        { status: 400 },
      ),
    );
    await expect(
      sendFromTemplate(invalid.deps, { template, userId: 'u_1', people }),
    ).rejects.toMatchObject({ code: 'VALIDATION', field: 'roles.r_emp.email' });
    expect([...limited.senders, ...gone.senders, ...invalid.senders]).toEqual([]);
  });
});
