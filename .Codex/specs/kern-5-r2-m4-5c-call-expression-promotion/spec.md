# KERN 5 R2 M4.5c — Call-Expression Promotion and Remeasurement

**Status:** READY TO PUBLISH — focused and complete walls green; review clean

**Parent objective:** authenticate the published M4.5b call-expression
capability in the cumulative KERN canonicalizer profile, remove that family
from active candidates, and remeasure without inventing a next tranche.

## Grounded Evidence

[VERIFIED] Published `origin/main` at
`c4743cd8c895bd4eed7b626e3ba603d09089c62d` contains the reviewed M4.5b
implementation. The exact executable composition is 32,301 bytes with
SHA-256 `279725b92d959ddbc734f096749d904fde36934ef4a1c73769e87a84e6e72087`.

[VERIFIED] Immutable selection provenance remains the pre-implementation
M4.5a record: `call-expression`, two functions, one tool, 481 occurrences,
and witnesses `pathAppendIndex` and `reasonLengthMismatch`. M4.5b live
measurement is 492 occurrences because the KERN canonicalizer source itself
contains eleven newly authored call expressions. Historical 481 and live 492
are different evidence and must not overwrite each other.

[VERIFIED] The M4.5b canonicalizer admits the exact structural call record
`{args, callee, optional}`, recursively emits supported callees and ordered
arguments, and deliberately admits only `optional=false`. Optional calls and
member/index callees remain fail-closed.

[VERIFIED] A read-only remeasurement over current authenticated function facts
with call added to the base completes exactly eight of 104 functions. Removing
call from active candidates leaves all eight remaining single-family
candidates at zero completed functions; therefore the deterministic next
winner is `null`.

## Promotion Contract

[DECIDED] Advance the exact cumulative base identity to
`kern.kir-canonicalizer.profile.m4.5c`. Append the call promotion after binary
and conditional using immutable selection digest
`7eee28b09785d36539e45293afbe0325fe9b50c20ffc7057e0aa3997d9371605`.
Add `call` to the ordered base expression kinds and remove
`call-expression` from active families.

[DECIDED] Base call validation must match the implemented subset, not merely
the broad structural kind. It must validate the exact recursive catalog shape
through the structural expression validator and separately reject
`optional=true`. Nested optional calls must also reject through recursive
profile traversal.

[DECIDED] Keep member and index outside the base. A structurally valid call
whose callee or argument contains either kind remains incomplete through the
existing expression-kind closure; call promotion must not smuggle those
families into the base.

[DECIDED] Keep coverage policy/receipt/summary schema formats unchanged. This
slice changes cumulative profile facts, ranking, digests, and authenticated
summary bytes, not the evidence schema or immutable provenance chain.

[DECIDED] Record `winner: null` and the zero-completion ranking exactly. Do not
select `binding` merely because it has the largest occurrence count. The
selection contract requires at least one newly complete function.

## RED and Mutation Contract

[VERIFIED] Promotion assertions fail against sealed M4.5b because the
base lacks `call`, its promotion list lacks the call provenance, and the call
family is still active.

[VERIFIED] Exact call-profile assertions cover a valid recursive
non-optional call, missing/extra/malformed fields, non-boolean optional, and
`optional=true`. Policy mutations must reject reordered, duplicated, missing,
or forged call promotions and reintroduced call-family overlap.

[VERIFIED] Initial full-roster review
`review-1784563663115-9as2oz-kern-5-r2-m4-5c-call-promotion` found no verified
blocker and identified two needs-check hardening gaps. The exact completion
predicate now proves member/index call dependencies stay outside the base, and
an unhandled future base expression kind fails closed until it has an explicit
local profile. Both guards passed RED before implementation.

[VERIFIED] Remeasurement is exact: eight of 104 base-complete,
`winner: null`, ranking ids ordered by occurrence/tie rules, all
`completeFunctions` and `completeTools` zero, live call occurrence history no
longer present as an active candidate, and immutable M4.5a evidence still 481.

## Slice Boundary

[DECIDED] Do not modify the KERN canonicalizer executable, composition,
structural expression catalog, parser, KIR codec, runtime ABI, corpus, or
selection provenance records.

[DECIDED] The null winner is a real capability boundary. A later planning
slice must measure multi-family dependency closure or define another
evidence-backed selection policy before implementing binding, member/index,
iteration, unary, do, or exception support.

[DECIDED] Re-adjudicate if base completion is not exactly eight; either frozen
witness remains incomplete; any remaining family completes a function alone;
optional calls enter the base; immutable selection bytes change; or the
canonicalizer executable changes.

## Expected File Surface

- cumulative coverage policy and exact base-profile validator;
- promotion, handoff, measurement, and standalone coverage assertions;
- regenerated authenticated format-5 coverage summary;
- this spec and the KERN 5 release train.

## Acceptance

- [x] Fresh branch starts from exact published `origin/main`.
- [x] Read-only remeasurement establishes eight base functions and null winner.
- [x] Intended promotion RED fails against sealed M4.5b.
- [x] Exact recursive non-optional call profile is validated and mutation-killed.
- [x] Immutable three-record provenance chain remains byte-identical.
- [x] Format-5 receipt and summary report eight of 104 with null winner.
- [x] Focused Node 22 canonicalizer gate passes.
- [x] Complete Node 22 `pnpm fitness:kern-5` wall passes.
- [x] Full usable-roster Agon review has no verified blocker.
- [ ] Signed commit is fetched/rebased before one verified push.

Confidence: 0.99. The promotion inputs, exact implementation bytes, profile
subset, base-completion delta, null-winner outcome, intended RED, regenerated
format-5 evidence, focused gate, and complete fitness wall are grounded in
current source and authenticated measurement facts. Final review
`review-1784565656837-624qiq-kern-5-r2-m4-5c-call-promotion-f` completed all six
engines with zero verified or needs-check findings. Commit, rebase, and
publication remain pending.
