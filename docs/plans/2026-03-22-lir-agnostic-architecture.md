# Kern LIR — Lowered Intermediate Representation Specification

**Date:** 2026-03-22
**Author:** Claude + Raphael + Codex (architecture)
**Status:** Draft (rev3 — strategy-driven unified engine)
**Target version:** @kernlang/lir v1.0.0 (kern v4.0.0)

---

## 0. Value Proposition

**The Flutter Insight**: Flutter has ONE rendering engine (Skia) parameterized by platform. Kern has ONE print engine parameterized by framework manifest. The manifest IS the framework description. The engine IS the universal text renderer.

**Targets are DATA, not CODE.** Each framework is a ~100 LOC manifest of strategy selections and template patterns. The engine has ~600 LOC of strategy logic that handles ALL frameworks. New target = write data. No code.

**Rev3 breakthrough**: Strategies replace hooks. Instead of per-target hook functions (~800 LOC each), the engine contains built-in code paths for each strategy type (wrap_block, decorate_child, expr_wrapper, etc.). Manifests SELECT which strategy. This reduces per-target cost from ~800 LOC to ~100 LOC.

Numbers (range depends on architecture option — see Section 8 for detailed breakdown):
- Shared engine: ~1,700-1,830 LOC (lowering + emit + styles + imports)
- Per-target code: ~100-1,200 LOC depending on whether target is a thin manifest (Option C) or lineage base + variant (Option B)
- Plugins (Tailwind, Python, routing): ~1,500 LOC
- **Best case (Option C, pure manifests): ~4,530 LOC** (~55% reduction)
- **Realistic case (Option C+B hybrid, per Codex review): ~8,200 LOC** (~18% reduction)
- See Section 8 for the detailed LOC table reconciling these estimates

Beyond LOC, the structural value:

1. **Maintenance** — Fix a bug in StyleSheetBuilder once, fixed for all 12+ targets
2. **Consistency** — Token counting, source maps, style expansion identical everywhere
3. **Extensibility** — New target VARIANTS cost ~200-500 LOC, not ~600-1200 LOC
4. **Evolve integration** — New Kern node types automatically work across all targets via shared lowering
5. **Onboarding** — Clear interfaces: "implement these hooks, provide this manifest"

LOC reduction is real (~18%) but secondary to these structural benefits.

---

## 1. Architecture Overview

Refactor transpilers into a **three-layer compiler**:

```
Layer 1: Parse     → IRNode AST           (existing @kernlang/core)
Layer 2: Lower     → Semantic LIR          (NEW @kernlang/lir)
Layer 3: Print     → Target Code            (manifest + hooks per target)
```

Two **family-specific LIRs** — UI and Server don't share domain semantics:

```
              ┌─→ UiLir ──→ React hooks ──→ .tsx
              │          ├─→ Vue hooks   ──→ .vue
IRNode AST ───┤          ├─→ Svelte hooks ─→ .svelte
              │          └─→ Angular hooks → .ts
              │
              └─→ ServerLir → Express hooks → .ts
                            ├→ FastAPI hooks → .py
                            └→ Gin hooks     → .go
```

Shared scaffolding across both families: StyleSheetBuilder, ImportCollector, ArtifactPlanner, SourceMapBuilder, CapabilityAnalyzer.

### Design Principles

1. **Semantic, not syntactic** — LIR captures INTENT (bind state to input), not SYNTAX (bind:value vs v-model vs value+onChange)
2. **Family-split** — UI and backend are separate domains. Don't force them into one IR.
3. **Capability-driven** — targets declare what they support. Engine adapts output per capability.
4. **No lowest common denominator** — hooks specialize late. Output is idiomatic per target.
5. **Declarative manifests + programmatic hooks** — data in manifests, logic in hooks. (LLVM pattern: TableGen + C++ backends)

### Inspiration

