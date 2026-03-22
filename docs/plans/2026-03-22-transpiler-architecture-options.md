# Kern Transpiler Architecture — Options Analysis

**Date:** 2026-03-22
**Author:** Claude + Raphael + Codex + Gemini
**Status:** Draft — all options on the table, no final decision
**Purpose:** Reference document for architectural decisions. Bigger hand, more cards.

---

## The Options Menu

Seven architecture options for how Kern produces output from .kern source files. Each has different strengths. They can be PHASED — start with one, evolve to another.

---

### Option A: Hand-Written Transpilers (Current)

**Status:** PROVEN. 11 targets shipped.

Each target is an independent TypeScript module that walks the IRNode tree and emits framework-specific code.

```
IRNode AST → transpilerReact(ast) → .tsx
           → transpilerVue(ast)   → .vue
           → transpilerExpress(ast) → .ts
```

| Metric | Value |
|--------|-------|
| Per-target cost | 600-1200 LOC of code |
| New web framework | 2-3 weeks |
| New language (Go, Rust) | 3-4 weeks (full rewrite) |
| Shared code | ~25% (core helpers) |
| Duplicated code | ~60-70% across targets |
| Maintenance | Fix bug in 12 places |
| Idiomatic output | BEST (hand-tuned per target) |
| Cross-language | Each language = full transpiler |
| AI-generatable | NO (too much logic) |

**Best when:** <15 targets, maximum idiomatic control, rapid iteration on individual targets.
**Worst when:** 20+ targets, cross-language needed, maintenance burden grows.

---

### Option B: LIR + Hooks (Lineage-Based)

**Status:** DESIGNED (LIR spec rev2)

Shared lowering engine produces a semantic IR (UiComponent/ServerModule). Per-lineage hooks format the output. Variants override hooks.

```
IRNode AST → lowerUi() → UiComponent → reactHooks.print() → .tsx
                                      → vueHooks.print()   → .vue
                                      → svelteHooks.print() → .svelte
```

| Metric | Value |
|--------|-------|
| Per-lineage cost | 800-1200 LOC (hooks) |
| Per-variant cost | 200-500 LOC (overrides) |
| Shared engine | ~1700 LOC |
| Savings vs A | ~18% LOC |
| Maintenance | Fix shared bugs once. Hooks bugs per-lineage. |
| Idiomatic output | GOOD (hooks produce idiomatic code) |
| Cross-language | Language concerns mixed into hooks |
| AI-generatable | PARTIAL (hooks are code, harder for LLMs) |

**Best when:** Clear lineage families, moderate target count (12-20), need shared lowering.
**Worst when:** Targets that don't fit any lineage, cross-language targets.

---

### Option C: Strategy-Driven Unified Engine

**Status:** DESIGNED (LIR spec rev3)

ONE print engine with built-in strategy paths. Per-target manifests are DATA (~100 LOC), not code. 9 strategy categories with ~34 options.

```
IRNode AST → lowerUi() → UiComponent → emitEngine(comp, manifest) → output
```

The engine switches on strategy kind: `wrap_block` vs `decorate_child` vs `expr_wrapper` for conditionals. Manifest selects which strategy.

| Metric | Value |
|--------|-------|
| Per-target cost | ~100 LOC manifest (DATA) |
| Shared engine | ~2400 LOC (lowering + emit) |
| Savings vs A | ~55% LOC |
| Maintenance | Fix engine once. Manifests rarely need changes. |
| Idiomatic output | GOOD (strategies produce idiomatic patterns) |
| Cross-language | LIMITED (template patterns are language-specific) |
| AI-generatable | YES (manifests are data, ~100 LOC) |

**Strategy catalog:**

