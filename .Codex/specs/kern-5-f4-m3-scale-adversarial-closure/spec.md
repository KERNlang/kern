# KERN 5 F4 M3 — Scale and Adversarial Closure

**Status:** IMPLEMENTED AND VERIFIED — F4 CURRENT INTERNAL ORACLE
**Date:** 2026-08-22
**Baseline:** `195d8cac445bdd42e428595443a781d24d7a73ca`
**Confidence:** 0.92

## Executive Summary

M3 completes the remaining F4 acceptance surface without promoting the terminal
frontend gate. It is one acceptance milestone implemented as four attributable
sub-slices, preceded by a local RED-only oracle phase:

1. M3.0 builds discriminating RED oracles and corpus/gate attestations.
2. M3.1 closes C13-GLOBAL imported expression/path fact admission.
3. M3.2 closes the full F4-A8 adversarial mutation matrix.
4. M3.3 closes F4-A9 density, work, time, RSS, and envelope walls.
5. M3.4 runs the cumulative F4-A10 acceptance wall and independent review.

The slices may commit independently, but M3 is accepted only when all five
phases pass together on one candidate. That cumulative acceptance is now
complete and F4 is current as an internal oracle; terminal frontend promotion
remains M5 work.

## Current State and Root Cause

**[M3-R1 VERIFIED — BASELINE]** The parent F4 contract left only F4-A8, F4-A9, and
F4-A10 proposed. M3 also owns C13-GLOBAL imported expression/path fact
admission. Evidence: `.Codex/specs/kern-5-f4-declarations-modules/spec.md:1441-1451`,
`.Codex/goals/KERN-5-COMPLETION-GOAL.md:153-160`, and
`.Codex/specs/kern-5-f4-m1-1-c13-closure/spec.md:54-58`.

**[M3-R2 VERIFIED]** The expression consumer currently calls
`f4framedtapeparts(expressionResult[3], 6)`, retains every returned outer frame,
then increments fact bytes/count and only afterward adds
`expressionResult[10]` to root work. The path consumer repeats that sequence for
`pathBindings[2]`, then adopts `[3]` and `[4]`. Evidence:
`examples/kern-frontend/f4-declarations-semantic-tail.kernpart:75-96,131-150`.

**[M3-R3 VERIFIED]** `f4framedtapeparts` materializes the complete input tape
as an array before any global fact cap decision. It advances a cursor and checks
row arity, but it is not prospective admission. Evidence:
`examples/kern-frontend/f4-line-eligibility.kern:260-278`.

**[M3-R4 VERIFIED]** The expression producer creates invalid-expression facts
with growing `f4append` at its current source lines 424-425, 438-439, and
475-476. The path producer does the same for invalid-import-path at current
lines 203-206. Consumer-only repair would leave those allocations outside the
prospective boundary. Evidence: `examples/kern-frontend/f4-expression-evidence.kern`
and `examples/kern-frontend/f4-path-contract.kern` at baseline.

**[M3-R5 VERIFIED]** C13-LOCAL already has the required per-row primitive:
`f4eligibilityleafadmit` validates arity, constructs the exact outer `i<len>:`
frame, measures its UTF-8 bytes, and checks prospective count, bytes, then work
before returning a retainable part. Evidence:
`examples/kern-frontend/f4-line-eligibility.kern:236-258`.

**[M3-R6 VERIFIED]** Both producer helpers have exactly one call site, in the
semantic tail. Their result tuples are composition-private and may gain trailing
state slots without changing the 109-input F4 root, the 17-field document, or
either public worker API. Evidence: `rg -n "f4expressionevidence\\(|f4pathbindings\\(" .`
on 2026-08-22 returned only each definition and the semantic-tail call.

**[M3-R7 VERIFIED]** The KERN terminal field authenticates status, output-tape
scalar lengths, and expression aggregates, but not the separate document
`workSteps` field. The decoder-derived receipt hash is `sha256(fields)`, so it
already commits to all 17 fields including `workSteps`; F4B transports that
receipt hash. M3 must not change the terminal field shape to solve an already
covered identity problem. Evidence:
`examples/kern-frontend/f4-declarations-helpers.kern:360-380`,
`scripts/kern-frontend-f4-declarations/decoder.mjs:345-402`, and
`scripts/kern-frontend-f4-declarations/module-set-worker.mjs`.

