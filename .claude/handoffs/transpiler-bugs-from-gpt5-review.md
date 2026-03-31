# Handoff: Fix MCP Transpiler Bugs Found by GPT-5.4 Pro Review

## Context

A rate limit MCP server was generated from .kern source via KERN Sight MCP's AI builder, then compiled with `transpileMCP()`. GPT-5.4 Pro reviewed the compiled TypeScript output and found **3 hard correctness bugs** and **2 design issues** — all in the transpiler, not in the .kern source.

The .kern source was clean. The bugs are introduced during `transpileMCP()` compilation.

---

## Bug 1: `args` vs `input` — Variable Name Mismatch (CRITICAL)

**File:** `packages/mcp/src/transpiler-mcp.ts`

**Problem:** The transpiler generates tool callbacks as `async (input) => {` but handler code from .kern references `args`. The handler code is pasted verbatim from the .kern `handler <<<>>>` block, which documents `args` as the way to access validated params.

**Result:** Every tool handler throws `ReferenceError: args is not defined` at runtime.

**Fix:** Either:
- (A) Rename the callback parameter from `input` to `args`, or
- (B) Add `const args = input;` at the top of every tool callback body, before the handler code

Option (A) is cleaner.

---

## Bug 2: Dead Sanitization — Guards Don't Flow Into Handler (CRITICAL)

**File:** `packages/mcp/src/transpiler-mcp.ts`

**Problem:** The transpiler generates:
```typescript
const params = { ...input } as Record<string, unknown>;
params["key"] = sanitizeValue(params["key"], "[^\\w./ -]", "");
// ... then handler code uses args.key (unsanitized original)
```

The sanitized `params` object is never used by the handler. The handler accesses `args` (or `input`) directly, completely bypassing all guard sanitization.

**Result:** `guard type=sanitize` is dead code. No input is actually sanitized despite the guard being declared.

**Fix:** After applying all guards to `params`, the transpiler must either:
- (A) Pass `params` as the handler's `args`, or
- (B) Reassign: `const args = params;` after guard processing

This is closely related to Bug 1 — fixing both together: process guards on `input` → produce `args` → handler uses `args`.

---

## Bug 3: Boolean Default as String

**File:** `packages/mcp/src/transpiler-mcp.ts`

**Problem:** `param name=resetAll type=boolean default=false` in .kern produces:
```typescript
z.boolean().default("false")  // string, not boolean
```

**Result:** Zod schema is wrong — `"false"` is a truthy string, so the default is effectively `true`.

**Fix:** In the transpiler's schema generation, detect `type=boolean` and emit `default(false)` / `default(true)` as boolean literals, not strings.

---

## Design Issue 4: `globalThis.__rlStore ??= {}` — Prototype Pollution Risk

**File:** `packages/mcp/src/transpiler-mcp.ts` (handler scaffolding)

**Problem:** This is in the handler code written by the AI, not the transpiler. But the transpiler's `normalizeToolResult` and scaffolding functions encourage plain objects. User-controlled keys on plain objects can collide with `__proto__`, `constructor`, etc.

**Recommendation:** The transpiler's generated scaffolding could include a `Map`-based store utility instead of bare objects when it detects state management patterns. Low priority — this is handler-level, not transpiler-level.

---

## Design Issue 5: Unnecessary IIFE Wrapping

**File:** `packages/mcp/src/transpiler-mcp.ts`

**Problem:** Every handler is wrapped in:
```typescript
const result = await (async () => {
  // handler code
})();
```

This adds an unnecessary closure. The handler is already inside an async callback.

**Fix:** Emit the handler code directly in the tool callback body, without the IIFE wrapper.

---

## Impact on KERN Sight MCP Security Scanner

**This is worse than just a transpiler bug — it makes the security review unreliable.**

`@kernlang/review-mcp`'s `reviewMCPSource()` does pattern matching. It sees `sanitizeValue()` calls in the compiled output and marks the tool as guarded. But the sanitization is dead code (applied to `params`, handler uses `args`).

Result:
- **Security score is inflated** — shows guards that don't work
- **IR nodes show GUARDED** when the tool is actually unguarded
- **KERN Sight MCP auto-review after compile gives false confidence**

Fixing Bug 1 + Bug 2 in the transpiler fixes this automatically — once `args` actually contains the sanitized values, the guards are real and the scanner's assessment becomes correct.

Until fixed: the scanner's pattern matching is technically correct (guards exist in code), but the guards are functionally dead. Consider adding a data-flow check to `review-mcp` that verifies guard output flows into the handler — but that's a bigger change. The transpiler fix is the right first move.

---

## Priority Order

1. **Bug 1 + Bug 2** (fix together) — args/input mismatch + dead sanitization. This makes every compiled MCP server broken at runtime AND insecure.
2. **Bug 3** — boolean default. Silent logic error.
3. **Issue 5** — IIFE removal. Code quality.
4. **Issue 4** — Store pattern. Nice-to-have.

## Relevant Test Files

- `packages/mcp/src/__tests__/transpiler-mcp.test.ts` — 25 tests
- Run: `cd packages/mcp && npx jest`

## How to Reproduce

```kern
mcp name=Test version=1.0

  tool name=hello
    description text="Say hello"
    param name=name type=string required=true
    param name=active type=boolean default=false
    guard type=sanitize param=name
    handler <<<
      return { content: [{ type: "text", text: `Hello ${args.name}, active=${args.active}` }] };
    >>>
```

Compile with `transpileMCP(parse(source))` and check:
1. Does the callback param match what handler code references? (Bug 1)
2. Is `sanitizeValue()` result actually used by the handler? (Bug 2)
3. Is the boolean default `false` or `"false"`? (Bug 3)
