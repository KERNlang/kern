/**
 * Pattern Analyzer — Phase 2 of the evolve pipeline.
 *
 * Groups gaps by structural hash, deduplicates, scores, and selects
 * representative examples for template generation.
 */

import { createHash } from 'crypto';
import type { PatternGap, AnalyzedPattern, ExtractedParam, ImportDecl, GoldenExample, QualityThresholds } from './types.js';
import { scorePattern, passesThresholds, DEFAULT_THRESHOLDS } from './quality-scorer.js';

/**
 * Compute a structural hash for a pattern gap.
 *
 * Variables are replaced with placeholders so structurally equivalent
 * patterns (same shape, different values) get the same hash.
 */
export function computeStructuralHash(gap: PatternGap): string {
  // Normalize: replace variable values with slot types
  const paramSignature = gap.extractedParams
    .map(p => `${p.name}:${p.slotType}`)
    .sort()
    .join('|');

  // The hash key: detector + pattern structure (not values)
  const normalized = `${gap.detectorId}::${paramSignature}`;
  return createHash('sha256').update(normalized).digest('hex').substring(0, 12);
}

/**
 * Derive a human-readable template name from a gap.
 *
 * Uses the detector ID and key identifiers, not auto-generated garbage.
 */
export function deriveTemplateName(gap: PatternGap): string {
  // Start with detector ID which is already descriptive
  const base = gap.detectorId;

  // Look for a key identifier param (the main "name" param)
  const nameParam = gap.extractedParams.find(p =>
    p.slotType === 'identifier' && !p.optional,
  );

  // If there's a clear naming pattern, use it
  if (nameParam) {
    // e.g., react-hook-form + useForm → rhf-useform
    const abbrev = abbreviateLibrary(gap.libraryName);
    const paramHint = nameParam.name.replace(/Name$/, '');
    return `${abbrev}-${paramHint}`.toLowerCase();
  }

  return base;
}

function abbreviateLibrary(name: string): string {
  // Common abbreviations
  const abbrevs: Record<string, string> = {
    'React Hook Form': 'rhf',
    'Formik': 'formik',
    'Recoil': 'recoil',
    'Redux Toolkit': 'rtk',
    'Framer Motion': 'motion',
    'Axios': 'axios',
    'Ky': 'ky',
    'Yup': 'yup',
    'Valibot': 'valibot',
    'Express Middleware': 'express-mw',
    'VueUse': 'vueuse',
    'Testing Library': 'rtl',
  };
  return abbrevs[name] || name.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Extract import declarations from a gap's anchor import and library.
 */
function extractImports(gap: PatternGap): ImportDecl[] {
  // The anchor import tells us what to import
  return [{
    from: gap.anchorImport.includes('/') ? gap.anchorImport : guessImportSource(gap),
    names: [gap.anchorImport],
  }];
}

function guessImportSource(gap: PatternGap): string {
  // Map library names to package names
  const packageMap: Record<string, string> = {
    'React Hook Form': 'react-hook-form',
    'Formik': 'formik',
    'Recoil': 'recoil',
    'Redux Toolkit': '@reduxjs/toolkit',
    'Framer Motion': 'framer-motion',
    'Axios': 'axios',
    'Ky': 'ky',
    'Yup': 'yup',
    'Valibot': 'valibot',
    'VueUse': '@vueuse/core',
    'Testing Library': '@testing-library/react',
  };
  return packageMap[gap.libraryName] || gap.libraryName.toLowerCase();
}

/**
 * Build a golden example from the representative gap.
 */
function buildGoldenExample(gap: PatternGap): GoldenExample {
  const slotValues: Record<string, string> = {};
  for (const param of gap.extractedParams) {
    slotValues[param.name] = param.value;
  }

  return {
    originalTs: gap.snippet,
    expectedExpansion: gap.snippet, // Will be refined during template proposal phase
    slotValues,
  };
}

/**
 * Merge extracted params from multiple gaps into a union set.
 * Params that appear in all instances stay required; others become optional.
 */
function mergeParams(gaps: PatternGap[]): ExtractedParam[] {
  if (gaps.length === 0) return [];
  if (gaps.length === 1) return [...gaps[0].extractedParams];

  // Count how many gaps have each param
  const paramCounts = new Map<string, number>();
  const paramMap = new Map<string, ExtractedParam>();

  for (const gap of gaps) {
    for (const param of gap.extractedParams) {
      paramCounts.set(param.name, (paramCounts.get(param.name) || 0) + 1);
      if (!paramMap.has(param.name)) {
        paramMap.set(param.name, { ...param });
      }
    }
  }

  // Params not in ALL instances become optional
  const merged: ExtractedParam[] = [];
  for (const [name, param] of paramMap) {
    const count = paramCounts.get(name) || 0;
    merged.push({
      ...param,
      optional: param.optional || count < gaps.length,
    });
  }

  return merged;
}

/**
 * Analyze and group pattern gaps into deduplicated, scored patterns.
 */
export function analyzePatterns(
  gaps: PatternGap[],
  thresholds: QualityThresholds = DEFAULT_THRESHOLDS,
): AnalyzedPattern[] {
  // Group by (namespace, structuralHash)
  const groups = new Map<string, PatternGap[]>();

  for (const gap of gaps) {
    const hash = computeStructuralHash(gap);
    const key = `${gap.libraryName}::${hash}`;
    const group = groups.get(key) || [];
    group.push(gap);
    groups.set(key, group);
  }

  // Convert groups to analyzed patterns
  const patterns: AnalyzedPattern[] = [];

  for (const [key, groupGaps] of groups) {
    const representative = groupGaps[0];
    const hash = computeStructuralHash(representative);
    const qualityScore = scorePattern(groupGaps, thresholds);

    // Filter out patterns that don't meet thresholds
    if (!passesThresholds(qualityScore, thresholds)) continue;

    patterns.push({
      templateName: deriveTemplateName(representative),
      structuralHash: hash,
      namespace: representative.libraryName,
      slots: mergeParams(groupGaps),
      instanceCount: groupGaps.length,
      qualityScore,
      representativeSnippet: representative.snippet,
      goldenExample: buildGoldenExample(representative),
      imports: extractImports(representative),
      gapIds: groupGaps.map(g => g.id),
    });
  }

  // Sort by overall score descending
  patterns.sort((a, b) => b.qualityScore.overallScore - a.qualityScore.overallScore);

  return patterns;
}
