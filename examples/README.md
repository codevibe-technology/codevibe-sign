# Examples

Small, runnable programs that show how the packages fit together. They are not published.

| Example                              | What it shows                                                          |
| ------------------------------------ | ---------------------------------------------------------------------- |
| [`node-embed`](node-embed)           | The server inside a Node process, sending an envelope with the client. |
| [`express-webhook`](express-webhook) | Receiving and verifying webhooks.                                      |
| [`react-signing`](react-signing)     | A signing page with `SigningView` and `createSignerClient`.            |

Build the packages once from the repository root, then start any example:

```sh
pnpm install
pnpm build
pnpm --filter example-node-embed start
```

The three work together. In three terminals:

```sh
pnpm --filter example-express-webhook start
WEBHOOK_URL=http://localhost:4000/webhooks/sign pnpm --filter example-node-embed start
pnpm --filter example-react-signing start
```

Open the signing link that `node-embed` prints, sign in the browser, and watch the webhooks
arrive.
