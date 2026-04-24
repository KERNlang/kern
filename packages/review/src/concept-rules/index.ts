/**
 * Concept Rules — universal rules that operate on ConceptMap.
 *
 * These rules work on any language that emits concepts.
 * Language-agnostic by design.
 */

import type { ConceptMap } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
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
): ReviewFinding[] {
  const ctx: ConceptRuleContext = { concepts, filePath, allConcepts, graphImports };
  const findings: ReviewFinding[] = [];
  for (const rule of conceptRules) {
    findings.push(...rule(ctx));
  }
  return suppressOverlappingNewRuleFindings(findings);
}

const NEW_RULE_OWNERS: Record<string, readonly string[]> = {
  'auth-propagation-drift': ['auth-drift'],
  'unhandled-api-error-shape': ['auth-drift', 'contract-drift', 'contract-method-drift'],
  'unbounded-collection-query': ['contract-drift', 'contract-method-drift'],
  'request-validation-drift': ['body-shape-drift', 'contract-drift', 'contract-method-drift'],
};

function suppressOverlappingNewRuleFindings(findings: readonly ReviewFinding[]): ReviewFinding[] {
  const ownerSpans = new Map<string, Set<string>>();
  for (const finding of findings) {
    const spanKey = findingSpanKey(finding);
    for (const owners of Object.values(NEW_RULE_OWNERS)) {
      if (!owners.includes(finding.ruleId)) continue;
      const existing = ownerSpans.get(finding.ruleId) ?? new Set<string>();
      existing.add(spanKey);
      ownerSpans.set(finding.ruleId, existing);
    }
  }

  return findings.filter((finding) => {
    const owners = NEW_RULE_OWNERS[finding.ruleId];
    if (!owners) return true;
    const spanKey = findingSpanKey(finding);
    return !owners.some((owner) => ownerSpans.get(owner)?.has(spanKey));
  });
}

function findingSpanKey(finding: ReviewFinding): string {
  const span = finding.primarySpan;
  return `${span.file}:${span.startLine}:${span.startCol}`;
}
