# KERN Concept Model — Design + Implementation Plan

**Date:** 2026-03-19
**Status:** Approved for MVP
**Contributors:** Claude (Opus), Gemini, Codex, Nico

---

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

---

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

---

## Data Model (Codex-refined)

### Design Principles (from Codex)
- **Typed payloads per concept kind** — no freeform `metadata: { [key]: any }`
- **Split into ConceptNode + ConceptEdge** — edges need sourceId/targetId
- **Deterministic IDs** — for dedup/snapshots, based on file+offset
- **One rule interface with capability flags** — don't create two rule ecosystems
- **Define semantics per concept first** — before writing any mappers

### Core Types

```typescript
// ── Concept Kinds ────────────────────────────────────────────────

type ConceptNodeKind =
  | 'entrypoint'         // route, handler, main, exported function
  | 'effect'             // side effect: network, db, fs, process
  | 'state_mutation'     // writing shared/module state
  | 'error_raise'        // throw, reject, err-return, panic
  | 'error_handle'       // catch/except/if-err with disposition
  | 'guard'              // auth check, validation, policy gate

type ConceptEdgeKind =
  | 'call'               // function → function
  | 'dependency'         // module → module (import/require)

// ── ConceptNode ──────────────────────────────────────────────────

interface ConceptNode {
  id: string               // deterministic: `${filePath}#${kind}@${offset}`
  kind: ConceptNodeKind
  primarySpan: SourceSpan
  evidenceSpans?: SourceSpan[]
  evidence: string         // the actual code classified
  confidence: number       // 0.0-1.0
  language: string         // 'ts' | 'py' | 'go' | etc.
  containerId?: string     // parent function/class ID
  payload: ConceptPayload  // typed per kind (see below)
}

// ── ConceptEdge ──────────────────────────────────────────────────

interface ConceptEdge {
  id: string
  kind: ConceptEdgeKind
  sourceId: string         // ConceptNode or symbol ID
  targetId: string         // ConceptNode or symbol ID
  primarySpan: SourceSpan
  evidence: string
  confidence: number
  language: string
  payload: CallPayload | DependencyPayload
}

// ── Typed Payloads (per kind) ────────────────────────────────────

interface EntrypointPayload {
  kind: 'entrypoint'
  subtype: 'route' | 'handler' | 'main' | 'export' | 'event-listener'
  name: string
  httpMethod?: string      // GET, POST, etc. for routes
}

interface EffectPayload {
  kind: 'effect'
  subtype: 'network' | 'db' | 'fs' | 'process' | 'time' | 'random'
  target?: string          // URL, table name, file path
  async: boolean
}

interface StateMutationPayload {
  kind: 'state_mutation'
  target: string           // variable/property being mutated
  scope: 'local' | 'module' | 'global' | 'shared'
}

interface ErrorRaisePayload {
  kind: 'error_raise'
  subtype: 'throw' | 'reject' | 'err-return' | 'panic'
  errorType?: string
}

interface ErrorHandlePayload {
  kind: 'error_handle'
  disposition: 'ignored' | 'logged' | 'wrapped' | 'returned' | 'rethrown' | 'retried'
  errorVariable?: string
}

interface GuardPayload {
  kind: 'guard'
  subtype: 'auth' | 'validation' | 'policy' | 'rate-limit'
  name?: string
}

interface CallPayload {
  kind: 'call'
  async: boolean
  name: string
}

interface DependencyPayload {
  kind: 'dependency'
  subtype: 'internal' | 'external' | 'stdlib'
  specifier: string
}

type ConceptPayload =
  | EntrypointPayload | EffectPayload | StateMutationPayload
  | ErrorRaisePayload | ErrorHandlePayload | GuardPayload
  | CallPayload | DependencyPayload

// ── ConceptMap (output of a mapper) ──────────────────────────────

interface ConceptMap {
  filePath: string
  language: string
  nodes: ConceptNode[]
  edges: ConceptEdge[]
  extractorVersion: string
}
```

### Rule Interface (unified, capability-based)

```typescript
// Rules declare what they need — concepts, AST, or both
interface ReviewRuleV2 {
  id: string
  requires: ('concepts' | 'ts_ast' | 'kern_ir')[]
  run: (ctx: ReviewContextV2) => ReviewFinding[]
}

interface ReviewContextV2 {
  // Always available
  filePath: string
  language: string

  // Available if 'concepts' required
  concepts?: ConceptMap

