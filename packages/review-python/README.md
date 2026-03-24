# @kernlang/review-python

[![npm](https://img.shields.io/npm/v/@kernlang/review-python?color=cb3837&label=npm)](https://www.npmjs.com/package/@kernlang/review-python)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/KERNlang/kern/blob/main/LICENSE)

Python concept mapper for kern review — tree-sitter based

Part of the [KERN monorepo](https://github.com/KERNlang/kern).

## Install

```bash
npm install @kernlang/review-python
```

## Usage

```ts
import { extractPythonConcepts } from '@kernlang/review-python';

const concepts = extractPythonConcepts(pythonSource);
// Returns a ConceptMap compatible with the TypeScript mapper output
```

## License

AGPL-3.0
