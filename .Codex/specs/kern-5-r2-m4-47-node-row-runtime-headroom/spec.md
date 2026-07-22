# KERN 5 R2 M4.47 Node-Row Runtime Headroom

**Status:** READY TO SHIP
**Date:** 2026-07-22
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.46 commit
`77ba01b467b411def9343ffb3c064e1650e6fced` selects an exact four-function,
three-tool, 12-parameter-row cohort by raising only `maxNodeRows` from 16 to
19. Its immutable current-analysis receipt has SHA-256
`67ed659c709adfc5cd51095a3ac5f9549b0384d9651ac3d74894ad4b3aab3402`.

[VERIFIED] Exact Node 22.22 structural-KIR probes prove every selected witness
fits the precommitted 49,152 promotion budget under the unchanged KERN runtime.
The measured floors are 8,303, 10,361, 15,236, and 10,591. Every witness fails
at floor minus one, succeeds at its exact floor, emits no diagnostics/events,
completes with a return value, and round-trips to byte-identical structural KIR.

[DECIDED] M4.47 is a proof-and-freeze slice. It freezes M4.46 before the
authenticated implementation closure changes, publishes an immutable runtime-
headroom receipt, and changes no KERN source, generated consumer, admission
profile, active family, parser, runtime, KIR, ABI, package version, or public
API. A later fresh slice may promote 19 node rows only from this exact evidence.
KERN 5 remains incomplete.

## Published Input

[VERIFIED] The fresh branch starts at M4.46 commit
`77ba01b467b411def9343ffb3c064e1650e6fced`; local HEAD and `origin/main`
resolve to that exact object.

[VERIFIED] The published M4.46 boundary is:

- base profile `kern.kir-canonicalizer.profile.m4.36`;
- active limits 16 node rows, 30 property rows, and 388 value rows;
- 60/104 base-complete functions and 43 legacy-parameter residual functions;
- exact empty parameter-ready partition and bounded active-family exhaustion;
- residual assignment digest
  `f72e98d37cd3fcbc711c53bc6dfd8c4afe0ea56a08c21b3907a550a17fa0418c`;
- selected candidate 19/30/388 with four functions, three tools, and 12 total
  parameter rows;
- analysis receipt SHA-256
  `67ed659c709adfc5cd51095a3ac5f9549b0384d9651ac3d74894ad4b3aab3402`;
- live coverage and prerequisite receipt SHA-256 values
  `f92de8285ead020203aa7a4d299e89ab62c13f67c904598abfdfc01c049ea62b`
  and `f18ad9a00b41d15f94a7eb7de047efb6257c5b1b606f3099b3bcc596f6d9cd4e`;
- implementation, canonicalizer-policy, and compiled-core digests
  `9ba952686c10c0210810f428fbbfabdd4d8612825e0047a8add9d2425466021e`,
  `a0613353cf5dd7def20b13138fae461b3084bb6b958b769c99bf5b00a5c98556`,
  and `7b8d3540cb8927db1e9c8d3d2938671103186bed4cc32c955d68e5dbb82c7448`.

## Root Problem

[VERIFIED] M4.46 proves profile completion, not runtime feasibility. Raising a
table row ceiling without checking the KERN-authored canonicalizer can admit a
witness whose execution exceeds the unchanged production runtime limit. M4.43
demonstrated this exact failure mode: a valid 388-value-row witness originally
required 237,982 iterations before expression projection was optimized.

[DECIDED] The M4.46 candidate cannot authorize a profile promotion until all
four exact witnesses execute within a precommitted budget that preserves at
least 25% of the production runtime ceiling.

## Artifact Scope and the Module-Envelope Boundary

[VERIFIED] Coverage computes function profile rows through
`encodeStructuralKir`/`decodeStructuralKir` in
`coverage-profile.mjs:219-226`. M4.47 therefore measures the identical
single-function structural artifact, flattens its canonical tables, executes
the checked-in KERN canonicalizer, reparses its output, and compares the
re-encoded structural bytes.

