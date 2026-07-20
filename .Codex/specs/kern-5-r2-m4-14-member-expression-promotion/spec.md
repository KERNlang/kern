# KERN 5 R2 M4.14 — Member-Expression Promotion and Remeasurement

**Status:** READY FOR PUBLICATION

**Parent objective:** authenticate the published M4.13 member-expression
capability in the cumulative KERN canonicalizer profile, remove that family
from active candidates, and deterministically remeasure the next tranche.

## Grounded Evidence

[VERIFIED] Published `origin/main` at
`930b20f9b87c7fb153ff5164b760a1bc211dce05` contains the reviewed M4.13
implementation. The exact executable composition is 33,571 bytes with
SHA-256 `b22b359416deb5da970a2826738eb392d37d29807d48aefe946d8f8aafcffc0a`;
the handwritten main member is 21,706 bytes with SHA-256
`3f33bd5d9ea6ecafc323035b5bce303b133d502f8b5c3fca4c8076da238c369a`.

[VERIFIED] Immutable selection provenance remains the pre-implementation
M4.11 record: `member-expression`, one function, one tool, 259 occurrences,
and witness
`examples/capstone-checker-subset/checker-while.kern#8:isPositiveSafeIntText`.
M4.13 deliberately kept that family active and the cumulative base at 20 of
104 functions so implementation evidence and promotion evidence remain
separate.

[VERIFIED] The published KERN member branch admits the exact structural record
`{ object, optional, property }`, recursively emits the receiver, and accepts
only `optional=false`. It accepts identifier-shaped dot properties including
`new`, `typeof`, and `return`, while rejecting malformed identifiers and the
six parser-forbidden spellings `null`, `none`, `undefined`, `true`, `false`,
and `await`.

[VERIFIED] Authenticated post-promotion measurement increases cumulative base
completion from 20 to exactly 21 of 104 functions and removes member from the
active ranking. Every remaining single-family candidate completes zero new
functions, so the deterministic next winner is `null`; binding leads the
zero-completion ranking only by its 750 observed occurrences.

[VERIFIED] The regenerated canonical format-5 summary has SHA-256
`ddcb79ffd489555070ae807905ad09405761fb6175d7d0597ab896fc4e26717c`.
The M4.13 executable digest remains byte-identical, and the immutable member
selection record remains byte-identical at digest
`83e045d827f7865bd03003d882baf3fe42d66d998c0daa894a05f534cbf8df2d`.

## Promotion Contract

[DECIDED] Advance the exact cumulative base identity to
`kern.kir-canonicalizer.profile.m4.14`. Append the member promotion after
binary, conditional, and call using immutable selection digest
`83e045d827f7865bd03003d882baf3fe42d66d998c0daa894a05f534cbf8df2d`.
Add `member` to the ordered base expression kinds and remove
`member-expression` from active families.

[DECIDED] Base member validation must match the implemented subset. Validate
the exact recursive structural expression shape, require `optional=false`,
require an identifier-shaped text property, and reject exactly the six
parser-forbidden dot properties. Nested optional or forbidden members must
fail through recursive profile traversal.

[DECIDED] Keep index outside the base. A member receiver containing index, or
any other unpromoted expression family, remains incomplete through the
expression-kind closure. Member promotion must not smuggle index capability
into the cumulative profile.

[DECIDED] Keep coverage policy, receipt, summary, and immutable provenance
schema formats unchanged. This slice changes cumulative profile facts,
ranking, digests, and authenticated summary bytes, not the evidence schema,
canonicalizer executable, corpus, or append-only provenance chain.

[DECIDED] Accept the selector's authenticated result only when the promoted
member family is absent from active ranking and every winner has at least one
newly completed function. A null winner is valid and must not be replaced by
the highest-occurrence zero-completion family.

## RED and Mutation Contract

[VERIFIED] Promotion assertions fail against sealed M4.13 because the base
lacks `member`, its promotion list lacks the member provenance, the exact
member local profile is absent, and the member family is still active.

[DECIDED] Exact member-profile assertions cover direct and recursive valid
members, all already-promoted receiver kinds, `new`/`typeof`/`return`
properties, missing/extra/malformed fields, non-boolean and true optional,
invalid identifiers, all six forbidden properties, nested hostile members,
and an index receiver dependency.

[DECIDED] Policy mutations reject changed profile identity, reordered,
duplicated, missing, or forged promotions, and reintroduced member-family
overlap. Historical binary, conditional, call, and member selection records
remain byte-identical and ordered.

## Slice Boundary

[DECIDED] Do not modify the KERN canonicalizer executable, composition,
structural expression catalog, parser, KIR codec, runtime ABI, corpus, family
registry, or selection provenance records.

[DECIDED] Do not preselect or implement the next family in this slice. Publish
only the authenticated member promotion and resulting measurement; the next
slice begins from the exact measured winner or an evidence-backed dependency
closure plan if the winner is null.

[DECIDED] Re-adjudicate if the M4.13 executable bytes drift; the immutable
member provenance does not authenticate; valid published member fixtures fail
the local profile; optional, forbidden-property, or index-dependent members
enter the base; member remains an active candidate; or measurement is not
deterministic.

## Expected File Surface

- this claim-tagged spec;
- cumulative coverage policy and exact base-profile validator;
- promotion, handoff, measurement, and standalone coverage assertions;
- regenerated authenticated format-5 coverage summary;
- KERN 5 release-train evidence.

## Acceptance

- [x] Fresh branch starts from exact published `origin/main`.
- [x] Intended promotion RED fails against sealed M4.13.
- [x] Exact recursive non-optional member profile is validated and mutation-killed.
- [x] Immutable four-record provenance chain remains byte-identical.
- [x] Authenticated measurement establishes 21/104 and a null next winner.
- [x] Focused Node 22 canonicalizer gate passes: 70 structural/authentication,
  27 golden/idempotence/KIR, eight witness, three profile-limit, and 156 hostile fixtures.
- [x] Complete Node 22 `pnpm fitness:kern-5` wall passes.
- [x] Full usable-roster Agon review has no verified blocker.
- [ ] Signed commit is fetched/rebased before one verified push.

Confidence: 0.99. Published implementation and provenance inputs, the exact
supported member subset, promotion boundary, regenerated summary, 21/104 base
count, null winner, and focused gate are grounded in current executable tests.
The complete Node 22 fitness wall passes this exact tree, including production
build, every workspace and infrastructure suite, 432 cross-target fixtures,
109 class fixtures, 233 native assertions at 100% coverage, 48 checker
fixtures plus 36 hostile rejections, 39 validator verdicts, 40 whole-app
fixtures across three legs, browser budget, and every repeated
KIR/runtime/ownership/convergence/canonicalizer guard. Full-roster review
`review-1784590699884-b0vlql-kern-5-r2-m4-14-terminal-boundar`
completed all six usable engines with zero verified findings, two needs-check
items, zero speculative findings, and three nits. The first needs-check assumes
the root-expression reserved-identifier set owns dot-property parser policy;
it does not, and coupling the two would make a future root-only restriction
silently reject a legal member property. The second requests a cross-family
validator refactor outside this promotion-only boundary. The remaining
bounded-tooling performance and test-constant suggestions are non-material.
No material finding remains unresolved.
