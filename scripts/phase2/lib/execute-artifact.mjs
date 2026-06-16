/**
 * Phase-2 artifact execution — Python (legacy + AST) and the TS reference.
 *
 * A captured artifact is EXECUTED, never trusted by parse alone. Both gates
 * derive runtime verdicts from the typed `RuntimeCanonV1` envelope this module
 * produces (`scripts/phase2/lib/canonicalize.mjs`), comparing byte-equality of
 * the canonical JSON string — so NaN / -0 / undefined / null / call-order
 * distinctions survive (JSON.stringify would lose them).
 *
 * Determinism: every child process is spawned with `TZ=UTC`, `PYTHONHASHSEED=0`,
 * `LC_ALL=C` (and `LANG=C`) so dict/set iteration, hashing, and locale can never
 * leak into a runtime value. Mirrors the runner-prelude determinism rules.
 *
 * The Python wrapper embeds:
 *   - the production prelude/helpers the emitted code needs (imports + helpers
 *     returned by the capture — they self-define `_KERN_UNDEFINED`, `_kern_truthy`,
 *     `_kern_to_int32`, etc.);
 *   - the runner-prelude helpers (`mark`, `getObj`, `callable`, `callableFallback`)
 *     + `Phase2Object` + the `CALLS` channel;
 *   - `PHASE2_PY_CANON_SRC` (byte-identical to the JS encoder);
 * then evaluates the expression and prints exactly one
 * `__PHASE2_RESULT__<canon-json>` line. The extractor takes the single result
 * line (fails on zero or >1 DISTINCT result lines).
 *
 * The TS reference runs the Express-portable JS expression under Node with the
 * SAME helper semantics (`mark`/`getObj`/`callable`/`callableFallback` + a `List`
 * shim for stdlib map/filter the express target leaves verbatim) and the SAME
 * canonicalizer (`canonicalizeRuntime`), so TS, legacy, and AST all speak one
 * envelope.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalizeRuntime, PHASE2_PY_CANON_SRC } from './canonicalize.mjs';

/**
 * E1: the result line prefix carries a per-execution random nonce so a USER
 * EXPRESSION cannot spoof the result by printing a matching marker line. The
 * harness mints the nonce, injects it into the wrapper, and only that exact
 * prefix is recognized by `extractResult`. A fixed prefix (the old
 * `__PHASE2_RESULT__`) is forgeable: an expression that emits the literal line
 * would corrupt the captured result.
 * @param {string} [nonce]
 * @returns {string}
 */
function resultPrefix(nonce) {
  return `__PHASE2_RESULT_${nonce ?? randomUUID()}__`;
}

const DETERMINISTIC_ENV = {
  ...process.env,
  TZ: 'UTC',
  PYTHONHASHSEED: '0',
  LC_ALL: 'C',
  LANG: 'C',
};

/**
 * Decode a binding local value (corpus shorthand) into BOTH a JS runtime value
 * and a Python literal expression. Typed CanonValue shorthands (e.g.
 * `{kind:'number',value:'NaN'}`) decode to the real special value on each side.
 * Bare values are passed through. This is the binding twin of `decodeExpected`.
 * @param {unknown} v
 * @returns {{ js: unknown, py: string }}
 */
function decodeLocal(v) {
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof (/** @type {any} */ (v).kind) === 'string') {
    return decodeTypedLocal(/** @type {Record<string, unknown>} */ (v));
  }
  return { js: v, py: pyLiteral(v) };
}

/**
 * @param {Record<string, unknown>} v
 * @returns {{ js: unknown, py: string }}
 */
function decodeTypedLocal(v) {
  switch (v.kind) {
    case 'undefined':
      return { js: undefined, py: '_KERN_UNDEFINED' };
    case 'null':
      return { js: null, py: 'None' };
    case 'boolean':
      return { js: !!v.value, py: v.value ? 'True' : 'False' };
    case 'string':
      return { js: String(v.value), py: pyLiteral(String(v.value)) };
    case 'number': {
      const s = String(v.value);
      if (s === 'NaN') return { js: NaN, py: "float('nan')" };
      if (s === 'Infinity') return { js: Infinity, py: "float('inf')" };
      if (s === '-Infinity') return { js: -Infinity, py: "float('-inf')" };
      if (s === '-0') return { js: -0, py: '-0.0' };
      const n = Number(s);
      return { js: n, py: pyLiteral(n) };
    }
    default:
      throw new Error(`decodeLocal: unsupported typed-local kind ${String(v.kind)}`);
  }
}

