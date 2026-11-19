---
layout: home
markdownStyles: false
title: Codevibe Sign
titleTemplate: Open-source e-signatures you run yourself
description: Send documents for signature in the order you choose, seal the final PDF with your certificate and verify it offline. Open-source TypeScript packages and a Docker image.
---

<HomePage>
<template #code>
<div class="vp-doc">

```ts check
import { readFile } from 'node:fs/promises';
import { startSignServer } from '@codevibe_technology/sign-server';

const sign = await startSignServer({
  databaseUrl: process.env.DATABASE_URL!,
  filesDir: './data/files',
  smtp: {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    user: 'sign',
    pass: process.env.SMTP_PASS!,
    from: 'Sign <sign@example.com>',
  },
  seal: { p12: await readFile('./seal.p12'), passphrase: process.env.SEAL_P12_PASSPHRASE! },
  apiKeys: [process.env.SIGN_API_KEY!],
  publicUrl: 'https://sign.example.com',
});

await sign.listen(3000);
```

</div>
</template>
</HomePage>
