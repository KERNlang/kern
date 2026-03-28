/**
 * Gap Detector — Phase 1 of the evolve pipeline.
 *
 * Uses @kernlang/review to find what IS covered, then runs pluggable
 * detector packs to find what's NOT covered (gaps).
 */

import { Project, type SourceFile } from 'ts-morph';
import { reviewFile } from '@kernlang/review';
import type { ReviewReport } from '@kernlang/review';
import { getDetectorsForImport, getUniversalDetectors } from './detector-registry.js';
import { detectConceptualGaps } from './concept-gap-adapter.js';
import type { PatternGap, DetectorPack } from './types.js';

let _gapIdCounter = 0;

function nextGapId(detectorId: string): string {
  return `gap-${detectorId}-${++_gapIdCounter}`;
}

/**
 * Reset the gap ID counter (for test isolation).
 */
export function resetGapIds(): void {
  _gapIdCounter = 0;
}

/**
 * Detect gaps in a single TS file: patterns that exist in the code
 * but are NOT covered by existing KERN templates.
 */
export function detectGaps(
  sourceFile: SourceFile,
  filePath: string,
  existingCoverage?: ReviewReport,
): PatternGap[] {
  const fullText = sourceFile.getFullText();
  const imports = sourceFile.getImportDeclarations();
  const gaps: PatternGap[] = [];

  // Collect existing template match ranges so we skip already-covered code
  const coveredRanges = new Set<string>();
  if (existingCoverage) {
    for (const tm of existingCoverage.templateMatches) {
      for (let l = tm.startLine; l <= tm.endLine; l++) {
        coveredRanges.add(`${l}`);
      }
    }
  }

  // Find which detectors are relevant for this file's imports
  const relevantDetectors = new Set<DetectorPack>();
  for (const imp of imports) {
    const importPath = imp.getModuleSpecifierValue();
    for (const det of getDetectorsForImport(importPath)) {
      relevantDetectors.add(det);
    }
  }

  // Run each relevant detector (import-matched)
  for (const detector of relevantDetectors) {
    const detections = detector.detect(sourceFile, fullText);

    for (const detection of detections) {
      // Skip if any line in this range is already covered by existing templates
      let isCovered = false;
      for (let l = detection.startLine; l <= detection.endLine; l++) {
        if (coveredRanges.has(`${l}`)) { isCovered = true; break; }
      }
      if (isCovered) continue;

      gaps.push({
        id: nextGapId(detector.id),
        detectorId: detector.id,
        libraryName: detector.libraryName,
        patternKind: detector.patternKind,
        anchorImport: detection.anchorImport,
        startLine: detection.startLine,
        endLine: detection.endLine,
        snippet: detection.snippet,
        extractedParams: detection.extractedParams,
        confidencePct: detection.confidencePct,
        filePath,
      });
    }
  }

  // Run universal detectors (import-agnostic structural patterns)
  for (const detector of getUniversalDetectors()) {
    if (relevantDetectors.has(detector)) continue; // already ran
    const detections = detector.detect(sourceFile, fullText);
    for (const detection of detections) {
      let isCovered = false;
      for (let l = detection.startLine; l <= detection.endLine; l++) {
        if (coveredRanges.has(`${l}`)) { isCovered = true; break; }
      }
      if (isCovered) continue;

      gaps.push({
        id: nextGapId(detector.id),
        detectorId: detector.id,
        libraryName: detector.libraryName,
        patternKind: detector.patternKind,
        anchorImport: detection.anchorImport,
        startLine: detection.startLine,
        endLine: detection.endLine,
        snippet: detection.snippet,
        extractedParams: detection.extractedParams,
        confidencePct: detection.confidencePct,
        filePath,
      });
    }
  }

  // Run concept-based detection (universal structural gaps)
  const conceptGaps = detectConceptualGaps(sourceFile, filePath);
  return [...gaps, ...conceptGaps];
}

/**
 * Detect gaps across multiple files.
 */
export function detectGapsInFiles(
  filePaths: string[],
  project?: Project,
): PatternGap[] {
  const tsProject = project || new Project({ skipAddingFilesFromTsConfig: true });
  const allGaps: PatternGap[] = [];

  for (const filePath of filePaths) {
    try {
      const sourceFile = tsProject.addSourceFileAtPath(filePath);

      // Get existing coverage from review
      let coverage: ReviewReport | undefined;
      try {
        coverage = reviewFile(filePath);
      } catch {
        // Intentional: review report is optional — proceed with no coverage data
      }

      const gaps = detectGaps(sourceFile, filePath, coverage);
      allGaps.push(...gaps);
    } catch {
      // Intentional: file may be deleted between glob and parse — skip it
    }
  }

  return allGaps;
}

/**
 * Detect gaps from a source string (useful for testing).
 */
export function detectGapsFromSource(
  source: string,
  filePath = 'input.ts',
  project?: Project,
): PatternGap[] {
  const tsProject = project || new Project({ skipAddingFilesFromTsConfig: true });
  const sourceFile = tsProject.createSourceFile(filePath, source, { overwrite: true });
  return detectGaps(sourceFile, filePath);
}
