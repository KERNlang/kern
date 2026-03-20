# KERN Evolve v4 — Self-Extending IR Architecture

**Date:** 2026-03-20
**Status:** Design complete, implementation pending
**Authors:** Claude (lead), Gemini (security review), Codex (brainstorm)
**Process:** Forge (3-AI architecture competition) → Tribunal (red-team, 12 vulnerabilities found) → Synthesis

---

## Vision

Point `kern evolve` at **any** codebase — old jQuery, bleeding-edge Drizzle, weird internal frameworks — and the LLM identifies repeating patterns KERN can't express. It proposes new IR nodes with syntax, codegen, and a **reason** why this deserves first-class status. Human approves. The node graduates into the live IR. Next time evolve runs, that pattern is recognized natively. **The language grew.**

No hardcoded detectors. No regex. The LLM is the universal pattern recognizer.

---

## 1. Discovery Phase

### How the LLM finds patterns

1. **Incremental file selection** — `git diff` since last evolve run to find changed files. First run scans all.
2. **Smart sampling** — cluster files by directory. Pick 3-5 representative files per cluster (by size + import diversity). Never send the whole codebase.
3. **Batch to LLM** — each batch includes:
   - 3-5 TypeScript source files
   - Full `NODE_TYPES` list (existing IR)
   - All graduated evolved node keywords
   - Prompt: *"Identify repeating structural patterns in these files that KERN cannot currently express. For each pattern, describe it, show 2-3 instances, and explain why it deserves a first-class node."*
4. **Frequency filter** — deduplicate across batches by structural signature. Only patterns appearing **3+ times** across the codebase survive.
5. **Dedup against existing** — LLM prompt includes the full node list. Post-check: keyword collision → reject. Structural similarity (compare props + output shape) > 80% → suggest merge with existing node.

### Cost controls

- `--max-tokens=N` flag (default: 100,000). Abort with summary if exceeded.
- `--provider=ollama` for local LLM (cost-free, slower).
- `--sample=N` — max files per directory cluster (default: 5).
- Incremental by default — only scans changed files.

### Commands

```
kern evolve discover <dir> [--recursive] [--max-tokens=100000] [--provider=openai|ollama]
```

**Always online.** Never called during compilation.

---

## 2. Proposal Format

```typescript
interface EvolveNodeProposal {
  // Identity
  keyword: string;            // e.g., "cache-layer"
  displayName: string;        // e.g., "Cache Layer"

  // Schema
  props: Array<{
    name: string;
    type: 'string' | 'boolean' | 'number' | 'expression';
    required: boolean;
    description: string;
  }>;
  childTypes: string[];       // e.g., ['entry', 'invalidate']

  // Examples
  kernExample: string;        // KERN syntax (golden input)
  expectedOutput: string;     // TypeScript output (golden output)

  // Codegen — real TypeScript generator function source
  codegenSource: string;      // Full .ts source: export default function(node, helpers) { ... }

  // Parser hints (optional)
  parserHints?: {
    positionalArgs?: string[];    // e.g., ["method", "path"]
    bareWord?: string;            // e.g., "name"
    multilineBlock?: string;      // e.g., "code" — reuses <<<...>>> syntax
  };

  // Target overrides (optional)
  targetOverrides?: Record<string, string>;  // target → codegen .ts source

  // Reasoning
  reason: {
    observation: string;      // "Found 12 instances of Redis cache wrappers in src/cache/"
    inefficiency: string;     // "Each requires ~45 lines of connection + TTL logic"
    kernBenefit: string;      // "Reduces to 3 lines, centralizes Redis config"
    frequency: number;        // How many times found
    avgLines: number;         // Avg lines of boilerplate per instance
    instances: string[];      // File paths where pattern was found
  };

  // Metadata
  codegenTier: 1 | 2;        // 1 = simple (auto), 2 = complex (needs review)
  proposedAt: string;         // ISO timestamp
  evolveRunId: string;        // Links back to the discovery run
}
```

---

## 3. Validation Pipeline

Before a proposal reaches human review:

