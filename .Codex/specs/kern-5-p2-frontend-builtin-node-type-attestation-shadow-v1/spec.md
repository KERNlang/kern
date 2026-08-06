# M4.161 Built-in Node-Type Attestation Shadow v1

**Milestone:** M4.161  
**Status:** implemented, reviewed, and fully verified; publication pending  
**Risk:** medium, internal release-blocking frontend contract  
**Tribunal:** `tribunal-1786039376013-x4emdp`

## Decision

[D1] M4.161 adds the internal format
`kern.frontend.builtin-node-type-attestation-shadow.1`.

[D2] The slice consumes the complete bounded M4.160 node-type-token admission
envelope and attests only whether an admitted identifier is an exact member of
the immutable top-level `NODE_TYPES` catalog.

[D3] A positive result is `builtin` and carries the canonical zero-based
catalog index. A negative membership result is `unresolved` and carries no
index. `unresolved` is a continuation state, not an unknown-node decision.

[D4] M4.161 never emits `UNKNOWN_NODE_TYPE`, never rejects an admitted
identifier merely because it is absent from `NODE_TYPES`, and never claims the
bootstrap parser's complete knownness predicate.

[D5] Mutable `KernRuntime` state is outside this slice. Dynamic evolved types,
multiline block types, parser hints, and template registrations do not affect
the M4.161 result.

## Evidence boundary

[E1] The live catalog authority is the top-level `NODE_TYPES` const-asserted
static string literal in `packages/core/src/spec.ts`.

[E2] A checked-in canonical catalog data file and a generated native-KERN
catalog member must match that live literal exactly in order, spelling, count,
and uniqueness. If the live literal ceases to be statically analyzable, the
repository gate fails closed.

[E3] The native M4.161 handler receives no catalog argument and invokes no host
callback. It compares the admitted normalized identifier against the generated
native-KERN catalog using bounded exact text equality.

[E4] The independent host oracle reads the checked-in catalog data directly.
It does not import `NODE_TYPES`, `isKnownNodeType`, a production classifier, or
the catalog generator.

[E5] Catalog drift is a repository/build failure. Runtime execution has no
fallback to a stale or host-provided catalog.

## Input and inherited authentication

[I1] The public test entry accepts the same bounded arguments as M4.160:
content, maximum code points, maximum tokens, maximum diagnostics, maximum
stream records, and maximum lexical depth.

[I2] It invokes the native M4.160 handler exactly once.

[I3] An inherited M4.160 failure is accepted only when its complete fixed-width
failure envelope is exact. Its code and empty detail are propagated atomically
in the M4.161 failure envelope.

[I4] A successful M4.160 envelope is authenticated completely before catalog
membership is evaluated. Authentication covers the decision record, every
`stream-auth` record and reconstructed M4.159 field, optional diagnostic and
error records, the final seal, record counts, ordering, coordinates, status,
and content binding.

[I5] Malformed or partially authenticated M4.160 success produces the exact
local failure `ATTESTATION_INVALID` with empty detail and no partial decision.

[I6] M4.160 `dropped` is preserved as `dropped`; it is never catalog-tested and
cannot become `unresolved` or `builtin`.

## Result contract

[R1] Every M4.161 envelope uses fixed-width records after one format field.

[R2] An admitted identifier produces one decision with:

- inherited admitted type and M4.160 status;
- `builtin` plus its canonical zero-based index, or `unresolved` plus `none`;
- exact catalog count and catalog identity fields;
- exact inherited format, field count, and source seals.

[R3] A dropped input produces a decision with status `dropped`, attestation
`none`, index `none`, and exact inherited diagnostic/error counts.

[R4] The output seal binds content, inherited status, admitted type,
attestation, index, catalog count, inherited envelope field count, scalar/byte
source lengths, and inherited M4.159/M4.160 formats.

[R5] The host parser rejects unknown tags, noncanonical integers, wrong indices,
wrong catalog count, catalog/order drift, malformed padding, reordered records,
inconsistent seals, and any semantic substitution before returning a result.

## Resource contract

[B1] M4.160's configured 512-token and 64-diagnostic limits remain unchanged.

[B2] The catalog count is mechanically bounded by checked-in policy and must fit
the native runtime collection and iteration budgets.

[B3] Membership evaluation is one forward catalog pass with at most one exact
comparison per catalog entry. It must not rescan the inherited stream or
perform prefix-based quadratic reconstruction.

[B4] The exact maximum M4.160 input and the full catalog must complete inside a
deterministic test timeout on Node 22.22.

## Required tests

[T1] Every live catalog entry returns `builtin` with its exact zero-based index.

[T2] Case, prefix, suffix, punctuation, Unicode, reserved-future-name, and
empty-like identifier traps remain `unresolved` when token admission succeeds.

[T3] `evolved:text` token normalization returns admitted type `text` and the
same built-in index as literal `text`.

[T4] Registry non-claim asymmetry is release-blocking: registering a dynamic
type, a template type, or a new multiline parser hint changes bootstrap parser
knownness but leaves M4.161 `unresolved` byte-identically.

[T5] Dropped-token cases and every inherited failure preserve exact precedence
and never reach membership evaluation.

[T6] Named mutations kill constant verdicts, incorrect indices, catalog
reordering/omission/duplication, prefix matching, normalization aliases,
partial inherited authentication, forged counts, reordered records, source
seals, and dropped-to-unresolved promotion.

[T7] Native source containment rejects host handlers, capabilities,
`NODE_TYPES`, `isKnownNodeType`, `KernRuntime`, parser delegation, and oracle
delegation.

[T8] Focused verification includes catalog generation/check mode, direct unit
tests, differential cases, the complete M4.153-M4.161 frontend regression
sequence, `git diff --check`, and the complete Node 22.22 KERN 5 fitness wall.

## Claims and exclusions

[C1] This slice may claim only:
`kern-frontend-builtin-node-type-attestation-shadow: internal-oracle`.

[X1] M4.161 does not claim complete known-node classification, unknown-node
warning ownership, runtime-registry ownership, props, styles, themes,
indentation/document coordinates, `export fn`, successful parsed nodes, AST,
KIR, a public frontend API, or frontend cutover.

[X2] M4.162 owns the next seam: instance- and epoch-bound authenticated mutable
registry snapshots for dynamic, multiline, and template membership. Snapshot
creation, mutation invalidation, duplicate rules, and parser-execution binding
must be explicit before the four predicates can be combined.

[X3] A later slice may combine immutable and mutable attestations into the
bootstrap `UNKNOWN_NODE_TYPE` warning predicate. Until then, `unresolved` must
remain nonterminal.

## Review and publication

[V1] Run the focused local gate and complete current fitness wall before review.

[V2] Run exact-roster automatic-risk review with primary engine `codex` and
`--roles auto`, because the slice spans catalog integrity, correctness,
resource bounds, and a new frontend contract.

[V3] Verify every finding against current source, fix genuine blockers, and use
targeted independent confirmation for risky review-driven fixes.

[V4] Publish one Agon-signed commit only after the final wall and review are
clean.
