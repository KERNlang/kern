/**
 * Proof Obligations — generated from structure and peer norms.
 *
 * A ProofObligation is something a reviewer (human or LLM) must verify.
 * Two sources:
 *   1. Structural: derived from concept graph topology (no peers needed)
 *   2. Norm-violation: derived from peer function comparison (norm-miner)
 *
 * Obligations are deduped: when a norm violation and a structural obligation
 * target the same function + missing concept kind, the norm violation wins
 * (it has stronger evidence).
 */

import type { ConceptMap, ConceptNode, ConceptNodeKind } from '@kernlang/core';
import type { NormViolation } from './norm-miner.js';
import type { FileContext } from './types.js';

// ── Types ───────────────────────────────────────────────────────────────

export type ObligationType = 'norm-violation' | 'structural';

export interface ProofObligation {
  /** Unique ID for this obligation */
  id: string;
  /** What kind of evidence produced this obligation */
  type: ObligationType;
  /** The function this obligation targets */
  functionId: string;
  /** Human-readable function name */
  functionName: string;
  /** What concept kind is expected but missing */
  missingKind: ConceptNodeKind;
  /** Human-readable claim the reviewer must verify */
  claim: string;
  /** Priority: 1 = highest (norm-violation), 3 = lowest (structural) */
  priority: number;
  /** File path where the function lives */
  filePath: string;
  /** Line number of the function */
  line: number;
  /** Evidence supporting the claim */
  evidence_for: string[];
  /** Evidence against the claim */
  evidence_against: string[];
  /** How common this pattern is among peer functions (0-1) */
  prevalence?: number;
  /** Suggested verification action for the reviewer */
  suggested_check: string;
}

// ── Priority ────────────────────────────────────────────────────────────

const TYPE_PRIORITY: Record<ObligationType, number> = {
  'norm-violation': 2,
  structural: 3,
};

// ── Structural obligations ──────────────────────────────────────────────

/**
 * Generate obligations from concept graph topology — no peer comparison needed.
 *
 * Rules:
 * (A) Function has effect children but no error_handle child
 * (B) Function is in boundary 'api' and has effect children but no guard child
 * (C) Function has effect with subtype 'db' and no guard with subtype 'validation'
 */
export function obligationsFromStructure(
  allConcepts: Map<string, ConceptMap>,
  fileContextMap: Map<string, FileContext> | undefined,
  filePath: string,
): ProofObligation[] {
  const obligations: ProofObligation[] = [];
  const concepts = allConcepts.get(filePath);
  if (!concepts) return obligations;

  // Find all function declarations in this file
  const fnNodes = concepts.nodes.filter((n: ConceptNode) => n.kind === 'function_declaration');

  for (const fnNode of fnNodes) {
    const fnName = fnNode.payload.kind === 'function_declaration' ? fnNode.payload.name : 'anonymous';
    const fnId = fnNode.id;

    // Build the containerId that children would reference
    // Match the getContainerId format: filePath#fn:name@offset
    const containerPrefix = `${filePath}#fn:${fnName}@`;

    // Find children of this function
    const children = concepts.nodes.filter((n: ConceptNode) => n.containerId?.startsWith(containerPrefix));

    const effects = children.filter((n: ConceptNode) => n.kind === 'effect');
    const errorHandles = children.filter((n: ConceptNode) => n.kind === 'error_handle');
    const guards = children.filter((n: ConceptNode) => n.kind === 'guard');

    // (A) Function has effect children but no error_handle child
    if (effects.length > 0 && errorHandles.length === 0) {
      const effectSubtypes = [
        ...new Set(
          effects
            .map((e: ConceptNode) => (e.payload.kind === 'effect' ? e.payload.subtype : undefined))
            .filter((s: string | undefined): s is string => s !== undefined),
        ),
      ];
      obligations.push({
        id: `struct-errh-${fnId}`,
        type: 'structural',
        functionId: fnId,
        functionName: fnName,
        missingKind: 'error_handle',
        claim: `This function performs ${effectSubtypes.join(', ')} effects but has no error handling`,
        priority: TYPE_PRIORITY.structural,
        filePath,
        line: fnNode.primarySpan.startLine,
        evidence_for: [`Has ${effects.length} effect(s): ${effectSubtypes.join(', ')}`],
        evidence_against: [],
        suggested_check: 'Verify error handling is truly missing, not handled by a parent caller',
      });
    }

    // (B) Function is in boundary 'api' and has effect children but no guard child
    const fileCtx = fileContextMap?.get(filePath);
    if (fileCtx?.boundary === 'api' && effects.length > 0 && guards.length === 0) {
      const effectDescs = effects
        .map((e: ConceptNode) => (e.payload.kind === 'effect' ? e.payload.subtype : undefined))
        .filter((s: string | undefined): s is string => s !== undefined);
      obligations.push({
        id: `struct-guard-${fnId}`,
        type: 'structural',
        functionId: fnId,
        functionName: fnName,
        missingKind: 'guard',
        claim: `This API handler reaches ${[...new Set(effectDescs)].join(', ')} effects without input validation`,
        priority: TYPE_PRIORITY.structural,
        filePath,
        line: fnNode.primarySpan.startLine,
        evidence_for: [`API boundary function with ${effects.length} unguarded effect(s)`],
        evidence_against: [],
        suggested_check: 'Check if validation is handled by middleware or a parent router',
      });
    }

    // (C) Function has effect with subtype 'db' and no guard with subtype 'validation'
    const hasDbEffect = effects.some((e: ConceptNode) => e.payload.kind === 'effect' && e.payload.subtype === 'db');
    const hasValidationGuard = guards.some(
      (g: ConceptNode) => g.payload.kind === 'guard' && g.payload.subtype === 'validation',
    );
    if (hasDbEffect && !hasValidationGuard) {
      obligations.push({
        id: `struct-dbval-${fnId}`,
        type: 'structural',
        functionId: fnId,
        functionName: fnName,
        missingKind: 'guard',
        claim: 'DB write without input validation',
        priority: TYPE_PRIORITY.structural,
        filePath,
        line: fnNode.primarySpan.startLine,
        evidence_for: ['Has DB effect without validation guard'],
        evidence_against: [],
        suggested_check: 'Verify no ORM-level or middleware validation exists',
      });
    }
  }

  return obligations;
}