**[M3-R8 VERIFIED]** The root F4 command builds core and executes the complete
`scripts/kern-frontend-f4-declarations/*.test.mjs` glob. `test:infra` excludes
F4 because the terminal frontend gate is still planned. M3.0 must attest the
focused root glob without prematurely adding F4 to the promoted fitness wall.
Evidence: root `package.json` scripts on 2026-08-22 and the current goal ledger.

**[M3-R9 VERIFIED]** F2B authentication completes before F4 semantic
projection: `f4f2bdrift` recomputes and exact-compares the complete ten-field
batch before `classifyf4available` runs. Producer fact limits therefore cannot
mask later prerequisite drift. Evidence:
`examples/kern-frontend/f4-declarations-main.kern:150-187` and
`examples/kern-frontend/f4-declarations-helpers.kern:219-246`.

## What Already Works

- M1 owns the bounded F4A semantic matrix, including all 26 canonical keyword
  forms, decorators, property provenance, detached closure, and expression
  aggregate evidence.
- M2 owns canonical F4B `.4` R/T/V, SCCs, sourced cycle facts, normalized
  bindings, deterministic ordering, and charged output construction.
- C13-LOCAL prospectively admits all eight facts constructed directly in F4A.
- The F4 policy authenticates five authorities, four prerequisite policies,
  and all composition sources before execution.
- Public contracts are stable: policy `.4`, document `.2`/ABI 109/17 fields,
  and module-set `.4`/ABI 18/10 fields.

## Contract

> Verified against the exact M2 baseline on 2026-08-22.

| Boundary | Required M3 behavior | Evidence / tag |
| --- | --- | --- |
| Expression facts | Producer-owned prospective admission; root-owned one-pass verification and state reconciliation | M3-R2–R6, VERIFIED |
| Path facts | Same contract as expression facts, with authority drift vocabulary | M3-R2–R6, VERIFIED |
| F2B precedence | Authenticated prerequisite drift before semantic/global fact limits | M3-R9, VERIFIED |
| Fact bytes | Field-local sum of exact outer framed UTF-8 bytes | C13-GLOBAL parent contract, VERIFIED |
| Work | Exact producer semantic work + fact admission + bounded tape fold + root verification + final fact fold, each charged once | DECIDED |
| Document identity | `.2`, ABI 109, 17 result fields unchanged | policy validator and decoder, VERIFIED |
| Module-set identity | `.4`, ABI 18, ten result fields and M2 graph semantics unchanged | policy validator and M2 spec, VERIFIED |
| Policy | `.4`; limits remain policy-owned | `policy.json` and validator, VERIFIED |
| Promotion | No terminal frontend promotion during M3 | goal M5 dependency, VERIFIED |

## Implementation Decision

### Rejected option A — one atomic M3 patch

Semantic admission, mutation resistance, scale evidence, and cumulative gate
promotion have different falsifiers. A single aggregate green cannot identify
which contract carried the result and permits scale walls to mask semantic
failure.

### Rejected option B — consumer-only streaming

Replacing `f4framedtapeparts` in the semantic tail would bound final retention
but leave both producers constructing potentially large fact tapes through
repeated growing-prefix concatenation before the consumer sees them.

### Rejected option C — producer-only admission

An authenticated producer still needs an independent root check of returned
framing, arity, reported counts/bytes, and work deltas. Otherwise a stale or
partially edited composition can publish inconsistent state.

### Chosen option — producer admission plus consumer verification

This is a synchronous, single-invocation KERN composition. “Producer” and
“consumer” name ordered helper calls in one portable evaluator execution; they
do not introduce workers, concurrency, retries, speculative dispatch, shared
mutable accounting, ring buffers, or asynchronous rollback. Every counter,
part array, and verification cursor is handler-local scalar/list state. No
pointer, padding, epoch token, capability mask, host object, or ABI side channel
is permitted. The only cross-helper state is the explicit private scalar tuple
described below.

Add a small KERN source containing a searchable six-field global admission
operation. It may delegate to `f4eligibilityleafadmit`, but it owns the M3
contract name and exact five-slot result:

`[status, nextFactCount, nextFactBytes, nextWorkSteps, framedPart]`.

Both producers receive the current root fact count, fact bytes, root work, and
the three root caps. Every produced six-field fact must:

