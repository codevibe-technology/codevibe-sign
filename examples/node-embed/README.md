# Embedded server

Starts Codevibe Sign inside a Node process with in-memory storage and a self-signed seal
certificate, then uses `@codevibe_technology/sign-client` to create and send a two-signer envelope and
prints the signing links. Nothing leaves your machine: links and one-time codes are printed
instead of mailed.

```sh
pnpm --filter example-node-embed start
```

The server keeps running on port 3000 so you can sign with the
[React example](../react-signing). When both have signed, the sealed PDF downloads with the
`curl` command it prints.

| Variable         | Default                   | Use                                  |
| ---------------- | ------------------------- | ------------------------------------ |
| `PORT`           | `3000`                    | Port of the API.                     |
| `SIGNING_PAGE`   | `http://localhost:5173`   | Where signing links point.           |
| `WEBHOOK_URL`    | none                      | Deliver webhooks here when set.      |
| `WEBHOOK_SECRET` | `example-webhook-secret`  | Secret the webhooks are signed with. |
| `SIGN_API_KEY`   | a new random key, printed | Sender API key.                      |
| `CORS_ORIGINS`   | the docs site origins     | Origins allowed to call the API.     |

The server answers CORS requests from the docs site (`http://localhost:5173`,
`http://localhost:4173` and `https://sign.codevibe.in` unless `CORS_ORIGINS` says otherwise), so
the [interactive HTTP API reference](https://sign.codevibe.in/http-api/sandbox) can call it.

For production, swap the memory adapters for `postgresStore`, `localFileStore`,
`smtpMailer` and a real seal certificate; see the server package README.
