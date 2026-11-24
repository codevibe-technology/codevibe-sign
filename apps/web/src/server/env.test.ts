import { describe, expect, it } from 'vitest';
import { appSessionPolicy, parseEnv } from './env';

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

describe('parseEnv Turnstile settings', () => {
  it('is off without keys, and blank keys count as unset', () => {
    const config = parseEnv({ ...required, TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' });
    expect(config.TURNSTILE_SITE_KEY).toBeUndefined();
    expect(config.TURNSTILE_SECRET_KEY).toBeUndefined();
  });

  it('takes both keys together', () => {
    const config = parseEnv({
      ...required,
      TURNSTILE_SITE_KEY: '0x4AAAAAAAsite',
      TURNSTILE_SECRET_KEY: '0x4AAAAAAAsecret',
    });
    expect(config.TURNSTILE_SITE_KEY).toBe('0x4AAAAAAAsite');
  });

  it('names the missing key when only one is set, without echoing the other', () => {
    const onlySite = problems({ ...required, TURNSTILE_SITE_KEY: '0x4AAAAAAAsite' });
    expect(onlySite).toContain('TURNSTILE_SECRET_KEY is required when TURNSTILE_SITE_KEY is set');
    const onlySecret = problems({ ...required, TURNSTILE_SECRET_KEY: '0x4AAAAAAAsecret' });
    expect(onlySecret).toContain('TURNSTILE_SITE_KEY is required');
    expect(onlySecret).not.toContain('0x4AAAAAAAsecret');
  });
});

describe('parseEnv session settings', () => {
  it('signs out after 30 idle minutes and 12 hours by default', () => {
    const config = parseEnv(required);
    expect(config.SESSION_IDLE_MINUTES).toBe(30);
    expect(config.SESSION_MAX_HOURS).toBe(12);
    expect(appSessionPolicy(config)).toMatchObject({ idleSeconds: 1800, maxSeconds: 43_200 });
  });

  it('turns idle sign-out off with 0 and takes a longer day', () => {
    const config = parseEnv({ ...required, SESSION_IDLE_MINUTES: '0', SESSION_MAX_HOURS: '168' });
    expect(appSessionPolicy(config)).toMatchObject({ idleSeconds: null, maxSeconds: 604_800 });
  });

  it('names the variable when a value is wrong', () => {
    expect(problems({ ...required, SESSION_IDLE_MINUTES: 'soon' })).toContain(
      'SESSION_IDLE_MINUTES must be a whole number of minutes',
    );
    expect(problems({ ...required, SESSION_IDLE_MINUTES: '-5' })).toContain(
      'SESSION_IDLE_MINUTES must be 0 (off) or more',
    );
    expect(problems({ ...required, SESSION_MAX_HOURS: '0' })).toContain(
      'SESSION_MAX_HOURS must be at least 1',
    );
    expect(problems({ ...required, SESSION_MAX_HOURS: '1000' })).toContain(
      'SESSION_MAX_HOURS must be at most 720',
    );
  });
});
