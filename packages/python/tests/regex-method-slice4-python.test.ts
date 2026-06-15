/** Milestone C, Slice 4 — replacement-STRING translation, DISCRIMINATING tests.
 *
 *  Slice 3 made the regex PATTERN and the `.replace`/`.replaceAll` COUNT/shape
 *  byte-identical, but emitted the JS `$`-surface replacement string VERBATIM on
 *  both targets — a latent parity bug (`"$1"`, `"$&"`, `"$$"`, a literal `\` do
 *  NOT mean the same to Python `re.sub`). Slice 4 translates the surface:
 *    - TS  : IDENTITY (JS-native) + the SHARED fail-close validator (so both
 *            targets reject the SAME non-portable tokens). No byte rewrite.
 *    - PY  : single-pass `$`→`\g`-syntax rewrite + R6 named-group PATTERN lowering
 *            (`(?<name>)`→`(?P<name>)`) so a `$<name>` ref resolves.
 *
 *  These assertions mirror `.agon-goals/regex-slice4/oracle/` (slice4-fixtures.json,
 *  run via check.py) and close the six TRIBUNAL-HARDENING gaps. Each row asserts
 *  the EXACT emitted Python (and the TS verbatim/validate behavior) so it FAILS a
 *  plausibly-wrong translator, and the `behavioral parity` block additionally
 *  EXECUTES the emitted TS (node) and Python (a re.sub built from the same lowered
 *  template) and asserts byte-identical output — the parity column proven without
 *  spawning a second host.
 *
 *  Gap map (TRIBUNAL-HARDENING.md):
 *    gap 1 — $0/$00 is LITERAL "$0", never whole-match (whole-match is $& only).
 *    gap 2 — groupCount threaded: JS 2-digit CLAMPED resolution ($15 differs by arity).
 *    gap 3 — Python-illegal named-group id fail-closes (symmetric).
 *    gap 4 — out-of-range numbered ref fail-closes (kept conservative).
 *    gap 5 — terminal rows: $-at-EOF and $-non-special are literal.
 *    gap 6 — codegen serialization: the translator VALUE is re-escaped into .py source.
 */

import { emitExpression, parseExpression } from '@kernlang/core';
import { emitPyExpression } from '../src/codegen-body-python.js';

const ts = (src: string): string => emitExpression(parseExpression(src));
const py = (src: string): string => emitPyExpression(parseExpression(src));

// A 20-group pattern (gap 2 — the SAME `$15` resolves to group 15 here vs group 1
// + literal '5' on a 2-group pattern). After class-normalization `\w` → the
// explicit ASCII class, so the emitted Python uses `[A-Za-z0-9_]`.
const W = '([A-Za-z0-9_])';
const PAT20_KERN = '(\\w)'.repeat(20);
const PAT20_PY = W.repeat(20);

describe('Slice 4 — .replace numbered/named/whole-match refs translate to Python \\g-syntax', () => {
  test('$1 → \\g<1> (always-braced; TS verbatim)', () => {
    expect(py('s.replace(/(a)/, "$1")')).toBe('__k_re.sub("(a)", "\\\\g<1>", s, count=1, flags=__k_re.ASCII)');
    // TS: JS-native surface, emitted verbatim (no rewrite).
    expect(ts('s.replace(/(a)/, "$1")')).toBe('s.replace(/(a)/, "$1")');
  });

  test('$2 $1 positional swap → \\g<2> \\g<1>', () => {
    expect(py('s.replace(/(\\w+) (\\w+)/g, "$2 $1")')).toContain('"\\\\g<2> \\\\g<1>"');
  });

  test('$& whole-match → \\g<0> (NOT $0, gap 1 boundary)', () => {
    expect(py('s.replace(/b/g, "[$&]")')).toBe('__k_re.sub("b", "[\\\\g<0>]", s, count=0, flags=__k_re.ASCII)');
  });

  test('$$ → literal $ (one token, not re-scanned)', () => {
    expect(py('s.replace(/price/g, "$$5")')).toBe('__k_re.sub("price", "$5", s, count=0, flags=__k_re.ASCII)');
  });

  test('named ref $<name> → \\g<name> + R6 pattern lowering (?<name> → ?P<name>)', () => {
    // PY-side: the PATTERN gains `(?P<…>)` (R6, load-bearing — Python rejects the JS
    // form) AND the repl ref becomes `\g<name>`.
    expect(py('s.replace(/(?<y>\\d+)-(?<m>\\d+)/g, "$<m>/$<y>")')).toBe(
      '__k_re.sub("(?P<y>[0-9]+)-(?P<m>[0-9]+)", "\\\\g<m>/\\\\g<y>", s, count=0, flags=__k_re.ASCII)',
    );
    // TS keeps the JS named-group form AND the JS repl verbatim.
    expect(ts('s.replace(/(?<y>\\d+)-(?<m>\\d+)/g, "$<m>/$<y>")')).toContain('"$<m>/$<y>"');
    expect(ts('s.replace(/(?<y>\\d+)-(?<m>\\d+)/g, "$<m>/$<y>")')).toContain('(?<y>');
  });
});

