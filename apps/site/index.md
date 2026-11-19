---
layout: home
markdownStyles: false
title: Codevibe Sign
titleTemplate: Open-source e-signatures you run yourself
description: Send documents for signature in the order you choose, seal the final PDF with your certificate and verify it offline. Apache-2.0 TypeScript packages and a Docker image.
---

<HomePage>
<template #code>
<div class="vp-doc">

```ts
import { readFile } from 'node:fs/promises';
import { createSignServer } from '@codevibe/sign-server';

const server = createSignServer({
  databaseUrl: process.env.DATABASE_URL,
  filesDir: './data/files',
  smtp: {
    host: 'smtp.example.com',
    port: 587,
    from: 'Sign <sign@example.com>',
  },
  seal: {
    p12: await readFile('./seal.p12'),
    passphrase: process.env.SEAL_P12_PASSPHRASE,
  },
  apiKeys: [process.env.SIGN_API_KEY],
  publicUrl: 'https://sign.example.com',
});

await server.listen(3000);
```

</div>
</template>
</HomePage>
