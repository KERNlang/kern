# @kernlang/metrics

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
