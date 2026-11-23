---
'codevibe-sign': minor
'@codevibe_technology/sign-server': minor
---

New `codevibe-sign` package: the client, PDF tools, core rules and React components behind one
Apache-2.0 install with subpath imports, and a `codevibe-sign` CLI (`verify`, `inspect`,
`keygen`, `hash`, `api-key`).

Server: `configFromEnv()` reads the standalone service's environment variables, the same ones
the Docker image uses.
