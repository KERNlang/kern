import { canonicalJson, deepFreeze } from './canonical.js';
import { reviewCanonicalKernModuleSets } from './canonical-review.js';
import type {
  CanonicalKirComparisonResult,
  DualKernComparisonResult,
  LegacyKernComparisonResult,
  ReviewKernModuleSetsRequest,
  ReviewKernModuleSetsResult,
} from './types.js';

export interface LegacyModuleReview {
  readonly findings: readonly unknown[];
}

export type LegacyModuleReviewer = (source: string, moduleId: string) => LegacyModuleReview;

function legacyReview(
  request: ReviewKernModuleSetsRequest,
  reviewer: LegacyModuleReviewer,
): LegacyKernComparisonResult {
  try {
    const findings = (['base', 'head'] as const).flatMap((side) =>
      request[side].modules.flatMap((module) =>
        reviewer(module.source, module.moduleId).findings.map((entry) => ({
          side,
          moduleId: module.moduleId,
          finding: entry,
        })),
      ),
    );
    return deepFreeze({ status: 'complete', analysisMode: 'legacy-source', findings, diagnostics: [] });
  } catch (error) {
    return deepFreeze({
      status: 'failed',
      analysisMode: 'legacy-source',
      findings: [],
      diagnostics: [
        {
          code: 'LEGACY_SOURCE_ANALYSIS_FAILED',
          severity: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    });
  }
}

function dualResult(
  canonical: CanonicalKirComparisonResult,
  legacy: LegacyKernComparisonResult,
): DualKernComparisonResult {
  const divergence =
    canonical.status !== legacy.status ||
    canonical.status !== 'complete' ||
    canonicalJson(canonical.findings) !== canonicalJson(legacy.findings);
  const status =
    canonical.status === 'failed'
      ? 'failed'
      : canonical.status === 'degraded' || legacy.status === 'failed'
        ? 'degraded'
        : 'complete';
  return deepFreeze({ status, analysisMode: 'dual-compare', canonical, legacy, divergence });
}

export async function reviewKernModuleSetsWithLegacy(
  request: ReviewKernModuleSetsRequest,
  reviewer: LegacyModuleReviewer,
): Promise<ReviewKernModuleSetsResult> {
  if (!['legacy-source', 'canonical-kir-preview', 'dual-compare'].includes(request.mode)) {
    throw new TypeError(`unknown KERN Review analysis mode: ${String(request.mode)}`);
  }
  if (request.mode === 'legacy-source') return legacyReview(request, reviewer);
  if (request.mode === 'canonical-kir-preview') {
    return reviewCanonicalKernModuleSets({ ...request, mode: 'canonical-kir-preview' });
  }
  const [canonical, legacy] = await Promise.all([
    reviewCanonicalKernModuleSets({ ...request, mode: 'canonical-kir-preview' }),
    Promise.resolve().then(() => legacyReview(request, reviewer)),
  ]);
  return dualResult(canonical, legacy);
}
