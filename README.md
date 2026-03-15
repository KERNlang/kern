# Kern

**Write one `.kern` file. Ship 7 targets.**

Kern is a high-leverage authoring language that transpiles to production stacks you already use. 40 lines of Kern = 1,000+ lines of TypeScript.

```
screen name=Dashboard {bg:#F8F9FA}
  row {p:16,jc:sb,ai:center}
    text value=FITVT {fs:24,fw:bold}
    image src=avatar {w:40,h:40,br:20}
  card {p:16,br:12,bg:#FFF,m:16}
    progress label=Calories current=1840 target=2200 color=#FF6B6B
    progress label=Protein current=96 target=140 color=#4ECDC4
  button text="Log Meal" {w:full,br:8,bg:#007AFF,p:16}
```

That's 10 lines. Kern turns it into a complete React component with Tailwind classes, source maps, and token efficiency metrics. Or a Next.js page. Or a React Native screen. Or an Express API. Or a CLI. Or a terminal UI. Same source, 7 targets.

## Targets

| Target | Command | Generates |
|---|---|---|
| **Next.js** | `kern file.kern --target=nextjs` | App Router pages with metadata, `next/link`, `next/image` |
| **Tailwind** | `kern file.kern --target=tailwind` | React + Tailwind CSS with `useState`, `useTranslation` |
| **Web** | `kern file.kern --target=web` | React with inline CSS styles |
| **React Native** | `kern file.kern --target=native` | React Native with `StyleSheet.create()` |
| **Express** | `kern file.kern --target=express` | Typed Express routes with SSE streaming, child process spawn, timeouts |
| **CLI** | `kern file.kern --target=cli` | Commander.js with typed args, flags, `parseAsync()` |
| **Terminal** | `kern file.kern --target=terminal` | ANSI terminal UI — tables, spinners, progress bars, gradients |

## Install

```bash
# As a project dependency
npm install kern-lang

# Or globally for the CLI
npm install -g kern-lang
```

## Quick Start

```bash
# Transpile to Next.js (use npx if not installed globally)
npx kern examples/dashboard.kern --target=nextjs

# Transpile to Express API
npx kern examples/api-routes.kern --target=express

# Transpile to CLI app
npx kern examples/agon.kern --target=cli

# Show language metrics
npx kern examples/dashboard.kern --metrics
```

## Express Backend Example

```
server name=API port=3001
  middleware name=cors
  middleware name=json

  route method=post path=/api/review
    schema body="{diff: string}"
    stream
      handler <<<
        const results = await analyze(req.body.diff);
        for (const r of results) emit(r);
      >>>

  route method=get path=/health
    handler <<<
      res.json({ ok: true });
    >>>
```

Generates typed Express routes with SSE streaming, `AbortController` lifecycle, heartbeat keep-alive, and schema validation. Multi-file output via `GeneratedArtifact[]`.

## CLI Example

```
cli name=mytool version=1.0.0 description="My CLI tool"
  command name=build
    arg name=target type=string required=true
    flag name=watch alias=w type=boolean description="Watch mode"
    flag name=timeout type=number default=30
    import from="./build.js" names=runBuild
    handler <<<
      await runBuild(target, opts);
    >>>
```

Generates Commander.js with `parseAsync()`, `parseFloat` coercion for number flags, `requiredOption()` for required flags, per-command files.

## Terminal UI Example

```
screen name=Dashboard
  gradient text="MY APP" colors=[208,214,220,226,228]
  separator width=48
  scoreboard title="Results" winner="engine-1"
    metric name=Score values=["89","74","71"]
    metric name=Time values=["45s","52s","38s"]
  spinner message="Processing..." color=214
  progress value=75 max=100 color=214
```

Generates pure Node.js ANSI escape codes — no dependencies. Tables, spinners, progress bars, gradients, boxes.

## Metrics

```bash
npx kern examples/dashboard.kern --metrics
```

