/**
 * Norm Miner — discovers implicit coding norms from peer function clusters.
 *
 * Groups function_declaration concepts by their child concept profile (e.g.,
 * "has effect + error_handle" vs "has effect, no error_handle") and flags
 * outliers that violate the majority pattern.
 *
 * Softened peer norms: clusters of 2 are allowed for effect-bearing functions
 * (MIN_CLUSTER_SIZE = 2 for *:effect, 3 for *:pure).
 */

import type { ConceptMap, ConceptNode, ConceptNodeKind } from '@kernlang/core';

// ── Types ───────────────────────────────────────────────────────────────

export interface NormViolation {
  /** The function concept node that violates the norm */
  functionNode: ConceptNode;
  /** Norm that was violated: e.g., "functions with network effect should have error_handle" */
  norm: string;
  /** What the function is missing */
  missingKind: ConceptNodeKind;
  /** How many peers follow the norm */
  peerCount: number;
  /** Prevalence of the norm (0-1) */
  prevalence: number;
  /** Whether this norm was derived from a small cluster (< 3 peers) */
  weakNorm?: boolean;
}

// ── Constants ───────────────────────────────────────────────────────────

/** Minimum cluster size: 2 for effect-bearing functions, 3 for pure */
function minClusterSize(hasEffect: boolean): number {
  return hasEffect ? 2 : 3;
}

/** Minimum prevalence threshold: what fraction of peers must exhibit a pattern */
const MIN_PREVALENCE = 0.75;

/** Concept kinds that define a function's "profile" for clustering */
const PROFILE_KINDS: ConceptNodeKind[] = ['effect', 'error_handle', 'guard', 'error_raise'];

// ── Core ────────────────────────────────────────────────────────────────

/**
 * Build a child-concept profile for a function, matching by containerId prefix.
 * Returns a set of concept kinds that appear as children of this function.
 */
function buildProfileByPrefix(prefix: string, allNodes: ConceptNode[]): Set<ConceptNodeKind> {
  const kinds = new Set<ConceptNodeKind>();
  for (const node of allNodes) {
    if (node.containerId && node.containerId.startsWith(prefix) && PROFILE_KINDS.includes(node.kind)) {
      kinds.add(node.kind);
    }
  }
  return kinds;
}

/**
 * Cluster key: deterministic string encoding which profile kinds are present.
 * We cluster by EFFECT presence (the primary dimension) + effect subtype.
 */
function clusterKey(profile: Set<ConceptNodeKind>, effectSubtype: string | undefined): string {
  const hasEffect = profile.has('effect');
  if (!hasEffect) return 'pure';
  return `effect:${effectSubtype || 'unknown'}`;
}

/**
 * Get the effect subtype for a function (if any), matching by containerId prefix.
 */
function getEffectSubtypeByPrefix(prefix: string, allNodes: ConceptNode[]): string | undefined {
  for (const node of allNodes) {
    if (node.containerId && node.containerId.startsWith(prefix) && node.kind === 'effect' && node.payload.kind === 'effect') {
      return node.payload.subtype;
    }
  }
  return undefined;
}

interface FunctionProfile {
  fnNode: ConceptNode;
  containerId: string;
  profile: Set<ConceptNodeKind>;
  effectSubtype: string | undefined;
}

/**
 * Mine peer norms from a set of concept maps.
 * Clusters functions by their effect profile, then checks whether
 * the majority pattern (e.g., "has error_handle") is violated by outliers.
 */
export function mineNorms(allConcepts: Map<string, ConceptMap>): NormViolation[] {
  const violations: NormViolation[] = [];

  // Collect all function profiles across all files
  const profiles: FunctionProfile[] = [];

  for (const [, concepts] of allConcepts) {
    const fnNodes = concepts.nodes.filter((n: ConceptNode) => n.kind === 'function_declaration');
    for (const fnNode of fnNodes) {
      const fnName = fnNode.payload.kind === 'function_declaration' ? fnNode.payload.name : 'anonymous';
      // getContainerId format: filePath#fn:name@charOffset
      // Match children by prefix: any containerId starting with "filePath#fn:name@"
      const prefix = `${concepts.filePath}#fn:${fnName}@`;
      const profile = buildProfileByPrefix(prefix, concepts.nodes);
      const effectSubtype = getEffectSubtypeByPrefix(prefix, concepts.nodes);

      profiles.push({ fnNode, containerId: prefix, profile, effectSubtype });
    }
  }

  // Group by cluster key
  const clusters = new Map<string, FunctionProfile[]>();
  for (const p of profiles) {
    const key = clusterKey(p.profile, p.effectSubtype);
    const arr = clusters.get(key) || [];
    arr.push(p);
    clusters.set(key, arr);
  }

  // For each cluster, find the majority pattern and flag outliers
  for (const [key, cluster] of clusters) {
    const hasEffect = key !== 'pure';
    const minSize = minClusterSize(hasEffect);
    if (cluster.length < minSize) continue;

    // For each profile kind, count how many functions have it
    for (const kind of PROFILE_KINDS) {
      if (kind === 'effect') continue; // effect is the clustering dimension, skip

      const withKind = cluster.filter(p => p.profile.has(kind));
      let prevalence = withKind.length / cluster.length;

      // Softened norms: multiply prevalence by 0.8 when cluster is small
      if (cluster.length === 2) {
        prevalence *= 0.8;
      }

      if (prevalence < MIN_PREVALENCE) continue;

      // Functions that DON'T have this kind are violating the norm
      const violators = cluster.filter(p => !p.profile.has(kind));
      for (const v of violators) {
        const normDesc = `functions with ${key} should have ${kind}`;
        violations.push({
          functionNode: v.fnNode,
          norm: normDesc,
          missingKind: kind,
          peerCount: withKind.length,
          prevalence,
          weakNorm: cluster.length < 3 ? true : undefined,
        });
      }
    }
  }

  return violations;
}
