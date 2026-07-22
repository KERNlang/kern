/** KERN-stdlib lowering table — slices 2a + 2b.
 *
 *  Per the brainstorm-locked design, KERN handler bodies use module-prefixed
 *  function calls (`Text.upper(s)`) instead of method dispatch (`s.upper()`).
 *  This table maps each KERN-stdlib operation to its per-target template so
 *  the SAME KERN source emits idiomatic TS and idiomatic Python.
 *
 *  Template shape: each entry's `ts` and `py` fields are template strings
 *  with `$0`, `$1`, … placeholders that reference call args by zero-based
 *  position. The template is a string (not a structured shape) because the
 *  cross-target divergence is irregular enough that any structured shape
 *  ends up being "string with knobs". Concrete divergence cases:
 *    - `Text.includes(s, sub)` → TS `s.includes(sub)` vs Python `sub in s`
 *      (operator, not method)
 *    - `List.isEmpty(xs)` → TS `xs.length === 0` vs Python `len(xs) == 0`
 *      (compound binop expressions, not method/prop)
 *    - `List.join(xs, sep)` → TS `xs.join(sep)` vs Python `sep.join(xs)`
 *      (receiver inverted)
 *    - `List.last(xs)` → TS `xs[xs.length - 1]` vs Python `xs[-1]`
 *      (different subscript expressions)
 *    - `Number.floor(n)` → TS `Math.floor(n)` vs Python `math.floor(n)`
 *      (different module qualification)
 *  Templates handle all of these uniformly.
 *
 *  Slices in this table:
 *    - 2a: Text upper/lower/length/trim
 *    - 2b: Text+ (includes, startsWith, endsWith, split, replace);
 *      List (length, isEmpty, includes, first, last, indexOf, join);
 *      Map (has, get, size); Number (round, floor, ceil, abs, isFinite, isNaN).
 *  Future slices may extend further (List.map / List.filter need closures,
 *  so they're deferred until closure support — currently never).
 *
 *  Diagnostic: when codegen sees `<KnownModule>.<unknownMethod>(...)`, it
 *  throws with a Levenshtein did-you-mean. Calls into modules NOT in this
 *  table fall through to the default emit path (passthrough). */

export interface StdlibCallEntry {
  kind?: 'call';
  arity?: number;
  minArity?: number;
  maxArity?: number;
  variadic?: boolean;
  ts: string | ((args: string[]) => string);
  py: string | ((args: string[]) => string);
  /** Slice 3b — per-target imports required when this lowering is used.
   *  The body emitter collects these into a per-handler import set so the
   *  generator can emit `import math` (etc.) at the top of the function
   *  body. Keys are target names ('ts' / 'py'); values are the import
   *  identifier (`'math'` ⇒ `import math`). Undefined when none required. */
  requires?: { ts?: string; py?: string };
}

export interface StdlibPropertyEntry {
  kind: 'property';
  ts: string;
  py: string;
  requires?: { ts?: string; py?: string };
}

export type StdlibEntry = StdlibCallEntry | StdlibPropertyEntry;

