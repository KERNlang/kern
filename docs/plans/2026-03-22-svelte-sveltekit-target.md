# Kern Svelte 5 / SvelteKit Target — Technical Specification

**Date:** 2026-03-22
**Author:** Claude + Raphael
**Status:** Draft
**Target version:** @kernlang/svelte v1.0.0 (kern v3.2.0)

---

## 1. Overview

Add two new compilation targets to Kern:

| Target | Output | File extension |
|--------|--------|----------------|
| `svelte` | Svelte 5 SFC (.svelte) | `.svelte` |
| `sveltekit` | SvelteKit app (pages, layouts, routes) | `.svelte` + `.ts` |

Svelte 5 uses the **runes** system (`$state`, `$derived`, `$effect`, `$props`). These are compiler macros — not imported, not runtime functions. They only work inside `.svelte` files (or `.svelte.ts` modules).

SvelteKit uses **file-based routing**: `+page.svelte`, `+layout.svelte`, `+page.server.ts`, `+server.ts`.

---

## 2. Package Structure

```
packages/svelte/
  package.json          @kernlang/svelte, depends on @kernlang/core
  tsconfig.json         extends root, references @kernlang/core
  src/
    index.ts            exports transpileSvelte, transpileSvelteKit
    transpiler-svelte.ts    Svelte 5 SFC transpiler (~600 LOC)
    transpiler-sveltekit.ts SvelteKit meta-framework layer (~400 LOC)
  tests/
    golden.test.ts      9 golden snapshot tests
    __snapshots__/
      golden.test.ts.snap   auto-generated
```

**Root tsconfig.json**: add `{ "path": "packages/svelte" }` to references.

---

## 3. Configuration Changes

### 3.1 config.ts

```typescript
// KernTarget union — add 'svelte' | 'sveltekit'
export type KernTarget = '...' | 'svelte' | 'sveltekit';

// VALID_TARGETS array — append
export const VALID_TARGETS: KernTarget[] = ['...', 'svelte', 'sveltekit'];

// KernConfig — add optional svelte section
svelte?: {
  version?: 5;
  typescript?: boolean;
};

// ResolvedKernConfig — add required svelte section
svelte: {
  version: 5;
  typescript: boolean;
};

// DEFAULT_CONFIG — add defaults
svelte: {
  version: 5,
  typescript: true,
},
```

### 3.2 cli.ts

**Imports** (line ~14):
```typescript
import { transpileSvelte, transpileSvelteKit } from '@kernlang/svelte';
```

**Target dispatch** (lines 218-238 + 2194-2212 — two locations):
```typescript
: target === 'svelte'
  ? transpileSvelte(ast, cfg)
  : target === 'sveltekit'
    ? transpileSvelteKit(ast, cfg)
```

**File extension** (lines 141-143 + 254-256):
```typescript
: (target === 'svelte' || target === 'sveltekit') ? '.svelte'
```

**Auto-detection** (add to framework detection):
```typescript
if (deps['@sveltejs/kit']) return 'sveltekit';
if (deps['svelte']) return 'svelte';
```

---

## 4. Node Mapping Table

### 4.1 Non-Visual Nodes (collect, don't render)

| Kern Node | Svelte Script Output |
|-----------|---------------------|
| `state name=X initial=V` | `let X = $state(V);` |
| `state name=X initial=[] type="string[]"` | `let X = $state<string[]>([]);` |
| `logic code=X` | `X` (raw code block) |
| `theme name {styles}` | Collected into themes map for `$ref` resolution |
| `handler <<<code>>>` | Consumed by parent node |
| `on event=E` | Event handler function + binding (see §6) |
| `metadata title=T description=D` | `<svelte:head>` (SvelteKit only, see §9) |

### 4.2 UI Nodes (render to template)

