/**
 * Node Governance Gate — quality control for IR node proposals.
 *
 * Ensures only high-quality, well-evidenced proposals pass through.
 * Checks: frequency, expressibility, target coverage, quality score.
 */

import type { NodeProposal } from './types.js';

export interface GovernanceResult {
  pass: boolean;
  reasons: string[];
}

const MIN_FREQUENCY = 3;
const MIN_EXPRESSIBILITY = 7.0;
const MIN_TARGET_COVERAGE = 8; // out of 11 targets
const MIN_QUALITY_SCORE = 60;

/**
 * Run the governance gate on a node proposal.
 * All checks must pass for the proposal to be approved.
 */
export function governanceGate(proposal: NodeProposal): GovernanceResult {
  const reasons: string[] = [];

  if (proposal.frequency < MIN_FREQUENCY) {
    reasons.push(`frequency ${proposal.frequency} < ${MIN_FREQUENCY} (need more instances)`);
  }

  if (proposal.expressibilityScore.overall < MIN_EXPRESSIBILITY) {
    reasons.push(
      `expressibility ${proposal.expressibilityScore.overall} < ${MIN_EXPRESSIBILITY} (current IR may suffice)`,
    );
  }

  if (proposal.qualityScore < MIN_QUALITY_SCORE) {
    reasons.push(`quality ${proposal.qualityScore} < ${MIN_QUALITY_SCORE}`);
  }

  // Target coverage check: count how many targets the codegen stub covers
  const targetCount = Object.keys(proposal.targetStubs).length;
  if (targetCount > 0 && targetCount < MIN_TARGET_COVERAGE) {
    reasons.push(`target coverage ${targetCount}/${MIN_TARGET_COVERAGE}`);
  }

  return {
    pass: reasons.length === 0,
    reasons,
  };
}

/** Get governance thresholds for display. */
export function getGovernanceThresholds() {
  return {
    minFrequency: MIN_FREQUENCY,
    minExpressibility: MIN_EXPRESSIBILITY,
    minTargetCoverage: MIN_TARGET_COVERAGE,
    minQualityScore: MIN_QUALITY_SCORE,
  };
}
