import { reviewKernSource } from '../index.js';
import { reviewKernModuleSetsWithLegacy } from './orchestrate.js';
import type { DualKernComparisonResult, DualReviewKernModuleSetsRequest } from './types.js';

export async function reviewKernModuleSets(
  request: DualReviewKernModuleSetsRequest,
): Promise<DualKernComparisonResult> {
  if (request.mode !== 'dual-compare') throw new TypeError(`dual KERN Review requires dual-compare mode`);
  const result = await reviewKernModuleSetsWithLegacy(request, (source, moduleId) =>
    reviewKernSource(source, moduleId),
  );
  if (result.analysisMode !== 'dual-compare') throw new TypeError('dual KERN Review returned a non-dual result');
  return result;
}

export type {
  CanonicalKirComparisonResult,
  DualKernComparisonResult,
  DualReviewKernModuleSetsRequest,
  KernReviewModule,
  KernReviewModuleSet,
  LegacyKernComparisonResult,
} from './types.js';
