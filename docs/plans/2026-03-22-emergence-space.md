# Kern Architecture — Emergence Space

**Date:** 2026-03-22
**Author:** Claude + Raphael + Codex + Gemini
**Status:** Living document — captures emergent insights from cross-analyzing 8 architecture options
**Purpose:** Not a replacement for Options A-H. A META-ANALYSIS of what emerges when the options collide.

---

## 1. The 7 Invariants

These hold **regardless of which option is chosen**. They are the FOUNDATION.

| # | Invariant | Why |
|---|-----------|-----|
| 1 | **Parse is shared.** One parser, one IRNode AST, universal. | No option proposes multiple parsers. |
| 2 | **Output is idiomatic.** Generated code looks like a human wrote it for that framework. | Every option aims for idiomatic output. |
| 3 | **Handler blocks pass through.** `<<<code>>>` is user-written target-native code. | No option proposes transforming handler code between languages. |
| 4 | **Styles need shared handling.** Theme resolution, shorthand expansion, layout defaults. | Duplicating style logic per target is the #1 source of inconsistency. |
| 5 | **Golden tests validate output.** Snapshot-based verification of compiled output. | Universal testing pattern across all compiler systems studied. |
| 6 | **No Kern runtime.** Generated code is standalone framework code with zero Kern dependencies. | Validated by Svelte's "disappearing framework" philosophy and React Native's bridge cautionary tale. |
| 7 | **Framework manifests are valuable data.** Even hand-written transpilers have NODE_TO_ELEMENT maps. Some declarative data per target is universal. | Every option has at least SOME data-driven configuration. |

---

## 2. The 5 Design Dimensions

Options A-H are not discrete choices — they're **points in a 5-dimensional design space**. Each dimension is an independent decision.

### Dimension 1: Abstraction Level

```
A ─────────── H ─────────── C ─────────── B ─────────── E
none       enriched AST   strategy    lineage hooks   multi-IR
            (Svelte-style) (data-driven) (code-driven)  (LLVM-style)
```

Where on this spectrum depends on: how many targets you have and how different they are.
- <10 targets, same language: left side (A or H)
- 10-25 targets, same language: middle (C)
- 25+ targets, multiple languages: right side (B+C or D)

### Dimension 2: Data vs Code (per-target)

```
F ─────── C ────────── B ─────── A
~50 LOC   ~100 LOC     ~800 LOC   ~800 LOC
templates  manifests    hooks      transpilers
pure data  mostly data  mostly code pure code
```

More data = more AI-generatable, less flexible.
More code = more flexible, harder to generate.

### Dimension 3: IR Design

```
H ──────────────── C/D ──────────────── E
enriched AST       separate UiLir        multi-level IR
one type system    two type systems      many type systems
simpler            more type-safe        most formal
Svelte-proven      Fable-like            LLVM-like
```

### Dimension 4: Family Structure

```
C ──────────── B ──────────── G
no families    explicit lineages   hybrid (per-domain)
one engine     inheritance        multiple patterns
```

### Dimension 5: Cross-Language Support

```
A ──────── C ──────── D ──────── E
rewrite    templates  language   universal
per lang   (limited)  plugins    IR
```

---

## 3. The 7 Viable Combinations

Not all coordinates work. These 7 have been tested for internal consistency:

| # | Combo | Dimensions | Best For |
|---|-------|-----------|----------|
| 1 | **A** (pure) | Low abstraction, all code, no IR, no families | Current state. <15 targets. |
| 2 | **H+C** | Medium abstraction, mostly data, enriched AST, no families | Simplest meta-architecture. Web-only. |
| 3 | **H+C+D** | Medium abstraction, mostly data, enriched AST + language plugins | Extends Combo 2 for Go/Rust/Java. |
| 4 | **H+C+B** | Medium abstraction, hybrid data+code, enriched AST + hooks | When some targets need custom logic. |
| 5 | **C+D** | Medium abstraction, data-driven, separate UiLir, language plugins | More type-safe cross-language. |
| 6 | **C+D+G** | High abstraction, data + hybrid, separate UiLir per domain | Maximum flexibility, maximum complexity. |
| 7 | **H+F** | Low abstraction, templates + enriched AST | Rapid prototyping. Limited production quality. |

