---
'@codevibe_technology/sign-server': minor
'@codevibe_technology/sign-client': patch
---

Envelopes now belong to a workspace. API keys take an optional `workspaceId`, the new
`authenticate` and `webhookTargets` options resolve callers and webhooks per workspace,
`GET /v1/envelopes` lists the caller's envelopes and `basePath` mounts the server under a
prefix. Existing single-tenant setups keep working; migration `0003_workspaces` adds the
column. The client knows the new `FORBIDDEN` error code.
