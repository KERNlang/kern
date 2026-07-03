#!/usr/bin/env node
/**
 * Differential-execution conformance harness for KERN portable expressions.
 *
 * The clean-rate metric (`lift-rate-python.mjs`) is *semantically blind*: it
 * only checks `ast.parse` + marker absence, so a lowering like `{**body}` on a
 * Pydantic model passes the metric yet raises `TypeError` at runtime. This
 * harness closes that blind spot.
 *
 * For each fixture we take ONE portable JS expression (the thing that would
 * sit inside `{{ }}` in a `derive`/`respond`), lower it to BOTH targets, run
 * each under its real interpreter against equivalent mock bindings, and assert
 * the two results agree with each other and with `expected`.
 *
 *   Express target  → near-native JS  → treated as the REFERENCE semantics.
 *   FastAPI target   → Python lowering → MUST reproduce the reference result.
 *
 * A divergence means the Python lowering is wrong even if it parses. Exit code
 * is non-zero on any failure so this doubles as a forge fitness command.
 *
 * SCOPE — this verifies EXPRESSION-LOWERING parity in isolation, not full-route
 * wiring. Route-signature concerns (FastAPI snake-casing a `query.userId` param
 * to `user_id`, injecting `request: Request` for header access) are an
 * integration tier this harness does not cover. To avoid silently false-passing
 * those, fixtures may only use snake-safe param/query keys — a camelCase key is
 * rejected as out-of-scope rather than run (see the runner guard below).
 *
 * Run:  node scripts/conformance.mjs            (all fixtures)
 *       node scripts/conformance.mjs --filter spread
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const { rewriteExpr } = await import(join(REPO, 'packages/python/dist/core/expr/index.js'));
const { rewriteExpressExpr } = await import(join(REPO, 'packages/express/dist/express-portable.js'));
const { toSnakeCase } = await import(join(REPO, 'packages/python/dist/type-map.js'));
// Statement-level (kind:'stmt') fixtures lower a native `lang=kern` handler BODY via these,
// run it in an isolated subprocess (TS via --experimental-strip-types), and compare the
// RETURNED value — capturing control-flow behaviour the expression harness cannot reach.
const {
  parse,
  emitNativeKernBodyTSWithImports,
  generateCoreNode,
  detectKernStdlibUsage,
  emittedCodeUsesLooseEq,
  kernStdlibPreamble,
} = await import(join(REPO, 'packages/core/dist/index.js'));
const { emitNativeKernBodyPythonWithImports } = await import(join(REPO, 'packages/python/dist/codegen-body-python.js'));
// Whole-file (kind:'whole-file') + compile-reject (kind:'compile-reject') fixtures compile a FULL
// multi-declaration .kern module via the SAME entry class-conformance.mjs uses (`generateCoreNode`
// per top node → TS module; `generatePythonCoreNode` per top node → Python module). whole-file
// runs both and compares the probe() result; compile-reject asserts the source is rejected with a
// specific reason at every layer that rejects (parse / TS codegen / Python codegen).
const { generatePythonCoreNode } = await import(join(REPO, 'packages/python/dist/codegen-python.js'));
const tsCompiler = await import('typescript');
// Route-level (kind:'route') fixtures lower a full portable route HANDLER to both targets and
// compare the {status, body} HTTP response — covering guard/respond error-shape parity (#3).
const { generatePortableHandlerExpress } = await import(join(REPO, 'packages/express/dist/express-portable.js'));
const { generatePortableHandlerFastAPI } = await import(join(REPO, 'packages/python/dist/fastapi-portable.js'));
// Pipeline-parity (kind:'route-pipeline') fixtures lower a route through the PURE
// framework-agnostic Python pipeline (`emitPureHandlers` → `def handler(request: dict)` →
// returns `(status, body[, headers])` tuple, NO HTTPException). Each fixture invokes the pure
// handler directly with a hand-built PureRequest and compares {status, body} to expected —
// Wave 3 acceptance for the python-decouple split (phase 2 emitted handlers; this proves they
// run end-to-end on the route corpus). Route-bearing fixtures with `kind:'route'` are also
// dual-routed through the pure path below for behavioral parity to the monolithic transpiler.
const { emitPureHandlers } = await import(join(REPO, 'packages/python/dist/core/handlers/index.js'));
// Single source of truth for the __DotDict shim — imported from the compiled python target
// (Wave 3 round-3 agon-review finding D: kimi/claude/zai all flagged the byte-for-byte
// duplication risk with no CI guard). The conformance harness now uses the EXACT bytes
// production emits, so a future shim edit can't drift between the two.
const { DOT_DICT_SHIM_PY } = await import(join(REPO, 'packages/python/dist/targets/python.js'));

// ── Fixtures ───────────────────────────────────────────────────────────────
// bindings namespaces mirror the portable request model:
//   params  — path params  (Python: bare locals · Express: req.params)
//   query   — query params  (Python: bare locals · Express: req.query)
//   body    — Pydantic-like model (snake attrs + .model_dump(), NOT a mapping)
//   headers — request.headers
//   user    — decoded auth payload (a dict)
// compare: 'value' (deep equality, default) | 'shape' (types only — for
// nondeterministic outputs like uuid / timestamps).
const FIXTURES = [
  {
    name: 'object-literal + strict-eq + template literal',
    expr: '{ ok: query.count === 0, label: `count is ${query.count}` }',
    path: '/api/eq',
    bindings: { query: { count: 0 } },
    expected: { ok: true, label: 'count is 0' },
  },
  {
    name: 'path param in template literal',
    expr: '`Item ${params.id}`',
    path: '/api/item/:id',
    bindings: { params: { id: 'abc' } },
    expected: 'Item abc',
  },
  {
    name: 'js literals null/true/false',
    // NB: `undefined` is intentionally excluded — JSON.stringify drops
    // undefined-valued keys, which Python's None cannot mirror; that quirk is
    // a JS-ism, not a portable lowering target.
    expr: '{ a: null, c: true, d: false }',
    path: '/api/lits',
    bindings: {},
    expected: { a: null, c: true, d: false },
  },
  {
    name: 'single-word body field access',
    expr: '{ name: body.name }',
    path: '/api/echo',
    bindings: { body: { name: 'widget' } },
    expected: { name: 'widget' },
  },
  {
    name: 'header access',
    expr: '{ token: headers.token }',
    path: '/api/hdr',
    bindings: { headers: { token: 'sekret' } },
    expected: { token: 'sekret' },
  },
  {
    name: 'auth user field access (user["x"] dict lowering)',
    expr: '{ sub: user.sub }',
    path: '/api/me',
    authUser: true,
    bindings: { user: { sub: 'user-42' } },
    expected: { sub: 'user-42' },
  },
  {
    name: 'object spread of a plain dict',
    expr: '{ ...user, extra: 1 }',
    path: '/api/spread-obj',
    authUser: true,
    bindings: { user: { a: 1, b: 2 } },
    expected: { a: 1, b: 2, extra: 1 },
  },
  {
    name: 'object spread of a Pydantic body (must use model_dump)',
    // The trap: a naive {**body} raises TypeError because a Pydantic model is
    // not a mapping. Single-word field keeps snake==camel so the wire shape
    // matches Express.
    expr: '{ ...body, id: 1 }',
    path: '/api/spread-body',
    bindings: { body: { name: 'widget' } },
    expected: { name: 'widget', id: 1 },
  },
  {
    name: 'array spread with a member operand',
    expr: '[...user.roles, "x"]',
    path: '/api/spread-arr',
    authUser: true,
    bindings: { user: { roles: ['a', 'b'] } },
    expected: ['a', 'b', 'x'],
  },
  {
    // External `validate schema=X`: body IS a Pydantic model but its field
    // names are unknown to the rewriter (bodyFields empty). model_dump() must
    // still fire — this is the starter POST /items case.
    name: 'object spread of body with an external schema (unknown fields)',
    expr: '{ ...body, id: 1 }',
    path: '/api/spread-ext',
    externalSchema: true,
    bindings: { body: { name: 'widget' } },
    expected: { name: 'widget', id: 1 },
  },
  {
    // Whitespace after the spread operator is valid JS and must still lower
    // correctly on both targets (Codex review of a1465d70).
    name: 'object spread with whitespace after the operator',
    expr: '{ ... body, id: 1 }',
    path: '/api/spread-ws',
    externalSchema: true,
    bindings: { body: { name: 'widget' } },
    expected: { name: 'widget', id: 1 },
  },
  {
    // Shorthand props are only portable for in-scope locals (Express keeps the
    // `{x}` shorthand, which requires `x` bound; Python expands to `x: x`).
    name: 'object shorthand props expand for locals',
    expr: '{ a, b, total: 100 }',
    path: '/api/short',
    bindings: { locals: { a: 1, b: 'two' } },
    expected: { a: 1, b: 'two', total: 100 },
  },
  {
    name: 'Array.from length+index arrow → comprehension',
    expr: 'Array.from({ length: 3 }, (_, i) => i * 2)',
    path: '/api/range',
    bindings: {},
    expected: [0, 2, 4],
  },
  {
    // Shorthand length object `{ length }` must be expanded before Array.from
    // lowering recognises the `length:` property (codex review of d75a9d05).
    name: 'Array.from with a shorthand length object',
    expr: 'Array.from({ length }, (_, i) => i)',
    path: '/api/shortlen',
    bindings: { locals: { length: 3 } },
    expected: [0, 1, 2],
  },
  {
    name: 'Array.from producing objects with a query param length',
    expr: 'Array.from({ length: query.n }, (_, i) => ({ idx: i, base: query.n }))',
    path: '/api/grid',
    bindings: { query: { n: 2 } },
    expected: [
      { idx: 0, base: 2 },
      { idx: 1, base: 2 },
    ],
  },
  {
    name: 'Array.from with a template-literal body',
    expr: 'Array.from({ length: 2 }, (_, i) => `item-${i + 1}`)',
    path: '/api/labels',
    bindings: {},
    expected: ['item-1', 'item-2'],
  },
  {
    name: 'nested Array.from lowers recursively',
    expr: 'Array.from({ length: 2 }, (_, i) => Array.from({ length: 2 }, (_, j) => i * 2 + j))',
    path: '/api/matrix',
    bindings: {},
    expected: [
      [0, 1],
      [2, 3],
    ],
  },
  {
    name: 'crypto.randomUUID is a string on both targets',
    expr: '{ id: crypto.randomUUID() }',
    path: '/api/id',
    bindings: {},
    compare: 'shape',
    expected: { id: 'string' },
  },
  {
    name: 'new Date().toISOString() is a string on both targets',
    expr: '{ at: new Date().toISOString() }',
    path: '/api/now',
    bindings: {},
    compare: 'shape',
    expected: { at: 'string' },
  },

  // ── Host-builtin runtime parity (backfilled verification for goal tasks
  // 01/04/05/06). These RUN the lowered expr on both targets and assert
  // agreement — the differential proof the codegen-string tests don't give.
  // Trap cases are first-class: JS↔Python divergences hide here.

  // Task 01 — Math arithmetic. Math.round is the headline trap: JS rounds half
  // UP (Math.round(2.5)===3, Math.round(-2.5)===-2); Python round() is banker's.
  { name: 'Math.round(2.5) half-up (banker trap)', expr: 'Math.round(x)', path: '/api/m', bindings: { locals: { x: 2.5 } }, expected: 3 },
  { name: 'Math.round(-2.5) half-up toward +inf', expr: 'Math.round(x)', path: '/api/m', bindings: { locals: { x: -2.5 } }, expected: -2 },
  { name: 'Math.floor(-2.5)', expr: 'Math.floor(x)', path: '/api/m', bindings: { locals: { x: -2.5 } }, expected: -3 },
  { name: 'Math.ceil(-2.5)', expr: 'Math.ceil(x)', path: '/api/m', bindings: { locals: { x: -2.5 } }, expected: -2 },
  { name: 'Math.trunc(-3.7) (truncate toward zero)', expr: 'Math.trunc(x)', path: '/api/m', bindings: { locals: { x: -3.7 } }, expected: -3 },
  { name: 'Math.abs(-5)', expr: 'Math.abs(x)', path: '/api/m', bindings: { locals: { x: -5 } }, expected: 5 },

  // Task 04 — String case / test.
  { name: 'String toUpperCase', expr: 's.toUpperCase()', path: '/api/s', bindings: { locals: { s: 'HeLLo' } }, expected: 'HELLO' },
  { name: 'String toLowerCase', expr: 's.toLowerCase()', path: '/api/s', bindings: { locals: { s: 'HeLLo' } }, expected: 'hello' },
  { name: 'String trim', expr: 's.trim()', path: '/api/s', bindings: { locals: { s: '  hi  ' } }, expected: 'hi' },
  { name: 'String startsWith true', expr: 's.startsWith(p)', path: '/api/s', bindings: { locals: { s: 'abcdef', p: 'abc' } }, expected: true },
  { name: 'String startsWith false', expr: 's.startsWith(p)', path: '/api/s', bindings: { locals: { s: 'abcdef', p: 'xyz' } }, expected: false },

  // Task 05 — String transform. .replace is the trap: JS replaces only the
  // FIRST occurrence of a string arg; Python str.replace replaces ALL.
  { name: 'String replace first-only (banana trap)', expr: 's.replace(a, b)', path: '/api/s', bindings: { locals: { s: 'banana', a: 'a', b: 'X' } }, expected: 'bXnana' },
  { name: 'String split', expr: 's.split(sep)', path: '/api/s', bindings: { locals: { s: 'a,b,c', sep: ',' } }, expected: ['a', 'b', 'c'] },

  // Task 06 — Object / Array static + Date.
  { name: 'Object.keys', expr: 'Object.keys(o)', path: '/api/o', bindings: { locals: { o: { a: 1, b: 2 } } }, expected: ['a', 'b'] },
  { name: 'Object.values', expr: 'Object.values(o)', path: '/api/o', bindings: { locals: { o: { a: 1, b: 2 } } }, expected: [1, 2] },
  { name: 'Object.entries', expr: 'Object.entries(o)', path: '/api/o', bindings: { locals: { o: { a: 1 } } }, expected: [['a', 1]] },
  { name: 'Array.isArray true', expr: 'Array.isArray(v)', path: '/api/a', bindings: { locals: { v: [1, 2] } }, expected: true },
  { name: 'Array.isArray false', expr: 'Array.isArray(v)', path: '/api/a', bindings: { locals: { v: 'x' } }, expected: false },
  { name: 'Date.now is an int on both targets', expr: 'Date.now()', path: '/api/d', bindings: {}, compare: 'shape', expected: 0 },

  // Task 02 — Math aggregate/power. The arity traps the review fought over:
  // JS Math.max(x) with ONE arg returns x; Python max(x) treats a lone arg as
  // an iterable and raises TypeError — so the 1-arg form must NOT emit max()/min().
  { name: 'Math.max 3-arg', expr: 'Math.max(a, b, c)', path: '/api/m', bindings: { locals: { a: 3, b: 9, c: 5 } }, expected: 9 },
  { name: 'Math.min 2-arg', expr: 'Math.min(a, b)', path: '/api/m', bindings: { locals: { a: 3, b: 9 } }, expected: 3 },
  { name: 'Math.max 1-arg returns the value (not max(x))', expr: 'Math.max(a)', path: '/api/m', bindings: { locals: { a: 7 } }, expected: 7 },
  { name: 'Math.min 1-arg returns the value (not min(x))', expr: 'Math.min(a)', path: '/api/m', bindings: { locals: { a: 7 } }, expected: 7 },
  { name: 'Math.max with a nested call arg', expr: 'Math.max(a, Math.abs(b))', path: '/api/m', bindings: { locals: { a: 2, b: -10 } }, expected: 10 },
  { name: 'Math.pow(2,10)', expr: 'Math.pow(a, b)', path: '/api/m', bindings: { locals: { a: 2, b: 10 } }, expected: 1024 },
  { name: 'Math.sqrt(16)', expr: 'Math.sqrt(a)', path: '/api/m', bindings: { locals: { a: 16 } }, expected: 4 },
  { name: 'Math.hypot(3,4)', expr: 'Math.hypot(a, b)', path: '/api/m', bindings: { locals: { a: 3, b: 4 } }, expected: 5 },
  { name: 'Math.random is a number on both targets', expr: 'Math.random()', path: '/api/m', bindings: {}, compare: 'shape', expected: 0 },

  // Task 03 — Number / parse / format (FORGE TARGET: these fail until 03 lands).
  // Non-whole values for parse* avoid the JS-int vs Python-float JSON artifact
  // (a serialization quirk, not a lowering bug). toFixed must return a STRING.
  { name: 'parseInt base-10', expr: 'parseInt(s)', path: '/api/n', bindings: { locals: { s: '42' } }, expected: 42 },
  { name: 'parseInt explicit radix 10', expr: 'parseInt(s, 10)', path: '/api/n', bindings: { locals: { s: '42' } }, expected: 42 },
  { name: 'parseFloat', expr: 'parseFloat(s)', path: '/api/n', bindings: { locals: { s: '3.14' } }, expected: 3.14 },
  { name: 'toFixed returns a STRING', expr: 'n.toFixed(2)', path: '/api/n', bindings: { locals: { n: 3.14159 } }, expected: '3.14' },
  // Judge finding: a bracket-access receiver puts a `"` inside the lowered
  // f-string. Nested same-quote f-strings are a SyntaxError on CPython <3.12
  // (local python3 is 3.9), so a quote-safe lowering is mandatory.
  { name: 'toFixed on a bracket-access receiver (quote-safe)', expr: 'data["price"].toFixed(2)', path: '/api/n', bindings: { locals: { data: { price: 3.14159 } } }, expected: '3.14' },
  { name: 'Number.isInteger true', expr: 'Number.isInteger(a)', path: '/api/n', bindings: { locals: { a: 5 } }, expected: true },
  { name: 'Number.isInteger false', expr: 'Number.isInteger(a)', path: '/api/n', bindings: { locals: { a: 5.5 } }, expected: false },

  // ──────────────────────────────────────────────────────────────────────────
  // BACKFILL ORACLE (goal: conformance-backfill, 2026-05-26). These RED fixtures
  // encode bugs the differential harness caught that codegen-string tests masked.
  // Each slice (arr-core / arr-method / str-method) is a goal task; the task gate
  // is `node scripts/conformance.mjs --filter "<slice>:"`. Element bindings are
  // DICTS (json.loads) — the real shape of inline-schema/fetch/literal arrays —
  // so attribute access `x.field` MUST lower to subscript `x["field"]`.
  // ──────────────────────────────────────────────────────────────────────────

  // ── arr-core: filter/map/find on DICT elements + arrow-shape robustness ──
  // BUG: lowerJsArrayMethods emits `[x.field for x in ...]` (attribute access),
  // which raises AttributeError on dict elements. Must emit `x["field"]`.
  { name: 'arr-core: filter on a dict field', expr: 'items.filter((x) => x.active)', path: '/api/a', bindings: { locals: { items: [{ active: true, n: 1 }, { active: false, n: 2 }] } }, expected: [{ active: true, n: 1 }] },
  { name: 'arr-core: map a dict field', expr: 'items.map((x) => x.n)', path: '/api/a', bindings: { locals: { items: [{ active: true, n: 1 }, { active: false, n: 2 }] } }, expected: [1, 2] },
  { name: 'arr-core: find on a dict field', expr: 'items.find((x) => x.n === 2)', path: '/api/a', bindings: { locals: { items: [{ active: true, n: 1 }, { active: false, n: 2 }] } }, expected: { active: false, n: 2 } },
  { name: 'arr-core: chained filter then map (dict fields)', expr: 'items.filter((x) => x.active).map((x) => x.n)', path: '/api/a', bindings: { locals: { items: [{ active: true, n: 1 }, { active: false, n: 2 }] } }, expected: [1] },
  { name: 'arr-core: map a nested dict field x.meta.tag', expr: 'items.map((x) => x.meta.tag)', path: '/api/a', bindings: { locals: { items: [{ meta: { tag: 'a' } }, { meta: { tag: 'b' } }] } }, expected: ['a', 'b'] },
  // arrow-shape robustness: index param, element+index, bare (unparenthesized)
  // param, and a 2-level-nested arrow body combined with member access.
  { name: 'arr-core: map with an index param (x, i) => i', expr: 'items.map((x, i) => i)', path: '/api/a', bindings: { locals: { items: [{ n: 1 }, { n: 2 }] } }, expected: [0, 1] },
  { name: 'arr-core: map element + index (dict field + i)', expr: 'items.map((x, i) => x.n + i)', path: '/api/a', bindings: { locals: { items: [{ n: 10 }, { n: 20 }] } }, expected: [10, 21] },
  { name: 'arr-core: filter with a bare (unparenthesized) param', expr: 'items.filter(x => x.active)', path: '/api/a', bindings: { locals: { items: [{ active: true, n: 1 }, { active: false, n: 2 }] } }, expected: [{ active: true, n: 1 }] },
  { name: 'arr-core: map with a 2-level nested body + member access', expr: 'items.map((x) => Math.max(x.n, 0))', path: '/api/a', bindings: { locals: { items: [{ n: -1 }, { n: 5 }] } }, expected: [0, 5] },

  // ── arr-method: array methods NOT yet lowered → AttributeError on Python ──
  // includes/indexOf/slice work for both str+array via `in`/slicing; indexOf on a
  // MISSING element must yield -1 (JS), not raise (Python list.index raises).
  { name: 'arr-method: includes true', expr: 'nums.includes(2)', path: '/api/a', bindings: { locals: { nums: [1, 2, 3] } }, expected: true },
  { name: 'arr-method: includes false', expr: 'nums.includes(9)', path: '/api/a', bindings: { locals: { nums: [1, 2, 3] } }, expected: false },
  { name: 'arr-method: join coerces to strings', expr: 'nums.join(",")', path: '/api/a', bindings: { locals: { nums: [1, 2, 3] } }, expected: '1,2,3' },
  { name: 'arr-method: slice(0, 2)', expr: 'nums.slice(0, 2)', path: '/api/a', bindings: { locals: { nums: [1, 2, 3] } }, expected: [1, 2] },
  { name: 'arr-method: slice(-2) negative start', expr: 'nums.slice(-2)', path: '/api/a', bindings: { locals: { nums: [1, 2, 3] } }, expected: [2, 3] },
  { name: 'arr-method: indexOf present', expr: 'nums.indexOf(2)', path: '/api/a', bindings: { locals: { nums: [1, 2, 3] } }, expected: 1 },
  { name: 'arr-method: indexOf missing is -1 (not raise)', expr: 'nums.indexOf(9)', path: '/api/a', bindings: { locals: { nums: [1, 2, 3] } }, expected: -1 },
  { name: 'arr-method: some (scalar predicate)', expr: 'nums.some((n) => n === 2)', path: '/api/a', bindings: { locals: { nums: [1, 2, 3] } }, expected: true },
  { name: 'arr-method: every (scalar predicate)', expr: 'nums.every((n) => n > 0)', path: '/api/a', bindings: { locals: { nums: [1, 2, 3] } }, expected: true },
  // RT1/RT2 (route truthiness): a filter/every predicate that yields a JS-truthy
  // empty container ([] / {}) must be KEPT (JS truthy) — a bare `if pred` lowering
  // drops it (Python treats [] / {} as falsy). The wrapped `if js_truthy(pred)`
  // restores parity. RED at base: RT1 gives [], RT2 gives false.
  { name: 'RT1: filter predicate returning [] is JS-truthy (kept)', expr: '[1, 2, 3].filter((x) => [])', path: '/api/a', bindings: {}, expected: [1, 2, 3] },
  { name: 'RT2: every predicate over [] elements is JS-truthy (all true)', expr: '[[], []].every((x) => x)', path: '/api/a', bindings: {}, expected: true },
  // RT3 (bare route join): `.join()` with NO separator splits to args=[''] so the
  // emitted Python was `.join(...)` with an empty separator string — a syntax error.
  // Treating '' as absent restores the JS default comma. RED at base: invalid Python.
  { name: 'RT3: bare join() defaults to comma separator', expr: '["a", "b"].join()', path: '/api/a', bindings: {}, expected: 'a,b' },
  { name: 'arr-method: reduce sum with seed', expr: 'nums.reduce((a, b) => a + b, 0)', path: '/api/a', bindings: { locals: { nums: [1, 2, 3] } }, expected: 6 },
  // push mutates AND returns the new length (JS) -> Python `(recv.append(x) or len(recv))` (#6).
  { name: 'arr-method: push returns new length', expr: 'nums.push(9)', path: '/api/a', bindings: { locals: { nums: [1, 2, 3] } }, expected: 4 },
  // reverse mutates + returns the reversed array; concat returns a new array (arr spread / scalar appended).
  { name: 'arr-method: reverse returns reversed array', expr: 'nums.reverse()', path: '/api/a', bindings: { locals: { nums: [1, 2, 3] } }, expected: [3, 2, 1] },
  { name: 'arr-method: concat array arg spreads', expr: 'nums.concat(more)', path: '/api/a', bindings: { locals: { nums: [1], more: [2, 3] } }, expected: [1, 2, 3] },
  { name: 'arr-method: concat scalar arg appends', expr: 'nums.concat(9)', path: '/api/a', bindings: { locals: { nums: [1, 2] } }, expected: [1, 2, 9] },
  // R1/R2 (list-ops parity migration, 2026-06-09): .length is now a route-path
  // property hook (was emitted as broken `arr.length`), and slice was relocated
  // to the shared list-ops module — these prove both work byte-correctly in the
  // route emitter's new home, on a LITERAL receiver (no binding to constant-fold).
  { name: 'R1: array .length property hook', expr: '[1, 2, 3].length', path: '/api/a', bindings: {}, expected: 3 },
  { name: 'R2: slice(-1) relocated lowering byte-correct', expr: '[1, 2, 3, 4].slice(-1)', path: '/api/a', bindings: {}, expected: [4] },
  // R3/R4 (scalar-sweep migration): indexOf and lastIndexOf were relocated into the
  // shared list-ops module — these prove the route output is unchanged at runtime
  // after the relocation (mirror class-conformance S3/S13 on the route path).
  { name: 'R3: indexOf first match relocated lowering byte-correct', expr: '[5, 6, 7, 6].indexOf(6)', path: '/api/a', bindings: {}, expected: 1 },
  { name: 'R4: lastIndexOf last match relocated lowering byte-correct', expr: '[1, 2, 3, 2, 1].lastIndexOf(2)', path: '/api/a', bindings: {}, expected: 3 },

  // ── closures slice 1 (#5): an arrow STATEMENT body that is EXACTLY `{ return E }` is ──
  // semantically the expression body E, so it unwraps to the existing comprehension
  // lowering (unwrapSingleReturnBlock in fastapi-response.ts). Richer statement bodies
  // (locals/control-flow before the return) are NOT unwrapped and still need full closure
  // lowering — deferred to the multi-statement closure build.
  { name: 'closure: map single-return block body', expr: 'nums.map((x) => { return x * 2; })', path: '/api/a', bindings: { locals: { nums: [1, 2, 3] } }, expected: [2, 4, 6] },
  { name: 'closure: filter single-return block body', expr: 'nums.filter((x) => { return x > 1; })', path: '/api/a', bindings: { locals: { nums: [1, 2, 3] } }, expected: [2, 3] },
  { name: 'closure: map single-return object literal', expr: 'nums.map((x) => { return { v: x }; })', path: '/api/a', bindings: { locals: { nums: [1, 2] } }, expected: [{ v: 1 }, { v: 2 }] },

  // ── closures slice 2 (#5 FULL): multi-statement / control-flow arrow bodies. These are RED
  // at base (today they emit garbage Python `[{if (x>2){...}} for x in items]`). A correct
  // build lowers the body to a hoisted nested `def` + comprehension reference, with js_truthy()
  // for JS truthiness. The empty-array case is the discriminator: [] is TRUTHY in JS but FALSY
  // in Python, so a naive `if a:` lowering FAILS it — only js_truthy(a) passes.
  { name: 'closure: map if/else returns', expr: 'items.map((x) => { if (x > 2) { return x * 10; } return x; })', path: '/api/a', bindings: { locals: { items: [1, 2, 3, 4] } }, expected: [1, 2, 30, 40] },
  { name: 'closure: map if-without-else clamp', expr: 'items.map((n) => { if (n < 0) { return 0; } return n; })', path: '/api/a', bindings: { locals: { items: [-1, 2, -3] } }, expected: [0, 2, 0] },
  { name: 'closure: map const-chain then return', expr: 'items.map((x) => { const d = x * 2; const t = d + 1; return t; })', path: '/api/a', bindings: { locals: { items: [1, 2] } }, expected: [3, 5] },
  { name: 'closure: filter with local binding', expr: 'items.filter((x) => { const ok = x % 2 === 0; return ok; })', path: '/api/a', bindings: { locals: { items: [1, 2, 3, 4] } }, expected: [2, 4] },
  { name: 'closure: map JS-truthiness of empty array ([] truthy in JS, falsy in Python)', expr: 'items.map((a) => { if (a) { return 1; } return 0; })', path: '/api/a', bindings: { locals: { items: [[], [1], []] } }, expected: [1, 1, 1] },

  // ── str-method: string methods NOT yet lowered → AttributeError on Python ──
  // split(sep, limit) is the SILENT trap: JS keeps the first `limit` parts;
  // Python's maxsplit keeps ALL parts (limit splits) → wrong result, no error.
  { name: 'str-method: includes true', expr: 's.includes("ana")', path: '/api/s', bindings: { locals: { s: 'banana' } }, expected: true },
  { name: 'str-method: includes false', expr: 's.includes("zzz")', path: '/api/s', bindings: { locals: { s: 'banana' } }, expected: false },
  { name: 'str-method: slice(1, 3)', expr: 's.slice(1, 3)', path: '/api/s', bindings: { locals: { s: 'banana' } }, expected: 'an' },
  { name: 'str-method: slice(-3) negative start', expr: 's.slice(-3)', path: '/api/s', bindings: { locals: { s: 'banana' } }, expected: 'ana' },
  { name: 'str-method: substring(0, 2)', expr: 's.substring(0, 2)', path: '/api/s', bindings: { locals: { s: 'banana' } }, expected: 'ba' },
  { name: 'str-method: indexOf present', expr: 's.indexOf("n")', path: '/api/s', bindings: { locals: { s: 'banana' } }, expected: 2 },
  { name: 'str-method: indexOf missing is -1', expr: 's.indexOf("z")', path: '/api/s', bindings: { locals: { s: 'banana' } }, expected: -1 },
  // RT4 (str indexOf multi-char substring): JS `"hello".indexOf("ll")` is 2; the old
  // element-scan treated the string char-by-char and never matched the 2-char "ll"
  // (RED at base: -1). The str-receiver branch uses Python str.find. Kills the scan impl.
  { name: 'RT4: str indexOf multi-char substring', expr: 's.indexOf("ll")', path: '/api/s', bindings: { locals: { s: 'hello' } }, expected: 2 },
  { name: 'RT5: str indexOf multi-char substring with fromIndex', expr: 's.indexOf("lo", 2)', path: '/api/s', bindings: { locals: { s: 'hello' } }, expected: 3 },
  // RT6 (agon review, claude/zai): JS CLAMPS a negative fromIndex to 0 on str
  // receivers; Python str.find counts from the end. Kills an unclamped find()
  // (which returns -1 here).
  { name: 'RT6: str indexOf negative fromIndex clamps to 0', expr: 's.indexOf("h", -2)', path: '/api/s', bindings: { locals: { s: 'hello' } }, expected: 0 },
  { name: 'str-method: padStart', expr: 's.padStart(8, "0")', path: '/api/s', bindings: { locals: { s: 'banana' } }, expected: '00banana' },
  { name: 'str-method: padEnd', expr: 's.padEnd(8, "0")', path: '/api/s', bindings: { locals: { s: 'banana' } }, expected: 'banana00' },
  { name: 'str-method: repeat', expr: 's.repeat(2)', path: '/api/s', bindings: { locals: { s: 'ab' } }, expected: 'abab' },
  { name: 'str-method: split with a limit (JS first-N, not maxsplit)', expr: 's.split(",", 2)', path: '/api/s', bindings: { locals: { s: 'a,b,c' } }, expected: ['a', 'b'] },

  // ──────────────────────────────────────────────────────────────────────────
  // numbermodel: JS bitwise-int32 + JS truncated-modulo (goal: number-model, 2026-05-28).
  // Contract decided by 6-engine council: EMULATE bitwise (int32 via _i32/_u32, >>> via _ushr,
  // shift counts &31, ToInt32 truncs floats) + truncated modulo (_tmod(a,b)=a-trunc(a/b)*b);
  // declare >2^53 / NaN / Infinity / -0 NON-PORTABLE. Operands are VARIABLE (bindings.locals),
  // NOT literals, so a constant-folding Python lowering cannot hardcode the outputs.
  // Task verify: `node scripts/conformance.mjs --filter "numbermodel:"` (RED until Python lowers).
  // ──────────────────────────────────────────────────────────────────────────
  { name: 'numbermodel: |0 sign bit', expr: 'a|z', path: '/api/n', bindings: { locals: { a: 2147483648, z: 0 } }, expected: -2147483648 },
  { name: 'numbermodel: |0 wraparound', expr: 'a|z', path: '/api/n', bindings: { locals: { a: 4294967296, z: 0 } }, expected: 0 },
  { name: 'numbermodel: >> on >32-bit', expr: 'a>>b', path: '/api/n', bindings: { locals: { a: 8589934592, b: 1 } }, expected: 0 },
  // NB: `>>>` (unsigned right shift) is DEFERRED to a focused follow-up — it is the only
  // parser-NEW operator (KERN already parses | & ^ << >> ~ %) and naively adding it collides
  // with nested-generic close `Foo<Bar<X>>` (the >> shift-vs-generic ambiguity). Non-portable for now.
  { name: 'numbermodel: << shift-count mask (33&31=1)', expr: 'a<<b', path: '/api/n', bindings: { locals: { a: 1, b: 33 } }, expected: 2 },
  { name: 'numbermodel: i32 on a COMPUTED sum', expr: '(a+b)|z', path: '/api/n', bindings: { locals: { a: 2147483647, b: 1, z: 0 } }, expected: -2147483648 },
  { name: 'numbermodel: ToInt32 truncs a float', expr: 'a|z', path: '/api/n', bindings: { locals: { a: -2.9, z: 0 } }, expected: -2 },
  { name: 'numbermodel: & agree smoke', expr: 'a&b', path: '/api/n', bindings: { locals: { a: 5, b: 3 } }, expected: 1 },
  { name: 'numbermodel: -5 % 3 (sign of dividend)', expr: 'a%b', path: '/api/n', bindings: { locals: { a: -5, b: 3 } }, expected: -2 },
  { name: 'numbermodel: 5 % -3', expr: 'a%b', path: '/api/n', bindings: { locals: { a: 5, b: -3 } }, expected: 2 },
  { name: 'numbermodel: negative float -5.5 % 2', expr: 'a%b', path: '/api/n', bindings: { locals: { a: -5.5, b: 2 } }, expected: -1.5 },
  { name: 'numbermodel: float divisor 5 % 2.5', expr: 'a%b', path: '/api/n', bindings: { locals: { a: 5, b: 2.5 } }, expected: 0 },
  { name: 'numbermodel: 7 % 3 agree smoke', expr: 'a%b', path: '/api/n', bindings: { locals: { a: 7, b: 3 } }, expected: 1 },
  { name: 'numbermodel: true division agree', expr: 'a/b', path: '/api/n', bindings: { locals: { a: 5, b: 2 } }, expected: 2.5 },
  { name: 'numbermodel: float add repr agree', expr: 'a+b', path: '/api/n', bindings: { locals: { a: 0.1, b: 0.2 } }, expected: 0.30000000000000004 },
  { name: 'numbermodel: 2^53 safe boundary agree', expr: 'a+b', path: '/api/n', bindings: { locals: { a: 9007199254740991, b: 1 } }, expected: 9007199254740992 },
  { name: 'numbermodel: ToInt32 on string float', expr: 'a|z', path: '/api/n', bindings: { locals: { a: '2.9', z: 0 } }, expected: 2 },
  { name: 'numbermodel: modulo on string float', expr: 'a%b', path: '/api/n', bindings: { locals: { a: '-5.5', b: 2 } }, expected: -1.5 },
  { name: 'numbermodel: bitwise NOT on string float', expr: '~a', path: '/api/n', bindings: { locals: { a: '-3.9' } }, expected: 2 },

  // ──────────────────────────────────────────────────────────────────────────
  // stmt: STATEMENT-LEVEL control flow (kind:'stmt', goal: stmt-harness 2026-05-28).
  // Each lowers a native `lang=kern` handler BODY to BOTH targets (emitNativeKernBodyTS /
  // emitNativeKernBodyPython), runs it in an isolated subprocess, and compares the RETURN
  // value. Design: 6-engine council + nero red-team (side-effect witness, allow_nan=False,
  // block-scope probed+deferred). Operands are PARAMS, never inline literals in the observable.
  // Scope = intra-function control flow ONLY (block scope / number-repr / framework errors deferred).
  // ──────────────────────────────────────────────────────────────────────────
  { kind: 'stmt', name: 'stmt: if/else selects true branch',
    params: [{ name: 'n', type: 'number', value: 20 }, { name: 'min', type: 'number', value: 10 }],
    body: `let name=v value="n * 2"\nif cond="v > min"\n  return value="{ big: true, v: v }"\nelse\n  return value="{ big: false, v: v }"`,
    expected: { big: true, v: 40 } },
  { kind: 'stmt', name: 'stmt: if/else selects false branch',
    params: [{ name: 'n', type: 'number', value: 3 }, { name: 'min', type: 'number', value: 10 }],
    body: `let name=v value="n * 2"\nif cond="v > min"\n  return value="{ big: true, v: v }"\nelse\n  return value="{ big: false, v: v }"`,
    expected: { big: false, v: 6 } },
  { kind: 'stmt', name: 'stmt: objectMerge shallow last-write-wins',
    params: [{ name: 'base', type: 'object', value: { a: 1, b: 2 } }, { name: 'overrides', type: 'object', value: { b: 9, c: 3 } }],
    body: `objectMerge name=merged sources="base, overrides, { d: 4 }"\nreturn value="merged"`,
    expected: { a: 1, b: 9, c: 3, d: 4 } },
  { kind: 'stmt', name: 'stmt: objectMerge preserves falsy override values',
    params: [{ name: 'base', type: 'object', value: { count: 5, label: 'x', enabled: true } }, { name: 'overrides', type: 'object', value: { count: 0, label: '', enabled: false } }],
    body: `objectMerge name=merged sources="base, overrides"\nreturn value="merged"`,
    expected: { count: 0, label: '', enabled: false } },
  { kind: 'stmt', name: 'stmt: objectMerge parses nested literal commas',
    params: [{ name: 'base', type: 'object', value: { a: 1 } }],
    body: `objectMerge name=merged sources="base, { nested: { text: 'a,b', list: [1, 2] } }"\nreturn value="merged"`,
    expected: { a: 1, nested: { text: 'a,b', list: [1, 2] } } },
  { kind: 'stmt', name: 'stmt: objectPick preserves order, falsy, and missing keys',
    params: [{ name: 'user', type: 'object', value: { id: 'u1', count: 0, enabled: false, label: '' } }],
    body: `objectPick name=publicUser in=user keys="['label', 'missing', 'count', 'enabled']"\nreturn value="publicUser"`,
    expected: { label: '', missing: null, count: 0, enabled: false } },
  { kind: 'stmt', name: 'stmt: objectOmit is shallow immutable and preserves input',
    params: [{ name: 'user', type: 'object', value: { id: 'u1', password: 'secret', nested: { keep: true } } }],
    body: `objectOmit name=safeUser in=user keys="['password']"\nreturn value="{ safeUser: safeUser, original: user }"`,
    expected: { safeUser: { id: 'u1', nested: { keep: true } }, original: { id: 'u1', password: 'secret', nested: { keep: true } } } },
  { kind: 'stmt', name: 'stmt: firstTruthy preserves ordered truthy fallback semantics',
    params: [
      { name: 'empty', type: 'string', value: '' },
      { name: 'zero', type: 'number', value: 0 },
      { name: 'flag', type: 'boolean', value: false },
      { name: 'label', type: 'string', value: 'ready' },
    ],
    body: `firstTruthy name=winner values="empty, zero, flag, label, 'fallback'"\nreturn value="winner"`,
    expected: 'ready' },
  { kind: 'stmt', name: 'stmt: firstTruthy falls through to final literal when all prior values are falsy',
    params: [
      { name: 'empty', type: 'string', value: '' },
      { name: 'zero', type: 'number', value: 0 },
      { name: 'flag', type: 'boolean', value: false },
    ],
    body: `firstTruthy name=winner values="empty, zero, flag, 'fallback'"\nreturn value="winner"`,
    expected: 'fallback' },
  { kind: 'stmt', name: 'stmt: coalesce preserves zero as defined',
    params: [
      { name: 'missing', type: 'any', value: null },
      { name: 'zero', type: 'number', value: 0 },
    ],
    body: `coalesce name=winner values="missing, zero, 'fallback'"\nreturn value="winner"`,
    expected: 0 },
  { kind: 'stmt', name: 'stmt: coalesce preserves false and empty string as defined',
    params: [
      { name: 'missing', type: 'any', value: null },
      { name: 'flag', type: 'boolean', value: false },
      { name: 'empty', type: 'string', value: '' },
    ],
    body: `coalesce name=winner values="missing, flag, empty, 'fallback'"\nreturn value="{ winner: winner, emptyChoice: empty }"`,
    expected: { winner: false, emptyChoice: '' } },
  { kind: 'stmt', name: 'stmt: firstDefined aliases nullish fallback semantics',
    params: [
      { name: 'missingA', type: 'any', value: null },
      { name: 'missingB', type: 'any', value: null },
    ],
    body: `firstDefined name=winner values="missingA, missingB, 'fallback'"\nreturn value="winner"`,
    expected: 'fallback' },
  { kind: 'stmt', name: 'stmt: expression-v1 string coercion canonicalizes bool and null',
    params: [
      { name: 'flag', type: 'boolean', value: false },
      { name: 'missing', type: 'any', value: null },
    ],
    body: `expression-v1 name=flagText expr="String(flag)"\nexpression-v1 name=nullText expr="String(missing)"\nreturn value="{ flagText: flagText, nullText: nullText }"`,
    expected: { flagText: 'false', nullText: 'null' } },
  { kind: 'stmt', name: 'stmt: nested fn with let and return executes inside body',
    params: [
      { name: 'left', type: 'number', value: 2 },
      { name: 'right', type: 'number', value: 3 },
    ],
    body: `fn name=add params="a:number,b:number" returns=number\n  handler\n    let name=sum value="a + b"\n    return value="sum"\nreturn value="add(left, right)"`,
    expected: 5 },
  { kind: 'stmt', name: 'stmt: while loop accumulates (mutable kind=let)',
    params: [{ name: 'n', type: 'number', value: 5 }, { name: 'min', type: 'number', value: 0 }],
    body: `let name=total value="0" kind=let\nlet name=i value="0" kind=let\nwhile cond="i < n"\n  assign target="total" value="total + i"\n  assign target="i" value="i + 1"\nreturn value="{ total: total }"`,
    expected: { total: 10 } },
  { kind: 'stmt', name: 'stmt: for loop early-returns mid-iteration',
    params: [{ name: 'n', type: 'number', value: 0 }, { name: 'min', type: 'number', value: 5 }],
    body: `let name=acc value="0" kind=let\neach name=x in="[1, 2, 3, 4]" index=j\n  assign target="acc" value="acc + x"\n  if cond="acc > min"\n    return value="{ stopped: acc, at: j }"\nreturn value="{ stopped: acc, at: -1 }"`,
    expected: { stopped: 6, at: 2 } },
  { kind: 'stmt', name: 'stmt: statements after return do not run',
    params: [{ name: 'n', type: 'number', value: 0 }, { name: 'min', type: 'number', value: 0 }],
    body: `let name=hits value="0" kind=let\nreturn value="{ hits: hits }"\nassign target="hits" value="999"`,
    expected: { hits: 0 } },
  { kind: 'stmt', name: 'stmt: try/catch recovers from a thrown error',
    params: [{ name: 'bad', type: 'string', value: '{' }, { name: 'min', type: 'number', value: 0 }],
    body: `let name=out value="0" kind=let\ntry\n  assign target="out" value="Json.parse(bad).x"\n  catch name=err type=any\n    assign target="out" value="-1"\nreturn value="{ out: out }"`,
    expected: { out: -1 } },
  { kind: 'stmt', name: 'stmt: try body runs up to the throw, then catch (side-effect witness)',
    params: [{ name: 'bad', type: 'string', value: '{' }, { name: 'min', type: 'number', value: 0 }],
    body: `let name=log value="''" kind=let\nlet name=tmp value="0" kind=let\ntry\n  assign target="log" value="log + 'a'"\n  assign target="tmp" value="Json.parse(bad)"\n  assign target="log" value="log + 'b'"\n  catch name=err type=any\n    assign target="log" value="log + 'X'"\nreturn value="{ log: log }"`,
    expected: { log: 'aX' } },
  { kind: 'stmt', name: 'stmt: clamp below min via KERN-owned body node',
    params: [{ name: 'score', type: 'number', value: -5 }, { name: 'lo', type: 'number', value: 0 }, { name: 'hi', type: 'number', value: 100 }],
    body: `clamp name=bounded value=score min=lo max=hi\nreturn value="{ bounded: bounded }"`,
    expected: { bounded: 0 } },
  { kind: 'stmt', name: 'stmt: clamp above max via KERN-owned body node',
    params: [{ name: 'score', type: 'number', value: 125 }, { name: 'lo', type: 'number', value: 0 }, { name: 'hi', type: 'number', value: 100 }],
    body: `clamp name=bounded value=score min=lo max=hi\nreturn value="{ bounded: bounded }"`,
    expected: { bounded: 100 } },
  { kind: 'stmt', name: 'stmt: clamp keeps in-range float via KERN-owned body node',
    params: [{ name: 'score', type: 'number', value: 12.5 }, { name: 'lo', type: 'number', value: -10 }, { name: 'hi', type: 'number', value: 20 }],
    body: `clamp name=bounded value=score min=lo max=hi\nreturn value="{ bounded: bounded }"`,
    expected: { bounded: 12.5 } },

  // ── BLOCK-BODIED ARROW CLOSURE (slices 0+1) on the native-body stmt path. ──────────
  // The closure lowers via the SAME emitChildrenPy hoist point the class path uses, so
  // the stmt harness proves TS == Python on a let-position block arrow that (a) reads a
  // captured outer param (`factor`), (b) holds a local const + return, and (c) is invoked
  // TWICE in one expression. Discriminates: naive Python `lambda` (invalid — statements),
  // missing read-capture, and one-shot/inlined-def impls (the def must be reusable).
  { kind: 'stmt', name: 'stmt: block-bodied arrow closure with read-capture, invoked twice',
    params: [{ name: 'factor', type: 'number', value: 3 }],
    body: `let name=scale value="(x) => { const y = x * factor; return y; }"\nreturn value="{ a: scale(7), b: scale(scale(1)) }"`,
    expected: { a: 21, b: 9 } },

  // ── BLOCK SCOPE oracle (memory's #6 known divergence; deferred from #1 slice 1). ───
  // TS `let` is block-scoped, Python assignment is function-scoped. Discriminating fixtures:
  // (1) baseline shadow: catches "Python leaks inner let".
  // (2) inner usage: catches "lazy fix that omits the inner let entirely" (still wrong — must
  //     use 2 inside, 1 outside).
  // (3) no-shadow block: catches "lazy fix that always renames every let" (no-shadow block
  //     should still let outer code see the value through normal Python scoping).
  // (4) two siblings shadow: catches "fix that gensym-leaks across sibling blocks".
  { kind: 'stmt', name: 'stmt: block-scope let-shadow (outer 1, inner if-block 2, return outer)',
    params: [{ name: 'c', type: 'boolean', value: true }],
    body: `let name=x value="1"\nif cond="c"\n  let name=x value="2"\nreturn value="{ x: x }"`,
    expected: { x: 1 } },
  { kind: 'stmt', name: 'stmt: block-scope inner let USED inside block then return outer (witness)',
    params: [{ name: 'c', type: 'boolean', value: true }],
    body: `let name=x value="1" kind=let\nlet name=seen value="0" kind=let\nif cond="c"\n  let name=x value="2"\n  assign target="seen" value="x"\nreturn value="{ x: x, seen: seen }"`,
    expected: { x: 1, seen: 2 } },
  { kind: 'stmt', name: 'stmt: block-scope NO outer shadow (regular inner let must still work)',
    params: [{ name: 'c', type: 'boolean', value: true }],
    body: `let name=outer value="10" kind=let\nif cond="c"\n  let name=inner value="3"\n  assign target="outer" value="outer + inner"\nreturn value="{ outer: outer }"`,
    expected: { outer: 13 } },
  { kind: 'stmt', name: 'stmt: block-scope two sibling shadows (separate blocks, neither leaks)',
    params: [{ name: 'a', type: 'boolean', value: true }, { name: 'b', type: 'boolean', value: true }],
    body: `let name=x value="1"\nif cond="a"\n  let name=x value="2"\nif cond="b"\n  let name=x value="3"\nreturn value="{ x: x }"`,
    expected: { x: 1 } },
  // nero PROBE: WRITE-path inside the shadow. Mutates the inner-shadowed binding via `assign`
  // and verifies the gensym is the target (outer stays untouched). Kills a "rename decl+read
  // only" wrong fix (nero Challenge 1/4).
  { kind: 'stmt', name: 'stmt: block-scope inner let MUTATED by assign, outer untouched',
    params: [{ name: 'c', type: 'boolean', value: true }],
    body: `let name=x value="1" kind=let\nlet name=witness value="0" kind=let\nif cond="c"\n  let name=x value="10" kind=let\n  assign target="x" value="x + 5"\n  assign target="witness" value="x"\nreturn value="{ x: x, witness: witness }"`,
    expected: { x: 1, witness: 15 } },
  // nero PROBE: PARAMETER shadow. A handler param `x` is shadowed by an inner `let x`.
  // The assign-after-decl writes the gensym; the return reads the param (outer). Kills the
  // nero Challenge 2 case (params not in localScopes -> no rename -> param clobbered).
  { kind: 'stmt', name: 'stmt: block-scope param shadow (inner let MUTATED, param untouched on return)',
    params: [{ name: 'x', type: 'number', value: 7 }, { name: 'c', type: 'boolean', value: true }],
    body: `let name=witness value="0" kind=let\nif cond="c"\n  let name=x value="100" kind=let\n  assign target="x" value="x + 1"\n  assign target="witness" value="x"\nreturn value="{ x: x, witness: witness }"`,
    expected: { x: 7, witness: 101 } },

  // ──────────────────────────────────────────────────────────────────────────
  // D1b: LOOSE cross-type equality (`==`/`!=`) anti-drift, native-body stmt path.
  // KERN's loose `==` is NOT JS `==` — it adds ONLY the null/undefined crossing on
  // top of strict and does NOT JS-coerce. So `1 == "1"` is FALSE, `true == 1` is
  // FALSE, a same-type compare matches, and `null == null` is TRUE. The TS leg now
  // routes loose ops through `__kern_loose_eq`; Python through `_kern_loose_equal`.
  // These run the SAME `lang=kern` body on BOTH targets and compare the boolean
  // return, so the two helpers can never silently drift. Operands are PARAMS of
  // DISTINCT types (the cross-type case the bug produced `true` on TS) per the stmt
  // harness rule (no inline literals in the observable). A BUGGED TS leg (raw `==`,
  // JS coercion) returns `xn: true` here and FAILS — this fixture is the lock.
  { kind: 'stmt', name: 'stmt: D1b loose `==` number-vs-string is FALSE (no JS coercion)',
    params: [{ name: 'n', type: 'number', value: 1 }, { name: 's', type: 'string', value: '1' }],
    body: `return value="{ xn: n == s, same: n == 1 }"`,
    expected: { xn: false, same: true } },
  { kind: 'stmt', name: 'stmt: D1b loose `!=` number-vs-string is TRUE (no JS coercion)',
    params: [{ name: 'n', type: 'number', value: 1 }, { name: 's', type: 'string', value: '1' }],
    body: `return value="{ xn: n != s, same: n != 1 }"`,
    expected: { xn: true, same: false } },
  { kind: 'stmt', name: 'stmt: D1b loose `==` bool-vs-number is FALSE',
    params: [{ name: 'flag', type: 'boolean', value: true }, { name: 'one', type: 'number', value: 1 }],
    body: `return value="{ xb: flag == one }"`,
    expected: { xb: false } },
  { kind: 'stmt', name: 'stmt: D1b loose `==` null-vs-number is FALSE, null-vs-null is TRUE (nullish crossing)',
    params: [{ name: 'nothing', type: 'any', value: null }, { name: 'zero', type: 'number', value: 0 }],
    body: `return value="{ nz: nothing == zero, nn: nothing == nothing }"`,
    expected: { nz: false, nn: true } },
  { kind: 'stmt', name: 'stmt: D1b loose `==` empty-string-vs-zero and false-vs-zero are FALSE',
    params: [{ name: 'empty', type: 'string', value: '' }, { name: 'zero', type: 'number', value: 0 }, { name: 'flag', type: 'boolean', value: false }],
    body: `return value="{ ez: empty == zero, fz: flag == zero }"`,
    expected: { ez: false, fz: false } },
  { kind: 'stmt', name: 'stmt: D1b loose `==`/`!=` same-type controls compare by value',
    params: [{ name: 'a', type: 'string', value: 'x' }, { name: 'b', type: 'string', value: 'x' }, { name: 'c', type: 'string', value: 'y' }],
    body: `return value="{ eq: a == b, ne: a != c }"`,
    expected: { eq: true, ne: true } },
  // D1b nero-found fail-open lock: a loose `==` inside a TEMPLATE INTERPOLATION is
  // lowered through `__kern_loose_eq` on TS (and `_kern_loose_equal` on Python). An
  // earlier IR-walk detector missed `==` inside `${…}` (its mask blanked whole template
  // literals) → missing helper DEF → runtime ReferenceError. `looseEq` is now derived
  // from the EMITTED code (`emittedCodeUsesLooseEq`), so the def is always present. This
  // fixture runs the interpolated body on BOTH legs end-to-end — it CRASHED at base
  // before the fix, so it discriminates the regression.
  { kind: 'stmt', name: 'stmt: D1b loose `==` inside a template interpolation (fail-open lock)',
    params: [{ name: 'n', type: 'number', value: 1 }, { name: 's', type: 'string', value: '1' }],
    body: 'return value="`xtype=${n == s}`"',
    expected: 'xtype=false' },

  // ──────────────────────────────────────────────────────────────────────────
  // route: ROUTE-LEVEL HTTP response parity (kind:'route', goal: error-semantics 2026-05-28).
  // Lowers a full portable route handler to both targets, runs it (mock res -> {status,body} on
  // Express; HTTPException -> {status, body:{detail}} on FastAPI), compares {status, body}.
  // CONTRACT (council bb0g4njli, 85%): error bodies use FastAPI's canonical {"detail":...} on BOTH.
  // guard-fail was RED-at-base (Express emitted {error}); the express-portable {detail} fix converges.
  // ──────────────────────────────────────────────────────────────────────────
  { kind: 'route', name: 'route: guard pass -> 200 success body',
    kern: `route method=post path=/api/t\n  derive name=doubled expr={{ n * 2 }}\n  guard name=floor expr={{ doubled >= min }} else=422\n  respond 200 json={{ {result: doubled} }}`,
    bindings: { locals: { n: 20, min: 30 } }, expected: { status: 200, body: { result: 40 } } },
  { kind: 'route', name: 'route: guard fail -> 422 {detail} parity',
    kern: `route method=post path=/api/t\n  derive name=doubled expr={{ n * 2 }}\n  guard name=floor expr={{ doubled >= min }} else=422\n  respond 200 json={{ {result: doubled} }}`,
    bindings: { locals: { n: 10, min: 30 } }, expected: { status: 422, body: { detail: 'floor guard failed' } } },
  { kind: 'route', name: 'route: guard fail -> 404 {detail} (second status)',
    kern: `route method=post path=/api/t\n  derive name=x expr={{ n }}\n  guard name=exists expr={{ x > 0 }} else=404\n  respond 200 json={{ {x: x} }}`,
    bindings: { locals: { n: 0 } }, expected: { status: 404, body: { detail: 'exists guard failed' } } },
  // collect order is a COMPARATOR (a,b) — Express + ground-layer both emit .sort((a,b)=>order);
  // Python must reproduce via sorted(key=cmp_to_key(lambda a,b: order)) (#6). Filter active,
  // sort score desc, limit 2 -> [u2(9), u1(8)].
  { kind: 'route', name: 'route: collect where+order(comparator)+limit parity',
    kern: `route method=post path=/api/t\n  collect name=top from=users where={{ item.active }} order={{ b.score - a.score }} limit=2\n  respond 200 json={{ {top: top} }}`,
    bindings: { locals: { users: [{ id: 'u1', active: true, score: 8 }, { id: 'u2', active: true, score: 9 }, { id: 'u3', active: false, score: 4 }, { id: 'u4', active: true, score: 6 }] } },
    expected: { status: 200, body: { top: [{ id: 'u2', active: true, score: 9 }, { id: 'u1', active: true, score: 8 }] } } },
  { kind: 'route', name: 'route: count filtered collection parity',
    kern: `route method=post path=/api/t\n  count name=active_count in=users where="item.active"\n  respond 200 json={{ {activeCount: active_count} }}`,
    bindings: { locals: { users: [{ active: true }, { active: false }, { active: true }] } },
    expected: { status: 200, body: { activeCount: 2 } } },
  { kind: 'route', name: 'route: count where expression parity',
    kern: `route method=post path=/api/t\n  count name=matching_count in=users where={{ item.score >= min_score }}\n  respond 200 json={{ {matchingCount: matching_count} }}`,
    bindings: { locals: { min_score: 7, users: [{ score: 4 }, { score: 7 }, { score: 10 }] } },
    expected: { status: 200, body: { matchingCount: 2 } } },
  { kind: 'route', name: 'route: count whole collection parity',
    kern: `route method=post path=/api/t\n  count name=user_count in=users\n  respond 200 json={{ {userCount: user_count} }}`,
    bindings: { locals: { users: [{ id: 1 }, { id: 2 }, { id: 3 }] } },
    expected: { status: 200, body: { userCount: 3 } } },
  { kind: 'route', name: 'route: filter predicate AST parity',
    kern: `route method=post path=/api/t\n  filter name=eligible in=users predicate={{ {and: [{eq: ["active", true]}, {gte: ["age", 18]}, {gt: ["score", 10]}, {neq: ["role", "banned"]}, {eq: ["profile.tags.0", "vip"]}]} }}\n  filter name=missing_ok in=users predicate={{ {neq: ["missing", "x"]} }}\n  filter name=missing_null in=users predicate={{ {eq: ["missing", null]} }}\n  count name=missing_ok_count in=missing_ok\n  count name=missing_null_count in=missing_null\n  respond 200 json={{ {ids: eligible.map((u) => u.id), missingOk: missing_ok_count, missingNull: missing_null_count} }}`,
    bindings: { locals: { users: [
      { id: 'u1', age: 17, active: true, score: 20, role: 'user', profile: { tags: ['vip'] } },
      { id: 'u2', age: 21, active: true, score: 11, role: 'admin', profile: { tags: ['vip'] } },
      { id: 'u3', age: 30, active: false, score: 99, role: 'user', profile: { tags: ['vip'] } },
      { id: 'u4', age: 44, active: true, score: 10, role: 'user', profile: { tags: ['vip'] } },
      { id: 'u5', age: 40, active: true, score: 20, role: 'banned', profile: { tags: ['vip'] } },
      { id: 'u6', age: 25, active: true, score: 15, role: 'user', profile: { tags: ['vip', 'beta'] } },
      { id: 'u7', age: 31, active: true, score: 19, role: 'user', profile: { tags: ['basic', 'vip'] } },
    ] } },
    expected: { status: 200, body: { ids: ['u2', 'u6'], missingOk: 7, missingNull: 0 } } },
  { kind: 'route', name: 'route: count predicate AST parity',
    kern: `route method=post path=/api/t\n  filter name=eligible in=users predicate={{ {and: [{lt: ["age", 30]}, {lte: ["score", 15]}, {neq: ["role", "banned"]}, {eq: ["profile.tags.0", "vip"]}]} }}\n  count name=eligible_count in=users predicate={{ {and: [{lt: ["age", 30]}, {lte: ["score", 15]}, {neq: ["role", "banned"]}, {eq: ["profile.tags.0", "vip"]}]} }}\n  count name=missing_ok_count in=users predicate={{ {neq: ["missing", "x"]} }}\n  count name=missing_null_count in=users predicate={{ {eq: ["missing", null]} }}\n  respond 200 json={{ {ids: eligible.map((u) => u.id), eligibleCount: eligible_count, missingOk: missing_ok_count, missingNull: missing_null_count} }}`,
    bindings: { locals: { users: [
      { id: 'u1', age: 17, score: 15, role: 'user', profile: { tags: ['vip'] } },
      { id: 'u2', age: 29, score: 15, role: 'admin', profile: { tags: ['vip'] } },
      { id: 'u3', age: 30, score: 14, role: 'user', profile: { tags: ['vip'] } },
      { id: 'u4', age: 28, score: 16, role: 'user', profile: { tags: ['vip'] } },
      { id: 'u5', age: 25, score: 10, role: 'banned', profile: { tags: ['vip'] } },
      { id: 'u6', age: 22, score: 12, role: 'user', profile: { tags: ['basic'] } },
      { id: 'u7', age: 20, score: 8, role: 'user', profile: { tags: ['vip'] } },
    ] } },
    expected: { status: 200, body: { ids: ['u1', 'u2', 'u7'], eligibleCount: 3, missingOk: 7, missingNull: 0 } } },
  // Intentional absent-path divergence: `eq` on an absent path is false, so
  // `not(eq(missing, null))` is true for absent paths. `neq(missing, null)` is
  // false for absent paths because the leaf operator preserves the existing
  // "absent means not unequal to null" contract.
  { kind: 'route', name: 'route: predicate or/not AST parity',
    kern: `route method=post path=/api/t\n  filter name=eligible in=users predicate={{ {and: [{or: [{eq: ["role", "admin"]}, {eq: ["role", "staff"]}]}, {not: {eq: ["status", "banned"]} }, {not: {eq: ["missing", null]} }]} }}\n  count name=eligible_count in=users predicate={{ {and: [{or: [{eq: ["role", "admin"]}, {eq: ["role", "staff"]}]}, {not: {eq: ["status", "banned"]} }, {not: {eq: ["missing", null]} }]} }}\n  count name=not_missing_null_count in=users predicate={{ {not: {eq: ["missing", null]} } }}\n  count name=neq_missing_null_count in=users predicate={{ {neq: ["missing", null]} }}\n  respond 200 json={{ {ids: eligible.map((u) => u.id), eligibleCount: eligible_count, notMissingNull: not_missing_null_count, neqMissingNull: neq_missing_null_count} }}`,
    bindings: { locals: { users: [
      { id: 'u1', role: 'admin', status: 'active' },
      { id: 'u2', role: 'staff', status: 'active' },
      { id: 'u3', role: 'user', status: 'active' },
      { id: 'u4', role: 'admin', status: 'banned' },
      { id: 'u5', role: 'staff', status: 'active', missing: null },
      { id: 'u6', role: 'admin', status: 'active', missing: 'x' },
    ] } },
    expected: { status: 200, body: { ids: ['u1', 'u2', 'u6'], eligibleCount: 3, notMissingNull: 5, neqMissingNull: 1 } } },
  // Richer leaf predicate parity. `nin` mirrors `neq` for absent paths:
  // absent is not in any concrete list, while `in` on absent remains false.
  { kind: 'route', name: 'route: predicate membership/string AST parity',
    kern: `route method=post path=/api/t\n  filter name=eligible in=users predicate={{ {and: [{exists: "profile.tags.0"}, {in: ["role", ["admin", "staff"]]}, {nin: ["status", ["banned"]]}, {contains: ["profile.tags", "vip"]}, {contains: ["name", "A"]}, {startsWith: ["email", "a"]}, {endsWith: ["email", ".com"]}]} }}\n  count name=eligible_count in=users predicate={{ {and: [{exists: "profile.tags.0"}, {in: ["role", ["admin", "staff"]]}, {nin: ["status", ["banned"]]}, {contains: ["profile.tags", "vip"]}, {contains: ["name", "A"]}, {startsWith: ["email", "a"]}, {endsWith: ["email", ".com"]}]} }}\n  count name=nin_missing_count in=users predicate={{ {nin: ["missing", ["x"]]} }}\n  count name=in_missing_count in=users predicate={{ {in: ["missing", ["x"]]} }}\n  count name=bool_is_number_count in=users predicate={{ {in: ["flag", [1]]} }}\n  count name=contains_number_one_count in=users predicate={{ {contains: ["flags", 1]} }}\n  count name=contains_bool_true_count in=users predicate={{ {contains: ["flags", true]} }}\n  count name=empty_prefix_count in=users predicate={{ {startsWith: ["email", ""]} }}\n  respond 200 json={{ {ids: eligible.map((u) => u.id), eligibleCount: eligible_count, ninMissing: nin_missing_count, inMissing: in_missing_count, boolIsNumber: bool_is_number_count, containsNumberOne: contains_number_one_count, containsBoolTrue: contains_bool_true_count, emptyPrefix: empty_prefix_count} }}`,
    bindings: { locals: { users: [
      { id: 'u1', name: 'Ada', role: 'admin', status: 'active', email: 'ada@example.com', flag: true, flags: [true], profile: { tags: ['vip', 'beta'] } },
      { id: 'u2', name: 'Grace', role: 'staff', status: 'pending', email: 'grace@example.org', flag: 1, flags: [1], profile: { tags: ['basic'] } },
      { id: 'u3', name: 'Bo', role: 'user', status: 'active', email: 'bo@example.com', flag: false, flags: [false], profile: { tags: ['vip'] } },
      { id: 'u4', name: 'Axel', role: 'admin', status: 'banned', email: 'axel@example.com', flag: 2, flags: [2], profile: { tags: ['vip'] } },
      { id: 'u5', name: 'Ann', role: 'staff', status: 'active', email: 'ann@example.com', flag: 1, flags: [1, true], profile: { tags: ['vip'] } },
      { id: 'u6', name: 'Ari', role: 'admin', status: 'active', email: 'ari@example.com', flag: 0, flags: [0], profile: { tags: [] } },
    ] } },
    expected: { status: 200, body: { ids: ['u1', 'u5'], eligibleCount: 2, ninMissing: 6, inMissing: 0, boolIsNumber: 2, containsNumberOne: 2, containsBoolTrue: 2, emptyPrefix: 6 } } },
  { kind: 'route', name: 'route: count string predicate parity',
    kern: `route method=post path=/api/t\n  count name=young_count in=users predicate="{and: [{lt: [\\"age\\", 30]}]}"\n  respond 200 json={{ {youngCount: young_count} }}`,
    bindings: { locals: { users: [{ age: 17 }, { age: 30 }, { age: 29 }] } },
    expected: { status: 200, body: { youngCount: 2 } } },
  // Direct route keyed-reshape parity.
  { kind: 'route', name: 'route: uniqueBy first-wins keyed reshape parity',
    kern: `route method=post path=/api/t\n  uniqueBy name=distinct in=users by="item.id"\n  respond 200 json={{ {distinct: distinct} }}`,
    bindings: { locals: { users: [{ id: 'u1', score: 1 }, { id: 'u2', score: 2 }, { id: 'u1', score: 9 }, { id: 'u3', score: 3 }] } },
    expected: { status: 200, body: { distinct: [{ id: 'u1', score: 1 }, { id: 'u2', score: 2 }, { id: 'u3', score: 3 }] } } },
  { kind: 'route', name: 'route: groupBy buckets preserve order keyed reshape parity',
    kern: `route method=post path=/api/t\n  groupBy name=by_type in=items by="item.type"\n  respond 200 json={{ {byType: by_type} }}`,
    bindings: { locals: { items: [{ id: 'a', type: 'book' }, { id: 'b', type: 'tool' }, { id: 'c', type: 'book' }] } },
    expected: { status: 200, body: { byType: { book: [{ id: 'a', type: 'book' }, { id: 'c', type: 'book' }], tool: [{ id: 'b', type: 'tool' }] } } } },
  { kind: 'route', name: 'route: partition preserves pass/fail order keyed reshape parity',
    kern: `route method=post path=/api/t\n  partition pass=active fail=inactive in=users where="item.active"\n  respond 200 json={{ {active: active, inactive: inactive} }}`,
    bindings: { locals: { users: [{ id: 'u1', active: true }, { id: 'u2', active: false }, { id: 'u3', active: true }, { id: 'u4', active: false }, { id: 'u5', active: true }] } },
    expected: { status: 200, body: { active: [{ id: 'u1', active: true }, { id: 'u3', active: true }, { id: 'u5', active: true }], inactive: [{ id: 'u2', active: false }, { id: 'u4', active: false }] } } },
  { kind: 'route', name: 'route: indexBy last-wins keyed reshape parity',
    kern: `route method=post path=/api/t\n  indexBy name=by_id in=users by="item.id"\n  respond 200 json={{ {byId: by_id} }}`,
    bindings: { locals: { users: [{ id: 'u1', score: 1 }, { id: 'u2', score: 2 }, { id: 'u1', score: 9 }] } },
    expected: { status: 200, body: { byId: { u1: { id: 'u1', score: 9 }, u2: { id: 'u2', score: 2 } } } } },
  { kind: 'route', name: 'route: countBy uneven counts keyed reshape parity',
    kern: `route method=post path=/api/t\n  countBy name=counts in=items by="item.type"\n  respond 200 json={{ {counts: counts} }}`,
    bindings: { locals: { items: [{ type: 'book' }, { type: 'tool' }, { type: 'book' }, { type: 'book' }] } },
    expected: { status: 200, body: { counts: { book: 3, tool: 1 } } } },
  { kind: 'route', name: 'route: object merge/pick/omit shape parity',
    kern: `route method=post path=/api/t\n  objectMerge name=merged sources="user, override, { role: 'member', nested: { keep: true } }"\n  objectPick name=public_user in=merged keys="['id', 'missing', 'count', 'enabled', 'role', 'get']"\n  objectOmit name=safe_user in=merged keys="['password', 'token']"\n  respond 200 json={{ {publicUser: public_user, safeUser: safe_user, original: user} }}`,
    bindings: { locals: {
      user: { id: 'u1', password: 'secret', token: 't1', count: 0, enabled: false, role: 'guest' },
      override: { token: 't2', role: 'admin' },
    } },
    expected: { status: 200, body: {
      publicUser: { id: 'u1', missing: null, count: 0, enabled: false, role: 'member', get: null },
      safeUser: { id: 'u1', count: 0, enabled: false, role: 'member', nested: { keep: true } },
      original: { id: 'u1', password: 'secret', token: 't1', count: 0, enabled: false, role: 'guest' },
    } } },
  { kind: 'route', name: 'route: object merge/pick/omit safe null/primitive parity',
    kern: `route method=post path=/api/t\n  objectMerge name=merged sources="empty, { val: 42 }"\n  objectPick name=picked in=empty keys="['a', 'b']"\n  objectOmit name=omitted in=empty keys="['a', 'b']"\n  respond 200 json={{ {merged: merged, picked: picked, omitted: omitted} }}`,
    bindings: { locals: {
      empty: null,
    } },
    expected: { status: 200, body: {
      merged: { val: 42 },
      picked: { a: null, b: null },
      omitted: {},
    } } },
  { kind: 'route', name: 'route: object keys/values/entries introspection parity',
    kern: `route method=post path=/api/t\n  objectKeys name=keys in=user\n  objectValues name=values in=user\n  objectEntries name=entries in=user\n  objectKeys name=null_keys in=empty\n  objectKeys name=primitive_keys in=primitive\n  objectValues name=primitive_values in=primitive\n  objectEntries name=primitive_entries in=primitive\n  objectKeys name=array_keys in=items\n  objectValues name=array_values in=items\n  objectEntries name=array_entries in=items\n  respond 200 json={{ {keys: keys, values: values, entries: entries, nullKeys: null_keys, primitiveKeys: primitive_keys, primitiveValues: primitive_values, primitiveEntries: primitive_entries, arrayKeys: array_keys, arrayValues: array_values, arrayEntries: array_entries} }}`,
    bindings: { locals: {
      user: { "2": "two", "1": "one", x: "ex", count: 0, enabled: false, label: "" },
      empty: null,
      primitive: "abc",
      items: ["a", "b"],
    } },
    expected: { status: 200, body: {
      keys: ["1", "2", "x", "count", "enabled", "label"],
      values: ["one", "two", "ex", 0, false, ""],
      entries: [["1", "one"], ["2", "two"], ["x", "ex"], ["count", 0], ["enabled", false], ["label", ""]],
      nullKeys: [],
      primitiveKeys: [],
      primitiveValues: [],
      primitiveEntries: [],
      arrayKeys: [],
      arrayValues: [],
      arrayEntries: [],
    } } },
  { kind: 'route', name: 'route: compact/pluck/take/drop list shape parity',
    kern: `route method=post path=/api/t\n  compact name=truthy in=values\n  pluck name=emails in=users prop=profile.email\n  pluck name=first_tags in=users prop=profile.tags.0\n  pluck name=tag_lengths in=users prop=profile.tags.length\n  take name=first_two in=emails n=2\n  drop name=after_one in=emails n=1\n  respond 200 json={{ {truthy: truthy, emails: emails, firstTags: first_tags, tagLengths: tag_lengths, firstTwo: first_two, afterOne: after_one} }}`,
    bindings: { locals: {
      values: [null, false, 0, '', [], {}, 'keep', 7],
      users: [
        { id: 'u1', profile: { email: 'a@example.com', tags: ['vip'] } },
        { id: 'u2', profile: {} },
        { id: 'u3' },
        { id: 'u4', profile: { email: '', tags: [] } },
      ],
    } },
    expected: { status: 200, body: {
      truthy: [[], {}, 'keep', 7],
      emails: ['a@example.com', null, null, ''],
      firstTags: ['vip', null, null, null],
      tagLengths: [null, null, null, null],
      firstTwo: ['a@example.com', null],
      afterOne: [null, null, ''],
    } } },
  { kind: 'route', name: 'route: slice/reverse/at list primitive parity',
    kern: `route method=post path=/api/t\n  slice name=middle in=items start=1 end=3\n  slice name=empty_range in=items start=3 end=1\n  slice name=copy_all in=items\n  reverse name=backward in=items\n  at name=first in=items index=0\n  at name=missing in=items index=99\n  respond 200 json={{ {middle: middle, emptyRange: empty_range, copyAll: copy_all, backward: backward, first: first, missing: missing, original: items} }}`,
    bindings: { locals: {
      items: ['a', 'b', 'c', 'd'],
    } },
    expected: { status: 200, body: {
      middle: ['b', 'c'],
      emptyRange: [],
      copyAll: ['a', 'b', 'c', 'd'],
      backward: ['d', 'c', 'b', 'a'],
      first: 'a',
      missing: null,
      original: ['a', 'b', 'c', 'd'],
    } } },
  { kind: 'route', name: 'route: join/concat list primitive parity',
    kern: `route method=post path=/api/t\n  join name=csv in=parts separator="|"\n  join name=default_csv in=letters\n  join name=empty_csv in=empty\n  concat name=combined in=left with=right\n  respond 200 json={{ {csv: csv, defaultCsv: default_csv, emptyCsv: empty_csv, combined: combined, left: left, right: right} }}`,
    bindings: { locals: {
      parts: [null, 'a', true, false, 3],
      letters: ['a', 'b', 'c'],
      empty: [],
      left: [1, ['nested']],
      right: [3, 4],
    } },
    expected: { status: 200, body: {
      csv: '|a|true|false|3',
      defaultCsv: 'a,b,c',
      emptyCsv: '',
      combined: [1, ['nested'], 3, 4],
      left: [1, ['nested']],
      right: [3, 4],
    } } },
  { kind: 'route', name: 'route: lookup list primitive scalar parity',
    kern: `route method=post path=/api/t\n  includes name=has_number in=items value=2\n  includes name=has_string in=items value="'2'"\n  includes name=has_bool in=type_trap value=true\n  indexOf name=first_two in=items value=2\n  lastIndexOf name=last_two in=items value=2\n  indexOf name=missing_bool in=type_trap value=true\n  respond 200 json={{ {hasNumber: has_number, hasString: has_string, hasBool: has_bool, firstTwo: first_two, lastTwo: last_two, missingBool: missing_bool} }}`,
    bindings: { locals: {
      items: [1, true, 2, '2', 2],
      type_trap: [1, 0],
    } },
    expected: { status: 200, body: {
      hasNumber: true,
      hasString: true,
      hasBool: false,
      firstTwo: 2,
      lastTwo: 4,
      missingBool: -1,
    } } },
  { kind: 'route', name: 'route: string primitive parity',
    kern: `route method=post path=/api/t\n  trim name=clean in=raw\n  trim name=js_trimmed in=js_trim_trap\n  trim name=bool_text in=flag\n  trim name=null_clean in=missing\n  split name=parts in=csv separator=","\n  split name=first_two in=csv separator="," limit=2\n  split name=zero_parts in=csv separator="," limit=0\n  split name=empty_parts in=empty separator=","\n  replaceFirst name=first_replaced in=phrase search="foo" replacement="$"\n  replaceFirst name=tail_first in=tail search="::" replacement="!"\n  replaceFirst name=not_found_first in=phrase search="zzz" replacement="!"\n  replaceAll name=all_replaced in=phrase search="foo" replacement="$"\n  replaceAll name=multi_tail in=tail search="::" replacement="!"\n  replaceAll name=not_found_all in=phrase search="zzz" replacement="!"\n  replaceAll name=deleted in=letters search="a" replacement=""\n  replaceAll name=null_replaced in=missing search="foo" replacement="bar"\n  respond 200 json={{ {clean: clean, jsTrimmed: js_trimmed, boolText: bool_text, nullClean: null_clean, parts: parts, firstTwo: first_two, zeroParts: zero_parts, emptyParts: empty_parts, firstReplaced: first_replaced, tailFirst: tail_first, notFoundFirst: not_found_first, allReplaced: all_replaced, multiTail: multi_tail, notFoundAll: not_found_all, deleted: deleted, nullReplaced: null_replaced} }}`,
    bindings: { locals: {
      raw: '\u00a0\t hello world \n',
      js_trim_trap: '\ufeff\u0085 hello \ufeff',
      flag: true,
      missing: null,
      csv: 'a,,b,c',
      empty: '',
      phrase: 'foo bar foo',
      tail: 'start::end::',
      letters: 'banana',
    } },
    expected: { status: 200, body: {
      clean: 'hello world',
      jsTrimmed: '\u0085 hello',
      boolText: 'true',
      nullClean: null,
      parts: ['a', '', 'b', 'c'],
      firstTwo: ['a', ''],
      zeroParts: [],
      emptyParts: [''],
      firstReplaced: '$ bar foo',
      tailFirst: 'start!end::',
      notFoundFirst: 'foo bar foo',
      allReplaced: '$ bar $',
      multiTail: 'start!end!',
      notFoundAll: 'foo bar foo',
      deleted: 'bnn',
      nullReplaced: null,
    } } },
  { kind: 'route', name: 'route: sort comparator/default immutability parity',
    kern: `route method=post path=/api/t\n  sort name=ranked in=users compare="b.score - a.score"\n  sort name=lexicographic in=nums\n  sort name=mixed_sorted in=mixed\n  sort name=renamed in=users a=left b=right compare="right.score - left.score"\n  take name=top_two in=ranked n=2\n  respond 200 json={{ {ranked: ranked, topTwo: top_two, lexicographic: lexicographic, mixedSorted: mixed_sorted, renamed: renamed, original: users} }}`,
    bindings: { locals: {
      users: [
        { id: 'u1', score: 8 },
        { id: 'u2', score: 10 },
        { id: 'u3', score: 4 },
      ],
      nums: [10, 2, 1],
      mixed: [true, null, false, 'a'],
    } },
    expected: { status: 200, body: {
      ranked: [{ id: 'u2', score: 10 }, { id: 'u1', score: 8 }, { id: 'u3', score: 4 }],
      topTwo: [{ id: 'u2', score: 10 }, { id: 'u1', score: 8 }],
      lexicographic: [1, 10, 2],
      mixedSorted: ['a', false, null, true],
      renamed: [{ id: 'u2', score: 10 }, { id: 'u1', score: 8 }, { id: 'u3', score: 4 }],
      original: [{ id: 'u1', score: 8 }, { id: 'u2', score: 10 }, { id: 'u3', score: 4 }],
    } } },
  { kind: 'route', name: 'route: take/drop zero and overflow parity',
    kern: `route method=post path=/api/t\n  take name=none in=items n=0\n  take name=all_items in=items n=10\n  drop name=same_items in=items n=0\n  drop name=empty_items in=items n=10\n  respond 200 json={{ {none: none, allItems: all_items, sameItems: same_items, emptyItems: empty_items} }}`,
    bindings: { locals: { items: [1, 2, 3] } },
    expected: { status: 200, body: { none: [], allItems: [1, 2, 3], sameItems: [1, 2, 3], emptyItems: [] } } },
  { kind: 'route', name: 'route: keyed reshape empty collections parity',
    kern: `route method=post path=/api/t\n  uniqueBy name=distinct in=items by="item.type"\n  groupBy name=by_type in=items by="item.type"\n  partition pass=active fail=inactive in=items where="item.active"\n  indexBy name=by_id in=items by="item.id"\n  countBy name=counts in=items by="item.type"\n  respond 200 json={{ {distinct: distinct, byType: by_type, active: active, inactive: inactive, byId: by_id, counts: counts} }}`,
    bindings: { locals: { items: [] } },
    expected: { status: 200, body: { distinct: [], byType: {}, active: [], inactive: [], byId: {}, counts: {} } } },
  { kind: 'route', name: 'route: keyed reshape key-domain coercion parity',
    kern: `route method=post path=/api/t\n  uniqueBy name=distinct in=items by="item.key"\n  groupBy name=by_key in=items by="item.key"\n  indexBy name=by_key_last in=items by="item.key"\n  countBy name=counts in=items by="item.key"\n  respond 200 json={{ {distinct: distinct, byKey: by_key, byKeyLast: by_key_last, counts: counts} }}`,
    bindings: { locals: { items: [{ id: 'bool', key: true }, { id: 'num', key: 1 }, { id: 'str', key: '1' }, { id: 'num2', key: 1 }, { id: 'null', key: null }, { id: 'false', key: false }] } },
    expected: { status: 200, body: {
      distinct: [{ id: 'bool', key: true }, { id: 'num', key: 1 }, { id: 'str', key: '1' }, { id: 'null', key: null }, { id: 'false', key: false }],
      byKey: { "true": [{ id: 'bool', key: true }], "1": [{ id: 'num', key: 1 }, { id: 'str', key: '1' }, { id: 'num2', key: 1 }], "null": [{ id: 'null', key: null }], "false": [{ id: 'false', key: false }] },
      byKeyLast: { "true": { id: 'bool', key: true }, "1": { id: 'num2', key: 1 }, "null": { id: 'null', key: null }, "false": { id: 'false', key: false } },
      counts: { "true": 1, "1": 3, "null": 1, "false": 1 },
    } } },
  // route-level `let kind=let` binding parity (2026-06-10). At base the route
  // emitters' PORTABLE_TYPES allow-list (express-portable / fastapi-portable /
  // core/handlers) OMITTED `let`, so a route-level `let` child was SILENTLY
  // DROPPED — the dependent `respond` expression then referenced an unbound name
  // (ReferenceError on Express, NameError on FastAPI + pure pipeline). RED at
  // base: route exec error / pure-pipeline exec error on BOTH targets. The fix
  // adds `let` to all three allow-lists; the existing `case 'let'` emitters then
  // bind `name = <expr>` before the respond. A let with a DEPENDENT expression
  // (`base * 2`) is the discriminator — a dropped binding can't produce 84.
  { kind: 'route', name: 'route: let binding feeds a dependent respond expression',
    kern: `route method=post path=/api/t\n  let name=doubled value="base * 2" kind=let\n  respond 200 json={{ {doubled: doubled} }}`,
    bindings: { locals: { base: 42 } }, expected: { status: 200, body: { doubled: 84 } } },
  // A SECOND let reads the FIRST (chained route-level bindings) — kills an impl
  // that emits only the last let or mis-orders the two. tripled = doubled * 3 → 6.
  { kind: 'route', name: 'route: chained let bindings (second reads the first)',
    kern: `route method=post path=/api/t\n  let name=doubled value="base * 2" kind=let\n  let name=tripled value="doubled * 3" kind=let\n  respond 200 json={{ {doubled: doubled, tripled: tripled} }}`,
    bindings: { locals: { base: 1 } }, expected: { status: 200, body: { doubled: 2, tripled: 6 } } },

  // ──────────────────────────────────────────────────────────────────────────
  // route-pipeline: PURE-pipeline-ONLY fixtures (Wave 3 python-decouple parity, 2026-05-31).
  // Each exercises a PureRequest surface the bare-locals `route:` fixtures CAN'T (the
  // monolithic test scaffold has no way to model path_params/query/body/user as the
  // adapter would marshal them — it injects bare module-level locals everywhere). Discriminating
  // by construction: each fixture FAILS a cheating handler that ignores ONE namespace —
  //   • path-param echo: fails an impl that doesn't bind request.path_params
  //   • query-param echo: fails an impl that doesn't bind request.query
  //   • body field echo: fails an impl that doesn't read request.body
  //   • auth-user echo: fails an impl that doesn't read request.user
  //   • multi-step pass / fail: fails an impl that hardcodes the response status (always-200)
  // Red-teamed pre-launch (ORACLE DESIGN GATE) — a "request.get('body', {})" stub
  // that returns 200 + an empty body cannot pass any of these.
  //
  // Numeric query/path types: in production the FastAPI adapter coerces these via its
  // typed signature (FastAPI reads `pathParamTypes`/`queryParamTypes` from the
  // PurePythonHandler). The fixtures pass already-coerced values in the PureRequest dict —
  // simulating the post-adapter shape the handler sees — so a contract change to the
  // type-mapper would manifest here as a divergence at the adapter boundary, not silently.
  // ──────────────────────────────────────────────────────────────────────────
  { kind: 'route-pipeline', name: 'route-pipeline: path-param echo',
    kern: `route method=get path=/api/items/:id\n  respond 200 json={{ {id: params.id} }}`,
    pureRequest: { method: 'GET', path_params: { id: 'abc-42' }, query: {}, body: {}, headers: {}, user: null },
    expected: { status: 200, body: { id: 'abc-42' } } },
  { kind: 'route-pipeline', name: 'route-pipeline: query-param echo',
    kern: `route method=get path=/api/q\n  params q:string\n  respond 200 json={{ {q: q} }}`,
    pureRequest: { method: 'GET', path_params: {}, query: { q: 'hello' }, body: {}, headers: {}, user: null },
    expected: { status: 200, body: { q: 'hello' } } },
  { kind: 'route-pipeline', name: 'route-pipeline: body field echo',
    kern: `route method=post path=/api/b\n  respond 200 json={{ {echoed: body.value} }}`,
    pureRequest: { method: 'POST', path_params: {}, query: {}, body: { value: 'widget' }, headers: {}, user: null },
    expected: { status: 200, body: { echoed: 'widget' } } },
  { kind: 'route-pipeline', name: 'route-pipeline: auth-user echo',
    kern: `route method=get path=/api/me\n  auth\n  respond 200 json={{ {sub: user.sub} }}`,
    pureRequest: { method: 'GET', path_params: {}, query: {}, body: {}, headers: {}, user: { sub: 'user-42' } },
    expected: { status: 200, body: { sub: 'user-42' } } },
  { kind: 'route-pipeline', name: 'route-pipeline: multi-step (path+query+body+derive+guard) pass',
    kern: `route method=post path=/api/users/:id\n  params multiplier:integer\n  derive name=score expr={{ body.base * multiplier }}\n  guard name=floor expr={{ score >= 100 }} else=422\n  respond 200 json={{ {id: params.id, score: score} }}`,
    pureRequest: { method: 'POST', path_params: { id: 'u7' }, query: { multiplier: 25 }, body: { base: 8 }, headers: {}, user: null },
    // Asserts emitter metadata (agon-review codex #2): path params default to str, query
    // gets the declared integer type. Catches a regression that strips/wrongs these without
    // the fixture itself catching it (the runner pre-coerces, mirroring the adapter).
    expectPathParamTypes: { id: 'str' },
    expectQueryParamTypes: { multiplier: 'int' },
    expected: { status: 200, body: { id: 'u7', score: 200 } } },
  { kind: 'route-pipeline', name: 'route-pipeline: multi-step guard-fail returns 422 {detail}',
    kern: `route method=post path=/api/users/:id\n  params multiplier:integer\n  derive name=score expr={{ body.base * multiplier }}\n  guard name=floor expr={{ score >= 100 }} else=422\n  respond 200 json={{ {id: params.id, score: score} }}`,
    pureRequest: { method: 'POST', path_params: { id: 'u7' }, query: { multiplier: 5 }, body: { base: 8 }, headers: {}, user: null },
    expectPathParamTypes: { id: 'str' },
    expectQueryParamTypes: { multiplier: 'int' },
    expected: { status: 422, body: { detail: 'floor guard failed' } } },
  // Wave 3 agon-review codex #1: pure handlers may return (status, body, headers) as the
  // 3-tuple form. A `respond redirect={{ expr }}` lowers to that shape (`return 302, None,
  // {"Location": expr}`). Runner now captures result[2] into JSON output `.headers`; this
  // fixture catches an emitter that silently drops the third tuple slot or a runner that
  // ignores it.
  { kind: 'route-pipeline', name: 'route-pipeline: respond redirect returns 3-tuple with Location header',
    kern: `route method=get path=/api/r\n  respond 302 redirect={{ "/api/next" }}`,
    pureRequest: { method: 'GET', path_params: {}, query: {}, body: {}, headers: {}, user: null },
    expected: { status: 302, body: null, headers: { Location: '/api/next' } } },
  // Wave 3 agon-review agy #2: deep/nested list wrapping. body.matrix is a list-of-lists
  // of dicts; without recursive _wrap, the inner-list elements stay plain dicts and
  // `body.matrix[0][0].value` raises AttributeError. The discrimination here only fires
  // when the fix is missing — green at HEAD, red at the pre-review shim.
  { kind: 'route-pipeline', name: 'route-pipeline: deep list-of-list-of-dict body (recursive __DotDict)',
    kern: `route method=post path=/api/m\n  respond 200 json={{ {echoed: body.matrix[0][0].value} }}`,
    pureRequest: { method: 'POST', path_params: {}, query: {}, body: { matrix: [[{ value: 'deep' }]] }, headers: {}, user: null },
    expected: { status: 200, body: { echoed: 'deep' } } },

  // PARITY GOAL ORACLE (goal: ts-python-parity, 2026-05-27). These RED fixtures
  // encode portable JS methods not yet lowered to Python — the differential
  // proof the codegen-string tests don't give. Each slice is a goal task; the
  // task gate is `node scripts/conformance.mjs --filter "<slice>:"`. Element
  // bindings are bare locals (json.loads on Python). Trap cases are first-class.
  // ──────────────────────────────────────────────────────────────────────────

  // ── arr-more: array methods not lowered → AttributeError / wrong semantics ──
  // sort() is the headline trap: JS default sort is LEXICOGRAPHIC and returns
  // the array; Python list.sort() is numeric AND returns None (in-place).
  { name: 'arr-more: sort() default is lexicographic', expr: 'arr.sort()', path: '/api/a', bindings: { locals: { arr: [10, 2, 1] } }, expected: [1, 10, 2] },
  { name: 'arr-more: sort() numeric comparator', expr: 'arr.sort((a, b) => a - b)', path: '/api/a', bindings: { locals: { arr: [10, 2, 1] } }, expected: [1, 2, 10] },
  { name: 'arr-more: findIndex present', expr: 'arr.findIndex((x) => x === 2)', path: '/api/a', bindings: { locals: { arr: [1, 2, 3] } }, expected: 1 },
  { name: 'arr-more: findIndex missing is -1 (not raise)', expr: 'arr.findIndex((x) => x === 9)', path: '/api/a', bindings: { locals: { arr: [1, 2, 3] } }, expected: -1 },
  { name: 'arr-more: flatMap', expr: 'arr.flatMap((x) => [x, x])', path: '/api/a', bindings: { locals: { arr: [1, 2] } }, expected: [1, 1, 2, 2] },
  { name: 'arr-more: flatMap with a SCALAR return (not iterated)', expr: 'arr.flatMap((x) => x)', path: '/api/a', bindings: { locals: { arr: [1, 2, 3] } }, expected: [1, 2, 3] },
  { name: 'arr-more: findIndex callback using the INDEX param', expr: 'arr.findIndex((v, i) => i === 2)', path: '/api/a', bindings: { locals: { arr: [10, 20, 30] } }, expected: 2 },
  { name: 'arr-more: flat one level', expr: 'arr.flat()', path: '/api/a', bindings: { locals: { arr: [[1, 2], [3]] } }, expected: [1, 2, 3] },
  { name: 'arr-more: at(-1) negative index', expr: 'arr.at(-1)', path: '/api/a', bindings: { locals: { arr: [1, 2, 3] } }, expected: 3 },
  { name: 'arr-more: reverse() returns the reversed array', expr: 'arr.reverse()', path: '/api/a', bindings: { locals: { arr: [1, 2, 3] } }, expected: [3, 2, 1] },
  { name: 'arr-more: concat', expr: 'arr.concat(b)', path: '/api/a', bindings: { locals: { arr: [1, 2], b: [3, 4] } }, expected: [1, 2, 3, 4] },
  { name: 'arr-more: findLast', expr: 'arr.findLast((x) => x < 3)', path: '/api/a', bindings: { locals: { arr: [1, 2, 3] } }, expected: 2 },

  // ── str-more: string methods not lowered → AttributeError on Python ──
  { name: 'str-more: replaceAll (all occurrences)', expr: 's.replaceAll(a, b)', path: '/api/s', bindings: { locals: { s: 'banana', a: 'a', b: 'X' } }, expected: 'bXnXnX' },
  { name: 'str-more: charAt', expr: 's.charAt(i)', path: '/api/s', bindings: { locals: { s: 'banana', i: 2 } }, expected: 'n' },
  { name: 'str-more: at(-1) negative index', expr: 's.at(-1)', path: '/api/s', bindings: { locals: { s: 'banana' } }, expected: 'a' },

  // ── obj-more: Object statics not lowered → NameError on Python ──
  { name: 'obj-more: Object.assign merges', expr: 'Object.assign({}, o1, o2)', path: '/api/o', bindings: { locals: { o1: { a: 1 }, o2: { b: 2 } } }, expected: { a: 1, b: 2 } },
  { name: 'obj-more: Object.fromEntries', expr: 'Object.fromEntries(pairs)', path: '/api/o', bindings: { locals: { pairs: [['a', 1], ['b', 2]] } }, expected: { a: 1, b: 2 } },

  // ── portable-logic-matrix: object/text traps behind the registry contract ──
  { name: 'portable-logic-matrix: Object.keys numeric-like order', expr: 'Object.keys({"2":"two","1":"one","x":"ex"})', path: '/api/pl', bindings: {}, expected: ['1', '2', 'x'] },
  { name: 'portable-logic-matrix: Object.values numeric-like order', expr: 'Object.values({"2":"two","1":"one","x":"ex"})', path: '/api/pl', bindings: {}, expected: ['one', 'two', 'ex'] },
  { name: 'portable-logic-matrix: Object.entries numeric-like order', expr: 'Object.entries({"2":"two","1":"one","x":"ex"})', path: '/api/pl', bindings: {}, expected: [['1', 'one'], ['2', 'two'], ['x', 'ex']] },
  { name: 'portable-logic-matrix: Object.keys number primitive is empty', expr: 'Object.keys(42)', path: '/api/pl', bindings: {}, expected: [] },
  { name: 'portable-logic-matrix: trim NBSP', expr: 's.trim()', path: '/api/pl', bindings: { locals: { s: '\u00a0hi\u00a0' } }, expected: 'hi' },
  { name: 'portable-logic-matrix: split limit keeps first N only', expr: 's.split(",", 2)', path: '/api/pl', bindings: { locals: { s: 'a,b,c,d' } }, expected: ['a', 'b'] },
  { name: 'portable-logic-matrix: split float limit truncates', expr: 's.split(",", 2.9)', path: '/api/pl', bindings: { locals: { s: 'a,b,c,d' } }, expected: ['a', 'b'] },
  { name: 'portable-logic-matrix: split negative limit keeps all', expr: 's.split(",", -1)', path: '/api/pl', bindings: { locals: { s: 'a,b,c,d' } }, expected: ['a', 'b', 'c', 'd'] },
  { name: 'portable-logic-matrix: split uint32 wrap to zero', expr: 's.split(",", 4294967296)', path: '/api/pl', bindings: { locals: { s: 'a,b,c,d' } }, expected: [] },
  { name: 'portable-logic-matrix: split empty separator chars', expr: 's.split("")', path: '/api/pl', bindings: { locals: { s: 'abc' } }, expected: ['a', 'b', 'c'] },
  { name: 'portable-logic-matrix: split empty separator limit', expr: 's.split("", 2)', path: '/api/pl', bindings: { locals: { s: 'abc' } }, expected: ['a', 'b'] },
  { name: 'portable-logic-matrix: split empty separator negative limit', expr: 's.split("", -1)', path: '/api/pl', bindings: { locals: { s: 'abc' } }, expected: ['a', 'b', 'c'] },
  { name: 'portable-logic-matrix: replace first occurrence only', expr: 's.replace("a", "X")', path: '/api/pl', bindings: { locals: { s: 'banana' } }, expected: 'bXnana' },
  { name: 'portable-logic-matrix: replaceAll all occurrences', expr: 's.replaceAll("a", "X")', path: '/api/pl', bindings: { locals: { s: 'banana' } }, expected: 'bXnXnX' },
  { name: 'portable-logic-matrix: replace replacement match token', expr: 's.replace("a", "$&")', path: '/api/pl', bindings: { locals: { s: 'banana' } }, expected: 'banana' },
  { name: 'portable-logic-matrix: replace escaped dollar replacement token', expr: 's.replace("a", "\\u0024&")', path: '/api/pl', bindings: { locals: { s: 'banana' } }, expected: 'banana' },
  { name: 'portable-logic-matrix: replace replacement prefix token', expr: 's.replace("n", "$`")', path: '/api/pl', bindings: { locals: { s: 'banana' } }, expected: 'babaana' },
  { name: 'portable-logic-matrix: replaceAll escaped dollar token', expr: 's.replaceAll("a", "$$")', path: '/api/pl', bindings: { locals: { s: 'banana' } }, expected: 'b$n$n$' },

  // ── math-more: Math.sign not lowered → NameError on Python ──
  { name: 'math-more: Math.sign(-5)', expr: 'Math.sign(x)', path: '/api/m', bindings: { locals: { x: -5 } }, expected: -1 },
  { name: 'math-more: Math.sign(0)', expr: 'Math.sign(x)', path: '/api/m', bindings: { locals: { x: 0 } }, expected: 0 },
  { name: 'math-more: Math.sign(3)', expr: 'Math.sign(x)', path: '/api/m', bindings: { locals: { x: 3 } }, expected: 1 },
  { name: 'math-more: clamp via Math.max/min', expr: 'Math.max(lo, Math.min(hi, value))', path: '/api/m', bindings: { locals: { lo: 0, hi: 10, value: 42 } }, expected: 10 },
  { name: 'math-more: clamp via Math.min/max inverted order', expr: 'Math.min(hi, Math.max(lo, value))', path: '/api/m', bindings: { locals: { lo: 0, hi: 10, value: -5 } }, expected: 0 },

  // ──────────────────────────────────────────────────────────────────────────
  // PARITY GOAL ORACLE — RUN 2 (-extra slices, 2026-05-27). Same differential
  // contract; all probe-verified node==python3 on this machine (incl. libm
  // transcendentals and the toExponential e+0N exponent-pad trap) before commit.
  // ──────────────────────────────────────────────────────────────────────────

  // ── math-extra: math-module functions/constants not lowered → NameError ──
  // NB: Math.cbrt is OUT OF SCOPE — V8's Math.cbrt and platform libm cbrt
  // disagree in the last ulp (Linux: cbrt(27) = 3.0000000000000004 vs V8's 3),
  // so it has no bit-exact Python lowering. macOS libm happens to agree, which
  // hid this locally — CI on Linux is the real cross-platform check.
  { name: 'math-extra: log natural (ln 1 = 0)', expr: 'Math.log(x)', path: '/api/m', bindings: { locals: { x: 1 } }, expected: 0 },
  { name: 'math-extra: log natural (ln 2)', expr: 'Math.log(x)', path: '/api/m', bindings: { locals: { x: 2 } }, expected: Math.log(2) },
  { name: 'math-extra: log2(8)', expr: 'Math.log2(x)', path: '/api/m', bindings: { locals: { x: 8 } }, expected: 3 },
  { name: 'math-extra: log10(1000)', expr: 'Math.log10(x)', path: '/api/m', bindings: { locals: { x: 1000 } }, expected: 3 },
  { name: 'math-extra: exp(0)', expr: 'Math.exp(x)', path: '/api/m', bindings: { locals: { x: 0 } }, expected: 1 },
  { name: 'math-extra: sin(0)', expr: 'Math.sin(x)', path: '/api/m', bindings: { locals: { x: 0 } }, expected: 0 },
  { name: 'math-extra: sin(1) transcendental parity', expr: 'Math.sin(x)', path: '/api/m', bindings: { locals: { x: 1 } }, expected: Math.sin(1) },
  { name: 'math-extra: cos(0)', expr: 'Math.cos(x)', path: '/api/m', bindings: { locals: { x: 0 } }, expected: 1 },
  { name: 'math-extra: atan2(0, 1)', expr: 'Math.atan2(y, x)', path: '/api/m', bindings: { locals: { y: 0, x: 1 } }, expected: 0 },
  { name: 'math-extra: atan2(3, 4) uses BOTH args', expr: 'Math.atan2(y, x)', path: '/api/m', bindings: { locals: { y: 3, x: 4 } }, expected: Math.atan2(3, 4) },
  { name: 'math-extra: PI constant', expr: 'Math.PI', path: '/api/m', bindings: {}, expected: Math.PI },
  { name: 'math-extra: E constant', expr: 'Math.E', path: '/api/m', bindings: {}, expected: Math.E },

  // ── num-extra: Number features not lowered → AttributeError/NameError ──
  { name: 'num-extra: isSafeInteger true', expr: 'Number.isSafeInteger(n)', path: '/api/n', bindings: { locals: { n: 9007199254740991 } }, expected: true },
  { name: 'num-extra: isSafeInteger false', expr: 'Number.isSafeInteger(n)', path: '/api/n', bindings: { locals: { n: 9007199254740992 } }, expected: false },
  { name: 'num-extra: toString(16) hex', expr: 'n.toString(16)', path: '/api/n', bindings: { locals: { n: 255 } }, expected: 'ff' },
  { name: 'num-extra: toString(2) binary', expr: 'n.toString(2)', path: '/api/n', bindings: { locals: { n: 8 } }, expected: '1000' },
  { name: 'num-extra: toString(8) octal', expr: 'n.toString(8)', path: '/api/n', bindings: { locals: { n: 255 } }, expected: '377' },
  { name: 'num-extra: toString(10) is plain decimal', expr: 'n.toString(10)', path: '/api/n', bindings: { locals: { n: 255 } }, expected: '255' },
  // toPrecision is intentionally OUT OF SCOPE: JS keeps trailing zeros
  // ((123).toPrecision(5) === "123.00") and uses a different exponential
  // threshold than Python's %g, which strips zeros — no clean 1:1 lowering.
  { name: 'num-extra: toExponential(2) (JS e+3, not e+03)', expr: 'n.toExponential(2)', path: '/api/n', bindings: { locals: { n: 1234 } }, expected: '1.23e+3' },
  { name: 'num-extra: toExponential(2) negative exponent', expr: 'n.toExponential(2)', path: '/api/n', bindings: { locals: { n: 0.001234 } }, expected: '1.23e-3' },
  { name: 'num-extra: global isNaN(finite) is false', expr: 'isNaN(n)', path: '/api/n', bindings: { locals: { n: 3 } }, expected: false },
  { name: 'num-extra: global isFinite(finite) is true', expr: 'isFinite(n)', path: '/api/n', bindings: { locals: { n: 3 } }, expected: true },

  // ── str-extra: string methods not lowered → AttributeError on Python ──
  { name: 'str-extra: trimStart', expr: 's.trimStart()', path: '/api/s', bindings: { locals: { s: '  hi ' } }, expected: 'hi ' },
  { name: 'str-extra: trimEnd', expr: 's.trimEnd()', path: '/api/s', bindings: { locals: { s: ' hi  ' } }, expected: ' hi' },
  { name: 'str-extra: charCodeAt', expr: 's.charCodeAt(i)', path: '/api/s', bindings: { locals: { s: 'ABC', i: 1 } }, expected: 66 },
  { name: 'str-extra: codePointAt', expr: 's.codePointAt(i)', path: '/api/s', bindings: { locals: { s: 'ABC', i: 0 } }, expected: 65 },
  { name: 'str-extra: lastIndexOf present', expr: 's.lastIndexOf(sub)', path: '/api/s', bindings: { locals: { s: 'banana', sub: 'a' } }, expected: 5 },
  { name: 'str-extra: lastIndexOf MULTI-char substring', expr: 's.lastIndexOf(sub)', path: '/api/s', bindings: { locals: { s: 'banana', sub: 'ana' } }, expected: 3 },
  { name: 'str-extra: lastIndexOf missing is -1', expr: 's.lastIndexOf(sub)', path: '/api/s', bindings: { locals: { s: 'banana', sub: 'z' } }, expected: -1 },
  { name: 'str-extra: charCodeAt out of range is null (not a crash)', expr: 's.charCodeAt(i)', path: '/api/s', bindings: { locals: { s: 'ABC', i: 99 } }, expected: null },
  { name: 'str-extra: String.fromCharCode', expr: 'String.fromCharCode(c)', path: '/api/s', bindings: { locals: { c: 65 } }, expected: 'A' },
  { name: 'str-extra: String.fromCharCode() no args is empty string', expr: 'String.fromCharCode()', path: '/api/s', bindings: {}, expected: '' },

  // ── arr-extra: array methods not lowered → AttributeError/wrong semantics ──
  { name: 'arr-extra: fill', expr: 'arr.fill(v)', path: '/api/a', bindings: { locals: { arr: [1, 2, 3], v: 0 } }, expected: [0, 0, 0] },
  { name: 'arr-extra: fill(value, start, end) range only', expr: 'arr.fill(v, 1, 3)', path: '/api/a', bindings: { locals: { arr: [1, 2, 3, 4], v: 0 } }, expected: [1, 0, 0, 4] },
  { name: 'arr-extra: fill explicit undefined end means len', expr: 'arr.fill(v, 1, undefined)', path: '/api/a', bindings: { locals: { arr: [1, 2, 3], v: 0 } }, expected: [1, 0, 0] },
  { name: 'arr-extra: fill grouped undefined end means len', expr: 'arr.fill(v, 1, (undefined))', path: '/api/a', bindings: { locals: { arr: [1, 2, 3], v: 0 } }, expected: [1, 0, 0] },
  { name: 'arr-extra: fill void 0 end means len', expr: 'arr.fill(v, 1, void 0)', path: '/api/a', bindings: { locals: { arr: [1, 2, 3], v: 0 } }, expected: [1, 0, 0] },
  { name: 'arr-extra: fill void (0) end means len', expr: 'arr.fill(v, 1, void (0))', path: '/api/a', bindings: { locals: { arr: [1, 2, 3], v: 0 } }, expected: [1, 0, 0] },
  { name: 'arr-extra: fill void ( 0 ) end means len', expr: 'arr.fill(v, 1, void ( 0 ))', path: '/api/a', bindings: { locals: { arr: [1, 2, 3], v: 0 } }, expected: [1, 0, 0] },
  { name: 'arr-extra: fill void 1 end means len', expr: 'arr.fill(v, 1, void 1)', path: '/api/a', bindings: { locals: { arr: [1, 2, 3], v: 0 } }, expected: [1, 0, 0] },
  { name: 'arr-extra: fill undefined start means zero', expr: 'arr.fill(v, undefined)', path: '/api/a', bindings: { locals: { arr: [1, 2, 3], v: 0 } }, expected: [0, 0, 0] },
  { name: 'arr-extra: fill void start means zero', expr: 'arr.fill(v, void 0)', path: '/api/a', bindings: { locals: { arr: [1, 2, 3], v: 0 } }, expected: [0, 0, 0] },
  { name: 'arr-extra: fill explicit null end means zero', expr: 'arr.fill(v, 0, null)', path: '/api/a', bindings: { locals: { arr: [1, 2, 3], v: 0 } }, expected: [1, 2, 3] },
  { name: 'arr-extra: fill void end evaluates operand before len', expr: '[arr.fill(v, 1, void arr.push(9)), arr]', path: '/api/a', bindings: { locals: { arr: [1, 2, 3], v: 0 } }, expected: [[1, 0, 0, 0], [1, 0, 0, 0]] },
  { name: 'arr-extra: fill mutates receiver and returns it', expr: '[arr.fill(v, 1, 2), arr]', path: '/api/a', bindings: { locals: { arr: [1, 2, 3], v: 0 } }, expected: [[1, 0, 3], [1, 0, 3]] },
  { name: 'arr-extra: lastIndexOf present', expr: 'arr.lastIndexOf(v)', path: '/api/a', bindings: { locals: { arr: [1, 2, 1], v: 1 } }, expected: 2 },
  { name: 'arr-extra: lastIndexOf missing is -1', expr: 'arr.lastIndexOf(v)', path: '/api/a', bindings: { locals: { arr: [1, 2, 3], v: 9 } }, expected: -1 },
  { name: 'arr-extra: findLastIndex', expr: 'arr.findLastIndex((x) => x === 2)', path: '/api/a', bindings: { locals: { arr: [1, 2, 3, 2] } }, expected: 3 },
  { name: 'arr-extra: reduceRight (no seed, order matters)', expr: 'arr.reduceRight((a, b) => a + b)', path: '/api/a', bindings: { locals: { arr: ['a', 'b', 'c'] } }, expected: 'cba' },
  { name: 'arr-extra: Array.of', expr: 'Array.of(a, b, c)', path: '/api/a', bindings: { locals: { a: 1, b: 2, c: 3 } }, expected: [1, 2, 3] },

  // ── op-extra: operators whose Python pass-through DIVERGES from JS ──
  { name: 'op-extra: % follows DIVIDEND sign (-7 % 3 = -1, not 2)', expr: 'a % b', path: '/api/o', bindings: { locals: { a: -7, b: 3 } }, expected: -1 },
  { name: 'op-extra: % positive', expr: 'a % b', path: '/api/o', bindings: { locals: { a: 7, b: 3 } }, expected: 1 },
  { name: 'op-extra: % negative divisor (dividend sign wins: 7 % -3 = 1)', expr: 'a % b', path: '/api/o', bindings: { locals: { a: 7, b: -3 } }, expected: 1 },
  { name: 'op-extra: % keeps the fraction for floats (5.5 % 2 = 1.5)', expr: 'a % b', path: '/api/o', bindings: { locals: { a: 5.5, b: 2 } }, expected: 1.5 },
  { name: 'op-extra: >>> unsigned (-1 >>> 0 = 4294967295)', expr: 'a >>> b', path: '/api/o', bindings: { locals: { a: -1, b: 0 } }, expected: 4294967295 },
  { name: 'op-extra: >>> shift (256 >>> 2 = 64)', expr: 'a >>> b', path: '/api/o', bindings: { locals: { a: 256, b: 2 } }, expected: 64 },
  { name: 'op-extra: ?? null coalesces', expr: 'a ?? b', path: '/api/o', bindings: { locals: { a: null, b: 5 } }, expected: 5 },
  { name: 'op-extra: ?? keeps falsy 0 (null-only, not falsy)', expr: 'a ?? b', path: '/api/o', bindings: { locals: { a: 0, b: 5 } }, expected: 0 },
  { name: 'op-extra: ?? keeps empty string (null-only, not falsy)', expr: 'a ?? b', path: '/api/o', bindings: { locals: { a: '', b: 'x' } }, expected: '' },
  { name: 'op-extra: ?? with a string-literal operand containing stop chars', expr: 'a ?? "x:y?z"', path: '/api/o', bindings: { locals: { a: null } }, expected: 'x:y?z' },
  // ── R1 probe (job-central residual): Set.has / Date.getTime / logical-not ──
  // Probes whether dev's parity engine already covers these. Whatever is RED is
  // the genuine net-new gap to implement (Math.round already lands on dev).
  { name: 'R1 probe: Set dedup merge (mergeDefaults)', expr: '[...stored, ...defaults.filter((d) => !new Set(stored.map((s) => s.id)).has(d.id))]', path: '/api/r1m', bindings: { locals: { stored: [{ id: 'a' }, { id: 'b' }], defaults: [{ id: 'b' }, { id: 'c' }] } }, expected: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
  { name: 'R1 probe: Set membership present/absent', expr: '[new Set(ids).has("b"), new Set(ids).has("z")]', path: '/api/r1s', bindings: { locals: { ids: ['a', 'b', 'c'] } }, expected: [true, false] },
  { name: 'R1 probe: Date diff in days', expr: 'Math.round((new Date(target).getTime() - new Date(today).getTime()) / 86400000)', path: '/api/r1d', bindings: { locals: { target: '2026-06-10', today: '2026-06-03' } }, expected: 7 },
  { name: 'R1 probe: Date from numeric epoch-ms', expr: 'new Date(ms).getTime()', path: '/api/r1n', bindings: { locals: { ms: 86400000 } }, expected: 86400000 },
  { name: 'R1 probe: logical not and double-not', expr: '{ a: !flag, b: !!flag }', path: '/api/r1not', bindings: { locals: { flag: false } }, expected: { a: true, b: false } },

  // ──────────────────────────────────────────────────────────────────────────
  // whole-file: FULL multi-declaration .kern modules (kind:'whole-file', 2026-06-10).
  // Each is a self-contained KERN module (classes + helper fns + a zero-arg `fn probe`),
  // compiled via the SAME `generateCoreNode` / `generatePythonCoreNode` entry
  // class-conformance.mjs uses, run on BOTH targets, and asserted ts == python == expected.
  // Where the expression/route/stmt harnesses prove ONE construct in isolation, these prove
  // CROSS-DECLARATION interaction (a method mutating a field a fn constructs, a helper fn shared
  // by two fns, closures sharing a captured binding inside a class method, an inheritance chain,
  // an array pipeline crossing a class field and a helper fn). They are GREEN at base by design
  // — integration guards, not RED gap-fillers: they catch a regression that breaks the SEAM
  // between two already-working features. `skip: ['python'|'node']` drops a target (none needed
  // yet); `expectedStdout` (line array) compares raw stdout instead of probe()'s JSON value.
  { kind: 'whole-file', name: 'whole-file: class field-mutate method + fn constructs the instance',
    kern: `class name=Counter export=true
  field name=n type=number value={{ 0 }}
  method name=bump returns=number
    handler
      assign target="this.n" value="this.n + 1"
      return value="this.n"
fn name=make returns=Counter
  handler
    return value="new Counter()"
fn name=probe returns=number
  handler
    let name=c value="make()"
    do value="c.bump()"
    do value="c.bump()"
    return value="c.bump()"`,
    expected: 3 },
  { kind: 'whole-file', name: 'whole-file: helper fn shared by two fns',
    kern: `fn name=dbl returns=number
  param name=x type=number
  handler
    return value="x * 2"
fn name=addtwo returns=number
  param name=a type=number
  param name=b type=number
  handler
    return value="dbl(a) + dbl(b)"
fn name=probe returns=number
  handler
    return value="addtwo(3, 4) + dbl(1)"`,
    expected: 16 },
  { kind: 'whole-file', name: 'whole-file: two closures share one captured binding inside a class method (MUT6 shape)',
    kern: `class name=Box export=true
  method name=run returns=number
    handler
      let name=count value="0" kind=let
      let name=inc value="() => { count++; return 0; }"
      let name=get value="() => { return count; }"
      do value="inc()"
      do value="inc()"
      return value="get()"
fn name=probe returns=number
  handler
    return value="new Box().run()"`,
    expected: 2 },
  { kind: 'whole-file', name: 'whole-file: two-class inheritance chain used by a probe fn',
    kern: `class name=Animal export=true
  field name=legs type=number value={{ 4 }}
  method name=describe returns=string
    handler
      return value="\`legs=\${this.legs}\`"
class name=Dog extends=Animal export=true
  method name=speak returns=string
    handler
      return value="\`\${this.describe()} woof\`"
fn name=probe returns=string
  handler
    return value="new Dog().speak()"`,
    expected: 'legs=4 woof' },
  { kind: 'whole-file', name: 'whole-file: array pipeline map+filter+reduce across a class field and a helper fn',
    kern: `class name=Box export=true
  field name=data type=number[] value={{ [1, 2, 3, 4, 5] }}
  method name=evens returns=number[]
    handler
      return value="this.data.filter((x) => x % 2 === 0)"
fn name=total returns=number
  param name=xs type=number[]
  handler
    return value="xs.map((x) => x * 10).reduce((a, b) => a + b, 0)"
fn name=probe returns=number
  handler
    return value="total(new Box().evens())"`,
    expected: 60 },
  // Council seed #6 wanted a multi-line `expectedStdout` line-by-line compare exercising an
  // each-loop print. VERIFIED: the native KERN body dialect has NO portable print/log primitive
  // (a `log value=...` node is silently dropped on both targets), so a stdout-emitting fixture
  // cannot be authored in-dialect. Shipped as a VALUE fixture that builds the array via an
  // each-loop instead; the `expectedStdout` line-by-line path is DEFERRED until a print
  // primitive exists. The runner still supports `expectedStdout` (raw-stdout line compare) for
  // when it lands.
  { kind: 'whole-file', name: 'whole-file: each-loop builds a string array (expectedStdout deferred — no print primitive)',
    kern: `fn name=probe returns=string[]
  handler lang=kern
    let name=out value="[]"
    each name=x in="[1, 2, 3]"
      do value="out.push(\`line-\${x}\`)"
    return value="out"`,
    expected: ['line-1', 'line-2', 'line-3'] },
  // Milestone 5.1b — self-hosting blockers lifted from the reference runner
  // (recursion, dynamic-index arithmetic, List/Map stdlib). These fixtures
  // prove TS-leg/Python-leg parity for the SAME KERN source the reference
  // runner now executes natively (see packages/core/tests/ir-semantics-do.test.ts,
  // runner-stdlib-namespace-calls.test.ts, runner-dynamic-index.test.ts, and
  // runner-source-executor.test.ts for the reference-runner-side coverage —
  // this harness does not exercise the reference runner, only TS vs Python).
  { kind: 'whole-file', name: 'whole-file: same-file recursive helper computes factorial(5)',
    kern: `fn name=factorial returns=number
  param name=n type=number
  handler lang=kern
    if cond="n <= 1"
      return value="1"
    return value="n * factorial(n - 1)"
fn name=probe returns=number
  handler lang=kern
    return value="factorial(5)"`,
    expected: 120 },
  // NOTE: helper names are deliberately single lowercase words (`even`/`odd`),
  // NOT camelCase (`isEven`/`isOdd`) — a camelCase top-level `fn` name hits a
  // PRE-EXISTING, unrelated Python codegen bug where a multi-word function
  // DEFINITION is snake_cased (`def is_even(...)`) but CROSS-FUNCTION CALL
  // SITES are not renamed to match (`return isEven(10)` -> NameError). That
  // bug is orthogonal to this milestone (recursion works fine at the
  // reference-runner level with the same names — see
  // runner-source-executor.test.ts's mutual-recursion test); it lives in the
  // shared multi-declaration Python module compiler and is out of scope here.
  { kind: 'whole-file', name: 'whole-file: mutually recursive helpers compute even/odd',
    kern: `fn name=even returns=boolean
  param name=n type=number
  handler lang=kern
    if cond="n == 0"
      return value="true"
    return value="odd(n - 1)"
fn name=odd returns=boolean
  param name=n type=number
  handler lang=kern
    if cond="n == 0"
      return value="false"
    return value="even(n - 1)"
fn name=probe returns=boolean
  handler lang=kern
    return value="even(10)"`,
    expected: true },
  { kind: 'whole-file', name: 'whole-file: dynamic array index reads accept +/- arithmetic on a loop counter',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=xs value="[10, 20, 30]"
    let name=out value="[]"
    for name=i from="0" to="2"
      do value="out.push(xs[i + 1])"
    return value="out"`,
    expected: [20, 30] },
  { kind: 'whole-file', name: 'whole-file: List.length + new Map()/Map.set/Map.get/Map.has round-trip',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=xs value="[1, 2, 3]"
    let name=m value="new Map()"
    do value="Map.set(m, \\"a\\", 1)"
    return value="[List.length(xs), Map.get(m, \\"a\\"), Map.has(m, \\"a\\") ? 1 : 0, Map.has(m, \\"missing\\") ? 1 : 0]"`,
    expected: [3, 1, 1, 0] },

  // ──────────────────────────────────────────────────────────────────────────
  // compile-reject: sources KERN must REJECT, asserting the EXACT reason at every layer that
  // rejects (kind:'compile-reject', 2026-06-10). The runner tries parse / TS codegen / Python
  // codegen; for each layer that throws, the message MUST contain `expectReason`. ≥1 layer must
  // reject with the reason; any layer that rejects with a DIFFERENT reason is a real TS↔Python
  // lockstep bug (a failure, not papered over). Target note: rejects are target-neutral
  // (eligibility, surfaced on BOTH TS+Python codegen) or Python-side; there is no separate TS
  // reject path to invent.
  //
  // REASON-CODE VERIFICATION (council's hallucinated codes vs the REAL thrown strings):
  //   • closure-this                  — REAL: `Unsupported closure body (closure-this) at column N.`
  //                                      rejects on BOTH TS + Python codegen (eligibility).
  //   • closure-assign-value-position — REAL: `Unsupported closure body (closure-assign-value-position) …`
  //                                      rejects on BOTH TS + Python codegen (eligibility).
  //   • closure-pinned-write          — NOT a literal string. The conceptual `closure-pinned-write`
  //                                      surfaces as the Python-emission throw
  //                                      `… per-iteration loop capture …` (TS codegen is OK — this
  //                                      is the genuine TS↔Python asymmetry the slice guards), so
  //                                      expectReason is the real substring, not the council's code.
  //   • instanceof-rhs-wrapper-rejected — REAL substring of the Python throw
  //                                      `instanceof RHS 'String' has no Python lowering
  //                                      (instanceof-rhs-wrapper-rejected). …` (Python-side only).
  { kind: 'compile-reject', name: 'compile-reject: closure writes this.x (closure-this)',
    kern: `fn name=probe returns=number
  handler lang=kern
    let name=f value="() => { this.x = 1; return 0; }"
    return value="f()"`,
    expectReason: 'closure-this', rejectLayers: ['ts-codegen', 'python-codegen'] },
  { kind: 'compile-reject', name: 'compile-reject: closure value-position assignment (closure-assign-value-position)',
    kern: `fn name=probe returns=number
  handler lang=kern
    let name=x value="0" kind=let
    let name=f value="() => { let y = (x = 1); return y; }"
    return value="f()"`,
    expectReason: 'closure-assign-value-position', rejectLayers: ['ts-codegen', 'python-codegen'] },
  // NEEDS a loop: a closure inside `each` that WRITES the per-iteration loop var. Python emission
  // fails closed (the per-iteration pin freezes a value a `nonlocal` write would mis-target);
  // TS codegen is fine — the asymmetry IS the point. expectReason is the real message substring.
  { kind: 'compile-reject', name: 'compile-reject: closure writes a per-iteration loop capture (closure-pinned-write)',
    kern: `fn name=probe returns=number[]
  handler lang=kern
    let name=fns value="[]"
    each name=x in="[0, 1, 2]"
      do value="fns.push(() => { x = x + 1; return x; })"
    return value="fns"`,
    expectReason: 'per-iteration loop capture', rejectLayers: ['python-codegen'] },
  { kind: 'compile-reject', name: 'compile-reject: x instanceof String (instanceof-rhs-wrapper-rejected)',
    kern: `fn name=probe returns=boolean
  handler lang=kern
    let name=x value="\\"a\\""
    return value="x instanceof String"`,
    expectReason: 'instanceof-rhs-wrapper-rejected', rejectLayers: ['python-codegen'] },
];

// ── Value → literal emitters ────────────────────────────────────────────────
const pyVal = (v) => {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  // json.loads gives correct Python objects for everything else (incl. nested).
  return `json.loads(${JSON.stringify(JSON.stringify(v))})`;
};

function buildPython(loweredExpr, bindings, imports) {
  const lines = ['import json', ...imports];
  // `locals` model derived variables / declared params bound bare on both
  // targets (e.g. a prior `derive`, or a query param the route signature binds).
  for (const [k, v] of Object.entries(bindings.locals ?? {})) lines.push(`${k} = ${pyVal(v)}`);
  for (const [k, v] of Object.entries(bindings.params ?? {})) lines.push(`${k} = ${pyVal(v)}`);
  for (const [k, v] of Object.entries(bindings.query ?? {})) lines.push(`${k} = ${pyVal(v)}`);
  // Pydantic-like body: attribute access works (recursively, so body.user.id
  // resolves), .model_dump() returns a dict, but the object itself is NOT a
  // mapping (so a naive {**body} raises) — mirroring Pydantic v2.
  const bodyEntries = Object.entries(bindings.body ?? {});
  lines.push('class _Body:');
  lines.push('    def __init__(self, d):');
  lines.push('        self._d = d');
  lines.push('        for k, v in d.items(): setattr(self, k, _Body(v) if isinstance(v, dict) else v)');
  lines.push('    def model_dump(self): return dict(self._d)');
  const bodyDict = `{${bodyEntries.map(([k, v]) => `${JSON.stringify(toSnakeCase(k))}: ${pyVal(v)}`).join(', ')}}`;
  lines.push(`body = _Body(${bodyDict})`);
  const hdr = bindings.headers ?? {};
  // HTTP headers are case-insensitive on both targets (Express lowercases,
  // Starlette's Headers is case-insensitive); mirror that here.
  lines.push('class _Headers:');
  lines.push('    def __init__(self, d): self._d = {k.lower(): v for k, v in d.items()}');
  lines.push('    def get(self, k, default=None): return self._d.get(k.lower(), default)');
  lines.push('class _Req:');
  lines.push('    def __init__(self, h): self.headers = _Headers(h)');
  lines.push(`request = _Req(${pyVal(hdr)})`);
  lines.push(`user = ${pyVal(bindings.user ?? {})}`);
  lines.push(`print(json.dumps(${loweredExpr}, default=str, sort_keys=True))`);
  return lines.join('\n');
}

function buildNode(loweredExpr, bindings) {
  // Express lowercases req.headers keys — mirror that for case-insensitive parity.
  const headers = Object.fromEntries(Object.entries(bindings.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const req = {
    params: bindings.params ?? {},
    query: bindings.query ?? {},
    body: bindings.body ?? {},
    headers,
    user: bindings.user ?? {},
  };
  // Guard older Node: ensure a global `crypto` with randomUUID exists.
  const preamble = "import { webcrypto } from 'node:crypto'; if (!globalThis.crypto) globalThis.crypto = webcrypto;\n";
  // `locals` are bound bare on both targets (derived vars / route-bound params).
  const localLines = Object.entries(bindings.locals ?? {})
    .map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`)
    .join('\n');
  return `${preamble}${localLines}\nconst req = ${JSON.stringify(req)};\nconsole.log(JSON.stringify(${loweredExpr}));`;
}

// ── Pure-pipeline runner (Wave 3) ────────────────────────────────────────────
// Lowers a route IR through `emitPureHandlers`, builds a self-contained Python file
// (handler def + __DotDict shim + module-level locals + hand-built PureRequest +
// invocation), runs python3, and parses the {status, body} the handler returned.
//
// PureRequest contract (PurePythonHandler doc): { method, path_params, query, body,
// headers, user }. Fixtures may set `fx.pureRequest` to override defaults (empty
// namespaces + null user); bare `fx.bindings.locals` are bound at MODULE scope so
// they're visible to the handler body via Python's LEGB lookup — mirroring the
// monolithic route path which also injects locals at module scope (route.py:749).
//
// The __DotDict shim is byte-identical to the one targets/python.ts emits (the
// `emit:'backend'` preamble) so the handler's `request = __DotDict(request)` and
// `body = __DotDict(...)` lines execute under the same semantics they would in
// production. Diverging the shim here would mask production-shim bugs.
function pyDictLiteral(obj) {
  return `{${Object.entries(obj).map(([k, v]) => `${JSON.stringify(k)}: ${pyVal(v)}`).join(', ')}}`;
}
// The shim is imported from the production target as `DOT_DICT_SHIM_PY` (see the import
// above). The legacy local constant `__PURE_DOT_DICT_SHIM` is kept as an alias for the rest
// of the file — single source of truth, zero drift risk.
const __PURE_DOT_DICT_SHIM = DOT_DICT_SHIM_PY.trimEnd();

// Wave 3 round-3 agon-review (kimi 0.75 + claude 0.60): the list-idempotency fix shipped
// without an automated regression test, so a future revert to `[_wrap(x) for x in val]` (no
// `_DotList` marker) would silently keep conformance green. The bug surface is reference
// identity + post-access mutation — patterns the route-DSL fixtures can't naturally produce.
// This probe runs the shim directly with python3 and asserts the three invariants the fix
// guarantees: (a) container identity (`o.x is o.x`), (b) late-mutation persistence
// (`r = o.x; o.x.append(...); r is o.x`), and (c) post-access plain-dict append still wraps
// (`o.x.append({...}); o.x[0].a` works — the codex round-3 regression case). NB: use `rows`
// (not `items` — collides with dict.items builtin) per codex/claude round-3 nit.
function runShimRegressionProbe() {
  const tmp = mkdtempSync(join(tmpdir(), 'kern-shim-probe-'));
  const probeFile = join(tmp, 'shim-probe.py');
  writeFileSync(
    probeFile,
    `${__PURE_DOT_DICT_SHIM}

# (a) container identity preserved across re-access
o = __DotDict({"rows": [1, 2]})
a = o.rows
b = o.rows
assert a is b, "identity broken: a is not b"

# (b) late mutation persists — appending via the dotted path reaches the held reference
o2 = __DotDict({"tags": []})
r = o2.tags
o2.tags.append(99)
assert r is o2.tags, "ref orphaned after dotted mutation"
assert r == [99], f"r should be [99], got {r}"

# (c) post-access plain-dict append still wraps on next read (codex round-3 regression case)
o3 = __DotDict({"rows": []})
rs = o3.rows
rs.append({"a": 1})
assert o3.rows[0].a == 1, f"AttributeError expected, got {o3.rows[0]}"

# (d) deep nested list of dicts (round-2 fixture, sanity)
o4 = __DotDict({"matrix": [[{"value": "deep"}]]})
assert o4.matrix[0][0].value == "deep"

print("OK")
`,
  );
  const out = execFileSync('python3', [probeFile], { encoding: 'utf8', timeout: 10_000 }).trim();
  rmSync(tmp, { recursive: true, force: true });
  if (out !== 'OK') {
    throw new Error(`__DotDict shim regression probe failed: ${out}`);
  }
}
function runPurePipeline(fx, dir) {
  const root = parse(fx.kern);
  const serverNode = root.type === 'server' ? root : { type: 'server', children: [root] };
  const imports = new Set();
  const handlers = emitPureHandlers(serverNode, imports, root);
  if (handlers.length !== 1) {
    throw new Error(`pure pipeline expected 1 handler, emitter returned ${handlers.length}`);
  }
  const [h] = handlers;
  // Bare module-level locals are how `route` fixtures model "values visible to the handler"
  // without going through PureRequest (they're test-only constructs — production routes
  // derive these from request.body/query/path). Object/array locals need attribute access
  // (e.g. `item.active` in a `collect` comparator), so wrap them in __DotDict the same way
  // production code wraps body/request. Primitives pass through unchanged.
  const locals = fx.bindings?.locals ?? {};
  const localsLines = Object.entries(locals)
    .map(([k, v]) => {
      if (v === null || typeof v !== 'object') return `${k} = ${pyVal(v)}`;
      if (Array.isArray(v)) {
        return `${k} = [__DotDict(x) if isinstance(x, dict) else x for x in ${pyVal(v)}]`;
      }
      return `${k} = __DotDict(${pyVal(v)})`;
    })
    .join('\n');
  const pureRequest = fx.pureRequest ?? {
    method: h.method,
    path_params: {},
    query: {},
    body: {},
    headers: {},
    user: null,
  };
  // Wave 3 agon-review follow-up (codex round 1 + claude round 2 + round 3 ×4): assert the
  // emitted handler's type metadata for path/query params so a regression in `pathParamTypes`/
  // `queryParamTypes` (or a re-coercion pass that silently strips them) doesn't slip past.
  // The runner feeds already-coerced values into PureRequest by design (matching what the
  // FastAPI adapter emits at the signature boundary), so the handler alone can't catch a
  // metadata drift.
  //
  // CAVEAT (round 3 — agy 1.00, kimi 0.80, claude 0.80, zai 0.85 all convergent): the obvious
  // `JSON.stringify(o, Object.keys(o).sort())` form uses the ARRAY replacer, which is a
  // recursive PROPERTY ALLOWLIST applied at every nesting level — any nested key absent from
  // the top-level array is SILENTLY DROPPED. Current `pathParamTypes`/`queryParamTypes` are
  // flat `Record<string,string>`, so it'd work today; but a future nested schema (e.g.
  // `{id: {type: 'int', required: true}}`) would have its inner keys vanish, masking real
  // drift. The replacer-function form below recurses and sorts keys at every depth.
  const stableJson = (o) =>
    JSON.stringify(o, (_, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
        : v,
    );
  if (fx.expectPathParamTypes) {
    const got = stableJson(h.pathParamTypes ?? {});
    const want = stableJson(fx.expectPathParamTypes);
    if (got !== want) {
      throw new Error(`pathParamTypes mismatch: got ${got}, want ${want}`);
    }
  }
  if (fx.expectQueryParamTypes) {
    const got = stableJson(h.queryParamTypes ?? {});
    const want = stableJson(fx.expectQueryParamTypes);
    if (got !== want) {
      throw new Error(`queryParamTypes mismatch: got ${got}, want ${want}`);
    }
  }
  const pureRequestLiteral = pyDictLiteral(pureRequest);
  const importLines = [...imports].join('\n');
  const pyFile = join(dir, 'route-pure.py');
  writeFileSync(
    pyFile,
    `import json
${importLines}
${__PURE_DOT_DICT_SHIM}
${localsLines}
${h.signature}
${h.bodyLines.join('\n')}

pure_request = ${pureRequestLiteral}
result = ${h.fnName}(pure_request)
if isinstance(result, tuple):
    status = result[0]
    body = result[1] if len(result) > 1 else None
    headers = result[2] if len(result) > 2 else None
else:
    status, body, headers = 200, result, None
out = {"status": status, "body": body}
if headers is not None:
    out["headers"] = headers
print(json.dumps(out, sort_keys=True, default=str))
`,
  );
  try {
    return JSON.parse(execFileSync('python3', [pyFile], { encoding: 'utf8', timeout: 10_000 }).trim());
  } catch (err) {
    // Wave 3 agon-review follow-up (agy #4): surface the Python traceback from err.stderr
    // when execFileSync fails. Without this the catch block in the runner sees only
    // err.message ("Command failed: python3 …") and drops the real stack trace.
    const detail = err.stderr ? String(err.stderr).trim() : '';
    if (detail) err.message = `${err.message}\n${detail}`;
    throw err;
  }
}

// ── Comparison ───────────────────────────────────────────────────────────────
function shapeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.map(shapeOf);
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = shapeOf(v[k]);
    return o;
  }
  return typeof v;
}
function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortValue(v[k]);
    return o;
  }
  return v;
}
// Both targets serialize key order differently (Python sort_keys vs JS
// insertion order), so canonicalize key order before comparing values.
const canon = (v, mode) => JSON.stringify(mode === 'shape' ? shapeOf(v) : sortValue(v));

// ── Runner ───────────────────────────────────────────────────────────────────
const filter = (() => {
  const i = process.argv.indexOf('--filter');
  if (i < 0) return null;
  if (process.argv[i + 1] == null) {
    console.error('--filter requires a value');
    process.exit(2);
  }
  return process.argv[i + 1];
})();
// --exclude drops fixtures whose name contains ANY of the comma-separated
// substrings — lets a CI/goal gate run the green baseline while one or more
// slices of RED goal fixtures are mid-flight. A single substring still works
// (`--exclude "-more:"`); a comma-list excludes several non-adjacent slices at
// once (`--exclude "arr-more:,str-more:,math-extra:"`) without also dropping a
// green sibling like obj-more that a broad `-more:` substring would catch.
const exclude = (() => {
  const i = process.argv.indexOf('--exclude');
  if (i < 0) return [];
  if (process.argv[i + 1] == null) {
    console.error('--exclude requires a value');
    process.exit(2);
  }
  return process.argv[i + 1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
})();
const dir = mkdtempSync(join(tmpdir(), 'kern-conf-'));
process.on('exit', () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    // tmpdir cleanup on process exit is best-effort — never crash the test run on it
    // (the OS reaps the directory on its own). Surface as a soft warning so the silent-fail
    // is observable in logs. (kern-guard ignored-error finding — Wave 3 PR #354.)
    console.warn(`conformance: tmpdir cleanup failed: ${err?.message ?? err}`);
  }
});

// Wave 3 round-3 regression guard: run the __DotDict shim probe before any fixture so a
// production-shim regression fails LOUD (`process.exit(1)`) rather than silently sliding
// past the route-DSL-restricted fixtures. Skipped when --filter is set so single-slice goal
// runs don't pay the probe cost; the probe is a global invariant, not a fixture.
if (!filter) {
  try {
    runShimRegressionProbe();
  } catch (err) {
    console.error(`\n__DotDict shim regression: ${err.message}`);
    process.exit(1);
  }
}

let pass = 0;
const failures = [];

let selected = 0;
for (const fx of FIXTURES) {
  if (filter && !fx.name.includes(filter)) continue;
  if (exclude.some((ex) => fx.name.includes(ex))) continue;
  selected++;

  // ── statement-level branch: lower a native `lang=kern` BODY to both targets, run in
  // isolated subprocesses, strict-compare the RETURN value (ts == py == golden). Expression
  // fixtures below are untouched. Strict JSON.parse => non-JSON/non-zero-exit fails loud (no masking).
  if (fx.kind === 'stmt') {
    try {
      const sig = fx.params.map((p) => `${p.name}:${p.type}`).join(',');
      const kern = `screen name=S\n  callback name=fn params="${sig}"\n    handler lang=kern\n` +
        fx.body.split('\n').map((l) => `      ${l}`).join('\n');
      const handler = ((function find(n) {
        if (!n) return null;
        if (n.type === 'handler') return n;
        for (const c of n.children ?? []) { const h = find(c); if (h) return h; }
        return null;
      })(parse(kern)));
      if (!handler) throw new Error('no handler node parsed');
      const ts = emitNativeKernBodyTSWithImports(handler);
      const names = fx.params.map((p) => p.name);
      // Pass param names as outerBindings so an inner-block `let` that shadows
      // a param triggers the block-scope rename (nero Challenge 2 fix).
      const pyEmit = emitNativeKernBodyPythonWithImports(handler, { outerBindings: names });
      const tsFile = join(dir, 'stmt.mjs');
      const pyFile = join(dir, 'stmt.py');
      // Prepend the SAME stdlib preamble the production pipeline injects via
      // `applyKernStdlibPreamble` (e.g. the D1b `__kern_loose_eq` helper) so the
      // emitted body's helper calls resolve in this isolated subprocess. `looseEq` is
      // set from the EMITTED body (`emittedCodeUsesLooseEq(ts.code)`) — exactly how
      // the production site derives it — so detection == emission (the IR walk only
      // feeds the other flags).
      const usage = detectKernStdlibUsage(handler);
      if (emittedCodeUsesLooseEq(ts.code)) usage.looseEq = true;
      const tsPreamble = kernStdlibPreamble(usage).join('\n');
      const tsSource = `${[...(ts.imports ?? [])].join('\n')}\n${tsPreamble}\nfunction __h(${names.join(', ')}: any): any {\n${ts.code}\n}\nconsole.log(JSON.stringify(__h(${fx.params.map((p) => JSON.stringify(p.value)).join(', ')})));`;
      writeFileSync(
        tsFile,
        tsCompiler.transpileModule(tsSource, {
          compilerOptions: { module: tsCompiler.ModuleKind.ESNext, target: tsCompiler.ScriptTarget.ES2022 },
        }).outputText,
      );
      const pyHelpers = [...(pyEmit.helpers ?? [])].join('\n\n');
      writeFileSync(pyFile, `import json\n${[...(pyEmit.imports ?? [])].join('\n')}\n${pyHelpers}\ndef __h(${names.join(', ')}):\n${pyEmit.code.split('\n').map((l) => `    ${l}`).join('\n')}\nprint(json.dumps(__h(${fx.params.map((p) => pyVal(p.value)).join(', ')}), default=str, allow_nan=False))`);
      const stmtOpts = { encoding: 'utf8', timeout: 10_000 };
      const tsOut = execFileSync('node', [tsFile], stmtOpts).trim();
      const pyOut = execFileSync('python3', [pyFile], stmtOpts).trim();
      const cTs = canon(JSON.parse(tsOut), 'value');
      const cPy = canon(JSON.parse(pyOut), 'value');
      const cExp = canon(fx.expected, 'value');
      if (cTs !== cPy) failures.push({ name: fx.name, why: `ts ≠ py\n      ts: ${cTs}\n      py: ${cPy}` });
      else if (cTs !== cExp) failures.push({ name: fx.name, why: `result ≠ expected\n      got: ${cTs}\n      exp: ${cExp}` });
      else pass++;
    } catch (err) {
      failures.push({ name: fx.name, why: `stmt exec error: ${String(err.message ?? err).split('\n').slice(-4).join(' ')}` });
    }
    continue;
  }

  // ── route-level branch: lower a full portable route handler to both targets, run it, and
  // compare the {status, body} HTTP response. Express -> mock res; FastAPI HTTPException ->
  // {status, body:{detail}} (its real serialization). Verifies error-shape parity (#3).
  if (fx.kind === 'route') {
    try {
      const root = parse(fx.kern);
      const jsLines = generatePortableHandlerExpress(root, '  ', '/api/t', {});
      const routeImports = new Set();
      const pyLines = generatePortableHandlerFastAPI(root, '    ', [], routeImports, new Set(), false);
      const locals = fx.bindings?.locals ?? {};
      const jsLocals = Object.entries(locals).map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`).join('\n');
      const jsFile = join(dir, 'route.mjs');
      writeFileSync(jsFile, `${jsLocals}\nconst req = { params: {}, query: {}, body: {}, headers: {}, user: {} };\nlet __s = 200, __b;\nconst res = { status(n){ __s = n; return this; }, json(b){ __b = b; return this; }, send(b){ __b = b; return this; } };\nfunction __h(req, res) {\n${jsLines.join('\n')}\n}\ntry { __h(req, res); } catch (e) { __s = 500; __b = { detail: String(e && e.message || e) }; }\nconsole.log(JSON.stringify({ status: __s, body: __b }));`);
      // Wrap object/list locals so attribute access mirrors Pydantic (item.score), then
      // _unwrap before serializing. Primitives pass through unchanged (guard fixtures).
      const pyLocals = Object.entries(locals).map(([k, v]) => `${k} = _wrap(${pyVal(v)})`).join('\n');
      const pyFile = join(dir, 'route.py');
      const pyHelpers = `class _Body:\n    def __init__(self, d):\n        self._d = d\n        for k, v in d.items(): setattr(self, k, _wrap(v))\n    def __getitem__(self, k): return getattr(self, k)\ndef _wrap(v):\n    if isinstance(v, dict): return _Body(v)\n    if isinstance(v, list): return [_wrap(x) for x in v]\n    return v\ndef _unwrap(v):\n    if isinstance(v, _Body): return {k: _unwrap(x) for k, x in v._d.items()}\n    if isinstance(v, dict): return {k: _unwrap(x) for k, x in v.items()}\n    if isinstance(v, list): return [_unwrap(x) for x in v]\n    return v`;
      writeFileSync(pyFile, `import json\n${[...routeImports].filter((i) => !i.includes('HTTPException')).join('\n')}\nclass HTTPException(Exception):\n    def __init__(self, status_code, detail=None):\n        self.status_code = status_code; self.detail = detail\n${pyHelpers}\n${pyLocals}\ndef __h():\n${pyLines.map((l) => `    ${l}`).join('\n')}\ntry:\n    __r = __h()\n    print(json.dumps({"status": 200, "body": _unwrap(__r)}, sort_keys=True, default=str))\nexcept HTTPException as e:\n    print(json.dumps({"status": e.status_code, "body": {"detail": _unwrap(e.detail)}}, sort_keys=True, default=str))`);
      const routeOpts = { encoding: 'utf8', timeout: 10_000 };
      const jsOut = execFileSync('node', [jsFile], routeOpts).trim();
      const pyOut = execFileSync('python3', [pyFile], routeOpts).trim();
      const cJs = canon(JSON.parse(jsOut), 'value');
      const cPy = canon(JSON.parse(pyOut), 'value');
      const cExp = canon(fx.expected, 'value');
      if (cJs !== cPy) failures.push({ name: fx.name, why: `ts ≠ py\n      ts: ${cJs}\n      py: ${cPy}` });
      else if (cJs !== cExp) failures.push({ name: fx.name, why: `result ≠ expected\n      got: ${cJs}\n      exp: ${cExp}` });
      else {
        // Wave 3 parity: every monolithic route fixture must also pass the pure-pipeline
        // path with the same {status, body} response. This is the behavioral-equivalence
        // proof that `python-decouple` produces compatible output without the FastAPI
        // glue burned into route handlers. Skips fixtures explicitly marked pureSkip
        // (none yet — added if a future fixture is intrinsically monolithic-only).
        if (!fx.pureSkip) {
          try {
            const purePy = runPurePipeline(fx, dir);
            const cPure = canon(purePy, 'value');
            if (cPure !== cExp) {
              failures.push({ name: fx.name, why: `pure-pipeline ≠ expected\n      pure: ${cPure}\n      exp:  ${cExp}` });
            } else {
              pass++;
            }
          } catch (err) {
            failures.push({ name: fx.name, why: `pure-pipeline exec error: ${String(err.message ?? err).split('\n').slice(-4).join(' ')}` });
          }
        } else {
          pass++;
        }
      }
    } catch (err) {
      failures.push({ name: fx.name, why: `route exec error: ${String(err.message ?? err).split('\n').slice(-4).join(' ')}` });
    }
    continue;
  }

  // ── route-pipeline branch (Wave 3): lower a route through the PURE pipeline ONLY.
  // Used for fixtures that exercise PureRequest surface area the monolithic route fixtures
  // can't (path_params, query, body validate, user/auth) — the monolithic path expects bare
  // module-level locals everywhere; PureRequest is the new contract that puts those into
  // request.path_params / request.query / request.body / request.user namespaces. Each
  // fixture provides `fx.pureRequest` shaped to the route's needs and the runner asserts
  // the handler returns the expected {status, body}.
  if (fx.kind === 'route-pipeline') {
    try {
      const purePy = runPurePipeline(fx, dir);
      const cPure = canon(purePy, 'value');
      const cExp = canon(fx.expected, 'value');
      if (cPure !== cExp) {
        failures.push({ name: fx.name, why: `pure-pipeline ≠ expected\n      pure: ${cPure}\n      exp:  ${cExp}` });
      } else {
        pass++;
      }
    } catch (err) {
      failures.push({ name: fx.name, why: `pure-pipeline exec error: ${String(err.message ?? err).split('\n').slice(-4).join(' ')}` });
    }
    continue;
  }

  // ── whole-file branch: compile a FULL multi-declaration .kern module to BOTH targets via the
  // SAME `generateCoreNode` / `generatePythonCoreNode` entry class-conformance.mjs uses, run each
  // (node / python3), and compare. By default compares the JSON value of `probe()`; if the fixture
  // sets `expectedStdout` (line array) it compares raw stdout split into lines. `skip: ['python'|
  // 'node']` drops a target's run+compare. Mirrors the class-conformance loop, scaled to the route
  // harness's failure-reporting shape.
  if (fx.kind === 'whole-file') {
    // Phase tag so a failure says WHERE it broke (parse vs ts vs python) —
    // agon review (kimi 0.95): one conflated catch loses debugging context.
    let phase = 'parse';
    try {
      const root = parse(fx.kern);
      // A single top-level decl parses as the node itself; multiple decls wrap in a root.
      const topNodes = root.type === 'class' || root.type === 'fn' ? [root] : (root.children ?? []);
      const skip = new Set(fx.skip ?? []);
      // Both targets skipped would silently auto-pass (agon review, zai 0.95) — refuse.
      if (skip.has('node') && skip.has('python')) {
        failures.push({ name: fx.name, why: 'both targets skipped — fixture asserts nothing' });
        continue;
      }
      const useStdout = Array.isArray(fx.expectedStdout);
      // probe() is the harness entrypoint for value fixtures — a missing probe fn
      // would surface as a cryptic runtime NameError (kimi 0.9); guard it here.
      if (!useStdout && !topNodes.some((n) => n.type === 'fn' && n.props?.name === 'probe')) {
        failures.push({ name: fx.name, why: 'whole-file value fixture has no top-level `fn name=probe`' });
        continue;
      }
      const probeLogTs = useStdout ? '' : '\nconsole.log(JSON.stringify(probe()));';
      const probeLogPy = useStdout ? '' : '\nprint(json.dumps(probe()))';

      let tsOut;
      phase = 'ts';
      if (!skip.has('node')) {
        // Apply the SAME stdlib preamble the production pipeline + stmt-conformance
        // inject, so an emitter-emitted helper call (e.g. the D1b `__kern_loose_eq`)
        // resolves a top-level def instead of throwing `ReferenceError`. `looseEq` is
        // derived from the EMITTED code (`emittedCodeUsesLooseEq`) — detection ==
        // emission. (No current whole-file fixture trips this, but the class-conformance
        // ENUM1 loose-`==` case proved the same `generateCoreNode`-without-preamble path
        // latent here too; fixed in lockstep.)
        const tsBody = topNodes.map((n) => generateCoreNode(n).join('\n')).join('\n\n');
        const usage = detectKernStdlibUsage(root);
        if (emittedCodeUsesLooseEq(tsBody)) usage.looseEq = true;
        const tsPreamble = kernStdlibPreamble(usage).join('\n');
        const tsSource = `${tsPreamble ? `${tsPreamble}\n` : ''}${tsBody}${probeLogTs}`;
        const tsFile = join(dir, 'whole-file.mjs');
        writeFileSync(
          tsFile,
          tsCompiler.transpileModule(tsSource, {
            compilerOptions: { module: tsCompiler.ModuleKind.ESNext, target: tsCompiler.ScriptTarget.ES2022 },
          }).outputText,
        );
        tsOut = execFileSync('node', [tsFile], { encoding: 'utf8', timeout: 10_000 }).trim();
      }
      let pyOut;
      phase = 'python';
      if (!skip.has('python')) {
        const pySource = `import json\n${topNodes.map((n) => generatePythonCoreNode(n).join('\n')).join('\n\n')}${probeLogPy}`;
        const pyFile = join(dir, 'whole-file.py');
        writeFileSync(pyFile, pySource);
        pyOut = execFileSync('python3', [pyFile], { encoding: 'utf8', timeout: 10_000 }).trim();
      }

      // Canonicalize each present target's output, then assert all present == expected.
      // Honor a fixture's compare mode (kimi 0.95 — was hardcoded 'value').
      phase = 'compare';
      const mode = fx.compare ?? 'value';
      const cExp = useStdout ? canon(fx.expectedStdout, mode) : canon(fx.expected, mode);
      const norm = (raw) => (useStdout ? canon(raw.split('\n'), mode) : canon(JSON.parse(raw), mode));
      const cTs = skip.has('node') ? undefined : norm(tsOut);
      const cPy = skip.has('python') ? undefined : norm(pyOut);
      if (cTs !== undefined && cPy !== undefined && cTs !== cPy) {
        failures.push({ name: fx.name, why: `ts ≠ py\n      ts: ${cTs}\n      py: ${cPy}` });
      } else if (cTs !== undefined && cTs !== cExp) {
        failures.push({ name: fx.name, why: `result ≠ expected\n      got: ${cTs}\n      exp: ${cExp}` });
      } else if (cPy !== undefined && cPy !== cExp) {
        failures.push({ name: fx.name, why: `result ≠ expected\n      got: ${cPy}\n      exp: ${cExp}` });
      } else {
        pass++;
      }
    } catch (err) {
      failures.push({
        name: fx.name,
        why: `whole-file ${phase} error: ${String(err?.message ?? err).split('\n').slice(-4).join(' ')}`,
      });
    }
    continue;
  }

  // ── compile-reject branch: assert the source is REJECTED with EXACTLY `expectReason` at every
  // layer that rejects. Tries parse → TS codegen → Python codegen; each layer that THROWS must
  // throw a message containing `expectReason`. ≥1 layer must reject with the reason; any layer
  // that rejects with a DIFFERENT reason is a real TS↔Python lockstep bug (a failure). A layer
  // that does NOT throw simply does not reject (fine for a Python-side-only reason — there is no
  // TS reject path to invent).
  if (fx.kind === 'compile-reject') {
    const reason = String(fx.expectReason ?? '');
    if (!reason) {
      failures.push({ name: fx.name, why: 'compile-reject fixture is missing expectReason' });
      continue;
    }
    const layers = []; // { name, threw, msg }
    let topNodes = null;
    try {
      const root = parse(fx.kern);
      topNodes = root.type === 'class' || root.type === 'fn' ? [root] : (root.children ?? []);
      layers.push({ name: 'parse', threw: false, msg: '' });
    } catch (err) {
      layers.push({ name: 'parse', threw: true, msg: String(err?.message ?? err) });
    }
    if (topNodes) {
      try {
        topNodes.map((n) => generateCoreNode(n));
        layers.push({ name: 'ts-codegen', threw: false, msg: '' });
      } catch (err) {
        layers.push({ name: 'ts-codegen', threw: true, msg: String(err?.message ?? err) });
      }
      try {
        topNodes.map((n) => generatePythonCoreNode(n));
        layers.push({ name: 'python-codegen', threw: false, msg: '' });
      } catch (err) {
        layers.push({ name: 'python-codegen', threw: true, msg: String(err?.message ?? err) });
      }
    }
    const rejectedWithReason = layers.filter((l) => l.threw && l.msg.includes(reason));
    const rejectedDifferent = layers.filter((l) => l.threw && !l.msg.includes(reason));
    // Optional EXACT layer assertion (kimi 0.9): a fixture documenting a
    // TS↔Python asymmetry pins WHICH layers must reject (e.g. a Python-only
    // reason asserts ts-codegen stays clean). Drift in either direction fails.
    if (Array.isArray(fx.rejectLayers)) {
      const got = layers.filter((l) => l.threw).map((l) => l.name).sort().join(',');
      const want = [...fx.rejectLayers].sort().join(',');
      if (got !== want) {
        failures.push({
          name: fx.name,
          why: `reject-layer set drifted\n      want: ${want}\n      got:  ${got || '(none)'}`,
        });
        continue;
      }
    }
    if (rejectedDifferent.length > 0) {
      // Tripwire 3: a layer rejected with a DIFFERENT reason than expected — a real lockstep bug.
      const d = rejectedDifferent[0];
      failures.push({
        name: fx.name,
        why: `layer "${d.name}" rejected with a DIFFERENT reason than "${reason}"\n      got: ${d.msg.split('\n')[0]}`,
      });
    } else if (rejectedWithReason.length === 0) {
      failures.push({
        name: fx.name,
        why: `no layer rejected with "${reason}" (every layer compiled clean)\n      layers: ${layers.map((l) => `${l.name}=${l.threw ? 'threw' : 'ok'}`).join(', ')}`,
      });
    } else {
      pass++;
    }
    continue;
  }

  const mode = fx.compare ?? 'value';
  const pathParams = [...fx.path.matchAll(/:([A-Za-z_]\w*)/g)].map((m) => m[1]);
  // externalSchema mirrors `validate schema=X`: the body is a model but its
  // field names are unknown to the rewriter, so bodyFields is empty.
  const bodyFields = fx.externalSchema ? new Set() : new Set(Object.keys(fx.bindings.body ?? {}));
  const imports = new Set();

  // Out-of-scope guard (see SCOPE in header): a camelCase param/query key
  // would false-pass here while diverging from the snake-cased route signature.
  const camel = ['params', 'query']
    .flatMap((ns) => Object.keys(fx.bindings[ns] ?? {}).map((k) => `${ns}.${k}`))
    .filter((ref) => toSnakeCase(ref.split('.')[1]) !== ref.split('.')[1]);
  if (camel.length) {
    failures.push({ name: fx.name, why: `out of scope: camelCase param/query key(s) ${camel.join(', ')} — see SCOPE` });
    continue;
  }

  let py, js;
  try {
    const pyExpr = rewriteExpr(fx.expr, pathParams, bodyFields, !!fx.authUser, imports);
    const jsExpr = rewriteExpressExpr(fx.expr, fx.path);
    const pyFile = join(dir, 'run.py');
    const jsFile = join(dir, 'run.mjs');
    writeFileSync(pyFile, buildPython(pyExpr, fx.bindings, imports));
    writeFileSync(jsFile, buildNode(jsExpr, fx.bindings));
    const execOpts = { encoding: 'utf8', timeout: 10_000 };
    py = JSON.parse(execFileSync('python3', [pyFile], execOpts).trim());
    js = JSON.parse(execFileSync('node', [jsFile], execOpts).trim());
  } catch (err) {
    failures.push({ name: fx.name, why: `execution error: ${String(err.message ?? err).split('\n').slice(-6).join(' ')}` });
    continue;
  }

  const cPy = canon(py, mode);
  const cJs = canon(js, mode);
  const cExp = canon(fx.expected, mode);
  if (cPy !== cJs) failures.push({ name: fx.name, why: `python ≠ express\n      py: ${cPy}\n      js: ${cJs}` });
  else if (cJs !== cExp) failures.push({ name: fx.name, why: `result ≠ expected\n      got: ${cJs}\n      exp: ${cExp}` });
  else pass++;
}

if (selected === 0) {
  console.error(`\nNo fixtures matched ${filter ? `filter="${filter}"` : 'the suite'} — refusing to report success.`);
  process.exit(1);
}
const total = pass + failures.length;
console.log(`\nConformance: ${pass}/${total} fixtures passed (${mode_label()})\n`);
function mode_label() {
  return filter ? `filter="${filter}"` : 'all';
}
for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.why}\n`);
if (failures.length) {
  console.log(`${failures.length} FAILED`);
  process.exit(1);
}
console.log('All passed.');