1. **Schema check** — proposal matches the `EvolveNodeProposal` interface
2. **Keyword check** — not in `KERN_RESERVED` list, not a collision with existing `NODE_TYPES` or graduated nodes
3. **Parse check** — feed `kernExample` to the real parser (with `parserHints` applied). Must produce a valid AST.
4. **Codegen compile** — run `tsc` on `codegenSource`. Must compile without errors. Must export a function matching `(node: IRNode, helpers: CodegenHelpers) => string[]`.
5. **Codegen dry-run** — execute the compiled generator against the parsed AST. Must produce non-empty output.
6. **TypeScript check** — run output through `ts.transpileModule()`. Must be valid TS syntax.
7. **Golden diff** — compare codegen output to `expectedOutput` (AST-based comparison, whitespace-insensitive).
8. **Dedup check** — structural similarity against existing nodes.
9. **LLM retry** — on failure at steps 3-7, feed error back to LLM. Max 2 retries.

### Validation result

```typescript
interface EvolveValidationResult {
  schemaOk: boolean;
  keywordOk: boolean;
  parseOk: boolean;
  codegenCompileOk: boolean;
  codegenRunOk: boolean;
  typescriptOk: boolean;
  goldenDiffOk: boolean;
  dedupOk: boolean;
  errors: string[];
  retryCount: number;
}
```

---

## 4. Human Review UX

Split-view terminal (reuses existing `formatSplitView` pattern):

```
┌──────────────────────────────────────────────────────┐
│ PROPOSED NODE: cache-layer                            │
│ Freq: 12 files  |  Saves: ~45 lines/instance         │
├────────────────────────┬─────────────────────────────┤
│ KERN Syntax            │ Generated TypeScript         │
├────────────────────────┼─────────────────────────────┤
│ cache-layer name=usr   │ export const usrCache = {    │
│   entry name=profile   │   async getProfile(id) {    │
│     strategy rt        │     const k = `usr:${id}`;  │
│   invalidate on=upd    │     return redis.get(k);    │
│                        │   },                         │
├────────────────────────┴─────────────────────────────┤
│ REASON:                                               │
│   Observation: 12 Redis cache wrappers in src/cache/  │
│   Inefficiency: ~45 lines of connection + TTL logic   │
│   Benefit: 3 lines of KERN, centralized config        │
├──────────────────────────────────────────────────────┤
│ ✓ Parse  ✓ Codegen  ✓ TypeScript  ✓ Golden  ✓ Dedup  │
└──────────────────────────────────────────────────────┘
  [a]pprove  [r]eject  [e]dit codegen  [s]kip  [d]etail
```

- **[a]pprove** — graduates the node (see section 5)
- **[r]eject** — discards permanently
- **[e]dit** — opens `codegenSource` in `$EDITOR` for manual tweaks, re-runs validation
- **[s]kip** — defers to next review session
- **[d]etail** — shows full codegen source, all instances found, parser hints

### Commands

```
kern evolve review [--list] [--approve=<id>] [--reject=<id>]
```

---

## 5. Graduation Mechanism

When a proposal is approved:

### 5.1 File creation

```
.kern/evolved/
├── manifest.json                 # Registry of all graduated nodes
├── cache-layer/
│   ├── definition.json           # Props, childTypes, reason, parserHints, metadata
│   ├── codegen.js                # Pre-compiled generator (from codegenSource via tsc)
│   ├── codegen.ts                # Original TypeScript source (for editing/review)
│   ├── template.kern             # Golden KERN input
│   ├── expected-output.ts        # Golden TS output
│   └── targets/                  # Optional target-specific overrides
│       ├── express.js
│       └── react.js
```

### 5.2 Manifest format

```json
{
  "version": 1,
  "nodes": {
    "cache-layer": {
      "keyword": "cache-layer",
      "displayName": "Cache Layer",
      "codegenTier": 1,
      "childTypes": ["entry", "invalidate"],
      "parserHints": {},
      "hash": "sha256:a1b2c3...",
      "graduatedBy": "nicolas",
      "graduatedAt": "2026-03-20T18:30:00Z",
      "evolveRunId": "run-abc123",
      "kernVersion": "2.0.0"
    }
  }
}
```

### 5.3 Runtime loading (at startup)

```typescript
// In core startup (before any parsing):
const evolved = loadEvolvedNodes('.kern/evolved/');

for (const node of evolved) {
  // 1. Register keyword
  NODE_TYPES_DYNAMIC.add(node.keyword);
  for (const child of node.childTypes) {
    NODE_TYPES_DYNAMIC.add(child);
  }

  // 2. Register parser hints
  if (node.parserHints) {
    PARSER_HINTS.set(node.keyword, node.parserHints);
  }

  // 3. Load pre-compiled generator (sandboxed)
  const generator = loadSandboxedGenerator(
    path.join('.kern/evolved', node.keyword, 'codegen.js')
  );
  EVOLVED_GENERATORS.set(node.keyword, generator);
}
```

