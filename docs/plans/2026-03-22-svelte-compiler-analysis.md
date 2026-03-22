# Svelte 5 Compiler Architecture — Analysis for Kern

**Date:** 2026-03-22
**Source:** github.com/sveltejs/svelte (cloned, 243 compiler files analyzed)
**Purpose:** Extract architectural lessons for Kern's multi-target compiler design

---

## 1. Compiler Pipeline

Svelte 5 uses a strict **3-phase pipeline** with ~27K LOC:

```
.svelte source
    │
    ▼
PHASE 1: PARSE (6,546 LOC — 24%)
    │  Custom parser for template, acorn/oxc for script, CSS parser
    │  Produces: AST.Root { fragment, instance, module, options, metadata }
    ▼
PHASE 2: ANALYZE (8,525 LOC — 32%)
    │  Scope resolution, reactivity tracking, binding analysis, CSS analysis
    │  ENRICHES the AST with metadata (each node gains type/reactivity info)
    │  Produces: ComponentAnalysis (same AST, richer metadata)
    ▼
PHASE 3: TRANSFORM (11,715 LOC — 44%)
    ├── CLIENT (7,480 LOC, 55 visitors) → DOM creation, reactivity, effects
    ├── SERVER (3,529 LOC, 36 visitors) → String concatenation, no reactivity
    ├── CSS (479 LOC) → Scoped class hashing, dead CSS pruning
    └── Shared (227 LOC) → Common transform utilities
    │
    ▼
JavaScript (ESTree AST → printed to string)
```

**Runtime:** ~5,400 LOC (client 3,211 + server 2,177). The compiler generates CALLS to runtime functions. Runtime handles actual DOM manipulation / string rendering.

---

## 2. Key Architectural Decisions

### 2.1 No Intermediate Representation

**Svelte has NO separate IR.** The parser produces an AST. The analyzer ENRICHES that same AST with metadata. The transform reads the enriched AST.

The "IR" is `AST + metadata`. No type conversion between phases. No separate data structure.

```
Phase 1 output:  AST.Root (bare nodes)
Phase 2 output:  AST.Root (same nodes + .metadata on each)
Phase 3 input:   AST.Root (reads .metadata to generate code)
```

This works because:
- Only 2 targets (client, server) — both read the same enriched AST
- Both targets produce the same language (JavaScript)
- Analysis is target-independent

### 2.2 Analysis is the Heaviest Phase

| Phase | LOC | % |
|-------|-----|---|
| Parse | 6,546 | 24% |
| **Analyze** | **8,525** | **32%** |
| Transform (all) | 11,715 | 44% |

Analysis does the HARD WORK: scope resolution, variable binding, reactivity dependency graph, CSS-to-element mapping, type metadata.

Rich analysis → thin codegen. Each transform visitor is simple because analysis already answered the hard questions.

### 2.3 Client/Server Split at Last Possible Moment

Parse and analyze are **100% shared**. The split happens only in Phase 3:

| Concern | Client (DOM) | Server (SSR) |
|---------|-------------|--------------|
| Rendering | Create elements, set up effects | Concatenate strings |
| Reactivity | Full: $.source(), $.derived(), $.effect() | None: static values |
| Bindings | Two-way: $.bind_value(), $.bind_checked() | Write-only: $.bind_props() |
| State | init + update + after_update sections | init + template only |
| Visitors | 55 files (7,480 LOC) | 36 files (3,529 LOC) |

Server codegen is **47% the size** of client codegen — string output is inherently simpler than reactive DOM.

### 2.4 Visitor Pattern via Zimmerframe

All transforms use the Zimmerframe library:

```javascript
walk(ast, state, visitors)
```

- Each node type has a dedicated visitor function
- Visitors receive `(node, context)` where `context = { state, visit, path }`
- `context.visit(child)` recurses into children
- **State is IMMUTABLE**: always `{ ...state, scope: new_scope }`, never mutate

### 2.5 Three Independent Walks per Transform

Phase 3 walks the AST THREE times:
1. `walk(analysis.module.ast, state, visitors)` — module-level code
2. `walk(analysis.instance.ast, state, visitors)` — script block
3. `walk(analysis.template.ast, state, visitors)` — template markup

Each walk uses different visitor configurations for different concerns.

### 2.6 Compiler Generates Calls, Runtime Does Work

The compiler outputs function calls:
```javascript
$.if(anchor, () => { ... });           // Runtime handles if-block
$.each(anchor, items, (item) => {...}); // Runtime handles list
$.set(signal, value);                   // Runtime handles reactivity
```

The compiler is a **code generator**. The runtime is the **execution engine**. The compiler never directly manipulates the DOM.

### 2.7 CSS is First-Class

CSS is parsed, analyzed, and transformed alongside JavaScript:
- Dead CSS detection (unused selectors pruned)
- Scoped class hashing (`.foo` → `.foo.svelte-abc123`)
- CSS-to-element binding tracking
- First-class AST alongside JS/template AST

---

## 3. Lessons for Kern

