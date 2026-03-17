/**
 * Quality Scorer — scores patterns to filter out low-value template candidates.
 *
 * Patterns like `cors()` that are one-liners get low relevance scores.
 * Templates should compress, not wrap.
 */

import type { PatternGap, QualityScore, QualityThresholds } from './types.js';

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  minConfidence: 60,
  minSupport: 1,
  maxVariability: 0.7,
  minRelevance: 0.3,
};

/**
 * Calculate quality score for a group of pattern gaps (same structural pattern).
 */
export function scorePattern(
  gaps: PatternGap[],
  thresholds: QualityThresholds = DEFAULT_THRESHOLDS,
): QualityScore {
  if (gaps.length === 0) {
    return { confidence: 0, supportCount: 0, variability: 0, relevanceScore: 0, overallScore: 0 };
  }

  // Confidence: average across all instances
  const confidence = gaps.reduce((sum, g) => sum + g.confidencePct, 0) / gaps.length;

  // Support count
  const supportCount = gaps.length;

  // Variability: how much the params differ between instances (0 = identical, 1 = all different)
  const variability = calculateVariability(gaps);

  // Relevance: does this pattern actually compress code?
  const relevanceScore = calculateRelevance(gaps);

  // Weighted composite score
  const overallScore = computeOverall(confidence, supportCount, variability, relevanceScore);

  return { confidence, supportCount, variability, relevanceScore, overallScore };
}

/**
 * Check if a quality score passes the configured thresholds.
 */
export function passesThresholds(
  score: QualityScore,
  thresholds: QualityThresholds = DEFAULT_THRESHOLDS,
): boolean {
  return (
    score.confidence >= thresholds.minConfidence &&
    score.supportCount >= thresholds.minSupport &&
    score.variability <= thresholds.maxVariability &&
    score.relevanceScore >= thresholds.minRelevance
  );
}

function calculateVariability(gaps: PatternGap[]): number {
  if (gaps.length <= 1) return 0;

  // Compare the number and names of extracted params across instances
  const paramSets = gaps.map(g =>
    g.extractedParams.map(p => p.name).sort().join(','),
  );

  // Count how many unique param signatures there are
  const uniqueSignatures = new Set(paramSets).size;
  const variability = (uniqueSignatures - 1) / Math.max(gaps.length - 1, 1);

  return Math.min(variability, 1);
}

function calculateRelevance(gaps: PatternGap[]): number {
  // Average snippet length as proxy for code complexity
  const avgSnippetLength = gaps.reduce((sum, g) => sum + g.snippet.length, 0) / gaps.length;
  const avgParams = gaps.reduce((sum, g) => sum + g.extractedParams.length, 0) / gaps.length;

  // Short snippets with few params = low relevance (one-liner wrappers)
  if (avgSnippetLength < 50 && avgParams <= 1) return 0.1;
  if (avgSnippetLength < 100 && avgParams <= 1) return 0.2;

  // Multi-line patterns with params are good template candidates
  const lineBasedScore = Math.min(avgSnippetLength / 300, 1);
  const paramBasedScore = Math.min(avgParams / 3, 1);

  return (lineBasedScore * 0.6 + paramBasedScore * 0.4);
}

function computeOverall(
  confidence: number,
  supportCount: number,
  variability: number,
  relevanceScore: number,
): number {
  // Normalize confidence to 0-1
  const confNorm = confidence / 100;

  // Support bonus (diminishing returns after 5 instances)
  const supportNorm = Math.min(supportCount / 5, 1);

  // Variability penalty (higher variability = worse)
  const varPenalty = 1 - variability;

  // Weighted composite
  const overall =
    confNorm * 0.3 +
    supportNorm * 0.2 +
    varPenalty * 0.2 +
    relevanceScore * 0.3;

  return Math.round(overall * 100);
}