[VERIFIED] The structural codec source has SHA-256
`04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab`.
The checked-in canonicalizer composite and composition record have SHA-256
`a81f3a28cae9b96bfe7fac0f3a38e7f6830590d11ab5e7214293297f103b1872`
and `7f97b53c34ef4fab067f45ccd75f1817dc1fd4628e2febd43b361036adc74e14`.

[VERIFIED] A read-only probe using the deeper module-KIR envelope found that
`isportable` exceeds the current canonical-value lexical `maxDepth: 64` once
module metadata is wrapped around the otherwise valid structural artifact.
The other three module wrappers encode successfully. This does not invalidate
M4.46 because its measured contract is explicitly structural KIR, but it does
block any claim that M4.47 proves full module-envelope headroom.

[DECIDED] M4.47 records structural-function headroom only. It does not widen
KIR depth, weaken limits, or claim module-KIR admission. The module-envelope
depth gap remains explicit future KIR work and cannot be silently converted
into a runtime or profile-limit change in this slice.

## Runtime Budget Contract

| Behavior | Exact contract | Tag |
|---|---|---|
| Runtime ABI | `kern.runtime.handler.v1` | VERIFIED |
| Production collection/iteration ceiling | 65,536 | VERIFIED |
| Promotion budget | 49,152, exactly 75% of production | DECIDED |
| Candidate profile used as handler arguments | 19/30/388 | VERIFIED |
| Artifact | canonical single-function structural KIR | DECIDED |
| Success | return completion, value present, no diagnostics/events | DECIDED |
| Exact floor | floor succeeds and floor minus one fails | DECIDED |
| Semantic identity | emitted source reparses to byte-identical structural KIR | DECIDED |
| Authority | proof only; no active profile promotion | DECIDED |

The 49,152 boundary is not inferred from the new measurements. It is the same
precommitted 75%-of-production budget used by M4.43, preserving at least 16,384
iterations of production headroom.

## Read-Only Exact Measurements

| Function | Params | Rows N/P/V | Exact floor | To 49,152 | To 65,536 |
|---|---:|---:|---:|---:|---:|
| `checker.kern#12:isIndexRebound` | 6 | 17/26/152 | 8,303 | 40,849 | 57,233 |
| `checker.kern#9:isUserCallable` | 4 | 19/26/185 | 10,361 | 38,791 | 55,175 |
| `canonicalizer-expression-helpers.kern#4:validinteger` | 1 | 19/28/290 | 15,236 | 33,916 | 50,300 |
| `validator.kern#3:isportable` | 1 | 18/24/217 | 10,591 | 38,561 | 54,945 |

[VERIFIED] All four exact probes use the M4.46-recommended 19/30/388 handler
arguments. The maximum floor is 15,236, only 31.0% of the promotion budget and
23.3% of production. No canonicalizer optimization or runtime-limit change is
needed for this cohort.

## Integrity Contract

[DECIDED] Before adding any M4.47 implementation byte, convert the M4.46 live
analyzer into an immutable published handoff bound to receipt digest
`67ed659c...`, source commit `77ba01b4...`, canonical JSON bytes, a regular
non-symlink file, and the unchanged format. Preserve the M4.46 JSON exactly.

[DECIDED] The M4.47 headroom receipt must bind:

- the exact published M4.46 handoff digest, source commit, selected limits,
  and ordered witness ids;
- structural codec, canonicalizer composite, composition, policy, and exact
  three source-file digests;
- runtime ABI, production ceiling, and derived 49,152 budget;
- each witness's parameter rows, structural row counts, exact floor, budget
  margins, and byte-roundtrip result;
- exact maximum floor and minimum remaining headroom;
- explicit `structural-kir-function` scope and a no-claim module-envelope
  disposition.

