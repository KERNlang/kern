/**
 * Norm Miner — discovers behavioral norms from concept clustering, flags deviations.
 *
 * Strategy:
 *   1. Profile each function by its concept nodes (guards, error handling, effects).
 *   2. Cluster profiles by (boundary + hasEffect) — peers that should behave similarly.
 *   3. Compute prevalence of each property within clusters (% that have guards, etc.).
 *   4. Flag functions that deviate from norms with >=70% prevalence.
 *
 * This gives the AI reviewer signal it CANNOT derive from reading source alone:
 * "7/8 peer handlers validate input, but this one doesn't."
 */

import type { ConceptMap, ConceptNode } from '@kernlang/core';
import type { InferResult, FileContext } from './types.js';
import type { CallGraph } from './call-graph.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface NormProfile {
  functionId: string;
  filePath: string;
  boundary: string;
  conceptKinds: Set<string>;
  hasGuard: boolean;
  hasValidation: boolean;
  hasAuth: boolean;
  hasErrorHandle: boolean;
  hasErrorRaise: boolean;
  hasStateMutation: boolean;
  effectSubtypes: Set<string>;
}

export interface NormViolation {
  functionId: string;
  filePath: string;
  line: number;
  norm: string;
  prevalence: number;
  peerCount: number;
  peerExamples: string[];
  violationType: 'missing-guard' | 'missing-error-handle' | 'missing-validation' | 'missing-resource-cleanup' | 'inconsistent-pattern' | 'missing-error-raise';
}

// ── Profile Building ─────────────────────────────────────────────────────

/**
 * Build a NormProfile for each function_declaration concept node.
 * The profile summarizes what concept kinds exist within its container scope.
 */
function buildProfiles(
  allConcepts: Map<string, ConceptMap>,
  fileContextMap: Map<string, FileContext>,
): NormProfile[] {
  const profiles: NormProfile[] = [];

  for (const [filePath, concepts] of allConcepts) {
    // Find all function declarations in this file
    const functionNodes = concepts.nodes.filter(n => n.kind === 'function_declaration');
    if (functionNodes.length === 0) continue;

    // Determine boundary from file context
    const fileCtx = fileContextMap.get(filePath);
    const boundary = fileCtx?.boundary ?? 'unknown';

    for (const fnNode of functionNodes) {
      const fnId = fnNode.id;
      const conceptKinds = new Set<string>();
      let hasGuard = false;
      let hasValidation = false;
      let hasAuth = false;
      let hasErrorHandle = false;
      let hasErrorRaise = false;
      let hasStateMutation = false;
      const effectSubtypes = new Set<string>();

      // Collect all concepts whose containerId matches this function
      for (const node of concepts.nodes) {
        if (node.containerId !== fnId && node.id !== fnId) continue;

        conceptKinds.add(node.kind);

        if (node.kind === 'guard') {
          hasGuard = true;
          if (node.payload.kind === 'guard') {
            const subtype = (node.payload as { kind: 'guard'; subtype: string }).subtype;
            if (subtype === 'validation') hasValidation = true;
            if (subtype === 'auth') hasAuth = true;
          }
        }
        if (node.kind === 'error_handle') hasErrorHandle = true;
        if (node.kind === 'error_raise') hasErrorRaise = true;
        if (node.kind === 'state_mutation') hasStateMutation = true;
        if (node.kind === 'effect' && node.payload.kind === 'effect') {
          effectSubtypes.add(node.payload.subtype);
        }
      }

      profiles.push({
        functionId: fnId,
        filePath,
        boundary,
        conceptKinds,
        hasGuard,
        hasValidation,
        hasAuth,
        hasErrorHandle,
        hasErrorRaise,
        hasStateMutation,
        effectSubtypes,
      });
    }
  }

  return profiles;
}

// ── Clustering ───────────────────────────────────────────────────────────

type ClusterKey = string;

function clusterKey(profile: NormProfile): ClusterKey {
  const hasEffect = profile.effectSubtypes.size > 0;
  return `${profile.boundary}:${hasEffect ? 'effect' : 'pure'}`;
}

