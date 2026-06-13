// Slice S7 — dual-sentinel nullish/equality substrate. `_KERN_UNDEFINED` is a
// FIRST-CLASS Python value distinct from `None`: `undefined` is nullish with
// `null` (loose `==` crossing TRUE, `??`/`?.` treat both as nullish) but is NOT
// strictly equal to `null` (`===` FALSE). The two equality helpers split the JS
// `==` (loose) and `===` (strict) operators that previously both lowered to
// Python `==`:
//   _kern_is_nullish(x)      -> x is None or x is _KERN_UNDEFINED
//   _kern_strict_equal(a, b) -> SameValue-ish: a nullish operand is equal only
//                               to the SAME nullish identity (undefined===undefined,
//                               null===null, but undefined!==null); otherwise `==`.
//   _kern_loose_equal(a, b)  -> both-nullish crossing is TRUE; else strict.
// The sentinel is matched by IDENTITY (`is`), never by value, so the undefined
// `__bool__ = False` override never leaks into the equality semantics. The block
// self-defines `_KERN_UNDEFINED` via the same idempotent `try/except NameError`
// guard the fmt/array/js helper blocks use, so it stands alone if registered
// without them.
export const KERN_NULLISH_HELPER_PY = [
  'try:',
  '    _KERN_UNDEFINED',
  'except NameError:',
  '    class _KernUndefined:',
  '        def __bool__(self): return False',
  "        def __repr__(self): return 'undefined'",
  "        def __str__(self): return 'undefined'",
  '    _KERN_UNDEFINED = _KernUndefined()',
  '',
  'def _kern_is_nullish(x):',
  '    return x is None or x is _KERN_UNDEFINED',
  '',
  'def _kern_strict_equal(a, b):',
  '    if a is _KERN_UNDEFINED or b is _KERN_UNDEFINED:',
  '        return a is b',
  '    if a is None or b is None:',
  '        return a is b',
  // Python `bool` subclasses `int`, so `0 == False` / `1 == True` are True — but
  // JS `0 === false` / `1 === true` are FALSE. Reject a bool-vs-non-bool pair
  // before the value compare so the numeric/boolean type distinction survives.
  '    if (type(a) is bool) != (type(b) is bool):',
  '        return False',
  // Containers must recurse ELEMENT-WISE through `_kern_strict_equal`, not Python
  // `==`: Python list/dict `==` compares elements with `==`, which re-leaks the
  // `0 == False` / `1 == True` bool⊂int conflation one level down (`[0] ==
  // [False]` is True). The KERN core runtime compares structurally with
  // kind-discrimination at EVERY level, so the Python target must too or
  // `[0] === [false]` diverges (True on Python vs False in core). Lists/tuples
  // (array-kind) compare by length + positional recursion; dicts (record-kind)
  // by key set + per-key recursion. Strings stay on `==` (no element kinds).
  '    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):',
  '        if len(a) != len(b):',
  '            return False',
  '        return all(_kern_strict_equal(__k_x, __k_y) for __k_x, __k_y in zip(a, b))',
  '    if isinstance(a, dict) and isinstance(b, dict):',
  '        if a.keys() != b.keys():',
  '            return False',
  '        return all(_kern_strict_equal(a[__k_k], b[__k_k]) for __k_k in a)',
  // A list-vs-dict (or container-vs-scalar) mismatch is unequal — Python `==`
  // already returns False there, but make it explicit so the recursion above is
  // the ONLY container path and a scalar `==` never sees a container pair.
  '    if isinstance(a, (list, tuple, dict)) or isinstance(b, (list, tuple, dict)):',
  '        return False',
  '    return a == b',
  '',
  'def _kern_loose_equal(a, b):',
  '    if _kern_is_nullish(a) and _kern_is_nullish(b):',
  '        return True',
  '    return _kern_strict_equal(a, b)',
].join('\n');

