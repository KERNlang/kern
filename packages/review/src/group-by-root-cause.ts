/**
 * RootCause grouping (Tier D) — collapse N findings on the same underlying
 * issue into 1 primary + N-1 related-spans entries.
 *
 * Why: an auth file can hit 4-5 security-family rules at once (jwt + cookie +
 * csrf + cors + helmet), all reporting the same root cause. Reviewer sees a
 * cluster of separate findings; in practice it's one issue to fix.
 *
 * Conservative scope: ONLY collapse findings that share an explicit
 * `rootCause.key` (rule author asserted the same underlying cause). An
 * earlier iteration synthesised a key from `(file, line, rule-family)` for
 * findings without rootCause, but that collapsed unrelated same-line rules
 * (e.g. `server-action-form-return-value-ignored` next to a security rule)
 * — when in doubt, keep both findings. Wiring rootCause through more rules
 * is the explicit path to expanding what gets grouped.
 *
 * Strategy:
 *   1. Group by `(rootCause.kind, rootCause.key)` only.
 *   2. Pick the highest-confidence finding as primary. Ties → highest
 *      severity (error > warning > info) → first occurrence.
 *   3. Other group members fold their primarySpan into the primary's
 *      `relatedSpans` and their `ruleId` into a `coveredRules` facet so
 *      the reporter can show "and N more rules covered this issue".
 */

import type { ReviewFinding } from './types.js';

/**
 * Stable grouping key. Returns `undefined` for findings without explicit
 * rootCause — those bypass grouping entirely.
 */
function groupKey(f: ReviewFinding): string | undefined {
  if (!f.rootCause?.key) return undefined;
  return `rc:${f.rootCause.kind}:${f.rootCause.key}`;
}

const SEVERITY_RANK: Record<ReviewFinding['severity'], number> = {
  error: 3,
  warning: 2,
  info: 1,
};

/** Pick the primary finding for a group. Highest confidence wins; ties resolved by severity then by first-seen index. */
function pickPrimary(group: ReviewFinding[]): ReviewFinding {
  let best = group[0];
  for (let i = 1; i < group.length; i++) {
    const f = group[i];
    if (f.confidence > best.confidence) {
      best = f;
      continue;
    }
    if (f.confidence === best.confidence && SEVERITY_RANK[f.severity] > SEVERITY_RANK[best.severity]) {
      best = f;
    }
  }
  return best;
}

/**
 * Collapse findings sharing the same root cause. Returns a new array;
 * input is not mutated. The primary in each group inherits the duplicates'
 * `primarySpan`s into its `relatedSpans` and records the covered ruleIds
 * in `rootCause.facets.coveredRules` for the reporter.
 *
 * Run this AFTER suppression + calibration but BEFORE SARIF / display so
 * the wire payload is already collapsed by the time Sight reads it.
 */
export function groupFindingsByRootCause(findings: ReviewFinding[]): ReviewFinding[] {
  if (findings.length < 2) return [...findings];

  // Bucket findings by groupKey; findings without rootCause have key=undefined.
  const groups = new Map<string, ReviewFinding[]>();
  for (const f of findings) {
    const key = groupKey(f);
    if (key === undefined) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(f);
    else groups.set(key, [f]);
  }

  // Walk the original array preserving order; emit primaries in the slot of
  // their first member, skip subsequent group members.
  const emittedGroups = new Set<string>();
  const out: ReviewFinding[] = [];
  for (const f of findings) {
    const key = groupKey(f);
    if (key === undefined) {
      out.push(f);
      continue;
    }
    if (emittedGroups.has(key)) continue;
    emittedGroups.add(key);

    const group = groups.get(key)!;
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }

    const primary = pickPrimary(group);
    const duplicates = group.filter((dup) => dup !== primary);

    // Fold duplicates' primarySpan AND their own relatedSpans into the
    // merged set (Gemini review) — losing the duplicates' related context
    // would hide the very evidence chain that made them findings. Dedup by
    // location signature so identical spans don't multiply.
    const existingSpans = new Set([
      `${primary.primarySpan.file}:${primary.primarySpan.startLine}:${primary.primarySpan.startCol}`,
      ...(primary.relatedSpans ?? []).map((s) => `${s.file}:${s.startLine}:${s.startCol}`),
    ]);
    const mergedRelated = [...(primary.relatedSpans ?? [])];
    const coveredRules = new Set<string>([primary.ruleId]);
    for (const dup of duplicates) {
      coveredRules.add(dup.ruleId);
      const pushIfNew = (s: typeof dup.primarySpan): void => {
        const sig = `${s.file}:${s.startLine}:${s.startCol}`;
        if (!existingSpans.has(sig)) {
          mergedRelated.push(s);
          existingSpans.add(sig);
        }
      };
      pushIfNew(dup.primarySpan);
      for (const r of dup.relatedSpans ?? []) pushIfNew(r);
    }

    // Augment rootCause with the covered-rules facet so downstream consumers
    // can render "jwt-weak (+3 more rules at this location)" without
    // re-deriving the group.
    const augmentedRootCause = {
      key: primary.rootCause?.key ?? key,
      kind: primary.rootCause?.kind ?? ('unknown' as const),
      facets: {
        ...(primary.rootCause?.facets ?? {}),
        coveredRules: [...coveredRules].sort().join(','),
        groupSize: String(group.length),
      },
    };

    out.push({
      ...primary,
      relatedSpans: mergedRelated.length > 0 ? mergedRelated : undefined,
      rootCause: augmentedRootCause,
    });
  }

  return out;
}
