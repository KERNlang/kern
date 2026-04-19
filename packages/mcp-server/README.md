# @kernlang/mcp-server

MCP server for KERN -- the LLM-native language that compiles to 12 targets. Give any AI agent the ability to write, compile, review, and self-correct `.kern` code.

```
npx @kernlang/mcp-server
```

## What is this?

KERN is a declarative DSL designed specifically for AI code generation. This MCP server exposes KERN's full compiler, reviewer, and schema to any MCP-compatible client (Claude Desktop, Cursor, Windsurf, VS Code, etc.).

An AI agent using this server can:
1. **Ask what it can write** -- `schema` tool returns the full language spec as JSON
2. **Compile .kern to any target** -- Next.js, React, Vue, Express, FastAPI, MCP servers, and more
3. **Self-correct from errors** -- `compile-json` returns structured diagnostics with line numbers and suggestions
4. **Review code** -- 76+ static analysis rules with taint tracking and OWASP coverage

## Quick start

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kern": {
      "command": "npx",
      "args": ["@kernlang/mcp-server"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "kern": {
      "command": "npx",
      "args": ["@kernlang/mcp-server"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add kern -- npx @kernlang/mcp-server
```

### Windsurf / VS Code

Add to your MCP settings:

```json
{
  "kern": {
    "command": "npx",
    "args": ["@kernlang/mcp-server"]
  }
}
```

## Tools

### compile

Compile `.kern` source to any target framework. Returns generated code.

```
source: ".kern source code"
target: "nextjs" | "tailwind" | "web" | "vue" | "express" | "fastapi" | "mcp" | ...
structure: "flat" | "bulletproof" | "atomic" | "kern"  // React targets
```

### compile-json

Compile with structured JSON diagnostics for programmatic self-correction. Returns `{ success, code, diagnostics, stats }`.

Each diagnostic includes `code`, `severity`, `line`, `col`, `endCol`, and `suggestion` -- everything an LLM needs to fix its own mistakes.

### schema

Returns the full KERN language schema as JSON: all node types, their props (with required/optional and types), allowed children, style shorthands, and multiline block types.

Use this before writing `.kern` code to know exactly what's valid.

### review

Run static analysis (76+ rules, taint tracking, OWASP) on TypeScript/JavaScript source code.

### review-kern

Lint `.kern` source for structural issues, missing props, and pattern violations.

### review-mcp-server

Scan MCP server code for security vulnerabilities. 13 rules mapped to OWASP MCP Top 10.

### parse

Parse `.kern` source and return the intermediate representation (IR). Useful for debugging.

### decompile

Convert parsed IR back to human-readable `.kern` text.

### validate

Validate `.kern` syntax without compiling. Returns parse errors or success.

### list-targets

List all 13 available compile targets plus React output structures.

### list-nodes

Browse KERN node types by category (layout, backend, state, types, mcp, etc.) with their props and allowed children.

## Resources

| Resource | URI | Description |
|----------|-----|-------------|
| kern-spec | `kern://spec` | Full language specification |
| kern-examples | `kern://examples/{category}` | Example code by category (ui, api, state-machine, mcp, terminal) |
| kern-targets | `kern://targets` | Available compile targets as JSON |

## Prompts

### write-kern

Comprehensive system prompt that teaches an LLM how to write `.kern` code -- grammar rules, node types, style shorthands, and annotated examples for UI, API, state machines, MCP servers, hooks, and type systems.

## LLM self-correction loop

The `schema` and `compile-json` tools enable a closed-loop workflow:

```
1. schema          --> "what can I write?"
2. write .kern     --> generate code using schema
3. compile-json    --> "did I get it right?"
4. if errors:
     read diagnostics (line, col, suggestion)
     fix and goto 3
5. done
```

No human intervention needed. The LLM can iterate to correct code autonomously.

## KERN syntax at a glance

```kern
// Comments work with // or #

doc text="User management API"
server name=UserAPI port=3001
  middleware name=cors
  middleware name=json

  route GET /api/users
    auth required
    handler <<<
      const users = await db.query('SELECT * FROM users');
      res.json(users);
    >>>
```

```kern
// State machine -- 7 lines, 140+ lines TypeScript output
machine name=Order initial=pending
  transition from=pending to=confirmed event=confirm
  transition from=confirmed to=shipped event=ship
  transition from=shipped to=delivered event=deliver
  transition from=pending to=cancelled event=cancel
```

## Project structure

A typical KERN project looks like this:

```
my-project/
  kern.config.ts          # KERN configuration
  src/
    features/
      auth.kern           # .kern source files
      dashboard.kern
  generated/              # compiled output (--outdir)
    auth.ts
    dashboard.tsx
  src/                    # facade re-exports (--facades)
    auth.ts               # export * from '../generated/auth.js'
    dashboard.ts
  index.ts                # barrel exports (auto-generated)
```

With `kern compile src/features --outdir=generated --facades`, you write `.kern` files and everything else is auto-generated.

## Configuration

Create `kern.config.ts` in your project root:

```ts
import type { KernConfig } from 'kern-lang';

const config: KernConfig = {
  // Target framework
  target: 'nextjs',

  // Output directory for generated files
  output: {
    outDir: 'src/generated',
    sourceMaps: true,
  },

  // i18n support
  i18n: {
    enabled: true,
    hookName: 'useTranslation',
    importPath: 'react-i18next',
  },

  // Component import mappings
  components: {
    uiLibrary: '@components/ui',
    componentRoot: '@/components',
  },

  // Color palette (hex -> Tailwind class)
  colors: {
    '#09090b': 'zinc-950',
    '#f97316': 'orange-500',
  },

  // Code review settings
  review: {
    showConfidence: true,
    maxComplexity: 15,
  },
};

export default config;
```

The config is auto-loaded by the CLI. All fields are optional -- sensible defaults are applied.

### Configuration options

| Key | Default | Description |
|-----|---------|-------------|
| `target` | `nextjs` | Compile target (auto-detected from package.json) |
| `structure` | `flat` | Output structure: `flat`, `bulletproof`, `atomic`, `kern` |
| `output.outDir` | `.` | Directory for generated files |
| `output.sourceMaps` | `false` | Generate `.map` files |
| `i18n.enabled` | `true` | Wrap strings in `t()` calls |
| `i18n.hookName` | `useTranslation` | i18n hook name |
| `components.uiLibrary` | `@components/ui` | UI component import path |
| `colors` | Zinc scale | Hex-to-Tailwind color mappings |
| `review.maxComplexity` | `15` | Max cognitive complexity |
| `review.disabledRules` | `[]` | Rule IDs to disable |
| `express.security` | `strict` | Express security level |
| `fastapi.cors` | `false` | Enable CORS for FastAPI |

## CLI commands

The KERN CLI (`kern-lang` npm package) provides these commands:

```bash
# Compile .kern files to TypeScript
kern compile src/ --outdir=generated --facades --barrel

# Compile with JSON diagnostics (for LLM self-correction)
kern compile src/ --outdir=generated --json

# Dump full language schema as JSON
kern schema

# Watch mode -- recompile on changes
kern dev src/

# Scan project and auto-detect target
kern scan

# LLM-powered code review
kern review src/
```

### Compile flags

| Flag | Description |
|------|-------------|
| `--outdir=DIR` | Output directory (default: `generated/`) |
| `--target=TARGET` | Override compile target |
| `--structure=flat\|bulletproof\|atomic\|kern` | React output structure |
| `--facades` | Auto-generate `src/*.ts` re-export facades |
| `--facades-dir=DIR` | Custom facades directory |
| `--barrel` | Generate barrel `index.ts` in output dir |
| `--strict-parse` | Fail on parse errors |
| `--json` | Output structured JSON diagnostics |

## Compile targets

| Target | Output |
|--------|--------|
| `nextjs` | Next.js App Router (TypeScript/React) |
| `tailwind` | React + Tailwind CSS |
| `web` | Plain React components |
| `vue` | Vue 3 SFC |
| `nuxt` | Nuxt 3 |
| `express` | Express TypeScript REST API |
| `fastapi` | FastAPI Python async backend |
| `native` | React Native (iOS/Android) |
| `cli` | Node.js CLI |
| `terminal` | Terminal UI (ANSI) |
| `ink` | Ink (React for terminals) |
| `mcp` | MCP server (Model Context Protocol) |

## License

AGPL-3.0
