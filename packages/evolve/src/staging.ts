/**
 * Staging — Phase 5 of the evolve pipeline.
 *
 * Per-proposal file staging + approval workflow.
 * Each proposal gets its own JSON file to avoid merge conflicts in teams.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { resolve, basename } from 'path';
import { parse, registerTemplate, clearTemplates } from '@kernlang/core';
import type { TemplateProposal, ValidationResult, StagedProposal, ProposalStatus, EvolveConfig, NodeProposal, NodeValidationResult, StagedNodeProposal, NodeProposalStatus } from './types.js';

const DEFAULT_STAGING_DIR = '.kern/evolve/staged';
const DEFAULT_PROMOTED_DIR = '.kern/evolve/promoted';
const DEFAULT_NODE_STAGING_DIR = '.kern/evolve/staged-nodes';

/**
 * Stage a validated proposal for human review.
 */
export function stageProposal(
  proposal: TemplateProposal,
  validation: ValidationResult,
  config?: Partial<EvolveConfig>,
): StagedProposal {
  const stagingDir = resolve(process.cwd(), config?.stagingDir || DEFAULT_STAGING_DIR);
  mkdirSync(stagingDir, { recursive: true });

  const staged: StagedProposal = {
    id: proposal.id,
    proposal,
    validation,
    status: 'pending',
    stagedAt: new Date().toISOString(),
  };

  const filePath = resolve(stagingDir, `${proposal.id}.json`);
  writeFileSync(filePath, JSON.stringify(staged, null, 2));

  return staged;
}

/**
 * List all staged proposals.
 */
export function listStaged(config?: Partial<EvolveConfig>): StagedProposal[] {
  const stagingDir = resolve(process.cwd(), config?.stagingDir || DEFAULT_STAGING_DIR);
  if (!existsSync(stagingDir)) return [];

  const files = readdirSync(stagingDir).filter(f => f.endsWith('.json'));
  const proposals: StagedProposal[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(resolve(stagingDir, file), 'utf-8');
      proposals.push(JSON.parse(content));
    } catch {
      // Skip invalid files
    }
  }

  return proposals.sort((a, b) =>
    (b.proposal.qualityScore.overallScore) - (a.proposal.qualityScore.overallScore),
  );
}

/**
 * Get a single staged proposal by ID.
 */
