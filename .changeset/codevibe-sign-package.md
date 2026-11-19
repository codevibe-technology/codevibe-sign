---
'codevibe-sign': minor
'@codevibe_technology/sign-server': minor
---

New `codevibe-sign` package: the server, client, PDF tools, core rules and React components
behind one install with subpath imports, and a `codevibe-sign` CLI (`start`, `start --memory`,
`verify`, `inspect`, `keygen`, `hash`, `api-key`).

Server: `configFromEnv()` reads the standalone service's environment variables, the same ones
the Docker image uses.