| Kern Node | HTML Element | Layout Default |
|-----------|-------------|----------------|
| `screen` | `<div>` | flex-col, min-h-100vh |
| `row` | `<div>` | flex-row |
| `col` | `<div>` | flex-col |
| `card` | `<div>` | box-shadow |
| `scroll` | `<div>` | overflow: auto |
| `grid cols=N` | `<div>` | display: grid |
| `section` | `<section>` | — |
| `header` | `<header>` | — |
| `text` | `<p>` | — |
| `text variant=h1` | `<h1>` | h1-h6, small, code |
| `text bind=X format="{v} dB"` | `<p>{X} dB</p>` | `{v}` replaced with bind value |
| `image src=X` | `<img src="/X.png" alt="X" />` | self-closing |
| `button text=X` | `<button>X</button>` | — |
| `input bind=X` | `<input bind:value={X} />` | self-closing |
| `slider bind=X` | `<input type="range" bind:value={X} />` | self-closing |
| `toggle bind=X` | `<input type="checkbox" bind:checked={X} />` | self-closing |
| `modal` | `<dialog open>` | — |
| `list items=X` | `<ul>` + `{#each}` | — |
| `item` | `<li>` | — |
| `tabs` | Tab bar + `{#if}` panels | — |
| `divider` | `<hr />` | self-closing |
| `progress` | `<progress>` | — |
| `form` | `<form>` | — |
| `conditional if=X` | `{#if X}...{/if}` | wraps children |
| `component ref=X` | `<X />` | import generated |
| `select bind=X` | `<select bind:value={X}>` | — |
| `option value=X` | `<option value="X">` | — |

### 4.3 Attribute Builders

| Node | Svelte Attributes |
|------|-------------------|
| `button to=Route` | `<a href="/Route">` (SvelteKit) |
| `button onClick=expr` | `onclick={() => { rewrittenExpr }}` |
| `button action=fn` | `onclick={fn}` |
| `input placeholder=P type=T` | `placeholder="P" type="T"` |
| `list items=X itemVar=Y` | `{#each X as Y (Y.id \|\| Y)}` |
| `progress current=C target=T` | `value="C" max="T"` |
| `slider min=A max=B step=S` | `min="A" max="B" step="S"` |
| `slider accent=#color` | CSS: `accent-color: #color` |
| `toggle accent=#color` | CSS: `accent-color: #color` |

---

## 5. Svelte 5 Rune Mapping

### 5.1 State — `$state()`

```kern
state name=count initial=0
state name=items initial=[] type="string[]"
state name=user initial="{name: '', age: 0}" type=User
```

```svelte
<script lang="ts">
  let count = $state(0);
  let items = $state<string[]>([]);
  let user = $state<User>({ name: '', age: 0 });
</script>
```

Rules:
- Always `let` (not `const`) — Svelte reactivity requires reassignment capability
- Add generic `<Type>` when initial value is array `[]` or object `{}`
- Primitives (number, boolean, string) don't need generics — TypeScript infers

### 5.2 Derived — `$derived()`

Not yet a first-class Kern node. Future: `derive name=doubled from="count * 2"`.
Would generate: `const doubled = $derived(count * 2);`

### 5.3 Effects — `$effect()`

Generated for window event listeners (see §6.2).
Can also be generated from `on` nodes with lifecycle semantics.

### 5.4 Props — `$props()`

```kern
screen name=Widget
  prop name=title type=string
  prop name=count type=number optional=true
```

```svelte
<script lang="ts">
  let { title, count = 0 } = $props<{ title: string; count?: number }>();
</script>
```

For SvelteKit page data:
```svelte
<script lang="ts">
  import type { PageData } from './$types';
  let { data } = $props<{ data: PageData }>();
</script>
```

### 5.5 Emits — Callback Props

```kern
emit name=change type=string
```

```svelte
<script lang="ts">
  let { onchange } = $props<{ onchange?: (payload: string) => void }>();
</script>
```

Usage in handlers: `onchange?.(value)` — optional chaining prevents TypeError if not provided.

---

## 6. Event Handling

### 6.1 Template-Bound Events

Events that bind directly on elements:

| Kern | Svelte |
|------|--------|
| `onClick="handleClick"` | `onclick={handleClick}` |
| `onClick="setCount(count + 1)"` | `onclick={() => { count = count + 1 }}` |
| `onClick="navigate('/about')"` | `onclick={() => navigate('/about')}` |
| `onSubmit=handleSubmit` | `onsubmit={handleSubmit}` |

Svelte 5 uses **lowercase** event names: `onclick`, `onsubmit`, `onchange` (not onClick, on:click).

For form submit: Svelte 5 removed `|preventDefault` modifier syntax. Generate `e.preventDefault()` as first line of submit handler functions.

### 6.2 Window/Global Events

Events that need `<svelte:window>`:

