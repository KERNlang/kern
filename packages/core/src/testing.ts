/**
 * `@kernlang/core/testing` — the public home of the differential-TEST harness.
 *
 * The 3-leg differential oracle (ReferenceRunner vs. emitted TS vs. emitted
 * Python) runs the emitted TypeScript in-process via `node:vm`, so this entry
 * transitively pulls the ~10MB TS compiler. It is therefore a NODE-ONLY, test-
 * and-tooling surface — kept strictly separate from the spine-clean runtime
 * entry `@kernlang/core/runner`.
 *
 * The paired runtime helpers (`makeEnv`, `CONTRACT_REGISTRY`,
 * `registerAllContracts`) are re-exported here too so a differential test can
 * import its whole toolkit from one place.
 */

export {
  CONTRACT_REGISTRY,
  makeEnv,
  referenceRun,
  referenceRunSequence,
  registerAllContracts,
  registerContract,
} from './ir/semantics/index.js';
export { type DifferentialResult, runAllContracts, runDifferential, type Verdict } from './ir/semantics/testing.js';
