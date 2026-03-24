# @kernlang/core

[![npm](https://img.shields.io/npm/v/@kernlang/core?color=cb3837&label=npm)](https://www.npmjs.com/package/@kernlang/core)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/KERNlang/kern/blob/main/LICENSE)

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
