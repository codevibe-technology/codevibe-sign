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

## Release

On every push to `main`, the release workflow opens or updates a "Version packages" pull
request. Merging it bumps versions, writes the changelogs and publishes to npm with provenance.