### 5.4 Sandboxed generator loading

```typescript
import { createContext, Script } from 'vm';

function loadSandboxedGenerator(jsPath: string): (node: IRNode) => string[] {
  const code = readFileSync(jsPath, 'utf-8');

  // Restricted context — only approved helpers, no require/process/fs
  const sandbox = {
    exports: {},
    helpers: {
      capitalize,
      parseParamList,
      dedent,
      kids: (node: IRNode, type?: string) => { /* ... */ },
      firstChild: (node: IRNode, type: string) => { /* ... */ },
      p: (node: IRNode) => node.props || {},
    },
  };

  const ctx = createContext(sandbox);
  const script = new Script(code);
  script.runInContext(ctx);

  return sandbox.exports.default || sandbox.exports.generate;
}
```

### 5.5 Codegen integration

```typescript
// In generateCoreNode(), before the default case:
export function generateCoreNode(node: IRNode): string[] {
  // ... existing switch cases ...

  // Check evolved generators before default
  const evolvedGen = EVOLVED_GENERATORS.get(node.type);
  if (evolvedGen) return evolvedGen(node);

  // ... default case (template check, return []) ...
}
```

### 5.6 Parser integration

```typescript
// In parseLine(), after extracting the type:
const hints = PARSER_HINTS.get(type);
if (hints) {
  // Positional args: "api-route GET /users" → props.method="GET", props.path="/users"
  if (hints.positionalArgs) {
    for (const argName of hints.positionalArgs) {
      rest = rest.replace(/^ +/, '');
      const match = rest.match(/^(\S+)/);
      if (match) {
        props[argName] = match[1];
        rest = rest.slice(match[0].length);
      }
    }
  }

  // Bare word: "auth-guard admin" → props.name="admin"
  if (hints.bareWord) {
    rest = rest.replace(/^ +/, '');
    const match = rest.match(/^([A-Za-z_][A-Za-z0-9_-]*)/);
    if (match && !rest.match(/^[A-Za-z_][A-Za-z0-9_-]*=/)) {
      props[hints.bareWord] = match[1];
      rest = rest.slice(match[0].length);
    }
  }
}

// Multiline blocks: reuse existing <<<...>>> mechanism
if (hints?.multilineBlock) {
  MULTILINE_BLOCK_TYPES.add(type);
}
```

---

## 6. Target Coverage

- **Default:** `codegen.js` works for all targets (outputs TypeScript, which is universal).
- **Target-specific:** Optional `targets/<target>.js` overrides loaded at startup.
- **Target resolution order:** `targets/<target>.js` → `codegen.js` → error.
- **Missing target = compile error** (never an LLM call):
  ```
  Error: Evolved node 'cache-layer' has no codegen for target 'vue'.
  Run: kern evolve backfill cache-layer --target=vue
  ```
- **Backfill command** (online, explicit):
  ```
  kern evolve backfill <keyword> --target=<target> [--provider=openai|ollama]
  ```
  LLM generates a target-specific generator, runs validation, presents for review.

---

## 7. Namespace + Collision

- **Reserved keywords:** `KERN_RESERVED` set in spec.ts — evolved nodes cannot use any keyword in `NODE_TYPES`.
- **Checked at graduation time.** If keyword collides → reject with message.
- **On KERN upgrade:** If a new KERN version adds a core node that collides with an evolved node:
  - `kern compile` warns: `"Evolved node 'fetch' conflicts with core node 'fetch' added in KERN 2.1. Run: kern evolve migrate"`
  - `kern evolve migrate` offers: rename evolved node, or confirm core supersedes (removes evolved version).
- **Explicit namespacing (escape hatch):** User can write `evolved:cache-layer` in .kern files to force the evolved version during migration.

---

## 8. Supply Chain Protections

- **Hash integrity:** `manifest.json` stores SHA256 of each `codegen.js`. `kern compile --verify` checks hashes (opt-in, recommended for CI).
- **Audit trail:** Each `definition.json` records `graduatedBy`, `graduatedAt`, `evolveRunId`.
- **CODEOWNERS:** Recommend adding `.kern/evolved/` to mandatory review paths.
- **Sandboxed execution:** `vm` context prevents codegen from accessing `require`, `process`, `fs`, or network.

---

## 9. Testing

