---
'@codevibe_technology/sign-server': minor
'@codevibe_technology/sign-client': minor
---

Templates in the HTTP API: `GET`, `POST`, `PATCH` and `DELETE /v1/templates`, and
`POST /v1/templates/{templateId}/envelopes` to make an envelope by naming a person for each
role, with `prefill` for text fields. Templates belong to the workspace of the API key and
live in the store (`sign_templates`, migration `0004_templates_and_sealed_lookup`); pass
`templateStore` to keep them elsewhere. The client gains `templates.list`, `create`, `get`,
`update`, `delete` and `createEnvelope`.
