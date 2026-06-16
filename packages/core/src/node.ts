/** Slice 0.9 — Node/codegen entrypoint (`@kernlang/core/node`).
 *
 *  The single TypeScript-DEPENDENT entrypoint of `@kernlang/core`. Everything
 *  re-exported here transitively imports `typescript` (~10MB), so it is
 *  deliberately NOT part of the browser-safe `@kernlang/core` barrel
 *  (R1 barrel-isolation). Codegen packages, the CLI, and any caller that needs
 *  to parse/lower block-bodied arrows, classify handler-body eligibility, or
 *  import `.ts` sources imports from this subpath instead of the barrel:
 *
 *    import { typescriptClosureClassifier } from '@kernlang/core/node';
 *
 *  Importing the PARSER subpath never reaches any of these modules, keeping
 *  `typescript` out of the browser spine. (The root barrel retains pinned
 *  deprecated re-exports from here until 5.0 — see index.ts.)
 *
 *  NOTE (r3 review, codex 0.94): `typescript` is an optional peer dependency of
 *  this package. This entrypoint REQUIRES it — importing `@kernlang/core/node`
 *  without `typescript` installed fails at module resolution. That is the
 *  intended contract for the Node/codegen side; browser consumers never load
 *  this module and need no `typescript` install. */

import {
  classifyHandlerBody as classifyHandlerBodyWith,
  type EligibilityResult,
  type FileEligibilityReport,
  scanFileForEligibility as scanFileForEligibilityWith,
} from './native-eligibility.js';
import { classifyHandlerBodyAst } from './native-eligibility-ast.js';

// ── Compound-assignment operator (ts.SyntaxKind based) ─────────────────────
export { supportedCompoundAssignmentOperator } from './assignment-operators-ts.js';
// ── Closure capability seam + TypeScript-backed adapter ────────────────────
export type { ClosureClassifier } from './closure-classifier.js';
export {
  CLOSURE_PARSER_UNAVAILABLE_MESSAGE,
  CLOSURE_PARSER_UNAVAILABLE_REASON,
  unavailableClosureClassifier,
} from './closure-classifier.js';
// v1 closure gate — TypeScript-AST eligibility predicate + free-variable
// collection. Consumed by the migrator eligibility classifier and the Python
// lowerer.
export {
  classifyClosureBlock,
  collectClosureBlockLocalBindingNames,
  collectFreeIdentifierNames,
  parseClosureBlockAst,
} from './closure-eligibility.js';
export type {
  LowerJsClosureBodyToPythonOptions,
  LowerJsClosureBodyToPythonResult,
} from './closure-python-lowering.js';
export { lowerJsClosureBodyToPython } from './closure-python-lowering.js';
// ── TS → .kern importer ────────────────────────────────────────────────────
export type { ImportResult } from './importer.js';
export { escapeKernString, importTypeScript } from './importer.js';
// ── Native KERN handler-body eligibility (TypeScript-AST walker) ───────────
// `nativeEligibilityClassifier` is the classifier to inject into
// `parseDocument`/`parse` (via `ParseOptions.nativeEligibilityClassifier`) so
// the `NATIVE_KERN_ELIGIBLE` advisory hint fires in Node/codegen contexts.
export type { AstEligibilityResult } from './native-eligibility-ast.js';
export {
  canonicalKernExpression,
  canonicalObjectEntriesSource,
  classifyHandlerBodyAst,
  classifyHandlerBodyAst as nativeEligibilityClassifier,
  hasComments,
  hasOnlyMigratableComments,
  hasTsOnlyTemplateEscape,
  isValidKernAssignmentTarget,
  isValidKernAssignmentValue,
  isValidKernExpression,
  isValidKernTypeAnnotation,
} from './native-eligibility-ast.js';
export { typescriptClosureClassifier } from './typescript-closure-classifier.js';

/** Convenience binding of `classifyHandlerBody` to the TypeScript-AST walker —
 *  matches the pre-slice-0.9 call shape `classifyHandlerBody(rawBody, opts)` for
 *  Node callers that don't want to thread the classifier explicitly. */
export function classifyHandlerBody(rawBody: string, opts?: { allowNonBlock?: boolean }): EligibilityResult {
  return classifyHandlerBodyWith(classifyHandlerBodyAst, rawBody, opts);
}

/** Convenience binding of `scanFileForEligibility` to the TypeScript-AST walker. */
export function scanFileForEligibility(content: string): FileEligibilityReport {
  return scanFileForEligibilityWith(classifyHandlerBodyAst, content);
}
