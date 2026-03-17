/**
 * Evolve Runner — orchestrator for the full evolve pipeline.
 *
 * Pipeline: scan → gap-detect → analyze → propose → validate → stage
 */

import { readdirSync, statSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { Project } from 'ts-morph';
import { detectGaps, detectGapsFromSource } from './gap-detector.js';
import { analyzePatterns } from './pattern-analyzer.js';
import { proposeTemplates } from './template-proposer.js';
import { validateProposal } from './template-validator.js';
import { stageProposal } from './staging.js';
import { DEFAULT_THRESHOLDS } from './quality-scorer.js';
import type { EvolveConfig, EvolveResult, QualityThresholds, PatternGap } from './types.js';

export interface EvolveOptions {
  recursive?: boolean;
  preview?: boolean;
  thresholds?: Partial<QualityThresholds>;
  tsconfigPath?: string;
  config?: Partial<EvolveConfig>;
}

/**
 * Run the full evolve pipeline on a directory or file.
 */
export function evolve(
  inputPath: string,
  options: EvolveOptions = {},
): EvolveResult {
  const resolvedPath = resolve(inputPath);
  const thresholds: QualityThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...options.thresholds,
  };

  // Collect TS files
  const filePaths = collectTsFiles(resolvedPath, options.recursive ?? false);
  if (filePaths.length === 0) {
    return { gaps: [], analyzed: [], proposals: [], validated: [], staged: [] };
  }

  // Create a ts-morph project for analysis
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    tsConfigFilePath: options.tsconfigPath,
  });

  // Phase 1: Detect gaps across all files
  const allGaps: PatternGap[] = [];
  for (const filePath of filePaths) {
    try {
      const sourceFile = project.addSourceFileAtPath(filePath);
      const gaps = detectGaps(sourceFile, filePath);
      allGaps.push(...gaps);
    } catch {
      // Skip files that can't be parsed
    }
  }

  // Phase 2: Analyze and group patterns
  const analyzed = analyzePatterns(allGaps, thresholds);

  // Phase 3: Propose templates
  const proposals = proposeTemplates(analyzed);

  // Phase 4: Validate proposals
  const validated = proposals.map(proposal => ({
    proposal,
    validation: validateProposal(proposal, options.tsconfigPath),
  }));

  // Phase 5: Stage validated proposals (unless preview mode)
  const staged = options.preview
    ? []
    : validated
        .filter(v => v.validation.parseOk && v.validation.registerOk && v.validation.expansionOk)
        .map(v => stageProposal(v.proposal, v.validation, options.config));

  return {
    gaps: allGaps,
    analyzed,
    proposals,
    validated,
    staged,
  };
}

/**
 * Run evolve on a source string (useful for testing and single-file analysis).
 */
export function evolveSource(
  source: string,
  filePath = 'input.ts',
  options: EvolveOptions = {},
): EvolveResult {
  const thresholds: QualityThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...options.thresholds,
  };

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const sourceFile = project.createSourceFile(filePath, source, { overwrite: true });

  // Phase 1
  const gaps = detectGaps(sourceFile, filePath);

  // Phase 2
  const analyzed = analyzePatterns(gaps, thresholds);

  // Phase 3
  const proposals = proposeTemplates(analyzed);

  // Phase 4
  const validated = proposals.map(proposal => ({
    proposal,
    validation: validateProposal(proposal, options.tsconfigPath),
  }));

  // Phase 5 (skip staging for source mode)
  return {
    gaps,
    analyzed,
    proposals,
    validated,
    staged: [],
  };
}

function collectTsFiles(inputPath: string, recursive: boolean): string[] {
  if (!existsSync(inputPath)) return [];

  const stat = statSync(inputPath);
  if (stat.isFile()) {
    if (inputPath.endsWith('.ts') || inputPath.endsWith('.tsx')) {
      if (!inputPath.endsWith('.d.ts') && !inputPath.endsWith('.test.ts')) {
        return [inputPath];
      }
    }
    return [];
  }

  if (!stat.isDirectory()) return [];

  const files: string[] = [];
  for (const entry of readdirSync(inputPath)) {
    const full = join(inputPath, entry);
    const s = statSync(full);
    if (s.isDirectory() && recursive && !entry.startsWith('.') && entry !== 'node_modules' && entry !== 'dist') {
      files.push(...collectTsFiles(full, true));
    } else if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) {
      files.push(full);
    }
  }

  return files;
}
