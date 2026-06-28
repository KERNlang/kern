# @kernlang/cli

[![npm](https://img.shields.io/npm/v/@kernlang/cli?color=cb3837&label=npm)](https://www.npmjs.com/package/@kernlang/cli)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/KERNlang/kern/blob/main/LICENSE)

KERN CLI — transpile, compile, minify, and analyze .kern files

Part of the [KERN monorepo](https://github.com/KERNlang/kern).

## Install

```bash
npm install -g @kernlang/cli
```

## Usage

```bash
kern compile src/ --target react-tailwind
kern review src/ --recursive --llm
kern evolve src/ --propose
kern rag eval path/to/eval-ci.kern --json
```

## RAG

`kern rag` runs KERN RAG declarations for local retrieval, index lifecycle
checks, adapter conformance, and CI-friendly eval reports.

```bash
kern rag retrieve path/to/local-only.kern --param "question=refund policy" --json
kern rag index path/to/eval-ci.kern --status --json
kern rag eval path/to/eval-ci.kern --json
```

In the monorepo, use [`examples/rag-starter/`](../../examples/rag-starter/).
For the full guide, see [`docs/rag.md`](../../docs/rag.md) and
[`docs/rag-troubleshooting.md`](../../docs/rag-troubleshooting.md).

## License

AGPL-3.0
