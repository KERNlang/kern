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
  // v3 types
  ExpressibilityScore,
  NodeProposal,
  NodeValidationResult,
  NodeProposalStatus,
  StagedNodeProposal,
} from './types.js';

// Detector Registry
export {
  registerDetector,
  unregisterDetector,
  getDetector,
  getAllDetectors,
  getDetectorsForImport,
  getUniversalDetectors,
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
export { analyzePatterns, analyzeStructuralPatterns, computeStructuralHash, deriveTemplateName } from './pattern-analyzer.js';

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
  // v3 node staging
  stageNodeProposal,
  listStagedNodes,
  updateStagedNodeStatus,
  formatNodeSplitView,
  // v4 evolve staging
  stageEvolveV4Proposal,
  listStagedEvolveV4,
  getStagedEvolveV4,
  updateStagedEvolveV4Status,
  cleanRejectedEvolveV4,
  cleanApprovedEvolveV4,
  formatEvolveV4SplitView,
} from './staging.js';

// Expressibility Scorer (v3)
export {
  scoreExpressibility,
  isNodeCandidate,
  EXPRESSIBILITY_NODE_THRESHOLD,
} from './expressibility-scorer.js';

// Node Proposer (v3)
export { proposeNodes, deriveNodeName as deriveNodeProposalName, resetNodeProposalIds } from './node-proposer.js';

// Node Governance (v3)
export { governanceGate, getGovernanceThresholds } from './node-governance.js';

// Node Validator (v3)
export { validateNodeProposal } from './node-validator.js';

// Evolve Runner (main entry points)
export { evolve, evolveSource } from './evolve-runner.js';
export type { EvolveOptions } from './evolve-runner.js';

// ── Evolve v4 — Self-Extending IR ───────────────────────────────────────

// v4 Types
export type {
  ParserHints,
  EvolvedNodeDefinition,
  EvolvedNodeProp,
  EvolvedNodeReason,
  EvolvedManifest,
  EvolvedManifestEntry,
  EvolveNodeProposal,
  EvolveV4ValidationResult,
  EvolveV4ProposalStatus,
  StagedEvolveProposal,
  CodegenHelpers,
} from './evolved-types.js';

// Evolved Node Loader
export {
  loadEvolvedNodes,
  clearEvolvedNodes,
  getEvolvedGenerator,
  getParserHints as getEvolvedParserHints,
  hasEvolvedNodes,
  evolvedNodeCount,
  getEvolvedKeywords,
  readManifest as readEvolvedManifest,
  readNodeDefinition,
  rebuildManifest as rebuildEvolvedManifest,
} from './evolved-node-loader.js';
export type { RebuildResult } from './evolved-node-loader.js';

// Sandboxed Generator
export { loadSandboxedGenerator, compileSandboxedGenerator, getCodegenHelpers } from './sandboxed-generator.js';

// v4 Validation
export { validateEvolveProposal } from './evolve-validator-v4.js';
export { checkDedup } from './evolve-dedup.js';
export { compareGoldenOutput, runGoldenTests, formatGoldenTestResults } from './golden-test-runner.js';

// Graduation
export { graduateNode, compileCodegenToJS, promoteNode } from './graduation.js';

// Rollback + Prune + Migrate
export { rollbackNode, restoreNode, findUsages, pruneNodes, detectCollisions, renameEvolvedNode } from './evolve-rollback.js';
export type { PruneResult, CollisionInfo } from './evolve-rollback.js';

// LLM Discovery
export { buildDiscoveryPrompt, parseDiscoveryResponse, selectRepresentativeFiles, collectTsFiles, estimateTokens, buildBackfillPrompt, buildRetryPrompt } from './llm-discovery.js';
export { createLLMProvider, TokenBudget } from './llm-provider.js';
export type { LLMProvider, LLMProviderOptions } from './llm-provider.js';
