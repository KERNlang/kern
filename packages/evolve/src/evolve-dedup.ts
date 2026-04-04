/**
 * Evolve Dedup — structural similarity checking for node proposals.
 *
 * Prevents duplicates by checking keyword similarity and prop-schema overlap
 * against existing core and evolved node types.
 */

import type { EvolveNodeProposal } from './evolved-types.js';

/**
 * Check if a proposal is a duplicate of an existing node.
 * Returns true if the proposal is NOT a duplicate (passes the check).
 */
export function checkDedup(proposal: EvolveNodeProposal, existingKeywords: string[]): boolean {
  // Exact keyword match
  if (existingKeywords.includes(proposal.keyword)) return false;

  // Similarity check — keywords that are too close
  for (const existing of existingKeywords) {
    const sim = keywordSimilarity(proposal.keyword, existing);
    if (sim > 0.85) return false;
  }

  return true;
}

/**
 * Normalized Levenshtein similarity between two keywords.
 * Returns 0-1 where 1 = identical.
 */
function keywordSimilarity(a: string, b: string): number {
  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - distance / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[m][n];
}