**Sweet spots:** Combos 2, 3, and 4.
- Combo 2 (H+C) for pure web targets
- Combo 3 (H+C+D) when cross-language becomes a priority
- Combo 4 (H+C+B) when specific targets need custom rendering

---

## 4. The Universal Evolution Path

Regardless of where you start, the evolution follows the same path:

```
Phase 0: A ── hand-written transpilers (current, proven)
    │
    │  Extract shared analysis
    ▼
Phase 1: H ── enriched AST (analyze phase adds metadata to IRNode)
    │
    │  Add strategy engine for emit
    ▼
Phase 2: H+C ── analysis + strategy-driven emit
    │
    │  Add hooks for complex cases
    ▼
Phase 3: H+C+B ── data where possible, code where necessary
    │
    │  Add language plugins for cross-language
    ▼
Phase 4: H+C+B+D ── full cross-language support
```

**Each step is ADDITIVE.** Nothing is thrown away. Each step is independently valuable.

**You can STOP at any phase:**
- Phase 0: Ships Svelte (value: new target)
- Phase 1: Shared analysis (value: deduplicated logic, better review integration)
- Phase 2: Strategy engine (value: cheaper new targets, AI-generatable manifests)
- Phase 3: Hooks escape hatch (value: idiomatic complex output)
- Phase 4: Language plugins (value: Go/Rust/Java/Swift targets)

**Option E (LLVM-style multi-level IR) is a FORK**, not a step on this path. It requires a different starting point and is only justified if optimization passes become critical.

**Option F (templates) is a PROTOTYPING TOOL** for any phase. Use templates to quickly validate output shape, then formalize into manifests/hooks.

---

## 5. The 10 Emergent Principles

### Principle 1: Options Are Dimensions, Not Choices

The 8 options aren't "pick one." They're coordinates in a 5-dimensional design space. Real implementations combine dimensions. The question isn't "A or C?" but "what coordinate in each dimension?"

### Principle 2: The Evolution Path Is Universal

A → H → C → B+C → D. Each step is additive, independently valuable. Stop when the value no longer justifies the investment.

### Principle 3: Evolve Is the Architecture Validator

If evolved nodes (from `kern evolve`) can propose multi-target output easily, the architecture is right. If they need per-target manual work, it's wrong. The evolve system DRIVES architecture choice.

### Principle 4: AI-Generatability Is Strategic

Only ~100 LOC manifests (Option C) and templates (Option F) can be reliably LLM-generated. ~800 LOC hooks (Option B) and ~1200 LOC transpilers (Option A) cannot. Since Kern IS an AI-native language, the compiler should be AI-native too.

Cross-language targets need ~100 LOC manifest + ~200-300 LOC language plugin = ~300-400 LOC total. Still within LLM capability for generation and review.

### Principle 5: ~80% Data, ~20% Logic (HYPOTHESIS — validate in Phase 2)

**Hypothesis:** ~80% of what Kern generates can be expressed as template patterns. ~20% needs structural logic (conditionals, style conversion). The strategy engine handles the 20%.

**Validation criteria:** Implement Svelte as a manifest (Phase 2). Measure: what percentage of output is pure pattern interpolation vs strategy logic? If <70% is data, the hypothesis is weakened.

**Codex caveat:** "These are estimates from analysis, not measurements. Treat as hypotheses."

### Principle 6: The 7 Invariants Hold Regardless

Shared parse. Idiomatic output. Handler passthrough. Shared styles. Golden tests. No runtime. Framework manifests. These are CONSTANTS across all architecture options. (See Section 1.)

### Principle 7: Worst Case for C = Best Case for B (HYPOTHESIS — validate)

**Hypothesis:** If the strategy engine fails for 10% of targets, those targets use hooks. The other 90% benefit from data-driven manifests. Worst case of Option C is still better than full Option B.

**Validation criteria:** After implementing 3+ targets as manifests, count how many needed hook overrides. If >30% need hooks, the hypothesis is weakened.

### Principle 8: Testing Is Better With Shared Engine

Bugs in shared code are found once, fixed once. Per-target bugs are isolated to manifests/hooks. The testing pyramid (unit → strategy → golden) is cleaner than 12 independent test suites.

