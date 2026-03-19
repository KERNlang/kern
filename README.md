<div align="center">
  <br>
  <img src="assets/banner.svg" alt="KERN — The language LLMs think in" width="100%">
  <br><br>

  <strong>You prompt. AI writes KERN. KERN compiles to anything.</strong><br>
  <sub>Humans never write .kern — the AI does.</sub>

  <br><br>

  <a href="#install">Install</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="#what-is-kern">What is KERN?</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="#playground">Playground</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="#examples">Examples</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="#kern-review">kern review</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="#targets">11 Targets</a>

  <br><br>
</div>

---

## Install

```bash
npm install -g @kernlang/cli
```

```bash
kern compile src/kern/ --outdir=src/generated/   # .kern → TypeScript
kern app.kern --target=vue                        # .kern → Vue SFC
kern app.kern --target=nextjs                     # .kern → Next.js page
kern api.kern --target=fastapi                    # .kern → FastAPI Python
kern review src/ --recursive                      # Scan TS → find bugs
kern evolve src/ --recursive                      # Detect gaps → propose templates
kern dev src/kern/ --target=nextjs                # Watch & hot-transpile
```

---

## Playground

Try KERN without installing anything:

```bash
cd packages/playground && pnpm dev    # localhost:3000
```

Paste `.kern` code, pick a target, see compiled output — live with 400ms debounce. Supports all 10 compilable targets with example presets.

---

## What is KERN?

**KERN is a structural language that enforces correctness by design.**

You describe what you want in plain English. The AI (Claude, Codex, Gemini) writes `.kern`. KERN compiles to clean, production-ready TypeScript — for any framework.

```
Human:  "Build me a toast notification store with zustand"
  ↓
AI:     Writes 8 lines of .kern
  ↓
KERN:   Compiles to 54 lines of TypeScript
  ↓
Output: Working zustand store, typed interfaces, selectors
```

**You never touch `.kern` files.** The AI thinks in KERN because it's 70% fewer tokens than TypeScript — more code per context window, fewer hallucinations, structural guarantees.

No runtime. No framework lock-in. Just a compiler.

### Why the AI writes KERN instead of TypeScript directly

| | AI writes TypeScript | AI writes KERN |
|:--|:-----|:-----|
| **Correctness** | Hope the AI got it right | Parser rejects invalid structure |
| **Consistency** | Every file looks different | Same structure every time |
| **Targets** | Locked to one framework | Compile to 11 frameworks |
| **Review** | Read 500 lines of TS | `kern review` finds bugs via AST |
| **Upgrades** | Rewrite for new versions | Re-compile, done |

---

## Examples

### Same `.kern` source → React, Vue, FastAPI, or any target

**The KERN source** (what the AI writes):

```kern
screen name=Settings
  state name=darkMode initial=false
  card {p:24,br:12}
    text variant=h2 value="Preferences"
    row {gap:16}
      text value="Dark mode"
      button text="Toggle" action="setDarkMode(!darkMode)"
```

**→ React (`--target=tailwind`)**

```tsx
'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function Settings() {
  const { t } = useTranslation();
  const [darkMode, setDarkMode] = useState(false);

  return (
    <div className="flex flex-col min-h-screen">
      <div className="p-6 rounded-xl shadow">
        <h2>{t('settings.preferences', 'Preferences')}</h2>
        <div className="flex gap-4">
          <p>{t('settings.darkMode', 'Dark mode')}</p>
          <button onClick={() => setDarkMode(!darkMode)}>Toggle</button>
        </div>
      </div>
    </div>
  );
}
```

**→ Vue 3 (`--target=vue`)**

```vue
<script setup lang="ts">
import { ref } from 'vue';

const darkMode = ref(false);
</script>

<template>
  <div class="screen-0">
    <div class="card-1">
      <h2>Preferences</h2>
      <div class="row-2">
        <p>Dark mode</p>
        <button @click="darkMode = !darkMode">Toggle</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.screen-0 { display: flex; flex-direction: column; min-height: 100vh; }
.card-1 { padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
.row-2 { display: flex; flex-direction: row; gap: 16px; }
</style>
```

