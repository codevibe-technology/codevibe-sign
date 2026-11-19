#!/usr/bin/env node
// Typechecks the code samples in the readmes and the docs site against the built packages.
// Only fenced blocks tagged `ts check` or `tsx check` are checked. An HTML comment right before
// a block, `<!-- check: declare const pdf: Uint8Array; -->`, is prepended to it, so samples can
// stay short. Run `pnpm build` first.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const at = (path) => join(root, path);

function markdownFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return name.endsWith('.md') ? [path] : [];
  });
}

const sources = [
  at('README.md'),
  ...readdirSync(at('packages')).map((name) => at(`packages/${name}/README.md`)),
  ...markdownFiles(at('apps/site')),
].filter((path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
});

const fence = /(?:<!--\s*check:([\s\S]*?)-->\s*\n)?^```(tsx?) check[^\n]*\n([\s\S]*?)^```$/gm;
const snippets = [];
for (const path of sources) {
  const text = readFileSync(path, 'utf8');
  for (const match of text.matchAll(fence)) {
    const line = text.slice(0, match.index).split('\n').length;
    snippets.push({
      origin: `${relative(root, path)}:${line}`,
      ext: match[2],
      code: `${match[1]?.trim() ?? ''}\n${match[3]}\nexport {};\n`,
    });
  }
}

const dir = mkdtempSync(join(tmpdir(), 'cvsign-snippets-'));
try {
  const files = new Map();
  snippets.forEach((snippet, index) => {
    const file = join(dir, `snippet-${index}.${snippet.ext}`);
    writeFileSync(file, snippet.code);
    files.set(file, snippet);
  });

  const packages = Object.fromEntries(
    readdirSync(at('packages')).map((name) => {
      const manifest = JSON.parse(readFileSync(at(`packages/${name}/package.json`), 'utf8'));
      return [manifest.name, [at(`packages/${name}/dist/index.d.ts`)]];
    }),
  );
  const react = at('packages/react/node_modules/@types/react');
  const program = ts.createProgram([...files.keys()], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    typeRoots: [at('packages/server/node_modules/@types')],
    types: ['node'],
    paths: {
      ...packages,
      react: [react],
      'react/jsx-runtime': [join(react, 'jsx-runtime.d.ts')],
    },
  });

  const problems = ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file && files.has(d.file.fileName));
  for (const d of problems) {
    const snippet = files.get(d.file.fileName);
    const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
    const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    console.error(`${snippet.origin} (snippet line ${line + 1}): ${message}`);
  }
  console.log(`${snippets.length} snippets checked, ${problems.length} problems`);
  if (problems.length > 0) process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