### Lesson 1: Invest in Analysis

Svelte's analysis is 32% of compiler LOC. Kern currently has ~0% dedicated analysis — each transpiler re-discovers state, themes, and capabilities.

**Action:** Build a rich analyze() phase (~30-40% of shared engine LOC) that resolves themes, collects state, tracks capabilities, and enriches IRNode with metadata.

### Lesson 2: Enriched AST is a Valid Alternative to Separate LIR

Svelte proves that you don't NEED a separate intermediate representation. Enriching the existing AST with metadata works at 27K LOC scale.

**Action:** Document as Option H in the architecture options. Could start with enriched AST, migrate to separate LIR later if type safety demands it.

### Lesson 3: Split at the Last Moment

Share as much analysis as possible. Only diverge when producing output. Svelte shares analysis across client AND server codegen.

**Action:** Kern's analyze phase should be 100% target-independent. Only the emit phase is target-specific. Already planned in LIR spec.

### Lesson 4: Immutable Visitor State

Svelte enforces `{ ...state, field: newValue }` — never mutate. Prevents state leakage between sibling nodes.

**Action:** Adopt immutable context pattern in Kern's print engine. `{ ...ctx, indent: ctx.indent + 1 }` instead of `ctx.indent++`.

### Lesson 5: Multiple Walks for Different Concerns

Svelte walks module, instance, and template separately. Different visitors for different concerns.

**Action:** Kern could separate: state/handler collection walk → UI template walk → style collection walk. Cleaner than one monolithic walk.

### Lesson 6: No Kern Runtime

Svelte generates calls to its own runtime. Kern generates calls to THIRD-PARTY runtimes (React, Vue, Express). Kern should NEVER introduce its own runtime library.

**Action:** Validate: every target's output must be standalone framework code with zero Kern dependencies.

### Lesson 7: Compile-Time Optimization

Svelte's Memoizer extracts expensive expressions at compile time. Kern could:
- Deduplicate identical handler code
- Merge duplicate style classes
- Detect unused state declarations
- Constant-fold condition expressions

**Action:** Add optimization pass between analysis and codegen (future, not v1).

### Lesson 8: Named Output Sections

Svelte separates output into lifecycle phases: init, update, after_update, template. Kern's SFC assembly order (imports → state → derived → handlers → effects → template → styles) follows this pattern.

**Action:** Formalize output sections as named buffers in the print engine. Each section is independent, assembled at the end.

### Lesson 9: Client Codegen > Server Codegen

Svelte's client transform is 2.1x larger than server. Reactive DOM is inherently complex.

**Implication:** Kern's frontend targets (React/Vue/Svelte) will always be larger than backend targets (Express/FastAPI). Budget accordingly.

### Lesson 10: LOC Ratios to Target

| Concern | Svelte Ratio | Kern Target |
|---------|-------------|-------------|
| Parse | 24% | Existing (~2K, not changing) |
| Analyze | 32% | ~600-800 LOC (new, shared) |
| Shared codegen | 3% | ~600 LOC (strategy engine) |
| Per-target codegen | 41% | ~100-300 LOC per target (manifests) |

---

## 4. Svelte Version History — Architectural Evolution

### Svelte 1 (2016)
- Original concept: "disappearing framework" — compile away the framework
- Generated code called runtime helpers directly
- Custom compiler written from scratch in JavaScript

### Svelte 2 (2018)
- Improved compiler output
- Better component API
- Still used the same compilation approach

### Svelte 3 (2019) — Major Rewrite
- "Write less code" philosophy
- Introduced `$:` reactive declarations (compile-time reactivity)
- `let` variables in script are reactive by default
- Compile-time dependency tracking via `$:` label
- This was the "Svelte as compiler, not framework" breakthrough

### Svelte 4 (2023)
- Incremental improvements
- Better TypeScript support
- Improved CSS scoping
- No fundamental architecture changes

### Svelte 5 (2024) — Runes Rewrite
- Replaced `$:` with explicit runes: `$state()`, `$derived()`, `$effect()`
- "Universal reactivity" — runes work in .svelte.ts files too, not just components
- Moved from compile-time reactivity to signal-based reactivity
- Added `$props()` replacing `export let`
- Added `$bindable()` for two-way prop binding
- Compiler rewritten to handle rune transformations
- Three-phase pipeline formalized (1-parse, 2-analyze, 3-transform)

### Key Architectural Shifts

**Svelte 3→5: From implicit to explicit reactivity**
- Svelte 3: `let x = 0` is magically reactive. `$: doubled = x * 2` is a reactive declaration.
- Svelte 5: `let x = $state(0)` is explicitly reactive. `const doubled = $derived(x * 2)` is explicit.
- WHY: Implicit reactivity was confusing (when is a variable reactive?), didn't work outside components, and was hard to optimize.

**Lesson for Kern:** Explicit is better than implicit. Kern's node types (state, derived, effect) are already explicit. This is the right approach.

