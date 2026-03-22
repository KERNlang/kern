# @kernlang/react

Kern React transpilers — Tailwind, Next.js, Web

Part of the [KERN monorepo](https://github.com/KERNlang/kern).

## Install

```bash
npm install @kernlang/react
```

## Usage

```ts
import { parse } from '@kernlang/core';
import { transpileTailwind } from '@kernlang/react';

const ir = parse(`page "Home" { text "Hello" }`);
const result = transpileTailwind(ir, { target: 'react-tailwind' });
```

## License

AGPL-3.0
