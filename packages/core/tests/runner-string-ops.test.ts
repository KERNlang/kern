/**
 * ReferenceRunner — KERN string ops, milestone 5.1b + KERN 4.5.0 item 3
 * (string parity completion), under the tribunal-locked contract (Option D —
 * Unicode scalar values / code points, decided 2026-07-02): `Text.length`,
 * `Text.charAt(i)`, `Text.slice(a, b)`, `Text.indexOf(needle)`,
 * `Text.startsWith(prefix)`, all CODE-POINT indexed.
 *
 * FULL CONTRACT: the milestone 5.1b BMP-only risk valve (documented in git
 * history — this reference-runner used to fail closed on EVERY non-BMP
 * character, malformed or not, as a deliberate narrowing) is LIFTED here. A
 * WELL-FORMED non-BMP character (an emoji, an astral CJK-extension
 * character, a rare mathematical symbol — a real surrogate PAIR) is now IN
 * SCOPE and computed correctly on every op, exactly matching the tribunal's
 * fixtures ("😀".length==1, "a😀b".indexOf("😀")==1, "𠀀".length==1, …). The
 * ONLY input that still fails closed is a MALFORMED UTF-16 sequence: a lone
 * high surrogate, a lone low surrogate, a reversed pair, or a high-high /
 * low-low run — see `portable-string.ts` / `codegen/text-contract.ts`.
 */

import { makeEnv, ReferenceRunnerError, referenceRunSequence, registerAllContracts } from '../src/index.js';
import { executeKernSource, KernRunnerError } from '../src/runner.js';
import type { IRNode } from '../src/types.js';

beforeAll(() => {
  registerAllContracts();
});

function runStdout(nodes: IRNode[]): string {
  const trace = referenceRunSequence(nodes, makeEnv());
  return trace.events
    .filter((e): e is { op: 'stdout'; text: string } => e.op === 'stdout')
    .map((e) => `${e.text}\n`)
    .join('');
}

function letBind(name: string, value: string): IRNode {
  return { type: 'let', props: { name, value } };
}
function print(expr: string): IRNode {
  return { type: 'print', props: { value: expr } };
}

function mainProgram(bodyLines: string[]): string {
  return ['fn name=main returns=void', '  handler lang="kern"', ...bodyLines.map((line) => `    ${line}`)].join('\n');
}

describe('runner string ops — Text.length (BMP-safe, code points)', () => {
  it('counts ASCII characters', () => {
    expect(runStdout([print('Text.length("café")')])).toBe('4\n');
  });

  it('counts a multi-byte-but-BMP script (日本語) as 3 — the tribunal fixture', () => {
    expect(runStdout([print('Text.length("日本語")')])).toBe('3\n');
  });

  it('counts a combining mark as its own code point (café with a combining accent) — 5', () => {
    // "cafe" + U+0301 COMBINING ACUTE ACCENT: 4 base letters + 1 combining
    // mark = 5 code points (code points, not graphemes — the tribunal fixture).
    expect(runStdout([print('Text.length("cafe\\u0301")')])).toBe('5\n');
  });

  it('counts zero for an empty string', () => {
    expect(runStdout([print('Text.length("")')])).toBe('0\n');
  });

  it('reads a bound (non-literal) string receiver', () => {
    expect(runStdout([letBind('s', '"hello"'), print('Text.length(s)')])).toBe('5\n');
  });
});

describe('runner string ops — Text.charAt (code-point indexed, strict bounds)', () => {
  it('reads the first character', () => {
    expect(runStdout([print('Text.charAt("hello", 0)')])).toBe('h\n');
  });

  it('reads the last in-bounds character', () => {
    expect(runStdout([print('Text.charAt("hello", 4)')])).toBe('o\n');
  });

  it('reads a BMP non-ASCII character by code-point index', () => {
    expect(runStdout([print('Text.charAt("日本語", 1)')])).toBe('本\n');
  });

  it('fails closed on an out-of-bounds index (>= length)', () => {
    expect(() => runStdout([print('Text.charAt("hi", 2)')])).toThrow(ReferenceRunnerError);
  });

  it('fails closed on a negative index (does not inherit JS empty-string behavior)', () => {
    expect(() => runStdout([print('Text.charAt("hi", -1)')])).toThrow(ReferenceRunnerError);
  });
});

