# @kernlang/evolve

Kern Evolve — self-extending template system: detect gaps, propose templates, validate, stage

Part of the [KERN monorepo](https://github.com/KERNlang/kern).

## Install

```bash
npm install @kernlang/evolve
```

## Usage

```ts
import { evolve, evolveSource } from '@kernlang/evolve';

// Scan a project: detect gaps, propose templates, stage for approval
const result = await evolve('./src');

// Or analyze a single source string
const single = await evolveSource(tsCode, { threshold: 0.8 });
```

## License

AGPL-3.0
