---
title: Changelog
description: Where to find release notes for each Codevibe Sign package.
---

# Changelog

<script setup>
import { GITHUB_URL } from './.vitepress/site';
</script>

There are no releases yet. The packages are pre-release and their APIs may change before 0.1.

Each package keeps its own `CHANGELOG.md`, written by changesets at release time. Release notes
will also be published on <a :href="`${GITHUB_URL}/releases`">GitHub releases</a>.

How entries are written:

- For users of the package: what changed and what they need to do.
- Breaking changes say so in the first line and explain the migration.
- Security fixes are marked as such once the fix is released.
- Releases follow semantic versioning; before 1.0, breaking changes bump the minor version.
