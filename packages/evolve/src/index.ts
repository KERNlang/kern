/**
 * @kernlang/evolve — Self-extending template system for KERN.
 *
 * Scans TypeScript projects, detects patterns KERN can't yet express,
 * proposes new templates, validates them, and stages for human approval.
 *
 * Public API:
 *   evolve(inputPath, options?)      — full pipeline: scan → detect → propose → stage
 *   evolveSource(source, options?)   — single-source analysis
 *   registerDetector(pack)           — register custom detector
 *   loadBuiltinDetectors()           — load all built-in detectors
 */

// Types
export type {
  PatternKind,
  DetectorPack,
  DetectionResult,
  ExtractedParam,
  PatternGap,
  ImportDecl,
  GoldenExample,
  QualityScore,
  QualityThresholds,
  AnalyzedPattern,
  TemplateProposal,
  ValidationResult,
  ProposalStatus,
  StagedProposal,
  EvolveConfig,
  EvolveResult,
  ConceptGapSummary,
} from './types.js';

// Detector Registry
export {
  registerDetector,
  unregisterDetector,
  getDetector,
  getAllDetectors,
  getDetectorsForImport,
  clearDetectors,
  detectorCount,
  loadBuiltinDetectors,
  registerDetectors,
} from './detector-registry.js';

// Gap Detector
export { detectGaps, detectGapsInFiles, detectGapsFromSource, resetGapIds } from './gap-detector.js';

// Concept Gap Adapter
export { detectConceptualGaps, resetConceptGapIds } from './concept-gap-adapter.js';

// Quality Scorer
export { scorePattern, passesThresholds, DEFAULT_THRESHOLDS } from './quality-scorer.js';

// Pattern Analyzer
export { analyzePatterns, computeStructuralHash, deriveTemplateName } from './pattern-analyzer.js';

// Template Proposer
export { proposeTemplates, generateKernSource } from './template-proposer.js';

// Template Validator
export { validateProposal } from './template-validator.js';

// Staging
export {
  stageProposal,
  listStaged,
  getStaged,
  updateStagedStatus,
  promoteLocal,
  cleanRejected,
  formatSplitView,
} from './staging.js';

// Evolve Runner (main entry points)
export { evolve, evolveSource } from './evolve-runner.js';
export type { EvolveOptions } from './evolve-runner.js';
