// Tags each released package and opens its GitHub release, from the notes in its CHANGELOG.
//
// changesets/action no longer recognises what `changeset publish` prints, so it pushes no tags
// and makes no releases. This runs after a publish: every public package whose
// `<name>@<version>` tag is missing gets the tag on the current commit and a release with the
// matching CHANGELOG section. The project as a whole also gets a `v<version>` release from
// the root CHANGELOG.md, marked as the latest release.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
const sha = run('git', ['rev-parse', 'HEAD']);
const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));

for (const folder of readdirSync('packages')) {
  const pkg = JSON.parse(readFileSync(join('packages', folder, 'package.json'), 'utf8'));
  if (pkg.private || pkg.version === '0.0.0') continue;
  const tag = `${pkg.name}@${pkg.version}`;
  if (run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`])) continue;
  const changelog = readFileSync(join('packages', folder, 'CHANGELOG.md'), 'utf8');
  const start = changelog.indexOf(`## ${pkg.version}\n`);
  const rest = start === -1 ? '' : changelog.slice(start).split('\n').slice(1).join('\n');
  const end = rest.search(/^## /m);
  const notes = (end === -1 ? rest : rest.slice(0, end)).trim() || `${tag}`;
  const file = join(dir, `${folder}.md`);
  writeFileSync(file, `${notes}\n`);
  run('gh', [
    'release',
    'create',
    tag,
    '--target',
    sha,
    '--title',
    tag,
    '--notes-file',
    file,
    '--latest=false',
  ]);
  console.log(`released ${tag}`);
}

// The project release: `v<version>` of the umbrella package, from the root CHANGELOG section
// headed `## <version>`.
const version = JSON.parse(readFileSync('packages/codevibe-sign/package.json', 'utf8')).version;
const projectTag = `v${version}`;
if (
  version !== '0.0.0' &&
  !run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${projectTag}`])
) {
  const root = readFileSync('CHANGELOG.md', 'utf8');
  const heading = root.match(new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b.*$`, 'm'));
  let notes = `Codevibe Sign ${version}.`;
  // Before the section is renamed for the release, its notes are still under `## Unreleased`.
  const section = heading ?? root.match(/^## Unreleased.*$/m);
  if (section) {
    const after = root.slice(section.index + section[0].length);
    const end = after.search(/^## /m);
    notes = (end === -1 ? after : after.slice(0, end)).trim();
  }
  const file = join(dir, 'project.md');
  writeFileSync(file, `${notes}\n`);
  run('gh', [
    'release',
    'create',
    projectTag,
    '--target',
    sha,
    '--title',
    `Codevibe Sign ${version}`,
    '--notes-file',
    file,
    '--latest',
  ]);
  console.log(`released ${projectTag}`);
}