// Slice S7 — sentinel-aware `Json.stringify` / `JSON.stringify` shim. Raw
// `json.dumps` cannot model JS `JSON.stringify`'s undefined handling, so the
// Python target routes through `_kern_json_stringify`:
//   - top-level `_KERN_UNDEFINED` → returns the sentinel itself (host-observed
//     `undefined`), matching JS `JSON.stringify(undefined) === undefined`.
//   - object property whose value is the sentinel → key OMITTED.
//   - array element that is the sentinel → JSON `null`.
//   - rules apply recursively into nested objects/arrays.
//   - `None` stays JSON `null`; compact separators + ensure_ascii=False
//     preserve the existing byte-for-byte parity for sentinel-free inputs.
// `_kern_json_prepare` returns a sentinel-free structure that `json.dumps` can
// serialize; the top-level sentinel is short-circuited before dumps runs. The
// block self-defines `_KERN_UNDEFINED` via the idempotent guard so it stands
// alone. It references `__k_json`, which the emitter supplies via the stdlib
// table's `requires.py: 'json'` → `import json as __k_json` (kept, NOT
// self-imported here, so a body that ALSO calls `Json.parse` shares one import).
export const KERN_JSON_STRINGIFY_SHIM_PY = [
  'try:',
  '    _KERN_UNDEFINED',
  'except NameError:',
  '    class _KernUndefined:',
  '        def __bool__(self): return False',
  "        def __repr__(self): return 'undefined'",
  "        def __str__(self): return 'undefined'",
  '    _KERN_UNDEFINED = _KernUndefined()',
  '',
  'def _kern_json_prepare(__k_v):',
  '    if isinstance(__k_v, dict):',
  '        __k_out = {}',
  '        for __k_k, __k_val in __k_v.items():',
  '            if __k_val is _KERN_UNDEFINED:',
  '                continue',
  '            __k_out[__k_k] = _kern_json_prepare(__k_val)',
  '        return __k_out',
  '    if isinstance(__k_v, (list, tuple)):',
  '        return [None if __k_e is _KERN_UNDEFINED else _kern_json_prepare(__k_e) for __k_e in __k_v]',
  '    return __k_v',
  '',
  'def _kern_json_stringify(__k_v):',
  '    if __k_v is _KERN_UNDEFINED:',
  '        return _KERN_UNDEFINED',
  '    return __k_json.dumps(_kern_json_prepare(__k_v), separators=(",", ":"), ensure_ascii=False)',
].join('\n');

export const KERN_PAIR_HELPERS_PY = [
  'def _kern_pairs(__k_v):',
  '    return __k_v.items() if hasattr(__k_v, "items") else iter(__k_v)',
  '',
  'async def _kern_async_pairs(__k_v):',
  '    if hasattr(__k_v, "__aiter__"):',
  '        async for __k_item in __k_v:',
  '            yield __k_item',
  '    else:',
  '        for __k_item in _kern_pairs(__k_v):',
  '            yield __k_item',
].join('\n');

export const KERN_FMT_HELPER_PY = [
  'try:',
  '    _KERN_UNDEFINED',
  'except NameError:',
  '    class _KernUndefined:',
  // JS `undefined` is falsy: `!undefined`, `undefined ? a : b`, `if (undefined)`,
  // and `undefined || x` must behave as falsy. A bare object is truthy in Python,
  // so override __bool__ — without this the sentinel diverges from JS in every
  // truthiness position. Identity (`is`) is unaffected, so the `??` checks hold.
  '        def __bool__(self): return False',
  "        def __repr__(self): return 'undefined'",
  "        def __str__(self): return 'undefined'",
  '    _KERN_UNDEFINED = _KernUndefined()',
  '',
  'def _kern_fmt(__k_v):',
  '    if __k_v is _KERN_UNDEFINED:',
  "        return 'undefined'",
  '    if __k_v is None:',
  "        return 'null'",
  '    if isinstance(__k_v, bool):',
  "        return 'true' if __k_v else 'false'",
  '    if isinstance(__k_v, str):',
  '        return __k_v',
  '    if isinstance(__k_v, float) and __k_v != __k_v:',
  "        return 'NaN'",
  // JS String(Infinity) is "Infinity"/"-Infinity"; Python str(inf) is "inf".
  // Check before is_integer() — inf.is_integer() is False and int(inf) raises.
  "    if isinstance(__k_v, float) and __k_v == float('inf'):",
  "        return 'Infinity'",
  "    if isinstance(__k_v, float) and __k_v == float('-inf'):",
  "        return '-Infinity'",
  '    if isinstance(__k_v, float) and __k_v.is_integer():',
  '        return str(int(__k_v))',
  '    if isinstance(__k_v, (int, float)):',
  '        return str(__k_v)',
  '    if isinstance(__k_v, (list, tuple)):',
  "        return ','.join(",
  "            '' if x is None or x is _KERN_UNDEFINED else _kern_fmt(x)",
  '            for x in __k_v',
  '        )',
  '    if isinstance(__k_v, dict):',
  "        return '[object Object]'",
  '    return str(__k_v)',
  '',
  'def __kern_add(left, right):',
  '    # JS `+`: string concat when either operand is string-ish (ToPrimitive →',
  '    # string for str/array/object/tuple); otherwise numeric addition with ToNumber',
  '    # coercion (null→0, undefined→NaN, bool→0/1) so `5 + null` is 5, not "5null".',
  '    if isinstance(left, (str, list, tuple, dict)) or isinstance(right, (str, list, tuple, dict)):',
  '        return _kern_fmt(left) + _kern_fmt(right)',
  '    def _num(v):',
  '        if v is _KERN_UNDEFINED:',
  "            return float('nan')",
  '        if v is None:',
  '            return 0',
  '        if isinstance(v, bool):',
  '            return 1 if v else 0',
  '        return v',
  '    # ToNumber path for the KERN value domain (numbers/bool/null/undefined).',
  '    # Any exotic host type (set, custom object) that escapes the string-ish',
  '    # check falls back to JS object→string concat rather than raising.',
  '    try:',
  '        return _num(left) + _num(right)',
  '    except TypeError:',
  '        return _kern_fmt(left) + _kern_fmt(right)',
].join('\n');