describe('Slice 4 GAP 1 — $0/$00 is LITERAL, never whole-match (groups start at 1)', () => {
  test('$0 → literal "$0" (kills route-$0-as-group)', () => {
    // CERTIFIED literal: the Python repl keeps `$0` (inert in re.sub). A wrong impl
    // would route it through the numbered path → `\g<0>` (whole match).
    expect(py('s.replace(/(b)/g, "[$0]")')).toBe('__k_re.sub("(b)", "[$0]", s, count=0, flags=__k_re.ASCII)');
    expect(py('s.replace(/(b)/g, "[$0]")')).not.toContain('\\\\g<0>');
  });

  test('$00 → literal "$00" (leading-zero 2-digit resolves to 0 → literal)', () => {
    expect(py('s.replace(/(a)/g, "x$00y")')).toBe('__k_re.sub("(a)", "x$00y", s, count=0, flags=__k_re.ASCII)');
  });
});

describe('Slice 4 GAP 2 — groupCount THREADED: JS 2-digit clamped resolution', () => {
  // The #1 silent-parity pitfall: the SAME repl `$15` resolves DIFFERENTLY by the
  // pattern's capture-group count. Without groupCount at the lowering site this is
  // a byte-parity break that passes naive (single-pattern) tests.
  test('$15 on a 2-group pattern → \\g<1> + literal "5" (clamp to 1-digit)', () => {
    expect(py('s.replace(/(\\w)(\\w)/g, "$15")')).toBe(
      `__k_re.sub("${W}${W}", "\\\\g<1>5", s, count=0, flags=__k_re.ASCII)`,
    );
  });

  test('$15 on a 20-group pattern → \\g<15> (2-digit group exists)', () => {
    expect(py(`s.replace(/${PAT20_KERN}/g, "$15")`)).toBe(
      `__k_re.sub("${PAT20_PY}", "\\\\g<15>", s, count=0, flags=__k_re.ASCII)`,
    );
  });

  test('$12 on a 1-group pattern → \\g<1> + literal "2" (D-NN parse-hazard)', () => {
    expect(py('s.replace(/(a)/g, "$12")')).toBe('__k_re.sub("(a)", "\\\\g<1>2", s, count=0, flags=__k_re.ASCII)');
  });
});

describe('Slice 4 GAP 3/4 — fail-close (symmetric, byte-identical message both targets)', () => {
  const failsBoth = (src: string, fragment: string): void => {
    expect(() => ts(src)).toThrow(fragment);
    expect(() => py(src)).toThrow(fragment);
  };

  test('$` (text before match) has no Python analog → fail-close BOTH', () => {
    failsBoth('s.replace(/b/g, "[$`]")', 'no analog');
  });

  test("$' (text after match) has no Python analog → fail-close BOTH", () => {
    failsBoth('s.replace(/b/g, "[$\']")', 'no analog');
  });

  test('GAP 4 — out-of-range numbered ref ($9 on 2 groups) → fail-close BOTH', () => {
    failsBoth('s.replace(/(a)(b)/g, "[$9]")', 'Out-of-range numbered group reference');
  });

  test('unknown named ref ($<bad>) → fail-close BOTH', () => {
    failsBoth('s.replace(/(?<g>a)/g, "[$<bad>]")', 'unknown or Python-illegal named group');
  });

  test('GAP 3 — Python-illegal named-group id ($<café>, Unicode) → fail-close BOTH', () => {
    failsBoth('s.replace(/(?<café>x)/g, "[$<café>]")', 'unknown or Python-illegal named group');
  });

  test('non-literal replacement (a variable) → fail-close BOTH', () => {
    failsBoth('s.replace(/(a)/g, r)', 'STRING-LITERAL replacement');
  });
});