### Principle 9: Families Emerge, Don't Design Them

React/Next share code naturally. Vue/Nuxt share code naturally. Formal "lineage" boundaries are an over-design for Phase 1-2. Let sharing emerge from practice, then formalize if needed in Phase 3.

**Gemini caveat:** "B+C hybrid adds ~100 LOC engine complexity for hook dispatch. The escape hatch isn't free."

### Principle 10: Start Simple, Evolve With Evidence

Phase 0 (A) ships value. Phase 1 (H) proves the analysis concept. Phase 2 (C) proves the strategy engine. Don't build Phase 4 before Phase 1 validates the approach.

---

## 6. The Collision Map

Where options **agree**, **disagree**, and what **emerges** from the tension.

### Agreements

| Topic | Options That Agree | Consensus |
|-------|-------------------|-----------|
| Shared analysis | All except A | Rich analysis → thinner codegen (Svelte lesson) |
| Per-target data | All (even A has NODE_TO_ELEMENT) | Some declarative config is always useful |
| Idiomatic output | All | Never sacrifice output quality for architecture |
| Handler passthrough | All | Business logic is user-written, not compiler-generated |
| No runtime | All | Generated code must be standalone |

### Disagreements

| Topic | Tension | Resolution |
|-------|---------|-----------|
| Abstraction level | A (none) vs E (maximum) | SPECTRUM — pick based on target count |
| Separate IR | C/D (yes, UiLir) vs H (no, enriched AST) | BOTH VALID — H is simpler, C/D is more type-safe |
| Family boundaries | B (explicit) vs C (none) | LET EMERGE — don't formalize prematurely |
| Cross-language | D (plugins) vs A (rewrite) | LAYERED — framework manifest + language plugin |
| Data vs code | C (data) vs B (code) | HYBRID — data by default, code escape hatch |

### Emergent Insights (from collisions)

1. **The Evolve Insight**: Options that make evolve harder are wrong. Evolve is the compass.
2. **The AI Insight**: Options C and F uniquely enable LLM-generated targets. This is a moat.
3. **The Testing Insight**: Shared engine catches bugs once. Per-target code catches bugs N times.
4. **The Simplicity Insight**: Option H (Svelte-style enriched AST) eliminates an entire type system. Less code, fewer conversion bugs.
5. **The Hybrid Insight**: Pure data (C) + code escape hatch (B hooks) covers 100% of cases. Neither alone covers all.

---

## 7. Decision Framework

**"Given your priorities, choose your coordinate in each dimension."**

### If Priority is SHIPPING SPEED:

→ Phase 0 (A). Hand-write Svelte. Ship in 2 weeks.
→ Then Phase 1 (H). Extract analysis. Ship in 4 weeks.

### If Priority is SCALABILITY (many web targets):

→ Phase 2 (H+C). Strategy engine + manifests.
→ Each new web target: ~100 LOC manifest, 1-2 days.

### If Priority is CROSS-LANGUAGE:

→ Phase 4 (H+C+B+D). Strategy engine + hooks + language plugins.
→ Each new language: ~200-300 LOC plugin.

### If Priority is AI-GENERATABILITY:

→ Phase 2 (H+C). Manifests are ~100 LOC data — perfect for LLM generation.
→ `kern evolve-target` becomes feasible.

### If Priority is TYPE SAFETY:

→ Combo 5 (C+D). Separate UiLir type system with discriminated unions.
→ More TypeScript boilerplate but compile-time guarantees.

### If Priority is SIMPLICITY:

→ Combo 2 (H+C). Enriched AST (one type system) + strategy engine (one print function).
→ Minimum architecture for maximum benefit.

---

## 8. Validation Plan

### Phase 0 Measurements (during Svelte hand-written implementation)

- [ ] Track: what percentage of transpiler code is "the same as Vue"? → Confirms ~60-70% duplication estimate
- [ ] Track: how much code is pure template patterns vs logic? → Validates 80/20 hypothesis
- [ ] Track: total LOC of Svelte transpiler vs spec estimate (~1050) → Validates estimation accuracy

### Phase 1 Measurements (during analysis extraction)

