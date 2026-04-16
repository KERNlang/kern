# @kernlang/terminal

[![npm](https://img.shields.io/npm/v/@kernlang/terminal?color=cb3837&label=npm)](https://www.npmjs.com/package/@kernlang/terminal)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/KERNlang/kern/blob/main/LICENSE)

Kern ANSI terminal rendering transpiler with two separate targets:

- `terminal`: pure ANSI / Node.js output
- `ink`: React + Ink terminal UI output

Part of the [KERN monorepo](https://github.com/KERNlang/kern).

## Install

```bash
npm install @kernlang/terminal
```

Generated Ink apps also need runtime dependencies in the consuming project:

```bash
npm install react ink @inkjs/ui
```

Current upstream runtime baseline:

- `react` `19.2.x`
- `ink` `7.x`
- Node.js `22+`

## Usage

```ts
import { transpileTerminal, transpileInk } from '@kernlang/terminal';

const ansiOutput = transpileTerminal(kernSource);
const inkComponent = transpileInk(kernSource);
```

## Ink Output

`transpileInk()` returns the component source in `result.code` and, when the screen is exported, a runnable entry artifact in `result.artifacts`.

For the CLI path, `kern compile --target=ink` now emits:

- `<name>.tsx` — the generated screen/component module
- `<name>.entry.tsx` — the runnable Ink entrypoint (`render(<Screen />)` + `waitUntilExit()`)

Use the companion `*.entry.tsx` file as the process entry when you want to run the generated Ink app directly.

## License

AGPL-3.0
