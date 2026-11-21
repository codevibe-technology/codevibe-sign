import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const required = {
  DATABASE_URL: 'postgres://sign:pw@localhost:5432/sign',
  AUTH_SECRET: 'a'.repeat(32),
};

const graph = {
  ...required,
  MAIL_TRANSPORT: 'graph',
  MAIL_FROM: 'Codevibe <no-reply@codevibe.in>',
  MS_TENANT_ID: '00000000-0000-0000-0000-000000000001',
  MS_CLIENT_ID: '00000000-0000-0000-0000-000000000002',
  MS_CLIENT_SECRET: 'not-a-real-secret',
};

const problems = (source: Record<string, string | undefined>) => {
  try {
    parseEnv(source);
  } catch (err) {
    return (err as Error).message;
  }
  return '';
};

describe('parseEnv mail settings', () => {
  it('defaults to printing mail', () => {
    expect(parseEnv(required).MAIL_TRANSPORT).toBe('console');
  });

  it('accepts an SMTP URL without Microsoft settings', () => {
    const config = parseEnv({ ...required, MAIL_TRANSPORT: 'smtp://u:p@smtp.example.com:587' });
    expect(config.MS_CLIENT_SECRET).toBeUndefined();
  });

  it('accepts graph with all three Microsoft settings', () => {
    const config = parseEnv(graph);
    expect(config.MAIL_TRANSPORT).toBe('graph');
    expect(config.MS_TENANT_ID).toBe(graph.MS_TENANT_ID);
  });

  it.each(['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET'])(
    'names %s when graph is chosen without it',
    (name) => {
      const message = problems({ ...graph, [name]: undefined });
      expect(message).toContain(`${name}: ${name} is required when MAIL_TRANSPORT=graph`);
    },
  );

  it('names every missing setting at once, and treats blank as missing', () => {
    const message = problems({
      ...required,
      MAIL_TRANSPORT: 'graph',
      MAIL_FROM: 'a@b.co',
      MS_CLIENT_ID: '',
    });
    for (const name of ['MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET']) {
      expect(message).toContain(`${name}:`);
    }
  });

  it('wants a real mailbox in MAIL_FROM for graph', () => {
    expect(problems({ ...graph, MAIL_FROM: undefined })).toContain(
      'MAIL_FROM: MAIL_FROM must name',
    );
    expect(problems({ ...graph, MAIL_FROM: 'Codevibe' })).toContain('MAIL_FROM:');
    expect(problems({ ...graph, MAIL_FROM: 'no-reply@codevibe.in' })).toBe('');
  });

  it('never repeats the client secret in a configuration error', () => {
    const message = problems({ ...graph, MS_TENANT_ID: undefined });
    expect(message).not.toContain(graph.MS_CLIENT_SECRET);
  });
});

describe('parseEnv seal timestamp settings', () => {
  it('leaves the timestamp authority off by default', () => {
    const config = parseEnv(required);
    expect(config.SEAL_TSA_URL).toBeUndefined();
    expect(config.SEAL_TSA_REQUIRED).toBeUndefined();
  });

  it('reads the authority URL and an explicit required flag', () => {
    const config = parseEnv({
      ...required,
      SEAL_TSA_URL: 'http://timestamp.digicert.com',
      SEAL_TSA_REQUIRED: 'false',
    });
    expect(config.SEAL_TSA_URL).toBe('http://timestamp.digicert.com');
    expect(config.SEAL_TSA_REQUIRED).toBe(false);
    expect(parseEnv({ ...required, SEAL_TSA_REQUIRED: '1' }).SEAL_TSA_REQUIRED).toBe(true);
  });

  it('names the variable when a value is wrong', () => {
    expect(problems({ ...required, SEAL_TSA_URL: 'ftp://tsa.example.com' })).toContain(
      'SEAL_TSA_URL',
    );
    expect(problems({ ...required, SEAL_TSA_REQUIRED: 'maybe' })).toContain(
      'SEAL_TSA_REQUIRED must be true or false',
    );
  });
});