describe('runner string ops — Text.slice (code-point indexed, strict bounds)', () => {
  it('slices a middle substring', () => {
    expect(runStdout([print('Text.slice("hello", 1, 3)')])).toBe('el\n');
  });

  it('slices a BMP non-ASCII substring by code-point indices', () => {
    expect(runStdout([print('Text.slice("日本語", 1, 3)')])).toBe('本語\n');
  });

  it('an empty slice (start == end) yields the empty string', () => {
    expect(runStdout([print('Text.slice("hello", 2, 2)')])).toBe('\n');
  });

  it('a full-string slice yields the whole string', () => {
    expect(runStdout([print('Text.slice("hi", 0, 2)')])).toBe('hi\n');
  });

  it('fails closed when end > length (no silent clamping, unlike native slice)', () => {
    expect(() => runStdout([print('Text.slice("hi", 0, 5)')])).toThrow(ReferenceRunnerError);
  });

  it('fails closed when start > end', () => {
    expect(() => runStdout([print('Text.slice("hello", 3, 1)')])).toThrow(ReferenceRunnerError);
  });

  it('fails closed on a negative start (no silent negative-index-from-end, unlike native slice)', () => {
    expect(() => runStdout([print('Text.slice("hello", -1, 3)')])).toThrow(ReferenceRunnerError);
  });
});

describe('runner string ops — Text.indexOf (code-point offset, or -1)', () => {
  it('finds a needle at the start', () => {
    expect(runStdout([print('Text.indexOf("hello", "h")')])).toBe('0\n');
  });

  it('finds a multi-character needle mid-string', () => {
    expect(runStdout([print('Text.indexOf("hello world", "world")')])).toBe('6\n');
  });

  it('returns -1 for a needle that is not present (NOT an error)', () => {
    expect(runStdout([print('Text.indexOf("hello", "z")')])).toBe('-1\n');
  });

  it('finds a BMP non-ASCII needle by code-point offset', () => {
    expect(runStdout([print('Text.indexOf("日本語", "本")')])).toBe('1\n');
  });
});

describe('runner string ops — Text.startsWith', () => {
  it('true for a matching prefix', () => {
    expect(runStdout([print('Text.startsWith("hello", "he")')])).toBe('true\n');
  });

  it('false for a non-matching prefix', () => {
    expect(runStdout([print('Text.startsWith("hello", "wo")')])).toBe('false\n');
  });

  it('true for the empty-string prefix (every string starts with "")', () => {
    expect(runStdout([print('Text.startsWith("hello", "")')])).toBe('true\n');
  });
});

describe('runner string ops — fail-closed set (malformed surrogates, the tribunal set)', () => {
  const abstains = (expr: string) => expect(() => runStdout([print(expr)])).toThrow(ReferenceRunnerError);

  it('a LONE HIGH surrogate ("\\uD800") fails closed on Text.length', () => {
    abstains('Text.length("\\uD800")');
  });

  it('a LONE LOW surrogate ("\\uDC00") fails closed on Text.length', () => {
    abstains('Text.length("\\uDC00")');
  });

  it('a REVERSED PAIR ("\\uDC00\\uD800") fails closed on Text.length', () => {
    abstains('Text.length("\\uDC00\\uD800")');
  });

  it('a HIGH-HIGH pair fails closed on Text.length', () => {
    abstains('Text.length("\\uD800\\uD800")');
  });

  it('a LOW-LOW pair fails closed on Text.length', () => {
    abstains('Text.length("\\uDC00\\uDC00")');
  });

  it('a lone surrogate in the NEEDLE argument fails closed (indexOf)', () => {
    abstains('Text.indexOf("hello", "\\uD800")');
  });

  it('a lone surrogate in the PREFIX argument fails closed (startsWith)', () => {
    abstains('Text.startsWith("hello", "\\uD800")');
  });
});

