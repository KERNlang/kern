# Evolve v3: Language-Level Gap Detection

**Date:** 2026-03-20
**Status:** Design proposal — needs forge review
**Depends on:** Backend node decisions from forge brief

---

## The Problem with Evolve v2

Evolve v2 is a **template miner**. It scans TS codebases for library usage patterns (React Hook Form, Zustand, Axios) and proposes `.kern` template snippets. Templates are parameterized macros — they expand to code but don't extend KERN's IR.

What Evolve v2 **cannot** detect:
- KERN has no `model` node → it can't express database entities
- KERN has no `repository` node → it can't express query layers
- 80% of a backend is structurally invisible to KERN's type system

What Evolve v3 should do: **detect that KERN's IR is missing node types** and propose them.

---

## Vision: The Self-Extending Language

```
             Target Codebase (fitVT)
                     │
                     ▼
            ┌─────────────────┐
            │  Pattern Miner  │  ← scans for architectural patterns
            └────────┬────────┘
                     │ PatternCluster[]
                     ▼
            ┌─────────────────┐
            │  Coverage Diff  │  ← compares against KERN node inventory
            └────────┬────────┘
                     │ CoverageGap[]
                     ▼
            ┌─────────────────┐
            │  Node Designer  │  ← proposes syntax, props, children, codegen
            └────────┬────────┘
                     │ NodeProposal[]
                     ▼
            ┌─────────────────┐
            │  Codegen Writer  │  ← generates parser + codegen + tests
            └────────┬────────┘
                     │ GeneratedFiles[]
                     ▼
            ┌─────────────────┐
            │  Human Review   │  ← staged for approval, like v2
            └─────────────────┘
```

---

## Phase 1: Pattern Miner

**Input:** A directory of source files (TS or Python)
**Output:** `PatternCluster[]` — groups of structurally similar code

### Pattern Categories (hardcoded detectors + LLM-assisted)

| Category | Detection Method | Example |
|---|---|---|
| ORM Models | Decorators (`@Entity`, `@Column`), base class inheritance (`Base`, `BaseModel`), SQLAlchemy `Column()` calls | SQLAlchemy model with 20 columns |
| Repository/DAO | Class with CRUD methods + DB session injection, generic base class | `BaseRepository[ModelType]` with `get_by_id`, `create`, etc. |
| DI Factories | Functions returning service instances with injected deps, `Depends()` chains | `async def get_auth_service(db=Depends(get_db))` |
| Cache Patterns | Redis get/set with TTL, decorator caching, sorted set rate limiting | `await redis.set(key, value, ex=3600)` |
| Background Jobs | Queue producers/consumers, scheduled tasks, cron-like polling loops | `asyncio.create_task(worker())`, `@app.on_event("startup")` |
| Middleware Stacks | Request/response interceptors, class-based middleware with `dispatch` | `class RateLimitMiddleware(BaseHTTPMiddleware)` |
| Exception Hierarchy | Multi-level exception classes with status codes, custom base | `class NotFoundException(BaseAppException)` |
| Config/Settings | Env-backed config classes, settings patterns | `class Settings(BaseSettings)` |
| Storage/Upload | Pre-signed URL generation, multipart upload, file validation | `generate_presigned_post(Bucket=...)` |
| Email/Notification | Template-based sending, rate limiting, provider abstraction | `await client.post('/smtp/email', json=payload)` |

### Detection Strategy

For each category, two complementary detectors:

**a) Structural detector (fast, regex + import analysis):**
- Match import patterns (`from sqlalchemy import Column`, `from fastapi import Depends`)
- Match class inheritance (`class X(BaseModel)`, `class X(BaseHTTPMiddleware)`)
- Match decorator patterns (`@app.get`, `@router.post`)
- Count occurrences → only flag categories with 2+ instances (not one-offs)

**b) Concept detector (deeper, uses KERN concept model):**
- Run `extractTsConcepts()` or Python equivalent
- Map concepts to pattern categories:
  - `entrypoint` + `effect` → route with side effects
  - `state_mutation` + `guard` → service with validation
  - `dependency` → injection point
  - `error_raise` + `error_handle` → exception hierarchy

### Output: `PatternCluster`

```typescript
interface PatternCluster {
  category: string;           // 'orm-model' | 'repository' | 'di-factory' | ...
  instances: PatternInstance[];
  frequency: number;          // how many files use this pattern
  confidence: number;         // 0-1, how sure are we this is a real pattern
  representative: string;     // one instance's code, for display
  extractedShape: {           // common structure across instances
    props: string[];          // shared prop names (e.g., 'name', 'table', 'extends')
    children: string[];       // child types (e.g., 'column', 'relationship')
    methods: string[];        // method signatures
  };
}
```

---

## Phase 2: Coverage Diff

**Input:** `PatternCluster[]` + KERN's `CORE_NODE_TYPES` + target transpiler capabilities
**Output:** `CoverageGap[]`

For each pattern cluster, check:
1. Does a KERN node type exist that covers this pattern?
2. If yes, does it cover the full shape (all props, children, methods)?
3. If partial, what's missing?

```typescript
interface CoverageGap {
  cluster: PatternCluster;
  coverage: 'none' | 'partial' | 'full';
  existingNode?: string;      // e.g., 'interface' partially covers ORM models
  missingCapabilities: string[]; // e.g., ['column constraints', 'relationships', 'computed properties']
  proposedNodeType: string;   // e.g., 'model'
  priority: number;           // based on frequency × impact
}
```

