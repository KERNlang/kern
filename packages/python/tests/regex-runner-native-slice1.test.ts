/** REGEX Slice 1 — RUNNER-NATIVE differential oracle (THREE legs).
 *
 *  KERN's ReferenceRunner is the neutral THIRD leg of regex parity: it must
 *  EXECUTE a `regexLit.test(str)` expression natively and produce a boolean that
 *  is byte-identical to BOTH emitted legs —
 *    - TypeScript : `new RegExp(<normalized pattern>, flags).test(s)`
 *    - Python     : `(__k_re.search(<normalized pattern>, s, <flags>) is not None)`
 *
 *  SLICE-1 SCOPE (deliberately minimal, mirrors the decimal slice-1 boundary):
 *    - PRODUCER : a regex LITERAL `/pat/flags`.
 *    - CONSUMER : `regex.test(strArg)` -> native portable boolean. TERMINAL — the
 *      gate admits ONLY the whole `regexLit.test(arg)` expression. A free-standing
 *      `regexLit` is NOT admitted, so it falls through to portable eval and
 *      ABSTAINS (decimal's "abstain on downstream read" property, by OMISSION —
 *      no tagged `RegExpValue` is bound in slice 1).
 *
 *  PARITY BY CONSTRUCTION: the runner reuses the SAME emit-side pipeline the TS
 *  leg uses — `normalizeRegexClasses` -> `expandRegexIFold` -> `new RegExp(...)`
 *  — and mirrors the emitters' flag contract (`pyRegexFlags`): CERTIFIED flags are
 *  exactly `i`/`m`/`s` (+ flagless); everything else is out of slice. It does NOT
 *  re-derive regex lore. The only checks the runner adds (because it EXECUTES
 *  rather than emits) are the non-string-arg guard (JS coerces, Python raises) and
 *  the bare-unescaped-`.`-without-`/s` abstain (a verified JS<->Python `\r`
 *  divergence the emitters cannot see at compile time).
 *
 *  OUTCOME CLASSES (mirror decimal exactly):
 *    1. CERTIFIED   -> execute natively; ref bool === ts bool === py bool.
 *    2. HARD FAIL   -> `/g` on `.test` is a SHARED compile fail-close on BOTH
 *                      emitted legs (`REGEX_TEST_G_FAILCLOSE`); the runner
 *                      RE-ADMITS it (throws the same message), proving it KNOWS
 *                      `/g` is a hard fail-close, not merely unsupported.
 *    3. ABSTAIN     -> any input outside the certified subset (uncertified flag
 *                      `/u` `/y` `/v` …, bare unescaped `.` without `/s`, a
 *                      non-string argument, a shadowed `RegExp`) routes to
 *                      portable eval and produces NO native value — never a
 *                      divergent one.
 *
 *  Every expected boolean below was verified empirically on BOTH host engines
 *  (node + python3) against the exact normalized pattern each leg produces.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emitExpressionWithImports,
  makeEnv,
  parseExpression,
  REGEX_TEST_G_FAILCLOSE,
  ReferenceRunnerError,
  referenceRun,
  registerExpressionV1Contract,
} from '@kernlang/core';
import { emitPyExpressionWithImports } from '../src/codegen-body-python.js';

// The runner leg goes through the PRODUCTION path: an `expression-v1` IR node
// binding the regex test to `r`, dispatched via `referenceRun` -> the registered
// contract -> (structural precondition admit) -> effects -> native regex eval. So
// this exercises EXACTLY the dispatch a real KERN body-statement binding takes.
registerExpressionV1Contract(); // idempotent — safe at module load.

/** Drive a KERN expression through the runner and return the BOUND value
 *  (a boolean for a certified `.test`). Throws if the runner did not produce a
 *  boolean assign for `r` — i.e. it ABSTAINED (precondition false) or fail-closed.
 *  An abstain or fail-close therefore surfaces as a throw, which the
 *  abstain/fail-close suites assert on directly. */
function runRefBool(src: string): boolean {
  const node = { type: 'expression-v1', props: { name: 'r', expr: src } };
  const trace = referenceRun(node, makeEnv());
  const assign = trace.events.find(
    (e): e is Extract<typeof e, { op: 'assign' }> => e.op === 'assign' && e.target === 'r',
  );
  if (!assign || typeof assign.value !== 'boolean') {
    throw new Error(`runRefBool: expected a boolean assign for "r", got ${JSON.stringify(trace.events)}`);
  }
  return assign.value;
}