1. validate the row before any limit verdict;
2. compute its exact outer frame and UTF-8 size;
3. check prospective count, bytes, and work;
4. retain the returned frame only for `ok`; and
5. accumulate retained parts with `f4balancedtapefold`, never `f4append`.

The expression tuple retains slots `0..10` and appends absolute fact count,
fact bytes, and work at slots `11..13`. The path tuple retains slots `0..4` and
appends the same absolute state at slots `5..7`. These are private composition
interfaces; public receipt fields remain unchanged.

The pre-M3 terminal tuples remain valid only at their exact legacy widths:
expression width `11` and path width `5`. A legacy-width tuple must have status
`drift` or `limit`; any other status or width is authority drift. A full-width
tuple (expression `14`, path `8`) is always verified before its status is
honored. The root must decide the width before indexing an appended slot.

Producer-local work slots `[10]` and `[4]` remain independently meaningful.
The absolute returned work must equal:

`base root work + producer-local work + admitted-fact work + producer fact-fold work`.

The root never adds `[10]` or `[4]` again. It advances one absolute cursor over
each returned tape, requires forward progress, exact outer framing, six inner
fields, exact final cursor, recomputed count/UTF-8 deltas, and the declared work
identity. Root verification work is then charged once. Only a verified bounded
tape may contribute frames to the final `factParts` fold.

Concretely, if `C` is the claimed producer work, `N` the admitted part count,
and `F` the producer fold-copy work, then
`C = base + producer-local + N + F`. The verifier independently repeats its
`N`-part traversal and `F` fold, so the adopted work is `C + N + F`; it is not
permitted to collapse back to `C`. Path resolution already advances its
producer-owned global work cursor, whereas expression-local work is supplied
separately; callers must not add either debit twice.

Producer status handling is:

1. malformed row/internal invariant → producer `drift`;
2. prospective count/byte/work crossing → producer `limit` with no offending
   frame retained;
3. otherwise `ok`.

When admission rejects a candidate with `limit`, the rejected candidate is
validated and framed but is not retained and does not advance the committed
count, byte, or work state. The producer folds the previously admitted parts.
If that fold succeeds, the producer returns a full-width `limit` tuple carrying
the exact prefix tape and its prior cumulative count/bytes plus the fold work.
The root verifies that prefix before returning atomic `F4_LIMIT`. If the
prefix fold itself returns `drift` or reaches the work cap before constructing
a tape, the producer returns the corresponding exact legacy-width terminal;
`f4balancedtapefold` has already validated every retained frame before that
work verdict. This is the only no-tape terminal path and must be frozen by a
composition-wide source-structure oracle.

The root verifies any returned bounded tape and state before honoring `limit`.
Therefore a malformed returned tape/state is drift even if status claims
`limit`; a genuine producer `limit` becomes atomic `F4_LIMIT`. F2B and other
prerequisite drift already win before either producer runs.

No intermediate prefix is externally committed. Producers build only bounded
handler-local parts, and the root appends verified parts only to its local final
fact-part array. A fatal branch returns `f4fatal(...)`, whose ordinary public
partitions are empty; no rollback or mutation of an already-published prefix is
possible. Tests must cover a valid prefix followed by malformed state and by a
real limit crossing to prove this transactional boundary.

## M3.0 — RED-Only Oracle Phase

M3.0 is local preparation and lands atomically with M3.1; main must never carry
an intentionally failing test.

- Add `c13-global-facts.test.mjs` with public exact/cap-minus-one expression and
  path cases, Unicode framing, atomic fatal partitions, and one-F4 invocation.
- Add a private test-only direct helper seam for malformed frame/arity/state
  precedence. It executes real linked KERN; it does not fabricate a receipt.
- Add composition-wide structural guards that reject both current wholesale
  consumer calls and producer fact `f4append` sites.
- Add canaries proving the guards reject renamed bypasses, limit-before-shape,
  missing state adoption, duplicate work addition, rescan/suffix slicing, and
  post-limit retention.
- Assert the root F4 script glob includes the new oracle without adding it to
  promoted `test:infra`.

The baseline must be RED for the structural/semantic C13-GLOBAL reason, not for
missing build artifacts, unsupported runtime input, invalid policy overrides,
or a generic thrown exception.

## M3.1 — C13-GLOBAL Closure

- Extract expression fact-producing logic before modifying the 499-line
  `f4-expression-evidence.kern`; every handwritten file stays below 500 lines.
