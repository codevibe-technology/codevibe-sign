import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from './proxy';

describe('proxy', () => {
  it('sends visitors without a session to sign-in and back', () => {
    const response = proxy(
      new NextRequest('https://sign.example.com/dashboard/acme/envelopes?x=1'),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://sign.example.com/sign-in?next=%2Fdashboard%2Facme%2Fenvelopes%3Fx%3D1',
    );
  });

  it('passes the path on for signed-in people, replacing any value sent by the browser', () => {
    const response = proxy(
      new NextRequest('https://sign.example.com/dashboard/acme/settings?tab=1', {
        headers: { cookie: 'cvs.session_token=abc', 'x-cvs-path': '/dashboard/evil' },
      }),
    );
    expect(response.headers.get('x-middleware-override-headers')).toContain('x-cvs-path');
    expect(response.headers.get('x-middleware-request-x-cvs-path')).toBe(
      '/dashboard/acme/settings?tab=1',
    );
  });
});
