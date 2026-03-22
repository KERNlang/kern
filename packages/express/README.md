# @kernlang/express

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
