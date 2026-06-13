/**
 * Phase-2 typed runtime canonicalizer (JS side) + the byte-identical Python-side
 * source. See `.agon-goals/phase2-runner-prelude.md`.
 *
 * Both Phase-2 gates derive their verdicts from EXECUTED runtime values, never
 * from `JSON.stringify` (which collapses `NaN`, `Infinity`, `-0`, `undefined`).
 * A runtime value is encoded into a tagged `CanonValue`, wrapped in a
 * `RuntimeCanonV1` envelope with the `CALLS` side-effect log, and serialized to
 * ONE deterministic JSON string. Equality is byte equality of that string.
 *
 * The JS encoder here and the embedded `PHASE2_PY_CANON_SRC` MUST produce the
 * same string for the same logical value — the cross-language self-test
 * (`tests/phase2/canonicalize.test.ts`) is the proof. If they ever diverge the
 * harness is not trustworthy, so the self-test is a hard gate precondition.
 *
 * CanonValue:
 *   {kind:'undefined'}
 *   {kind:'null'}
 *   {kind:'boolean', value:boolean}
 *   {kind:'string',  value:string}
 *   {kind:'number',  value:string}   // tagged: 'NaN' | 'Infinity' | '-Infinity' | '-0' | '0' | decimal
 *   {kind:'array',   items:CanonValue[]}
 *   {kind:'object',  entries:[string,CanonValue][]}   // entries sorted by key
 *
 * Number policy: integers, NaN, ±Infinity, ±0 are fully supported (this covers
 * the entire bitwise/logical seed). Exotic fractional / exponent-notation floats
 * FAIL CLOSED (`runner:unsupported-float`) rather than risk a TS/Python
 * shortest-round-trip divergence — parity-or-drop. A dedicated float-policy
 * slice lifts this once a shared algorithm is proven by self-test.
 */

const KIND_TAGS = new Set(['undefined', 'null', 'boolean', 'string', 'number', 'array', 'object']);

export class CanonError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(code);
    this.name = 'CanonError';
    this.code = code;
  }
}

/**
 * JS number -> canonical number string, or throw CanonError for exotic floats.
 * @param {number} n
 * @returns {string}
 */
export function canonNumberString(n) {
  if (typeof n !== 'number') throw new CanonError('runner:non-number');
  if (Number.isNaN(n)) return 'NaN';
  if (n === Infinity) return 'Infinity';
  if (n === -Infinity) return '-Infinity';
  if (n === 0) return Object.is(n, -0) ? '-0' : '0';
  if (Number.isInteger(n)) {
    // Integers within safe range serialize identically in JS and Python (str(int)).
    // Beyond 2**53 the decimal is no longer exact in a double; fail closed.
    if (!Number.isSafeInteger(n)) throw new CanonError('runner:unsupported-float');
    return String(n);
  }
  // Fractional / exponent floats: cross-language shortest-round-trip parity is
  // unproven for this slice. Fail closed until a dedicated float-policy slice.
  throw new CanonError('runner:unsupported-float');
}

/**
 * Encode a real JS runtime value into a CanonValue.
 * @param {unknown} value
 * @param {Set<unknown>} [seen]
 * @returns {import('./canonicalize.mjs').CanonValue}
 */
export function canonicalizeRuntimeValue(value, seen = new Set()) {
  if (value === undefined) return { kind: 'undefined' };
  if (value === null) return { kind: 'null' };
  const t = typeof value;
  if (t === 'boolean') return { kind: 'boolean', value };
  if (t === 'string') return { kind: 'string', value };
  if (t === 'number') return { kind: 'number', value: canonNumberString(value) };
  if (t === 'bigint' || t === 'symbol' || t === 'function') {
    throw new CanonError('runner:unsupported-canon-value');
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new CanonError('runner:cyclic');
    seen.add(value);
    const items = value.map((item) => canonicalizeRuntimeValue(item, seen));
    seen.delete(value);
    return { kind: 'array', items };
  }
  if (t === 'object') {
    // Only plain objects are supported. Class instances, Maps, Sets, Dates, etc.
    // are not legal deterministic runtime values in the corpus.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new CanonError('runner:unsupported-canon-value');
    }
    if (seen.has(value)) throw new CanonError('runner:cyclic');
    seen.add(value);
    const entries = Object.keys(value)
      .sort()
      .map((k) => /** @type {[string, import('./canonicalize.mjs').CanonValue]} */ ([
        k,
        canonicalizeRuntimeValue(value[k], seen),
      ]));
    seen.delete(value);
    return { kind: 'object', entries };
  }
  throw new CanonError('runner:unsupported-canon-value');
}

