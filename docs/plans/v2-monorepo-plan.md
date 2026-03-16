# Kern v2.0.0 — Monorepo Restructure + Agon Build Pipeline

## Status
- Kern v1.0.0 shipped to npm as monolith (84KB, 67 files)
- 7 transpiler targets: nextjs, tailwind, web, native, express, cli, terminal
- 10 core language nodes: type, interface, fn, machine, error, config, store, test, event, module
- 116 tests across 7 suites
- Repo: github.com/cukas/KERNlang (private)
- npm: kern-lang@1.0.0

## What This Plan Covers

### Part A: Monorepo Restructure
Split the monolith into scoped packages so users install only what they need.

### Part B: Agon Build Pipeline
Wire `kern compile` so Agon can actually run on KERN-generated TypeScript.

---

## Part A: Monorepo Structure

### Tooling (consensus from Codex + Gemini brainstorm)
- **pnpm workspaces** — content-addressable storage, workspace:* protocol
- **TypeScript project references** — shared tsconfig.base.json, per-package tsconfig
- **Changesets** — automated semver bumping and scoped npm publishing
- **Turborepo** — add later when CI/build times matter (graph is still small)

### Package Map

```
kern-lang/
  pnpm-workspace.yaml
  tsconfig.base.json
  .changeset/config.json
  packages/
    core/           → @kern/core
    protocol/       → @kern/protocol
    react/          → @kern/react
    native/         → @kern/native
    express/        → @kern/express
    cli/            → @kern/cli
    terminal/       → @kern/terminal
    metrics/        → @kern/metrics
    compat/         → kern-lang (v2 compatibility wrapper)
```

### Package Contents