export const KERN_I32_HELPER_PY = [
  'import math',
  'def _i32(x):',
  '    if x is None: return 0',
  '    try:',
  '        if not math.isfinite(x): return 0',
  '        val = int(math.trunc(x))',
  '    except Exception:',
  '        try:',
  '            val = float(x)',
  '            if not math.isfinite(val): return 0',
  '            val = int(math.trunc(val))',
  '        except Exception:',
  '            return 0',
  '    return ((val & 0xFFFFFFFF) ^ 0x80000000) - 0x80000000',
].join('\n');

/**
 * ToNumericPrimitive substrate (slice 0.75) — Python twin of the
 * `@kernlang/core` `to-numeric` decision kernel.
 *
 * Single Python-side source of numeric coercion truth for the FROZEN primitive
 * domain (numbers, ECMA numeric strings, booleans, null, undefined sentinel).
 * The emitted Python encodes the ECMA-262 StringNumericLiteral grammar
 * EXPLICITLY rather than delegating to `float(...)`, because `float()` diverges
 * from JS `Number()` on three load-bearing cases: it accepts numeric separators
 * (`float('1_000') == 1000.0`), case-insensitive infinity/NaN words
 * (`float('infinity')`, `float('nan')`), and raises on `0x`/`0b`/`0o` prefixes.
 *
 * Return-type contract (tribunal amendments 1 & 2):
 *   - `_kern_to_number(x)`            -> Python `float` for EVERY numeric output
 *     (bool/null/hex/binary/octal inputs included); `-0.0` sign survives; NaN
 *     and ±inf preserved.
 *   - `_kern_string_to_number(text)` -> `float` (NaN for any non-grammar string).
 *   - `_kern_number_to_int32(n)`     -> `int`   (signed 32-bit, shift-mask domain).
 *   - `_kern_number_to_uint32(n)`    -> `int`   (unsigned 32-bit).
 *   - `_kern_to_int32(x)`            -> `int`   = int32(to_number(x)).
 *   - `_kern_to_uint32(x)`           -> `int`   = uint32(to_number(x)).
 *   - `_kern_to_integer_or_infinity(x)` -> `float` (int-valued, or ±inf).
 *
 * Fail-closed: objects/arrays/functions/symbols/custom-valueOf RAISE
 * `_KernNumericCoercionError` (the caller decides) — full ToPrimitive deferred.
 *
 * Single-source-of-int32 note: this block is the coercion-correct int32 path
 * going forward. The legacy `_i32` (KERN_I32_HELPER_PY) embeds its OWN
 * float()-based coercion and is still wired to production
 * (codegen-body-python.ts ToInt32 lowering). Slice 0.75 is a PURE ADDITION —
 * nothing is rerouted here, so both coexist; the future routing slice retires
 * `_i32` in favor of `_kern_to_int32` once the fallback count hits zero.
 *
 * The ECMA whitespace string below is the exact `StrWhiteSpace` set
 * (`WhiteSpace` + `LineTerminator`) JS trims from a StringNumericLiteral, kept
 * byte-aligned with `ECMA_STR_WHITESPACE` in the TS kernel.
 */
