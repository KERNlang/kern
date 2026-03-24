# kern-lang

[![npm](https://img.shields.io/npm/v/kern-lang?color=cb3837&label=npm)](https://www.npmjs.com/package/kern-lang)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/KERNlang/kern/blob/main/LICENSE)

The language LLMs think in. Write one .kern file, ship 7 targets. 70% fewer tokens.

Part of the [KERN monorepo](https://github.com/KERNlang/kern).

## Install

```bash
npm install kern-lang
```

## Usage

```ts
// Compatibility wrapper — re-exports all @kernlang/* packages.
// For new projects, import from @kernlang/core + @kernlang/<target> directly.
import { parse, transpileTailwind, transpileExpress } from 'kern-lang';

const ast = parse(kernSource);
const react = transpileTailwind(ast);
const server = transpileExpress(ast);
```

## License

AGPL-3.0
