# @kernlang/review-python

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