export const KERN_TO_NUMBER_HELPER_PY = [
  'import math',
  'import re',
  '',
  'try:',
  '    _KERN_UNDEFINED',
  'except NameError:',
  '    class _KernUndefined:',
  '        def __bool__(self): return False',
  "        def __repr__(self): return 'undefined'",
  "        def __str__(self): return 'undefined'",
  '    _KERN_UNDEFINED = _KernUndefined()',
  '',
  'class _KernNumericCoercionError(TypeError):',
  '    pass',
  '',
  // ECMA StrWhiteSpace = WhiteSpace + LineTerminator. Encoded as \u escapes so
  // the emitted source stays ASCII; Python materializes the real code points.
  "_KERN_ECMA_WS = '\\t\\n\\x0b\\x0c\\r \\xa0\\u1680\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff'",
  "_KERN_DECIMAL_RE = re.compile(r'^[+-]?(?:(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?|[0-9]+)$')",
  "_KERN_HEX_RE = re.compile(r'^0[xX][0-9a-fA-F]+$')",
  "_KERN_BIN_RE = re.compile(r'^0[bB][01]+$')",
  "_KERN_OCT_RE = re.compile(r'^0[oO][0-7]+$')",
  '',
  'def _kern_string_to_number(text):',
  '    s = text.strip(_KERN_ECMA_WS)',
  "    if s == '':",
  '        return 0.0',
  "    if s == 'Infinity' or s == '+Infinity':",
  "        return float('inf')",
  "    if s == '-Infinity':",
  "        return float('-inf')",
  '    if _KERN_HEX_RE.match(s):',
  '        return float(int(s[2:], 16))',
  '    if _KERN_BIN_RE.match(s):',
  '        return float(int(s[2:], 2))',
  '    if _KERN_OCT_RE.match(s):',
  '        return float(int(s[2:], 8))',
  '    if not _KERN_DECIMAL_RE.match(s):',
  "        return float('nan')",
  '    try:',
  '        return float(s)',
  '    except ValueError:',
  "        return float('nan')",
  '',
  'def _kern_to_number(x):',
  '    if x is _KERN_UNDEFINED:',
  "        return float('nan')",
  '    if x is None:',
  '        return 0.0',
  '    if isinstance(x, bool):',
  '        return 1.0 if x else 0.0',
  '    if isinstance(x, (int, float)):',
  '        return float(x)',
  '    if isinstance(x, str):',
  '        return _kern_string_to_number(x)',
  "    raise _KernNumericCoercionError('KERN ToNumber supports only primitive values (slice-0.75); full ToPrimitive deferred')",
  '',
  'def _kern_number_to_int32(n):',
  "    if n != n or n == 0 or n in (float('inf'), float('-inf')):",
  '        return 0',
  '    i = math.trunc(n)',
  '    return ((i & 0xFFFFFFFF) ^ 0x80000000) - 0x80000000',
  '',
  'def _kern_number_to_uint32(n):',
  "    if n != n or n == 0 or n in (float('inf'), float('-inf')):",
  '        return 0',
  '    return math.trunc(n) & 0xFFFFFFFF',
  '',
  'def _kern_to_int32(x):',
  '    return _kern_number_to_int32(_kern_to_number(x))',
  '',
  'def _kern_to_uint32(x):',
  '    return _kern_number_to_uint32(_kern_to_number(x))',
  '',
  'def _kern_to_integer_or_infinity(x):',
  '    n = _kern_to_number(x)',
  '    if n != n:',
  '        return 0.0',
  "    if n in (float('inf'), float('-inf')):",
  '        return n',
  '    return float(math.trunc(n))',
].join('\n');

export const KERN_TMOD_HELPER_PY = [
  'import math',
  'def _tmod(a, b):',
  '    if a is None: a = 0',
  '    if b is None: b = 0',
  '    try:',
  '        fa = float(a)',
  '        fb = float(b)',
  '    except Exception:',
  "        return float('nan')",
  "    if math.isnan(fa) or math.isnan(fb): return float('nan')",
  "    if math.isinf(fa): return float('nan')",
  "    if fb == 0: return float('nan')",
  '    if math.isinf(fb): return fa',
  '    return fa - math.trunc(fa / fb) * fb',
].join('\n');

