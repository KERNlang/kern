/**
 * Concept Gap Adapter — bridges @kernlang/review concept rules into evolve's PatternGap format.
 *
 * Converts universal concept findings (unguarded-effect, ignored-error, etc.)
 * into PatternGap[] so evolve can report structural issues alongside import-based gaps.
 */

import type { ReviewFinding } from '@kernlang/review';
import { extractTsConcepts, runConceptRules } from '@kernlang/review';
import type { SourceFile } from 'ts-morph';
import type { PatternGap } from './types.js';

let _conceptGapCounter = 0;

function nextConceptGapId(ruleId: string): string {
  return `concept-gap-${ruleId}-${++_conceptGapCounter}`;
}

/** Reset counter for test isolation. */
export function resetConceptGapIds(): void {
  _conceptGapCounter = 0;
}

/**
 * Extract concept-based gaps from a TypeScript source file.
 *
 * Runs the universal concept model (effect, guard, state_mutation, error handling)
 * and converts findings into PatternGap[] with patternKind='structural'.
 */
export function detectConceptualGaps(sourceFile: SourceFile, filePath: string): PatternGap[] {
  const concepts = extractTsConcepts(sourceFile, filePath);
  const findings = runConceptRules(concepts, filePath);
  return findings.map((f) => findingToGap(f, filePath));
}

function findingToGap(finding: ReviewFinding, filePath: string): PatternGap {
  const span = finding.primarySpan;
  return {
    id: nextConceptGapId(finding.ruleId),
    detectorId: `concept-${finding.ruleId}`,
    libraryName: 'structural',
    patternKind: 'structural',
    anchorImport: '',
    startLine: span.startLine,
    endLine: span.endLine,
    snippet: finding.message,
    extractedParams: [],
    confidencePct: finding.confidence != null ? finding.confidence * 100 : 80,
    filePath,
  };
}
