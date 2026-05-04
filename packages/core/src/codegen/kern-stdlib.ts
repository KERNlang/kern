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

export interface StdlibEntry {
  arity: number;
  ts: string;
  py: string;
  /** Slice 3b — per-target imports required when this lowering is used.
   *  The body emitter collects these into a per-handler import set so the
   *  generator can emit `import math` (etc.) at the top of the function
   *  body. Keys are target names ('ts' / 'py'); values are the import
   *  identifier (`'math'` ⇒ `import math`). Undefined when none required. */
  requires?: { ts?: string; py?: string };
}

export const KERN_STDLIB: Record<string, Record<string, StdlibEntry>> = {
  Text: {
    upper: { arity: 1, ts: '$0.toUpperCase()', py: '$0.upper()' },
    lower: { arity: 1, ts: '$0.toLowerCase()', py: '$0.lower()' },
    length: { arity: 1, ts: '$0.length', py: 'len($0)' },
    trim: { arity: 1, ts: '$0.trim()', py: '$0.strip()' },
    includes: { arity: 2, ts: '$0.includes($1)', py: '$1 in $0' },
    startsWith: { arity: 2, ts: '$0.startsWith($1)', py: '$0.startswith($1)' },
    endsWith: { arity: 2, ts: '$0.endsWith($1)', py: '$0.endswith($1)' },
    split: { arity: 2, ts: '$0.split($1)', py: '$0.split($1)' },
    // Slice-2 review fix: replace-all is the canonical KERN semantics. JS
    // `replace` only swaps the first match; KERN normalizes to TS
    // `replaceAll` (ES2021+) and Python `replace` (default replace-all).
    replace: { arity: 3, ts: '$0.replaceAll($1, $2)', py: '$0.replace($1, $2)' },
  },
  List: {
    length: { arity: 1, ts: '$0.length', py: 'len($0)' },
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
  },
  Map: {
    has: { arity: 2, ts: '$0.has($1)', py: '$1 in $0' },
    // Slice-2 review fix: TS `Map.get(k)` returns `undefined` for missing
    // keys. Python `dict[k]` raises KeyError. Use `.get($1)` (Python dicts'
    // safe-access, returns None) for parity.
    get: { arity: 2, ts: '$0.get($1)', py: '$0.get($1)' },
    size: { arity: 1, ts: '$0.size', py: 'len($0)' },
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
    round: { arity: 1, ts: 'Math.round($0)', py: '__k_math.floor($0 + 0.5)', requires: { py: 'math' } },
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