export function getStaged(id: string, config?: Partial<EvolveConfig>): StagedProposal | undefined {
  const stagingDir = resolve(process.cwd(), config?.stagingDir || DEFAULT_STAGING_DIR);
  const filePath = resolve(stagingDir, `${id}.json`);
  if (!existsSync(filePath)) return undefined;

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * Update the status of a staged proposal.
 */
export function updateStagedStatus(
  id: string,
  status: ProposalStatus,
  config?: Partial<EvolveConfig>,
): StagedProposal | undefined {
  const stagingDir = resolve(process.cwd(), config?.stagingDir || DEFAULT_STAGING_DIR);
  const filePath = resolve(stagingDir, `${id}.json`);
  if (!existsSync(filePath)) return undefined;

  try {
    const staged: StagedProposal = JSON.parse(readFileSync(filePath, 'utf-8'));
    staged.status = status;
    staged.reviewedAt = new Date().toISOString();
    writeFileSync(filePath, JSON.stringify(staged, null, 2));
    return staged;
  } catch {
    return undefined;
  }
}

/**
 * Promote approved proposals to project-local templates directory.
 */
export function promoteLocal(config?: Partial<EvolveConfig>): string[] {
  const stagingDir = resolve(process.cwd(), config?.stagingDir || DEFAULT_STAGING_DIR);
  const promotedDir = resolve(process.cwd(), config?.promotedDir || DEFAULT_PROMOTED_DIR);
  const templatesDir = resolve(process.cwd(), config?.templatesDir || 'templates');

  mkdirSync(promotedDir, { recursive: true });
  mkdirSync(templatesDir, { recursive: true });

  const staged = listStaged(config);
  const approved = staged.filter(s => s.status === 'approved');
  const promoted: string[] = [];

  for (const s of approved) {
    // Write the .kern template file
    const kernFileName = `${s.proposal.templateName}.kern`;
    const kernFilePath = resolve(templatesDir, kernFileName);
    writeFileSync(kernFilePath, s.proposal.kernSource + '\n');

    // Move to promoted directory
    const stagedPath = resolve(stagingDir, `${s.id}.json`);
    const promotedPath = resolve(promotedDir, `${s.id}.json`);
    writeFileSync(promotedPath, JSON.stringify({ ...s, status: 'approved' }, null, 2));

    // Remove from staging
    if (existsSync(stagedPath)) {
      unlinkSync(stagedPath);
    }

    promoted.push(kernFileName);
  }

  return promoted;
}

/**
 * Remove rejected proposals from staging.
 */
export function cleanRejected(config?: Partial<EvolveConfig>): number {
  const stagingDir = resolve(process.cwd(), config?.stagingDir || DEFAULT_STAGING_DIR);
  if (!existsSync(stagingDir)) return 0;

  const staged = listStaged(config);
  const rejected = staged.filter(s => s.status === 'rejected');
  let cleaned = 0;

  for (const s of rejected) {
    const filePath = resolve(stagingDir, `${s.id}.json`);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Format a staged proposal for split-view display.
 */
export function formatSplitView(staged: StagedProposal): string {
  const { proposal, validation } = staged;
  const lines: string[] = [];

  const nameLen = Math.max(proposal.templateName.length + proposal.namespace.length + 3, 40);
  const border = '\u2500'.repeat(nameLen + 18);

  lines.push(`\u250C${border}\u2510`);
  lines.push(`\u2502 ${proposal.templateName} (${proposal.namespace})${' '.repeat(Math.max(0, nameLen - proposal.templateName.length - proposal.namespace.length - 3))}                 \u2502`);
  lines.push(`\u2502 Score: ${proposal.qualityScore.overallScore}  |  Instances: ${proposal.instanceCount}  |  Status: ${staged.status}${' '.repeat(Math.max(0, nameLen + 5 - `Score: ${proposal.qualityScore.overallScore}  |  Instances: ${proposal.instanceCount}  |  Status: ${staged.status}`.length))} \u2502`);
  lines.push(`\u251C${'─'.repeat(Math.floor(border.length / 2))}\u252C${'─'.repeat(Math.ceil(border.length / 2))}\u2524`);

  // Left: Original TS, Right: Proposed KERN
  const origLines = proposal.representativeSnippet.split('\n').slice(0, 12);
  const kernLines = proposal.kernSource.split('\n').slice(0, 12);
  const maxLines = Math.max(origLines.length, kernLines.length);
  const halfWidth = Math.floor(border.length / 2);

  lines.push(`\u2502 ${'Original TypeScript'.padEnd(halfWidth - 1)}\u2502 ${'Proposed KERN Template'.padEnd(halfWidth - 2)}\u2502`);
  lines.push(`\u251C${'─'.repeat(halfWidth)}\u253C${'─'.repeat(halfWidth)}\u2524`);

  for (let i = 0; i < maxLines; i++) {
    const left = (origLines[i] || '').substring(0, halfWidth - 2).padEnd(halfWidth - 1);
    const right = (kernLines[i] || '').substring(0, halfWidth - 3).padEnd(halfWidth - 2);
    lines.push(`\u2502 ${left}\u2502 ${right}\u2502`);
  }

  // Validation status
  lines.push(`\u251C${'─'.repeat(border.length)}\u2524`);
  const checks = [
    validation.parseOk ? '\u2713 Parse' : '\u2717 Parse',
    validation.registerOk ? '\u2713 Register' : '\u2717 Register',
    validation.expansionOk ? '\u2713 Expansion' : '\u2717 Expansion',
    validation.goldenDiffOk ? '\u2713 Golden diff' : '\u2717 Golden diff',
    validation.typecheckOk ? '\u2713 Typecheck' : '\u2717 Typecheck',
  ];
  lines.push(`\u2502 ${checks.join('  |  ').padEnd(border.length - 1)}\u2502`);
  lines.push(`\u2514${border}\u2518`);

  lines.push('');
  lines.push('  [a]pprove  [r]eject  [s]kip  [d]etail');

  return lines.join('\n');
}

// ── Node Staging (v3) ────────────────────────────────────────────────────

/**
 * Stage a validated node proposal for human review.
 */
export function stageNodeProposal(
  proposal: NodeProposal,
  validation: NodeValidationResult,
  config?: Partial<EvolveConfig>,
): StagedNodeProposal {
  const stagingDir = resolve(process.cwd(), config?.stagingDir ? `${config.stagingDir}-nodes` : DEFAULT_NODE_STAGING_DIR);
  mkdirSync(stagingDir, { recursive: true });

  const staged: StagedNodeProposal = {
    id: proposal.id,
    proposal,
    validation,
    status: 'pending',
    stagedAt: new Date().toISOString(),
  };

  const filePath = resolve(stagingDir, `${proposal.id}.json`);
  writeFileSync(filePath, JSON.stringify(staged, null, 2));

  return staged;
}

/**
 * List all staged node proposals.
 */
export function listStagedNodes(config?: Partial<EvolveConfig>): StagedNodeProposal[] {
  const stagingDir = resolve(process.cwd(), config?.stagingDir ? `${config.stagingDir}-nodes` : DEFAULT_NODE_STAGING_DIR);
  if (!existsSync(stagingDir)) return [];

  const files = readdirSync(stagingDir).filter(f => f.endsWith('.json'));
  const proposals: StagedNodeProposal[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(resolve(stagingDir, file), 'utf-8');
      proposals.push(JSON.parse(content));
    } catch {
      // Skip invalid files
    }
  }

  return proposals.sort((a, b) => b.proposal.qualityScore - a.proposal.qualityScore);
}

/**
 * Update the status of a staged node proposal.
 */
export function updateStagedNodeStatus(
  id: string,
  status: NodeProposalStatus,
  config?: Partial<EvolveConfig>,
): StagedNodeProposal | undefined {
  const stagingDir = resolve(process.cwd(), config?.stagingDir ? `${config.stagingDir}-nodes` : DEFAULT_NODE_STAGING_DIR);
  const filePath = resolve(stagingDir, `${id}.json`);
  if (!existsSync(filePath)) return undefined;

  try {
    const staged: StagedNodeProposal = JSON.parse(readFileSync(filePath, 'utf-8'));
    staged.status = status;
    staged.reviewedAt = new Date().toISOString();
    writeFileSync(filePath, JSON.stringify(staged, null, 2));
    return staged;
  } catch {
    return undefined;
  }
}

/**
 * Format a staged node proposal for split-view display.
 */
export function formatNodeSplitView(staged: StagedNodeProposal): string {
  const { proposal, validation } = staged;
  const lines: string[] = [];

  const nameLen = Math.max(proposal.nodeName.length + 20, 40);
  const border = '\u2500'.repeat(nameLen + 18);

  lines.push(`\u250C${border}\u2510`);
  lines.push(`\u2502 NODE: ${proposal.nodeName}${' '.repeat(Math.max(0, nameLen - proposal.nodeName.length - 6))}                 \u2502`);
  lines.push(`\u2502 Score: ${proposal.qualityScore}  |  Freq: ${proposal.frequency}  |  Express: ${proposal.expressibilityScore.overall}  |  ${staged.status}${' '.repeat(Math.max(0, 10))} \u2502`);
  lines.push(`\u251C${'─'.repeat(Math.floor(border.length / 2))}\u252C${'─'.repeat(Math.ceil(border.length / 2))}\u2524`);

  // Left: KERN Syntax, Right: Codegen Stub
  const kernLines = proposal.kernSyntax.split('\n').slice(0, 12);
  const codeLines = proposal.codegenStub.split('\n').slice(0, 12);
  const maxLines = Math.max(kernLines.length, codeLines.length);
  const halfWidth = Math.floor(border.length / 2);

  lines.push(`\u2502 ${'KERN Syntax'.padEnd(halfWidth - 1)}\u2502 ${'Codegen Stub'.padEnd(halfWidth - 2)}\u2502`);
  lines.push(`\u251C${'─'.repeat(halfWidth)}\u253C${'─'.repeat(halfWidth)}\u2524`);

  for (let i = 0; i < maxLines; i++) {
    const left = (kernLines[i] || '').substring(0, halfWidth - 2).padEnd(halfWidth - 1);
    const right = (codeLines[i] || '').substring(0, halfWidth - 3).padEnd(halfWidth - 2);
    lines.push(`\u2502 ${left}\u2502 ${right}\u2502`);
  }

  lines.push(`\u251C${'─'.repeat(border.length)}\u2524`);
  const checks = [
    validation.parseOk ? '\u2713 Parse' : '\u2717 Parse',
    validation.codegenOk ? '\u2713 Codegen' : '\u2717 Codegen',
    `Targets: ${validation.targetCoverage}/11`,
  ];
  lines.push(`\u2502 ${checks.join('  |  ').padEnd(border.length - 1)}\u2502`);
  lines.push(`\u2514${border}\u2518`);

  lines.push('');
  lines.push('  [a]pprove  [r]eject  [s]kip  [d]etail');

  return lines.join('\n');
}