```kern
on event=keydown key=Escape
  handler <<<
    console.log('Escape pressed');
  >>>
```

```svelte
<script lang="ts">
  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    console.log('Escape pressed');
  }
</script>

<svelte:window onkeydown={handleKeydown} />
```

Events requiring `<svelte:window>`: `keydown`, `keyup`, `resize`, `scroll` (window-level).

### 6.3 Handler Rewriting

When handler code references React-style state setters, rewrite for Svelte:

| Pattern | Rewrite |
|---------|---------|
| `setFoo(expr)` | `foo = expr` |
| `setShow(!show)` | `show = !show` |
| `setItems([...items, x])` | `items = [...items, x]` |
| `emit('change', val)` | `onchange?.(val)` |

Algorithm: regex-match `set${capitalize(name)}(` → find matching `)` → replace with `name = expr`.

For emits: `emit('name', args)` → `onname?.(args)` with optional chaining.

---

## 7. Template Syntax

### 7.1 Conditional Rendering

```kern
conditional if=isPro
  section title="Pro Features"
```

```svelte
{#if isPro}
  <section class="section-N">
    <h2>Pro Features</h2>
  </section>
{/if}
```

Condition transforms: `&` → ` && `. Conditions passed through as JavaScript expressions.

### 7.2 List Rendering

```kern
list items=meals itemVar=meal
  item ...
```

```svelte
<ul class="list-N">
  {#each meals as meal (meal.id || meal)}
    <li class="item-M">...</li>
  {/each}
</ul>
```

### 7.3 Text Interpolation

- Static: `<p>Hello</p>`
- Dynamic: `<p>{count}</p>` — **single braces** (not Vue's `{{ }}`)
- Kern `value="{{expr}}"` → Svelte `{expr}` (strip double braces, use single)
- Kern `bind=varName` → Svelte `{varName}`

### 7.4 Tabs

```svelte
<div class="tabs-N">
  <div class="tab-buttons">
    <button onclick={() => activeTab = 'A'} class:active={activeTab === 'A'}>A</button>
    <button onclick={() => activeTab = 'B'} class:active={activeTab === 'B'}>B</button>
  </div>
  {#if activeTab === 'A'}
    <div>...A content...</div>
  {/if}
  {#if activeTab === 'B'}
    <div>...B content...</div>
  {/if}
</div>
```

Tab state: `let activeTab = $state('firstTabName');` in script.

### 7.5 Component References

```kern
component ref=ThresholdSlider bind=thresholds.drums disabled=!isPro
```

```svelte
<script lang="ts">
  import ThresholdSlider from './ThresholdSlider.svelte';
</script>

<ThresholdSlider bind:value={thresholds.drums} disabled={!isPro} />
```

Component props shorthand: `props=a,b,c` → `{a} {b} {c}`.

---

## 8. Style System

### 8.1 Scoped CSS

Svelte `<style>` is scoped by default (no `scoped` attribute needed).

```svelte
<style>
.screen-0 {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: #F8F9FA;
}
.card-1 {
  padding: 16px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
</style>
```

### 8.2 Pseudo-Selectors (Svelte advantage)

Kern pseudo-styles generate real CSS pseudo-selectors:

```kern
button text="Log Meal" {bg:#007AFF,:press:bg:#005BB5,:hover:bg:#0066CC}
```

```css
.button-9 {
  background-color: #007AFF;
}
.button-9:active {
  background-color: #005BB5;
}
.button-9:hover {
  background-color: #0066CC;
}
```

Mapping: `:press` → `:active`, `:hover` → `:hover`, `:focus` → `:focus`.

This makes Svelte the **first target with full pseudo-style support in plain CSS**. (Tailwind has it via utility classes, but this is native CSS.)

### 8.3 accent-color

Slider and toggle `accent` prop → CSS `accent-color`:

```css
.slider-N { accent-color: #f97316; }
.toggle-N { accent-color: #ea580c; }
```

### 8.4 Theme References

Same as Vue: `$ref` on a node merges theme styles into the node's class via `getThemeRefs()`.

---

## 9. SvelteKit Layer

### 9.1 Node Classification

```typescript
function classifySvelteKitNode(node: IRNode): 'page' | 'layout' | 'server' | 'component' {
  if (node.type === 'layout') return 'layout';
  if (node.type === 'route' || node.type === 'server') return 'server';
  if (node.type === 'page' || node.type === 'screen') return 'page';
  return 'component';
}
```

### 9.2 File Routing

| Node Type | Output Path |
|-----------|-------------|
| page/screen `name=Dashboard` | `src/routes/dashboard/+page.svelte` |
| page/screen `name=Index` | `src/routes/+page.svelte` |
| layout | `src/routes/+layout.svelte` |
| route `method=get path=/api/users` | `src/routes/api/users/+server.ts` |
| screen with `fetch` | `+page.svelte` + `+page.server.ts` |

Route path inference: PascalCase → kebab-case, `Index`/`Home` → root.

### 9.3 Server Routes (+server.ts)

```kern
route method=get path=/api/users
  handler <<<
    const users = await db.users.findAll();
  >>>
```

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, request }) => {
  const users = await db.users.findAll();
  return json(users);
};
```

Method mapping: `get` → `GET`, `post` → `POST`, `put` → `PUT`, `delete` → `DELETE`.

### 9.4 Load Functions (+page.server.ts)

```kern
screen name=Dashboard
  fetch url="/api/users" into=users