/**
 * Render a JS value as a Python literal expression for binding into the wrapper.
 * Only the value shapes the corpus locals actually use are supported (scalars,
 * arrays, plain objects -> Phase2Object). Anything else fails loud.
 * @param {unknown} v
 * @returns {string}
 */
function pyLiteral(v) {
  if (v === null) return 'None';
  if (v === undefined) return '_KERN_UNDEFINED';
  const t = typeof v;
  if (t === 'boolean') return v ? 'True' : 'False';
  if (t === 'string') return pyStr(/** @type {string} */ (v));
  if (t === 'number') {
    if (Number.isNaN(v)) return "float('nan')";
    if (v === Infinity) return "float('inf')";
    if (v === -Infinity) return "float('-inf')";
    if (Object.is(v, -0)) return '-0.0';
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map(pyLiteral).join(', ')}]`;
  if (t === 'object') {
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (v));
    // Phase2Object so attribute AND item access work over the same map.
    return `Phase2Object({${entries.map(([k, val]) => `${pyStr(k)}: ${pyLiteral(val)}`).join(', ')}})`;
  }
  throw new Error(`pyLiteral: unsupported local value of type ${t}`);
}

/**
 * @param {string} s
 * @returns {string}
 */
function pyStr(s) {
  // JSON string escaping is a valid Python string literal for our inputs.
  return JSON.stringify(s);
}

/**
 * Render a JS value as a JS literal expression for the TS reference wrapper.
 * @param {unknown} v
 * @returns {string}
 */
function jsLiteral(v) {
  if (v === undefined) return 'undefined';
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN';
    if (v === Infinity) return 'Infinity';
    if (v === -Infinity) return '-Infinity';
    if (Object.is(v, -0)) return '-0';
    return String(v);
  }
  return JSON.stringify(v);
}

/** The Phase2Object + runner-prelude helpers, embedded into every Python wrapper. */
const PY_RUNNER_PRELUDE = `
class Phase2Object:
    def __init__(self, d):
        self._d = dict(d)
        for _k, _v in self._d.items():
            object.__setattr__(self, _k, _v)
    def __getitem__(self, key):
        return self._d[key]
    def as_dict(self):
        return self._d

CALLS = []

def mark(label, value):
    CALLS.append(str(label))
    return value

def getObj():
    CALLS.append("getObj")
    return Phase2Object({"flag": "", "truthy": "truthy", "nested": {"value": 7}})

def callable(label, value):
    def phase2_callable(*_args):
        CALLS.append(str(label))
        return value
    return phase2_callable

def callableFallback(*_args):
    CALLS.append("fallback")
    return "callable-result"