export const KERN_STDLIB: Record<string, Record<string, StdlibEntry>> = {
  Text: {
    upper: { arity: 1, ts: '$0.toUpperCase()', py: '$0.upper()' },
    lower: { arity: 1, ts: '$0.toLowerCase()', py: '$0.lower()' },
    // KERN 4.5.0 item 3 — string parity completion (tribunal-locked contract,
    // Option D — Unicode CODE POINTS). `length`/`charAt`/`slice`/`indexOf`/
    // `startsWith` used to lower to NATIVE JS/Python string ops, which are
    // UTF-16-code-UNIT-indexed on the TS leg — a standing parity violation
    // against the ReferenceRunner's code-point contract (`Text.length("a💩b")`
    // must be 3, not 4). They now lower to the shared `__kern_text_*` (TS) /
    // `_kern_text_*` (Python) helpers single-sourced in `text-contract.ts`,
    // which both walk CODE POINTS and fail closed on a malformed (lone or
    // reversed) UTF-16 surrogate — byte-identical fail-close set to the
    // runner. `charAt`/`slice`/`indexOf` were previously RUNNER-ONLY (not in
    // this table at all); this slice lowers them into both codegen legs for
    // the first time. See `text-contract.ts`'s module doc for the full
    // three-leg architecture and `stdlib-preamble.ts` (`usage.textOps`) /
    // `registerStdlibRequirementPython` (`'text-ops'`) for the per-leg helper
    // injection wiring.
    length: { arity: 1, ts: '__kern_text_length($0)', py: '_kern_text_length($0)', requires: { py: 'text-ops' } },
    charAt: {
      arity: 2,
      ts: '__kern_text_char_at($0, $1)',
      py: '_kern_text_char_at($0, $1)',
      requires: { py: 'text-ops' },
    },
    slice: {
      arity: 3,
      ts: '__kern_text_slice($0, $1, $2)',
      py: '_kern_text_slice($0, $1, $2)',
      requires: { py: 'text-ops' },
    },
    indexOf: {
      arity: 2,
      ts: '__kern_text_index_of($0, $1)',
      py: '_kern_text_index_of($0, $1)',
      requires: { py: 'text-ops' },
    },
    startsWith: {
      arity: 2,
      ts: '__kern_text_starts_with($0, $1)',
      py: '_kern_text_starts_with($0, $1)',
      requires: { py: 'text-ops' },
    },
    trim: { arity: 1, ts: '$0.trim()', py: '$0.strip()' },
    includes: { arity: 2, ts: '$0.includes($1)', py: '$1 in $0' },
    endsWith: { arity: 2, ts: '$0.endsWith($1)', py: '$0.endswith($1)' },
    split: { arity: 2, ts: '$0.split($1)', py: '$0.split($1)' },
    // Slice-2 review fix: replace-all is the canonical KERN semantics. JS
    // `replace` only swaps the first match; KERN normalizes to TS
    // `replaceAll` (ES2021+) and Python `replace` (default replace-all).
    replace: { arity: 3, ts: '$0.replaceAll($1, $2)', py: '$0.replace($1, $2)' },
  },
  List: {
    length: { arity: 1, ts: '$0.length', py: 'len($0)' },
    index: {
      arity: 2,
      ts: '__kernListIndex($0, $1)',
      py: '__kern_list_index($0, $1)',
      requires: { py: 'list-index' },
    },
    isEmpty: { arity: 1, ts: '$0.length === 0', py: 'len($0) == 0' },
    includes: { arity: 2, ts: '$0.includes($1)', py: '$1 in $0' },
    first: { arity: 1, ts: '$0[0]', py: '$0[0]' },
    // Slice-2 review fix: `$0[$0.length - 1]` evaluated `$0` twice; if `$0`
    // is a function call, that's a double-evaluation bug. `.at(-1)` is
    // ES2022+ and matches Python's `[-1]` semantics (single eval, supports
    // negative index).
    last: { arity: 1, ts: '$0.at(-1)', py: '$0[-1]' },
    // Slice-2 review fix: Python `list.index` raises ValueError when the
    // item isn't found; TS `indexOf` returns -1. Match TS by guarding with
    // a containment check.
    indexOf: { arity: 2, ts: '$0.indexOf($1)', py: '($0.index($1) if $1 in $0 else -1)' },
    // Slice-2 review fix: Python `str.join` requires string elements. Wrap
    // with `map(str, …)` so non-string KERN values stringify like JS does.
    join: { arity: 2, ts: '$0.join($1)', py: '$1.join(map(str, $0))' },
    map: { arity: 2, ts: '$0.map($1)', py: 'list(map($1, $0))' },
    filter: { arity: 2, ts: '$0.filter($1)', py: 'list(filter($1, $0))' },
  },
  Map: {
    has: { arity: 2, ts: '$0.has($1)', py: '$1 in $0' },
    // Slice-2 review fix: TS `Map.get(k)` returns `undefined` for missing
    // keys. Python `dict[k]` raises KeyError. Use `.get($1)` (Python dicts'
    // safe-access, returns None) for parity.
    get: { arity: 2, ts: '$0.get($1)', py: '$0.get($1)' },
    size: { arity: 1, ts: '$0.size', py: 'len($0)' },
    // Milestone 5.1b — Map.set. TS `Map.prototype.set` is a native EXPRESSION
    // (returns the map, for chaining). Python's item-assignment (`d[k] = v`)
    // is a STATEMENT, not usable inline as an expression template — lower to
    // the `__setitem__` dunder call instead, which IS a valid Python
    // expression with the same side effect (assigns the key), so the SAME
    // `$0.method($1, $2)`-shaped template works on both legs.
    //
    // KNOWN divergence (documented, not corrected): the TWO legs' RETURN
    // VALUES differ — TS yields the Map object, Python's `__setitem__`
    // yields `None`. This is invisible when `Map.set(...)` is used the way
    // KERN's `do` body-statement documents it (a side-effecting expression
    // whose return value is DISCARDED — see schema.ts's `do` entry and the
    // reference runner's do.ts, which recognizes `Map.set` ONLY inside `do`).
    // Binding the return value directly (`let x = Map.set(m, k, v)`) is NOT
    // validated against here and would observably diverge; users should not
    // rely on `Map.set`'s return value on either target.
    set: { arity: 3, ts: '$0.set($1, $2)', py: '$0.__setitem__($1, $2)' },
  },
  Number: {
    // Slice 3c — JS `Math.round` rounds half toward +∞ (so Math.round(-1.5) === -1
    // and Math.round(2.5) === 3). Python's built-in `round` is banker's rounding
    // (half-to-even), which diverges on `.5` values. To preserve the JS-flavored
    // KERN AST semantics on the Python target, lower to `math.floor($0 + 0.5)`
    // — a one-line identity that matches JS `Math.round` parity for both
    // positive and negative half-cases. Single-eval because `$0` is substituted
    // once.
    // Slice 3 review fix (Gemini): use `__k_math` alias to avoid shadowing
    // when the user has a body-local binding or param named `math`. The
    // FastAPI generator emits `import math as __k_math` for any handler
    // that references these.
    round: { arity: 1, ts: 'Math.round($0)', py: '_kern_math_round($0)', requires: { py: 'math-host' } },
    floor: { arity: 1, ts: 'Math.floor($0)', py: '__k_math.floor($0)', requires: { py: 'math' } },
    ceil: { arity: 1, ts: 'Math.ceil($0)', py: '__k_math.ceil($0)', requires: { py: 'math' } },
    abs: { arity: 1, ts: 'Math.abs($0)', py: 'abs($0)' },
    // `Number.isFinite($0)` returns false for NaN, +∞, -∞ on both targets.
    // The TS lowering uses `Number.isFinite` (NOT the global `isFinite`) so
    // non-number arguments deterministically return false rather than being
    // coerced. Python's `math.isfinite` matches that semantic on float inputs;
    // KERN's type system rejects non-number arguments at AST validation, so
    // Python's `TypeError` on non-numerics is unreachable from typed bodies.
    isFinite: { arity: 1, ts: 'Number.isFinite($0)', py: '__k_math.isfinite($0)', requires: { py: 'math' } },
    // `Number.isNaN($0)` returns true ONLY for the NaN value itself (no
    // coercion). Python's `math.isnan` matches that strict shape. Use `Number`
    // (not the global `isNaN`) so the TS output is the strict, type-safe form.
    isNaN: { arity: 1, ts: 'Number.isNaN($0)', py: '__k_math.isnan($0)', requires: { py: 'math' } },
    // `Number.isInteger($0)` / `Number.isSafeInteger($0)` do NO coercion — a
    // non-number argument is always false. The TS lowering uses the type-safe
    // `Number.*` forms; the Python helpers reject `bool` explicitly (Python's
    // `bool` subclasses `int`, so `Number.isInteger(true)` must be false) and
    // treat NaN/±∞ as non-integers. `isSafeInteger` adds `abs(x) <= 2**53 - 1`.
    isInteger: {
      arity: 1,
      ts: 'Number.isInteger($0)',
      py: '_kern_number_is_integer($0)',
      requires: { py: 'number-host' },
    },
    isSafeInteger: {
      arity: 1,
      ts: 'Number.isSafeInteger($0)',
      py: '_kern_number_is_safe_integer($0)',
      requires: { py: 'number-host' },
    },
  },
  Math: {
    PI: { kind: 'property', ts: 'Math.PI', py: '__k_math.pi', requires: { py: 'math' } },
    E: { kind: 'property', ts: 'Math.E', py: '__k_math.e', requires: { py: 'math' } },
    max: {
      minArity: 0,
      variadic: true,
      ts: (args) => `Math.max(${args.join(', ')})`,
      py: (args) => `_kern_math_max(${args.join(', ')})`,
      requires: { py: 'math-host' },
    },
    min: {
      minArity: 0,
      variadic: true,
      ts: (args) => `Math.min(${args.join(', ')})`,
      py: (args) => `_kern_math_min(${args.join(', ')})`,
      requires: { py: 'math-host' },
    },
    round: { arity: 1, ts: 'Math.round($0)', py: '_kern_math_round($0)', requires: { py: 'math-host' } },
    floor: { arity: 1, ts: 'Math.floor($0)', py: '_kern_math_floor($0)', requires: { py: 'math-host' } },
    sign: { arity: 1, ts: 'Math.sign($0)', py: '_kern_math_sign($0)', requires: { py: 'math-host' } },
    trunc: { arity: 1, ts: 'Math.trunc($0)', py: '_kern_math_trunc($0)', requires: { py: 'math-host' } },
  },
  Array: {
    isArray: { arity: 1, ts: 'Array.isArray($0)', py: 'isinstance($0, list)' },
    from: {
      minArity: 1,
      maxArity: 2,
      ts: (args) => `Array.from(${args.join(', ')})`,
      py: (args) => `_kern_array_from(${args.join(', ')})`,
      requires: { py: 'array-host' },
    },
  },
  Object: {
    keys: { arity: 1, ts: 'Object.keys($0)', py: '_kern_js_object_keys($0)', requires: { py: 'object-host' } },
    assign: {
      minArity: 1,
      variadic: true,
      ts: (args) => `Object.assign(${args.join(', ')})`,
      py: (args) => `_kern_js_object_assign(${args.join(', ')})`,
      requires: { py: 'object-host' },
    },
  },
  JSON: {
    parse: { arity: 1, ts: 'JSON.parse($0)', py: '__k_json.loads($0)', requires: { py: 'json' } },
    stringify: {
      arity: 1,
      ts: 'JSON.stringify($0)',
      py: '__k_json.dumps($0, separators=(",", ":"), ensure_ascii=False)',
      requires: { py: 'json' },
    },
  },
  // Json + Path — pure/sync stdlib slice. Json relies on globals on TS (`JSON`)
  // and the stdlib `json` module on Python. Path covers the most common pure
  // string-on-path operation (`basename`); `posixpath` is platform-independent
  // (always treats `/` as the separator) so cross-target results match the
  // TS split-pop lowering byte-for-byte regardless of host OS.
  //
  // Variadic stdlib (e.g., `Path.join(a, b, ...rest)`) is intentionally NOT
  // included here. The current `StdlibEntry.arity: number` shape and the
  // arity check at both call sites (`call.args.length !== entry.arity`) only
  // model a fixed-arity contract. Adding `Path.join` would either need a
  // schema change to the lowering table or a special-case branch in the
  // dispatcher; both are out of scope for this slice. Users who need
  // multi-segment join can chain `Text.…` / nested calls or fall back to a
  // raw `lang=ts`/`lang=python` body until variadic lands.
  //
  // Cross-target divergences (Json) — known and documented, NOT corrected
  // automatically:
  //   - `Json.stringify` review fix (Codex): default `json.dumps` inserts
  //     `", "` / `": "` separators and ASCII-escapes non-ASCII (`"caf\\u00e9"`).
  //     `JSON.stringify` is compact and Unicode-literal. To restore byte
  //     parity for typical inputs we pass `separators=(",", ":")` and
  //     `ensure_ascii=False`.
  //   - `Json.parse` accepts more on Python than on TS: `json.loads` parses
  //     `NaN` / `Infinity` / `-Infinity` literals (a Python extension);
  //     `JSON.parse` rejects them as `SyntaxError`. KERN's typical use case
  //     parses API responses which never contain those literals, so this
  //     slice does not attempt to tighten Python parsing — we lift this to
  //     a follow-up if real divergence shows up. Until then, treat both
  //     targets as "JSON only" at the API boundary.
  //   - `Json.stringify` of `undefined` / functions / `Date` instances:
  //     TS silently drops `undefined` and function values, and serializes
  //     `Date` via `.toISOString()`. Python `dumps` raises `TypeError` on
  //     all three. KERN's type system already rejects `undefined` and
  //     functions as serializable inputs in typed bodies, so this is
  //     unreachable from well-typed source. `Date` is reachable; users
  //     handling timestamps should serialize them explicitly with
  //     `Text.…` helpers before stringifying, matching what they would
  //     write in Python today.
  //   - `Json.parse` and `Json.stringify` failure modes throw target-native
  //     error classes (TS `SyntaxError`/`TypeError` vs Python
  //     `JSONDecodeError`/`TypeError`). KERN doesn't yet wrap stdlib errors
  //     into a portable hierarchy; user code should not catch on the class
  //     name, only on the call boundary.
  Json: {
    parse: { arity: 1, ts: 'JSON.parse($0)', py: '__k_json.loads($0)', requires: { py: 'json' } },
    // Slice review fix (Codex): default Python `json.dumps` inserts `", "`/`": "`
    // separators and ASCII-escapes non-ASCII characters, so the same KERN source
    // emitted byte-divergent strings on the two targets — breaking hashing /
    // comparison / network-payload equality. Force compact separators and
    // literal-Unicode output to match `JSON.stringify` byte-for-byte for
    // primitives, arrays, and plain objects of strings/numbers/booleans/null.
    stringify: {
      arity: 1,
      ts: 'JSON.stringify($0)',
      py: '__k_json.dumps($0, separators=(",", ":"), ensure_ascii=False)',
      requires: { py: 'json' },
    },
  },
  Path: {
    // TS: split-pop is single-eval (`$0` substituted once) and posix-only,
    // matching the Python `posixpath` semantics. The outer parens are required
    // because `??` has lower precedence than member access — without them,
    // `Path.basename(x).slice(0)` would parse as `… ?? ''.slice(0)`.
    // Python: `__k_posixpath.basename` is platform-independent (unlike
    // `os.path.basename`, which switches separators on Windows). Aliased via
    // `__k_posixpath` so any user binding named `posixpath` stays accessible.
    basename: {
      arity: 1,
      ts: '($0.split("/").at(-1) ?? "")',
      py: '__k_posixpath.basename($0)',
      requires: { py: 'posixpath' },
    },
  },
  // DECIMAL — first-class member, Slice 1 (feasibility foundation). KERN's
  // arbitrary-precision decimal surface lowers to decimal.js on the TS leg and
  // Python's stdlib `decimal` module on the Python leg. This is the FIRST stdlib
  // entry to populate `requires.ts` (an EXTERNAL npm package, not a global) — the
  // TS leg auto-injects `import Decimal from 'decimal.js'` + a one-time context
  // configuration (precision 28, ROUND_HALF_EVEN, matching CPython's default
  // context) via the new TS imports channel, mirroring how `requires.py: 'math'`
  // auto-injects `import math as __k_math` on the Python leg.
  //
  // Surface (Slice 1, minimal): construction from a string literal + addition.
  //   - `Decimal.of("1.5")`     — construct. TS `new Decimal("1.5")`, PY
  //     `__k_decimal.Decimal("1.5")`. The string-literal arg is validated against
  //     the canonical-scale contract (`assertPortableDecimalLiteral`) so a
  //     significance-divergent literal (`"1.10"`, `"1E+2"`, `"-0"`) fails closed
  //     SYMMETRICALLY on both legs — see `decimal-contract.ts`.
  //   - `Decimal.add(a, b)`     — add. TS `$0.plus($1)` (NOT `$0 + $1`: JS `+`
  //     on decimal.js objects calls `.valueOf()` → float, losing precision), PY
  //     `$0 + $1` (native `Decimal.__add__` is exact). Both render `0.3` for
  //     `Decimal.add(Decimal.of("0.1"), Decimal.of("0.2"))`.
  //
  // The `Decimal.of` arg-literal scale validation is enforced at the dispatch
  // site (codegen-expression.ts / codegen-body-python.ts), not expressible as a
  // template, because it inspects the arg IR (string-literal-only + canonical).
  //
  // DEFERRED past Slice 1 (documented in the slice report): the bare `Decimal(...)`
  // construction sugar and the `+` OPERATOR on Decimal values — both need a
  // type-carrying IR / typed-value pass so `+` can dispatch to `.plus()` on the TS
  // leg when an operand is a Decimal that flowed through a variable/param/return.
  // Bare `Decimal(...)` is fail-closed (not registered as a portable lowering) so
  // it never verbatim-emits an undefined global.
  Decimal: {
    of: {
      arity: 1,
      ts: 'new Decimal($0)',
      py: '__k_decimal.Decimal($0)',
      requires: { ts: 'decimal.js', py: 'decimal' },
    },
    add: {
      arity: 2,
      ts: '$0.plus($1)',
      // Parenthesized so the lowered binary `+` is SELF-DELIMITING when nested as
      // an arg to an outer Decimal op (e.g. `Decimal.add(a, Decimal.add(b, c))` →
      // `a + (b + c)`, not `a + b + c`). Addition is associative so the value is
      // identical either way, but the parens keep the form correct-by-construction
      // for the non-associative ops (`sub`/`div`) a later slice will add. The TS
      // leg needs no wrap — `.plus()` is already a self-delimiting method call.
      py: '($0 + $1)',
      requires: { ts: 'decimal.js' },
    },
    // DECIMAL Slice 2 (item 4) — explicit safe arithmetic, each mirroring `add`'s
    // dual lowering: TS uses a self-delimiting decimal.js method call (no wrap),
    // Python parenthesizes the native operator so nesting stays correct-by-
    // construction for the non-associative ops (`sub`). Both legs render through
    // the canonical stringifier (decimal.js `.toString()` on TS; `_kern_decimal_str`
    // on Python — wired in via `_kern_fmt` + the contract). These four carry ZERO
    // new divergence axis under the pinned 28-digit / ROUND_HALF_EVEN context.
    // `div`/`mod`/`pow` are DEFERRED (own divergence axes: div-by-zero, rounding,
    // non-terminating quotients) per the Slice-2 spec.
    sub: {
      arity: 2,
      ts: '$0.minus($1)',
      py: '($0 - $1)',
      requires: { ts: 'decimal.js' },
    },
    mul: {
      arity: 2,
      ts: '$0.times($1)',
      py: '($0 * $1)',
      requires: { ts: 'decimal.js' },
    },
    neg: {
      arity: 1,
      ts: '$0.neg()',
      // Parenthesized unary minus keeps the form self-delimiting when nested as an
      // arg to an outer Decimal op (e.g. `Decimal.add(Decimal.neg(a), b)` →
      // `((-a) + b)`).
      py: '(-$0)',
      requires: { ts: 'decimal.js' },
    },
    abs: {
      arity: 1,
      ts: '$0.abs()',
      // Python `abs(...)` is already a self-delimiting call — no extra wrap needed.
      py: 'abs($0)',
      requires: { ts: 'decimal.js' },
    },
    // DECIMAL Slice 3 — div/mod/pow lower to KERN-emitted GUARDED helpers on BOTH
    // legs (single-sourced in `decimal-contract.ts`, rendered into each leg's
    // decimal preamble/prelude). The helper call is the SAME shape on both targets
    // (`__k_decimal_div(a, b)` / `__k_decimal_mod(...)` / `__k_decimal_pow_int(...)`),
    // so the divergent-op divisor/zero/pow guard lives at ONE byte-identical
    // diagnostic site per op. The call form is already self-delimiting (a function
    // call), so no parenthesize wrap is needed on either leg. The empirical
    // differential probe proved non-terminating div (1/3, 10/3, …) and negative-
    // operand mod (-5.5%2, 5.5%-2, …) are byte-IDENTICAL across decimal.js 10.6.0
    // and CPython `decimal` under the pinned prec-28 / ROUND_HALF_EVEN context, so
    // all are SHIPPED (not fail-closed). `requires.py: 'decimal-ops'` registers the
    // Python helper block; the TS preamble renders its twin via `decimalOpsHelpersTS`.
    div: {
      arity: 2,
      ts: '__k_decimal_div($0, $1)',
      py: '__k_decimal_div($0, $1)',
      requires: { ts: 'decimal.js', py: 'decimal-ops' },
    },
    mod: {
      arity: 2,
      ts: '__k_decimal_mod($0, $1)',
      py: '__k_decimal_mod($0, $1)',
      requires: { ts: 'decimal.js', py: 'decimal-ops' },
    },
    // INTEGER-exponent, non-negative-base ONLY — the dispatch site runs
    // `assertPortableDecimalPow` (shared, byte-identical on both legs) which
    // compile-time fail-closes a non-integer / non-literal exponent or a negative
    // base. The helper additionally guards 0**0 (→1) and 0**neg (zero-error).
    pow: {
      arity: 2,
      ts: '__k_decimal_pow_int($0, $1)',
      py: '__k_decimal_pow_int($0, $1)',
      requires: { ts: 'decimal.js', py: 'decimal-ops' },
    },
    // DECIMAL Slice 3 — comparison/ordering. Lower to NATIVE decimal.js comparison
    // methods (TS) and native Python comparison operators (Python). Results are
    // plain `boolean`/`bool` (eq/ne/lt/lte/gt/gte) or plain int -1|0|1 (cmp) — NOT
    // Decimal-typed, so they are NEVER routed through `_kern_decimal_str`. No
    // non-finite Decimal can reach a comparator (div/mod are zero-guarded, pow is
    // integer-only with a guarded 0**neg), so comparison is TOTAL and needs no
    // guard. `-0 ≡ 0` on both legs (empirically verified). Python `Decimal.compare`
    // returns a Decimal, so `cmp` wraps it in `int(...)` to yield a plain int that
    // matches the JS `.cmp()` number. No `requires` — native operators/methods, no
    // import or helper (the operand Decimals already pulled in `decimal.js` via
    // their own `Decimal.of` producer's requirement).
    eq: { arity: 2, ts: '$0.eq($1)', py: '($0 == $1)' },
    ne: { arity: 2, ts: '!$0.eq($1)', py: '($0 != $1)' },
    lt: { arity: 2, ts: '$0.lt($1)', py: '($0 < $1)' },
    lte: { arity: 2, ts: '$0.lte($1)', py: '($0 <= $1)' },
    gt: { arity: 2, ts: '$0.gt($1)', py: '($0 > $1)' },
    gte: { arity: 2, ts: '$0.gte($1)', py: '($0 >= $1)' },
    cmp: { arity: 2, ts: '$0.cmp($1)', py: 'int($0.compare($1))' },
  },
};

