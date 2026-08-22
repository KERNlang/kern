# KERN 5 F4 M3.2 — A8 Mutation Closure

**Status:** SPEC — READY FOR RED
**Date:** 2026-08-22
**Baseline:** `48ed9ed150501c03be100072185388da886ce271`
**Confidence:** 0.93

## Objective

Close F4-A8 with an executable, attributed mutation ledger. Every claimed
family gets one positive control, one deliberate defect, one designated killer,
and evidence that the mutated boundary was reached. A crash, unsupported
runtime input, generic exception, earlier unrelated validator, or static string
match alone cannot count as a kill.

This is an evidence slice. It changes no production KERN, policy bytes, public
worker exports, receipt format, or prerequisite frontend. A surviving mutant
is a separately traced production defect and stops this slice before any fix.

## Grounded State

**[A8-R1 VERIFIED]** The parent contract leaves F4-A8 proposed and names nine
families: prerequisite forgery, semantic host delegation, shadow-receipt
consumption, catalog omission, constant output, partial failure, post-hoc
sorting, hardcoded limits, and seal drift. Evidence:
`.Codex/specs/kern-5-f4-declarations-modules/spec.md:1441-1444`.

**[A8-R2 VERIFIED]** Existing tests kill representative authority and
prerequisite mutations, but do not form one nine-family attribution ledger.
Evidence: `authority.test.mjs`, `document.test.mjs`,
`a1-a2-a11-evidence.test.mjs`, `a4-decorator-closure.test.mjs`, and
`a6-detached-closure.test.mjs`.

**[A8-R3 VERIFIED]** F4B already has a source-backed independent graph oracle
and twenty request-order permutations. Evidence: `m2-reference-graph.mjs` and
`m2-canonical-graph.test.mjs:336-343`.

**[A8-R4 VERIFIED]** The document worker can capture the authentic 109-argument
F4A vector through the private `runDocumentWithTestInput` seam. The module-set
worker exposes the authentic 18-argument F4B vector through its private
`observe({stage: "f4b", args})` hook. Neither seam changes a public entry point.

**[A8-R5 VERIFIED]** The policy authenticates five authority files, four
prerequisite policy files, and every ordered composition source. The authority
generator has a pure `renderAuthority` function suitable for stale-generation
tests. Evidence: `policy.json`, `policy-validation.mjs`, and
`generate-authority.mjs`.

**[A8-R6 VERIFIED]** M3.1 added a direct real-KERN verifier seam and structural
guards for count, bytes, work, cursor, producer admission, and consumer width.
Evidence: `c13-global-facts.test.mjs`, `c13-local-facts.test.mjs`, and
`worker.mjs.__test.runGlobalFactVerify`.

## Execution Model

The test harness may execute an in-memory mutated KERN composition, but it must
not modify repository files, import a shadow oracle as production input, or
fabricate a decoded receipt.

For each runtime mutation:

1. select a family-specific public source/module set that reaches the target;
2. capture the authentic F4A 109-vector or F4B 18-vector from an unmodified
   public/private-test execution;
3. clone the vector and the ordered policy-pinned composition;
4. apply exactly one bounded source mutation whose original text occurs once;
5. execute the real runtime handler exactly once with the cloned vector;
6. require a successful, event-free runtime envelope and returned list;
7. attribute the returned fields with the designated decoder or independent
   oracle; and
8. discard all per-run state before the next mutant.

Every target also has a paired sentinel control at the same source coordinate.
The sentinel must observably change the expected field or branch without
introducing the defect. If the sentinel is not observed, the fixture did not
reach the target and the mutation result is invalid.

Runtime failure, `unsupported-runtime-input`, handler-link failure, thrown host
error, missing capture, mutation no-op, multiple source replacements, or an
unexpected diagnostic is a harness failure. None is an acceptable kill.

### Bounded implementation slices

The executable ledger is implemented in three independently attributable
sub-slices. A sub-slice must pass before the next one begins; aggregate support
must not hide a failing family behind a synthesized report.

1. **A8.1 source ownership:** F2 and F3 plus their bounded source-structure
   canaries. This slice performs no F4 runtime mutation and reports
   `not-applicable` only after the pristine and mutant source scans both prove
   target reachability.
2. **A8.2 document runtime:** F1, F4, F5, F6, F8, F9, the six C13 claim
   mutations, composition skew, and stale generated authority. Every runtime
   family captures its own authentic ABI-109 vector and executes exactly one
   mutated F4A root call.
3. **A8.3 module-set runtime:** F7, twenty deterministic permutations, and the
   M2 independent-oracle canaries. It captures authentic ABI-18 input for the
   exact graph fixture and executes one mutated F4B root call.

The registry aggregator only concatenates the three verified reports in ID
order and validates uniqueness. Each support module remains below 500
handwritten lines. A failed aggregate Forge candidate is evidence to narrow
the implementation slice, never permission to weaken the designated killer.