fallback = callableFallback
`;

/** The runner-prelude helpers for the TS reference, mirroring the Python ones. */
const TS_RUNNER_PRELUDE = `
const CALLS = [];
const mark = (label, value) => { CALLS.push(String(label)); return value; };
const getObj = () => { CALLS.push('getObj'); return { flag: '', truthy: 'truthy', nested: { value: 7 } }; };
const callable = (label, value) => (...args) => { CALLS.push(String(label)); return value; };
const callableFallback = (...args) => { CALLS.push('fallback'); return 'callable-result'; };
const fallback = callableFallback;
const __listImpl = {
  // E3(a): forward ALL callback args (element, index, array), not just element,
  // so a TS reference like List.map(xs, (x, i) => i) matches the production
  // semantics instead of silently dropping index/array. reduce forwards
  // (acc, element, index, array) and honors whether an initial value was given.
  map: (arr, fn) => Array.prototype.map.call(arr, fn),
  filter: (arr, fn) => Array.prototype.filter.call(arr, fn),
  reduce: (arr, fn, ...rest) =>
    rest.length > 0
      ? Array.prototype.reduce.call(arr, fn, rest[0])
      : Array.prototype.reduce.call(arr, fn),
};
// E3(b): a MISSING List method must fail LOUD (an identifiable error category),
// never silently kill the TS reference and degrade the row to a byte-only
// verdict. The Proxy throws a tagged error for any unshimmed property so
// classifyTsError surfaces it as a real reference defect.
const List = new Proxy(__listImpl, {
  get(target, prop, receiver) {
    if (prop in target || typeof prop === 'symbol') {
      return Reflect.get(target, prop, receiver);
    }
    throw new Error('Phase2ListShimError: unshimmed List method "' + String(prop) + '"');
  },
});
`;

/**
 * @param {object} bindings normalized { locals?, helpers? }
 * @returns {{ locals: Record<string, unknown>, helpers: string[] }}
 */
function normBindings(bindings) {
  const b = bindings && typeof bindings === 'object' ? bindings : {};
  return {
    locals: /** @type {Record<string, unknown>} */ (b.locals ?? {}),
    helpers: Array.isArray(b.helpers) ? b.helpers : [],
  };
}

/**
 * Extract the single nonce-prefixed result line from stdout. Fails if zero, or
 * if more than one DISTINCT result line exists. The prefix carries the
 * per-execution nonce (E1), so a user expression that prints a marker with the
 * WRONG nonce is ignored — it cannot spoof or corrupt the real result.
 * @param {string} stdout
 * @param {string} prefix the exact nonce-bearing prefix the wrapper emitted
 * @returns {string} the canon-json after the prefix
 */
function extractResult(stdout, prefix) {
  const lines = stdout.split('\n');
  const results = new Set();
  let last = null;
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      const payload = line.slice(prefix.length);
      results.add(payload);
      last = payload;
    }
  }
  if (results.size === 0) throw new Error('no result line in output');
  if (results.size > 1) throw new Error(`multiple distinct result lines (${results.size})`);
  return /** @type {string} */ (last);
}

/**
 * Build the Python wrapper source for an emitted expression.
 * @param {{ code: string, imports: Iterable<string>, helpers: Iterable<string> }} emit
 * @param {object} bindings
 * @param {string} [prefix] the nonce-bearing result prefix (E1); defaults to a
 *   fresh random prefix so a direct caller still gets a non-forgeable marker.
 * @returns {string}
 */
export function buildPyWrapper(emit, bindings, prefix = resultPrefix()) {
  const { locals } = normBindings(bindings);
  const lines = [];
  // Production prelude: imports first, then helpers (they self-define
  // _KERN_UNDEFINED / _kern_truthy / _kern_to_int32 etc.).
  for (const imp of emit.imports ?? []) lines.push(imp);
  for (const helper of emit.helpers ?? []) lines.push(helper);
  // The canonicalizer reads _KERN_UNDEFINED from globals(); if no production
  // helper defined it, define a stand-in so the sentinel path is exercisable.
  lines.push('try:');
  lines.push('    _KERN_UNDEFINED');
  lines.push('except NameError:');
  lines.push('    _KERN_UNDEFINED = object()');
  // Runner prelude (Phase2Object + mark/getObj/callable + CALLS) AFTER the
  // production helpers so its names cannot be shadowed by a production helper.
  lines.push(PY_RUNNER_PRELUDE);
  lines.push(PHASE2_PY_CANON_SRC);
  // Bind locals.
  for (const [k, v] of Object.entries(locals)) {
    lines.push(`${k} = ${decodeLocal(v).py}`);
  }
  // Evaluate and print exactly one result line, prefixed with the per-execution
  // nonce so user-expression stdout cannot forge it (E1).
  lines.push(`__phase2_result = (${emit.code})`);
  lines.push(`print(${pyStr(prefix)} + phase2_canon_json(__phase2_result, CALLS))`);
  return lines.join('\n');
}

/**
 * Build the TS reference wrapper for an Express-portable JS expression.
 * @param {string} jsExpr
 * @param {object} bindings
 * @param {string} [prefix] the nonce-bearing result prefix (E1).
 * @returns {string}
 */
function buildTsWrapper(jsExpr, bindings, prefix = resultPrefix()) {
  const { locals } = normBindings(bindings);
  const localLines = Object.entries(locals)
    .map(([k, v]) => `const ${k} = ${jsLiteral(decodeLocal(v).js)};`)
    .join('\n');
  // The reference canonicalizes via the SAME encoder the gate uses by importing
  // it; we pass the value + CALLS back out as one nonce-prefixed result line.
  const canonPath = new URL('./canonicalize.mjs', import.meta.url).pathname;
  return `import { canonicalizeRuntime } from ${JSON.stringify(canonPath)};
