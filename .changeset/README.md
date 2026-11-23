# Changesets

This folder holds pending release notes. Each published package gets its version and
`CHANGELOG.md` from the changesets merged since its last release.

## Add one

Run `pnpm changeset` in a pull request that changes a published package. Pick the packages,
the bump and write one or two lines for users:

- `patch`: bug fixes and internal changes users can notice.
- `minor`: new features that do not break existing use.
- `major`: anything that breaks the public API, the HTTP API, the database schema or the
  sealed file format.

Before 1.0, breaking changes are released as `minor`.

Changes that do not affect a published package (docs, CI, tests, the apps) do not need one.

The eight published packages are a `fixed` group in `config.json`: they always share one
version number and are released together, so a `minor` for one package moves all of them.

## Release

On every push to `main`, the release workflow opens or updates a "Version packages" pull
request. Merging it bumps versions, writes the changelogs and publishes to npm through trusted
publishing (OIDC), with provenance and without a stored token.
