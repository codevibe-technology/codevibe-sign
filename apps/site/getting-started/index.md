---
title: Install
description: Install the Codevibe Sign packages, check the requirements and pick between embedding the server and running it with Docker.
---

# Install

Codevibe Sign is a set of TypeScript packages. You can embed them in your own Node backend, or
run the standalone service as a Docker image. Either way the documents, keys and personal data
stay on your servers.

::: warning Pre-release
The packages are not published to npm yet; build them from the repository as shown below.
APIs may still change before 0.1.
:::

## Requirements

- Node 20 or later.
- PostgreSQL, for the server.
- An SMTP server for invitations and one-time codes, and an SMS gateway if you use SMS codes.
- A sealing certificate and key as a PKCS#12 (`.p12`) file. See
  [Sealing and verification](/concepts/sealing).

## Choose how to run it

| You want to                                                     | Use                                                 |
| --------------------------------------------------------------- | --------------------------------------------------- |
| Run signing as its own service and call it over HTTP            | [Self-host with Docker](./docker)                   |
| Start the server inside your existing Node app                  | [Embed in Node](./node)                             |
| Use the signing rules only, with your own storage and transport | [`@codevibe_technology/sign-core`](/api/core)       |
| Show the signing screen inside your React app                   | [`@codevibe_technology/sign-react`](/api/react)     |
| Add Aadhaar eSign for statutory signatures in India             | [`@codevibe_technology/sign-aadhaar`](/api/aadhaar) |

## Install the packages

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
cd sign
pnpm install
pnpm build
```

## Next

- Learn the model in [Envelopes](/concepts/envelopes).
- Walk through [sending your first envelope](/guides/first-envelope).
