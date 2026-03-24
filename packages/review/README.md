# @kernlang/review

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
