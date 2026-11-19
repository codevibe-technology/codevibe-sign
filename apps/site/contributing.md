---
title: Contributing
description: Set up the Codevibe Sign repository, run the checks, follow the commit convention and open a pull request.
---

# Contributing

Bug reports, fixes, docs and new provider adapters are all welcome. For a larger change, open an
issue first so we can agree on the approach before you write the code. Everyone taking part
agrees to the Code of Conduct. Security problems go to security@codevibe.in, not to the issue
tracker.

## Setup

You need Node 20 or later and pnpm 10 (`corepack enable` picks the version from
`package.json`).

```sh
git clone https://github.com/codevibe-technology/codevibe-sign.git
cd sign
pnpm install
pnpm build
```

Packages import each other through their built output, so run `pnpm build` once before tests or
type checks, and again after changing a package another one depends on.

## Commands

| Command                             | What it does                                               |
| ----------------------------------- | ---------------------------------------------------------- |
| `pnpm build`                        | Builds every package with tsup (ESM, CJS, types).          |
| `pnpm test`                         | Runs every package's vitest suite.                         |
| `pnpm typecheck`                    | Runs `tsc --noEmit` in every package.                      |
| `pnpm lint`                         | ESLint over the repository.                                |
| `pnpm format` / `pnpm format:check` | Prettier.                                                  |
| `pnpm --filter <package> test`      | One package, for example `@codevibe_technology/sign-core`. |
| `pnpm --filter site dev`            | This documentation site, with live reload.                 |
| `pnpm changeset`                    | Adds a release note for your change.                       |

## Making a change

- Core is pure: no I/O, only ports.
- Keep each package's public API in its `src/index.ts`. Throw `SignError` with a stable `code`.
- Tests are required, next to the code as `*.test.ts`. Cover the rules and the failure paths.
  Never commit real documents, keys or personal data.
- New runtime dependencies must be well maintained and permissively licensed (MIT, Apache-2.0,
  BSD or ISC), pinned to an exact version, and justified in the pull request.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org):

```
feat(core): add sequential routing
fix(pdf): keep field boxes inside the page
docs(server): document the webhook retry policy
```

Write the subject in lower case and the imperative, without a full stop, in 72 characters or
fewer.

## Pull requests

Keep each pull request to one concern. CI runs lint, format check, build, type check and tests
on Node 20 and 22. A maintainer reviews every pull request, and changes to sealing,
verification, authentication or the audit log get a second review.

By contributing you agree that your contributions are licensed under the Apache License 2.0.
