import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { operations } from './model.ts';
import {
  BASE_URL,
  curlSample,
  FileRef,
  hasClientMethod,
  jsLiteral,
  LANGUAGES,
  sampleRequest,
  samplesFor,
} from './samples.ts';

const python = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('code samples', () => {
  it('cover every route in every language', () => {
    for (const op of operations()) {
      const samples = samplesFor(op);
      for (const { id } of LANGUAGES) expect(samples[id], `${op.id} ${id}`).toBeTruthy();
    }
  });

  it('call the documented method and path', () => {
    for (const op of operations()) {
      const { curl, python: py, go } = samplesFor(op);
      const request = sampleRequest(op);
      expect(request.url.startsWith(BASE_URL)).toBe(true);
      const path = op.path.replace(/\{[^}]+\}/g, '[^/?"]+');
      const route = new RegExp(`${BASE_URL.replace(/[.]/g, '\\.')}${path}`);
      expect(curl, op.id).toMatch(route);
      expect(py, op.id).toMatch(route);
      expect(go, op.id).toMatch(route);
      if (op.method !== 'get') expect(curl).toContain(`-X ${op.method.toUpperCase()}`);
      expect(py).toContain(`requests.${op.method}(`);
      expect(go).toContain(`http.NewRequest("${op.method.toUpperCase()}"`);
    }
  });

  it('send the documented example body, with files read from disk', () => {
    for (const op of operations().filter((o) => o.body)) {
      const curl = curlSample(sampleRequest(op));
      const json = curl
        .split(" \\\n  -d '")[1]!
        .replace(/'$/, '')
        .replace(/'\\''/g, "'")
        .replace(/"'"\$\(base64 < ([^ ]+) \| tr -d '\\n'\)"'"/g, '"@file:$1"');
      const sent = JSON.parse(json);
      const expected = JSON.parse(
        JSON.stringify(sampleRequest(op).body, (_k, v: unknown) =>
          v instanceof FileRef ? `@file:${v.path}` : v,
        ),
      );
      expect(sent, op.id).toEqual(expected);
    }
  });

  it('send the API key only on sender routes and never inline', () => {
    for (const op of operations()) {
      const { curl, node, python: py } = samplesFor(op);
      const sender = op.path.startsWith('/v1/envelopes');
      expect(curl.includes('Authorization: Bearer $SIGN_API_KEY'), op.id).toBe(sender);
      if (sender) {
        expect(node).toMatch(/process\.env\.SIGN_API_KEY/);
        expect(py).toContain("os.environ['SIGN_API_KEY']");
      }
    }
  });

  it('use the client for the routes it covers', () => {
    const covered = operations().filter(hasClientMethod);
    expect(covered.map((op) => op.id)).toContain('createEnvelope');
    for (const op of covered) {
      expect(samplesFor(op).node).toContain("from '@codevibe_technology/sign-client'");
    }
  });

  it('quote strings safely in JavaScript', () => {
    expect(jsLiteral("it's")).toBe("'it\\'s'");
    expect(jsLiteral({ 'x-y': 1, ok: [true, null] })).toBe(
      "{\n  'x-y': 1,\n  ok: [\n    true,\n    null,\n  ],\n}",
    );
    expect(jsLiteral(new FileRef('a.pdf'))).toBe("await readFile('a.pdf')");
  });

  it.skipIf(!python)('are valid Python', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cvsign-py-'));
    try {
      operations().forEach((op, i) => {
        const file = join(dir, `s${i}.py`);
        writeFileSync(file, samplesFor(op).python);
        execFileSync('python3', ['-m', 'py_compile', file]);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