- Add the global admission helper to F4 composition and policy pins.
- Replace expression/path growing fact prefixes with admitted parts and bounded
  folds.
- Replace root wholesale materialization with advancing verification and exact
  cumulative-state adoption.
- Preserve ordinary fact order: local facts, expression facts, invalid-child,
  path facts, then root facts.
- Preserve diagnostic order and every existing status/fatal vocabulary.
- Keep public worker arity and exports unchanged; any new seam remains under
  `__test`.

## M3.2 — F4-A8 Mutation Closure

Each mutation has an ordinary positive control, exactly one deliberate defect,
one expected failure class, and evidence that no unrelated validator killed it.
The matrix covers prerequisite forgery, semantic host delegation, shadow
receipt consumption, catalog omission, constant output, partial failure,
post-hoc sorting, hardcoded limits, and seal drift. It also includes:

- document-set permutation invariance for canonical F4B `.4` output;
- source guards against host semantic classification/sorting;
- composition/policy skew and stale generated-authority rejection;
- mutation controls for C13 producer/consumer count, byte, work, and cursor
  claims; and
- a source-backed independent result oracle where equality alone could
  false-green.

## M3.3 — F4-A9 Scale Closure

- Generate deterministic, seed-pinned, non-nested 1x/2x/4x/8x families for
  declarations, properties, attachments, decorators, expressions, paths,
  bindings, modules, and graph density.
- Attest that larger source families are not byte prefixes or repeated copies
  of smaller families.
- Use one F4A invocation per document and one F4B invocation per closed set.
- Assert adjacent ratios and policy-owned absolute ceilings for time, RSS,
  encoded envelope bytes, and sealed work fields.
- Measure after semantic/mutation closure; do not tune limits from a known
  quadratic implementation.
- Keep environment-sensitive time/RSS evidence separate from deterministic
  work/envelope assertions.
- Record generated, attempted, accepted, and rejected case counts for every
  family and require `attempted == generated`. A fast-path rejection remains a
  measured result with its exact expected status; dropping or omitting an
  attempted case fails the oracle.

## M3.4 — F4-A10 Cumulative Acceptance

One exact candidate SHA must pass:

1. M3 focused C13/A8/A9 suites;
2. focused F1, F2, F2B, F3, and complete F4;
3. runtime ABI, canonicalizer, checker, and formatter;
4. lint, build, repository consistency, exact policy pins, and deterministic
   authority regeneration;
5. cumulative KERN 5 fitness; and
6. automatic-risk Agon review with no unresolved verified blocker.

Only after that receipt may the parent F4 spec mark A8–A10 verified. M3 does
not itself add or promote `test:kern-frontend`.

## Blast Radius

| Path | Action | Reason |
| --- | --- | --- |
| `.Codex/specs/kern-5-f4-m3-scale-adversarial-closure/spec.md` | add/update | M3 contract and evidence |
| `examples/kern-frontend/f4-global-fact-admission.kern` | add | common global admission boundary |
| `examples/kern-frontend/f4-expression-evidence.kern` plus extracted helper | modify/add | producer-owned expression fact admission under 500 lines |
| `examples/kern-frontend/f4-path-contract.kern` | modify | producer-owned path fact admission |
| `examples/kern-frontend/f4-declarations-semantic-tail.kernpart` | modify | bounded root verification/state adoption |
| `scripts/kern-frontend-f4-declarations/policy-validation.mjs` | modify | composition inventory |
| `scripts/kern-frontend-f4-declarations/policy.json` | modify | exact composition SHA pins |
| `scripts/kern-frontend-f4-declarations/worker.mjs` | test-only seam if required | direct real-KERN malformed-state probes |
| `scripts/kern-frontend-f4-declarations/c13-global-facts.test.mjs` | add | M3.0/M3.1 oracles |
| later M3 A8/A9 test helpers | add | mutation and scale closure |
| parent F4 spec and completion goal | update only after evidence | truthful status, no promotion |

## Acceptance Criteria

- [x] M3-A1: current wholesale consumer paths and every producer fact
      `f4append` are RED at baseline and absent after M3.1.
- [x] M3-A2: expression/path facts cross count, exact UTF-8 byte, and exact
      work limits prospectively; exact boundaries preserve byte-identical
      ordinary receipts.
- [x] M3-A3: malformed outer frame, trailing bytes, non-forward cursor,
      five/seven-field row, or mismatched count/bytes/work returns the correct
      atomic drift before a simultaneous claimed limit.
