/**
 * Concept Rules — universal rules that operate on ConceptMap.
 *
 * These rules work on any language that emits concepts.
 * Language-agnostic by design.
 */

import type { ConceptMap } from '@kernlang/core';
import { applyRuleSupersession } from '../rule-quality.js';
import type { ReviewConfig, ReviewFinding } from '../types.js';
import { authDrift } from './auth-drift.js';
import { authPropagationDrift } from './auth-propagation-drift.js';
import { bodyShapeDrift } from './body-shape-drift.js';
import { boundaryMutation } from './boundary-mutation.js';
import { contractDrift } from './contract-drift.js';
import { contractMethodDrift } from './contract-method-drift.js';
import { duplicateRoute } from './duplicate-route.js';
import { ignoredError } from './ignored-error.js';
import { missingResponseModel } from './missing-response-model.js';
import { mutationWithoutIdempotency } from './mutation-without-idempotency.js';
import { orphanRoute } from './orphan-route.js';
import { paramNameSwap } from './param-name-swap.js';
import { requestValidationDrift } from './request-validation-drift.js';
import { syncHandlerDoesIo } from './sync-handler-does-io.js';
import { taintedAcrossWire } from './tainted-across-wire.js';
import { unboundedCollectionQuery } from './unbounded-collection-query.js';
import { unguardedEffect } from './unguarded-effect.js';
import { unhandledApiErrorShape } from './unhandled-api-error-shape.js';
import { unrecoveredEffect } from './unrecovered-effect.js';
import { untypedApiResponse } from './untyped-api-response.js';
import { untypedBothEndsResponse } from './untyped-both-ends-response.js';

export interface ConceptRuleContext {
  concepts: ConceptMap;
  filePath: string;
  /** Cross-file concept maps — present when running in graph mode (reviewGraph) */
  allConcepts?: Map<string, ConceptMap>;
  /** Resolved import graph — filePath → imported file paths */
  graphImports?: Map<string, string[]>;
  /** Cross-stack precision mode. Defaults to guard. */
  crossStackMode?: 'guard' | 'audit';
}

export type ConceptRule = (ctx: ConceptRuleContext) => ReviewFinding[];

export const conceptRules: ConceptRule[] = [
  authDrift,
  authPropagationDrift,
  bodyShapeDrift,
  boundaryMutation,
  contractDrift,
  contractMethodDrift,
  duplicateRoute,
  ignoredError,
  missingResponseModel,
  mutationWithoutIdempotency,
  orphanRoute,
  paramNameSwap,
  requestValidationDrift,
  syncHandlerDoesIo,
  taintedAcrossWire,
  unboundedCollectionQuery,
  unguardedEffect,
  unhandledApiErrorShape,
  unrecoveredEffect,
  untypedApiResponse,
  untypedBothEndsResponse,
];

export function runConceptRules(
  concepts: ConceptMap,
  filePath: string,
  allConcepts?: Map<string, ConceptMap>,
  graphImports?: Map<string, string[]>,
  config?: Pick<ReviewConfig, 'crossStackMode'>,
): ReviewFinding[] {
  const ctx: ConceptRuleContext = {
    concepts,
    filePath,
    allConcepts,
    graphImports,
    crossStackMode: config?.crossStackMode,
  };
  const findings: ReviewFinding[] = [];
  for (const rule of conceptRules) {
    findings.push(...rule(ctx));
  }
  return applyRuleSupersession(findings, config);
}
