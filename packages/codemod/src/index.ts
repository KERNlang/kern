/**
 * @kernlang/codemod — public API.
 *
 * Turn @kernlang/review TemplateMatch results into transformed TS source.
 * Safety gates: reparse + re-detect + affected-set tsc diagnostics (always),
 * whole-program tsc diagnostics (--write only).
 */

// Register built-in adapters via side-effect import so consumers that only
// import the package's public surface still get them.
import './adapters/index.js';

export { getAdapter, listAdapters, registerAdapter } from './adapter-registry.js';
export { applyMatch } from './apply.js';
export { type ApplyFilesResult, applyFiles } from './apply-files.js';
export { defaultAuditPath, writeAuditEntry } from './audit.js';
export {
  runAffectedSetDiagnostics,
  runWholeProgramDiagnostics,
  snapshotAffectedSet,
  snapshotWholeProgram,
} from './diagnostics.js';
export { type FormatResult, formatWithBiome } from './format.js';
export { type LoadProjectOptions, loadHostProject } from './project.js';
export type {
  ApplyDecision,
  ApplyOptions,
  ApplyResult,
  AuditEntry,
  ExtractResult,
  ResolvedRegion,
  ResolveResult,
  TemplateAdapter,
} from './types.js';