export const KERN_JS_HELPER_PY = [
  // Slice S4 — ToBoolean / KERN truthiness substrate. `js_truthy` is an EXPLICIT
  // falsy-set predicate over the KERN value domain: falsy iff x is the undefined
  // sentinel, None, a boolean False, numeric zero (+0/-0.0/0j), NaN, or "".
  // Everything else is truthy — INCLUDING [], {}, callables, class instances, and
  // user objects whose Python __bool__/__len__ are falsy. It NEVER delegates to
  // bool(x), len(x), x.__bool__(), x.__len__(), or a ToNumber string conversion:
  // "0", "false", " " are all truthy; only "" is falsy. `bool` is checked BEFORE
  // the numeric branch because Python `bool` subclasses `int`. The undefined
  // sentinel is matched by IDENTITY (`is _KERN_UNDEFINED`) — its __bool__ = False
  // override is for bare-truthiness positions only and must NOT be generalized to
  // user objects. `_kern_truthy` is the canonical name; `js_truthy` is the alias
  // the existing array-predicate lowerings (filter/some/every/find-family) call.
  'try:',
  '    _KERN_UNDEFINED',
  'except NameError:',
  '    class _KernUndefined:',
  '        def __bool__(self): return False',
  "        def __repr__(self): return 'undefined'",
  "        def __str__(self): return 'undefined'",
  '    _KERN_UNDEFINED = _KernUndefined()',
  'def _kern_truthy(x):',
  '    if x is _KERN_UNDEFINED or x is None or x is False: return False',
  '    if isinstance(x, bool): return x',
  // `x == x` is False only for NaN, so `x != 0 and x == x` rejects both numeric
  // zero (incl. -0.0 and 0j) and NaN without delegating to math.isnan / bool().
  '    if isinstance(x, (int, float, complex)): return x != 0 and x == x',
  '    if isinstance(x, str): return len(x) > 0',
  '    return True',
  'def js_truthy(x):',
  '    return _kern_truthy(x)',
  'def js_equals(a, b):',
  '    return a == b',
].join('\n');

export const KERN_JS_ARRAY_HELPERS_PY = [
  '_KERN_JS_FILL_ABSENT = object()',
  '',
  'try:',
  '    _KERN_UNDEFINED',
  'except NameError:',
  '    class _KernUndefined:',
  '        def __bool__(self): return False',
  "        def __repr__(self): return 'undefined'",
  "        def __str__(self): return 'undefined'",
  '    _KERN_UNDEFINED = _KernUndefined()',
  '',
  'def _kern_js_is_undefined(__k_x):',
  '    return __k_x is _KERN_UNDEFINED',
  '',
  'def _kern_js_to_integer_or_infinity(__k_x):',
  '    if __k_x is None:',
  '        return 0',
  '    if _kern_js_is_undefined(__k_x):',
  '        return 0',
  '    try:',
  '        __k_n = float(__k_x)',
  '    except Exception:',
  '        return 0',
  '    if __k_n != __k_n:',
  '        return 0',
  '    if __k_n == float("inf"):',
  '        return float("inf")',
  '    if __k_n == float("-inf"):',
  '        return float("-inf")',
  '    return int(__k_n)',
  '',
  'def _kern_js_relative_index(__k_index, __k_len):',
  '    if __k_index == float("-inf"):',
  '        return 0',
  '    if __k_index == float("inf"):',
  '        return __k_len',
  '    if __k_index < 0:',
  '        return max(__k_len + __k_index, 0)',
  '    return min(__k_index, __k_len)',
  '',
  'def _kern_js_fill(__k_list, __k_value, __k_start=0, __k_end=_KERN_JS_FILL_ABSENT):',
  '    __k_len = len(__k_list)',
  '    __k_s = _kern_js_relative_index(_kern_js_to_integer_or_infinity(__k_start), __k_len)',
  '    if __k_end is _KERN_JS_FILL_ABSENT or _kern_js_is_undefined(__k_end):',
  '        __k_e = __k_len',
  '    else:',
  '        __k_e = _kern_js_relative_index(_kern_js_to_integer_or_infinity(__k_end), __k_len)',
  '    __k_list[__k_s:__k_e] = [__k_value] * max(0, __k_e - __k_s)',
  '    return __k_list',
].join('\n');

