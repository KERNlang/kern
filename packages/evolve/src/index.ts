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

// Concept Gap Adapter
export { detectConceptualGaps, resetConceptGapIds } from './concept-gap-adapter.js';

// Detector Registry
export {
  clearDetectors,
  detectorCount,
  getAllDetectors,
  getDetector,
  getDetectorsForImport,
  getUniversalDetectors,
  loadBuiltinDetectors,
  registerDetector,
  registerDetectors,
  unregisterDetector,
} from './detector-registry.js';
export type { EvolveOptions } from './evolve-runner.js';
// Evolve Runner (main entry points)
export { evolve, evolveSource } from './evolve-runner.js';
// Expressibility Scorer (v3)
export {
  EXPRESSIBILITY_NODE_THRESHOLD,
  isNodeCandidate,
  scoreExpressibility,
} from './expressibility-scorer.js';
// Gap Detector
export { detectGaps, detectGapsFromSource, detectGapsInFiles, resetGapIds } from './gap-detector.js';
// Node Governance (v3)
export { getGovernanceThresholds, governanceGate } from './node-governance.js';
// Node Proposer (v3)
export { deriveNodeName as deriveNodeProposalName, proposeNodes, resetNodeProposalIds } from './node-proposer.js';
// Node Validator (v3)
export { validateNodeProposal } from './node-validator.js';
// Pattern Analyzer
export {
  analyzePatterns,
  analyzeStructuralPatterns,
  computeStructuralHash,
  deriveTemplateName,
} from './pattern-analyzer.js';
// Quality Scorer
export { DEFAULT_THRESHOLDS, passesThresholds, scorePattern } from './quality-scorer.js';
// Staging
export {
  cleanApprovedEvolveV4,
  cleanRejected,
  cleanRejectedEvolveV4,
  formatEvolveV4SplitView,
  formatNodeSplitView,
  formatSplitView,
  getStaged,
  getStagedEvolveV4,
  listStaged,
  listStagedEvolveV4,
  listStagedNodes,
  promoteLocal,
  // v4 evolve staging
  stageEvolveV4Proposal,
  // v3 node staging
  stageNodeProposal,
  stageProposal,
  updateStagedEvolveV4Status,
  updateStagedNodeStatus,
  updateStagedStatus,
} from './staging.js';
// Template Proposer
export { generateKernSource, proposeTemplates } from './template-proposer.js';
// Template Validator
export { validateProposal } from './template-validator.js';
// Types
export type {
  AnalyzedPattern,
  ConceptGapSummary,
  DetectionResult,
  DetectorPack,
  EvolveConfig,
  EvolveResult,
  // v3 types
  ExpressibilityScore,
  ExtractedParam,
  GoldenExample,
  ImportDecl,
  NodeProposal,
  NodeProposalStatus,
  NodeValidationResult,
  PatternGap,
  PatternKind,
  ProposalStatus,
  QualityScore,
  QualityThresholds,
  StagedNodeProposal,
  StagedProposal,
  TemplateProposal,
  ValidationResult,
} from './types.js';

// ── Evolve v4 — Self-Extending IR ───────────────────────────────────────

export { checkDedup } from './evolve-dedup.js';
export type { CollisionInfo, PruneResult } from './evolve-rollback.js';
// Rollback + Prune + Migrate
export {
  detectCollisions,
  findUsages,
  pruneNodes,
  renameEvolvedNode,
  restoreNode,
  rollbackNode,
} from './evolve-rollback.js';
// v4 Validation
export { validateEvolveProposal } from './evolve-validator-v4.js';
export type { RebuildResult } from './evolved-node-loader.js';
// Evolved Node Loader
export {
  clearEvolvedNodes,
  evolvedNodeCount,
  getEvolvedGenerator,
  getEvolvedKeywords,
  getParserHints as getEvolvedParserHints,
  hasEvolvedNodes,
  loadEvolvedNodes,
  readManifest as readEvolvedManifest,
  readNodeDefinition,
  rebuildManifest as rebuildEvolvedManifest,
} from './evolved-node-loader.js';
// v4 Types
export type {
  CodegenHelpers,
  EvolvedManifest,
  EvolvedManifestEntry,
  EvolvedNodeDefinition,
  EvolvedNodeProp,
  EvolvedNodeReason,
  EvolveNodeProposal,
  EvolveV4ProposalStatus,
  EvolveV4ValidationResult,
  ParserHints,
  StagedEvolveProposal,
} from './evolved-types.js';
export { compareGoldenOutput, formatGoldenTestResults, runGoldenTests } from './golden-test-runner.js';
// Graduation
export { compileCodegenToJS, graduateNode, promoteNode } from './graduation.js';
// LLM Discovery
export {
  buildBackfillPrompt,
  buildDiscoveryPrompt,
  buildRetryPrompt,
  collectTsFiles,
  estimateTokens,
  parseDiscoveryResponse,
  parseLLMJsonObject,
  selectRepresentativeFiles,
  validateBackfillResponse,
  validateRetryResponse,
} from './llm-discovery.js';
export type { LLMProvider, LLMProviderOptions } from './llm-provider.js';
export { createLLMProvider, TokenBudget } from './llm-provider.js';
// Sandboxed Generator
export { compileSandboxedGenerator, getCodegenHelpers, loadSandboxedGenerator } from './sandboxed-generator.js';