- **Golden tests:** Each node has `template.kern` (input) + `expected-output.ts` (output).
- **AST-based comparison:** Parse both outputs as TypeScript, compare AST structure. Whitespace-insensitive.
- **Command:** `kern evolve test` — runs all golden tests. Exit code 1 on failure.
- **CI integration:** Add to `pnpm test` via package.json script.
- **Regression detection:** When KERN core updates, `kern evolve test` catches evolved nodes that broke.

---

## 10. Rollback

```
kern evolve rollback <keyword>
```

1. Check if any `.kern` files use the keyword. If yes → warn with file list, require `--force`.
2. Move `.kern/evolved/<keyword>/` to `.kern/evolved/.trash/<keyword>/` (recoverable).
3. Remove from `manifest.json`.
4. Next compile picks up the removal automatically.

Undo: `kern evolve restore <keyword>` moves from `.trash/` back.

---

## 11. Promotion (Evolved → Core)

When an evolved node is stable and widely used:

```
kern evolve promote <keyword>
```

1. Copies `codegen.ts` to `packages/core/src/generators/generate-<keyword>.ts`
2. Adds keyword to `NODE_TYPES` in `spec.ts`
3. Adds case to `generateCoreNode` switch in `codegen-core.ts`
4. Moves golden test to `packages/core/tests/`
5. Removes from `.kern/evolved/`
6. Outputs a summary diff for review

**Trigger:** Manual only. Human decides when a node is core-worthy. No automatic promotion.

---

## 12. Offline vs Online Commands

| Command | Network | Description |
|---------|---------|-------------|
| `kern compile` | Offline | Compile .kern → .ts |
| `kern dev` | Offline | Watch mode |
| `kern review` | Offline | Static analysis |
| `kern evolve discover` | **Online** | LLM finds patterns |
| `kern evolve backfill` | **Online** | LLM fills target gap |
| `kern evolve review` | Offline | Human reviews proposals |
| `kern evolve test` | Offline | Run golden tests |
| `kern evolve rollback` | Offline | Remove graduated node |
| `kern evolve promote` | Offline | Promote to core |
| `kern evolve migrate` | Offline | Resolve collisions |
| `kern evolve list` | Offline | Show graduated nodes |
| `kern evolve prune` | Offline | Remove unused nodes (90d) |

---

## 13. Example: Full Lifecycle

```bash
# 1. Discover patterns in a codebase
kern evolve discover src/ --recursive

# Output: "Found 3 candidate patterns: cache-layer (12 instances),
#          api-validator (8 instances), event-bus (5 instances)"

# 2. Review proposals
kern evolve review
# → Split-view UI for each proposal
# → Approve cache-layer, reject api-validator, skip event-bus

# 3. Graduated! Now use it in .kern files:
#    cache-layer name=userCache backend=redis ttl=3600
#      entry name=profile key="user:{id}"
#      invalidate on=userUpdate

# 4. Compile — works offline, no LLM needed
kern dev kern/ --outdir=app/

# 5. Later — need Vue target
kern evolve backfill cache-layer --target=vue
kern evolve review  # approve the Vue codegen

# 6. Test evolved nodes in CI
kern evolve test

# 7. After 6 months of stability — promote to core
kern evolve promote cache-layer
# → Generates PR adding cache-layer to codegen-core.ts
```

---

## Red-Team Mitigations Summary

| Vulnerability | Severity | Mitigation |
|---|---|---|
| Template injection / RCE | CRITICAL | Eliminated. No eval/templates. Real .ts generators in `vm` sandbox. |
| Supply chain poisoning | CRITICAL | SHA256 hashes, sandboxed execution, audit trail, CODEOWNERS. |
| Template can't handle complexity | HIGH | Eliminated. Single tier: real TS generators. |
| Build-blocking LLM calls | HIGH | Hard offline/online split. Compile never calls LLM. |
| Cost explosion | HIGH | Incremental scan, smart sampling, token budget cap, local LLM option. |
| Parser limitations | HIGH | Parser hints system (positionalArgs, bareWord, multilineBlock). |
| Custom DSL burden | HIGH | Eliminated. Codegen is standard TypeScript. |
| Keyword collision | MEDIUM | Reserved list, graduation-time check, migration command, explicit namespacing. |
| Startup latency | MEDIUM | Pre-compiled .js (not .ts). Cached. Lazy-load option for large sets. |
| No testing | MEDIUM | Golden tests with AST-based diff. `kern evolve test` command. |
| No promotion path | MEDIUM | `kern evolve promote` generates PR to move into core. |
| Weak dedup | LOW | Structural comparison (props + output shape), not just string distance. |
