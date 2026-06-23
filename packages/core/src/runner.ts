/**
 * `@kernlang/core/runner` — the GUARANTEED typescript-free standalone runtime entry.
 *
 * This is the first-class executor surface for "KERN runs on its own": the
 * tree-walking ReferenceRunner plus the lazy expression parser the runner calls
 * at eval time, and nothing else. Its STATIC import closure has `decimal.js` as
 * its ONLY external dependency and ZERO `typescript` — pinned by
 * `tests/runner-entry-import-graph.test.ts` (the anti-rot gate).
 *
 * Why a dedicated entry: importing from the `.` barrel (`@kernlang/core`) loads
 * the whole module graph, which still includes Node-only TS-backed codegen and
 * the differential-test harness, dragging in the ~10MB TS compiler. A browser /
 * edge / embedded consumer imports from HERE instead and pays none of that.
 *
 * Usage:
 *   import { registerAllContracts, referenceRun, makeEnv } from '@kernlang/core/runner';
 *   registerAllContracts();                       // idempotent
 *   const trace = referenceRun(node, makeEnv());  // execute one IR node
 *
 * The differential harness (`runDifferential`, etc.) is INTENTIONALLY absent —
 * it is test-only and lives behind `@kernlang/core/testing`.
 */

export type {
  CanonicalError,
  CompletionKind,
  CompletionRecord,
  NodeContract,
  NodeFixture,
  SemanticEnv,
  Trace,
  TraceEvent,
} from './ir/semantics/index.js';
// ── Runtime execution surface (runner + registry + env) ──────────────────────
export {
  CONTRACT_REGISTRY,
  completionsEqual,
  deepEqual,
  emptyTrace,
  eventsEqual,
  makeEnv,
  ReferenceRunnerError,
  referenceRun,
  referenceRunSequence,
  registerAllContracts,
  registerContract,
  tracesEqual,
} from './ir/semantics/index.js';
export type { ParseExpressionOptions } from './parser-expression.js';
// ── Lazy expression parsing — the runner parses string-valued IR expression
//    props at eval time. `parseExpression` is already typescript-free (it imports
//    only the dependency-free `closure-classifier`), which is what makes this
//    whole entry spine-clean. ──────────────────────────────────────────────────
export { parseExpression } from './parser-expression.js';
export type { IRNode } from './types.js';
// ── Core IR value/node types embedders need to build and read traces. ────────
export type { ValueIR } from './value-ir.js';
