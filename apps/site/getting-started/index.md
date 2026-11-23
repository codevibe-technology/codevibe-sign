---
title: Install
description: Install the Codevibe Sign packages, see which licence each one carries, check the requirements and pick between embedding the server and running it with Docker.
---

# Install

Codevibe Sign is a set of TypeScript packages. You can embed them in your own Node backend, or
run the standalone service as a Docker image. Either way the documents, keys and personal data
stay on your servers.

## Try it in a minute

```sh
npx @codevibe_technology/sign-server start --memory
```

This starts the server with everything in memory: a generated seal certificate, emails and
one-time codes printed to the terminal, and a fresh API key. It prints a `curl` command that
sends a PDF for signature. Open the signing link from the output, enter the one-time code
printed after it, sign, download the sealed file and check it:

```sh
npx codevibe-sign verify signed.pdf
```

Nothing is saved when it stops. For a walk-through of the API, see
[Send your first envelope](/guides/first-envelope).

::: warning Before 1.0
The packages are published from version 0.1.0. Until 1.0, a minor release may change an API;
the changelog says so in its first line. Pin the version you install.
:::

## Two licences, kept apart

| You install                                                          | Licence       | What it is                                                                                                                                                       |
| -------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codevibe-sign` and the `@codevibe_technology/sign-*` libraries      | Apache-2.0    | The API client, PDF tools, core rules, React components, templates, Aadhaar eSign and the `codevibe-sign` command line. Use them in any product, open or closed. |
| `@codevibe_technology/sign-server`, the Docker image and the web app | AGPL-3.0-only | The HTTP API and the signing runtime. Free to run and change; share your changes if you offer a modified version to others over a network.                       |

`npm i codevibe-sign` only ever installs Apache-2.0 code. It does not contain the server and
does not depend on it. See
[LICENSING.md](https://github.com/codevibe-technology/codevibe-sign/blob/main/LICENSING.md).

## Requirements

- Node 22 or later.
- PostgreSQL, for the server.
- An SMTP server for invitations and one-time codes, and an SMS gateway if you use SMS codes.
- A sealing certificate and key as a PKCS#12 (`.p12`) file. See
  [Sealing and verification](/concepts/sealing). For development,
  `npx codevibe-sign keygen --out seal.p12` makes a self-signed one.

`start --memory` needs only Node: no database, mail server or certificate.

## Choose how to run it

| You want to                                                     | Use                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------- |
| Run signing as its own service and call it over HTTP            | [Self-host with Docker](/getting-started/docker)                      |
| Run the same service without Docker                             | `npx @codevibe_technology/sign-server start`, with the same variables |
| Start the server inside your existing Node app                  | [Embed in Node](/getting-started/node)                                |
| Use the signing rules only, with your own storage and transport | [`@codevibe_technology/sign-core`](/api/core)                         |
| Show the signing screen inside your React app                   | [`@codevibe_technology/sign-react`](/api/react)                       |
| Add Aadhaar eSign for statutory signatures in India             | [Aadhaar eSign with Leegality](/guides/aadhaar-leegality)             |

## Install the packages

To call a Codevibe Sign server from your product, most projects need one package:

```sh
npm i codevibe-sign
```

It brings the client, PDF tools and core rules behind subpath imports, so each bundle only
carries what it uses, plus the `codevibe-sign` command line (`verify`, `inspect`, `keygen`,
`hash` and `api-key`). All of it is Apache-2.0:

```ts check
import { createSignClient, verifyWebhook } from 'codevibe-sign/client';
import { verify } from 'codevibe-sign/pdf';
import type { Envelope } from 'codevibe-sign/core';
```

For the React components, add React: `npm i codevibe-sign react react-dom`, then import from
`codevibe-sign/react`.

The server is its own package under AGPL-3.0. Install it when you want to run the HTTP API
inside your own Node process:

```sh
npm i @codevibe_technology/sign-server
```

```ts check
import { startSignServer } from '@codevibe_technology/sign-server';
```

You can also install the libraries on their own:

```sh
# The rules on their own
pnpm add @codevibe_technology/sign-core

# React components for the signing screen
pnpm add @codevibe_technology/sign-react react react-dom

# Aadhaar eSign through your provider account
pnpm add @codevibe_technology/sign-aadhaar @codevibe_technology/sign-core
```

npm and yarn work the same way.

## Build from source

To work on the packages, or to try a change that is not released yet, build them from the
repository:

```sh
git clone https://github.com/codevibe-technology/codevibe-sign.git
cd codevibe-sign
pnpm install
pnpm build
```

## Next

- Learn the model in [Envelopes](/concepts/envelopes).
- Walk through [sending your first envelope](/guides/first-envelope).