[DECIDED] Validation fails closed on format/field drift, decorated data,
historical receipt drift, source/hash drift, changed witness identity/order,
invented limits, incorrect arithmetic, floor or floor-minus-one drift,
diagnostic/event/completion drift, byte-roundtrip drift, and any premature
profile-promotion claim. Canonical writer/check mode rejects symlinks and
noncanonical bytes.

## RED and Implementation Plan

1. Add the M4.47 headroom tests first and capture failure at the missing
   headroom module/receipt boundary.
2. Freeze the exact M4.46 receipt/module before the implementation closure can
   move, and update status text from current analysis to published evidence.
3. Add the canonical headroom receipt builder/validator/writer bound to live
   input bytes and the published M4.46 selection.
4. Add exact structural-witness performance tests for floor minus one, floor,
   success envelope, and byte-identical roundtrip across all four functions.
5. Regenerate only current live coverage/prerequisite receipts after all
   authenticated implementation/test files settle; preserve the M4.46 receipt
   byte-identically.
6. Run focused gates, complete Node 22.22 `fitness:kern-5`, required independent
   review, and affected gates after every verified fix.
7. Create one Agon-signed commit, fetch/rebase onto fresh `origin/main`, push
   once with `--no-verify` to the fresh feature ref and authorized `main`, and
   verify identical remote hashes.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | claim-tagged structural headroom contract |
| M4.46 analyzer module/tests | freeze/modify | immutable published handoff before closure drift |
| M4.46 receipt | preserve exactly | causal input evidence |
| M4.47 headroom module/receipt/tests | add | canonical exact headroom evidence |
| M4.47 performance test | add | real runtime floors and byte roundtrip |
| terminal coverage checker | modify | writer/check integration and status |
| coverage status formatter/tests | modify | published M4.46 plus M4.47 handoff wording |
| live coverage/prerequisite receipts | regenerate | authenticate final implementation closure |
| release train | modify after gates | durable M4.47 evidence and next action |

## Acceptance Criteria

- [x] Fresh branch starts at published M4.46 commit `77ba01b4`.
- [x] Exact M4.46 receipt digest, recommendation, and witness order verified.
- [x] Structural-KIR artifact scope matches the live coverage measurement path.
- [x] Module-envelope depth gap is explicit and not mislabeled as runtime proof.
- [x] Read-only exact floors are 8,303, 10,361, 15,236, and 10,591.
- [x] All four probes fail at floor minus one and byte-roundtrip at the floor.
- [x] All four floors are below the precommitted 49,152 promotion budget.
- [x] RED fails at the missing M4.47 module/receipt boundary.
- [x] M4.46 receipt remains byte-identical and loads only as published evidence.
- [x] M4.47 receipt validates live input bytes and exact arithmetic.
- [x] Exact performance tests reproduce all four floors and roundtrips.
- [x] No KERN source, generated consumer, profile, family, parser, KIR, runtime,
      ABI, package version, or public API changes.
- [x] Focused gates and the complete canonicalizer pass: 147/147 Node tests plus
      51 golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
      fixtures, and 226 hostile fixtures.
- [x] Complete Node 22.22 `fitness:kern-5` passes.
- [x] Independent review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic no-verify push to the
      feature ref and authorized `main`; both remote hashes verify.

## Stop Conditions

- M4.46 receipt digest, selected limits, witness ids, or source commit differ.
- Any exact structural witness floor exceeds 49,152 or does not fail at floor
  minus one.
- Emitted source produces different structural KIR bytes.
- Implementation requires raising runtime/KIR limits, changing the candidate,
  or moving active profile policy.
- The receipt cannot distinguish structural-function proof from module-envelope
  admission.

## Out of Scope

- Promoting `maxNodeRows` from 16 to 19.
- Migrating the selected 12 legacy parameter rows.
- Widening module-KIR/canonical-value depth or claiming full module headroom.
- Adding exception-flow or while-iteration families.
- Runtime, KIR, ABI, public API, package version, RC, or stable-release changes.
- Claiming KERN 5 completion.

