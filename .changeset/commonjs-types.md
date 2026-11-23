---
'codevibe-sign': patch
'@codevibe_technology/sign-core': patch
'@codevibe_technology/sign-pdf': patch
'@codevibe_technology/sign-server': patch
'@codevibe_technology/sign-client': patch
'@codevibe_technology/sign-react': patch
'@codevibe_technology/sign-templates': patch
'@codevibe_technology/sign-aadhaar': patch
---

CommonJS projects get correct types. Every entry point's `exports` now names a declaration
file per format (`.d.ts` for `import`, `.d.cts` for `require`), so `require('codevibe-sign')`
and the scoped packages type-check under `moduleResolution: node16` instead of being read as
ES modules. `./package.json` is exported from every package.