- [ ] Track: how much analysis code is extractable from existing transpilers? → Validates shared analysis value
- [ ] Track: does enriched AST (Option H) cover all node types without a separate IR? → Validates H vs C decision
- [ ] Test: can an evolved node's lowering produce correct output for 2+ targets? → Validates Principle 3

### Phase 2 Measurements (during strategy engine build)

- [ ] Track: what percentage of Svelte manifest is template patterns vs strategy selections? → Validates 80/20
- [ ] Track: how many strategy types are needed beyond the initial 34? → Validates strategy catalog completeness
- [ ] Test: can an LLM generate a valid manifest from framework documentation? → Validates Principle 4
- [ ] Compare: manifest-driven output vs hand-written output via golden tests → Validates output quality

### Phase 3 Measurements (if hooks needed)

- [ ] Count: how many targets needed hook overrides that manifests couldn't express? → Validates 90/10 hypothesis
- [ ] Measure: hook LOC per target that needs them → Validates lineage base estimates

---

## 9. What Each Option TEACHES (Even If Not Chosen)

| Option | Lesson | How It Applies |
|--------|--------|---------------|
| **A** (hand-written) | Hand-tuned output is the QUALITY BENCHMARK | Golden tests from A become the standard for all other options |
| **B** (hooks) | Family boundaries exist naturally (React/Next, Vue/Nuxt) | Even without formal lineages, targets share code within families |
| **C** (strategies) | Most differences ARE data, not code | 34 strategy options cover 8+ frameworks. Per-target code is tiny. |
| **D** (language plugins) | Cross-language ≠ cross-framework. Orthogonal concerns. | Language (Go syntax) is separate from framework (Gin APIs). Don't conflate. |
| **E** (multi-level IR) | Multiple IR levels enable optimization passes | Even just having analyze() as a "level" adds optimization opportunity |
| **F** (templates) | Fastest way to prototype a target. Start here. | Before writing a manifest, validate output shape with a template |
| **G** (hybrid) | One size doesn't fit all | Web, backend, terminal, mobile genuinely differ. Pragmatism > purity |
| **H** (enriched AST) | Simplest architecture wins (Svelte proves this at 27K LOC) | Don't add IR layers unless the current AST can't carry the information |

---

## 10. Related Documents

- `2026-03-22-svelte-sveltekit-target.md` — Phase 0 deliverable
- `2026-03-22-lir-agnostic-architecture.md` — Options C/D detailed design (rev3)
- `2026-03-22-transpiler-architecture-options.md` — All 8 options (A-H)
- `2026-03-22-svelte-compiler-analysis.md` — Svelte compiler lessons (Option H origin)

This document does NOT replace any of the above. It is a META-ANALYSIS that captures what emerges when the options interact.

---

## 11. Open Constraint Questions (from Codex)

The dimension analysis and evolution path assume Kern's scope is stable. If these constraints change, dimensions may shift:

1. **Target users**: Is Kern for AI coding tools (B2B platform) or individual developers (B2C tool)? Platform play favors more targets. Individual tool favors fewer, higher-quality targets.
2. **Cross-language requirement**: Is Go/Rust/Java a real near-term need or a theoretical future? If near-term, accelerate to Phase 4 (D). If theoretical, Phase 2 (C) is sufficient.
3. **Performance envelope**: Does compilation speed matter? Current transpilers are fast (<100ms). Strategy engine adds one indirection but should stay <200ms. Only Option E could introduce real slowdowns.
4. **Evolve scope**: Should evolve propose targets (ambitious) or just node types (conservative)? If targets, Option C is mandatory (manifests are LLM-generatable). If nodes only, any option works.

These questions don't invalidate the analysis — they shift WHERE on the evolution path to stop.

---

## 12. The True Pattern — UDR (Understand-Decide-Render)

Every multi-target compiler converges to the same shape. We call it **UDR**.

### The Three Layers