**Svelte 3→5: From compiler magic to runtime signals**
- Svelte 3: Compiler tracks dependencies at compile time, generates specific update code per variable.
- Svelte 5: Compiler sets up signal sources/deriveds, runtime tracks dependencies at runtime.
- WHY: Runtime signals are more flexible (work outside components), more predictable (no compiler magic), and enable better fine-grained updates.

**Lesson for Kern:** Kern generates code that uses TARGET framework's reactivity (useState, ref, $state). It doesn't need its own reactivity — it delegates to the target. This is simpler and more correct.

---

## 5. Compiler Source Structure

```
compiler/ (243 files, ~27K LOC)
├── index.js              Entry: compile(), compileModule(), parse()
├── state.js              Global compiler state (warnings, source)
├── validate-options.js   Option validation
├── errors.js             Error definitions
├── warnings.js           Warning definitions
├── legacy.js             Svelte 3/4 AST compatibility
├── phases/
│   ├── 1-parse/          Parser (6,546 LOC)
│   │   ├── index.js      Parser class
│   │   ├── read/         Readers: style, script, template expressions
│   │   ├── state/        State machines: element, fragment, tag
│   │   └── utils/        Parser utilities
│   ├── 2-analyze/        Analyzer (8,525 LOC)
│   │   ├── index.js      analyze_component(), analyze_module()
│   │   ├── css/          CSS scope analysis
│   │   ├── utils/        Analysis utilities
│   │   └── visitors/     72 visitor files + shared/a11y/
│   └── 3-transform/      Code generation (11,715 LOC)
│       ├── index.js      transform_component(), transform_module()
│       ├── client/       Client codegen (7,480 LOC, 55 visitors)
│       ├── server/       Server codegen (3,529 LOC, 36 visitors)
│       ├── css/          CSS transform (479 LOC)
│       └── shared/       Shared utilities (227 LOC)
├── preprocess/           Preprocessor (markup/script/style)
├── print/                AST printer (for debugging)
├── types/                Type definitions
└── utils/                Shared utilities
```

---

## 6. Rich Harris's Design Philosophy — Key Quotes and Decisions

### "The biggest design mistake"

Harris called Svelte 3's `$:` reactive declarations both "the defining idea" and "the biggest design mistake." Implicit magic was elegant for demos but created edge cases at scale:
- `$:` only worked at component top level (not in functions, classes, or modules)
- `arr.push(item)` didn't trigger reactivity (needed `arr = arr` hack)
- TypeScript couldn't type-check reactive declarations
- Two reactivity systems (let + stores) proved the first was incomplete

**Lesson for Kern:** Kern is ALREADY explicit (state nodes, handler blocks, route declarations). Never go implicit. Svelte validates this decision retroactively.

### "Stores were a design smell"

Having writable stores alongside reactive `let` was an admission that component-level reactivity wasn't sufficient for shared state. Svelte 5 unified everything under runes. One system that works everywhere.

**Lesson for Kern:** Kern has ONE specification system (the .kern IR). No separate "shared state" mechanism needed. Types, machines, routes — all in the same syntax.

### Compiler as pure function

`compile(source, options) → result`. No side effects, no file I/O, no global state. Makes integration with any build tool trivial.

**Lesson for Kern:** Kern's `transpile(ast, config) → TranspileResult` already follows this pattern. Keep it pure.

### "Stay in JavaScript"

Harris chose NOT to rewrite the compiler in Rust (despite the SWC/oxc trend). Reasoning: compile speed is already fast enough, and JS/TS keeps the contributor pool accessible.

**Lesson for Kern:** Kern's TypeScript compiler is the right choice. Don't chase Rust for speed. Contributor accessibility matters more.

### Two ground-up rewrites

Svelte was rewritten from scratch twice (v2→v3, v4→v5). Both triggered by fundamental problems with the reactivity model.

**Lesson for Kern:** Don't be afraid to rewrite if the abstraction is wrong. But design for evolution (the LIR architecture is designed to evolve without rewrites).

---

## 7. The Runes RFC — 6 Problems That Drove the Rewrite

The Svelte 5 Runes RFC explicitly documented six problems with Svelte 3/4:

| # | Problem | Svelte 3/4 | Svelte 5 Fix | Kern's Approach |
|---|---------|-----------|-------------|-----------------|
| 1 | Top-level only reactivity | `$:` only in component script | Runes work in .svelte.js too | .kern is file-level spec, no scope limitation |
| 2 | Implicit dependencies | Compiler guesses from AST | Runtime signal tracking | Explicit state/handler nodes |
| 3 | No deep reactivity | `arr.push()` silent | Proxy-based deep reactivity | Handler blocks handle mutations |
| 4 | Confusing `$:` semantics | Execution order unclear | Explicit $derived/$effect | Explicit derive/effect semantics |
| 5 | Store boilerplate | Separate system for shared state | Runes unify component + module | One IR for all concerns |
| 6 | TypeScript incompatibility | Compiler transforms invisible to TS | Runes type-check naturally | .kern is pre-TypeScript (generates typed output) |

Every problem Svelte had with implicit magic, Kern avoids by being an explicit specification language.