export const KERN_STDLIB_MODULES = new Set(Object.keys(KERN_STDLIB));

/** Look up a stdlib lowering by module + method name.
 *  Returns null if the module is unknown OR the method is unknown on a known
 *  module — callers should distinguish via `KERN_STDLIB_MODULES.has(module)`
 *  to surface the right diagnostic. */
export function lookupStdlib(module: string, method: string): StdlibEntry | null {
  const moduleEntries = KERN_STDLIB[module];
  if (!moduleEntries) return null;
  return moduleEntries[method] ?? null;
}

export function lookupStdlibCall(module: string, method: string): StdlibCallEntry | null {
  const entry = lookupStdlib(module, method);
  if (!entry) return null;
  return entry.kind === 'property' ? null : entry;
}

export function lookupStdlibProperty(module: string, property: string): StdlibPropertyEntry | null {
  const entry = lookupStdlib(module, property);
  if (!entry) return null;
  return entry.kind === 'property' ? entry : null;
}

/** Suggest the closest method name on a known module via simple Levenshtein
 *  membership. Used in error messages. Returns null if no close match exists. */
export function suggestStdlibMethod(module: string, method: string): string | null {
  const moduleEntries = KERN_STDLIB[module];
  if (!moduleEntries) return null;
  const candidates = Object.keys(moduleEntries);
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = levenshtein(method, c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return bestDist <= 2 ? best : null;
}

export const suggestStdlibMember = suggestStdlibMethod;

/** GAP 1 — single source of truth for \"is `module.member` a portable lowering?\".
 *  A member is portable iff `module` is a registered KERN stdlib module AND
 *  `member` resolves to either a call entry or a property entry in the table.
 *  The TS-emit path (`applyStdlibLoweringTS`/`applyStdlibPropertyLoweringTS`),
 *  the Python-emit path, and the IR-validation pass all consult THIS predicate
 *  so an unknown member (`Number.foo`) is treated identically — rejected — by
 *  validation and by emission, instead of the validator silently passing what
 *  the emitter later throws on. */
export function isPortableStdlibMember(module: string, member: string): boolean {
  if (!KERN_STDLIB_MODULES.has(module)) return false;
  return lookupStdlib(module, member) !== null;
}

/** Substitute `$0`, `$1`, … placeholders in a template with the corresponding
 *  args. Throws on out-of-range index — that's a programming error in the
 *  KERN_STDLIB table, not user input. */
export function applyTemplate(template: string, args: string[]): string {
  return template.replace(/\$(\d+)/g, (_match, idxStr) => {
    const idx = Number.parseInt(idxStr, 10);
    if (idx < 0 || idx >= args.length) {
      throw new Error(
        `KERN-stdlib template references arg index $${idx} but only ${args.length} args provided. Template: ${template}`,
      );
    }
    return args[idx];
  });
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const cur = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = cur;
    }
  }
  return dp[n];
}
