# KERN 5 R2 M4.77 Canonicalizer Parameter Migration

**Status:** IMPLEMENTED — LOCAL GATES AND REVIEW PASSED — PUBLISH PENDING
**Date:** 2026-07-20
**Confidence:** 0.98

## Baseline

- **VERIFIED:** M4.76 is published at commit
  `f198ec30b8b00c2cdb9aca2b9aeb7a2e38a5e1df`.
- **VERIFIED:** its immutable prerequisite receipt has SHA-256
  `a963c0df94b563eb7df5e50eba68faf12cd607f92229ab0c748c412eaa3e88ca`.
- **VERIFIED:** the active profile ceilings are exactly 38 node rows, 53
  property rows, and 461 value rows.
- **VERIFIED:** current coverage is 79/104 base-complete functions with 24
  legacy `fn.params` blockers.
- **VERIFIED:** the frozen M4.76 queue contains only
  `examples/kern-canonicalizer/canonicalizer.kern#0:typesource`, with six
  parameter rows and exact measured witness rows 38/51/461. The witness uses
  51 of the active 53-property-row ceiling; these are intentionally distinct.

## Decision

Consume only the authenticated `typesource` queue. Replace its inline
`params=` property with six ordered direct `param` children:

1. `id:number`
2. `allowVoid:boolean`
3. `valueTag:string[]`
4. `valueParent:number[]`
5. `valueRole:string[]`
6. `valueText:string[]`

The function name, ordinal, export, return type, handler language, and semantic
body remain invariant. **DECIDED**

## Required Evidence

- Byte-copy the M4.76 prerequisite summary into an immutable milestone receipt
  and bind its canonical bytes, digest, format, and source commit. **GUARD**
- Add a target guard that pins the `typesource` source digest, semantic body
  digest, ordered parameters, exact function fact, exact profile rows, and all
  repository-generated consumers. **GUARD**
- Regenerate the canonicalizer composition only through its repository writer
  and update the handwritten corpus digest in the active policy. **GUARD**
- Regenerate current coverage/prerequisite summaries only after all executable
  coverage modules have settled. **GUARD**
- Prove the resulting frontier is exactly 80/104 base completion, 23 legacy
  parameter blockers, an empty parameter-migration queue, and 23 residual
  exception-flow functions under the unchanged 38/53/461 profile. **DECIDED**
- Preserve M4.76's exact reason-assignment digest unless measurement proves
  otherwise; never edit historical receipts to manufacture the result.
  **GUARD**

## RED Oracle

Before source migration, the M4.77 target guard must reject `typesource`
because it still owns legacy `fn.params` and lacks direct `param` children. The
test must also kill signature, parameter order/type, body, identity, fact,
profile, and immutable-prerequisite drift. **VERIFIED-BY-TEST**

## Acceptance

- [x] The RED oracle fails for the legacy `typesource` signature.
- [x] Only `typesource` changes semantically in handwritten KERN source.
- [x] The immutable M4.76 receipt rejects any mutation or non-plain data.
- [x] The M4.77 target and generated-artifact guards pass.
- [x] Coverage is exactly 80/104 with 23 `fn.params` blockers.
- [x] Parameter migration is exactly empty: 0 functions, 0 tools, 0 rows, no
      witnesses.
- [x] Residual exhaustion remains 23 functions in `exception-flow` under the
      unchanged active profile.
- [x] Focused tests, canonicalizer coverage checker, standalone canonicalizer
      gate, and full Node 22 `fitness:kern-5` pass.
- [x] Independent high-risk role-lens Agon review has no unresolved material
      finding.
- [ ] Commit is Agon-signed, rebased on current `origin/main`, pushed once to
      the fresh feature branch and `main`, and remote refs are verified equal.

## Completion Evidence

[VERIFIED] The RED oracle first failed because `typesource` still owned the
legacy inline parameter property. The implementation migrated only that exact
function to six ordered direct parameter children while preserving semantic
body digest
`558358dea059c6a97323eab59b6d300e1fbadea4376ec0b2de34bfaf3b40fe3e`.
The canonical source SHA-256 is
`f4a39a81ea169f0127aac92a2791ac3a2726329f9bd369d05f1f5648593f78d7`.

[VERIFIED] The final live frontier is 80/104 base-complete with 23 legacy
`fn.params` blockers, an empty parameter queue, and bounded exhaustion of 23
`exception-flow` functions under unchanged 38/53/461 profile ceilings. The
residual reason-assignment digest remains
`0abacdcff2a8ee7dfd977de09a3af2488350a383347b226a0afe36b8ca786ae7`.

[VERIFIED] Focused M4.77 tests passed 5/5; the standalone canonicalizer gate
passed 298/298 Node tests, 55 golden/idempotence/KIR fixtures, 8 measured
witnesses, 3 profile-limit fixtures, and 235 hostile fixtures. The complete
Node 22 fitness wall ended with `KERN 5 current fitness wall passed.`

[VERIFIED] Automatic high-risk role-lens review
`review-1784858931629-lvcsz8` completed all 6 usable reviewers. The reported
profile mismatch conflated active ceilings 38/53/461 with measured witness
rows 38/51/461; this wording is now explicit. Direct inspection rejected the
remaining needs-check claims: the legacy migrator remains covered elsewhere,
LF count plus source SHA is intentional byte evidence, `structuredClone`
failure would fail rather than skip a mutation, and self-contained milestone
loaders/digest guards preserve immutable historical boundaries. No material
finding remains unresolved.

## Out of Scope

- Migrating `exprsource`, `tablesok`, `canonicalize`, or any other legacy
  function.
- Raising policy limits or admitting another syntax family.
- Editing historical milestone receipts or their frozen expectations.
- Claiming KERN 5 or R2 M4 complete.