  // Available if 'ts_ast' required (TS only)
  sourceFile?: import('ts-morph').SourceFile

  // Available if 'kern_ir' required
  inferred?: InferResult[]
  templateMatches?: TemplateMatch[]

  // Config
  config?: ReviewConfig
}
```

---

## Concept Specifications

Each concept must be defined before implementation.

### 1. `entrypoint`

**Definition:** A function that is a top-level entry for execution — called by framework, user, or OS.

**Required fields:** subtype, name

| Language | Example | subtype |
|----------|---------|---------|
| TS | `app.get('/users', handler)` | route |
| TS | `export default function Page()` | export |
| Python | `@app.route('/users')` | route |
| Python | `if __name__ == '__main__':` | main |
| Go | `func main()` | main |
| Go | `http.HandleFunc("/users", handler)` | route |

**Non-goals:** not every exported function is an entrypoint. Focus on framework-registered handlers and main functions.

### 2. `effect`

**Definition:** A call that produces a side effect outside the current function scope.

**Required fields:** subtype, async

| Language | Example | subtype |
|----------|---------|---------|
| TS | `fetch(url)`, `axios.get()` | network |
| TS | `db.query()`, `prisma.user.findMany()` | db |
| TS | `fs.readFile()` | fs |
| Python | `requests.get()`, `httpx.get()` | network |
| Python | `cursor.execute()` | db |
| Go | `http.Get()` | network |
| Go | `db.Query()` | db |

**Non-goals:** don't classify pure function calls as effects. Only calls that reach outside the process.

### 3. `state_mutation`

**Definition:** Writing to state that is visible outside the current function invocation.

**Required fields:** target, scope

| Language | Example | scope |
|----------|---------|-------|
| TS | `this.count++` | module |
| TS | `globalState.user = x` | global |
| Python | `self.count += 1` | module |
| Go | `s.mu.Lock(); s.count++` | shared |

**Non-goals:** local variable assignment is not state mutation.

### 4. `error_raise`

**Definition:** Code that produces an error signal.

**Required fields:** subtype

| Language | Example | subtype |
|----------|---------|---------|
| TS | `throw new Error()` | throw |
| TS | `Promise.reject()` | reject |
| Python | `raise ValueError()` | throw |
| Go | `return fmt.Errorf()` | err-return |
| Rust | `panic!()` | panic |

### 5. `error_handle`

**Definition:** Code that receives an error signal and does something (or nothing) with it.

**Required fields:** disposition

| Language | Example | disposition |
|----------|---------|------------|
| TS | `catch (e) {}` | ignored |
| TS | `catch (e) { console.error(e) }` | logged |
| TS | `catch (e) { throw new AppError(e) }` | wrapped |
| Python | `except: pass` | ignored |
| Python | `except Exception as e: logger.error(e)` | logged |
| Go | `if err != nil { }` | ignored |
| Go | `if err != nil { return fmt.Errorf("wrap: %w", err) }` | wrapped |

**Non-goals:** disposition classification uses heuristics. Confidence should reflect uncertainty.

### 6. `guard`

**Definition:** A check that gates access — auth, validation, or policy enforcement.

**Required fields:** subtype

| Language | Example | subtype |
|----------|---------|---------|
| TS | `if (!req.user) return 401` | auth |
| TS | `schema.parse(req.body)` | validation |
| Python | `@login_required` | auth |
| Python | `pydantic.validate()` | validation |
| Go | `if !isAuthed(ctx) { return }` | auth |

**Non-goals:** not every `if` is a guard. Focus on security-relevant checks.

### 7. `call` (edge)

**Definition:** Function A calls function B.

**Required fields:** sourceId, targetId, async, name

### 8. `dependency` (edge)

**Definition:** Module A imports module B.

**Required fields:** sourceId, targetId, subtype, specifier

---

## Rules (v1 — 5 concept rules)

| # | Rule ID | Concept Query | Severity |
|---|---------|--------------|----------|
| 1 | `ignored-error` | `error_handle` with `disposition=ignored` | error |
| 2 | `unguarded-effect` | `effect(network\|db)` without `guard(auth)` ancestor via `call` edges | warning |
| 3 | `unrecovered-effect` | `effect(network\|db)` without ancestor `error_handle(wrapped\|returned\|retried)` | warning |
| 4 | `boundary-mutation` | `state_mutation(shared\|global)` not inside allowed module | error |
| 5 | `illegal-dependency` | `dependency` edge crosses defined architectural boundary | warning |

---

## Implementation Plan

### Step 0: Concept Spec Review (this document) ✅
- Define all 8 concepts with typed payloads
- Define data model (ConceptNode, ConceptEdge, ConceptMap)
- Define rule interface (unified, capability-based)
- Get sign-off from all contributors

### Step 1: Type Definitions
**File:** `packages/core/src/concepts.ts`
- All types from Data Model section above
- Export from `packages/core/src/index.ts`
- **No behavior, just types**

### Step 2: TS Concept Mapper
**File:** `packages/review/src/mappers/ts-concepts.ts`
- Function: `extractConcepts(sourceFile: SourceFile, filePath: string): ConceptMap`
- Uses existing ts-morph SourceFile (same one used by rules)
- Emits ConceptNode[] + ConceptEdge[]
- Start with 3 concepts: `error_raise`, `error_handle`, `effect`

### Step 3: First Concept Rule
**File:** `packages/review/src/concept-rules/ignored-error.ts`
- Uses `ReviewRuleV2` interface with `requires: ['concepts']`
- Query: find `error_handle` nodes with `disposition=ignored`
- Works on any language that emits concepts

### Step 4: Wire into Pipeline
**Modify:** `packages/review/src/index.ts`
- After KERN IR inference, also run concept extraction
- Run concept rules alongside AST rules
- Merge findings, dedup

### Step 5: Bilingual Tests
**File:** `packages/review/tests/concepts/ignored-error.test.ts`
- TS input + expected finding
- (Python input added in Step 7)

### Step 6: Remaining TS Concepts
- Add `entrypoint`, `guard`, `state_mutation`, `call`, `dependency` mappers
- Implement remaining 4 rules
- Test on audiofacets backend

### Step 7: Python Mapper
**New package:** `packages/review-python/`
- tree-sitter + tree-sitter-python
- Function: `extractPythonConcepts(source: string, filePath: string): ConceptMap`
- Same ConceptMap output as TS mapper
- Bilingual tests: same rule, TS + Python, same finding

### Step 8: Integration
- `kern review` auto-detects language from extension
- Python files → Python mapper → concept rules
- TS files → TS mapper + ts-morph → concept rules + AST rules
- Unified output

---

## What Stays in Native AST (existing 50 rules)

All existing TS-specific rules remain. They target `requires: ['ts_ast']`:
- React hooks (6 rules)
- Vue reactivity (4 rules)
- Next.js server/client (3 rules)
- Express security (3 rules)
- All base AST rules (12 rules)
- All security rules (14 rules)
- All dead-logic rules (8 rules)

**Rule of thumb:** universalize review concepts, not compiler internals.

---

## Testing Strategy (3 layers, from Codex)

1. **Extractor fixtures per language** — mapper unit tests: "given this TS/Python code, expect these concepts"
2. **Concept normalization parity tests** — "TS empty-catch and Python except-pass produce same concept shape"
3. **Portable rule tests on normalized concepts** — "given this ConceptMap, expect this finding" (language-agnostic)

---

## Competitive Position

| Tool | What it does | KERN advantage |
|------|-------------|----------------|
| SonarQube | Per-language file analysis, 300+ rules | Cross-language concepts, architectural governance, LLM layer |
| Semgrep | Syntax pattern matching, multi-language | Semantic concepts not syntax, high-level IR, feature-path tracing |
| CodeQL | Semantic database + query language | Fixed opinionated ontology (simpler), LLM layer, no query language needed |
| ESLint | JavaScript/TS linting | Multi-language, architectural, concepts > syntax |

---

## Input Sources

- **Nico:** "Empty-catch is just a concept. You know the difference per language. You can translate." — the breakthrough insight.
- **Gemini (round 1):** "Be an Architectural Governance Engine. Only tool that understands Architecture-as-Code across languages."
- **Gemini (round 2):** Implementation plan — concept schema, TS/Python mappers, bilingual tests, pipeline orchestration.
- **Codex (round 1):** "Universalize review concepts, not compiler internals. Keep vocabulary review-driven."
- **Codex (round 2):** "Fix data model first. Typed payloads, not freeform metadata. Split nodes/edges. One rule interface with capability flags. Define semantics per concept before building mappers."
- **Claude:** Concept model completes existing inferrer pattern. Unified rule interface. LLM layer becomes surgical with structured facts. Import graph + concepts = feature-path governance.