## Open Questions

[VERIFIED] None block the structural headroom proof. The module-envelope depth
gap is real but belongs to the later KIR/module closure, not this unchanged
structural canonicalizer profile. M4.48 may promote 19 node rows only if M4.47
ships with all evidence exact and no unresolved review finding.

## Measured Implementation Evidence

[VERIFIED] The M4.46 freeze RED failed at the missing published-loader export,
then the final published-handoff tests passed 3/3. The M4.47 RED failed at the
missing `node-row-headroom-m4-47.mjs` boundary before implementation. The final
receipt/status suite passes 10/10 and the real runtime performance suite passes
5/5.

[VERIFIED] The M4.46 receipt remains byte-identical at SHA-256
`67ed659c709adfc5cd51095a3ac5f9549b0384d9651ac3d74894ad4b3aab3402`.
Its published loader now authenticates at
`dc4480a7568863f376e5fe392d2defcabb3394c88d945a7ba506a6c9b980a2b1`.
The canonical M4.47 receipt and its builder/validator authenticate at
`0da8ef5be1be0ea2ac12ef739bd6cc38070d60b7b3a775f45602857d40979af1`
and `09259ac9b634dc8875a58bda40eca564377aca2e3758c89c2ec626c765053af3`.
The exact runtime oracle authenticates at
`a45de591e2641e7971b9ab9e662dd6caae586cd2e84060ef1e47693e22ada1a6`.

[VERIFIED] Regenerated live coverage and prerequisite receipts authenticate at
`95f6c10dff915595f866ae035ce686c9c1fa34bfc3aef47654d29150cedc7eea`
and `a40338a9deb0a0e604d4a667a6a016fd75686930ebcb0d74de4f871f160f1b9b`.
Their shared implementation digest is
`1ebb64074a71b37120ed663162bef05d14a4f513c35d6eaefd4fe1dd2efb73e6`;
the active 16/30/388 policy, 60/104 completion, 43 residual functions, empty
parameter queue, KERN source, composite, runtime/KIR limits, ABI, and public
surfaces remain unchanged.

[VERIFIED] The complete canonicalizer gate passes 147/147 Node tests followed
by 51 golden/idempotence/KIR fixtures, 8 measured witnesses, 3 profile-limit
fixtures, and 226 hostile fixtures. The terminal checker reports the unchanged
60/104 completion boundary and the exact M4.47 maximum floor of 15,236.

[VERIFIED] The complete Node 22.22 `fitness:kern-5` wall passes, including all
workspace builds/tests, 434/434 cross-target fixtures, 109/109 class fixtures,
233/233 native assertions at 100% coverage, 48/48 checker fixtures, 39/39
validator verdicts, 40 app fixtures on three legs, whole-app Express/FastAPI
boot, runtime/KIR/ownership/convergence gates, diff hygiene, and the repeated
canonicalizer gate. The required browser receipt is 157 modules, 1,553,103 raw
bytes, and 333,617 gzip bytes at 56 ms cold and a 95 ms median (87/95/102 ms
samples).

[VERIFIED] Automatic medium-risk role-lens review
`review-1784742281330-sgd69l-kern-5-r2-m4-47-final` completed 2/2 with no
consensus-verified finding. Both needs-check candidates were resolved by
strengthening the evidence: the canonical M4.47 receipt now self-pins its exact
digest, and floor-minus-one checks require the exact public-handler failure
envelope while proving the boundary is above every direct input collection.
The corrected focused suite passes 8/8. No material finding remains unresolved.

[VERIFIED] After the review fixes, lint, repository consistency, and diff
hygiene pass. The complete affected canonicalizer gate passes again at 147/147
plus 51/8/3/226, and the exact coverage status remains unchanged.
