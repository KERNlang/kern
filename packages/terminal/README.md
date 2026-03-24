# @kernlang/terminal

[![npm](https://img.shields.io/npm/v/@kernlang/terminal?color=cb3837&label=npm)](https://www.npmjs.com/package/@kernlang/terminal)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/KERNlang/kern/blob/main/LICENSE)

Kern ANSI terminal rendering transpiler

Part of the [KERN monorepo](https://github.com/KERNlang/kern).

## Install

```bash
npm install @kernlang/terminal
```

## Usage

```ts
import { transpileTerminal, transpileInk } from '@kernlang/terminal';

const ansiOutput = transpileTerminal(kernSource);
const inkComponent = transpileInk(kernSource);
```

## License

AGPL-3.0
