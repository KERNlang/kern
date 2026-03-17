# Plan: kern review v3 — Security Rules + LLM Auto Pipeline

> "26 real rules + an LLM that actually understands your code > 600 noisy rules"

## The Pitch

kern review: free, zero false positives, runs from `npx`, catches real bugs with 26 AST rules, and sends 5x-compressed code to any LLM for nuanced review. No Java server, no database, no $150/mo.

**Target: TypeScript/React/Vue teams.**

**Consensus from Codex + Gemini + Claude:** Reorder to Security → CI → LLM Auto → Duplicates. Drop dashboard. Cut security rules to 8-10 high-precision (AST-only, no taint analysis needed).

---

## What we have (v2.2)

- 26 AST rules, 5 layers (base, React, Next.js, Vue, Express)
- Import graph resolver with path alias support
- `--llm` with [CHANGED]/[CONTEXT] markers
- `--lint` (ESLint + tsc unified)
- `--graph`, `--batch`, `--diff`
- 496 tests, 0 false positives
- Published: `npm install -g @kernlang/cli`

## What's missing to kill SonarQube

### Phase 1: Security Rules (the #1 ask) — ~3 days

SonarQube's biggest selling point is OWASP security scanning. We need 15-20 security rules, all AST-based.

| Rule | Category | Detection |
|------|----------|-----------|
| `sql-injection` | A03:Injection | Template literal in query without parameterization |
| `xss-unsafe-html` | A03:Injection | `dangerouslySetInnerHTML`, `v-html`, `innerHTML` without sanitization |
| `path-traversal` | A01:Access | `req.params`/`req.query` in `fs.readFile`/`path.join` without validation |
| `command-injection` | A03:Injection | `exec()`/`spawn()` with unsanitized user input |
| `hardcoded-secret` | A02:Crypto | String literals matching API key / password / token patterns |
| `insecure-random` | A02:Crypto | `Math.random()` for security-sensitive operations (tokens, IDs) |
| `open-redirect` | A01:Access | `res.redirect()` with unvalidated user input |
| `prototype-pollution` | A03:Injection | Deep merge / Object.assign with user-controlled keys |
| `nosql-injection` | A03:Injection | MongoDB query with unsanitized `$where`/`$regex` |
| `ssrf` | A10:SSRF | `fetch()`/`axios()` with user-controlled URL |
| `jwt-none-alg` | A02:Crypto | JWT verify without algorithm restriction |
| `cors-wildcard` | A05:Misconfig | `cors({ origin: '*' })` in production |
| `helmet-missing` | A05:Misconfig | Express app without helmet middleware |
| `rate-limit-missing` | A05:Misconfig | Express auth routes without rate limiting |
| `csrf-missing` | A01:Access | State-changing routes without CSRF protection |

**Implementation**: New `packages/review/src/rules/security.ts`, AST-based like all other rules. Active for all targets.

**Files**: `rules/security.ts` (new), `rules/index.ts` (add to all targets), `tests/rules-security.test.ts` (new)

### Phase 2: Direct LLM Integration — ~2 days

`kern review --llm` currently outputs a prompt you copy-paste. Make it call the API directly.

```bash
kern review src/ --graph --auto-llm                    # Call Claude API directly
kern review src/ --graph --auto-llm --provider=openai  # Or OpenAI
kern review src/ --graph --auto-llm --model=claude-sonnet-4-6
```

**Design:**
1. New `packages/review/src/llm-client.ts` — thin wrapper around fetch
2. Reads `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` from env
3. Sends KERN IR prompt (with graph context markers)
4. Parses JSON response via existing `parseLLMResponse()`
5. Merges LLM findings into report with `source: 'llm'`, `confidence: 0.7`
6. Dedup with existing kern/tsc/eslint findings

**Token budget**: Calculate upfront. If graph IR exceeds model context, chunk by file clusters. Warn user of cost estimate before sending.

### Phase 3: CI/CD Integration — ~1 day

```yaml
# .github/workflows/kern-review.yml
name: kern review
on: [pull_request]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: KERNlang/kern-review-action@v1
        with:
          diff-base: origin/main
          graph: true
          enforce: true
          min-coverage: 80
          # Optional: auto-llm with API key
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

**Implementation:**
1. `action.yml` in new repo `KERNlang/kern-review-action`
2. Runs `kern review --diff origin/$base --graph --enforce --min-coverage=$min`
3. Posts findings as PR comments (GitHub API)
4. Fails check if enforcement fails
5. Optional: `--auto-llm` for AI-enhanced review on PRs

### Phase 4: Duplicate Code Detection — ~2 days

SonarQube's clone detector finds copy-paste code. We can do better with KERN IR — if two blocks produce the same IR, they're structural duplicates even if surface syntax differs.

```bash
kern review src/ --duplicates     # Find structural clones
```

**Algorithm:**
1. For each function/handler, compute KERN IR hash (ignoring names)
2. Group by hash → duplicates
3. Report: "Function X in file A is structurally identical to function Y in file B"
4. Suggest: extract to shared module

### Phase 5: Trend Dashboard (v3.1) — ~1 week

SonarQube's killer feature is the web dashboard showing trends. We can do a lightweight version:

```bash
kern review src/ --report=json >> .kern/history.jsonl    # Append to local history
kern dashboard                                            # Open local web view
```

- JSONL history file (one JSON report per line, timestamped)
- `kern dashboard` serves a single-page app showing trends
- Coverage %, findings over time, top recurring rules
- No server, no database — just a local file + static HTML

---

## Implementation Order

| Phase | What | Days | Impact |
|-------|------|------|--------|
| **1** | Security rules (15-20 OWASP rules) | 3 | Removes #1 reason teams pick SonarQube |
| **2** | Direct LLM integration (`--auto-llm`) | 2 | Makes us strictly better than raw LLM review |
| **3** | GitHub Action | 1 | CI/CD = adoption |
| **4** | Duplicate detection | 2 | Closes last major feature gap |
| **5** | Trend dashboard | 5 | Nice-to-have, not blocker |

**Total: ~2 weeks to feature-complete SonarQube killer for TypeScript.**

---

## The Comparison After v3

| | SonarQube | kern review v3 |
|---|---|---|
| Rules | ~600 (30-50% noise) | ~45 (0% noise) + LLM |
| Security | OWASP top 10 | OWASP top 10 (AST-based) |
| Setup | Java server + DB + CI | `npm install -g @kernlang/cli` |
| CI/CD | Plugin per platform | GitHub Action (1 yaml) |
| LLM integration | No | Direct API call with 5x compression |
| Import graph | Yes | Yes (with path aliases) |
| Duplicate detection | Yes (token-based) | Yes (structural via IR) |
| False positives | 30-50% | ~0% |
| Languages | 30+ | TypeScript (enough for most web teams) |
| Price | $150+/mo | Free (AGPL) |
| Dashboard | Web app (requires server) | Local file + static HTML |

---

## Test Strategy

### Our repos:
- **audiofacets** — Electron + React + Zustand (medium, real hooks/stores)
- **audiofacets_backend** — Express/Node (API routes, middleware)

### Open-source benchmarks:
- **excalidraw** (119k stars) — React, canvas, massive hooks
- **cal.com** (35k stars) — Next.js monorepo, tRPC
- **element-plus** (27k stars) — Vue 3 component library
- **nocodb** (50k stars) — Vue 3 + Nuxt real app

### Metrics to track:
- False positive rate (target: <2%)
- Time per 100 files (target: <30s)
- Memory usage (target: <500MB)
- Security findings vs SonarQube on same codebase (parity check)
