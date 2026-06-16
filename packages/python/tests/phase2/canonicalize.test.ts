/**
 * Phase-2 canonicalizer cross-language self-test (the "atan2 standard" oracle).
 *
 * The typed runtime canonicalizer is the spine of both Phase-2 gates: verdicts
 * are derived from EXECUTED runtime values encoded into one deterministic JSON
 * envelope, never from `JSON.stringify`. This suite proves two things at once:
 *
 *   1. the JS encoder (`scripts/phase2/lib/canonicalize.mjs`) produces the
 *      HAND-WRITTEN expected string for each discriminator row — a wrong encoder
 *      (one that collapses -0/NaN/undefined/null, sorts CALLS, or leaks dict
 *      insertion order) FAILS because the expected strings are not derived from
 *      the encoder itself; and
 *   2. the embedded Python source (`PHASE2_PY_CANON_SRC`) produces the IDENTICAL
 *      string for the same logical value — if TS and Python ever diverge the
 *      harness cannot be trusted, so this is a hard gate precondition.
 *
 * The rows are the table in `.agon-goals/phase2-runner-prelude.md`. Exotic
 * fractional floats are intentionally fail-closed (parity-or-drop) and proven so
 * on both sides.
 */

import { spawnSync } from 'node:child_process';
import { CanonError, canonicalizeRuntime, PHASE2_PY_CANON_SRC } from '../../../../scripts/phase2/lib/canonicalize.mjs';

const pythonAvailable = (() => {
  try {
    return spawnSync('python3', ['--version'], { encoding: 'utf-8' }).status === 0;
  } catch {
    return false;
  }
})();

/** Assemble the fixed runtime envelope around a hand-written value fragment. */
function env(valueJson: string, callsJson = '[]'): string {
  return `{"version":1,"status":"ok","value":${valueJson},"calls":${callsJson}}`;
}

/** Run the Python canonicalizer in isolation with a stand-in sentinel. */
function pyCanon(
  valueExpr: string,
  callsExpr = '[]',
  preamble = '',
): { status: number; stdout: string; stderr: string } {
  const script = `${PHASE2_PY_CANON_SRC}
_KERN_UNDEFINED = object()
${preamble}
__v = ${valueExpr}
print(phase2_canon_json(__v, ${callsExpr}))
`;
  const res = spawnSync('python3', ['-c', script], { encoding: 'utf-8' });
  return { status: res.status ?? 1, stdout: (res.stdout ?? '').trim(), stderr: res.stderr ?? '' };
}

interface Row {
  name: string;
  /** JS runtime value builder. */
  js: () => unknown;
  calls?: string[];
  /** Python expression that builds the equivalent value. */
  pyValue: string;
  pyCalls?: string;
  /** HAND-WRITTEN canon value fragment (the discriminating part of the oracle). */
  valueJson: string;
  /** What a wrong canonicalizer would do to fail this row. */
  kills: string;
}