${TS_RUNNER_PRELUDE}
${localLines}
const __phase2_result = (${jsExpr});
process.stdout.write(${JSON.stringify(prefix)} + canonicalizeRuntime(__phase2_result, CALLS.slice()) + "\\n");
`;
}

/**
 * Execute an emitted Python artifact and return its typed runtime canon.
 * @param {{ code: string, imports: Iterable<string>, helpers: Iterable<string> }} emit
 * @param {object} bindings
 * @returns {{ status: 'ok', runtimeCanon: string } | { status: 'error', code: string, category: 'parse'|'emit'|'runtime'|'runner' }}
 */
export function executePython(emit, bindings) {
  const tmp = mkdtempSync(join(tmpdir(), 'phase2-py-'));
  const file = join(tmp, 'run.py');
  const prefix = resultPrefix();
  try {
    writeFileSync(file, buildPyWrapper(emit, bindings, prefix));
    let out;
    try {
      out = execFileSync('python3', [file], {
        encoding: 'utf8',
        timeout: 15_000,
        env: DETERMINISTIC_ENV,
        // Capture stderr into the thrown error; never inherit it onto the
        // parent (a blocked legacy fragment SyntaxError is expected, not noise).
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const stderr = String(err.stderr ?? err.message ?? err);
      // E2: the four-category taxonomy must be DISTINGUISHABLE. A legacy
      // SyntaxError (the legacy string path emitted invalid Python — an EMIT
      // defect) must NOT collapse into the same category as an AST NameError (a
      // genuine RUNTIME exception), or two structurally different blocks key as
      // BOTH_BLOCKED_SAME in blockedVerdict. SyntaxError -> 'emit'; every other
      // Python exception -> 'runtime'.
      const category = stderr.includes('SyntaxError') ? 'emit' : 'runtime';
      const code = classifyPyError(stderr);
      return { status: 'error', code, category };
    }
    try {
      const runtimeCanon = extractResult(out, prefix);
      return { status: 'ok', runtimeCanon };
    } catch (err) {
      return { status: 'error', code: `runner:${String(err.message ?? err)}`, category: 'runner' };
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Execute the TS reference and return its typed runtime canon.
 * @param {string} jsExpr
 * @param {object} bindings
 * @returns {{ status: 'ok', runtimeCanon: string } | { status: 'error', code: string, category: 'parse'|'emit'|'runtime'|'runner' }}
 */
export function executeTs(jsExpr, bindings) {
  const tmp = mkdtempSync(join(tmpdir(), 'phase2-ts-'));
  const file = join(tmp, 'run.mjs');
  const prefix = resultPrefix();
  try {
    writeFileSync(file, buildTsWrapper(jsExpr, bindings, prefix));
    let out;
    try {
      out = execFileSync('node', [file], {
        encoding: 'utf8',
        timeout: 15_000,
        env: DETERMINISTIC_ENV,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const stderr = String(err.stderr ?? err.message ?? err);
      return { status: 'error', code: classifyTsError(stderr), category: 'runtime' };
    }
    try {
      const runtimeCanon = extractResult(out, prefix);
      return { status: 'ok', runtimeCanon };
    } catch (err) {
      return { status: 'error', code: `runner:${String(err.message ?? err)}`, category: 'runner' };
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * @param {string} stderr
 * @returns {string}
 */
function classifyPyError(stderr) {
  if (stderr.includes('SyntaxError')) return 'py:syntax-error';
  const m = stderr.match(/(\w*Error):/);
  if (m) return `py:${m[1].toLowerCase()}`;
  return 'py:exec-error';
}

/**
 * @param {string} stderr
 * @returns {string}
 */
function classifyTsError(stderr) {
  if (stderr.includes('SyntaxError')) return 'ts:syntax-error';
  const m = stderr.match(/(\w*Error):/);
  if (m) return `ts:${m[1].toLowerCase()}`;
  return 'ts:exec-error';
}