function clusterProfiles(profiles: NormProfile[]): Map<ClusterKey, NormProfile[]> {
  const clusters = new Map<ClusterKey, NormProfile[]>();
  for (const p of profiles) {
    const key = clusterKey(p);
    let arr = clusters.get(key);
    if (!arr) {
      arr = [];
      clusters.set(key, arr);
    }
    arr.push(p);
  }
  return clusters;
}

// ── Norm Computation & Violation Detection ───────────────────────────────

const PREVALENCE_THRESHOLD = 0.7;
const MIN_CLUSTER_SIZE = 3;

interface ClusterNorm {
  guardPrevalence: number;
  validationPrevalence: number;
  authPrevalence: number;
  errorHandlePrevalence: number;
  errorRaisePrevalence: number;
  stateMutationPrevalence: number;
  peerCount: number;
}

function computeClusterNorm(cluster: NormProfile[]): ClusterNorm {
  const total = cluster.length;
  return {
    guardPrevalence: cluster.filter(p => p.hasGuard).length / total,
    validationPrevalence: cluster.filter(p => p.hasValidation).length / total,
    authPrevalence: cluster.filter(p => p.hasAuth).length / total,
    errorHandlePrevalence: cluster.filter(p => p.hasErrorHandle).length / total,
    errorRaisePrevalence: cluster.filter(p => p.hasErrorRaise).length / total,
    stateMutationPrevalence: cluster.filter(p => p.hasStateMutation).length / total,
    peerCount: total,
  };
}

function findFunctionLine(
  allConcepts: Map<string, ConceptMap>,
  functionId: string,
  filePath: string,
): number {
  const concepts = allConcepts.get(filePath);
  if (!concepts) return 1;
  const node = concepts.nodes.find(n => n.id === functionId);
  return node?.primarySpan.startLine ?? 1;
}

function extractFunctionName(functionId: string): string {
  // ID format: filePath#function_declaration@offset
  const hashIdx = functionId.lastIndexOf('#');
  if (hashIdx === -1) return functionId;
  const afterHash = functionId.slice(hashIdx + 1);
  const atIdx = afterHash.lastIndexOf('@');
  if (atIdx === -1) return afterHash;
  return afterHash.slice(0, atIdx);
}