export const KERN_JS_OBJECT_HELPERS_PY = [
  // Slice S7 — `Object.keys/values/entries` must throw TypeError parity for BOTH
  // null and the undefined sentinel (JS `Object.keys(undefined)` throws). The
  // sentinel is defined here via the idempotent guard so the identity check is
  // safe even when this block is registered without the fmt/nullish blocks.
  'try:',
  '    _KERN_UNDEFINED',
  'except NameError:',
  '    class _KernUndefined:',
  '        def __bool__(self): return False',
  "        def __repr__(self): return 'undefined'",
  "        def __str__(self): return 'undefined'",
  '    _KERN_UNDEFINED = _KernUndefined()',
  '',
  'def _kern_js_is_array_index(__k_key):',
  '    __k_s = str(__k_key)',
  '    if not __k_s.isdigit(): return False',
  '    if len(__k_s) > 1 and __k_s[0] == "0": return False',
  '    __k_n = int(__k_s)',
  '    return 0 <= __k_n < 4294967295 and __k_s == str(__k_n)',
  '',
  'def _kern_js_property_items(__k_obj):',
  '    if __k_obj is None or __k_obj is _KERN_UNDEFINED:',
  '        raise TypeError("Cannot convert undefined or null to object")',
  '    if hasattr(__k_obj, "items"):',
  '        __k_raw = list(__k_obj.items())',
  '    else:',
  '        try:',
  '            __k_raw = [(str(__k_i), __k_v) for __k_i, __k_v in enumerate(__k_obj)]',
  '        except TypeError:',
  '            __k_raw = []',
  '    __k_indexed = []',
  '    __k_rest = []',
  '    for __k_pos, (__k_key, __k_val) in enumerate(__k_raw):',
  '        __k_s = str(__k_key)',
  '        if _kern_js_is_array_index(__k_s):',
  '            __k_indexed.append((int(__k_s), __k_s, __k_val))',
  '        else:',
  '            __k_rest.append((__k_pos, __k_s, __k_val))',
  '    return [(__k_s, __k_v) for _, __k_s, __k_v in sorted(__k_indexed, key=lambda __k_item: __k_item[0])] + [(__k_s, __k_v) for _, __k_s, __k_v in __k_rest]',
  '',
  'def _kern_js_object_keys(__k_obj):',
  '    return [__k_k for __k_k, _ in _kern_js_property_items(__k_obj)]',
  '',
  'def _kern_js_object_values(__k_obj):',
  '    return [__k_v for _, __k_v in _kern_js_property_items(__k_obj)]',
  '',
  'def _kern_js_object_entries(__k_obj):',
  '    return [[__k_k, __k_v] for __k_k, __k_v in _kern_js_property_items(__k_obj)]',
  '',
  'def _kern_js_object_assign(__k_target, *__k_sources):',
  '    if __k_target is None or __k_target is _KERN_UNDEFINED:',
  '        raise TypeError("Cannot convert undefined or null to object")',
  '    if hasattr(__k_target, "update"):',
  '        __k_out = __k_target',
  '    elif isinstance(__k_target, list):',
  '        __k_out = __k_target',
  '    elif isinstance(__k_target, str):',
  '        __k_out = {str(__k_i): __k_ch for __k_i, __k_ch in enumerate(__k_target)}',
  '    else:',
  '        __k_out = {}',
  '    for __k_src in __k_sources:',
  '        if __k_src is None or __k_src is _KERN_UNDEFINED:',
  '            continue',
  '        for __k_k, __k_v in _kern_js_property_items(__k_src):',
  '            if isinstance(__k_out, list):',
  '                if not _kern_js_is_array_index(__k_k):',
  '                    raise TypeError("Object.assign cannot attach non-index properties to Python list target")',
  '                __k_i = int(__k_k)',
  '                while len(__k_out) <= __k_i:',
  '                    __k_out.append(_KERN_UNDEFINED)',
  '                __k_out[__k_i] = __k_v',
  '            else:',
  '                __k_out[__k_k] = __k_v',
  '    return __k_out',
].join('\n');

