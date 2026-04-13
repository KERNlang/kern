# @kernlang/core

## Unreleased

### Features

- 0120b71: **Structured parser error recovery** — parser now reports ALL diagnostics at once instead of stopping at the first error
  - New `parseWithDiagnostics()` and `parseDocumentWithDiagnostics()` APIs return `{ root, diagnostics }`
  - New `parseStrict()` and `parseDocumentStrict()` throw on any error with full diagnostic list
  - `ParseDiagnostic` type with severity, code, line/col, endCol, and suggestion fields
  - Diagnostic codes: `DROPPED_LINE`, `UNKNOWN_NODE_TYPE`, `UNEXPECTED_TOKEN`, `INVALID_INDENT`, `UNCLOSED_BLOCK`
- fef17d7: **KernRuntime** — instance-based state replacing 6 module-level global registries
  - Centralizes parserHints, multilineBlockTypes, dynamicNodeTypes, evolvedGenerators, evolvedTargetGenerators, templateRegistry
  - `defaultRuntime` singleton for backward compatibility
  - `reset()` method for test isolation
  - **Runtime threading**: `parse()`, `parseDocument()`, `parseWithDiagnostics()`, `generateCoreNode()`, `isTemplateNode()`, `expandTemplateNode()`, `isKnownNodeType()` all accept optional `runtime?: KernRuntime` parameter for true instance isolation
- fef17d7: **Schema validation** — `validateSchema()` validates IRNode props against `NODE_SCHEMAS`
- fef17d7: **Codegen refactor** — safe emitters and helpers extracted to `codegen/emitters.ts` and `codegen/helpers.ts`
  - New subpath export `@kernlang/core/codegen/emitters`
  - `emitTypeAnnotation()` and `emitImportSpecifier()` added to safe emitters
- fef17d7: **API slimming** — individual generator exports (`generateType`, `generateInterface`, etc.) removed from main barrel; available via `@kernlang/core/codegen` subpath

### Bug Fixes

- Removed 3 unused imports

## 3.0.0

### Major Changes

- 2523ee7: KERN 3.0 — security hardening, self-review clean, 68+ review rules

  - **kern review**: 76+ rules across 10 layers — base, React, Next.js, Vue, Express, security (v1-v4), dead logic, null safety, concept rules, taint tracking
  - **OWASP LLM01**: 10 prompt injection detection rules — indirect injection, output execution, system prompt leakage, RAG poisoning, tool manipulation
  - **Taint tracking**: source-to-sink analysis on KERN IR with cross-file tracking
  - **Suppression engine**: `// kern-ignore` and `// kern-ignore-next-line` directives
  - **Self-review clean**: 148 files pass kern review — command injection fixed, regex-dos hardened, null safety guards, error handling improved
  - **Evolve v4**: 13 commands, target-specific codegen, interactive review
  - **Transpilers**: `'use client'` auto-detection for generated components with event handlers
  - **Code quality**: bounded regex quantifiers, sanitized exec inputs, LLM output validation