describe('runner string ops — non-BMP characters are IN SCOPE (KERN 4.5.0 item 3 — risk valve lifted)', () => {
  // The milestone 5.1b narrowing is lifted: a WELL-FORMED non-BMP character
  // (a real surrogate PAIR — emoji, astral CJK-extension, math symbol) is a
  // single Unicode code point on every op, exactly like a BMP character.
  // These are the tribunal's own fixtures, now passing instead of abstaining.

  it('"😀".length is 1 — a surrogate PAIR is ONE code point, not two', () => {
    expect(runStdout([print('Text.length("😀")')])).toBe('1\n');
  });

  it('"𠀀".length is 1 (astral CJK-extension character)', () => {
    expect(runStdout([print('Text.length("𠀀")')])).toBe('1\n');
  });

  // The DISCRIMINATING fixture: UTF-16 `.length` (4: 'a', hi, lo, 'b') diverges
  // from the code-point length (3: 'a', 💩, 'b'). A UTF-16-leaking
  // implementation returns 4 here; the correct code-point contract returns 3.
  it('"a💩b".length is 3, NOT 4 — proves code-point counting, not UTF-16 code-unit counting', () => {
    expect(runStdout([print('Text.length("a💩b")')])).toBe('3\n');
  });

  it('"a😀b".indexOf("😀") is 1 (the tribunal fixture) — code-point offset, not UTF-16 offset', () => {
    expect(runStdout([print('Text.indexOf("a😀b", "😀")')])).toBe('1\n');
  });

  // DISCRIMINATING: "b" sits at UTF-16 code-unit index 3 ('a', hi, lo, 'b') but
  // code-point index 2 ('a', 💩, 'b'). A UTF-16-leaking impl returns 3.
  it('"a💩b".indexOf("b") is 2, NOT 3 — the needle is AFTER the astral character', () => {
    expect(runStdout([print('Text.indexOf("a💩b", "b")')])).toBe('2\n');
  });

  it('"a😀b".charAt(1) is "😀" (the tribunal fixture) — one code-point index returns the whole astral character', () => {
    expect(runStdout([print('Text.charAt("a😀b", 1)')])).toBe('😀\n');
  });

  // DISCRIMINATING: charAt(2) must land on 'b' (the code point AFTER the
  // astral character), not on a lone trailing surrogate half.
  it('"a💩b".charAt(2) is "b" — landing correctly past a surrogate pair', () => {
    expect(runStdout([print('Text.charAt("a💩b", 2)')])).toBe('b\n');
  });

  // DISCRIMINATING: slicing across an astral-character boundary must keep the
  // whole surrogate pair intact, not split it.
  it('"a💩b".slice(1, 2) is "💩" — a slice boundary at an astral character keeps the pair intact', () => {
    expect(runStdout([print('Text.slice("a💩b", 1, 2)')])).toBe('💩\n');
  });

  it('"a💩b".slice(0, 3) is the full string ("a💩b") — code-point length is 3', () => {
    expect(runStdout([print('Text.slice("a💩b", 0, 3)')])).toBe('a💩b\n');
  });

  it('a combining sequence stays multiple code points even alongside an astral character', () => {
    // "cafe" + U+0301 COMBINING ACUTE ACCENT + 💩: 4 + 1 + 1 = 6 code points.
    expect(runStdout([print('Text.length("cafe\\u0301💩")')])).toBe('6\n');
  });

  it('Text.startsWith is true for a well-formed astral prefix', () => {
    expect(runStdout([print('Text.startsWith("💩b", "💩")')])).toBe('true\n');
  });
});

describe('runner string ops — namespace shadowing + arity fences', () => {
  it('respects user shadowing of the `Text` name', () => {
    expect(() => runStdout([letBind('Text', '1'), print('Text.length("x")')])).toThrow(ReferenceRunnerError);
  });

  it('fails closed on wrong arity', () => {
    expect(() => runStdout([print('Text.length("x", "y")')])).toThrow(ReferenceRunnerError);
    expect(() => runStdout([print('Text.charAt("x")')])).toThrow(ReferenceRunnerError);
    expect(() => runStdout([print('Text.slice("x", 0)')])).toThrow(ReferenceRunnerError);
  });

  it('fails closed on a non-string receiver', () => {
    expect(() => runStdout([print('Text.length(1)')])).toThrow(ReferenceRunnerError);
  });
});

describe('runner string ops — executeKernSource + kern run acceptance', () => {
  it('computes length/charAt/slice/indexOf/startsWith through the CLI-facing entry', () => {
    const stdout = executeKernSource(
      mainProgram([
        'let name=s value="\\"hello world\\""',
        'print value="Text.length(s)"',
        'print value="Text.charAt(s, 0)"',
        'print value="Text.slice(s, 6, 11)"',
        'print value="Text.indexOf(s, \\"world\\")"',
        'print value="Text.startsWith(s, \\"hello\\")"',
      ]),
    );
    expect(stdout).toBe('11\nh\nworld\n6\ntrue\n');
  });

  it('computes a well-formed non-BMP string correctly via the CLI-facing entry (KERN 4.5.0 item 3)', () => {
    const stdout = executeKernSource(mainProgram(['print value="Text.length(\\"\\ud83d\\ude00\\")"']));
    expect(stdout).toBe('1\n');
  });

  it('still fails closed on a MALFORMED (lone) surrogate via the CLI-facing entry (exit-mapped KernRunnerError)', () => {
    expect(() => executeKernSource(mainProgram(['print value="Text.length(\\"\\ud800\\")"']))).toThrow(KernRunnerError);
  });
});