**→ Nuxt 3 (`--target=nuxt`)** — same output but no explicit `import { ref }` (auto-imported) and page goes to `pages/settings.vue`.

### FastAPI — `.kern` → Python API

```kern
server name=TrackAPI port=8000
  middleware name=cors
  route method=get path=/tracks/:id
    handler <<<
      return {"id": id, "title": "My Track"}
    >>>
  route method=post path=/tracks
    schema body="{title: string, duration: number}"
    handler <<<
      return {"created": True, "title": body.title}
    >>>
```

**→ FastAPI (`--target=fastapi`)**

Generates `main.py` + `routes/*.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.get_tracks_id import router as get_tracks_id_router
from routes.post_tracks import router as post_tracks_router
import uvicorn

app = FastAPI(title="TrackAPI")

app.add_middleware(CORSMiddleware, allow_origins=["*"], ...)

app.include_router(get_tracks_id_router)
app.include_router(post_tracks_router)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

Each route gets its own file with `APIRouter`, Pydantic models for schemas, and `:id` → `{id}` path conversion.

### State machines — 12 lines → 140+ lines

```kern
machine name=Plan
  state name=draft
  state name=approved
  state name=running
  state name=completed
  state name=failed
  state name=cancelled
  transition name=approve from=draft to=approved
  transition name=start from=approved to=running
  transition name=cancel from="draft|approved|running|failed" to=cancelled
  transition name=fail from="running" to=failed
```

**Generates** typed state type, error class, and transition functions:

```typescript
export type PlanState = 'draft' | 'approved' | 'running'
  | 'completed' | 'failed' | 'cancelled';

export class PlanStateError extends Error {
  constructor(
    public readonly expected: string | string[],
    public readonly actual: string,
  ) {
    const expectedStr = Array.isArray(expected) ? expected.join(' | ') : expected;
    super(`Invalid plan state: expected ${expectedStr}, got ${actual}`);
  }
}

/** draft → approved */
export function approvePlan<T extends { state: PlanState }>(entity: T): T {
  if (entity.state !== 'draft') throw new PlanStateError('draft', entity.state);
  return { ...entity, state: 'approved' as PlanState };
}

// + startPlan, cancelPlan, failPlan ...
```

### WebSocket — Express and FastAPI

```kern
server name=ChatServer port=4000
  websocket path=/ws/chat
    on event=connect
      handler <<<ws.send(JSON.stringify({ type: "welcome" }));>>>
    on event=message
      handler <<<broadcast(data);>>>
    on event=disconnect
      handler <<<console.log("client left");>>>
```

**→ Express** generates `WebSocketServer` with `ws` package. **→ FastAPI** generates `@app.websocket` with `WebSocket` + `WebSocketDisconnect`.

### Event handlers — one syntax, every framework

```kern
screen name=App
  on event=click
    handler <<<setCount(prev => prev + 1);>>>
  on event=key key=Enter
    handler <<<processInput(buffer);>>>
```

| Target | Output |
|:-------|:-------|
| React/Next.js | `useCallback` + `useEffect` for global listeners |
| Vue/Nuxt | `function handleClick(e: MouseEvent)` + `onMounted`/`onUnmounted` |
| Ink | `useInput((input, key) => { ... })` with key filtering |

### Zustand store — template-powered

```kern
interface name=Toast
  field name=id type=string
  field name=message type=string
  field name=type type="'success' | 'error' | 'info'"

interface name=ToastState
  field name=toasts type="Toast[]"
  field name=addToast type="(msg: string) => void"
  field name=removeToast type="(id: string) => void"

zustand-store storeName=Toast stateType=ToastState
  handler <<<
    toasts: [],
    addToast: (msg) => set(s => ({ toasts: [...s.toasts, { id: Date.now().toString(), message: msg, type: 'info' }] })),
    removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
  >>>