```
LAYER U — UNDERSTAND (shared, run once, ~1,100 LOC)
    Parse + analyze: extract semantic meaning from the AST
    18 concerns: themes, styles, classes, state, handlers, capabilities,
    conditionals, loops, tabs, text, self-closing, imports, source maps...
    Output: AnalyzedComponent (target-independent semantic understanding)

LAYER D — DECIDE (per-target, ~100 LOC manifest, mostly data)
    9 decision categories: state syntax, event syntax, binding mode,
    conditional mode, loop mode, file mode, style mode, import format,
    handler rewriting
    Output: TargetDecisions (pattern strings + mode selections)

LAYER R — RENDER (shared, ~900 LOC engine, driven by D)
    Walk the analyzed tree, switch on modes, interpolate patterns
    One function handles ALL targets via strategy switches
    Output: TranspileResult (code + source map + metrics)
```

### How All Options Map to UDR

| Option | U | D | R |
|--------|---|---|---|
| A (hand-written) | U+D+R FUSED into one transpiler per target |
| B (hooks) | Shared U | D+R fused into hooks per lineage |
| C (strategies) | Shared U | Data manifest | Shared engine = **Pure UDR** |
| D (cross-lang) | Shared U | Framework + language manifests | Engine + language plugins |
| E (multi-level) | Multiple U layers | Per-level D | Per-level R |
| F (templates) | Minimal U | Template files | Template interpolation |
| G (hybrid) | Shared U | Different D per domain | Different R per domain |
| H (enriched AST) | U enriches AST (not converts) | Same as C | Same as C |

**Options A-H are different IMPLEMENTATIONS of UDR** with varying degrees of separation between layers.

### Validation Against Real Compilers

| System | U (Understand) | D (Decide) | R (Render) |
|--------|---------------|------------|------------|
| LLVM | Frontend + optimization passes | TableGen target descriptions | Code emitter per target |
| Svelte | Analyze phase (8,525 LOC) | `generate: 'client'\|'server'` | Transform visitors |
| Haxe | Type checker | Target selection | Per-target generator |
| Fable | F# compiler typing | Target selection | Printer per target |
| Nim | Semantic analysis | C/JS backend selection | Code generator |
| JVM | javac/kotlinc frontend | Target JVM bytecode spec | Bytecode emitter |

**The pattern is universal.** Every system that compiles one source to multiple targets separates understanding from rendering, with decisions in between.

### LOC Budget (HYPOTHESIS — validate in implementation)

| Layer | LOC | What |
|-------|-----|------|
| U (analyzeUi) | ~800 | Theme/style/state/handler/capability analysis |
| U (analyzeServer) | ~300 | Route/middleware/validation analysis |
| D (12 manifests) | ~1,120 | ~100 LOC data per target |
| R (renderUi) | ~500 | Body walk, strategy switches, file assembly |
| R (renderServer) | ~300 | Route rendering, entry point |
| R (shared utils) | ~100 | interpolate(), countTokens(), sourceMap |
| Plugins | ~400 | TailwindClassifier, Python language |
| **TOTAL** | **~3,520** | vs current ~10,000 = **~65% reduction** |

**Codex caveat (87% confidence):** "D stops being pure data once targets need semantic rewrites. The LOC estimate is vulnerable to hidden complexity in testing, diagnostics, and edge cases." Realistic total may be ~4,000-4,500. Still a ~55-60% reduction.

**Honest note:** D is ~90% data (pattern strings, mode selections) and ~10% small functions (handler rewriting regex, a few transforms). Not 100% pure data. But dramatically simpler than 800 LOC hook functions.

### Hard Cases Validated

