# @kernlang/express

[![npm](https://img.shields.io/npm/v/@kernlang/express?color=cb3837&label=npm)](https://www.npmjs.com/package/@kernlang/express)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/KERNlang/kern/blob/main/LICENSE)

Kern Express TypeScript backend transpiler

Part of the [KERN monorepo](https://github.com/KERNlang/kern).

## Install

```bash
npm install @kernlang/express
```

## Usage

```ts
import { parse } from '@kernlang/core';
import { transpileExpress } from '@kernlang/express';

const ir = parse(`service "Api" { route "/users" method GET }`);
const result = transpileExpress(ir, { target: 'express' });
```

## License

AGPL-3.0
