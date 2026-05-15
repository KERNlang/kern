/**
 * Differential harness — three-way parity gate.
 *
 *                      IR fixture
 *                          |
 *             +------------+------------+
 *             |            |            |
 *       ReferenceRunner  TS emitter  Python emitter
 *             |            |            |
 *          Trace_R      Trace_TS     Trace_PY
 *             |            |            |
 *             +------------+------------+
 *                          |
 *                   verdict: R == TS == PY ?
 *
 * Phase 1 (PR-1) ships the harness skeleton with two stub legs — `runTsEmitter`
 * and `runPythonEmitter` throw until PR-3 wires them. The reference leg works
 * but has no contracts to dispatch to until PR-2.
 */

import { CONTRACT_REGISTRY, makeEnv, type NodeFixture, type SemanticEnv } from './index.js';
import { referenceRun } from './reference-runner.js';
import { type Trace, tracesEqual } from './trace.js';
import { runTsEmitterLeg } from './ts-leg.js';

export type Verdict =
  | 'pass'
  | 'reference-mismatch'
  | 'ts-divergence'
  | 'python-divergence'
  | 'three-way-divergence'
  | 'leg-error';

export interface DifferentialResult {
  fixture: NodeFixture;
  verdict: Verdict;
  reference?: Trace;
  ts?: Trace;
  python?: Trace;
  /** Populated when verdict is `leg-error` — which leg threw and why. */
  legError?: { leg: 'reference' | 'ts' | 'python'; message: string };
}

export interface DifferentialOptions {
  /**
   * Skip the Python leg. Useful during PR-3 emitter audit when the Python
   * sidecar is not yet wired. Default false in CI, true for local TS-only runs.
   */
  skipPython?: boolean;
  /**
   * Skip the TS leg. Symmetric with skipPython; rarely used.
   */
  skipTs?: boolean;
}

/**
 * Run one fixture through up to three legs and compare against `fixture.expected`.
 *
 * Decision order:
 *   1. If reference != expected → `reference-mismatch` (contract or fixture bug).
 *   2. If TS != reference and Python != reference → `three-way-divergence`.
 *   3. If only TS diverges → `ts-divergence`. Only Python → `python-divergence`.
 *   4. Any leg throws → `leg-error` with the offending leg recorded.
 */
export async function runDifferential(
  fixture: NodeFixture,
  opts: DifferentialOptions = {},
): Promise<DifferentialResult> {
  // Each leg gets a FRESH env. Sharing a single env across legs would let
  // reference-side mutations bleed into the TS/Python legs and produce false
  // divergences (or, worse, false passes when all three legs read the same
  // polluted state). makeEnv() already clones fixture.env.bindings.
  let reference: Trace;
  try {
    reference = referenceRun(fixture.ir, makeEnv(fixture.env));
  } catch (err) {
    return {
      fixture,
      verdict: 'leg-error',
      legError: { leg: 'reference', message: errorMessage(err) },
    };
  }

  if (!tracesEqual(reference, fixture.expected)) {
    return { fixture, verdict: 'reference-mismatch', reference };
  }

  let ts: Trace | undefined;
  if (!opts.skipTs) {
    try {
      ts = await runTsEmitter(fixture, makeEnv(fixture.env));
    } catch (err) {
      return {
        fixture,
        verdict: 'leg-error',
        reference,
        legError: { leg: 'ts', message: errorMessage(err) },
      };
    }
  }

  let python: Trace | undefined;
  if (!opts.skipPython) {
    try {
      python = await runPythonEmitter(fixture, makeEnv(fixture.env));
    } catch (err) {
      return {
        fixture,
        verdict: 'leg-error',
        reference,
        ts,
        legError: { leg: 'python', message: errorMessage(err) },
      };
    }
  }

  const tsOk = !ts || tracesEqual(ts, reference);
  const pyOk = !python || tracesEqual(python, reference);

  if (tsOk && pyOk) return { fixture, verdict: 'pass', reference, ts, python };
  if (!tsOk && !pyOk) {
    return { fixture, verdict: 'three-way-divergence', reference, ts, python };
  }
  return {
    fixture,
    verdict: tsOk ? 'python-divergence' : 'ts-divergence',
    reference,
    ts,
    python,
  };
}

/** Run every fixture from every registered contract. */
export async function runAllContracts(opts: DifferentialOptions = {}): Promise<DifferentialResult[]> {
  const results: DifferentialResult[] = [];
  for (const contract of CONTRACT_REGISTRY.values()) {
    for (const fixture of contract.fixtures) {
      results.push(await runDifferential(fixture, opts));
    }
  }
  return results;
}

/**
 * Run the TS emitter against `fixture.ir`, then execute the emitted code in a
 * sandbox and observe its trace. PR-3a delegates to the dedicated leg module.
 */
function runTsEmitter(fixture: NodeFixture, env: SemanticEnv): Promise<Trace> {
  return runTsEmitterLeg(fixture, env);
}

/**
 * Run the Python emitter against `fixture.ir`, exec the emitted module via
 * the python sidecar, and observe its trace. PR-3b wires this.
 */
function runPythonEmitter(_fixture: NodeFixture, _env: SemanticEnv): Promise<Trace> {
  throw new Error('Python emitter leg not wired yet (PR-3b). Use { skipPython: true } during PR-3a.');
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