## Designated Kill Matrix

| ID | Family | One deliberate defect | Positive/reachability control | Designated killer |
| --- | --- | --- | --- | --- |
| A8-F1 | prerequisite forgery | Change one authenticated F2B segment span in the real 109-vector | Same source/vector unmodified reaches classified F4A once | Atomic `F4_F2B_DRIFT`, no ordinary partitions |
| A8-F2 | semantic host delegation | Inject one forbidden host/bootstrap semantic classifier token into a synthetic copy of the F4 ownership source | The original composition has no forbidden token and the scanner rejects a renamed-token canary | Source-ownership rejection naming the forbidden classifier |
| A8-F3 | shadow receipt consumption | Insert one `kern.frontend.*-shadow.*` dependency into a synthetic F4 composition import/call site | Original F4 source closure is shadow-free; a same-position benign marker is accepted by the scanner | Source-closure rejection naming the shadow dependency |
| A8-F4 | catalog omission | Remove exactly the final generated keyword-authority row from an in-memory composition while retaining the complete authenticated input vector | Pristine composition classifies; paired last-row substitution reaches the frozen comparison | Atomic `F4_AUTHORITY_DRIFT` |
| A8-F5 | constant output | Replace the F4A terminal return at one exact site with the captured result for fixture A, then execute distinct fixture B | Pristine A and B have independently derived, unequal semantic subsets; sentinel changes one nonsemantic marker only | Independent source-backed oracle mismatch while runtime and decoder remain successful |
| A8-F6 | partial failure | Change exactly one `f4fatal` ordinary partition from empty to one well-framed row | Pristine forced-late-failure is a decodable atomic fatal; sentinel changes only the fatal code | Strict decoder rejects fatal ordinary-partition leakage |
| A8-F7 | post-hoc sorting | Reverse exactly one canonical F4B emitted ordered family after graph construction | Pristine output equals the M2 reference for the same captured 18-vector; sentinel swaps a known unequal pair | Independent M2 reference mismatch with successful runtime/decoder |
| A8-F8 | hardcoded limits | Replace one policy-supplied fact or output cap at its use site with a literal that admits the cap-plus-one fixture | Pristine exact-cap passes and cap-plus-one returns atomic `F4_LIMIT`; sentinel uses an equivalent expression | Resource differential plus source-canary rejection of the literal |
| A8-F9 | seal drift | Change exactly one terminal/seal coordinate while leaving all source-backed rows unchanged | Pristine raw result decodes; sentinel mutates and recomputes the corresponding source-backed value | Strict decoder rejects terminal/seal mismatch |

The nine IDs are exhaustive and unique. Tests compute the set of registered IDs
at runtime and exact-compare it with `A8-F1` through `A8-F9`; prose does not
stand in for registry coverage.

## Additional M3.2 Controls

**[A8-C1 DECIDED] Document-set permutation.** At least twenty deterministic
permutations of one closed F4B `.4` set must equal the independent M2 reference
and the canonical public result. Generated/attempted counts are equal. The
existing M2 method may be reused, but M3.2 cites and runs one named gate rather
than copying its oracle.

**[A8-C2 DECIDED] Composition and policy skew.** Changing any one composition
byte without its descriptor rejects in `loadComposition` before runtime.
Changing only the descriptor to match a mutant is permitted solely inside the
in-memory mutation runner and must never write `policy.json`.

**[A8-C3 DECIDED] Stale generated authority.** A cloned constitution or keyword
catalog mutation must make `renderAuthority(mutated, policy)` differ from the
checked-in authority while the pristine render remains byte-identical. This is
the designated stale-generation kill; it does not regenerate repository files.

**[A8-C4 DECIDED] C13 claims.** Direct real-KERN probes independently mutate:

- outer cursor progress/trailing bytes;
- inner arity five and seven;
- claimed count;
- claimed UTF-8 bytes;
- claimed producer work; and
- simultaneous malformed state plus a claimed limit.

Each returns `drift`; a valid exact control returns `ok`, and an exact work
crossing returns `limit`. Runtime envelope failure is not accepted.

**[A8-C5 DECIDED] Oracle self-kills.** The independent oracle must reject, in
isolation, constant output, one omitted row, one reordered unequal pair, and
one duplicated work debit. Each canary has a pristine positive control.

**[A8-C6 DECIDED] Existing exhaustive authority evidence.** M3.2 does not add a
second 1,451-row loop. The final complete F4 wall already executes the existing
exhaustive A2 matrix. The focused A8 gate re-runs one first-row and one final-row
representative with exact attribution, then the complete wall supplies the
full inventory evidence.

## Source Ownership Guard

The source-canary gate reads every ordered F4 composition source and the public
worker/module-set worker. It rejects:

