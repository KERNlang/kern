# @kernlang/core

Kern core — parser, types, spec, config, style engines, codegen

Part of the [KERN monorepo](https://github.com/KERNlang/kern).

## Install

```bash
npm install @kernlang/core
```

## Usage

```ts
import { parse, resolveConfig } from '@kernlang/core';

const config = resolveConfig({ target: 'react-tailwind' });
const ir = parse(`page "Home" { text "Hello" }`);
```

## License

AGPL-3.0
