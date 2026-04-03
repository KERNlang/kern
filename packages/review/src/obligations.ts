/**
 * Proof Obligations — synthesize verification claims from norm violations,
 * sanitizer sufficiency, and error handling gaps.
 *
 * Three obligation sources:
 *   1. Norm-derived: "7/8 peer handlers validate, but this one doesn't. Prove it's safe."
 *   2. Sanitizer-sufficient: "Prove parseInt is sufficient sanitization for exec() sink."
 *   3. Error-handled-by-caller: "Function raises errors but caller doesn't handle them."
 *
 * Capped at 15 obligations per file. Priority: error > sanitizer > norm.
 */

import type { ConceptMap } from '@kernlang/core';
import type { NormViolation } from './norm-miner.js';
import type { TaintResult } from './taint.js';
import type { CallGraph } from './call-graph.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface ProofObligation {
  id: string;           // O1, O2, ...
  type: 'norm-violation' | 'sanitizer-sufficient' | 'error-handled-by-caller';
  claim: string;        // Human-readable claim to verify
  filePath: string;
  line: number;
  evidence_for: string[];
  evidence_against: string[];
  prevalence?: number;  // For norm-derived: 0-1
  suggested_check: string;
  relatedNodes: string[]; // IR node aliases
}

// ── Max obligations per file ─────────────────────────────────────────────

const MAX_OBLIGATIONS_PER_FILE = 15;

// ── Norm-Derived Obligations ─────────────────────────────────────────────

function obligationsFromNorms(violations: NormViolation[]): ProofObligation[] {
  const obligations: ProofObligation[] = [];

  for (const v of violations) {
    const fnName = extractFunctionName(v.functionId);
    const peerList = v.peerExamples.length > 0
      ? v.peerExamples.join(', ')
      : 'peer functions';

    let claim: string;
    let suggestedCheck: string;

    switch (v.violationType) {
      case 'missing-guard':
        claim = `${fnName} skips input validation, but ${v.peerCount - 1}/${v.peerCount} peer handlers validate (e.g., ${peerList}). Prove it is safe without validation.`;
        suggestedCheck = `Check if ${fnName} receives untrusted input that reaches effects without validation, or if validation happens at a higher layer.`;
        break;
      case 'missing-error-handle':
        claim = `${fnName} has no error handling, but ${v.peerCount - 1}/${v.peerCount} peer handlers handle errors (e.g., ${peerList}). Prove errors cannot propagate unsafely.`;
        suggestedCheck = `Check if ${fnName} can throw/reject and whether callers handle those errors.`;
        break;
      case 'missing-validation':
        claim = `${fnName} lacks validation that ${Math.round(v.prevalence * 100)}% of peers have. Prove the input is already validated upstream.`;
        suggestedCheck = `Trace the call chain to ${fnName} and verify validation occurs before this point.`;
        break;
      case 'missing-resource-cleanup':
        claim = `${fnName} does not clean up resources, but peers do. Prove cleanup is unnecessary or handled elsewhere.`;
        suggestedCheck = `Check if ${fnName} acquires resources (handles, connections) that need explicit cleanup.`;
        break;
      case 'inconsistent-pattern':
        claim = `${fnName} deviates from the pattern used by ${Math.round(v.prevalence * 100)}% of peers. Prove the deviation is intentional.`;
        suggestedCheck = `Compare ${fnName} with ${peerList} and verify the difference is deliberate.`;
        break;
    }

    obligations.push({
      id: '', // assigned later
      type: 'norm-violation',
      claim,
      filePath: v.filePath,
      line: v.line,
      evidence_for: [`Norm: ${v.norm}`],
      evidence_against: [],
      prevalence: v.prevalence,
      suggested_check: suggestedCheck,
      relatedNodes: [],
    });
  }

  return obligations;
}

// ── Sanitizer-Sufficient Obligations ─────────────────────────────────────

function obligationsFromTaint(taintResults: TaintResult[]): ProofObligation[] {
  const obligations: ProofObligation[] = [];

  for (const result of taintResults) {
    for (const path of result.paths) {
      // Only generate obligations for paths with sanitizers that might be insufficient
      if (!path.sanitizer) continue;

      // If the path is marked sanitized, we still want to verify sufficiency
      // If the path has an insufficientSanitizer, definitely flag it
      if (path.insufficientSanitizer) {
        obligations.push({
          id: '',
          type: 'sanitizer-sufficient',
          claim: `${path.sanitizer} is used to sanitize ${path.source.origin} before ${path.sink.name}() (${path.sink.category} sink), but it may be insufficient for this sink type. Prove it is sufficient or identify the correct sanitizer.`,
          filePath: result.filePath,
          line: path.sink.line ?? result.startLine,
          evidence_for: [`Sanitizer ${path.sanitizer} is applied before the sink`],
          evidence_against: [`${path.insufficientSanitizer} is not in the sufficiency matrix for ${path.sink.category} sinks`],
          suggested_check: `Verify that ${path.sanitizer} prevents ${path.sink.category} attacks. Consider using a sink-specific sanitizer.`,
          relatedNodes: [],
        });
      } else if (path.sanitized) {
        // Sanitizer present and deemed sufficient — low-priority verification
        obligations.push({
          id: '',
          type: 'sanitizer-sufficient',
          claim: `Prove ${path.sanitizer} is sufficient sanitization for ${path.source.origin} reaching ${path.sink.name}() (${path.sink.category} sink).`,
          filePath: result.filePath,
          line: path.sink.line ?? result.startLine,
          evidence_for: [`${path.sanitizer} is in the sufficiency matrix for ${path.sink.category}`],
          evidence_against: [],
          suggested_check: `Check if ${path.sanitizer} covers all attack vectors for ${path.sink.category}. Edge cases: encoding bypasses, type confusion.`,
          relatedNodes: [],
        });
      }
    }
  }

  return obligations;
}

