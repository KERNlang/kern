# @kernlang/terminal

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