```

**Generates** typed interfaces + complete zustand store + selectors. The AI writes this in ~200 tokens. The TypeScript output is ~600 tokens.

---

## kern review

**Scan existing TypeScript. Find bugs. No AI needed — pure AST analysis.**

```bash
kern review src/stores/toast.ts
```

```
  @kernlang/review — analyzing src/stores/toast.ts

  KERN-expressible (3 constructs):
    L10-16      interface Toast (4 fields)                         (97%)
    L18-22      interface ToastState (3 fields)                    (97%)

  Suggested .kern rewrites (1):
    zustand-store  →  zustand-store storeName=Toast stateType=ToastState (173 → 5 tokens)

  Summary: 87% KERN coverage, ~218 → 70 tokens (68% reduction)
```

### 26 AST-based rules across 5 layers

All rules walk the TypeScript AST — zero regex on source text, zero false positives on strings/comments.

| Layer | Rules | Examples |
|:------|:------|:--------|
| **Base** (always active) | 12 | `floating-promise`, `memory-leak`, `state-mutation`, `empty-catch`, `machine-gap`, `config-default-mismatch` |
| **React** | 6 | `unstable-key`, `hook-order`, `async-effect`, `stale-closure`, `render-side-effect`, `state-explosion` |
| **Next.js** | 3 | `server-hook`, `hydration-mismatch`, `missing-use-client` |
| **Vue** | 4 | `missing-ref-value`, `missing-onUnmounted`, `reactive-destructure`, `setup-side-effect` |
| **Express** | 3 | `unvalidated-input`, `missing-error-middleware`, `sync-in-handler` |

### Bug detection

```bash
kern review src/App.tsx

  BUGS (1):
    ! L460: [memory-leak] Effect creates addEventListener() but has no cleanup
      Fix: Add cleanup: return () => { removeEventListener(...) }
