export { reviewCanonicalKernModuleSets } from './canonical-review.js';
export { compareCanonicalKir } from './compare.js';
export { buildCanonicalKirFactModel } from './facts.js';
export { type LegacyModuleReview, type LegacyModuleReviewer, reviewKernModuleSetsWithLegacy } from './orchestrate.js';
export { DEFAULT_KERN_REVIEW_TARGET_PROFILE } from './profile.js';
export type {
  CanonicalKirChange,
  CanonicalKirComparisonResult,
  CanonicalKirCompleteResult,
  CanonicalKirDegradedResult,
  CanonicalKirDiagnostic,
  CanonicalKirEvidence,
  CanonicalKirFacet,
  CanonicalKirFailedResult,
  CanonicalKirFinding,
  CanonicalReviewKernModuleSetsRequest,
  CompareCanonicalKirOptions,
  DualKernComparisonResult,
  KernReviewAnalysisMode,
  KernReviewModule,
  KernReviewModuleSet,
  KernReviewTargetProfile,
  LegacyKernComparisonResult,
  ReviewKernModuleSetsRequest,
  ReviewKernModuleSetsResult,
} from './types.js';