| System | What We Learned |
|--------|-----------------|
| **LLVM** | TableGen (declarative) + backend lowering (programmatic). Shared optimization passes. |
| **Fable** (F# → JS/Python/Rust) | High-level semantic IR → thin target printers (~500-1500 LOC). Closest model to Kern. |
| **Haxe** (→ JS/C++/C#/Python) | Shared typed AST across targets. But generators still large. Need better separation. |
| **Kotlin Multiplatform** | `expect`/`actual` declarations = capability-based target specialization. |
| **Nim** (→ C/JS) | JS backend is small because semantics are close to source. Lesson: closer semantics = thinner backend. |
| **MLIR** | Multi-level IR with progressive lowering. We use 2 stages; could add optimization stage later. |

### LIR Architecture Classification

Our LIR is **Type 4 (Semantic) + Type 6 (Family-Split) + Type 11 (Staged)**:
- Semantic: annotated with types, capabilities, and intent
- Family-split: UiLir and ServerLir are separate domain models
- Staged: AST → Semantic LIR → Printed Code (2 lowering stages, extensible to 3+)

---

## 2. UiLir Types

### 2.1 UiComponent — The Core Unit

```typescript
interface UiComponent {
  name: string;
  role: 'page' | 'layout' | 'component' | 'error';
  params: UiParam[];           // component props
  emits: UiEmit[];             // event callbacks
  state: StateCell[];          // reactive state
  derived: DerivedCell[];      // computed values
  effects: EffectDecl[];       // side effects
  handlers: HandlerDecl[];     // event handler functions
  body: UiStmt[];              // template tree (semantic)
  styles: BuiltStyleSheet;     // normalized CSS
  windowEvents: WindowEventDecl[];
  meta?: MetadataDecl;         // page title/description
  fetches: FetchDecl[];        // data loading requirements
  componentRefs: Set<string>;  // imported component names
  capabilities: CapabilityFacts;
}
```

### 2.2 StateCell — Reactive State

```typescript
interface StateCell {
  name: string;
  initial: string;          // JS expression for initial value
  type?: string;            // TypeScript type annotation
  needsGeneric: boolean;    // true for Array/Object (TS inference can't handle)
}
```

Target lowering:
| Target | Output |
|--------|--------|
| React | `const [name, setName] = useState(initial)` |
| Vue | `const name = ref(initial)` |
| Svelte | `let name = $state(initial)` |
| Solid | `const [name, setName] = createSignal(initial)` |
| Angular | `name = signal(initial)` |

### 2.3 UiStmt — Template Statements

```typescript
type UiStmt =
  | { kind: 'Render'; node: UiNode }
  | { kind: 'If'; test: string; then: UiStmt[]; else?: UiStmt[] }
  | { kind: 'ForEach'; collection: string; item: string;
      index?: string; key?: string; body: UiStmt[] }
  | { kind: 'Let'; name: string; expr: string }
  | { kind: 'Raw'; code: string };
```

`If` lowering:
| Target | Output |
|--------|--------|
| React | `{test && (<>then</>)}` or `{test ? (<>then</>) : (<>else</>)}` |
| Vue | `<div v-if="test">then</div>` |
| Svelte | `{#if test}then{:else}else{/if}` |
| Angular | `@if (test) { then } @else { else }` |

`ForEach` lowering:
| Target | Output |
|--------|--------|
| React | `{collection.map((item) => (<Fragment key={key}>body</Fragment>))}` |
| Vue | `<div v-for="item in collection" :key="key">body</div>` |
| Svelte | `{#each collection as item (key)}body{/each}` |
| Angular | `@for (item of collection; track key) { body }` |

### 2.4 UiNode — Rendered Element

```typescript
interface UiNode {
  kind: UiNodeKind;
  className?: string;           // from StyleSheetBuilder
  attrs: UiAttr[];
  children: UiStmt[];           // children are stmts (allows nested If/ForEach)
  selfClosing: boolean;
  tagHint?: string;             // explicit tag override
  semantics: {
    textVariant?: string;       // h1-h6, small, code
    textContent?: string;       // static text inside
    routeTarget?: string;       // navigation link
    componentName?: string;     // for ComponentRef
    sectionTitle?: string;      // for Section
  };
}

type UiNodeKind =
  | 'Screen' | 'Row' | 'Col' | 'Card' | 'Scroll' | 'Grid'
  | 'Section' | 'Header'
  | 'Text' | 'Image' | 'Button' | 'Input' | 'Slider' | 'Toggle'
  | 'Modal' | 'List' | 'ListItem' | 'Tabs' | 'Tab'
  | 'Divider' | 'Progress' | 'Form'
  | 'Select' | 'Option'
  | 'ComponentRef';
```

### 2.5 UiAttr — Element Attributes

```typescript
type UiAttr =
  | { kind: 'static'; name: string; value: string }
  | { kind: 'dynamic'; name: string; expr: string }
  | { kind: 'event'; event: string; handler: string; isExpression: boolean }
  | { kind: 'bind'; attr: string; state: string }
  | { kind: 'spread'; props: string[] };
```

`bind` lowering:
| Target | Output |
|--------|--------|
| React | `value={state} onChange={(e) => setState(e.target.value)}` |
| Vue | `v-model="state"` |
| Svelte | `bind:value={state}` |
| Angular | `[(ngModel)]="state"` |

---

## 3. ServerLir Types

### 3.1 ServerModule

```typescript
interface ServerModule {
  name: string;
  port?: number;
  routes: ServerRoute[];
  middleware: MiddlewareDecl[];
  websockets: WebSocketDecl[];
  models: ModelDecl[];
  capabilities: ServerCapabilities;
}
```

### 3.2 ServerRoute

```typescript
interface ServerRoute {
  method: 'get' | 'post' | 'put' | 'delete' | 'patch';
  path: string;
  params: ParamDecl[];
  bodyType?: string;
  responseType?: string;
  middleware: string[];
  body: ServerStmt[];
  validation?: ValidationDecl;
}
```

### 3.3 ServerStmt

```typescript
type ServerStmt =
  | { kind: 'Bind'; name: string;
      source: 'params' | 'query' | 'body' | 'header' | 'compute';
      expr: string }
  | { kind: 'Guard'; test: string; status: number; message: string }
  | { kind: 'Call'; target: string; args: string[]; assignTo?: string }
  | { kind: 'Respond'; status: number;
      type: 'json' | 'text' | 'redirect' | 'empty';
      body?: string }
  | { kind: 'Branch'; cases: Array<{ test: string; body: ServerStmt[] }> }
  | { kind: 'Loop'; item: string; collection: string; body: ServerStmt[] }
  | { kind: 'Try'; body: ServerStmt[]; recover: ServerStmt[] }
  | { kind: 'Effect'; code: string }
  | { kind: 'Raw'; code: string };
```

`Respond` lowering:
| Target | Output |
|--------|--------|
| Express | `res.status(200).json(body)` |
| FastAPI | `return JSONResponse(body, status_code=200)` |
| Hono | `return c.json(body, 200)` |
| SvelteKit | `return json(body)` |
| Gin (Go) | `c.JSON(200, body)` |

---

## 4. Shared Engine Components

### 4.1 StyleSheetBuilder

Replaces duplicated style logic in ALL transpilers (~600 LOC saved).

```typescript
class StyleSheetBuilder {
  constructor(themes: ThemeTable);
  resolveAndAdd(nodeKind: string, node: StylableNode): string | undefined;
  build(): BuiltStyleSheet;
}

interface BuiltStyleSheet {
  rules: StyleRule[];
}

interface StyleRule {
  className: string;
  properties: Record<string, string | number>;
  pseudos?: Record<string, Record<string, string | number>>;
}
```

Shared operations: theme resolution, shorthand expansion, layout defaults, pseudo-style collection, class naming.

Target hooks decide output format:
| Style Mode | Output |
|-----------|--------|
| `scoped-css` | `.class { prop: val; }` in `<style>` (Vue, Svelte) |
| `utility-classes` | `className="tw-classes"` (Tailwind) |
| `inline-object` | `style={{ prop: val }}` (React web) |
| `rn-stylesheet` | `StyleSheet.create({})` (React Native) |
| `ansi` | ANSI escape codes (Terminal) |

### 4.2 ImportCollector

Replaces duplicated import tracking in ALL transpilers (~300 LOC saved).

```typescript
class ImportCollector {
  addNamed(source: string, name: string): void;
  addDefault(source: string, name: string): void;
  addType(source: string, name: string): void;
  build(autoImported?: string[]): ImportLine[];
}
```

Respects `manifest.imports.autoImported` — names in this list are NOT emitted (Nuxt auto-imports `ref`, Svelte auto-imports runes).

### 4.3 CapabilityAnalyzer

Scans IRNode tree, produces facts for capability-driven lowering:

```typescript
interface CapabilityFacts {
  usesState: boolean;
  usesDerived: boolean;
  usesEffects: boolean;
  usesEvents: boolean;
  usesWindowEvents: boolean;
  usesTabs: boolean;
  usesRouting: boolean;
  usesConditional: boolean;
  usesLoop: boolean;
  usesComponentRefs: boolean;
  usesFetch: boolean;
  usesMetadata: boolean;
  usesThemeRefs: boolean;
  usesPseudoStyles: boolean;
  usesForm: boolean;
}
```

### 4.4 ThemeTable

```typescript
class ThemeTable {
  constructor();
  collectFromTree(root: IRNode): void;
  get(name: string): NormalizedStyle | undefined;
}
```

### 4.5 Strategy Catalog (rev3)

The engine contains built-in code paths for each strategy type. Manifests SELECT strategies. No per-target code needed for standard patterns.

**9 strategy categories, ~34 options:**

| Category | Strategies | Examples |
|----------|-----------|----------|
| Conditional | `wrap_block`, `decorate_child`, `expr_wrapper` | {#if}, v-if, {&& (<>)} |
| Loop | `wrap_block`, `decorate_child`, `expr_map` | {#each}, v-for, .map() |
| State | template patterns (no strategy switch) | $state(), useState(), ref() |
| Events | template patterns | onclick={}, @click="", onClick={} |
| Binding | `native`, `controlled` | bind:value, v-model, value+onChange |
| File | `sfc`, `single_function`, `module` | .svelte, .tsx, .ts |
| Styles | `scoped_css`, `utility_classes`, `inline_object`, `rn_stylesheet` | \<style\>, className, style={} |
| ConditionalClass | `class_directive`, `bound_object`, `ternary_expr` | class:active, :class="{}", className={} |
| DynamicProp | `curly`, `colon` | prop={expr}, :prop="expr" |

The engine has ONE function per category with switch cases per strategy kind. Adding a new strategy (~50 LOC in engine) benefits ALL targets that select it.

### 4.6 Print Engine

The **strategy-driven unified emitter**. One engine, all targets.

```typescript
function emitProgram(
  comp: UiComponent,
  manifest: TargetManifest,
): TranspileResult;
```

The engine:
1. Calls `hooks.printState()` for each StateCell
2. Calls `hooks.printDerived()` for each DerivedCell
3. Walks `comp.body` recursively, calling `hooks.printConditional()`, `hooks.printForEach()`, `hooks.printEventBinding()`, etc.
4. Calls `hooks.printStyles()` on the BuiltStyleSheet
5. Calls `hooks.assembleFile()` to combine all sections

The engine handles: indentation, source maps, token counting, recursion. The hooks handle: formatting.

---

## 5. Target Interface

### 5.1 TargetManifest (declarative, ~50 LOC per target)

```typescript
interface TargetManifest {
  id: string;
  family: 'ui' | 'server';
  files: {
    extension: string;
    naming: (role: string, name: string) => string;
  };
  elements: Record<UiNodeKind, string>;  // kind → HTML tag
  reactivity: 'hooks' | 'signals' | 'assignment' | 'refs';
  styling: 'inline-object' | 'scoped-css' | 'utility-classes' | 'rn-stylesheet' | 'ansi';
  classAttr: 'className' | 'class';
  events: {
    prefix: string;
    casing: 'camelCase' | 'lowercase';
  };
  imports: {
    autoImported: string[];
    stateSource?: string;
  };
  supports: Record<string, boolean>;
  routing?: RoutingManifest;
}
```

### 5.2 TargetHooks (programmatic)

Hooks receive **statement objects + PrintCtx**, not positional strings. This enables recursive rendering — hooks decide HOW to render, call back into the engine for children.

```typescript
/** Context passed to all hooks — enables recursive rendering */
interface PrintCtx {
  manifest: TargetManifest;
  hooks: TargetHooks;
  indent: number;
  imports: ImportCollector;
  styles: StyleSheetBuilder;
  component: UiComponent;
  stateNames: Set<string>;
  emitNames: Set<string>;
  // Recursive callbacks — hooks call back into the engine
  renderStmt: (stmt: UiStmt) => string;
  renderStmts: (stmts: UiStmt[]) => string;
  withIndent: (fn: () => string) => string;
}

interface TargetHooks {
  // State & reactivity
  printState(cell: StateCell): string;
  printDerived?(cell: DerivedCell): string;
  printEffect?(decl: EffectDecl): string;
  printProps?(params: UiParam[]): string;

  // Events & binding
  printEventBinding(event: string, handler: string, isExpr: boolean): string;
  printBinding(attr: string, state: string): string;

  // Control flow — receive UiStmt[] + ctx for recursive rendering
  // Svelte: wraps in {#if}...{/if} block
  // Vue: adds v-if to first child (uses <template v-if> for multi-root branches)
  // React: uses JSX ternary/&&
  printConditional(stmt: { test: string; then: UiStmt[]; else?: UiStmt[] }, ctx: PrintCtx): string;
  printForEach(stmt: { collection: string; item: string; key?: string; body: UiStmt[] }, ctx: PrintCtx): string;

  // Handler rewriting
  rewriteHandler(code: string, stateNames: Set<string>, emitNames: Set<string>): string;

  // File assembly
  assembleFile(sections: FileSections): string;

  // Styles
  printStyles?(sheet: BuiltStyleSheet): string | null;
  printStyleAttr?(className: string): string;

  // Optional: preprocessing
  preprocess?(comp: UiComponent): UiComponent;

  // Optional: meta-framework routing
  classifyNode?(node: IRNode): string;
  generateLoadFunction?(fetch: FetchDecl): string;
  generateServerRoute?(route: ServerRoute): string;
}
```

### 5.3 Target Lineages and Variants

Within each domain family (UI / Server), targets group into **lineages** — a base implementation + thin variants. Override-based composition, not deep inheritance.

```typescript
/** Base target implementation for a lineage (e.g., React, Vue, Svelte) */
interface TargetLineage {
  id: string;                    // 'react' | 'vue' | 'svelte' | 'server-ts' | 'server-py'
  family: 'ui' | 'server';
  manifest: TargetManifest;
  hooks: TargetHooks;
}

/** Thin overlay for a variant within a lineage (e.g., Next.js, SvelteKit) */
interface TargetVariant {
  id: string;                    // 'nextjs' | 'sveltekit' | 'nuxt' | 'hono'
  extends: TargetLineage;
  manifestPatch?: Partial<TargetManifest>;
  hookOverrides?: Partial<TargetHooks>;
}
```

**Rule**: If a variant overrides `printConditional`, `printForEach`, `printState`, or `printBinding`, the lineage boundary is wrong — those differences belong in the lineage, not the variant.

Variants should ONLY override routing, file conventions, meta-framework hooks.

**Lineage map** (Vue and Svelte are SEPARATE lineages, not an "SFC lineage"):

| Lineage | Variants | Why separate |
|---------|----------|-------------|
| React | nextjs, tailwind, web, native | JSX expression-based conditionals/loops |
| Vue | nuxt | Directive-based conditionals (v-if ON elements) |
| Svelte | sveltekit | Block-based conditionals ({#if} WRAPS elements) |
| Server-TS | express, hono | TypeScript, mutable response (res.json) |
| Server-PY | fastapi | Python, return-value response |
| Terminal | ink | ANSI escape codes vs React-like terminal |

Vue and Svelte share scoped CSS, element mapping, and SFC format — but those are `@kernlang/lir` shared utilities, not lineage-level code.

**Realistic LOC budget:**
- Lineage base: ~800-1,200 LOC
- Variant overlay: ~200-500 LOC
- Adding a new VARIANT (e.g., Hono): ~200-300 LOC
- Adding a new LINEAGE (e.g., Angular): ~1,000-1,500 LOC

### 5.4 LanguageManifest (for cross-language backends)

```typescript
interface LanguageManifest {
  language: 'typescript' | 'python' | 'go' | 'rust';
  fileExtension: string;
  importSyntax: (source: string, names: string[]) => string;
  functionSyntax: (name: string, params: string, ret: string, body: string) => string;
  asyncKeyword: string;
  typeAnnotationStyle: 'typescript' | 'python-hints' | 'go' | 'rust';
}
```

### 5.4 RoutingManifest (for meta-frameworks)

```typescript
interface RoutingManifest {
  pagePattern: (route: string) => string;
  layoutPattern: (route: string) => string;
  serverPattern: (route: string, method: string) => string;
  errorPattern: (route: string) => string;
  middlewarePattern: (name: string) => string;
}
```

---

## 6. Target Validation — Does It Fit?

### 6.1 Svelte (manifest: 50 LOC, hooks: 200 LOC)

| Feature | Manifest | Hooks |
|---------|----------|-------|
| Elements | `elements: { Screen: 'div', ... }` | — |
| State | `reactivity: 'assignment'` | `printState → 'let x = $state(v)'` |
| Events | `events: { prefix: 'on', casing: 'lowercase' }` | `printEventBinding → 'onclick={h}'` |
| Binding | `supports.twoWayBinding: true` | `printBinding → 'bind:value={s}'` |
| Conditional | — | `printConditional → '{#if}...{/if}'` |
| Styles | `styling: 'scoped-css'` | `printStyles → '.class { ... }'` |
| Assembly | — | `assembleFile → '<script>...<\/script>\n...\n<style>...'` |

### 6.2 React/Tailwind (manifest: 50 LOC, hooks: 250 LOC)

| Feature | Manifest | Hooks |
|---------|----------|-------|
| Elements | `elements: { Screen: 'div', ... }` | — |
| State | `reactivity: 'hooks'` | `printState → 'const [x, setX] = useState(v)'` |
| Events | `events: { prefix: 'on', casing: 'camelCase' }` | `printEventBinding → 'onClick={h}'` |
| Binding | `supports.twoWayBinding: false` | `printBinding → 'value={s} onChange={...}'` |
| Conditional | — | `printConditional → '{test && (<>...</>)}'` |
| Styles | `styling: 'utility-classes'` | `printStyleAttr → twClasses()` |
| Assembly | — | `assembleFile → "'use client';\nimport...\nexport default..."` |

### 6.3 Vue (manifest: 50 LOC, hooks: 220 LOC)

| Feature | Manifest | Hooks |
|---------|----------|-------|
| State | `reactivity: 'refs'` | `printState → 'const x = ref(v)'` |
| Events | `events: { prefix: '@', casing: 'lowercase' }` | `printEventBinding → '@click="h"'` |
| Binding | `supports.twoWayBinding: true` | `printBinding → 'v-model="s"'` |
| Conditional | — | `printConditional → element with v-if` |

### 6.4 Express (ServerLir, hooks: 200 LOC)

| Feature | Hooks |
|---------|-------|
| Route | `printRoute → 'router.get(path, async (req, res) => {...})'` |
| Bind | `printBind → 'const x = req.body.x'` |
| Guard | `printGuard → 'if (!test) return res.status(400).json(...)'` |
| Respond | `printRespond → 'res.json(body)'` |

All 4 paradigms (hooks/refs/assignment/signals, JSX/SFC/template-directive, scoped-css/tailwind/inline) fit cleanly into manifest + hooks.

---

## 7. Migration Path

| Phase | Action | LOC | Timeline |
|-------|--------|-----|----------|
| 0 | Ship Svelte hand-written (per Svelte spec) | +1050 | 2 weeks |
| 1 | Define LIR types (types-only package) | +400 | 1 week |
| 2 | Extract analyzers (ThemeTable, CapabilityFacts) | +300 | 1 week |
| 3 | Build UI lowering pass (IRNode → UiComponent) | +500 | 1-2 weeks |
| 4 | Build print engine (walks UiStmt, calls hooks) | +400 | 1 week |
| 5 | Port Svelte to manifest+hooks (FIRST, validates arch) | +250 / -600 | 1 week |
| 6 | Port Vue to manifest+hooks | +250 / -590 | 1 week |
| 7 | Port React/Tailwind | +300 / -920 | 1 week |
| 8 | Port remaining UI targets | +800 / -2500 | 2 weeks |
| 9 | Build Server lowering + port Express/FastAPI | +600 / -2300 | 2 weeks |
| 10 | Remove old transpiler code | -remaining | 1 day |

**Totals (revised, per Codex review):**
- New shared engine: ~1,700 LOC
- New lineage bases: ~4,400 LOC (6 lineages × ~800 LOC average)
- New variants: ~2,100 LOC (7 variants × ~300 LOC average)
- Removed: ~10,000 LOC of hand-written transpilers
- **Net: ~1,800 LOC reduction (~18%)**

The primary value is structural, not LOC. See Section 0.

### Golden Test Safety

Each phase validates via golden tests:
```
Old transpiler output === New LIR output
```

A compatibility test runs BOTH paths in parallel. Only switch when output matches 100%.

---

## 8. LOC Summary (revised per Codex review)

| Component | Current | After LIR | Notes |
|-----------|---------|-----------|-------|
| **Shared engine** | 0 | ~1,700 | lowering, styles, imports, print engine |
| **React lineage** | 921 | ~1,200 | base hooks (JSX, useState, Tailwind) |
| Next.js variant | 1,096 | ~500 | routing, metadata, server components |
| Tailwind variant | (in React) | ~300 | style class generation override |
| Web variant | 370 | ~100 | inline styles (minimal override) |
| Native variant | 242 | ~200 | StyleSheet, native elements |
| **Vue lineage** | 590 | ~800 | base hooks (SFC, ref, v-if directives) |
| Nuxt variant | 593 | ~400 | routing, auto-imports, useHead |
| **Svelte lineage** | ~600 (new) | ~800 | base hooks (SFC, $state, {#if} blocks) |
| SvelteKit variant | ~400 (new) | ~400 | routing, load, server routes |
| **Server-TS lineage** | 1,218 | ~800 | route handlers, middleware, Zod |
| Express variant | (in Server-TS) | ~300 | req/res API specifics |
| **Server-PY lineage** | 1,109 | ~600 | Python syntax, Pydantic |
| FastAPI variant | (in Server-PY) | ~300 | decorators, Depends |
| **Terminal lineage** | 584 | ~400 | ANSI escape codes |
| Ink variant | 797 | ~300 | React-like terminal |
| codegen-core | 2,174 | 2,174 | unchanged |
| **Total** | **~10,694** | **~8,774** | |

~18% LOC reduction. The primary value is structural: maintenance, consistency, extensibility (see Section 0). New VARIANTS cost ~200-500 LOC. New LINEAGES cost ~800-1,200 LOC.

---

## 9. Future Capabilities Enabled by LIR

### 9.1 Automatic Multi-Target from Evolved Nodes

Evolved node types define their lowering ONCE → work across all targets automatically. No per-target update needed.

### 9.2 Evolve Three-Artifact Proposals

Evolve proposes in order: (1) semantic node contract, (2) shared lowering, (3) per-lineage hooks.

```typescript
interface EvolveProposal {
  semanticNode: { keyword: string; slots: SlotDef[]; contract: string };
  sharedLowering?: { produces: string; lowerFn: string };
  lineageHooks: Partial<Record<string, { printFn: string; imports?: string[] }>>;
  variantOverrides?: Partial<Record<string, { printFn: string }>>;
}
```

**Guardrail**: Propose semantics FIRST, hooks SECOND. Prevents learning framework quirks instead of Kern concepts.

### 9.3 LLM-Assisted Target Updates

When a framework updates, LLM proposes changes to variant hooks (~200-500 LOC). Smaller diff than full transpiler (~800-1200 LOC) = higher LLM accuracy = more automation.

### 9.4 Community Contributions

For new VARIANTS: manifest patch (~30 LOC) + hook overrides (~200-500 LOC) + golden tests. Don't need to understand the LIR engine.

For new LINEAGES: manifest (~50 LOC) + hooks (~800-1200 LOC) + golden tests. Requires understanding the hook interface but not the lowering engine.

### 9.4 Cross-Language Backends

LanguageManifest separates syntax (TypeScript/Python/Go) from framework (Express/FastAPI/Gin). Adding a new language + framework: ~300 LOC total.

### 9.5 Optimization Passes

The staged architecture allows adding passes between lowering and printing:
- Dead node elimination
- Constant folding in conditions
- Style deduplication
- Component splitting (code splitting hints)

Not needed for v1 but the architecture supports it.

---

## 10. Related Documents

- **Svelte target spec:** `2026-03-22-svelte-sveltekit-target.md` — Phase 0 deliverable
- **Architecture options analysis:** `2026-03-22-transpiler-architecture-options.md` — All 7 options (A-G) with comparison matrix, cross-language analysis, compiler lessons, capability lattice

## 11. Open Questions

1. **Should the LIR be serializable?** If yes, we could cache lowered modules and skip re-lowering when source hasn't changed. Faster dev mode.

2. **Should the LIR be exposed to the evolve system?** Evolved nodes could define their own LIR lowering, enabling richer multi-target support.

3. **How much of codegen-core (type/interface/machine) should move to LIR?** Core language nodes currently bypass target transpilers. They could lower through the same engine.

4. **Should manifests be loadable at runtime?** If yes, community targets could be npm packages installed by users: `npm install @kern-community/angular`.
