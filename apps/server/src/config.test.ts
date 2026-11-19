import { SignError } from '@codevibe/sign-core';
import { describe, expect, it } from 'vitest';
import { loadConfig, type Env } from './config';

const KEY_A = 'a'.repeat(40);
const KEY_B = 'b'.repeat(32);
const P12 = Buffer.from([0x30, 0x82, 0x01, 0x02]).toString('base64');

function env(overrides: Env = {}): Env {
  return {
    DATABASE_URL: 'postgres://sign:secret@db:5432/sign',
    SMTP_HOST: 'smtp.example.com',
    SMTP_FROM: 'Sign <sign@example.com>',
    SEAL_P12_BASE64: P12,
    SEAL_P12_PASSPHRASE: 'p12-passphrase',
    API_KEYS: `${KEY_A}, ${KEY_B}`,
    PUBLIC_URL: 'https://sign.example.com/',
    ...overrides,
  };
}

function problems(overrides: Env): string[] {
  try {
    loadConfig(env(overrides));
  } catch (error) {
    if (error instanceof SignError) return (error.details?.problems as string[]) ?? [];
    throw error;
  }
  return [];
}

describe('loadConfig', () => {
  it('builds the server config with defaults', () => {
    const config = loadConfig(env());
    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.trustProxy).toBe(false);
    expect(config.server).toEqual({
      databaseUrl: 'postgres://sign:secret@db:5432/sign',
      filesDir: '/data/files',
      smtp: { host: 'smtp.example.com', port: 587, secure: false, from: 'Sign <sign@example.com>' },
      seal: { p12: new Uint8Array([0x30, 0x82, 0x01, 0x02]), passphrase: 'p12-passphrase' },
      apiKeys: [KEY_A, KEY_B],
      publicUrl: 'https://sign.example.com',
      tickIntervalMs: 60_000,
    });
  });

  it('reads the seal reason and location, tick interval and proxy setting', () => {
    const config = loadConfig(
      env({
        SEAL_REASON: ' Signed electronically ',
        SEAL_LOCATION: 'Pune',
        TICK_INTERVAL_SECONDS: '15',
        TRUST_PROXY: 'TRUE',
      }),
    );
    expect(config.server.seal).toMatchObject({ reason: 'Signed electronically', location: 'Pune' });
    expect(config.server.tickIntervalMs).toBe(15_000);
    expect(config.trustProxy).toBe(true);
  });

  it('reads optional variables', () => {
    const config = loadConfig(
      env({
        FILES_DIR: '/srv/files',
        SMTP_PORT: '465',
        SMTP_USER: 'mailer',
        SMTP_PASS: 'mail-pass',
        PORT: '8080',
        HOST: '127.0.0.1',
        PUBLIC_URL: 'http://localhost:8080',
      }),
    );
    expect(config.server.filesDir).toBe('/srv/files');
    expect(config.server.smtp).toMatchObject({
      port: 465,
      secure: true,
      user: 'mailer',
      pass: 'mail-pass',
    });
    expect(config).toMatchObject({ port: 8080, host: '127.0.0.1' });
  });

  it('lets SMTP_SECURE override the port default', () => {
    expect(loadConfig(env({ SMTP_PORT: '465', SMTP_SECURE: 'false' })).server.smtp.secure).toBe(
      false,
    );
    expect(loadConfig(env({ SMTP_SECURE: 'true' })).server.smtp.secure).toBe(true);
  });

  it('allows an empty passphrase but not a missing one', () => {
    expect(loadConfig(env({ SEAL_P12_PASSPHRASE: '' })).server.seal.passphrase).toBe('');
    expect(problems({ SEAL_P12_PASSPHRASE: undefined })).toEqual([
      'SEAL_P12_PASSPHRASE is required',
    ]);
  });

  it('reports every missing variable at once', () => {
    expect(() => loadConfig({})).toThrow(SignError);
    const all = problems({
      DATABASE_URL: undefined,
      SMTP_HOST: undefined,
      SMTP_FROM: undefined,
      SEAL_P12_BASE64: undefined,
      SEAL_P12_PASSPHRASE: undefined,
      API_KEYS: undefined,
      PUBLIC_URL: undefined,
    });
    expect(all).toEqual([
      'DATABASE_URL is required',
      'PUBLIC_URL is required',
      'SMTP_HOST is required',
      'SMTP_FROM is required',
      'SEAL_P12_BASE64 is required',
      'SEAL_P12_PASSPHRASE is required',
      'API_KEYS is required',
    ]);
  });

  it.each([
    [{ DATABASE_URL: 'mysql://db/sign' }, 'DATABASE_URL must be a postgres'],
    [{ PUBLIC_URL: 'sign.example.com' }, 'PUBLIC_URL must be an absolute URL'],
    [{ PUBLIC_URL: 'http://sign.example.com' }, 'PUBLIC_URL must use https'],
    [{ SMTP_PORT: '99999' }, 'SMTP_PORT must be a whole number'],
    [{ PORT: 'eighty' }, 'PORT must be a whole number'],
    [{ SMTP_USER: 'mailer' }, 'SMTP_USER and SMTP_PASS must be set together'],
    [{ SMTP_SECURE: 'yes' }, 'SMTP_SECURE must be true or false'],
    [{ TRUST_PROXY: '1' }, 'TRUST_PROXY must be true or false'],
    [{ TICK_INTERVAL_SECONDS: '1' }, 'TICK_INTERVAL_SECONDS must be a whole number from 5'],
    [{ SEAL_P12_BASE64: 'not base64!' }, 'SEAL_P12_BASE64 must be base64'],
    [{ API_KEYS: ' , ' }, 'API_KEYS has no keys'],
    [{ API_KEYS: `${KEY_A},short` }, 'Each key in API_KEYS must be at least 32 characters'],
  ])('rejects %o', (overrides, message) => {
    expect(problems(overrides).join('\n')).toContain(message);
  });

  it('never puts secret values in the error', () => {
    try {
      loadConfig(env({ API_KEYS: 'short-secret-key', SMTP_USER: 'mailer', SMTP_PORT: 'x' }));
      expect.unreachable();
    } catch (error) {
      const text = JSON.stringify({
        message: (error as Error).message,
        details: (error as SignError).details,
      });
      expect(text).not.toContain('short-secret-key');
      expect(text).not.toContain('p12-passphrase');
      expect(text).not.toContain('secret@db');
    }
  });
});