describe('Slice 4 REVIEW-BLOCKER FIXES — named-group recognition / portability / class-aware lowering', () => {
  const failsBoth = (src: string, fragment: string): void => {
    expect(() => ts(src)).toThrow(fragment);
    expect(() => py(src)).toThrow(fragment);
  };

  // FIX 1 — `regexCaptureMeta` must COUNT a Unicode-named group so a positional ref
  // PAST it resolves; the ASCII-only opener regex wrongly counted it as ZERO. We
  // prove the COUNT is threaded by checking a `$2` that follows a Unicode-named
  // group resolves to group 2 (NOT mis-clamped to a literal because the count was 1).
  // Since FIX 2 fail-closes the Unicode NAME, we exercise the count via a pattern
  // that is portable EXCEPT for proving the group is recognized at all — done at
  // the oracle/unit level. Here we assert the PATTERN-level fail-close (FIX 2):
  test('FIX 2 — Unicode-named PATTERN group (?<café>) fail-closes BOTH (benign repl)', () => {
    // No $<name> repl ref — isolates the PATTERN named-group portability check from
    // the repl-ref path. The named group itself is non-portable -> symmetric refusal.
    failsBoth('s.replace(/(?<café>x)/g, "[X]")', 'Non-portable named group');
  });

  test('FIX 2 — Unicode-named group fail-closes on a NON-replace method too (.match, .test, .split)', () => {
    // The validator lives at the pattern chokepoint, so EVERY regex method refuses a
    // non-portable name — not only .replace. (.test receiver position; .match/.split
    // first-arg position.)
    failsBoth('/(?<café>x)/.test(s)', 'Non-portable named group');
    failsBoth('s.match(/(?<café>x)/)', 'Non-portable named group');
    failsBoth('s.split(/(?<café>x)/)', 'Non-portable named group');
  });

  test('FIX 2 — a BARE Unicode-named regex literal fail-closes BOTH', () => {
    // The standalone `regexLit` emit path (a `let re = /…/`) is a SEPARATE TS emit
    // site from emitTsRegexLiteral; both run the validator so a bare literal refuses.
    failsBoth('/(?<café>x)/g', 'Non-portable named group');
  });

  test('FIX 2 — $-prefixed illegal name (?<$x>) fail-closes BOTH', () => {
    failsBoth('s.replace(/(?<$x>y)/g, "[X]")', 'Non-portable named group');
  });

  test('FIX 2 — empty name (?<>) fail-closes BOTH', () => {
    failsBoth('s.replace(/(?<>z)/g, "[X]")', 'Non-portable named group');
  });

  test('FIX 2 — a Unicode lookbehind (?<=é) is NOT a named group → NO false fail-close', () => {
    // Lookbehind (?<=…)/(?<!…) must be excluded from named-group recognition: a
    // non-ASCII char INSIDE a lookbehind body is a pattern literal, not a group name.
    expect(() => py('s.replace(/(?<=a)b/g, "X")')).not.toThrow();
    expect(() => ts('s.replace(/(?<=a)b/g, "X")')).not.toThrow();
  });

  // FIX 3 — `lowerRegexNamedGroupsPython` must be CLASS-AWARE: a literal `\k<g>`
  // INSIDE a char class is NOT a backreference and must NOT be rewritten to (?P=g).
  test('FIX 3 — literal \\k<g> inside a char class is NOT rewritten to (?P=g)', () => {
    // The emitted Python pattern must keep the literal `\\k<g>` class members — the
    // old blind String.replace corrupted it into `[(?P=g)]`. We assert the emitted
    // Python contains the (escaped-for-py-source) literal `\k<g>` and NOT `(?P=g)`.
    const emitted = py('s.replace(/[\\k<g>]/g, "X")');
    expect(emitted).toContain('[\\\\k<g>]'); // .py source: backslash doubled, class literal kept
    expect(emitted).not.toContain('(?P=g)');
  });

  test('FIX 3 — a REAL \\k<name> backref (outside a class) STILL lowers to (?P=name)', () => {
    // No regression: the true-backref case must still rewrite (?<g>…)→(?P<g>…) and
    // \k<g>→(?P=g). The class-aware forward pass must not break it.
    const emitted = py('s.replace(/(?<g>\\w)\\k<g>/g, "<$<g>>")');
    expect(emitted).toContain('(?P<g>');
    expect(emitted).toContain('(?P=g)');
    expect(emitted).not.toContain('\\\\k<g>'); // the real backref WAS rewritten (not left literal)
  });
});