// ── Error-Handled-By-Caller Obligations ──────────────────────────────────

function obligationsFromCallGraph(
  callGraph: CallGraph,
  allConcepts: Map<string, ConceptMap>,
  targetFilePath: string,
): ProofObligation[] {
  const obligations: ProofObligation[] = [];

  // Find functions in the target file that raise errors
  const concepts = allConcepts.get(targetFilePath);
  if (!concepts) return obligations;

  // Collect containerId → has error_raise
  const errorRaisers = new Set<string>();
  for (const node of concepts.nodes) {
    if (node.kind === 'error_raise' && node.containerId) {
      errorRaisers.add(node.containerId);
    }
  }

  // For each function that raises errors, check if callers handle them
  for (const node of concepts.nodes) {
    if (node.kind !== 'function_declaration') continue;
    if (!errorRaisers.has(node.id)) continue;

    const fnName = node.payload.kind === 'function_declaration' ? node.payload.name : 'unknown';
    const fnKey = `${targetFilePath}#${fnName}`;
    const fnNode = callGraph.functions.get(fnKey);
    if (!fnNode) continue;

    // Check each caller
    for (const callSite of fnNode.calledBy) {
      if (!callSite.resolved) continue;

      // Check if the caller's file has error_handle concepts in the caller's container
      const callerConcepts = allConcepts.get(callSite.callerFile);
      if (!callerConcepts) continue;

      // Find the caller function node
      const callerFnNode = callerConcepts.nodes.find(
        n => n.kind === 'function_declaration' &&
          n.payload.kind === 'function_declaration' &&
          n.payload.name === callSite.callerName,
      );
      if (!callerFnNode) continue;

      // Check if any error_handle exists in the caller's scope
      const callerHandlesErrors = callerConcepts.nodes.some(
        n => n.kind === 'error_handle' && n.containerId === callerFnNode.id,
      );

      if (!callerHandlesErrors) {
        obligations.push({
          id: '',
          type: 'error-handled-by-caller',
          claim: `${fnName} raises errors, but caller ${callSite.callerName} in ${callSite.callerFile} does not handle them. Prove errors are handled elsewhere or cannot occur.`,
          filePath: targetFilePath,
          line: node.primarySpan.startLine,
          evidence_for: [`${fnName} contains throw/reject/error-return`],
          evidence_against: [`${callSite.callerName} has no try/catch or .catch() around the call at L${callSite.line}`],
          suggested_check: `Check if ${callSite.callerName} has error handling that the static analyzer missed, or if a framework-level error boundary catches this.`,
          relatedNodes: [],
        });
      }
    }
  }

  return obligations;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function extractFunctionName(functionId: string): string {
  const hashIdx = functionId.lastIndexOf('#');
  if (hashIdx === -1) return functionId;
  const afterHash = functionId.slice(hashIdx + 1);
  const atIdx = afterHash.lastIndexOf('@');
  if (atIdx === -1) return afterHash;
  return afterHash.slice(0, atIdx);
}

// ── Priority sorting ─────────────────────────────────────────────────────

const TYPE_PRIORITY: Record<ProofObligation['type'], number> = {
  'error-handled-by-caller': 0,
  'sanitizer-sufficient': 1,
  'norm-violation': 2,
};

function sortByPriority(obligations: ProofObligation[]): ProofObligation[] {
  return obligations.sort((a, b) => {
    const pa = TYPE_PRIORITY[a.type];
    const pb = TYPE_PRIORITY[b.type];
    if (pa !== pb) return pa - pb;
    // Within same type, higher prevalence = higher priority
    return (b.prevalence ?? 0) - (a.prevalence ?? 0);
  });
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Synthesize proof obligations from violations, taint, and call graph analysis.
 *
 * @param violations - Norm violations for a specific file
 * @param taintResults - Taint analysis results for the file
 * @param callGraph - Cross-file call graph
 * @param allConcepts - Cross-file concept maps
 * @param filePath - Target file path
 * @returns ProofObligation[] capped at MAX_OBLIGATIONS_PER_FILE, with IDs assigned
 */
export function synthesizeObligations(
  violations: NormViolation[],
  taintResults: TaintResult[],
  callGraph: CallGraph | undefined,
  allConcepts: Map<string, ConceptMap>,
  filePath: string,
): ProofObligation[] {
  const fromNorms = obligationsFromNorms(violations);
  const fromTaint = obligationsFromTaint(taintResults);
  const fromCalls = callGraph
    ? obligationsFromCallGraph(callGraph, allConcepts, filePath)
    : [];

  // Combine, sort by priority, cap
  const all = sortByPriority([...fromCalls, ...fromTaint, ...fromNorms]);
  const capped = all.slice(0, MAX_OBLIGATIONS_PER_FILE);

  // Assign IDs
  for (let i = 0; i < capped.length; i++) {
    capped[i].id = `O${i + 1}`;
  }

  return capped;
}