export const KERN_JS_MATH_HELPERS_PY = [
  'import math',
  '',
  'def _kern_math_is_negative_zero(__k_n):',
  '    return __k_n == 0 and math.copysign(1.0, __k_n) < 0',
  '',
  'def _kern_math_nan():',
  '    return float("nan")',
  '',
  'def _kern_math_round(__k_x):',
  '    __k_n = _kern_to_number(__k_x)',
  '    if __k_n != __k_n or __k_n in (float("inf"), float("-inf")) or __k_n == 0:',
  '        return __k_n',
  '    __k_floor = math.floor(__k_n)',
  '    __k_r = __k_floor + (1 if __k_n - __k_floor >= 0.5 else 0)',
  '    if __k_r == 0 and __k_n < 0:',
  '        return -0.0',
  '    return __k_r',
  '',
  'def _kern_math_floor(__k_x):',
  '    __k_n = _kern_to_number(__k_x)',
  '    if __k_n != __k_n or __k_n in (float("inf"), float("-inf")) or __k_n == 0:',
  '        return __k_n',
  '    return math.floor(__k_n)',
  '',
  'def _kern_math_trunc(__k_x):',
  '    __k_n = _kern_to_number(__k_x)',
  '    if __k_n != __k_n or __k_n in (float("inf"), float("-inf")) or __k_n == 0:',
  '        return __k_n',
  '    __k_r = math.trunc(__k_n)',
  '    if __k_r == 0 and __k_n < 0:',
  '        return -0.0',
  '    return __k_r',
  '',
  'def _kern_math_sign(__k_x):',
  '    __k_n = _kern_to_number(__k_x)',
  '    if __k_n != __k_n or __k_n == 0:',
  '        return __k_n',
  '    return 1 if __k_n > 0 else -1',
  '',
  'def _kern_math_max(*__k_args):',
  '    if len(__k_args) == 0:',
  '        return float("-inf")',
  '    __k_best = float("-inf")',
  '    for __k_arg in __k_args:',
  '        __k_n = _kern_to_number(__k_arg)',
  '        if __k_n != __k_n:',
  '            return _kern_math_nan()',
  '        if __k_n > __k_best or (__k_n == 0 and __k_best == 0 and not _kern_math_is_negative_zero(__k_n) and _kern_math_is_negative_zero(__k_best)):',
  '            __k_best = __k_n',
  '    return __k_best',
  '',
  'def _kern_math_min(*__k_args):',
  '    if len(__k_args) == 0:',
  '        return float("inf")',
  '    __k_best = float("inf")',
  '    for __k_arg in __k_args:',
  '        __k_n = _kern_to_number(__k_arg)',
  '        if __k_n != __k_n:',
  '            return _kern_math_nan()',
  '        if __k_n < __k_best or (__k_n == 0 and __k_best == 0 and _kern_math_is_negative_zero(__k_n) and not _kern_math_is_negative_zero(__k_best)):',
  '            __k_best = __k_n',
  '    return __k_best',
].join('\n');

export const KERN_JS_ARRAY_FROM_HELPER_PY = [
  'import inspect',
  '',
  'try:',
  '    _KERN_UNDEFINED',
  'except NameError:',
  '    class _KernUndefined:',
  '        def __bool__(self): return False',
  "        def __repr__(self): return 'undefined'",
  "        def __str__(self): return 'undefined'",
  '    _KERN_UNDEFINED = _KernUndefined()',
  '',
  'def _kern_array_like_get(__k_source, __k_index):',
  '    if isinstance(__k_source, dict):',
  '        if __k_index in __k_source:',
  '            return __k_source[__k_index]',
  '        __k_key = str(__k_index)',
  '        return __k_source[__k_key] if __k_key in __k_source else _KERN_UNDEFINED',
  '    try:',
  '        return __k_source[__k_index]',
  '    except Exception:',
  '        return _KERN_UNDEFINED',
  '',
  'def _kern_array_like_length(__k_source):',
  '    if isinstance(__k_source, dict):',
  '        __k_len = __k_source.get("length", 0)',
  '    else:',
  '        __k_len = getattr(__k_source, "length", None)',
  '    if __k_len is None:',
  '        return None',
  '    try:',
  '        __k_num = _kern_to_number(__k_len)',
  '    except Exception:',
  '        return 0',
  '    if __k_num != __k_num or __k_num <= 0:',
  '        return 0',
  '    if __k_num == float("inf"):',
  '        return 9007199254740991',
  '    return min(int(__k_num), 9007199254740991)',
  '',
  'def _kern_array_from(__k_source, __k_mapper=None):',
  '    if __k_source is None or __k_source is _KERN_UNDEFINED:',
  '        raise TypeError("Array.from requires an array-like or iterable source")',
  '    __k_len = _kern_array_like_length(__k_source)',
  '    if __k_len is not None:',
  '        __k_values = [_kern_array_like_get(__k_source, __k_i) for __k_i in range(__k_len)]',
  '    elif isinstance(__k_source, str):',
  '        __k_values = list(__k_source)',
  '    else:',
  '        try:',
  '            __k_values = list(__k_source)',
  '        except TypeError:',
  '            __k_values = []',
  '    if __k_mapper is None:',
  '        return list(__k_values)',
  '    return [_kern_array_from_map(__k_mapper, __k_value, __k_index) for __k_index, __k_value in enumerate(__k_values)]',
  '',
  'def _kern_array_from_map(__k_mapper, __k_value, __k_index):',
  '    try:',
  '        __k_sig = inspect.signature(__k_mapper)',
  '        __k_params = list(__k_sig.parameters.values())',
  '        if any(__k_p.kind == inspect.Parameter.VAR_POSITIONAL for __k_p in __k_params):',
  '            return __k_mapper(__k_value, __k_index)',
  '        __k_positional = [__k_p for __k_p in __k_params if __k_p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)]',
  '        if len(__k_positional) < 2:',
  '            return __k_mapper(__k_value)',
  '    except (TypeError, ValueError):',
  '        pass',
  '    return __k_mapper(__k_value, __k_index)',
].join('\n');

