/**
 * Concept Rules — universal rules that operate on ConceptMap.
 *
 * These rules work on any language that emits concepts.
 * Language-agnostic by design.
 */

import type { ConceptMap } from '@kernlang/core';
import type { ReviewFinding } from '../types.js';
import { boundaryMutation } from './boundary-mutation.js';
import { ignoredError } from './ignored-error.js';
import { unguardedEffect } from './unguarded-effect.js';
import { unrecoveredEffect } from './unrecovered-effect.js';

export interface ConceptRuleContext {
  concepts: ConceptMap;
  filePath: string;
}

export type ConceptRule = (ctx: ConceptRuleContext) => ReviewFinding[];

export const conceptRules: ConceptRule[] = [
  boundaryMutation,
  ignoredError,
  unguardedEffect,
  unrecoveredEffect,
];

export function runConceptRules(concepts: ConceptMap, filePath: string): ReviewFinding[] {
  const ctx: ConceptRuleContext = { concepts, filePath };
  const findings: ReviewFinding[] = [];
  for (const rule of conceptRules) {
    findings.push(...rule(ctx));
  }
  return findings;
}
