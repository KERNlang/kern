/**
 * Differential-TEST harness barrel — the test-only home of the 3-leg oracle.
 *
 * This module re-exports the differential harness (`runDifferential`,
 * `runAllContracts`, `DifferentialResult`, `Verdict`), which compares the
 * ReferenceRunner against the emitted TS and Python legs. The harness runs the
 * emitted TypeScript IN-PROCESS via `node:vm`, so it transitively imports the
 * ~10MB TS compiler (`harness → ts-leg → body-ts → closure-eligibility →
 * typescript`).
 *
 * It is INTENTIONALLY kept OUT of the runtime barrel (`./index.js`) so the
 * standalone runner entry (`@kernlang/core/runner`) and any browser/embedded
 * consumer never drag in the compiler. Tests and tooling that need the
 * differential oracle import it from here (or from the `@kernlang/core/testing`
 * subpath), never from the runtime path. See
 * `tests/runner-entry-import-graph.test.ts` for the anti-rot gate.
 */

export { type DifferentialResult, runAllContracts, runDifferential, type Verdict } from './harness.js';
