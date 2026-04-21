/**
 * Concept Rules — universal rules that operate on ConceptMap.
 *
 * These rules work on any language that emits concepts.
 * Language-agnostic by design.
 */

import type { ConceptMap } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import { authDrift } from './auth-drift.js';
import { boundaryMutation } from './boundary-mutation.js';
import { contractDrift } from './contract-drift.js';
import { contractMethodDrift } from './contract-method-drift.js';
import { duplicateRoute } from './duplicate-route.js';
import { ignoredError } from './ignored-error.js';
import { orphanRoute } from './orphan-route.js';
import { taintedAcrossWire } from './tainted-across-wire.js';
import { unguardedEffect } from './unguarded-effect.js';
import { unrecoveredEffect } from './unrecovered-effect.js';
import { untypedApiResponse } from './untyped-api-response.js';

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
  boundaryMutation,
  contractDrift,
  contractMethodDrift,
  duplicateRoute,
  ignoredError,
  orphanRoute,
  taintedAcrossWire,
  unguardedEffect,
  unrecoveredEffect,
  untypedApiResponse,
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
  return findings;
}
