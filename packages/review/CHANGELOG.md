# @kernlang/review

## 3.5.0

### Bug Fixes — false-positive carve-outs (RULE-FEEDBACK.md batch)

Precision tuning against false positives surfaced by Kern Sight v0.7.7
against the interdiscount-next codebase. Each carve-out is paired with a
"still-fires-on-bad-code" regression test so the genuine-bad detectors
remain intact.

- **`unrecovered-effect`** — drop Web API `.get()` from the network
  classifier. `request.headers.get(...)`, `url.searchParams.get(...)`,
  `req.cookies.get(...)` are synchronous Web API accessors and no longer
  emit a network effect (effect extractor denylist on objName ending in
  `.headers` / `.cookies` / `.searchParams` / `.params` / `.body` /
  `.query`). RULE-FEEDBACK #3.
- **`unhandled-async`** — skip Next.js App Router React Server Components
  (`isReactServerComponent` helper: file matches `(src/)app/**/*.tsx` not
  `route.{ts,tsx}`, no `'use client'`, async fn returning JSX, default-or-
  PascalCase exported). RSCs route rejections to `error.tsx`. Route
  handlers still fire but the message is reworded to point at observability
  (uncaught becomes a 500 with no log). RULE-FEEDBACK #1, #4.
- **`taint-redirect`** — recognise constant-folded `new URL("/literal",
  tainted)` as a fixed same-origin redirect. URL constructor discards
  `base.pathname` when the first arg starts with `/`. Template literals
  and non-literal first args still fire. RULE-FEEDBACK #2.
- **`hydration-mismatch`** — require at least one JSX element in the file,
  skip when the unstable expression is gated by `__IS_SERVER` / `__IS_CLIENT`
  / `typeof window` ternary, skip when inside a `Logger` / `metrics` /
  `telemetry` / `tracer` / `span` call. Tightening lives in the rule, not
  the shared `isReactFile` helper. RULE-FEEDBACK #5.
- **`unrecovered-effect`** (transport primitives) — skip when the file is
  `request.ts` / `fetch.ts` / `http.ts` / `api-client.ts` AND the
  container has a `throw`. Per Evil Twin Challenge 1, scoped narrowly
  (filename + throw) rather than the global "any throw counts" rule.
  Native rule respected via parallel filter in `index.ts`.
  RULE-FEEDBACK #7.
- **`unguarded-effect`** — recognise header-builder calls
  (`build*Headers` / `with*Auth` / `signRequest` / `attachAuth` /
  `getAuthHeaders`) as satisfied auth guards. Token-arg detection
  (`accessToken` / `authToken` / `apiKey` / `credentials` / `bearer`) is
  a confidence boost ON header-builder matches, not a standalone signal
  (Codex review caught the standalone case suppressing unrelated DB
  writes after `hash(accessToken)`). Both the TS concept rule and the
  parallel `.kern` native rule consume the new guards. RULE-FEEDBACK #6.
- **`unguarded-effect`** (auth endpoints) — skip narrow RFC-defined auth
  paths (`/oauth/token`, `/auth/login`, `/auth/signin`,
  `/.well-known/openid-configuration`, `/.well-known/jwks.json`). The
  broad substring set (`/refresh`, `/session`, bare `/login`) was
  dropped per Evil Twin Challenge 4. The previously-shipped
  `{ context: "auth" }` author marker was also dropped per Codex review
  — emitting it as a container-wide guard suppressed unrelated effects
  in the same function (`log('x', {context:'auth'}); await db.update(...)`).
  Dynamic-URL auth flows remain a documented gap. RULE-FEEDBACK #8.

#### Buddy-review follow-ups (Codex + Gemini)

- Effect-extractor Web API denylist narrowed from
  `{.headers, .cookies, .searchParams, .params, .body, .query}` to
  `{.headers, .cookies, .searchParams}` only — `.params` / `.body` /
  `.query` were over-broad and would silently drop network effects on
  tRPC / GraphQL sub-namespaces like `client.query.get(...)`.
- `hydrationMismatch` server-gate ternary detection now handles
  multi-line ternaries (walks back through the lookback window for the
  most recent `?` not inside `?.` or `??`).
- `hydrationMismatch` telemetry-call detection now tracks paren depth
  from each `Logger.x(` opening instead of comparing total opens vs
  closes — fixes spill-over where a closed `Logger.info(...)` could
  silence an adjacent unrelated `Date.now()` on the same line.
- Auth-endpoint post-filter in `index.ts` matches effect nodes by
  file+line+col rather than file+line — two effects on one source line
  no longer cross-suppress.

## Unreleased

### Features

- 08147cd: **Wire parseWithDiagnostics into review pipeline** — `.kern` files now get structured parse diagnostics as review findings
  - Parse errors surfaced as warnings by default (prevents CI breakage on WIP files)
  - `hasParseErrors` flag skips structural lint on partial ASTs to prevent cascading false positives
- **`--strict-parse` flag** — opt-in to preserve parse error severity as `'error'` for strict CI enforcement
  - New `strictParse?: boolean` in `ReviewConfig`

### Bug Fixes

- Removed unused imports: `resolve`, `flattenIR` (confidence.ts, ground-layer.ts), `IRNode` (differ.ts), `SyntaxKind` (template-detector.ts)

### Dependencies

- @kernlang/core (parseWithDiagnostics, ParseDiagnostic)

## 3.0.0

### Major Changes

- 2523ee7: KERN 3.0 — security hardening, self-review clean, 68+ review rules

  - **kern review**: 76+ rules across 10 layers — base, React, Next.js, Vue, Express, security (v1-v4), dead logic, null safety, concept rules, taint tracking
  - **OWASP LLM01**: 10 prompt injection detection rules — indirect injection, output execution, system prompt leakage, RAG poisoning, tool manipulation
  - **Taint tracking**: source-to-sink analysis on KERN IR with cross-file tracking
  - **Suppression engine**: `// kern-ignore` and `// kern-ignore-next-line` directives
  - **Self-review clean**: 148 files pass kern review — command injection fixed, regex-dos hardened, null safety guards, error handling improved
  - **Evolve v4**: 13 commands, target-specific codegen, interactive review
  - **Transpilers**: `'use client'` auto-detection for generated components with event handlers
  - **Code quality**: bounded regex quantifiers, sanitized exec inputs, LLM output validation

### Patch Changes

- Updated dependencies [2523ee7]
  - @kernlang/core@3.0.0