| Package | npm name | Contains | Depends on |
|---|---|---|---|
| core | @kern/core | parser, decompiler, spec, types, config, utils, styles-tailwind, styles-react, errors | jiti |
| protocol | @kern/protocol | draft-protocol | @kern/core (types only) |
| react | @kern/react | transpiler-tailwind, transpiler-nextjs, transpiler-web | @kern/core |
| native | @kern/native | transpiler (React Native) | @kern/core |
| express | @kern/express | transpiler-express (+ stream/spawn/timer) | @kern/core |
| cli | @kern/cli | transpiler-cli, cli.ts (kern binary) | @kern/core |
| terminal | @kern/terminal | transpiler-terminal, codegen-core | @kern/core |
| metrics | @kern/metrics | metrics, context-export | @kern/core |
| compat | kern-lang | re-exports all @kern/* packages | all @kern/* packages |

### Migration Strategy (no breaking changes)

**Phase 1:** Restructure internally, publish @kern/* packages
- Move source files into packages/
- Each package has its own package.json, tsconfig.json, src/, dist/
- Cross-package imports via @kern/* entrypoints ONLY (no relative ../core/src/...)
- Test that everything builds and passes

**Phase 2:** Publish kern-lang@2.0.0 as compatibility wrapper
- kern-lang re-exports everything from @kern/* packages
- `import { parse } from 'kern-lang'` still works
- `import { parse } from '@kern/core'` is the new recommended way
- `kern` CLI binary lives in @kern/cli, kern-lang re-exports it

**Phase 3:** Deprecation notice
- kern-lang@2.0.0 console.warn: "kern-lang is a compatibility wrapper. Install @kern/core + @kern/<target> directly."
- After 6 months, stop updating kern-lang (or keep it as pure passthrough)

### Each package.json template

```json
{
  "name": "@kern/core",
  "version": "2.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": "./dist/index.js" },
  "files": ["dist"],
  "license": "AGPL-3.0-or-later",
  "scripts": {
    "build": "tsc -b",
    "test": "node --experimental-vm-modules ../../node_modules/.bin/jest --forceExit"
  },
  "dependencies": { "jiti": "^2.6.1" }
}
```

### pnpm-workspace.yaml

```yaml
packages:
  - 'packages/*'
```

### tsconfig.base.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "composite": true
  }
}
```

---

## Part B: Agon Build Pipeline

### Current State (from Agon Opus)
- KERN CAN express Agon's types, interfaces, state machines, config, store, events, errors
- examples/agon-plan.kern shows the plan model in 85 lines
- But Agon still runs on hand-written TypeScript in packages/core/src/plan.ts
- KERN speaks Agon's language, but Agon doesn't speak KERN yet

### What's Missing

1. **`kern compile` command** — transpiles .kern → .ts files into a target directory
2. **Import resolution** — .kern files referencing other .kern files
3. **Multi-file compilation** — compile all .kern files in a directory
4. **Wire into Agon monorepo** — replace hand-written .ts with KERN-generated output

### Build Pipeline Design

```bash
# Compile single file
kern compile agon-plan.kern --outdir=src/generated/

# Compile all .kern files in a directory
kern compile src/kern/ --outdir=src/generated/

# Watch mode (future)
kern compile src/kern/ --outdir=src/generated/ --watch
```

### Compilation Flow

```
.kern source files
  → parse() each file
  → resolve imports between .kern files
  → codegen-core generates TypeScript per file
  → write to --outdir with source maps
  → Agon's tsconfig includes generated/ directory
```

### Agon Integration

```
Agon-AI/
  packages/
    core/
      src/
        kern/              ← .kern source files
          plan.kern
          scoring.kern
          elo.kern
          engine-registry.kern
        generated/          ← kern compile output (gitignored)
          plan.ts
          scoring.ts
          elo.ts
          engine-registry.ts
        index.ts            ← imports from ./generated/
```

### Rewrite Order (from Agon Opus)

| Priority | File | .kern equivalent | Complexity |
|---|---|---|---|
| 1 | plan.ts | agon-plan.kern (already exists) | Low — types + state machine |
| 2 | scoring.ts | scoring.kern | Medium — algorithms in handler blocks |
| 3 | elo.ts | elo.kern | Medium — math in handler blocks |
| 4 | engine-registry.ts | engine-registry.kern | Medium — store + config |
| 5 | repl.ts | agon-repl.kern | High — REPL + terminal nodes |
| 6 | forge.ts | agon-forge.kern | High — parallel + spawn + stream |

---

## Implementation Sequence

| Step | Task | Gate |
|---|---|---|
| 1 | Init pnpm workspace, create packages/ dirs | pnpm install works |
| 2 | Move @kern/core source files | @kern/core builds, tests pass |
| 3 | Move @kern/protocol | builds, tests pass |
| 4 | Move @kern/react (tailwind, nextjs, web) | builds, tests pass |
| 5 | Move @kern/native | builds, tests pass |
| 6 | Move @kern/express | builds, tests pass |
| 7 | Move @kern/cli | `kern` binary works |
| 8 | Move @kern/terminal | builds, tests pass |
| 9 | Move @kern/metrics | builds, tests pass |
| 10 | Create kern-lang compat wrapper | `npm install kern-lang` still works |
| 11 | Add `kern compile` command to @kern/cli | kern compile *.kern works |
| 12 | Publish all @kern/* + kern-lang@2.0.0 | npm install @kern/core works |

### Gate: All 116 tests pass at every step. No regressions.

---

## Decisions Made

- **pnpm** over npm/yarn (Codex + Gemini consensus)
- **@kern scope** for all packages
- **kern-lang stays** as compatibility wrapper (no breaking change for v1 users)
- **Changesets** for versioning (not lerna)
- **No turborepo yet** — add when CI/build times matter
- **codegen-core stays in @kern/terminal** — it's the primary Agon target

---

## Detailed File Moves

### @kern/core (the foundation — everything depends on this)

**Move these files to `packages/core/src/`:**
```
src/parser.ts        → packages/core/src/parser.ts
src/decompiler.ts    → packages/core/src/decompiler.ts
src/spec.ts          → packages/core/src/spec.ts
src/types.ts         → packages/core/src/types.ts
src/config.ts        → packages/core/src/config.ts
src/utils.ts         → packages/core/src/utils.ts
src/errors.ts        → packages/core/src/errors.ts
src/styles-tailwind.ts → packages/core/src/styles-tailwind.ts
src/styles-react.ts  → packages/core/src/styles-react.ts
src/codegen-core.ts  → packages/core/src/codegen-core.ts
```

**packages/core/src/index.ts** (barrel export):
```typescript
export { parse } from './parser.js';
export { decompile } from './decompiler.js';
export type { IRNode, IRSourceLocation, SourceMapEntry, TranspileResult, DecompileResult, GeneratedArtifact, KernEngine } from './types.js';
export { resolveConfig, mergeConfig, DEFAULT_CONFIG, VALID_TARGETS } from './config.js';
export type { KernConfig, KernTarget, ResolvedKernConfig } from './config.js';
export { KERN_VERSION, NODE_TYPES, STYLE_SHORTHANDS, VALUE_SHORTHANDS } from './spec.js';
export { stylesToTailwind, colorToTw, pxToTw, DEFAULT_COLORS } from './styles-tailwind.js';
export { expandStyles, expandStyleKey, expandStyleValue } from './styles-react.js';
export { countTokens, serializeIR, camelKey, escapeJsx } from './utils.js';
export { isCoreNode, generateCoreNode } from './codegen-core.js';
```

**packages/core/package.json:**
```json
{
  "name": "@kern/core",
  "version": "2.0.0",
  "description": "Kern core — parser, types, spec, config, style engines",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": "./dist/index.js" },
  "files": ["dist"],
  "license": "AGPL-3.0-or-later",
  "dependencies": { "jiti": "^2.6.1" }
}
```

**Internal imports** — all stay as `./xxx.js` (same package):
- parser.ts → `./types.js`, `./errors.js` ✓
- config.ts → `./styles-tailwind.js` ✓
- utils.ts → `./types.js` ✓
- All within same package, no changes needed.

---

### @kern/protocol

**Move:**
```
src/draft-protocol.ts → packages/protocol/src/draft-protocol.ts
```

**packages/protocol/src/index.ts:**
```typescript
export { buildKernDraftPrompt, parseKernDraft, buildKernRankPrompt } from './draft-protocol.js';
export type { KernDraft } from './draft-protocol.js';
```

**package.json dependencies:** none (draft-protocol has no imports from core)

**Import changes:** none — draft-protocol.ts has zero imports from other kern files.

---

### @kern/react

**Move:**
```
src/transpiler-tailwind.ts → packages/react/src/transpiler-tailwind.ts
src/transpiler-nextjs.ts   → packages/react/src/transpiler-nextjs.ts
src/transpiler-web.ts      → packages/react/src/transpiler-web.ts
```

**packages/react/src/index.ts:**
```typescript
export { transpileTailwind } from './transpiler-tailwind.js';
export { transpileNextjs } from './transpiler-nextjs.js';
export { transpileWeb } from './transpiler-web.js';
```

**Import changes (each transpiler file):**
```typescript
// OLD:
import type { IRNode, TranspileResult, SourceMapEntry } from './types.js';
import type { ResolvedKernConfig } from './config.js';
import { stylesToTailwind, colorToTw } from './styles-tailwind.js';
import { countTokens, serializeIR, camelKey, escapeJsx } from './utils.js';

// NEW:
import type { IRNode, TranspileResult, SourceMapEntry, ResolvedKernConfig } from '@kern/core';
import { stylesToTailwind, colorToTw, countTokens, serializeIR, camelKey, escapeJsx } from '@kern/core';
```

**package.json dependencies:** `{ "@kern/core": "workspace:*" }`

---

### @kern/native

**Move:**
```
src/transpiler.ts → packages/native/src/transpiler.ts
```

**Import changes:**
```typescript
// OLD:
import type { IRNode, TranspileResult, SourceMapEntry } from './types.js';
import type { ResolvedKernConfig } from './config.js';
import { expandStyles } from './styles-react.js';
import { countTokens, serializeIR } from './utils.js';

// NEW:
import type { IRNode, TranspileResult, SourceMapEntry, ResolvedKernConfig } from '@kern/core';
import { expandStyles, countTokens, serializeIR } from '@kern/core';
```

**package.json dependencies:** `{ "@kern/core": "workspace:*" }`

---

### @kern/express

**Move:**
```
src/transpiler-express.ts → packages/express/src/transpiler-express.ts
```

**Import changes:**
```typescript
// OLD:
import type { ResolvedKernConfig } from './config.js';
import type { GeneratedArtifact, IRNode, SourceMapEntry, TranspileResult } from './types.js';
import { camelKey, countTokens, serializeIR } from './utils.js';

// NEW:
import type { ResolvedKernConfig, GeneratedArtifact, IRNode, SourceMapEntry, TranspileResult } from '@kern/core';
import { camelKey, countTokens, serializeIR } from '@kern/core';
```

**package.json dependencies:** `{ "@kern/core": "workspace:*" }`

---

### @kern/cli

**Move:**
```
src/transpiler-cli.ts → packages/cli/src/transpiler-cli.ts
src/cli.ts            → packages/cli/src/cli.ts
```

**cli.ts import changes:**
```typescript
// OLD:
import { parse } from './parser.js';
import { transpile } from './transpiler.js';
import { transpileWeb } from './transpiler-web.js';
import { transpileTailwind } from './transpiler-tailwind.js';
import { transpileNextjs } from './transpiler-nextjs.js';
import { transpileExpress } from './transpiler-express.js';
import { transpileCliApp } from './transpiler-cli.js';
import { transpileTerminal } from './transpiler-terminal.js';
import { decompile } from './decompiler.js';
import { resolveConfig, VALID_TARGETS } from './config.js';
import { collectLanguageMetrics } from './metrics.js';

// NEW:
import { parse, decompile, resolveConfig, VALID_TARGETS } from '@kern/core';
import type { ResolvedKernConfig, KernTarget, IRNode } from '@kern/core';
import { transpile } from '@kern/native';
import { transpileWeb, transpileTailwind, transpileNextjs } from '@kern/react';
import { transpileExpress } from '@kern/express';
import { transpileCliApp } from './transpiler-cli.js';
import { transpileTerminal } from '@kern/terminal';
import { collectLanguageMetrics } from '@kern/metrics';
```

**package.json dependencies:**
```json
{
  "@kern/core": "workspace:*",
  "@kern/react": "workspace:*",
  "@kern/native": "workspace:*",
  "@kern/express": "workspace:*",
  "@kern/terminal": "workspace:*",
  "@kern/metrics": "workspace:*"
}
```

**bin field:** `{ "kern": "./dist/cli.js" }`

---

### @kern/terminal

**Move:**
```
src/transpiler-terminal.ts → packages/terminal/src/transpiler-terminal.ts
```

**Import changes:**
```typescript
// OLD:
import type { IRNode, TranspileResult, SourceMapEntry } from './types.js';
import type { ResolvedKernConfig } from './config.js';
import { countTokens, serializeIR } from './utils.js';
import { isCoreNode, generateCoreNode } from './codegen-core.js';

// NEW:
import type { IRNode, TranspileResult, SourceMapEntry, ResolvedKernConfig } from '@kern/core';
import { countTokens, serializeIR, isCoreNode, generateCoreNode } from '@kern/core';
```

**package.json dependencies:** `{ "@kern/core": "workspace:*" }`

---

### @kern/metrics

**Move:**
```
src/metrics.ts        → packages/metrics/src/metrics.ts
src/context-export.ts → packages/metrics/src/context-export.ts
```

**context-export.ts import changes:**
```typescript
// OLD:
import { parse } from './parser.js';
import { collectLanguageMetrics, mergeMetrics } from './metrics.js';
import { resolveConfig } from './config.js';

// NEW:
import { parse, resolveConfig } from '@kern/core';
import type { ResolvedKernConfig, KernTarget } from '@kern/core';
import { collectLanguageMetrics, mergeMetrics } from './metrics.js';
```

**package.json dependencies:** `{ "@kern/core": "workspace:*" }`

---

### kern-lang (compat wrapper)

**packages/compat/src/index.ts:**
```typescript
// Compatibility wrapper — re-exports all @kern/* packages
export * from '@kern/core';
export * from '@kern/protocol';
export { transpileTailwind, transpileNextjs, transpileWeb } from '@kern/react';
export { transpile } from '@kern/native';
export { transpileExpress } from '@kern/express';
export { transpileCliApp } from '@kern/cli';
export { transpileTerminal } from '@kern/terminal';
export { collectLanguageMetrics, mergeMetrics, isEscapedStyleKey } from '@kern/metrics';
export { scanKernProject, projectToKern } from '@kern/metrics';
export type { ProjectSummary } from '@kern/metrics';
```

**package.json:**
```json
{
  "name": "kern-lang",
  "version": "2.0.0",
  "description": "The language LLMs think in. Write one .kern file, ship 7 targets. 70% fewer tokens.",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": { "kern": "./node_modules/@kern/cli/dist/cli.js" },
  "dependencies": {
    "@kern/core": "workspace:*",
    "@kern/protocol": "workspace:*",
    "@kern/react": "workspace:*",
    "@kern/native": "workspace:*",
    "@kern/express": "workspace:*",
    "@kern/cli": "workspace:*",
    "@kern/terminal": "workspace:*",
    "@kern/metrics": "workspace:*"
  }
}
```

---

## Test Distribution

```
tests/fitness.test.ts      → packages/core/tests/ (parser, spec, decompiler, config tests)
                            + packages/react/tests/ (tailwind, nextjs tests)
                            + packages/native/tests/ (native transpiler tests)
                            + packages/express/tests/ (express tests)
                            + packages/cli/tests/ (cli transpiler tests)
                            + packages/terminal/tests/ (terminal tests)
tests/golden.test.ts       → packages/react/tests/ (tailwind + nextjs snapshots)
tests/metrics.test.ts      → packages/metrics/tests/
tests/context-export.test.ts → packages/metrics/tests/
tests/draft-protocol.test.ts → packages/protocol/tests/
tests/codegen-core.test.ts → packages/core/tests/
tests/integration.test.ts  → root tests/ (cross-package integration)
```

---

## Execution Checklist

```
[ ] 1. npm install -g pnpm (if not installed)
[ ] 2. Create pnpm-workspace.yaml at root
[ ] 3. Create tsconfig.base.json at root
[ ] 4. npx changeset init
[ ] 5. mkdir -p packages/{core,protocol,react,native,express,cli,terminal,metrics,compat}/src
[ ] 6. Move @kern/core files → packages/core/src/
[ ] 7. Create packages/core/package.json + tsconfig.json + src/index.ts
[ ] 8. pnpm install && pnpm --filter @kern/core build → GATE: builds
[ ] 9. Move @kern/protocol → packages/protocol/src/
[ ] 10. Create package.json + index.ts, build → GATE: builds
[ ] 11. Move @kern/react → packages/react/src/, update imports to @kern/core
[ ] 12. Create package.json + index.ts, build → GATE: builds
[ ] 13. Repeat for native, express, terminal, metrics
[ ] 14. Move @kern/cli last (depends on all others)
[ ] 15. Create compat wrapper → packages/compat/
[ ] 16. Move tests to per-package directories
[ ] 17. pnpm -r build → GATE: all packages build
[ ] 18. pnpm -r test → GATE: all 116 tests pass
[ ] 19. Register @kern scope on npm: npm access set-mfa-auth @kern
[ ] 20. pnpm -r publish → all @kern/* packages on npm
[ ] 21. Publish kern-lang@2.0.0 compat wrapper
```

---

## Dependency Graph

```
@kern/core ← foundation, no @kern dependencies
  ↑
  ├── @kern/protocol (types only)
  ├── @kern/react (styles-tailwind, utils)
  ├── @kern/native (styles-react, utils)
  ├── @kern/express (utils)
  ├── @kern/terminal (utils, codegen-core)
  ├── @kern/metrics (parser, config)
  └── @kern/cli (depends on ALL above)
        ↑
        kern-lang (compat wrapper, depends on ALL)
```

No circular dependencies. @kern/core is the single root.

---

## npm Scope Registration

Before publishing @kern/* packages, register the scope:
```bash
npm login --scope=@kern
# Or create org at npmjs.com/org/create → name: kern
```

---

## Reviewed By

- Codex (GPT-5.4) — APPROVE, confidence 95
- Gemini — APPROVE, confidence 95
- Both agreed on pnpm + changesets + compat wrapper pattern
