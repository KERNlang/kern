/**
 * Evolve Runner — orchestrator for the full evolve pipeline.
 *
 * Pipeline: scan → gap-detect → analyze → propose → validate → stage
 */

import { readdirSync, statSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { Project } from 'ts-morph';
import { detectGaps, detectGapsFromSource } from './gap-detector.js';
import { analyzePatterns, analyzeStructuralPatterns } from './pattern-analyzer.js';
import { proposeTemplates } from './template-proposer.js';
import { validateProposal } from './template-validator.js';
import { stageProposal, stageNodeProposal } from './staging.js';
import { DEFAULT_THRESHOLDS } from './quality-scorer.js';
import { scoreExpressibility, isNodeCandidate } from './expressibility-scorer.js';
import { proposeNodes } from './node-proposer.js';
import { governanceGate } from './node-governance.js';
import { validateNodeProposal } from './node-validator.js';
import type { EvolveConfig, EvolveResult, QualityThresholds, PatternGap, ConceptGapSummary, ExpressibilityScore, NodeProposal } from './types.js';

export interface EvolveOptions {
  recursive?: boolean;
  preview?: boolean;
  thresholds?: Partial<QualityThresholds>;
  tsconfigPath?: string;
  config?: Partial<EvolveConfig>;
  enableNodeProposals?: boolean;
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

  // Phase 2: Analyze and group patterns (v2 template path)
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

  // ── v3 branch: Node proposals from structural gaps ──
  let nodeProposals: NodeProposal[] | undefined;
  let nodeValidated: Array<{ proposal: NodeProposal; validation: import('./types.js').NodeValidationResult }> | undefined;
  let stagedNodes: import('./types.js').StagedNodeProposal[] | undefined;

  if (options.enableNodeProposals) {
    // Phase 2.5: Analyze structural gaps separately
    const structuralAnalyzed = analyzeStructuralPatterns(allGaps, thresholds);

    // Phase 2.6: Score expressibility for structural gaps
    const expressScores = new Map<string, ExpressibilityScore>();
    for (const pattern of structuralAnalyzed) {
      const snippets = allGaps
        .filter(g => pattern.gapIds.includes(g.id))
        .map(g => g.snippet);
      const score = scoreExpressibility(
        allGaps.filter(g => pattern.gapIds.includes(g.id)),
        snippets,
      );
      expressScores.set(pattern.structuralHash, score);
    }

    // Phase 2.7: Propose nodes for high-expressibility patterns
    const candidatePatterns = structuralAnalyzed.filter(p => {
      const score = expressScores.get(p.structuralHash);
      return score && isNodeCandidate(score);
    });
    nodeProposals = proposeNodes(candidatePatterns, expressScores);

    // Phase 2.8: Governance gate filter
    const governed = nodeProposals.filter(np => governanceGate(np).pass);

    // Phase 2.9: Validate governed proposals
    nodeValidated = governed.map(np => ({
      proposal: np,
      validation: validateNodeProposal(np),
    }));

    // Phase 2.10: Stage validated node proposals
    stagedNodes = options.preview
      ? []
      : nodeValidated
          .filter(v => v.validation.parseOk && v.validation.codegenOk)
          .map(v => stageNodeProposal(v.proposal, v.validation, options.config));
  }

  return {
    gaps: allGaps,
    analyzed,
    proposals,
    validated,
    staged,
    conceptSummary: buildConceptSummary(allGaps),
    nodeProposals,
    nodeValidated,
    stagedNodes,
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
    conceptSummary: buildConceptSummary(gaps),
  };
}

function buildConceptSummary(gaps: PatternGap[]): ConceptGapSummary | undefined {
  const conceptGaps = gaps.filter(g => g.libraryName === 'structural');
  if (conceptGaps.length === 0) return undefined;

  const byRule: Record<string, number> = {};
  for (const g of conceptGaps) {
    const rule = g.detectorId.replace(/^concept-/, '');
    byRule[rule] = (byRule[rule] || 0) + 1;
  }

  const parts = Object.entries(byRule).map(([rule, count]) => `${rule}: ${count}`);
  const formatted = `Structural gaps: ${conceptGaps.length} (${parts.join(', ')})`;

  return { total: conceptGaps.length, byRule, formatted };
}

function collectTsFiles(inputPath: string, recursive: boolean): string[] {
  if (!existsSync(inputPath)) return [];

  const stat = statSync(inputPath);
  if (stat.isFile()) {
    if (inputPath.endsWith('.ts') || inputPath.endsWith('.tsx')) {
      if (!inputPath.endsWith('.d.ts') && !inputPath.endsWith('.test.ts') && !inputPath.endsWith('.test.tsx')) {
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
    } else if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      files.push(full);
    }
  }

  return files;
}