| Category | Options |
|----------|---------|
| Conditional | `wrap_block` ({#if}), `decorate_child` (v-if), `expr_wrapper` ({&&}), `native_if` (SwiftUI) |
| Loop | `wrap_block` ({#each}), `decorate_child` (v-for), `expr_map` (.map()), `native_for` |
| File | `sfc` (Svelte/Vue), `single_function` (React), `module` (Express), `declarative_ui` (SwiftUI) |
| Styles | `scoped_css`, `utility_classes`, `inline_object`, `rn_stylesheet`, `ansi` |
| Binding | `native` (bind:value), `controlled` (value+onChange), `v_model`, `banana` (Angular) |
| Events | Template patterns with casing rules |
| State | Template patterns with import rules |
| ConditionalClass | `class_directive`, `bound_object`, `ternary_expr` |
| DynamicProp | `curly`, `colon` |

**Best when:** Web frameworks that differ mostly in syntax. Maximum code sharing. AI-generated targets.
**Worst when:** Cross-language targets with fundamentally different paradigms.

---

### Option D: Capability-Driven Cross-Language Engine

**Status:** EXPLORED (this session)

Extends Option C with language plugins and a capability lattice. Handles targets in any programming language.

```
IRNode AST → lowerUi() → UiComponent → emitEngine(comp, manifest) → abstract tokens
                                                                    → languagePlugin → output
```

Three layers of per-target configuration:
1. **Capability profile** (~30 LOC) — declares what the target can do
2. **Framework manifest** (~100 LOC) — strategy selections + patterns
3. **Language plugin** (~200-300 LOC) — syntax of the output language

| Metric | Value |
|--------|-------|
| Per-target cost | ~130 LOC manifest + ~30 LOC capability |
| Per-language cost | ~200-300 LOC plugin (shared across frameworks in that language) |
| Shared engine | ~2400 LOC |
| Savings vs A | ~50-55% LOC |
| Cross-language | GOOD (first-class support) |
| AI-generatable | YES (manifests are data, plugins are small) |

**Capability profile includes:**
- Concurrency model (event-loop / goroutines / threads / tokio)
- Error handling (exceptions / result-type / error-return)
- Memory model (GC / ARC / ownership)
- Threading (single-threaded / multi-threaded)
- UI model (DOM / native widgets / none)

**Language plugins estimated:**
- TypeScript: ~150 LOC (default, most patterns)
- Python: ~200 LOC (indentation, type hints, different imports)
- Go: ~250 LOC (multiple returns, goroutines, error handling idiom)
- Rust: ~300 LOC (ownership, Result<T,E>, traits, async)
- Swift: ~200 LOC (optionals, protocols, @State)
- Kotlin: ~200 LOC (@Composable, remember, coroutines)
- Java: ~250 LOC (classes, checked exceptions, annotations)

**Best when:** Truly diverse targets (JS + Python + Go + Rust + Swift + Kotlin).
**Worst when:** Potentially over-engineered if only targeting web frameworks.

**Caveat (from Codex):** "May hold for CRUD-style cases but break on richer async, error, lifecycle, or UI-state patterns." Language plugins may need to be larger (~300-500 LOC) for complex languages like Rust or Go.

---

### Option E: LLVM-Style Multi-Level IR

**Status:** THEORETICAL

Multiple IR levels with progressive lowering, like MLIR. Each level removes abstractions.

```
IRNode AST → High IR (semantic) → Mid IR (components) → Low IR (output constructs) → output
```

| Metric | Value |
|--------|-------|
| Engine complexity | HIGH (~5000+ LOC) |
| Target addition | ~300-500 LOC per target |
| Optimization potential | BEST (can optimize at each IR level) |
| Implementation effort | 12+ weeks |
| Cross-language | BEST (each IR level handles different concerns) |

**Best when:** Heavy optimization needed, very diverse targets, long-term platform.
**Worst when:** Simple transpilation, time-to-market matters.

---

### Option F: Template-Based Generation

**Status:** PARTIAL (Kern's evolve template system exists)

Targets are template files with placeholders. The engine fills in values. Like Cookiecutter/Plop.

```
IRNode AST → analyze() → template data → fill template → output
```

| Metric | Value |
|--------|-------|
| Per-target cost | ~50 LOC template |
| Engine | ~300 LOC (template filler) |
| Quality | BASIC (fixed structure, limited control flow) |
| Cross-language | OK (templates can be in any language) |

**Best when:** Rapid prototyping of new targets, simple output structure.
**Worst when:** Complex conditional logic, deeply nested output.

---

### Option G: Hybrid

**Status:** EMERGENT (natural evolution)

Use different options for different target families:
- Web frameworks (TypeScript): Option C (strategy engine)
- Backend (cross-language): Option D (capability-driven)
- Mobile/native: Option D (SwiftUI, Compose)
- Terminal: Option A (simple, few targets)
- Experimental: Option F (templates for rapid prototyping)

| Metric | Value |
|--------|-------|
| Flexibility | MAXIMUM |
| Complexity | Multiple patterns to maintain |
| Pragmatism | Matches reality (different domains need different approaches) |

**Best when:** Project grows beyond one domain, different targets have different needs.
**Worst when:** Adds cognitive overhead for contributors.

---

### Option H: Enriched AST (Svelte-Inspired)

**Status:** DISCOVERED (from Svelte compiler analysis)

No separate LIR. The analyze phase ENRICHES existing IRNode with metadata. The print engine reads metadata directly. Svelte uses this exact pattern at 27K LOC scale.

```
IRNode AST → analyze() enriches nodes with metadata → emitEngine reads metadata → output
```

The AST is never converted to a different type. It's progressively enriched:
- Phase 1 (parse): `IRNode { type, props, children }`
- Phase 2 (analyze): Same node + `metadata: { resolvedStyles, className, eventBindings, ... }`
- Phase 3 (emit): Reads `node.metadata` to produce output

| Metric | Value |
|--------|-------|
| Per-target cost | ~100 LOC manifest (same as C) |
| Engine | ~2000 LOC (analyze + emit, no type conversion) |
| Type safety | WEAKER (optional metadata vs discriminated unions) |
| Performance | FASTER (no IRNode → UiComponent allocation) |
| Complexity | SIMPLER (one type system, not two) |
| Debuggability | BETTER (one tree to inspect) |
| Svelte precedent | YES (Svelte's exact architecture) |
| Cross-language | Same as C/D (strategy engine still works) |

**Comparison to Option C/D:**
- C/D creates UiComponent (new type) from IRNode (existing type). Two type systems.
- H keeps IRNode throughout, adds metadata. One type system.
- C/D is more TypeScript-idiomatic (discriminated unions catch errors at compile time).
- H is simpler and matches Svelte's proven approach.
- Can START with H, MIGRATE to C/D if type safety becomes a problem.

**Best when:** Want simplicity, fast implementation, Svelte-proven pattern.
**Worst when:** Need strong compile-time guarantees, many contributors need type safety.

---

## Comparison Matrix

| Criterion | A | B | C | D | E | F | G | H |
|-----------|---|---|---|---|---|---|---|---|
| New web target (LOC) | 800 | 300 | 100 | 130 | 500 | 50 | varies | 100 |
| New language (LOC) | 1200 | 1200 | 800 | 300 | 300 | 200 | 300 | 300 |
| Maintenance per target | HIGH | MED | LOW | LOW | LOW | LOW | LOW | LOW |
| Idiomatic output | BEST | GOOD | GOOD | GOOD | VARIES | BASIC | GOOD | GOOD |
| Engine complexity | 0 | 1700 | 2400 | 2700 | 5000+ | 300 | varies | 2000 |
| Implementation effort | 0 | 4-6w | 4-6w | 6-8w | 12+w | 2w | 6-8w | 3-5w |
| Cross-language | POOR | POOR | LIMITED | GOOD | BEST | OK | GOOD | GOOD* |
| AI-generatable targets | NO | NO | YES | YES | NO | YES | YES | YES |
| Proven in production | YES | no | no | no | no | partial | no | SVELTE |
| Type safety | n/a | GOOD | GOOD | GOOD | GOOD | LOW | varies | MODERATE |
| Simplicity | HIGH | MED | MED | MED-LOW | LOW | HIGH | LOW | HIGH |

*H can combine with D for cross-language (enriched AST + language plugins)

---

## Cross-Language Analysis

### The 8 Categories of Difference

| Category | What Varies | LIR Approach | Handling Layer |
|----------|------------|--------------|----------------|
| **Type systems** | generics, nullability, unions | Semantic types in LIR → per-language type map | Language plugin (lookup table) |
| **Memory** | GC vs ARC vs ownership | Kern generates values, not pointers. Rust borrow checker validates at Rust compile time | Mostly irrelevant. Rust plugin adds annotations |
| **Concurrency** | async/await vs goroutines vs threads | LIR: "async operation". Target maps to native model | Language plugin + capability profile |
| **Error handling** | exceptions vs Result<T,E> vs error returns | LIR: Try/Recover intent. Target maps to idiom | Language plugin |
| **Modules** | import/require/use/package | ImportCollector → language-specific format | Language plugin |
| **Syntax** | C-like vs indentation vs others | Template patterns for C-like. Python plugin for indentation | Language plugin |
| **Paradigm** | OOP vs FP vs procedural | Components → functions (Go), classes (Java), structs (Swift) | Language plugin |
| **Threading** | single-threaded vs multi-threaded | Capability profile declares model. Plugin adds synchronization | Capability profile + language plugin |

### The Handler Block Escape Hatch

Kern's `handler <<<...>>>` blocks contain **target-native code**. This is the primary cross-language mechanism:
- Users write Go inside handler blocks for Go targets
- Users write Python for FastAPI targets
- Users write TypeScript for Express targets

Kern generates SCAFFOLDING (imports, routing, types, component setup). Users write BUSINESS LOGIC (handler blocks). The language plugin handles scaffolding syntax. Handler blocks pass through verbatim.

This is analogous to: Nim's `{.emit.}`, Kotlin's `expect/actual`, FFI in any language.

---

## Compiler Architecture Lessons

### Svelte (compiler: .svelte → .js)
- Declarative source → imperative DOM manipulation
- Two output modes (client SSR, server SSR) from ONE source
- Bitmask-based reactivity tracking
- **Lesson:** One source → multiple outputs is the core pattern. Kern does this across frameworks.

### JVM (bytecode: Java/Kotlin/Scala → bytecode)
- Many languages compile to ONE intermediate form
- Each language "compiles away" unique features (coroutines → state machines, pattern matching → if-else)
- **Lesson:** Keep LIR HIGH-LEVEL. Don't lower to bytecode-like instructions. High IR = more freedom per target.

### GraalVM/Truffle (polyglot: many languages on one VM)
- Capability-based polyglot protocol (getMember, invoke, getArrayElement)
- Languages don't understand each other — they interact through capabilities
- **Lesson:** Capability profiles for targets. Each target declares what it can do.

### LLVM (compilation: many languages → many architectures)
- TableGen (declarative) + C++ (programmatic) for backends
- ~70-80% shared optimization passes
- **Lesson:** Hybrid declarative+programmatic. Shared engine + per-target data.

### Haxe (transpilation: Haxe → JS/C++/C#/Python)
- Typed AST as IR, per-target generators 3-8K LOC
- **Lesson:** Keep IR at typed-AST level, not lower. Closest analogy to Kern.

### Fable (transpilation: F# → JS/Python/Rust/Dart)
- Reuses F# compiler frontend, thin per-target printers
- **Lesson:** Target implementors should only handle code emission.

### Flutter (UI: Dart → iOS/Android/Web)
- ONE rendering engine (Skia), ignores platform UI
- **Lesson:** Unified engine + per-platform thin layer. Kern's strategy engine is the analogue.

---

## The Capability Lattice

```typescript
interface TargetCapabilityProfile {
  language: string;
  concurrency: {
    model: 'event-loop' | 'goroutines' | 'threads' | 'tokio' | 'gcd' | 'virtual-threads';
    asyncAwait: boolean;
    parallelism: boolean;
    channels: boolean;
  };
  memory: {
    model: 'gc' | 'arc' | 'ownership';
  };
  errors: {
    model: 'exceptions' | 'result-type' | 'error-return';
  };
  ui?: {
    model: 'virtual-dom' | 'compiled-dom' | 'native-widgets' | 'web-view';
  };
  threading: {
    model: 'single-threaded' | 'multi-threaded';
    needsSynchronization: boolean;
  };
}
```

**Capability-driven lowering:** When the LIR encounters a construct, it checks the target's capabilities and adapts. If a .kern file uses a feature the target doesn't support → COMPILER ERROR with suggestion.

---

## Related Documents

- `2026-03-22-svelte-compiler-analysis.md` — Deep analysis of Svelte 5 compiler architecture (source: cloned repo, 243 files). 10 lessons for Kern.
- `2026-03-22-svelte-sveltekit-target.md` — Svelte transpiler spec (Phase 0)
- `2026-03-22-lir-agnostic-architecture.md` — LIR spec rev3 (Options C/D)

---

## Recommended Phasing (not final decision)

| Phase | Timeline | Option | What |
|-------|----------|--------|------|
| 0 | Now | A | Ship Svelte hand-written (LIR-shaped internally) |
| 1 | +3-5w | H or C | Build enriched-AST analyze phase OR strategy engine |
| 2 | +2-4w | +D | Add Python language plugin (FastAPI) |
| 3 | +2-4w | D | Add Go language plugin (Gin target) |
| 4 | Evaluate | D or G | Assess whether hybrid or unified is better |

Each phase builds on the previous. No phase is wasted — even Option A code informs the strategy engine design. The Svelte transpiler (Phase 0) becomes the first manifest when the engine is built (Phase 1).

---

## Open Questions

1. **Is ~200 LOC per language plugin realistic for Rust/Go?** Codex and Gemini both flag this might be low for complex languages. May need 300-500 LOC.
2. **Does the strategy engine work for Angular?** Angular's decorator-based architecture is unique. May need a new file strategy (`decorator_class`).
3. **Should Kern ever generate concurrency code?** Or should async/threading always be in handler blocks? If Kern generates goroutines/channels, the language plugin gets much more complex.
4. **Can the evolve system propose language plugins?** If evolve detects a Go project, can it auto-generate a Go language plugin from framework documentation?
5. **Where does the handler block language validation happen?** If a user writes Python in a handler block but targets Express, when/how is this caught?
