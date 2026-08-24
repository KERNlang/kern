import type { VerifiedKernProjection } from '@kernlang/core/frontend-projection';
import { isVerifiedKernProjection } from '@kernlang/core/frontend-projection';
import { deepFreeze, sha256 } from './canonical.js';
import { diffCanonicalKirFacts } from './diff.js';
import { buildCanonicalKirFactModel } from './facts.js';
import type { VerifiedProjectionView } from './model.js';
import { DEFAULT_KERN_REVIEW_TARGET_PROFILE } from './profile.js';
import type { CanonicalKirComparisonResult, CompareCanonicalKirOptions, KernReviewTargetProfile } from './types.js';

function validateStringList(value: unknown, field: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string') || new Set(value).size !== value.length) {
    throw new TypeError(`target profile ${field} must be a unique string array`);
  }
  return [...value];
}

function resolveTargetProfile(input: CompareCanonicalKirOptions['targetProfile']): KernReviewTargetProfile {
  if (input === undefined || input === DEFAULT_KERN_REVIEW_TARGET_PROFILE.id) return DEFAULT_KERN_REVIEW_TARGET_PROFILE;
  if (typeof input === 'string') throw new TypeError(`unknown KIR Review target profile: ${input}`);
  if (
    input === null ||
    typeof input !== 'object' ||
    input.format !== 'kern.review.target-profile.1' ||
    typeof input.id !== 'string' ||
    input.id.length === 0 ||
    !Number.isSafeInteger(input.version) ||
    input.version < 1
  ) {
    throw new TypeError('invalid KIR Review target profile identity');
  }
  const unsupportedCapabilities = validateStringList(input.unsupportedCapabilities, 'unsupportedCapabilities');
  if (!unsupportedCapabilities) throw new TypeError('target profile unsupportedCapabilities is required');
  return deepFreeze({
    format: input.format,
    id: input.id,
    version: input.version,
    unsupportedCapabilities,
    ...(input.unsupportedNodeKinds === undefined
      ? {}
      : {
          unsupportedNodeKinds: validateStringList(
            input.unsupportedNodeKinds,
            'unsupportedNodeKinds',
          ) as readonly string[],
        }),
    ...(input.unsupportedExpressionKinds === undefined
      ? {}
      : {
          unsupportedExpressionKinds: validateStringList(
            input.unsupportedExpressionKinds,
            'unsupportedExpressionKinds',
          ) as readonly string[],
        }),
  });
}

function projectionView(value: VerifiedKernProjection): VerifiedProjectionView {
  return value as unknown as VerifiedProjectionView;
}

export function compareCanonicalKir(
  base: VerifiedKernProjection,
  head: VerifiedKernProjection,
  options: CompareCanonicalKirOptions = {},
): CanonicalKirComparisonResult {
  if (!isVerifiedKernProjection(base) || !isVerifiedKernProjection(head)) {
    throw new TypeError('compareCanonicalKir requires verified KERN projections');
  }
  const profile = resolveTargetProfile(options.targetProfile);
  const baseView = projectionView(base);
  const headView = projectionView(head);
  const baseModel = buildCanonicalKirFactModel(baseView.artifact, profile);
  const headModel = buildCanonicalKirFactModel(headView.artifact, profile);
  const findings = diffCanonicalKirFacts(baseModel, headModel);
  return deepFreeze({
    status: 'complete',
    analysisMode: 'canonical-kir-preview',
    findings,
    diagnostics: [],
    equalSemantics: baseModel.semanticDigest === headModel.semanticDigest,
    evidence: {
      base: {
        requestDigest: baseView.receipt.requestDigest,
        artifactDigest: baseView.receipt.artifactDigest,
      },
      head: {
        requestDigest: headView.receipt.requestDigest,
        artifactDigest: headView.receipt.artifactDigest,
      },
      target: profile.id,
      targetProfile: profile,
      targetProfileDigest: sha256(profile),
    },
  });
}
