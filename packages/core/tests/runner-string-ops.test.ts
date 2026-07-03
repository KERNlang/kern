/**
 * ReferenceRunner — KERN string ops, milestone 5.1b, under the tribunal-locked
 * contract (Option D — Unicode scalar values / code points, decided
 * 2026-07-02): `Text.length`, `Text.charAt(i)`, `Text.slice(a, b)`,
 * `Text.indexOf(needle)`, `Text.startsWith(prefix)`, all CODE-POINT indexed.
 *
 * SCOPE (the risk valve, exercised deliberately — see portable-string.ts's
 * module doc and the milestone report): this reference-runner
 * implementation supports the FULL contract for BMP-SAFE strings (no
 * character outside U+0000..U+FFFF, no surrogate-range code unit) and FAILS
 * CLOSED on every other input, including WELL-FORMED non-BMP characters
 * (emoji, rare CJK extension characters). The tribunal's non-BMP fixtures
 * ("😀".length==1, "a😀b".indexOf("😀")==1, "𠀀".length==1, …) are therefore
 * NOT exercised here as passing cases — they are captured below as
 * documented, explicit fail-closed cases instead, per the risk valve's
 * explicit permission to narrow rather than ship something wrong. The
 * fail-closed malformed-surrogate fixtures (lone/reversed surrogates) DO
 * fully match the tribunal's locked fail-closed set, since a superset check
 * (reject ANY surrogate-range code unit) provably covers it.
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

describe('runner string ops — non-BMP characters are OUT OF SCOPE for this slice (risk valve)', () => {
  // These document the DELIBERATE narrowing, not the locked contract's final
  // target — a well-formed surrogate PAIR (a real emoji/CJK-extension
  // character) is indistinguishable, under the superset "reject any
  // surrogate-range code unit" check, from a malformed one. See
  // portable-string.ts's module doc for the full reasoning.
  const abstains = (expr: string) => expect(() => runStdout([print(expr)])).toThrow(ReferenceRunnerError);

  it('"😀".length (the tribunal fixture expects 1) fails closed here, not silently wrong', () => {
    abstains('Text.length("😀")');
  });

  it('"a😀b".indexOf("😀") (the tribunal fixture expects 1) fails closed here', () => {
    abstains('Text.indexOf("a😀b", "😀")');
  });

  it('"a😀b".charAt(1) (the tribunal fixture expects "😀") fails closed here', () => {
    abstains('Text.charAt("a😀b", 1)');
  });

  it('"𠀀".length (the tribunal fixture expects 1) fails closed here', () => {
    abstains('Text.length("𠀀")');
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

  it('fails closed on a non-BMP string via the CLI-facing entry (exit-mapped KernRunnerError)', () => {
    expect(() => executeKernSource(mainProgram(['print value="Text.length(\\"\\ud83d\\ude00\\")"']))).toThrow(
      KernRunnerError,
    );
  });
});