/**
 * CanonValue -> deterministic JSON fragment (no whitespace, object entries already sorted).
 * @param {import('./canonicalize.mjs').CanonValue} cv
 * @returns {string}
 */
export function canonValueToJson(cv) {
  switch (cv.kind) {
    case 'undefined':
      return '{"kind":"undefined"}';
    case 'null':
      return '{"kind":"null"}';
    case 'boolean':
      return `{"kind":"boolean","value":${cv.value ? 'true' : 'false'}}`;
    case 'string':
      return `{"kind":"string","value":${JSON.stringify(cv.value)}}`;
    case 'number':
      return `{"kind":"number","value":${JSON.stringify(cv.value)}}`;
    case 'array':
      return `{"kind":"array","items":[${cv.items.map(canonValueToJson).join(',')}]}`;
    case 'object':
      return `{"kind":"object","entries":[${cv.entries
        .map(([k, v]) => `[${JSON.stringify(k)},${canonValueToJson(v)}]`)
        .join(',')}]}`;
    default:
      throw new CanonError('runner:bad-canon-kind');
  }
}

/**
 * Build the canonical runtime envelope JSON string from a CanonValue + CALLS log.
 * Key order is fixed by hand so it is stable across languages.
 * @param {import('./canonicalize.mjs').CanonValue} cv
 * @param {string[]} calls
 * @returns {string}
 */
export function serializeEnvelope(cv, calls) {
  if (!Array.isArray(calls) || calls.some((c) => typeof c !== 'string')) {
    throw new CanonError('runner:bad-calls');
  }
  const callsJson = `[${calls.map((c) => JSON.stringify(c)).join(',')}]`;
  return `{"version":1,"status":"ok","value":${canonValueToJson(cv)},"calls":${callsJson}}`;
}

/**
 * Canonicalize a (value, calls) pair straight to the envelope string.
 * @param {unknown} value
 * @param {string[]} calls
 * @returns {string}
 */
export function canonicalizeRuntime(value, calls) {
  return serializeEnvelope(canonicalizeRuntimeValue(value), calls);
}

/**
 * Decode a corpus `expected` shorthand into a CanonValue + calls.
 * Rules (phase2-runner-prelude.md "Expected values"):
 *  - a plain object with a top-level {value, calls} pair means exactly that;
 *  - a plain object whose `kind` matches a CanonValue tag is an already-typed CanonValue;
 *  - otherwise the shorthand is a bare value with calls=[].
 * @param {unknown} expected
 * @returns {{cv: import('./canonicalize.mjs').CanonValue, calls: string[]}}
 */
export function decodeExpected(expected) {
  if (isPlainObject(expected)) {
    const keys = Object.keys(expected);
    if (typeof expected.kind === 'string' && KIND_TAGS.has(expected.kind)) {
      return { cv: decodeTypedCanonValue(expected), calls: [] };
    }
    if (keys.length === 2 && keys.includes('value') && keys.includes('calls')) {
      const calls = expected.calls;
      if (!Array.isArray(calls) || calls.some((c) => typeof c !== 'string')) {
        throw new CanonError('corpus:bad-expected-calls');
      }
      return { cv: decodeExpectedValue(expected.value), calls: calls.slice() };
    }
  }
  return { cv: decodeExpectedValue(expected), calls: [] };
}

/**
 * @param {unknown} v
 * @returns {import('./canonicalize.mjs').CanonValue}
 */
function decodeExpectedValue(v) {
  if (isPlainObject(v) && typeof v.kind === 'string' && KIND_TAGS.has(v.kind)) {
    return decodeTypedCanonValue(v);
  }
  return canonicalizeRuntimeValue(v);
}

/**
 * Validate + normalize an already-typed CanonValue literal from the corpus.
 * @param {Record<string, unknown>} v
 * @returns {import('./canonicalize.mjs').CanonValue}
 */