function detectViolations(
  clusters: Map<ClusterKey, NormProfile[]>,
  allConcepts: Map<string, ConceptMap>,
): NormViolation[] {
  const violations: NormViolation[] = [];

  for (const [_key, cluster] of clusters) {
    if (cluster.length < MIN_CLUSTER_SIZE) continue;

    const norm = computeClusterNorm(cluster);

    for (const profile of cluster) {
      // Check: guard norm violation
      if (!profile.hasGuard && norm.guardPrevalence >= PREVALENCE_THRESHOLD) {
        const peerExamples = cluster
          .filter(p => p.hasGuard && p.functionId !== profile.functionId)
          .slice(0, 3)
          .map(p => extractFunctionName(p.functionId));

        violations.push({
          functionId: profile.functionId,
          filePath: profile.filePath,
          line: findFunctionLine(allConcepts, profile.functionId, profile.filePath),
          norm: `${Math.round(norm.guardPrevalence * 100)}% of peer ${profile.boundary} handlers have input guards`,
          prevalence: norm.guardPrevalence,
          peerCount: norm.peerCount,
          peerExamples,
          violationType: 'missing-guard',
        });
      }

      // Check: error handling norm violation
      if (!profile.hasErrorHandle && norm.errorHandlePrevalence >= PREVALENCE_THRESHOLD) {
        const peerExamples = cluster
          .filter(p => p.hasErrorHandle && p.functionId !== profile.functionId)
          .slice(0, 3)
          .map(p => extractFunctionName(p.functionId));

        violations.push({
          functionId: profile.functionId,
          filePath: profile.filePath,
          line: findFunctionLine(allConcepts, profile.functionId, profile.filePath),
          norm: `${Math.round(norm.errorHandlePrevalence * 100)}% of peer ${profile.boundary} handlers have error handling`,
          prevalence: norm.errorHandlePrevalence,
          peerCount: norm.peerCount,
          peerExamples,
          violationType: 'missing-error-handle',
        });
      }

      // Check: validation norm violation
      if (!profile.hasValidation && norm.validationPrevalence >= PREVALENCE_THRESHOLD) {
        const peerExamples = cluster
          .filter(p => p.hasValidation && p.functionId !== profile.functionId)
          .slice(0, 3)
          .map(p => extractFunctionName(p.functionId));

        violations.push({
          functionId: profile.functionId,
          filePath: profile.filePath,
          line: findFunctionLine(allConcepts, profile.functionId, profile.filePath),
          norm: `${Math.round(norm.validationPrevalence * 100)}% of peer ${profile.boundary} handlers validate input`,
          prevalence: norm.validationPrevalence,
          peerCount: norm.peerCount,
          peerExamples,
          violationType: 'missing-validation',
        });
      }

      // Check: auth norm violation
      if (!profile.hasAuth && norm.authPrevalence >= PREVALENCE_THRESHOLD) {
        const peerExamples = cluster
          .filter(p => p.hasAuth && p.functionId !== profile.functionId)
          .slice(0, 3)
          .map(p => extractFunctionName(p.functionId));

        violations.push({
          functionId: profile.functionId,
          filePath: profile.filePath,
          line: findFunctionLine(allConcepts, profile.functionId, profile.filePath),
          norm: `${Math.round(norm.authPrevalence * 100)}% of peer ${profile.boundary} handlers check auth`,
          prevalence: norm.authPrevalence,
          peerCount: norm.peerCount,
          peerExamples,
          violationType: 'missing-guard',
        });
      }

      // Check: error raise consistency (silent failure detection)
      if (!profile.hasErrorRaise && norm.errorRaisePrevalence >= PREVALENCE_THRESHOLD) {
        const peerExamples = cluster
          .filter(p => p.hasErrorRaise && p.functionId !== profile.functionId)
          .slice(0, 3)
          .map(p => extractFunctionName(p.functionId));

        violations.push({
          functionId: profile.functionId,
          filePath: profile.filePath,
          line: findFunctionLine(allConcepts, profile.functionId, profile.filePath),
          norm: `${Math.round(norm.errorRaisePrevalence * 100)}% of peer ${profile.boundary} handlers throw on failure`,
          prevalence: norm.errorRaisePrevalence,
          peerCount: norm.peerCount,
          peerExamples,
          violationType: 'missing-error-raise',
        });
      }

      // Check: state mutation outlier (this function mutates state but peers don't)
      if (profile.hasStateMutation && (1 - norm.stateMutationPrevalence) >= PREVALENCE_THRESHOLD) {
        const peerExamples = cluster
          .filter(p => !p.hasStateMutation && p.functionId !== profile.functionId)
          .slice(0, 3)
          .map(p => extractFunctionName(p.functionId));

        violations.push({
          functionId: profile.functionId,
          filePath: profile.filePath,
          line: findFunctionLine(allConcepts, profile.functionId, profile.filePath),
          norm: `${Math.round((1 - norm.stateMutationPrevalence) * 100)}% of peer ${profile.boundary} handlers don't mutate state`,
          prevalence: 1 - norm.stateMutationPrevalence,
          peerCount: norm.peerCount,
          peerExamples,
          violationType: 'inconsistent-pattern',
        });
      }
    }
  }

  return violations;
}

// ── Public API ───────────────────────────────────────────────────────────

export interface MineNormsResult {
  profiles: NormProfile[];
  violations: NormViolation[];
}

/**
 * Mine behavioral norms from cross-file concept maps and flag deviations.
 *
 * @param allConcepts - Map of filePath → ConceptMap for all files in the graph
 * @param inferredPerFile - Map of filePath → InferResult[] (for future enrichment)
 * @param fileContextMap - Map of filePath → FileContext (boundary classification)
 * @param callGraph - Optional call graph (for future enrichment)
 * @returns Profiles and violations
 */
export function mineNorms(
  allConcepts: Map<string, ConceptMap>,
  _inferredPerFile: Map<string, InferResult[]>,
  fileContextMap: Map<string, FileContext>,
  _callGraph?: CallGraph,
): MineNormsResult {
  const profiles = buildProfiles(allConcepts, fileContextMap);
  const clusters = clusterProfiles(profiles);
  const violations = detectViolations(clusters, allConcepts);

  return { profiles, violations };
}
