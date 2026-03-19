# KERN Concept Model — Design Document

**Date:** 2026-03-19
**Status:** Approved for MVP
**Contributors:** Claude (Opus), Gemini, Codex, Nico

## Vision

KERN becomes an **Architectural Governance Engine** — not a linter, not a syntax matcher. It models the **meaning** of code as universal concepts, enabling cross-language architectural rules that no other tool can express.

**One-liner:** "Write your architecture rules once. KERN enforces them across every language, every service, every PR."

## The Breakthrough

Code concepts are universal. "Empty catch" means the same thing in every language — only the syntax differs:
- TypeScript: `catch (e) {}`
- Python: `except Exception: pass`
- Go: `if err != nil {}`
- Rust: `let _ = might_fail()`

KERN doesn't model syntax. It models **concepts**. The mapper per language translates syntax → concepts. Rules operate on concepts.

This is different from:
- **Semgrep** — matches syntax patterns
- **CodeQL** — general-purpose query database
- **SonarQube** — per-language file-level analysis

KERN models **meaning**.

## Architecture

```
Layer 0: KERN Concept Model (universal, cross-language)
         Small fixed ontology of review-relevant facts
         Mappers: tree-sitter per language → concepts
         Each concept has: span, evidence, confidence, language tags

Layer 1: Native AST (language-specific, optional)
         ts-morph for TypeScript deep rules
         tree-sitter-python for Python deep rules
         Kept for: type narrowing, ownership, decorators, JSX, etc.

Layer 2: KERN IR (lifted from concepts)
         machines, events, configs, state contracts
         Architectural rules — cross-language

Layer 3: LLM Review (operates on concepts + KERN IR)
         Structured fact set, not raw code
         "3 network calls, no recovery, DB error ignored"

Layer 4: Import Graph + Feature Path
         Traces concepts across files and services
         "This API route → auth service → DB → error ignored"
```

## Concept Vocabulary (v1 — 8 concepts)

Defined from **review questions**, not AST nouns.

| Concept | Meaning | Fields |
|---------|---------|--------|
| `entrypoint` | Where execution starts | kind (route, handler, main, export), name |
| `call_edge` | Function calls another function | caller, callee, async? |
| `dependency_edge` | Module imports another module | from, to, kind (internal, external, stdlib) |
| `effect` | Side effect | kind (network, db, fs, process, time, random), target |
| `state_write` | Mutating state | target, scope (local, module, global, shared) |
| `error_signal` | Error produced | kind (throw, reject, err-return, panic) |
| `error_disposition` | What happened to the error | kind (ignored, logged, wrapped, returned, rethrown, retried) |
| `guard_check` | Auth/validation/policy check | kind (auth, validation, policy, rate-limit) |

Each emitted concept includes:
- `span`: source location for mapping findings back
- `evidence`: the actual code that was classified
- `confidence`: how sure the mapper is (0-1)
- `language`: source language tag
- `metadata`: language-specific extensions

## Rules (v1 — 5 rules)

| Rule | Concept Query | Severity |
|------|--------------|----------|
| Ignored error | `error_signal` with `error_disposition=ignored` | error |
| Unguarded external call | `effect(network)` without `guard_check(auth)` ancestor | warning |
| Missing recovery | `effect(network\|db)` without ancestor `error_disposition(wrapped\|retried\|returned)` | warning |
| State mutation outside boundary | `state_write(shared)` not inside allowed module | error |
| Illegal dependency | `dependency_edge` crosses defined architectural boundary | warning |

## What stays in Native AST

NOT universal — keep in language-specific layers:
- Type-system specifics (TS conditional types, Rust traits/lifetimes)
- Language-specific control flow (Go defer, Rust panic/recover, Python yield)
- Metaprogramming (Rust macros, Python metaclasses, TS decorators)
- Dynamic/runtime tricks (reflection, monkey-patching, eval)
- Precise scope/type resolution edge cases
- Framework rules (React hooks, Vue reactivity, Express middleware)

**Rule of thumb:** universalize review concepts, not compiler internals.

## MVP Plan

### Phase 1: TS + Python (fast — infrastructure exists)

1. Define concept schema in `@kernlang/core`
2. Extend existing ts-morph inferrer to emit concepts alongside KERN IR
3. Build tree-sitter-python mapper → same concepts
4. Implement 5 concept rules
5. Prove: "unguarded external call" works on both TS and Python
6. Test on audiofacets backend (TS) + any Python project

### Phase 2: + Go (convincing — proves it's truly semantic)

1. Build tree-sitter-go mapper → same concepts
2. Same 5 rules work on Go with zero changes
3. Demo: one rule governs a polyglot microservice stack

### Phase 3: Feature-path governance

1. Cross-service concept tracing via import graph
2. "This API route → calls auth → calls DB → error ignored"
3. Cross-language duplication via concept structural hash

## Competitive Position

| Tool | What it does | KERN advantage |
|------|-------------|----------------|
| SonarQube | Per-language file analysis, 300+ rules | KERN: cross-language concepts, architectural governance, LLM layer |
| Semgrep | Syntax pattern matching, multi-language | KERN: semantic concepts not syntax, high-level IR, feature-path tracing |
| CodeQL | Semantic database + query language | KERN: fixed opinionated ontology (simpler), LLM layer, no query language needed |
| ESLint | JavaScript/TS linting | KERN: multi-language, architectural, concepts > syntax |

## Input Sources

- **Gemini:** "Be an Architectural Governance Engine. Use the AST to feed high-level IR. Only tool that understands Architecture-as-Code across languages."
- **Codex:** "Universalize review concepts, not compiler internals. Keep vocabulary review-driven. Mappers must preserve evidence and uncertainty."
- **Claude:** Concept model completes existing KERN inferrer pattern. LLM layer becomes surgical with structured facts. Import graph + concepts = feature-path governance.
- **Nico:** "Empty-catch is just a concept. You know the difference per language. You can translate." — the breakthrough insight that started this.