function decodeTypedCanonValue(v) {
  switch (v.kind) {
    case 'undefined':
      return { kind: 'undefined' };
    case 'null':
      return { kind: 'null' };
    case 'boolean':
      if (typeof v.value !== 'boolean') throw new CanonError('corpus:bad-typed-boolean');
      return { kind: 'boolean', value: v.value };
    case 'string':
      if (typeof v.value !== 'string') throw new CanonError('corpus:bad-typed-string');
      return { kind: 'string', value: v.value };
    case 'number':
      if (typeof v.value !== 'string') throw new CanonError('corpus:bad-typed-number');
      return { kind: 'number', value: v.value };
    case 'array':
      if (!Array.isArray(v.items)) throw new CanonError('corpus:bad-typed-array');
      return { kind: 'array', items: v.items.map(decodeExpectedValue) };
    case 'object': {
      if (!Array.isArray(v.entries)) throw new CanonError('corpus:bad-typed-object');
      const entries = v.entries.map(
        (e) => /** @type {[string, import('./canonicalize.mjs').CanonValue]} */ ([
          e[0],
          decodeExpectedValue(e[1]),
        ]),
      );
      entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return { kind: 'object', entries };
    }
    default:
      throw new CanonError('corpus:bad-typed-kind');
  }
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * The Python-side canonicalizer source, embedded verbatim into every runner
 * wrapper (legacy + AST). It MUST produce the identical envelope string the JS
 * encoder above produces. `phase2_canon_json(value, calls)` returns the string;
 * `Phase2CanonError` mirrors `CanonError`.
 *
 * `_KERN_UNDEFINED` is resolved at runtime from the production prelude the
 * wrapper already imports; the self-test injects a stand-in sentinel so the
 * canonicalizer can be exercised in isolation.
 */
export const PHASE2_PY_CANON_SRC = `
import json as _phase2_json
import math as _phase2_math

class Phase2CanonError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code

def _phase2_is_undefined(value):
    sentinel = globals().get("_KERN_UNDEFINED", None)
    return sentinel is not None and value is sentinel

def _phase2_number_string(n):
    # bool is handled before this function is reached.
    if isinstance(n, int):
        return str(n)
    if isinstance(n, float):
        if _phase2_math.isnan(n):
            return "NaN"
        if n == _phase2_math.inf:
            return "Infinity"
        if n == -_phase2_math.inf:
            return "-Infinity"
        if n == 0.0:
            return "-0" if _phase2_math.copysign(1.0, n) < 0 else "0"
        if n.is_integer():
            as_int = int(n)
            if abs(as_int) > 9007199254740991:
                raise Phase2CanonError("runner:unsupported-float")
            return str(as_int)
        raise Phase2CanonError("runner:unsupported-float")
    raise Phase2CanonError("runner:non-number")

def _phase2_canon_value(value, seen):
    if _phase2_is_undefined(value):
        return '{"kind":"undefined"}'
    if value is None:
        return '{"kind":"null"}'
    if isinstance(value, bool):
        return '{"kind":"boolean","value":' + ("true" if value else "false") + '}'
    if isinstance(value, str):
        return '{"kind":"string","value":' + _phase2_json.dumps(value, ensure_ascii=False) + '}'
    if isinstance(value, (int, float)):
        return '{"kind":"number","value":' + _phase2_json.dumps(_phase2_number_string(value)) + '}'
    vid = id(value)
    if isinstance(value, (list, tuple)):
        if vid in seen:
            raise Phase2CanonError("runner:cyclic")
        seen.add(vid)
        items = ",".join(_phase2_canon_value(item, seen) for item in value)
        seen.discard(vid)
        return '{"kind":"array","items":[' + items + ']}'
    as_map = None
    if isinstance(value, dict):
        as_map = value
    elif value.__class__.__name__ == "Phase2Object":
        as_map = value.as_dict()
    if as_map is not None:
        if vid in seen:
            raise Phase2CanonError("runner:cyclic")
        seen.add(vid)
        parts = []
        for key in sorted(as_map.keys()):
            if not isinstance(key, str):
                raise Phase2CanonError("runner:non-string-key")
            parts.append("[" + _phase2_json.dumps(key, ensure_ascii=False) + "," + _phase2_canon_value(as_map[key], seen) + "]")
        seen.discard(vid)
        return '{"kind":"object","entries":[' + ",".join(parts) + ']}'
    raise Phase2CanonError("runner:unsupported-canon-value")

def phase2_canon_json(value, calls):
    for c in calls:
        if not isinstance(c, str):
            raise Phase2CanonError("runner:bad-calls")
    calls_json = "[" + ",".join(_phase2_json.dumps(c) for c in calls) + "]"
    return '{"version":1,"status":"ok","value":' + _phase2_canon_value(value, set()) + ',"calls":' + calls_json + '}'
`;