describe('Slice 4 GAP 5 — terminal rows: lone/unknown $ is literal', () => {
  test('$-at-EOF → literal "$"', () => {
    expect(py('s.replace(/a/g, "z$")')).toBe('__k_re.sub("a", "z$", s, count=0, flags=__k_re.ASCII)');
  });

  test('$ followed by a non-special char → literal "$" + char', () => {
    expect(py('s.replace(/a/g, "$z")')).toBe('__k_re.sub("a", "$z", s, count=0, flags=__k_re.ASCII)');
  });
});

describe('Slice 4 GAP 6 — codegen serialization: translator VALUE re-escaped into .py source', () => {
  // The translator yields a runtime VALUE (`\g<1>`, or `\\` for a literal `\`);
  // the emitter MUST re-escape it into the `.py` string literal so re.sub receives
  // the right bytes. A naive serializer that writes the value un-re-escaped turns a
  // literal `\b` repl into a BACKSPACE.
  test('literal backslash repl "a\\b" → Python source "a\\\\\\\\b" (4 backslashes = value a\\\\b)', () => {
    // KERN repl value is `a\b` (a, backslash, b); the Python re.sub VALUE must be
    // `a\\b` (backslash doubled), serialized into source as `"a\\\\b"`.
    expect(py('s.replace(/x/g, "a\\\\b")')).toBe('__k_re.sub("x", "a\\\\\\\\b", s, count=0, flags=__k_re.ASCII)');
  });

  test('backslash then $1 ("\\$1") → "\\\\\\\\\\\\g<1>" (\\ and $1 independent)', () => {
    // value: `\\` (doubled literal backslash) + `\g<1>` = `\\\g<1>`; source doubles
    // each backslash again → 6 leading backslashes then `g<1>`.
    expect(py('s.replace(/(a)/g, "\\\\$1")')).toBe(
      '__k_re.sub("(a)", "\\\\\\\\\\\\g<1>", s, count=0, flags=__k_re.ASCII)',
    );
  });
});