- host/bootstrap parsing or semantic classification calls;
- any production `kern.frontend.*-shadow.*` dependency;
- host-side sorting of F4A semantic rows or F4B canonical rows;
- hardcoded operational cap literals at policy-use sites;
- a catalog loop not bounded by its authenticated array length;
- direct constant terminal output outside the frozen fatal helper; and
- test mutation hooks outside `__test` or test-support modules.

The scanner must use bounded source structure, not a single broad regex.
Renamed variables remain valid; deleted guards, moved mutations, borrowed
names, comments containing forbidden tokens, and unreachable synthetic blocks
have positive and negative canaries.

## Files

| Path | Action |
| --- | --- |
| `.Codex/specs/kern-5-f4-m3-a8-mutation-closure/spec.md` | add this contract |
| `scripts/kern-frontend-f4-declarations/a8-test-support.mjs` | add authentic capture, isolated one-change runner, attribution helpers |
| `scripts/kern-frontend-f4-declarations/a8-document-mutations.test.mjs` | add F4A F1-F6/F8/F9 and C13 controls |
| `scripts/kern-frontend-f4-declarations/a8-module-set-mutations.test.mjs` | add F4B F7, permutations, policy skew, independent oracle |
| `scripts/kern-frontend-f4-declarations/a8-source-canaries.test.mjs` | add F2/F3 ownership and structural mutation guards |

No production KERN, policy, decoder, public export, F0-F3 source, generated
authority, fitness policy, or terminal gate is in the planned allowlist.

## RED Phase

The initial RED may fail only because a designated mutant survives or because
an attribution control proves an existing oracle is non-discriminating. Setup,
missing build artifacts, invalid test descriptors, unsupported runtime input,
generic exceptions, or an unreachable target are not semantic REDs and stop
the phase for harness correction.

Before any mutation is counted:

- the pristine public fixture passes;
- the paired sentinel proves the target is reached;
- the source replacement count is exactly one;
- the runtime envelope is successful/event-free where runtime is required;
- the designated failure class is exact; and
- unrelated failure classes are explicitly rejected.

## Acceptance

- [ ] A8-A1: registry IDs are exactly `A8-F1` through `A8-F9`.
- [ ] A8-A2: every family has one defect, one positive control, one reachable
      sentinel, and one exact designated killer.
- [ ] A8-A3: no runtime crash or generic error counts as a kill.
- [ ] A8-A4: F4A captures use authentic ABI 109; F4B captures use authentic
      ABI 18; no vector is reused for an unreachable family.
- [ ] A8-A5: constant, omission, reorder, and duplicated-work canaries kill
      the independent oracle.
- [ ] A8-A6: C13 cursor/arity/count/bytes/work mutations return exact drift;
      exact control and work-limit control remain distinct.
- [ ] A8-A7: composition skew and stale authority generation reject without
      changing repository files.
- [ ] A8-A8: canonical F4B output is invariant across at least twenty
      deterministic document permutations and equals the M2 reference.
- [ ] A8-A9: production worker exports, `.2`/109/17, `.4`/18/10, policy `.4`,
      F0-F3, and generated authority bytes remain unchanged.
- [ ] A8-A10: focused A8, complete F4, lint, repository consistency, exact
      pins, deterministic authority, and automatic-risk Agon review pass.
- [ ] A8-A11: every new handwritten file is below 500 lines.
- [ ] A8-A12: M3.2 does not promote F4 or the terminal frontend gate and does
      not push the partial M3 feature.

## Kill Switches

Stop and redesign if any implementation requires:

1. a production mutation hook or public worker option;
2. treating an exception or runtime-envelope failure as a mutation kill;
3. one captured input for targets it does not reach;
4. two deliberate defects in one mutant;
5. changing production/policy bytes merely to expose attribution;
6. replacing the independent oracle with equality to the mutated output;
7. skipping a generated or attempted mutant;
8. writing an in-memory mutant or cloned policy back to disk;
9. duplicating the exhaustive 1,451-row matrix in the focused A8 gate; or
10. promoting F4, releasing, tagging, publishing, or deploying.

## Corrections Log

| Earlier proposal | Correction | Impact |
| --- | --- | --- |
| One ABI109 vector can drive the full matrix. | F4B and branch-specific families need authentic fixture-specific captures. | Capture per family and require a paired reachability sentinel. |
| Any mutant rejection is a kill. | Runtime panic or an earlier unrelated guard is a false attribution. | Require successful envelopes and an exact designated killer. |
| Existing citations can replace live A8 mutants. | Parent A8 explicitly requires the nine-family mutation matrix. | Cite existing evidence only as controls; register all nine families live. |
| Repeat the full authority matrix inside A8. | The root full F4 wall already executes it. | Focused A8 re-runs attributed endpoints; cumulative wall supplies exhaustive coverage. |
| In-memory composition execution shares mutable module state. | KERN composition is an immutable source string passed to a fresh synchronous runtime call. | Clone args/source per run and reject event/state bleed explicitly. |
