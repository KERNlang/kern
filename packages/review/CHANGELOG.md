# @kernlang/review

## Unreleased

### Features

- 08147cd: **Wire parseWithDiagnostics into review pipeline** — `.kern` files now get structured parse diagnostics as review findings
  - Parse errors surfaced as warnings by default (prevents CI breakage on WIP files)
  - `hasParseErrors` flag skips structural lint on partial ASTs to prevent cascading false positives
- **`--strict-parse` flag** — opt-in to preserve parse error severity as `'error'` for strict CI enforcement
  - New `strictParse?: boolean` in `ReviewConfig`

### Bug Fixes

- Removed unused imports: `resolve`, `flattenIR` (confidence.ts, ground-layer.ts), `IRNode` (differ.ts), `SyntaxKind` (template-detector.ts)

### Dependencies

- @kernlang/core (parseWithDiagnostics, ParseDiagnostic)

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

### Patch Changes

- Updated dependencies [2523ee7]
  - @kernlang/core@3.0.0
