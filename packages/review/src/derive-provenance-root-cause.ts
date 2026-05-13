/**
 * Derive a stable `RootCause` from a `ProvenanceChain` so multiple rules
 * firing on the same underlying issue get collapsed by
 * `groupFindingsByRootCause`.
 *
 * Strategy (Codex 6-engine brainstorm consensus, 2026-05-13):
 * group by **K=2 shared causal-prefix**: the first two chain steps'
 * (file, line, col, category|kind). K=1 over-merges unrelated findings that
 * happen to start at the same prop; K=2 captures "source -> mechanism" like
 * `prop -> effect-schedule` or `prop -> closure-capture`. Single-step chains
 * fall back to K=1.
 *
 * Why derived instead of rule-authored: 22 React rules already emit chains;
 * zero set rootCause. Deriving from the chain means rules stay focused on
 * detection. Explicit rootCause (security rules) still wins — see `finding()`.
 */
import type { ProvenanceChain, RootCause } from './types.js';

export function deriveProvenanceRootCause(chain: ProvenanceChain | undefined): RootCause | undefined {
  if (!chain?.steps || chain.steps.length === 0) return undefined;
  const head = chain.steps[0];
  if (!head.category && !head.kind) return undefined;

  const k = Math.min(2, chain.steps.length);
  const parts: string[] = [];
  for (let i = 0; i < k; i++) {
    const s = chain.steps[i];
    const tag = s.category ?? s.kind;
    parts.push(`${s.location.file}:${s.location.startLine}:${s.location.startCol}:${tag}`);
  }
  return {
    kind: 'data-flow',
    key: `provenance:${parts.join('|')}`,
  };
}
