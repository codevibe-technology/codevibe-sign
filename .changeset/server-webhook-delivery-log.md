---
'@codevibe_technology/sign-server': minor
---

Webhook delivery reports and manual deliveries. The new `onWebhookDelivery` option receives
every attempt with its outcome, status, error and next retry, so apps can keep a delivery
log. `sendTestWebhook` posts a signed `webhook.test` event to a target now, and
`redeliverWebhook` posts an earlier delivery again under the same id. The OpenAPI document
describes the test event.