```

```typescript
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
  const response = await fetch('/api/users');
  if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
  const users = await response.json();
  return { users };
};
```

Corresponding +page.svelte receives `data` prop:
```svelte
<script lang="ts">
  import type { PageData } from './$types';
  let { data } = $props<{ data: PageData }>();
</script>
```

Template references: `data.users` instead of bare `users`.

### 9.5 Metadata (svelte:head)

```kern
metadata title="About Us" description="Learn about our company"
```

```svelte
<svelte:head>
  <title>About Us</title>
  <meta name="description" content="Learn about our company" />
</svelte:head>
```

---

## 10. SFC Assembly Order

```
<script lang="ts">
  // 1. External imports
  // 2. Props ($props)
  // 3. State ($state)
  // 4. Derived ($derived)
  // 5. Event handler functions
  // 6. Effects ($effect)
  // 7. Logic blocks
</script>

<svelte:window ... />          <!-- 8. Window events (if any) -->
<svelte:head>...</svelte:head> <!-- 9. Metadata (SvelteKit only) -->

<div class="screen-0">        <!-- 10. Template markup -->
  ...
</div>

<style>                        <!-- 11. Scoped CSS + pseudo-selectors -->
  ...
</style>
```

---

## 11. Golden Tests

| # | Test | Source | Validates |
|---|------|--------|-----------|
| 1 | Dashboard → Svelte | `examples/dashboard.kern` | Layout, styles, progress, list, tabs, themes, pseudo-styles |
| 2 | Audio Settings → Svelte | `examples/audio-settings.kern` | Deep nesting, sections, components, sliders, toggles, conditionals, grids |
| 3 | Counter (inline) | Inline .kern string | State + event handler rewriting |
| 4 | Toggle (inline) | Inline .kern string | Conditional rendering {#if} |
| 5 | Login Form (inline) | Inline .kern string | Form + input binding + submit |
| 6 | Keyboard Shortcuts (inline) | Inline .kern string | `<svelte:window>` event binding |
| 7 | SvelteKit Page + Load | Inline .kern string | +page.server.ts load + data prop |
| 8 | SvelteKit API Route | Inline .kern string | +server.ts GET/POST export |
| 9 | SvelteKit Metadata | Inline .kern string | `<svelte:head>` |

---

## 12. Explicit Exclusions (v1)

NOT in v1.0 — deferred:
- Svelte transitions (`transition:fade`, `animate:flip`)
- Custom actions (`use:action`)
- Snippets (`{#snippet}`, `{@render}`)
- `$bindable()` props
- `$inspect()` debugging
- Legacy Svelte stores (`writable`, `readable`)
- SvelteKit form actions (`export const actions`)
- SvelteKit hooks (`hooks.server.ts`, `hooks.client.ts`)
- SvelteKit error pages (`+error.svelte`)
- Svelte + Tailwind variant
- Review rules for Svelte
- Evolve patterns for Svelte
- Playground Svelte preview
- Component children (slots/snippets) — refs are self-closing in v1

NOT ever:
- Svelte 4 syntax (`$:` reactive declarations, `on:click` colon syntax)

---

## 13. Constraints and Gotchas

1. **Rune scope restriction**: `$state`, `$derived`, `$effect` are compiler macros — only valid at the **top level** of `.svelte` `<script>` blocks. Logic blocks (`<<<...>>>`) placed in script must NOT contain rune calls.

2. **Handler rewriting is regex-based**: For v1, `setFoo(expr)` → `foo = expr` uses regex with paren matching. Not a full AST transform. Works for 95% of cases. Complex nested calls (e.g., `setFoo(bar(baz()))`) work because we match balanced parens.

3. **Emit safety**: All emit rewrites use optional chaining (`onchange?.(value)`) to prevent TypeError when parent doesn't pass the callback.

4. **Form preventDefault**: Svelte 5 removed `|preventDefault` modifier syntax. Submit handlers must call `e.preventDefault()` explicitly.

5. **No deep slot support in v1**: Component refs (`component ref=X`) are self-closing. Children of component nodes are not rendered (no slot/snippet projection). Add in v1.1.

6. **LIR-forward code organization**: The transpiler is internally structured as `analyze → lower → print` phases. Types for `UiStmt`, `UiNode`, `StateCell`, `HandlerDecl` are defined locally within the transpiler file. These types are intentionally isomorphic to the planned `@kernlang/lir` types — future extraction into the shared LIR package is mechanical (move types + move functions), not a redesign.

7. **SvelteKit extends Svelte, not duplicates**: `transpiler-sveltekit.ts` imports and reuses all printing functions from `transpiler-svelte.ts`. It only ADDS: file routing logic, load function generation, server route generation, and `svelte:head` handling. Svelte rendering logic (`printState`, `printConditional`, `printForEach`, `printBinding`, `assembleFile`) is never duplicated in the SvelteKit file — only extended with routing concerns.

---

## 14. Implementation Order

| Step | Action | Est. LOC |
|------|--------|----------|
| 1 | Create package scaffolding | 40 |
| 2 | Add to root tsconfig.json | 1 |
| 3 | Add KernTarget + VALID_TARGETS | 5 |
| 4 | Add svelte config section | 25 |
| 5a | Define local UiStmt/UiNode/StateCell/HandlerDecl types | 60 |
| 5b | Implement analysis (collectThemes, collectState, buildStyleSheet) | 120 |
| 5c | Implement lowering (IRNode → UiStmt[]) | 200 |
| 5d | Implement Svelte print functions (printState, printConditional, etc.) | 200 |
| 5e | Implement assembleSvelteFile (SFC section assembly) | 50 |
| 6 | Golden test: dashboard.kern → Svelte | 10 |
| 7 | Verify snapshot | — |
| 8 | Golden test: audio-settings.kern → Svelte | 10 |
| 9 | Verify snapshot | — |
| 10 | Implement transpiler-sveltekit.ts | 350-400 |
| 11 | Golden tests: SvelteKit (load, route, metadata) | 30 |
| 12 | Add imports + dispatch to cli.ts | 10 |
| 13 | Add file extension mapping | 5 |
| 14 | Add auto-detect | 5 |
| 15 | Run `tsc -b && pnpm test` | — |
| 16 | Fix issues, update CHANGELOG | 10 |

**Total new code:** ~1050-1100 lines
**Total modified:** ~50 lines

---

## 15. Validation Checklist

Before shipping:

- [ ] `tsc -b` passes (no type errors)
- [ ] All golden tests pass
- [ ] `kern compile examples/dashboard.kern --target=svelte` produces valid .svelte
- [ ] `kern compile examples/dashboard.kern --target=sveltekit` produces +page.svelte + correct artifacts
- [ ] Auto-detect recognizes `svelte` and `@sveltejs/kit` in package.json
- [ ] Dev watcher works: `kern dev examples/ --target=svelte`
- [ ] Token reduction is calculated correctly
- [ ] Source maps are generated
- [ ] No regressions in existing targets (`pnpm test` passes all packages)

---

## 16. Related Documents

- `2026-03-22-lir-agnostic-architecture.md` — Future architecture: this hand-written transpiler is designed for extraction into the shared LIR engine (Phase 5 of migration path)
- `2026-03-22-transpiler-architecture-options.md` — All 8 architecture options (A-H) with tradeoffs
- `2026-03-22-svelte-compiler-analysis.md` — Deep analysis of Svelte 5's own compiler (lessons applied here)