**Coverage matching rules:**
- `interface` covers data shape → but not column constraints, relationships, indexes
- `service` covers class with methods → but not DI wiring, base class generics
- `middleware` covers request interceptors → but not rate limiting semantics
- `error` covers exception classes → but not status code mapping, hierarchy
- `config` covers env settings → already good enough
- `fn` covers pure functions → already good enough

---

## Phase 3: Node Designer

**Input:** `CoverageGap[]`
**Output:** `NodeProposal[]`

For each gap, propose a KERN node design:

```typescript
interface NodeProposal {
  name: string;               // 'model'
  props: PropSpec[];          // [{name: 'table', type: 'string', required: false}, ...]
  children: ChildSpec[];      // [{type: 'column', props: [...]}, ...]
  exampleKern: string;        // valid .kern source showing usage
  exampleTsOutput: string;    // what it should generate (TS)
  examplePyOutput: string;    // what it should generate (Python)
  designNotes: string;        // rationale, alternatives considered
  priority: number;
}
```

### Design Heuristics

1. **Mirror the pattern's shape.** If every ORM model has columns + relationships + constraints, the node needs those as children.
2. **Prefer declarative over imperative.** `column name=email type=string unique=true` beats `handler <<<Column(String, unique=True)>>>`
3. **Keep handler escape hatch.** Complex query logic or computed properties use `handler <<<>>>`.
4. **One node per concept.** Don't overload `interface` to also mean "ORM model". New concept = new node.
5. **Check KERN naming conventions.** lowercase, short: `type`, `fn`, `store`, `event`. So `model` not `databaseModel`.

### LLM-Assisted Design (optional)

If an LLM is available (via `--llm` flag, like `kern review --llm`):
- Feed the pattern instances + KERN syntax examples → ask for proposed `.kern` syntax
- Validate the proposal parses (run through KERN parser)
- Score multiple proposals by compactness (token reduction) and expressiveness

---

## Phase 4: Codegen Writer (the dream)

**Input:** `NodeProposal[]`
**Output:** Generated source files for KERN itself

For each approved node proposal, generate:

1. **Parser support** — if the node needs special parsing (like `route GET /path` positional syntax), generate a parser clause. Most nodes work with the generic `key=value` parser already.

2. **Core codegen** — `generateModel()` function in `codegen-core.ts` for TS output, `generatePythonModel()` in `codegen-python.ts` for Python output.

3. **Express transpiler** — add to `TOP_LEVEL_CORE` set, handle in `coreNodeMeta()` mapping, possibly generate dedicated artifact files.

4. **FastAPI transpiler** — same as Express, Python output.

5. **Tests** — at minimum, a parse-round-trip test and a golden-output test.

6. **Type updates** — add new artifact types to `GeneratedArtifact['type']` union if needed.

### Self-Modification Strategy

Evolve v3 should NOT directly modify KERN source files. Instead:

```
evolve-v3/
  proposals/
    model.json          ← NodeProposal + generated code
    repository.json
  staged/
    codegen-core.patch  ← git-style patch for codegen-core.ts
    parser.patch        ← git-style patch for parser.ts
    tests.patch         ← git-style patch for test files
```

Human reviews patches → applies them → runs `tsc -b && pnpm test`. If all green, the language has evolved.

---

## Phase 5: Validation Loop

After Phase 4 generates patches:

1. Apply patches to a worktree copy of kern-lang
2. Run `tsc -b` — must compile
3. Run `pnpm test` — existing tests must pass
4. Run the new node's golden test — must match expected output
5. Parse the example `.kern` source — must round-trip
6. Transpile to Express + FastAPI — must produce valid code

If any step fails, feed the error back to the designer (Phase 3) for revision.

---

## Implementation Plan

### v3.0 — Coverage Diff (the useful minimum)

- Add structural pattern detectors for the 10 categories
- Build the KERN node inventory comparator
- Output a coverage report: "KERN covers X% of this codebase. Gaps: [model, repository, ...]"
- **This alone is valuable** — it tells you what KERN needs before you write a line of new codegen

### v3.1 — Node Designer

- Generate `NodeProposal` with syntax examples
- Validate proposals parse correctly
- Output to `docs/plans/` for human review

### v3.2 — Codegen Writer

- Generate `generateX()` functions
- Generate patches
- Validation loop with worktree testing

### v3.3 — LLM-Assisted Design

- Use `--llm` flag to have an LLM propose multiple syntax options
- Score by token reduction and expressiveness
- Human selects winner

---

## Relationship to Existing Evolve

Evolve v2 (template mining) remains as-is. v3 is a **new pipeline** that runs alongside it:

```
evolve scan <dir>
  ├── v2: template gaps → .kern templates (library patterns)
  └── v3: coverage gaps → node proposals (language evolution)
```

Same CLI, same staging mechanism, different output type.

---

## Open Questions for Forge

1. **Should v3 be LLM-required or work without?** Pattern detection is deterministic, but node design benefits from LLM reasoning. Could the deterministic path propose a "skeleton" and the LLM path refine it?

2. **How to handle Python-only patterns?** fitVT uses SQLAlchemy (Python), but KERN targets both TS and Python. Should Evolve v3 detect Python patterns and propose bilingual nodes?

3. **Where does the codegen knowledge come from?** Evolve v3 needs to know how to write `generateModel()`. Is that from examples (few-shot from existing `generateInterface()`), from the LLM, or from hardcoded templates?

4. **Scope limit?** Should Evolve v3 only propose nodes that make sense as first-class IR, or also propose templates for one-off patterns? The line between "this should be a node" and "this should be a template" is fuzzy.

5. **Feedback loop with Review?** Once a new node exists, `kern review` should be able to flag code that could use it. Does Evolve v3 also generate review rules?
