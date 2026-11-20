---
title: Install
description: Install the Codevibe Sign packages, check the requirements and pick between embedding the server and running it with Docker.
---

# Install

Codevibe Sign is a set of TypeScript packages. You can embed them in your own Node backend, or
run the standalone service as a Docker image. Either way the documents, keys and personal data
stay on your servers.

## Try it in a minute

```sh
npx codevibe-sign start --memory
```

This starts the server with everything in memory: a generated seal certificate, emails and
one-time codes printed to the terminal, and a fresh API key. It prints a `curl` command that
sends a PDF for signature. Open the signing link from the output, sign, download the sealed
file and check it:

```sh
npx codevibe-sign verify signed.pdf
```

Nothing is saved when it stops. For a walk-through of the API, see
[Send your first envelope](/guides/first-envelope).

::: warning Pre-release
The packages are not published to npm yet; build them from the repository as shown below.
APIs may still change before 0.1.
:::

## Requirements

- Node 20 or later.
- PostgreSQL, for the server.
- An SMTP server for invitations and one-time codes, and an SMS gateway if you use SMS codes.
- A sealing certificate and key as a PKCS#12 (`.p12`) file. See
  [Sealing and verification](/concepts/sealing). For development,
  `npx codevibe-sign keygen --out seal.p12` makes a self-signed one.

`start --memory` needs only Node: no database, mail server or certificate.

## Choose how to run it

| You want to                                                     | Use                                                 |
| --------------------------------------------------------------- | --------------------------------------------------- |
| Run signing as its own service and call it over HTTP            | [Self-host with Docker](/getting-started/docker)    |
| Run the same service without Docker                             | `npx codevibe-sign start`, with the same variables  |
| Start the server inside your existing Node app                  | [Embed in Node](/getting-started/node)              |
| Use the signing rules only, with your own storage and transport | [`@codevibe_technology/sign-core`](/api/core)       |
| Show the signing screen inside your React app                   | [`@codevibe_technology/sign-react`](/api/react)     |
| Add Aadhaar eSign for statutory signatures in India             | [`@codevibe_technology/sign-aadhaar`](/api/aadhaar) |

## Install the packages

Most projects need one package:

```sh
npm i codevibe-sign
```

It brings the server, client, PDF tools and core rules behind subpath imports, so each
bundle only carries what it uses, plus the `codevibe-sign` command line:

```ts check
import { startSignServer } from 'codevibe-sign/server';
import { createSignClient, verifyWebhook } from 'codevibe-sign/client';
import { verify } from 'codevibe-sign/pdf';
import type { Envelope } from 'codevibe-sign/core';
```

For the React components, add React: `npm i codevibe-sign react react-dom`, then import from
`codevibe-sign/react`.

You can also install the parts on their own:

```sh
# The server, with core and pdf as dependencies
pnpm add @codevibe_technology/sign-server

# The rules on their own
pnpm add @codevibe_technology/sign-core

# React components for the signing screen
pnpm add @codevibe_technology/sign-react react react-dom

# Aadhaar eSign through your provider account
pnpm add @codevibe_technology/sign-aadhaar @codevibe_technology/sign-core
```

npm and yarn work the same way.

## Build from source

Until the first release, build the packages from the repository:

```sh
git clone https://github.com/codevibe-technology/codevibe-sign.git
cd codevibe-sign
pnpm install
pnpm build
```

## Next

- Learn the model in [Envelopes](/concepts/envelopes).
- Walk through [sending your first envelope](/guides/first-envelope).
