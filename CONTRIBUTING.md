# Contributing

Thanks for helping. Bug reports, fixes, docs and new provider adapters are all welcome. For a
larger change, open an issue first so we can agree on the approach before you write the code.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go to
security@codevibe.in, not to the issue tracker; see [SECURITY.md](SECURITY.md).

## Setup

You need Node 22.18 or later and pnpm 10 (`corepack enable` picks the version from
`package.json`).

```sh
git clone https://github.com/codevibe-technology/codevibe-sign.git
cd codevibe-sign
pnpm install
pnpm build
```

Packages import each other through their built output, so run `pnpm build` once before running
tests or type checks, and again after changing a package another one depends on.

## Commands

| Command                             | What it does                                               |
| ----------------------------------- | ---------------------------------------------------------- |
| `pnpm build`                        | Builds every package with tsup (ESM, CJS, types).          |
| `pnpm test`                         | Runs every package's vitest suite.                         |
| `pnpm typecheck`                    | Runs `tsc --noEmit` in every package.                      |
| `pnpm lint`                         | ESLint over the repository.                                |
| `pnpm format` / `pnpm format:check` | Prettier.                                                  |
| `pnpm --filter <package> test`      | One package, for example `@codevibe_technology/sign-core`. |
| `pnpm changeset`                    | Adds a release note for your change.                       |

## Making a change

- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first. Core is pure: no I/O, only ports.
- Keep each package's public API in its `src/index.ts`. Throw `SignError` with a stable `code`,
  never a bare string.
- Tests are required. Put them next to the code as `*.test.ts` and cover the rules and failure
  paths, not only the happy path. Never commit real documents, keys or personal data; use
  generated fixtures.
- New runtime dependencies must be well maintained and permissively licensed (MIT, Apache-2.0,
  BSD or ISC), pinned to an exact version, and justified in the pull request.
- Comments explain intent or a rule that is not obvious from the code.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org):

```
feat(core): add sequential routing
fix(pdf): keep field boxes inside the page
docs(server): document the webhook retry policy
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`. The scope is the package
name without the prefix (`core`, `pdf`, `server`, `client`, `react`, `templates`, `aadhaar`) or an
area such as `ci`.
Write the subject in lower case and the imperative, without a full stop, in 72 characters or
fewer. Add a body when the reason for the change is not obvious.

## Contributor licence agreement

Before a pull request from outside Codevibe can be merged, its author signs the
[Codevibe Sign contributor licence agreement](CLA.md). You keep the ownership of what you
contribute. The agreement gives Codevibe Technology Private Limited a licence to publish it and
the right to relicense it, which is what lets us offer the AGPL server and apps under a
commercial licence as well, and it commits us to keep every accepted contribution available
under the project's open-source licence.

Signing takes one comment. When you open your first pull request, the CLA Assistant posts a
comment asking you to reply with:

```
I have read the CLA Document and I hereby sign the CLA
```

The check on the pull request then turns green, and your signature covers every later
contribution. You do not need to sign off commits (`git commit -s` is not required).

If you contribute as part of your job, ask your employer to sign the
[corporate agreement](CLA-CORPORATE.md) and send it to hello@codevibe.in. We then add the people
it names to the allowlist, so their pull requests pass without a comment.

Both agreements are marked "draft, for legal review" until our lawyers have approved the final
text.

## Releases

Packages are published to npm by the release workflow, with npm trusted publishing: GitHub
proves to npm which workflow is publishing, so no long-lived token is stored, and every release
carries a provenance statement. Merging changesets into `main` opens a "version packages" pull
request; merging that one publishes. The eight published packages share one version number and
are always released together.

## Changesets and the changelog

Every pull request that changes a published package needs a changeset (`pnpm changeset`).
Changesets write each package's `CHANGELOG.md` at release time, so do not edit changelogs by
hand. See [.changeset/README.md](.changeset/README.md) for how to choose the bump.

Changelog policy:

- Entries are written for users of the package: what changed and what they need to do.
- Breaking changes say so in the first line and explain the migration.
- Security fixes are marked as such once the fix is released.
- Releases follow semantic versioning; before 1.0, breaking changes bump the minor version.

## Pull requests

Keep pull requests focused on one concern. CI runs lint, format check, build, type check and
tests on Node 22 and 24, and all of them must pass, along with the CLA check. A maintainer reviews every pull request;
changes to sealing, verification, authentication or the audit log get a second review.

## Licence

Your contributions are published under the licence of the part you change: Apache-2.0 for the
libraries and AGPL-3.0-only for `packages/server` and the apps (see
[LICENSING.md](LICENSING.md)). The [contributor licence agreement](CLA.md) records the rights
you give Codevibe, including the right to offer the server and the apps under a commercial
licence too.
