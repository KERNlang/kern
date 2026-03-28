# @kernlang/cli

## Unreleased

### Features

- fef17d7: **Parse diagnostics in CLI** — `surfaceParseDiagnostics()` writes structured parse errors/warnings to stderr
- **`--strict-parse` flag** — when combined with `--enforce`, parse errors count as errors (not downgraded to warnings)

### Bug Fixes

- Removed unused imports: `reviewDirectory`, `reviewSource`, `formatReportJSON`, `parseLLMResponse`

### Dependencies

- @kernlang/core (parseWithDiagnostics, ParseDiagnostic)
- @kernlang/review (strictParse config)

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
  - @kernlang/react@3.0.0
  - @kernlang/vue@3.0.0
  - @kernlang/native@3.0.0
  - @kernlang/express@3.0.0
  - @kernlang/fastapi@3.0.0
  - @kernlang/terminal@3.0.0
  - @kernlang/review@3.0.0
  - @kernlang/evolve@3.0.0
  - @kernlang/metrics@3.0.0