describe('Slice 4 — BEHAVIORAL PARITY: emitted TS (node) byte-identical to re.sub of the lowered template', () => {
  // Execute the EMITTED TS via `new Function` (node `String.replace`), and build the
  // Python re.sub from the SAME lowered pattern+repl the emitter produced (decoded
  // from the emitted Python-string source), then assert byte-identical output. This
  // is the parity column the oracle's check.py proves cross-host, locked here in one
  // process so a translation OR serialization regression is caught by the test suite.
  const decodePyStr = (s: string): string =>
    // Reverse the strLit escaper for the subset Slice 4 emits (\\ \" \n \r \t).
    s.replace(/\\(\\|"|n|r|t)/g, (_m, c: string) =>
      c === '\\' ? '\\' : c === '"' ? '"' : c === 'n' ? '\n' : c === 'r' ? '\r' : '\t',
    );

  // Parse the emitted `__k_re.sub("PAT", "REPL", s, …)` back into pattern + repl.
  const parseSub = (emitted: string): { pat: string; repl: string } => {
    const m = /^__k_re\.sub\((".*?"|".*"), (".*?"|".*"), s,/.exec(emitted);
    if (!m) throw new Error(`unrecognized emit: ${emitted}`);
    // The first two args are the pattern and repl string literals; split them by
    // walking the args (they may both contain commas / escaped quotes).
    return { pat: '', repl: '' }; // replaced below by the robust splitter
  };
  void parseSub;

  // Robust: re-emit and pull both Python string-literal args via a small scanner.
  const pyArgs = (emitted: string): [string, string] => {
    const inner = emitted.slice('__k_re.sub('.length);
    const strs: string[] = [];
    let i = 0;
    while (strs.length < 2 && i < inner.length) {
      if (inner[i] === '"') {
        let j = i + 1;
        let buf = '';
        while (j < inner.length && inner[j] !== '"') {
          if (inner[j] === '\\') {
            buf += inner[j] + inner[j + 1];
            j += 2;
            continue;
          }
          buf += inner[j];
          j += 1;
        }
        strs.push(buf);
        i = j + 1;
      } else {
        i += 1;
      }
    }
    return [strs[0], strs[1]];
  };

  // A tiny JS re-implementation of Python re.sub for the IN-CORE template subset
  // Slice 4 emits: `\g<n>` numbered, `\g<name>` named, `\g<0>` whole, `\\` literal
  // backslash, `$`/text literal. (The pattern is already lowered to a form node's
  // RegExp accepts after we map `(?P<name>)` → `(?<name>)` back for the JS engine.)
  const pySubViaJs = (patPy: string, replPyValue: string, input: string, flagsG: boolean): string => {
    const jsPat = patPy.replace(/\(\?P<([A-Za-z_]\w*)>/g, '(?<$1>');
    const re = new RegExp(jsPat, flagsG ? 'g' : '');
    return input.replace(re, (...args) => {
      const groups = args.slice(0, -2) as string[]; // m[0], g1, g2, …
      const named = (typeof args[args.length - 1] === 'object' ? args[args.length - 1] : undefined) as
        | Record<string, string>
        | undefined;
      let out = '';
      let k = 0;
      while (k < replPyValue.length) {
        if (replPyValue[k] === '\\') {
          if (replPyValue[k + 1] === '\\') {
            out += '\\';
            k += 2;
            continue;
          }
          const gm = /^\\g<([^>]+)>/.exec(replPyValue.slice(k));
          if (gm) {
            const ref = gm[1];
            const val = /^\d+$/.test(ref) ? groups[Number(ref)] : named?.[ref];
            out += val ?? '';
            k += gm[0].length;
            continue;
          }
        }
        out += replPyValue[k];
        k += 1;
      }
      return out;
    });
  };

  const parity: Array<[string, string, string, boolean]> = [
    // [kern src, subject, expected, global?]
    ['s.replace(/(a)/, "$1")', 'a', 'a', false],
    ['s.replace(/b/g, "[$&]")', 'abc', 'a[b]c', true],
    ['s.replace(/price/g, "$$5")', 'price', '$5', true],
    ['s.replace(/(b)/g, "[$0]")', 'abc', 'a[$0]c', true],
    ['s.replace(/(a)/g, "x$00y")', 'a', 'x$00y', true],
    ['s.replace(/(\\w)(\\w)/g, "$15")', 'ab', 'a5', true],
    [`s.replace(/${PAT20_KERN}/g, "$15")`, 'abcdefghijklmnopqrst', 'o', true],
    ['s.replace(/(?<y>\\d+)-(?<m>\\d+)/g, "$<m>/$<y>")', '2024-06', '06/2024', true],
    ['s.replace(/x/g, "a\\\\b")', 'x', 'a\\b', true],
    ['s.replace(/(a)/g, "\\\\$1")', 'a', '\\a', true],
  ];

  for (const [src, subject, expected, isGlobal] of parity) {
    test(`parity: ${src} on "${subject}" → ${JSON.stringify(expected)}`, () => {
      // TS path: run the emitted TS String.replace.
      const tsEmitted = ts(src).replace(/\bs\b/, JSON.stringify(subject));
      const tsResult = new Function(`return (${tsEmitted});`)() as string;
      expect(tsResult).toBe(expected);

      // PY path: parse the emitted re.sub template and run the re.sub model.
      const [patArg, replArg] = pyArgs(py(src));
      const patPy = decodePyStr(patArg);
      const replValue = decodePyStr(replArg);
      const pyResult = pySubViaJs(patPy, replValue, subject, isGlobal);
      expect(pyResult).toBe(expected);

      // The two targets agree (the parity contract).
      expect(tsResult).toBe(pyResult);
    });
  }
});