const ROWS: Row[] = [
  {
    name: 'void 0 / _KERN_UNDEFINED -> undefined',
    js: () => undefined,
    pyValue: '_KERN_UNDEFINED',
    valueJson: '{"kind":"undefined"}',
    kills: 'mapping the sentinel to null/None',
  },
  {
    name: 'null / None -> null',
    js: () => null,
    pyValue: 'None',
    valueJson: '{"kind":"null"}',
    kills: 'mapping null to undefined',
  },
  {
    name: '-0 stays -0',
    js: () => -0,
    pyValue: '-0.0',
    valueJson: '{"kind":"number","value":"-0"}',
    kills: 'collapsing -0 to 0',
  },
  {
    name: '0 stays 0',
    js: () => 0,
    pyValue: '0',
    valueJson: '{"kind":"number","value":"0"}',
    kills: 'treating all zero as negative zero',
  },
  {
    name: 'NaN tagged, not null',
    js: () => NaN,
    pyValue: "float('nan')",
    valueJson: '{"kind":"number","value":"NaN"}',
    kills: 'JSON-stringifying NaN to null',
  },
  {
    name: 'Infinity tagged',
    js: () => Infinity,
    pyValue: "float('inf')",
    valueJson: '{"kind":"number","value":"Infinity"}',
    kills: 'JSON-stringifying Infinity to null',
  },
  {
    name: '-Infinity tagged',
    js: () => -Infinity,
    pyValue: "float('-inf')",
    valueJson: '{"kind":"number","value":"-Infinity"}',
    kills: 'JSON-stringifying -Infinity to null',
  },
  {
    name: '[1, -0, NaN] element-wise typed',
    js: () => [1, -0, NaN],
    pyValue: "[1, -0.0, float('nan')]",
    valueJson:
      '{"kind":"array","items":[{"kind":"number","value":"1"},{"kind":"number","value":"-0"},{"kind":"number","value":"NaN"}]}',
    kills: 'element-wise lossy JSON',
  },
  {
    name: 'python tuple (1,2) == array [1,2]',
    js: () => [1, 2],
    pyValue: '(1, 2)',
    valueJson: '{"kind":"array","items":[{"kind":"number","value":"1"},{"kind":"number","value":"2"}]}',
    kills: 'failing list-vs-tuple normalization',
  },
  {
    name: '{b:2,a:1} entries sorted a,b',
    js: () => ({ b: 2, a: 1 }),
    pyValue: '{"b": 2, "a": 1}',
    valueJson: '{"kind":"object","entries":[["a",{"kind":"number","value":"1"}],["b",{"kind":"number","value":"2"}]]}',
    kills: 'dict insertion-order leak',
  },
  {
    name: '{a:1,b:2} canon == {b:2,a:1} canon',
    js: () => ({ a: 1, b: 2 }),
    pyValue: '{"a": 1, "b": 2}',
    valueJson: '{"kind":"object","entries":[["a",{"kind":"number","value":"1"}],["b",{"kind":"number","value":"2"}]]}',
    kills: 'treating raw object canon as insertion-order-sensitive',
  },
  {
    name: 'Object.keys numeric-order array ["1","2","x"]',
    js: () => Object.keys({ 2: 'two', 1: 'one', x: 'ex' }),
    pyValue: '["1", "2", "x"]',
    valueJson:
      '{"kind":"array","items":[{"kind":"string","value":"1"},{"kind":"string","value":"2"},{"kind":"string","value":"x"}]}',
    kills: 'hiding key-order divergence behind sorted raw object canon',
  },
  {
    name: 'mark("A",1)+mark("B",2) -> 3 calls [A,B]',
    js: () => 3,
    calls: ['A', 'B'],
    pyValue: '3',
    pyCalls: '["A", "B"]',
    valueJson: '{"kind":"number","value":"3"}',
    kills: 'dropping or sorting the call log',
  },
  {
    name: 'mark("A",-0) -> -0 calls [A]',
    js: () => -0,
    calls: ['A'],
    pyValue: '-0.0',
    pyCalls: '["A"]',
    valueJson: '{"kind":"number","value":"-0"}',
    kills: 'value/calls split preserving only one channel',
  },
];

describe('phase2 canonicalizer — JS encoder (atan2 oracle)', () => {
  for (const row of ROWS) {
    test(`${row.name} [kills: ${row.kills}]`, () => {
      const callsJson = JSON.stringify(row.calls ?? []);
      const expected = env(row.valueJson, callsJson);
      expect(canonicalizeRuntime(row.js(), row.calls ?? [])).toBe(expected);
    });
  }
});

describe('phase2 canonicalizer — Python source matches JS byte-for-byte', () => {
  if (!pythonAvailable) {
    test.skip('python3 unavailable — skipping cross-language self-test', () => {});
    return;
  }
  for (const row of ROWS) {
    test(`${row.name}`, () => {
      const callsJson = JSON.stringify(row.calls ?? []);
      const expected = env(row.valueJson, callsJson);
      const py = pyCanon(row.pyValue, row.pyCalls ?? callsJson);
      expect(py.status).toBe(0);
      // Python output must equal both the hand-written oracle AND the JS encoder.
      expect(py.stdout).toBe(expected);
      expect(py.stdout).toBe(canonicalizeRuntime(row.js(), row.calls ?? []));
    });
  }
});

describe('phase2 canonicalizer — exotic floats fail closed (parity-or-drop)', () => {
  const exotic = ['1.5', '0.1', '1e-7'];

  for (const lit of exotic) {
    test(`JS rejects ${lit}`, () => {
      let caught: unknown;
      try {
        canonicalizeRuntime(Number(lit), []);
      } catch (e) {
        caught = e;
      }
      expect(caught instanceof CanonError).toBe(true);
      expect((caught as CanonError).code).toBe('runner:unsupported-float');
    });
  }

  if (pythonAvailable) {
    for (const lit of exotic) {
      test(`Python rejects ${lit}`, () => {
        const py = pyCanon(lit);
        // Non-zero exit + the fail-closed code surfaced on stderr.
        expect(py.status).not.toBe(0);
        expect(py.stderr.includes('runner:unsupported-float')).toBe(true);
      });
    }
  }
});