// ── runtime gate: the 3-leg differential needs node + python3 ─────────────────
const haveExecRuntimes = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const execDescribe = haveExecRuntimes ? describe : describe.skip;

// ════════════════════════════════════════════════════════════════════════════
// 1. CERTIFIED — ref bool === ts bool === py bool (byte-identical on three legs).
// ════════════════════════════════════════════════════════════════════════════
execDescribe('Regex Slice 1 — RUNNER-NATIVE differential (ref === ts === py)', () => {
  // [KERN source, expected boolean on ALL THREE legs]. `\\d` in a TS string is
  // the two-char KERN source `\d`; `\\n` is the KERN escape `\n` (a newline).
  const cases: Array<[string, boolean]> = [
    // search-anywhere == re.search(...) is not None — NOT anchored.
    ['/bc/.test("abcd")', true],
    ['/qq/.test("abcd")', false],
    // `\d` is ASCII-normalized to [0-9] on BOTH legs (no Unicode digit).
    ['/\\d/.test("5")', true],
    ['/\\d/.test("x")', false],
    // Arabic-Indic digit U+0665 — the ASCII normalization KILLER (raw JS `\d` is
    // ASCII so false, but a Python leg WITHOUT the [0-9] rewrite + re.ASCII -> true).
    ['/\\d/.test("٥")', false],
    // `\s` is NARROWED to an ASCII set by normalizeRegexClasses (it DROPS NBSP) —
    // the load-bearing KILLER that forces the RUNNER to REUSE the normalizer, not
    // pass the raw pattern to a JS RegExp: raw JS `\s` MATCHES NBSP (U+00A0) -> true,
    // but the normalized `[ \t\n\r\f\v]` -> false. Without this row a lazy
    // `new RegExp(rawPattern)` runner passes the whole oracle yet diverges here.
    ['/\\s/.test("\\u00A0")', false],
    ['/\\s/.test(" ")', true],
    // ASCII `\w` rejects an accented letter on all three legs.
    ['/\\w/.test("é")', false],
    // Anchors without /m: JS `$` does NOT match before a trailing `\n`; the Python
    // leg lowers `^`->\A / `$`->\Z to pin the same absolute-end semantics.
    ['/^x$/.test("x\\n")', false],
    // /m certified — `^`/`$` are per-line on JS /m == Python re.MULTILINE.
    ['/^x$/m.test("x\\ny")', true],
    // /s certified — `.` matches newline on JS /s == Python re.DOTALL.
    ['/a.b/s.test("a\\nb")', true],
    // /i certified — case-fold expanded to an explicit class by expandRegexIFold;
    // `k` matches `K`. Kills a runner that drops /i AND skips fold expansion.
    ['/k/i.test("K")', true],
    // Transparent-wrapper receiver (`as T`) is peeled to the regexLit — the bypass
    // class that bit decimal 3x. Must still route native.
    ['(/foo/ as any).test("xfoo")', true],
  ];

  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'kern-regex-slice1-runner-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function runTsBool(src: string): boolean {
    const r = emitExpressionWithImports(parseExpression(src));
    const imports = [...r.imports].map((m) => `import * as __k_${m} from '${m}';`).join('\n');
    const file = join(dir, 'run.mjs');
    writeFileSync(file, `${imports}\nconsole.log(String(${r.code}));\n`);
    const out = execFileSync('node', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
    return out === 'true';
  }

  function runPyBool(src: string): boolean {
    const r = emitPyExpressionWithImports(parseExpression(src));
    const imports = [...r.imports].map((m) => `import ${m} as __k_${m}`).join('\n');
    const helpers = [...r.helpers].join('\n\n');
    const file = join(dir, 'run.py');
    writeFileSync(file, [imports, helpers, `print(${r.code})`].join('\n'));
    const out = execFileSync('python3', [file], { encoding: 'utf8', timeout: 10_000 }).trim();
    return out === 'True';
  }

  for (const [src, expected] of cases) {
    test(`${src} -> ${expected} on ALL THREE legs`, () => {
      expect(runRefBool(src)).toBe(expected);
      expect(runTsBool(src)).toBe(expected);
      expect(runPyBool(src)).toBe(expected);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 2. RUNNER-ONLY discriminating killers (no exec runtimes needed) — each kills a
//    specific plausibly-wrong impl, not merely "unimplemented".
// ════════════════════════════════════════════════════════════════════════════
describe('Regex Slice 1 — discriminating killers (runner)', () => {
  test('`\\d` is ASCII-normalized — Arabic-Indic digit is rejected', () => {
    expect(runRefBool('/\\d/.test("٥")')).toBe(false);
    expect(runRefBool('/\\d/.test("7")')).toBe(true);
  });
  test('`\\s` is ASCII-narrowed — NBSP (U+00A0) is rejected (forces normalizer reuse)', () => {
    // The decisive normalizer-reuse killer: a runner that builds `new RegExp(rawPattern)`
    // matches NBSP (JS `\s` is Unicode) and diverges from BOTH emitted legs.
    expect(runRefBool('/\\s/.test("\\u00A0")')).toBe(false);
    expect(runRefBool('/\\s/.test(" ")')).toBe(true);
  });
  test('search-anywhere, NOT fullmatch/anchored', () => {
    expect(runRefBool('/bc/.test("abcd")')).toBe(true);
  });
  test('anchors without /m pin absolute end (no match before trailing newline)', () => {
    expect(runRefBool('/^x$/.test("x\\n")')).toBe(false);
  });
  test('/i case-fold is applied — `k` matches `K`', () => {
    expect(runRefBool('/k/i.test("K")')).toBe(true);
  });
  test('transparent-wrapper receiver (`as T` / `!`) is peeled to the regexLit', () => {
    expect(runRefBool('(/foo/ as any).test("xfoo")')).toBe(true);
    expect(runRefBool('(/bar/!).test("xbar")')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. HARD FAIL-CLOSE — `/g` on `.test` is a SHARED compile fail-close on BOTH
//    emitted legs; the runner RE-ADMITS the exact shared message.
// ════════════════════════════════════════════════════════════════════════════
describe('Regex Slice 1 — /g on .test re-admits the shared fail-close', () => {
  test('runner throws REGEX_TEST_G_FAILCLOSE (not a silent abstain)', () => {
    expect(() => runRefBool('/x/g.test("xx")')).toThrow(REGEX_TEST_G_FAILCLOSE);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. ABSTAIN guards — out of the certified subset, the runner DECLINES to route
//    native (no divergent value). These are GREEN at base (everything abstains
//    pre-build) and MUST stay green: they pin that the build does not OVER-admit.
// ════════════════════════════════════════════════════════════════════════════
describe('Regex Slice 1 — abstains (no native route) on uncertified inputs', () => {
  test('bare unescaped `.` without /s (verified JS<->Python `\\r` divergence)', () => {
    expect(() => runRefBool('/a.b/.test("axb")')).toThrow();
  });
  test('/u flag is uncertified (pyRegexFlags does not lower it)', () => {
    expect(() => runRefBool('/k/u.test("K")')).toThrow();
  });
  test('/y sticky flag is uncertified', () => {
    expect(() => runRefBool('/x/y.test("x")')).toThrow();
  });
  test('non-string argument (JS coerces, Python raises — fail closed)', () => {
    expect(() => runRefBool('/1/.test(1 as any)')).toThrow();
  });
  // Review D — a `/i` Set-B fold (ß→SS, length-changing) FAILS CLOSE in
  // expandRegexIFold on BOTH emitted legs (verified: {failClose,reason:'setB'}).
  // The runner ABSTAINS (it does not re-admit the PARAMETERIZED fold message —
  // it lets the emit legs surface the canonical one), pinning that decision so a
  // future flip to "re-admit" is caught.
  test('/i Set-B fold (ß) abstains — runner declines the shared compile fail-close', () => {
    expect(() => runRefBool('/ß/i.test("ss")')).toThrow();
  });
  // Review A — the KERN parser accepts DUPLICATE flags (`/x/ii`); the runner
  // abstains structurally (uniqueness guard) rather than let `new RegExp(.,'ii')`
  // throw a SyntaxError at eval.
  test('duplicate flags (/x/ii) abstain — uniqueness guard, not a constructor throw', () => {
    expect(() => runRefBool('/x/ii.test("x")')).toThrow();
  });
  // An astral (non-BMP) construct fails close on both emitted legs; the runner
  // abstains (gate rejects via scanRegexAstral on the post-fold pattern).
  test('astral (non-BMP) pattern abstains', () => {
    expect(() => runRefBool('/𝕏/.test("x")')).toThrow();
  });
  test('shadowed `RegExp` binding falls through to portable eval', () => {
    const node = { type: 'expression-v1', props: { name: 'r', expr: '/a/.test("a")' } };
    const env = makeEnv();
    env.bindings.set('RegExp', 'shadowed');
    expect(() => referenceRun(node, env)).toThrow(ReferenceRunnerError);
  });
});