```

### Multi-source linting: `--lint`

```bash
kern review src/ --lint        # KERN rules + ESLint + tsc diagnostics, unified output
```

Merges findings from three sources into one report with deduplication:
- **kern** — 26 structural rules (AST-based)
- **eslint** — if installed, runs via Node API
- **tsc** — TypeScript compiler diagnostics

### AI-assisted review: `--llm`

```bash
kern review src/ --llm         # Exports KERN IR (5x smaller than TS) for AI review
```

Builds a structured prompt with short aliases (N1, N2, ...) and handler bodies. Paste the output to any LLM. Parse the JSON response back with validated nodeId mapping.

### Auto-migration: `--fix`

```bash
kern review src/ --fix         # Writes .kern files from template suggestions + roundtrip verification
```

### CI enforcement

```bash
kern review src/ --enforce --min-coverage=80     # Block PRs below threshold
kern review --diff origin/main                    # Only changed files
```

### Real-world results

| Codebase | Files | Coverage | Bugs Found |
|:---------|:------|:---------|:-----------|
| audiofacets (Electron + React) | 840 | **90%** | 4,477 findings |
| audiofacets backend (Express) | 40 | **75%** | 478 findings |
| audiofacets shop (Next.js) | 47 | **90%** | 176 findings |
| kern-lang (self-review) | 48 | 88% | 0 |

`kern review` is not about token compression — it's about **structural confidence**. When the parser accepts your code, you know the interfaces are complete, the handlers exist, and the state transitions are valid.

---

## Targets

KERN compiles to **11 different targets** from the same `.kern` source:

| Target | Output | Use case |
|:-------|:-------|:---------|
| `nextjs` | Next.js App Router pages | Full-stack web apps |
| `tailwind` | React + Tailwind CSS | Component libraries |
| `web` | React with inline styles | Universal web components |
| `vue` | Vue 3 Single File Components | Vue apps |
| `nuxt` | Nuxt 3 (pages, layouts, server routes) | Full-stack Vue apps |
| `native` | React Native | Mobile apps |
| `express` | Express TypeScript + WebSocket | APIs and backends |
| `fastapi` | FastAPI Python + WebSocket | Python APIs and backends |
| `cli` | Commander.js | CLI tools |
| `terminal` | ANSI terminal | TUIs and dev tools |
| `ink` | Ink (React for terminals) | Interactive terminal UIs |

---

## Core Language Nodes

14 node types that cover the full spectrum of application logic:

| Node | What it does | Example |
|:-----|:-------------|:--------|
| `type` | Union types and aliases | `type name=Status values="ok\|error"` |
| `interface` | Typed data structures | `interface name=User` → fields |
| `fn` | Functions and generators | `fn name=compute stream=true returns=Item` |
| `machine` | State machines with transitions | 12 lines → 140+ lines of TS |
| `error` | Error classes with templates | `error name=NotFound message="..."` |
| `config` | Config interfaces + defaults | `config name=Settings` → interface + defaults |
| `store` | File-based JSON persistence | `store name=Plan` → full CRUD |
| `test` | Vitest-compatible test suites | `test name="Unit"` → describe/it |
| `event` | Typed event systems | `event name=AppEvent` → union + map |
| `on` | Event handlers (click, key, submit) | `on event=key key=Enter` → per-framework |
| `websocket` | Bidirectional real-time | `websocket path=/ws` → Express/FastAPI |
| `stream` | Async generator consumption | `stream name=lines source=generate` → `useEffect` |
| `import` | ES module imports | Named, default, type-only |
| `const` | Typed constant declarations | `const name=PORT type=number value=3000` |

---

## Template System

KERN detects your project's libraries and generates matching templates:

```bash
kern init-templates    # Scans package.json → scaffolds templates
```

Supported: **Zustand**, **SWR**, **TanStack Query**, **XState**, **Jotai**, **Zod**, **tRPC**

### Self-extending: `kern evolve`

Don't have a template for your library? KERN can learn it from your codebase:

```bash
kern evolve src/ --recursive          # Detect gaps → propose templates
kern evolve:review --list             # Review proposals with split-view
kern evolve:review --approve <id>     # Approve a proposal
kern evolve:review --promote --local  # Write to templates/
```

Evolve scans your TypeScript, finds patterns from 12 library families (react-hook-form, redux-toolkit, framer-motion, axios, yup, valibot, etc.), and generates `.kern` template proposals with typed slots. Each proposal is validated through a 5-step pipeline: parse, register, expand, golden-diff, typecheck.

---

## Version-Aware Compilation

KERN auto-detects framework versions from `package.json`. Upgrade your framework, re-compile, done.

| Framework change | Without KERN | With KERN |
|:-----------------|:-------------|:----------|
| Tailwind v3 → v4 | Rewrite classes, update config | `kern build` |
| Next.js 14 → 15 | Update metadata API, breaking changes | `kern build` |

---

## Proven at Scale

[Agon-AI](https://github.com/cukas/Agon-AI) — competitive AI orchestration — migrated entirely to KERN. 16 `.kern` files replaced 17 TypeScript files.

| File | TypeScript | KERN | Compression |
|:-----|:----------|:-----|:------------|
| Types (20+ interfaces) | 293 lines | 157 lines | **1.9x** |
| Errors (7 classes) | 77 lines | 18 lines | **4.3x** |
| Store (CRUD operations) | 60 lines | 3 lines | **20x** |
| **Full core package** | **~1,500 lines** | **~700 lines** | **~2x** |

---

## Monorepo

```
@kernlang/core        Parser, codegen, types — the compiler engine
@kernlang/cli         CLI tool (compile, transpile, dev, review, evolve)
@kernlang/react       Next.js, Tailwind, Web transpilers
@kernlang/vue         Vue 3 SFC, Nuxt 3 transpilers
@kernlang/native      React Native transpiler
@kernlang/express     Express backend + WebSocket transpiler
@kernlang/fastapi     FastAPI Python + WebSocket transpiler
@kernlang/terminal    ANSI terminal + Ink transpilers
@kernlang/review      TS → KERN inference, bug detection, enforcement
@kernlang/evolve      Self-extending template system (detect gaps → propose)
@kernlang/playground  Interactive compiler UI (Next.js)
@kernlang/metrics     Language coverage analysis
@kernlang/protocol    AI draft communication protocol
```

---

## License

**AGPL-3.0** — Swiss-engineered with precision.

Copyright (c) 2026 cukas
