/**
 * Types for @kernlang/evolve — self-extending template system.
 *
 * Pipeline: scan → gap-detect → analyze → propose → validate → stage → promote
 */

import type { TemplateSlotType } from '@kernlang/core';
import type { SourceFile } from 'ts-morph';

// ── Pattern Kinds ────────────────────────────────────────────────────────

export type PatternKind =
  | 'form-hook'
  | 'state-management'
  | 'animation'
  | 'data-fetching'
  | 'schema-validation'
  | 'middleware'
  | 'composable'
  | 'testing'
  | 'generic'
  | 'structural';

// ── Detector Pack ────────────────────────────────────────────────────────

export interface ExtractedParam {
  name: string;
  slotType: TemplateSlotType;
  value: string;
  optional: boolean;
}

export interface DetectionResult {
  anchorImport: string;
  startLine: number;
  endLine: number;
  snippet: string;
  extractedParams: ExtractedParam[];
  confidencePct: number;
}

export interface DetectorPack {
  id: string;
  libraryName: string;
  packageNames: string[];
  semverRange?: string;
  patternKind: PatternKind;
  detect: (sourceFile: SourceFile, fullText: string) => DetectionResult[];
}

// ── Pattern Gap ──────────────────────────────────────────────────────────

export interface PatternGap {
  id: string;
  detectorId: string;
  libraryName: string;
  patternKind: PatternKind;
  anchorImport: string;
  startLine: number;
  endLine: number;
  snippet: string;
  extractedParams: ExtractedParam[];
  confidencePct: number;
  filePath: string;
}

// ── Import Declaration ───────────────────────────────────────────────────

export interface ImportDecl {
  from: string;
  names: string[];
}

// ── Golden Example ───────────────────────────────────────────────────────

export interface GoldenExample {
  originalTs: string;
  expectedExpansion: string;
  slotValues: Record<string, string>;
}

// ── Quality Score ────────────────────────────────────────────────────────

export interface QualityScore {
  confidence: number;
  supportCount: number;
  variability: number;
  relevanceScore: number;
  overallScore: number;
}

export interface QualityThresholds {
  minConfidence: number;
  minSupport: number;
  maxVariability: number;
  minRelevance: number;
}

// ── Analyzed Pattern ─────────────────────────────────────────────────────

export interface AnalyzedPattern {
  templateName: string;
  structuralHash: string;
  namespace: string;
  slots: ExtractedParam[];
  instanceCount: number;
  qualityScore: QualityScore;
  representativeSnippet: string;
  goldenExample: GoldenExample;
  imports: ImportDecl[];
  gapIds: string[];
}

// ── Template Proposal ────────────────────────────────────────────────────

export interface TemplateProposal {
  id: string;
  templateName: string;
  namespace: string;
  kernSource: string;
  slots: ExtractedParam[];
  imports: ImportDecl[];
  goldenExample: GoldenExample;
  qualityScore: QualityScore;
  structuralHash: string;
  instanceCount: number;
  representativeSnippet: string;
}

// ── Validation Result ────────────────────────────────────────────────────

export interface ValidationResult {
  parseOk: boolean;
  registerOk: boolean;
  expansionOk: boolean;
  typecheckOk: boolean;
  goldenDiffOk: boolean;
  errors: string[];
  expandedTs?: string;
  goldenDiff?: string;
}

// ── Staging ──────────────────────────────────────────────────────────────

export type ProposalStatus = 'pending' | 'approved' | 'rejected';

export interface StagedProposal {
  id: string;
  proposal: TemplateProposal;
  validation: ValidationResult;
  status: ProposalStatus;
  stagedAt: string;
  reviewedAt?: string;
}

// ── Evolve Config ────────────────────────────────────────────────────────

export interface EvolveConfig {
  thresholds: QualityThresholds;
  stagingDir: string;
  promotedDir: string;
  templatesDir: string;
}

// ── Concept Gap Summary ──────────────────────────────────────────────────

export interface ConceptGapSummary {
  total: number;
  byRule: Record<string, number>;
  formatted: string;
}

// ── Expressibility Score ─────────────────────────────────────────────────

export interface ExpressibilityScore {
  handlerEscapes: number;
  nonStandardAttrs: number;
  semanticLeaks: number;
  overall: number;
}

// ── Node Proposal (v3 — IR self-extension) ──────────────────────────────

export interface NodeProposal {
  id: string;
  nodeName: string;
  kernSyntax: string;
  codegenStub: string;
  targetStubs: Record<string, string>;
  expressibilityScore: ExpressibilityScore;
  frequency: number;
  qualityScore: number;
  supportingGapIds: string[];
}

export interface NodeValidationResult {
  parseOk: boolean;
  codegenOk: boolean;
  targetCoverage: number;
  errors: string[];
}

export type NodeProposalStatus = 'pending' | 'approved' | 'rejected';

export interface StagedNodeProposal {
  id: string;
  proposal: NodeProposal;
  validation: NodeValidationResult;
  status: NodeProposalStatus;
  stagedAt: string;
  reviewedAt?: string;
}

// ── Evolve Result ────────────────────────────────────────────────────────

export interface EvolveResult {
  gaps: PatternGap[];
  analyzed: AnalyzedPattern[];
  proposals: TemplateProposal[];
  validated: Array<{ proposal: TemplateProposal; validation: ValidationResult }>;
  staged: StagedProposal[];
  conceptSummary?: ConceptGapSummary;
  nodeProposals?: NodeProposal[];
  nodeValidated?: Array<{ proposal: NodeProposal; validation: NodeValidationResult }>;
  stagedNodes?: StagedNodeProposal[];
}