```
Metrics: examples/dashboard.kern
  Nodes:        23 (10 types)
  Styles:       18 declarations
  Mapped:       18 (100%)
  Escaped:      0 (0%)
  Shorthand:    94% coverage
  Theme refs:   4
```

The metrics engine tells you exactly how much of your design system Kern handles natively vs. needs escape hatches.

## Configuration

```typescript
// kern.config.ts
const config: KernConfig = {
  target: 'nextjs',
  i18n: { enabled: true, hookName: 'useTranslation' },
  components: { uiLibrary: '@components/ui' },
  colors: {
    '#18181b': 'zinc-900',
    '#f97316': 'orange-500',
    // your design system colors
  },
};
```

Config loaded via `jiti` (same as Tailwind CSS, Nuxt). CLI flags override config values.

## API

```typescript
import {
  parse,
  transpileTailwind,
  transpileNextjs,
  transpileExpress,
  transpileCliApp,
  transpileTerminal,
  collectLanguageMetrics,
  resolveConfig,
} from 'kern-lang';

const ast = parse(kernSource);
const result = transpileTailwind(ast, resolveConfig({ colors: myColors }));
console.log(result.code);
```

## How It Was Built

Kern was designed by three AI architectures — Claude (Anthropic), Codex (OpenAI), and Gemini (Google) — through competitive forge, brainstorm, and tribunal processes. Each feature was:

1. **Brainstormed** — all 3 AIs propose approaches in Kern draft format
2. **Forged** — all 3 implement independently, scored by automated fitness tests
3. **Reviewed** — losing AIs critique the winner, bugs are fixed

The Express target was forged in a 3-way competition. Codex won with typed generics and schema validation. Claude and Gemini's review caught 5 additional bugs. Every review found real issues — 9 review passes, 9 bugs caught and fixed.

94 tests across 6 test suites. Zero type errors. Every commit verified.

## Draft Protocol

Kern isn't just a transpiler — it's a communication protocol between AI engines. The Draft Protocol lets competing AIs exchange structured proposals:

```
draft {
  approach: "Use middleware chain with JWT validation"
  reasoning: "Standard pattern, battle-tested"
  tradeoffs: "adds latency", "requires secret management"
  confidence: 82
  keyFiles: "src/auth.ts", "src/middleware.ts"
  steps {
    1: "Add jsonwebtoken dependency"
    2: "Create verifyToken middleware"
    3: "Wire into Express app.use()"
  }
}
```

70% fewer tokens than natural language. Structured. Rankable. Engines speak Kern.

## License

**AGPL-3.0-or-later** — You are free to use, modify, and distribute Kern under the terms of the [GNU Affero General Public License v3.0](LICENSE). This means:

- If you modify Kern or build software that incorporates it, and you distribute that software or make it available over a network, you must release your source code under the same AGPL-3.0 terms.
- This applies equally to individuals, companies, and organizations.

**Commercial license:** If you want to use Kern in proprietary/closed-source software without the AGPL's source-sharing requirements, a commercial license is available. Contact [cukas](https://github.com/cukas) for details.

**In practice:** Solo developers, students, and open-source projects can use Kern freely. Companies building closed-source products need a commercial license — or they can open-source their code.

See [LICENSE](LICENSE) for the full text.

---

## Contributors

| Role | Who |
|---|---|
| **Creator & Director** | [cukas](https://github.com/cukas) |
| **Co-Architect** | Claude (Anthropic) — Opus 4.6 |
| **Co-Architect** | Codex (OpenAI) — GPT-5.4 |
| **Co-Architect** | Gemini (Google) |

Every feature was brainstormed by all 3 AIs, forged competitively, and cross-reviewed. 9 review passes, 9 bugs caught. The Express target was won by Codex in a 3-way forge. Engines speak Kern.

---

**Swiss-engineered. AI-designed. Human-directed.**