- [x] M3-A4: producer semantic work, each fact admission, producer fact fold,
      root verification, and final fact fold are charged exactly once; deleting
      or duplicating any debit fails.
- [x] M3-A5: no expression/path fact is retained after a failed prospective
      admission, and no public partial partition escapes a fatal result.
- [x] M3-A6: no global fact path rescans a tape, slices a growing suffix, uses
      growing-prefix accumulation, or delegates classification/admission to
      host code.
- [x] M3-A7: document `.2`, ABI 109/17, F4B `.4` ABI 18/10, policy `.4`, F0–F3,
      and M2 canonical graph outputs remain unchanged except for legitimate
      receipt/work bytes caused by newly charged work.
- [x] M3-A8: the complete nine-family adversarial mutation matrix is
      discriminating and green on the implementation.
- [x] M3-A9: non-nested 1x/2x/4x/8x families pass deterministic work/envelope
      and environment-qualified time/RSS walls.
- [x] M3-A10: all cumulative gates and independent review pass
      on one SHA; policy and generated authority are deterministic and clean.
- [x] M3-A11: all handwritten touched files remain below 500 lines.
- [x] M3-A12: no terminal frontend gate, release, tag, package publication, or
      deployment occurs in M3.

## Out of Scope

- F5 KIR projection, F6/F7 frontend promotion, compiler, fixed-point,
  interpreter, canonical cutover, packed RC, or public release.
- New public receipt fields, format versions, worker options, or host semantic
  fallbacks.
- Reopening M1 semantic decisions or M2 canonical graph semantics.
- Treating wall-clock performance as semantic correctness evidence.

## Deploy Order and Skew

Each sub-slice is an internal source/policy/test candidate. Composition source,
descriptor order/SHA, and policy bytes land atomically; old-source/new-policy or
new-source/old-policy combinations fail before ordinary receipt acceptance.
Rollback is a Git revert of the complete sub-slice. There is no runtime fallback
or mixed-format window. M3.4 acceptance is complete, so later F5 work may treat
F4 as the accepted current internal-oracle boundary.

## Kill Switches

Stop and redesign if any implementation requires:

1. changing document `.2`/ABI 109/17 or F4B `.4`/ABI 18/10;
2. checking a fact limit before validating the candidate frame/row;
3. retaining an over-cap fact or a producer fact before prospective admission;
4. rescanning an imported fact tape, slicing growing suffixes, or using
   repeated growing-prefix concatenation;
5. adding producer work twice or omitting real producer/fold/verifier work;
6. host-side semantic classification, sorting, or fallback;
7. hardcoded operational limits outside policy;
8. accepting nested/repeated density corpora as scale evidence; or
9. promoting F4 or the terminal frontend gate before M3.4.

## Corrections Log

| Earlier claim | Verified correction | Impact |
| --- | --- | --- |
| M3 could be one atomic implementation slice. | Tribunal consensus rejected aggregate attribution across semantic, mutation, scale, and process claims. | Use M3.0–M3.4, atomic acceptance only at the end. |
| Consumer streaming alone closes C13-GLOBAL. | Both producers already allocate growing fact tapes before the consumer. | Producer admission plus consumer verification. |
| M3.1 must add work/count/byte fields to the terminal seal. | The public 17-field hash already covers `workSteps`; terminal shape is frozen. | Preserve receipt format and hashing. |
| A new terminal gate-coverage command is immediately required. | The root F4 script already globs every F4 test; promoted infra intentionally excludes unaccepted F4. | Attest the glob in M3.0; reconsider terminal integration only at M5. |
| Sticky producer traversal is required so late F2B drift beats an early fact limit. | Full F2B recomputation/equality precedes all semantic projection. | Keep row-shape drift before local limits; do not invent post-limit prerequisite replay. |
| Nero concurrency, rollback, stream-contamination, and pointer-tag failures apply to this design. | The F4 composition is one synchronous portable evaluation with handler-local scalar/list state and one returned value; the design adds no threads, retries, pointers, tags, or externally committed prefix. | State the execution model explicitly and add transactional-prefix tests instead of concurrency machinery. |
| Admission rejection can make the scale wall green by silently shedding generated cases. | M3.3 must account for every generated attempt and assert its exact accepted or rejected result. | Add generated/attempted/accepted/rejected cardinality assertions to each scale family. |