| Case | How UDR Handles It |
|------|-------------------|
| **Vue v-if (single child)** | `decorate_child` strategy adds v-if to child element attrs |
| **Vue v-if (multi child)** | `decorate_child` wraps in `<template v-if>` |
| **Svelte {#if}** | `wrap_block` strategy emits {#if}...{/if} |
| **React JSX ternary** | `expr_wrapper` strategy emits `{test && (<>...</>)}` |
| **Tabs** | U layer decomposes to state + buttons + conditionals. R handles normally. |
| **SvelteKit routing** | D manifest has routing patterns. R generates artifacts. |
| **Express/FastAPI** | Separate analyzeServer() + renderServer(). Same UDR pattern. |

### What UDR Means for Kern's Future

**Evolve integration:** Evolved nodes define analysis rules (U) + optional manifest entries (D). R renders automatically.

**AI-generated targets:** LLMs generate D manifests (~100 LOC data). U and R are shared. `kern evolve-target` becomes feasible.

**Cross-language:** D gains language section. R gains language printer plugin. U unchanged.

**Testing:** U unit-tested (18 functions). D schema-validated. R unit-tested (11 functions). Integration via golden tests per target.

### The First Step

Regardless of final architecture, the FIRST implementation step is the same:

**Build the U layer.** Extract the 18 shared analysis concerns from existing transpilers. This is valuable even if we never build the D+R layers — shared analysis improves code quality, reduces duplication, and enables better `kern review` integration.

The U layer is the foundation. Everything else builds on it.

---

## 13. The Specification Compiler Realization

### Kern is a Specification Compiler

Kern is NOT a program compiler (LLVM, Svelte, TypeScript) and NOT a transpiler (Babel, Sass). It is a **specification compiler** — it expands structural specifications into framework implementations.

Closest analogs: Protobuf codegen, OpenAPI generator, Prisma, GraphQL codegen. NOT: LLVM, Svelte, TypeScript compiler.

This realization collapses the option space:
- **Option E (LLVM-style multi-level IR) is definitively off the table** — no execution semantics to lower
- **UDR is confirmed as right-sized** — spec compilation needs declaration collection + template expansion, not program analysis + optimization
- **Option H (enriched AST) is natural** — specs enrich progressively, programs need transformation

### 8 Core Principles

| # | Principle | Implication |
|---|-----------|-------------|
| A | **Kern is a specification compiler** | Not program compiler, not transpiler |
| B | **UDR is the architecture** | Understand → Decide → Render |
| C | **Declarations, not programs** | Spec boundary: compile declarations, pass through expressions |
| D | **Constraints over analysis** | Generate guardrails, don't analyze handler programs |
| E | **Evolve is spec design** | Evolved nodes = structural abbreviations for repeated patterns |
| F | **Structural vocabulary > computational capability** | Add node types (constraints, relations), not expressions |
| G | **Targets are data** | ~100 LOC manifests, ~95% pattern strings |
| H | **U layer is the foundation** | Build first. Benefits compilation, review, evolve, metrics. |

### The Spec Boundary

What Kern compiles (DECLARATIONS):
- Types, interfaces, fields
- State machines (states + transitions)
- Routes (method, path, middleware)
- UI structure (screen, row, button)
- Style declarations
- Component composition

What passes through (EXPRESSIONS):
- Handler block code (`<<<...>>>`)
- Conditional test expressions (`if="count > 10"`)
- Event handler expressions (`onClick="setCount(count + 1)"`)
- Derived value expressions

**Rule:** If a proposed feature requires analyzing expression SEMANTICS (type inference, data flow, control flow), it doesn't belong in the spec. It belongs in handler code.

### Constraints Over Analysis

Instead of analyzing handler programs for spec violations:

```kern
machine Plan enforce=strict
  state draft
  state approved
  transition approve from=draft to=approved
```

`enforce=strict` → generated code uses private fields / Proxy objects that PREVENT direct state mutation. The constraint is in the SPEC. The enforcement is in the GENERATED CODE. No handler analysis needed.

### Evolve as Spec Design

Evolved nodes are not "compiler extensions." They're **structural abbreviations** — new vocabulary in the spec language.

Validation criteria for evolved nodes:
1. **Frequency:** Is this pattern repeated across codebases? (structure test)
2. **Template:** Can it be expressed as a generation pattern? (spec-ability test)
3. **Compression:** Does it reduce tokens significantly? (value test)
4. **Portability:** Does it work across targets? (universality test)

These are SPEC DESIGN criteria, not compiler criteria.

### Spec Compiler Precedent

| System | Spec Input | Code Output | LOC per Target |
|--------|-----------|-------------|----------------|
| Protobuf | .proto schema | Serialization code | ~500-2000 |
| OpenAPI | API spec | REST client/server | ~30 template files |
| Prisma | .prisma schema | ORM client | ~5000 (single target) |
| GraphQL codegen | .graphql SDL | Typed resolvers | ~500-2000 |
| **Kern (UDR)** | **.kern spec** | **Framework code** | **~80-100 manifest** |

Kern has the thinnest per-target layer because UDR separates decisions (D, data) from rendering (R, shared engine). Other spec compilers fuse D+R into per-target generators.
