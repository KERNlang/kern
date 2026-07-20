# KERN 5 R2 M4.3d/M4.4 — Conditional Canonicalizer Tranche

**Status:** SEALED FOR PUBLICATION — focused gate, complete fitness wall, and
final integrated-tree review passed

**Parent objective:** advance the measured M4 self-hosted canonicalizer through
an evidence-preserving conditional implementation, without promoting the family
or changing a shared KIR/runtime contract.

## Grounded Evidence

[VERIFIED] M4.3c is sealed and published at commit
`736e2d1237b6d154b7abbf5f853103c459627424`. Its format-3 summary reports four
of 99 functions base-complete and selects `conditional`: two functions, one
tool, 1,115 occurrences, and witnesses
`examples/capstone-assertion-engine/diag.kern#0:pathAppendKey` and
`examples/capstone-assertion-engine/diag.kern#3:failResult`.

[VERIFIED] The selected family is the body-statement surface: node kinds `if`
and `else` plus property `if.cond`. It is not the ternary expression kind.

[VERIFIED] Composition was a fixed authenticated concatenation of expression
helpers and the main KERN member. There is no capability registry or host
dispatch. The prior 497-line coverage implementation mixed authentication,
ranking, and receipt construction.

## Decision History and Plan Delta

[VERIFIED] Tribunal
`tribunal-1784465753478-d3o6ne-kern-5-r2-m4-3d-conditional-arch` completed six
of eight turns. Antigravity and MiniMax completed both rounds; Claude returned
evidence-gathering preambles; Codex failed its stdin adapter twice. It is
degraded input, not consensus.

[DECIDED] The useful tribunal result was to keep the new recursive statement
logic out of the main KERN member and to split the near-limit host module. Its
proposed existing capability registry was rejected because repository
inspection proved none exists.

[VERIFIED] A concurrent handoff draft exposed the same causal evidence problem
previously found for binary: a post-change receipt cannot honestly serve as the
pre-change selection evidence. M4.3d therefore freezes the immutable M4.3c
selection and extracts pure ranking. M4.4 consumes that provenance and adds the
KERN-owned conditional member.

[VERIFIED] Nero `nero-1784467284134-e9lp4v` challenged combining provenance and
capability. Its proposed two-commit remedy was internally inconsistent because
its first commit already included the new KERN composition member. The useful
challenge was role ambiguity. Executable tests now distinguish prior selection
(8 corpus members, 99 functions, 1,115 occurrences, prior digests) from live
capability evidence (9 members, 104 functions, 1,140 occurrences, changed
digests). The prior record authorizes implementation selection only; the live
receipt binds the changed tree.

[DECIDED] M4.3d and M4.4 ship atomically because the prerequisite pins an
already-published immutable commit, all receipt consumers are internal and
updated together, and no supported skew state is introduced. M4.5 remains a
separate conditional promotion and remeasurement slice.

## Exact Capability Contract

[DECIDED] Admit only `return`, `if`, and sibling `else` within this statement
tranche. An `if` has exactly one recursively supported `cond`; an `else` has no
properties and must immediately follow an `if` in the same child list.

[DECIDED] Nested and empty conditional containers are valid. Every statement
container may contain at most one direct `return`, and it must be the final
direct child. Void/non-void return rules remain symmetric with the function
return type.

[DECIDED] Canonical output uses two spaces per nesting level, quoted canonical
expressions, and sibling `else`. Validation of the full graph precedes output
construction, so malformed input cannot expose partial canonical source.

[VERIFIED] `canonicalizer-statement-helpers.kern` owns recursive validation and
emission. It returns fresh line arrays because the runtime effect machine
correctly rejects mutation of array parameters; those fresh local arrays remain
mutable. The main member only validates through the helper and appends returned
lines to its local result.

## Evidence and Tests

[VERIFIED] RED was proved when `conditional-trailing-return` failed against the
sealed M4.3c canonicalizer with `KERN_CANONICALIZER_PROFILE`.

[VERIFIED] Four valid fixtures cover trailing return, sibling `if`/`else`,
three-level nesting, and empty containers. Nine hostile fixtures cover orphan,
non-adjacent, duplicate, malformed, and unsupported statement shapes.

[VERIFIED] The two sealed conditional witnesses now join all three binary
witnesses in exact structural-KIR and byte-idempotence execution.

[VERIFIED] The focused Node 22 gate passes: 60 Node tests; 18 golden/KIR
fixtures; five measured witnesses; three profile-limit fixtures; 128 hostile
fixtures; and live coverage of four of 104 base-complete functions with
`conditional` still selected at 1,140 occurrences.

[VERIFIED] The exact integrated M4.3d/M4.4 tree passes the complete Node 22
`pnpm fitness:kern-5` wall, including the full workspace suite, every KERN
constitutional proof, 432/432 cross-target fixtures, 109/109 class fixtures,
233/233 native KERN assertions at 100% declared coverage, capstone and
self-host checks, app behavior, browser budget, and the repeated canonicalizer
gate.

[VERIFIED] Full-roster review
`review-1784467657693-d189fo-kern-5-r2-m4-conditional-termina` completed five
of six requested engines; Codex exhausted its account limit. Four engines found
no material issue. MiniMax's claimed duplicate-definition blocker was rejected
against the actual composition: the composite contains each statement helper
once, its bytes equal the three declared input members exactly, and the
generated composite is not itself an input member. A regression assertion now
requires every conditional helper to have exactly one definition in the
executable concatenation. Its remaining items were bounded-performance, exact
byte-evidence, or wording observations rather than defects.

[VERIFIED] Final integrated-tree review `review-1784470527261-w0lc8x`
completed five of six requested engines; Codex again exhausted its account
limit. It reported zero verified findings and four needs-check items. Direct
adjudication found no code defect: the publication checkbox was intentionally
pending; the sequential `if`/`else` kind predicates are mutually exclusive and
share the following child-emission path; empty handler bodies are rejected
before `validstatementlist`; and `exception-flow` fell from 36 to 34
occurrences because two old return-validation throw/property sites were
consolidated behind one delegated fail-closed site.

## Slice Boundary and Kill Criteria

[DECIDED] `conditional` remains outside the cumulative base and remains an
active candidate. M4.5 must consume the frozen implementation-selection
provenance, promote the exact family, remove it from active candidates, and
remeasure before any following family is chosen.

[DECIDED] Re-adjudicate if this slice requires a shared KIR, parser, runtime
ABI, public contract, or ownership change; if either provenance role can be
substituted for the other; or if the authenticated witnesses lose structural
parity or idempotence.

## Acceptance

- [x] RED conditional fixture fails against M4.3c for the intended reason.
- [x] Prior M4.3c selection is immutable and role-separated from live evidence.
- [x] Exact recursive conditional validation/emission is KERN-owned.
- [x] Valid, hostile, profile-limit, witness, receipt, and focused gates pass.
- [x] Full usable-roster review has no verified blocker; Codex shortfall is loud.
- [x] Complete Node 22 `pnpm fitness:kern-5` wall passes.
- [x] Final integrated-tree review has no verified finding after adjudication.
- [ ] Signed commit is fetched/rebased before one verified push.

Confidence: 0.99. Remaining uncertainty is limited to publication transport;
the focused, complete fitness, and independent review contracts pass.
