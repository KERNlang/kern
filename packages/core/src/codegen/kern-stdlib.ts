/** KERN-stdlib lowering table — slice 2a (Text module).
 *
 *  Per the brainstorm-locked design, KERN handler bodies use module-prefixed
 *  function calls (`Text.upper(s)`) instead of method dispatch (`s.upper()`).
 *  This table maps each KERN-stdlib operation to its per-target lowering so
 *  the SAME KERN source emits idiomatic TS and idiomatic Python.
 *
 *  Slice 2a ships `Text` only: upper, lower, length, trim. Slice 2b extends
 *  to List/Map/Number after the architecture has soaked.
 *
 *  Lowering style: each entry chooses one of three emit shapes per target.
 *    - `method(receiverIdx)` — emit `${args[receiverIdx]}.<name>(${rest})`.
 *      For TS-side method dispatch (`s.toUpperCase()`) and Python where the
 *      idiom matches (`s.upper()` / `s.strip()`).
 *    - `prop(receiverIdx)`   — emit `${args[receiverIdx]}.<name>`.
 *      For property access like TS `s.length`.
 *    - `freeFn(name)`        — emit `${name}(${args.join(', ')})`.
 *      For Python `len(s)` and similar free-function style.
 *
 *  Any new entry must specify both `ts` and `py`. Receiver indices are
 *  zero-based across the KERN call's args.
 *
 *  Diagnostic: when codegen sees a call of the shape
 *  `<KnownModule>.<unknownMethod>(...)`, it throws with a did-you-mean
 *  suggestion based on the keys in this table. Calls into modules NOT in
 *  this table fall through to the default emit path (passthrough — slice 2b
 *  introduces the strict module-allowlist diagnostic). */

export type StdlibLowering =
  | { kind: 'method'; name: string; receiver: number }
  | { kind: 'prop'; name: string; receiver: number }
  | { kind: 'freeFn'; name: string };

export interface StdlibEntry {
  arity: number;
  ts: StdlibLowering;
  py: StdlibLowering;
}

/** Module name → method name → lowering. */
export const KERN_STDLIB: Record<string, Record<string, StdlibEntry>> = {
  Text: {
    upper: {
      arity: 1,
      ts: { kind: 'method', name: 'toUpperCase', receiver: 0 },
      py: { kind: 'method', name: 'upper', receiver: 0 },
    },
    lower: {
      arity: 1,
      ts: { kind: 'method', name: 'toLowerCase', receiver: 0 },
      py: { kind: 'method', name: 'lower', receiver: 0 },
    },
    length: {
      arity: 1,
      ts: { kind: 'prop', name: 'length', receiver: 0 },
      py: { kind: 'freeFn', name: 'len' },
    },
    trim: {
      arity: 1,
      ts: { kind: 'method', name: 'trim', receiver: 0 },
      py: { kind: 'method', name: 'strip', receiver: 0 },
    },
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
