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
const { rewriteFastAPIExpr } = await import(join(REPO, 'packages/python/dist/fastapi-response.js'));
const { rewriteExpressExpr } = await import(join(REPO, 'packages/express/dist/express-portable.js'));
const { toSnakeCase } = await import(join(REPO, 'packages/python/dist/type-map.js'));

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
const dir = mkdtempSync(join(tmpdir(), 'kern-conf-'));
process.on('exit', () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});
let pass = 0;
const failures = [];

let selected = 0;
for (const fx of FIXTURES) {
  if (filter && !fx.name.includes(filter)) continue;
  selected++;
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
    const pyExpr = rewriteFastAPIExpr(fx.expr, pathParams, bodyFields, !!fx.authUser, imports);
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