// ── Norm-based obligations ──────────────────────────────────────────────

/**
 * Convert norm violations into proof obligations.
 */
export function obligationsFromNorms(violations: NormViolation[]): ProofObligation[] {
  return violations.map((v) => {
    let claim = `Norm: ${v.norm} (${v.peerCount} peers, ${Math.round(v.prevalence * 100)}% prevalence)`;
    if (v.weakNorm) {
      claim += ' (Note: limited peer evidence — 1 matching peer)';
    }
    const fnName = v.functionNode.payload.kind === 'function_declaration' ? v.functionNode.payload.name : 'anonymous';
    return {
      id: `norm-${v.functionNode.id}-${v.missingKind}`,
      type: 'norm-violation' as const,
      functionId: v.functionNode.id,
      functionName: fnName,
      missingKind: v.missingKind,
      claim,
      priority: TYPE_PRIORITY['norm-violation'],
      filePath: v.functionNode.primarySpan.file,
      line: v.functionNode.primarySpan.startLine,
      evidence_for: [`${v.peerCount} peer(s) have this pattern, ${Math.round(v.prevalence * 100)}% prevalence`],
      evidence_against: v.weakNorm ? ['Limited peer evidence — only 1 matching peer'] : [],
      prevalence: v.prevalence,
      suggested_check: `Verify ${v.missingKind} is truly needed here, not handled elsewhere`,
    };
  });
}

// ── Synthesize + Dedup ──────────────────────────────────────────────────

/**
 * Produce the final list of proof obligations for a file.
 * Merges structural + norm obligations, deduplicating: when both sources
 * target the same function + missing kind, the norm violation wins.
 */
export function synthesizeObligations(
  allConcepts: Map<string, ConceptMap>,
  fileContextMap: Map<string, FileContext> | undefined,
  filePath: string,
  normViolations: NormViolation[],
): ProofObligation[] {
  // Structural obligations for this file
  const structural = obligationsFromStructure(allConcepts, fileContextMap, filePath);

  // Norm-based obligations (already scoped to specific functions)
  const fileNormViolations = normViolations.filter((v) => v.functionNode.primarySpan.file === filePath);
  const normObligations = obligationsFromNorms(fileNormViolations);

  // Dedup: norm obligations take precedence over structural for same function+missingKind
  const normKeys = new Set(normObligations.map((o) => `${o.functionId}::${o.missingKind}`));
  const dedupedStructural = structural.filter((o) => !normKeys.has(`${o.functionId}::${o.missingKind}`));

  // Merge and sort by priority (lower = higher priority)
  const all = [...normObligations, ...dedupedStructural];
  all.sort((a, b) => a.priority - b.priority || a.line - b.line);

  return all;
}
