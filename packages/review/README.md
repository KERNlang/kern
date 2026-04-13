# @kernlang/review

[![npm](https://img.shields.io/npm/v/@kernlang/review?color=cb3837&label=npm)](https://www.npmjs.com/package/@kernlang/review)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/KERNlang/kern/blob/main/LICENSE)

Kern Review -- 76+ rules, taint tracking, OWASP LLM01 coverage

Part of the [KERN monorepo](https://github.com/KERNlang/kern).

## Install

```bash
npm install @kernlang/review
```

## Usage

```ts
import { reviewFile, reviewSource, reviewDirectory } from '@kernlang/review';

const report = reviewFile('src/handler.ts');
console.log(report.findings);
```

## License

AGPL-3.0