export const KERN_JS_STRING_HELPERS_PY = [
  'def _kern_js_split_limit(__k_limit):',
  '    if __k_limit is None:',
  '        return None',
  '    try:',
  '        __k_n = float(__k_limit)',
  '    except Exception:',
  '        return 0',
  '    if __k_n != __k_n or __k_n in (float("inf"), float("-inf")):',
  '        return 0',
  '    return int(__k_n) % 4294967296',
  '',
  'def _kern_js_replacement(__k_repl, __k_match, __k_prefix, __k_suffix):',
  '    __k_repl = str(__k_repl)',
  '    __k_out = []',
  '    __k_i = 0',
  '    while __k_i < len(__k_repl):',
  '        __k_c = __k_repl[__k_i]',
  '        if __k_c == "$" and __k_i + 1 < len(__k_repl):',
  '            __k_n = __k_repl[__k_i + 1]',
  '            if __k_n == "$":',
  '                __k_out.append("$"); __k_i += 2; continue',
  '            if __k_n == "&":',
  '                __k_out.append(__k_match); __k_i += 2; continue',
  '            if __k_n == "`":',
  '                __k_out.append(__k_prefix); __k_i += 2; continue',
  '            if __k_n == "\'":',
  '                __k_out.append(__k_suffix); __k_i += 2; continue',
  '        __k_out.append(__k_c)',
  '        __k_i += 1',
  '    return "".join(__k_out)',
  '',
  'def _kern_js_replace(__k_s, __k_search, __k_repl, __k_all=False):',
  '    __k_s = str(__k_s)',
  '    __k_search = str(__k_search)',
  '    if not __k_all:',
  '        __k_idx = __k_s.find(__k_search)',
  '        if __k_idx < 0: return __k_s',
  '        __k_end = __k_idx + len(__k_search)',
  '        return __k_s[:__k_idx] + _kern_js_replacement(__k_repl, __k_search, __k_s[:__k_idx], __k_s[__k_end:]) + __k_s[__k_end:]',
  '    if __k_search == "":',
  '        return "".join(_kern_js_replacement(__k_repl, "", __k_s[:__k_i], __k_s[__k_i:]) + (__k_s[__k_i] if __k_i < len(__k_s) else "") for __k_i in range(len(__k_s) + 1))',
  '    __k_parts = []',
  '    __k_pos = 0',
  '    while True:',
  '        __k_idx = __k_s.find(__k_search, __k_pos)',
  '        if __k_idx < 0:',
  '            __k_parts.append(__k_s[__k_pos:])',
  '            break',
  '        __k_end = __k_idx + len(__k_search)',
  '        __k_parts.append(__k_s[__k_pos:__k_idx])',
  '        __k_parts.append(_kern_js_replacement(__k_repl, __k_search, __k_s[:__k_idx], __k_s[__k_end:]))',
  '        __k_pos = __k_end',
  '    return "".join(__k_parts)',
].join('\n');
