# KERN 5 F4 M3 A10 Acceptance and Promotion

**Status:** READY TO BUILD — ACCEPTANCE EVIDENCE PENDING

**Baseline:** `e10fc859`

**Scope:** F4-A10, parent F4 acceptance truth, and promotion of the completed
F4 declarations/module-set slice as a current nonterminal internal oracle.
F5-F7, the terminal `kern-frontend` gate, publication, tagging, and release
remain out of scope.

## Objective

Close F4-A10 only after the focused frontend prerequisites, F4 wall, runtime
ABI, canonicalizer, checker, formatter, lint, repository contract, cumulative
KERN 5 fitness wall, and independent review pass on one exact candidate.
Register that accepted slice consistently in the fitness policy, root
infrastructure wall, support matrix, parent F4 spec, and completion goal.

## Evidence Baseline

- **[A10-E1 VERIFIED]** Root `package.json` already exposes
  `test:kern-frontend-f4-declarations`, but `test:infra` stops after F3 before
  checker/formatter.
- **[A10-E2 VERIFIED]** `scripts/kern-5-fitness-policy.json` has 59 current and
  six planned gates. It has no F4 declarations entrypoint or current gate.
- **[A10-E3 VERIFIED]** `docs/kern-5-support-matrix.md` ends the current
  frontend-slice rows at F3 and keeps the terminal `kern-frontend` row
  `not-shipped`.
- **[A10-E4 VERIFIED]** The terminal ledger has exactly two current and six
  planned rows. F4 acceptance cannot change that ledger because F4 remains an
  internal oracle below the complete frontend boundary.
- **[A10-E5 VERIFIED]** The accepted A9 candidate passed focused A9 `41/41`
  and complete F4 `550/550`; A10 must still prove the cumulative exact
  candidate and may not reuse those results as substitutes for other gates.

## Decided Contract

### Promotion boundary

- **[A10-C1 DECIDED]** Add policy entrypoint
  `test:kern-frontend-f4-declarations` with the exact root command already in
  `package.json`.
- **[A10-C2 DECIDED]** Add current gate
  `kern-frontend-f4-declarations` immediately after
  `kern-frontend-f3-line-tree` and before `kern-checker`.
- **[A10-C3 DECIDED]** Add the same current gate row to the marked support
  matrix and add an ownership row with status `internal-oracle` and evidence
  `pnpm test:kern-frontend-f4-declarations`.
- **[A10-C4 DECIDED]** Insert `pnpm test:kern-frontend-f4-declarations` in
  `test:infra` immediately after F3 and before checker. No second F4 alias or
  terminal frontend script is introduced.
- **[A10-C5 DECIDED]** The general fitness gate count becomes 60 current plus
  six planned, 66 total. The terminal ledger remains exactly 2/8 current and
  the six terminal planned scripts remain absent. The 60/66 count is inventory
  coverage, not delivery percentage, release readiness, or evidence that any
  terminal ownership boundary is complete.

### Acceptance truth

- **[A10-C6 DECIDED]** Parent F4-A3 advances to implemented/verified using the
  landed A3a normalization and A3b public F1-to-F4 source-form evidence. F4-A9
  advances to implemented/verified using the authenticated live scale walls.
- **[A10-C7 DECIDED]** Parent F4-A10 advances only after every command in the
  gate plan below passes on the final candidate and the required independent
  review has no unresolved verified blocker.
- **[A10-C8 DECIDED]** The completion goal records M3 and F4 as locally
  accepted/promoted internal-oracle work, changes all-gate coverage to 60/66,
  and keeps the terminal ledger 2/8, F5-F7, canonical cutover, packed release,
  publication, and KERN 5 completion open.
- **[A10-C9 DECIDED]** This slice does not change F4 policy/document/module-set
  formats, F4A/F4B ABIs, production KERN, decoders, generated authority, F0-F3,
  or the terminal remaining-gates ledger.

### Gate plan

- **[A10-C10 DECIDED]** The focused frontend chain is:
  `test:kern-frontend-f1`, `test:kern-frontend-f1-scan`,
  `test:kern-frontend-f2-expression`, `test:kern-frontend-f2-batch`,
  `test:kern-frontend-f3-line-tree`, and
  `test:kern-frontend-f4-declarations`.
- **[A10-C11 DECIDED]** Adjacent product/runtime gates are:
  `test:runtime-abi`, `test:kern-canonicalizer`, `test:kern-checker`,
  `test:kern-formatter`, `lint`, `build`, repository consistency, exact F4
  descriptor/hash validation, and deterministic authority regeneration.
- **[A10-C12 DECIDED]** After the promotion diff is final, run
  `test:kern-5-fitness` and then `fitness:kern-5`. The latter is the cumulative
  acceptance wall and must execute the newly current F4 gate through
  `test:infra`, including the full A11 evidence carried by the F4 root glob.
- **[A10-C13 DECIDED]** Run post-gate independent review using automatic risk
  routing with the actual primary implementer identity. If registry routing is
  stale, stop that receipt and use the current resolved non-excluded roster;
  do not silently accept a shrunken panel.
- **[A10-C14 DECIDED]** “Accepted” and “current” establish a mandatory
  regression boundary; they do not make the F4 representation immutable. If
  F5 exposes a verified missing F4 fact or an accepted core refactor changes
  the shared boundary, reopen the smallest affected F4 contract in a new
  reviewed slice while preserving the current gate.

## RED Matrix

- **[A10-R1 RED]** Fitness tests require 60 current and six planned gates.
- **[A10-R2 RED]** Fitness tests require the exact F4 entrypoint and current
  gate immediately after F3.
- **[A10-R3 RED]** Fitness tests require `test:infra` to execute F4 between F3
  and checker.
- **[A10-R4 RED]** Fitness tests require matching marked gate and ownership
  matrix rows.
- **[A10-R5 RED]** The terminal ledger and absent planned terminal scripts stay
  unchanged; a mutation that promotes terminal `kern-frontend` still rejects.
- **[A10-R6 RED]** Parent/goal text must not call A3, A9, A10, M3, or F4 open
  after the final gate receipt, and must not call F5-F7 or KERN 5 complete.

## Files and Blast Radius

- `.Codex/specs/kern-5-f4-m3-a10-acceptance-promotion/spec.md`
- `.Codex/specs/kern-5-f4-declarations-modules/spec.md`
- `.Codex/goals/KERN-5-COMPLETION-GOAL.md`
- `scripts/kern-5-fitness-policy.json`
- `scripts/kern-5-fitness.test.mjs`
- `docs/kern-5-support-matrix.md`
- `package.json`

No production source file should change. If a gate exposes a production defect,
freeze the acceptance slice, root-cause it independently, and authorize a
separate focused fix before resuming A10.

## Implementation Sequence

1. Commit this reviewed specification alone.
2. Add and execute the RED fitness assertions without altering production or
   policy.
3. Apply the atomic policy/package/matrix promotion and make the focused
   fitness suite green.
4. Run the complete A10 gate plan on the exact final candidate.
5. Update parent/goal evidence truth with exact results, run independent review,
   commit granularly, fetch/reconcile `origin/main`, and push once.

## Kill Conditions

Stop and redesign if any change:

- promotes or creates `test:kern-frontend`;
- changes the terminal remaining-gate ledger;
- changes F4 formats, ABIs, production KERN, decoder, or generated authority;
- bypasses or removes any current gate to make cumulative fitness pass;
- claims release, tag, publication, canonical cutover, or KERN 5 completion;
- treats 60/66 as a release percentage or terminal delivery claim;
- leaves an unresolved verified review blocker or a required gate without an
  exact successful receipt.
