/**
 * Auto-suppress findings whose provenance chain claims a value is UNSTABLE
 * but the value actually comes from a stable React construct (useMemo,
 * useCallback, useRef, or the second-tuple-binding (setter) of useState).
 * The rule's "unstable" claim is provably false in those cases.
 *
 * Strategy (Codex 6-engine brainstorm consensus, 2026-05-13):
 *   - Post-pass, not per-rule. ~22 React rules emit chains; one shared
 *     resolver beats 22 implementations.
 *   - Drop with `suppressionReason='stable-react-construct'` for diagnostics.
 *
 * CRITICAL refinement on top of the brainstorm answer: only trigger when the
 * provenance STEP CATEGORY claims instability (e.g. `hook-dep`,
 * `closure-capture`, `value-decl`). Rules like `ref-in-deps` and
 * `usememo-primitive-cheap` emit chains whose first step DOES land on a
 * stable construct — but their entire premise is "this construct is stable
 * and that's WHY the rule fires." If we self-suppressed on those, we'd
 * silently kill the rules. Step categories let us distinguish "rule cites
 * value as unstable" (suppress on stable) from "rule cites construct as the
 * point of the diagnostic" (never suppress).
 *
 * Scope: single-file. Cross-file chains are a v2 extension.
 */
import { isStableReactConstruct } from './stable-react-constructs.js';
import type { ReviewFinding } from './types.js';

export interface SelfSuppressResult {
  /** Findings that survived. */
  kept: ReviewFinding[];
  /** Findings whose chain step claimed instability against a stable target. */
  suppressed: ReviewFinding[];
}

// Categories whose semantics are "this value is being treated as unstable here."
// When such a step lands on a stable React construct, the rule's claim is wrong.
// Other categories (memo-boundary, ref-decl, effect-schedule) describe the
// construct ITSELF as the subject of the diagnostic — suppressing those would
// kill rules like ref-in-deps / usememo-primitive-cheap that are correctly
// firing on the stable construct by design.
const INSTABILITY_CLAIM_CATEGORIES = new Set<string>([
  'hook-dep',
  'closure-capture',
  'value-decl',
  'prop-pass',
  'prop-decl',
]);

// Rules whose entire premise is "this stable construct is being misused" —
// the chain CORRECTLY lands on a stable target by design. Self-suppress
// would silently kill them. The category filter above catches most cases
// but `hook-dep` is ambiguous (exhaustive-deps uses it to claim "this dep
// is unstable"; ref-in-deps uses it to mean "stable thing in deps array").
// A small denylist disambiguates.
const RULES_THAT_TARGET_STABLE_CONSTRUCTS_BY_DESIGN = new Set<string>([
  'ref-in-deps',
  'usememo-primitive-cheap',
  'usecallback-no-benefit',
]);

export function suppressFindingsOnStableReactConstructs(
  findings: ReviewFinding[],
  sourceCode: string,
  filePath: string,
): SelfSuppressResult {
  const kept: ReviewFinding[] = [];
  const suppressed: ReviewFinding[] = [];

  for (const f of findings) {
    const steps = f.provenance?.steps;
    if (!steps?.length) {
      kept.push(f);
      continue;
    }
    if (RULES_THAT_TARGET_STABLE_CONSTRUCTS_BY_DESIGN.has(f.ruleId)) {
      kept.push(f);
      continue;
    }
    let stableMatch: { kind: string } | undefined;
    for (const step of steps) {
      // Only inspect steps whose category claims instability — see the
      // INSTABILITY_CLAIM_CATEGORIES comment above for why.
      if (!step.category || !INSTABILITY_CLAIM_CATEGORIES.has(step.category)) continue;
      // The in-memory ts-morph project rewrites filePath to /<file>; tolerate
      // either form when matching the chain step back to this report's file.
      const stepFile = step.location.file;
      if (stepFile !== filePath && !stepFile.endsWith(filePath) && !filePath.endsWith(stepFile)) {
        continue;
      }
      const verdict = isStableReactConstruct({
        sourceCode,
        file: filePath,
        line: step.location.startLine,
        col: step.location.startCol,
      });
      if (verdict.stable) {
        stableMatch = { kind: verdict.kind };
        break;
      }
    }
    if (stableMatch) {
      suppressed.push({
        ...f,
        suppressionReason: 'stable-react-construct',
      });
    } else {
      kept.push(f);
    }
  }

  return { kept, suppressed };
}
