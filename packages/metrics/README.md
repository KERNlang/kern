# @kernlang/metrics

[![npm](https://img.shields.io/npm/v/@kernlang/metrics?color=cb3837&label=npm)](https://www.npmjs.com/package/@kernlang/metrics)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/KERNlang/kern/blob/main/LICENSE)

Kern language metrics and project context export

Part of the [KERN monorepo](https://github.com/KERNlang/kern).

## Install

```bash
npm install @kernlang/metrics
```

## Usage

```ts
import { collectLanguageMetrics, scanKernProject } from '@kernlang/metrics';

const metrics = collectLanguageMetrics(kernAst);
const summary = await scanKernProject('./src');
```

## License

AGPL-3.0
