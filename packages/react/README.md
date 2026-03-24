# @kernlang/react

[![npm](https://img.shields.io/npm/v/@kernlang/react?color=cb3837&label=npm)](https://www.npmjs.com/package/@kernlang/react)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/KERNlang/kern/blob/main/LICENSE)

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
