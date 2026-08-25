export type CanonicalKirFacet =
  | 'modules'
  | 'public-api'
  | 'imports'
  | 'dependencies'
  | 'capabilities'
  | 'calls'
  | 'effects'
  | 'structure'
  | 'target-compatibility';

export type CanonicalKirChange =
  | 'added'
  | 'removed'
  | 'changed'
  | 'signature-changed'
  | 'removed-added-or-rename'
  | 'import-source-changed'
  | 'dependency-edge-changed'
  | 'capability-changed'
  | 'call-target-or-argument-shape-changed'
  | 'effect-changed'
  | 'structural-property-changed'
  | 'target-profile-incompatibility'
  | 'target-profile-compatibility-restored';

export interface KernReviewTargetProfile {
  readonly format: 'kern.review.target-profile.1';
  readonly id: string;
  readonly version: number;
  readonly unsupportedCapabilities: readonly string[];
  readonly unsupportedNodeKinds?: readonly string[];
  readonly unsupportedExpressionKinds?: readonly string[];
}

export interface CanonicalKirFinding {
  readonly facet: CanonicalKirFacet;
  readonly moduleId: string;
  readonly key: string;
  readonly change: CanonicalKirChange;
  readonly before?: string;
  readonly after?: string;
  readonly fingerprint: string;
}

export interface CanonicalKirDiagnostic {
  readonly code: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly side?: 'base' | 'head';
  readonly message: string;
}

export interface CanonicalKirProjectionEvidence {
  readonly requestDigest: string;
  readonly artifactDigest: string;
}

export interface CanonicalKirEvidence {
  readonly base: CanonicalKirProjectionEvidence;
  readonly head: CanonicalKirProjectionEvidence;
  readonly target: string;
  readonly targetProfile: KernReviewTargetProfile;
  readonly targetProfileDigest: string;
}

export interface CanonicalKirCompleteResult {
  readonly status: 'complete';
  readonly analysisMode: 'canonical-kir-preview';
  readonly findings: readonly CanonicalKirFinding[];
  readonly diagnostics: readonly CanonicalKirDiagnostic[];
  readonly equalSemantics: boolean;
  readonly evidence: CanonicalKirEvidence;
}

export interface CanonicalKirDegradedResult {
  readonly status: 'degraded';
  readonly analysisMode: 'canonical-kir-preview';
  readonly findings: readonly CanonicalKirFinding[];
  readonly diagnostics: readonly CanonicalKirDiagnostic[];
  readonly equalSemantics: false;
  readonly evidence: CanonicalKirEvidence;
  readonly completeFacets: readonly CanonicalKirFacet[];
}

export interface CanonicalKirFailedResult {
  readonly status: 'failed';
  readonly analysisMode: 'canonical-kir-preview';
  readonly findings: readonly [];
  readonly diagnostics: readonly CanonicalKirDiagnostic[];
  readonly equalSemantics: false;
}

export type CanonicalKirComparisonResult =
  | CanonicalKirCompleteResult
  | CanonicalKirDegradedResult
  | CanonicalKirFailedResult;

export interface CompareCanonicalKirOptions {
  readonly targetProfile?: string | KernReviewTargetProfile;
}

export interface KernReviewModule {
  readonly moduleId: string;
  readonly source: string;
}

export interface KernReviewModuleSet {
  readonly modules: readonly KernReviewModule[];
}

export type KernReviewAnalysisMode = 'legacy-source' | 'canonical-kir-preview' | 'dual-compare';

export interface ReviewKernModuleSetsRequest extends CompareCanonicalKirOptions {
  readonly base: KernReviewModuleSet;
  readonly head: KernReviewModuleSet;
  readonly mode: KernReviewAnalysisMode;
}

export interface CanonicalReviewKernModuleSetsRequest extends CompareCanonicalKirOptions {
  readonly base: KernReviewModuleSet;
  readonly head: KernReviewModuleSet;
  readonly mode: 'canonical-kir-preview';
}

export interface DualReviewKernModuleSetsRequest extends CompareCanonicalKirOptions {
  readonly base: KernReviewModuleSet;
  readonly head: KernReviewModuleSet;
  readonly mode: 'dual-compare';
}

export interface LegacyKernComparisonResult {
  readonly status: 'complete' | 'failed';
  readonly analysisMode: 'legacy-source';
  readonly findings: readonly unknown[];
  readonly diagnostics: readonly CanonicalKirDiagnostic[];
}

export interface DualKernComparisonResult {
  readonly status: 'complete' | 'degraded' | 'failed';
  readonly analysisMode: 'dual-compare';
  readonly canonical: CanonicalKirComparisonResult;
  readonly legacy: LegacyKernComparisonResult;
  readonly divergence: boolean;
}

export type ReviewKernModuleSetsResult =
  | CanonicalKirComparisonResult
  | LegacyKernComparisonResult
  | DualKernComparisonResult;
