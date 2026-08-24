import {
  type KernProjectionResult,
  projectKernModules,
  type VerifiedKernProjection,
  verifyKernProjection,
} from '@kernlang/core/frontend-projection';
import { deepFreeze } from './canonical.js';
import { compareCanonicalKir } from './compare.js';
import type {
  CanonicalKirComparisonResult,
  CanonicalKirDiagnostic,
  CanonicalReviewKernModuleSetsRequest,
} from './types.js';

function projectionDiagnostics(
  side: 'base' | 'head',
  result: Exclude<KernProjectionResult, { readonly status: 'projected' }>,
): CanonicalKirDiagnostic[] {
  const diagnostics = result.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    side,
    message: `${side} projection ${result.status}: ${diagnostic.code}`,
  }));
  return diagnostics.length > 0
    ? diagnostics
    : [
        {
          code: `KIR_PROJECTION_${result.status.toUpperCase()}`,
          severity: 'error',
          side,
          message: `${side} KERN projection ${result.status}`,
        },
      ];
}

export async function reviewCanonicalKernModuleSets(
  request: CanonicalReviewKernModuleSetsRequest,
): Promise<CanonicalKirComparisonResult> {
  let baseResult: KernProjectionResult;
  let headResult: KernProjectionResult;
  try {
    [baseResult, headResult] = await Promise.all([projectKernModules(request.base), projectKernModules(request.head)]);
  } catch (error) {
    return deepFreeze({
      status: 'failed',
      analysisMode: 'canonical-kir-preview',
      findings: [] as const,
      equalSemantics: false,
      diagnostics: [
        {
          code: 'KIR_PROJECTION_EXCEPTION',
          severity: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    });
  }

  const diagnostics: CanonicalKirDiagnostic[] = [];
  if (baseResult.status !== 'projected') diagnostics.push(...projectionDiagnostics('base', baseResult));
  if (headResult.status !== 'projected') diagnostics.push(...projectionDiagnostics('head', headResult));
  if (diagnostics.length > 0 || baseResult.status !== 'projected' || headResult.status !== 'projected') {
    return deepFreeze({
      status: 'failed',
      analysisMode: 'canonical-kir-preview',
      findings: [] as const,
      diagnostics,
      equalSemantics: false,
    });
  }

  let base: VerifiedKernProjection;
  let head: VerifiedKernProjection;
  try {
    [base, head] = await Promise.all([
      verifyKernProjection(request.base, baseResult),
      verifyKernProjection(request.head, headResult),
    ]);
  } catch (error) {
    return deepFreeze({
      status: 'failed',
      analysisMode: 'canonical-kir-preview',
      findings: [] as const,
      equalSemantics: false,
      diagnostics: [
        {
          code: 'KIR_PROJECTION_VERIFICATION_FAILED',
          severity: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    });
  }
  return compareCanonicalKir(base, head, { targetProfile: request.targetProfile });
}
