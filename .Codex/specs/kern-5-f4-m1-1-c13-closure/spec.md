# KERN 5 M1.1 — F4A C13-LOCAL Fact Admission Closure

**Status:** IMPLEMENTED AND LOCALLY VERIFIED — C13-LOCAL ONLY; broader F4 acceptance pending
**Date:** 2026-08-21
**Confidence:** 0.97

## Executive summary

**[C13L-S1 BASELINE VERIFIED | CLOSED LOCALLY]** At the pre-implementation baseline, M1.1 already prospectively admitted bare-token, malformed-decorator, and required-missing facts, while five more facts constructed by the same F4A invocation bypassed that boundary: unknown node, unknown property, property-admission rejection, invalid child, and invalid module root. The current candidate now routes all five through the same prospective admission boundary before retention and folds only after count/byte invariants. Evidence: `examples/kern-frontend/f4-declarations-semantic.kern`, `examples/kern-frontend/f4-declarations-semantic-tail.kernpart`, and `scripts/kern-frontend-f4-declarations/c13-local-facts.test.mjs`.

**[C13L-S2 IMPLEMENTED]** C13-LOCAL owns exactly eight constructed-here families: bare token, malformed decorator, missing property, unknown node, unknown property, property-admission rejection, invalid child, and invalid module root. Each is admitted before retention with one KERN-owned, field-local facts ledger. No fact/diagnostic vocabulary, 109-input root field, document `.2` field, or public worker option changes.

**[C13L-S3 DECIDED]** F2B-derived expression facts and path-helper fact tapes are C13-GLOBAL, not C13-LOCAL. They need streaming authenticated admission with frame validation before a limit verdict, preserving F4_F2B/F4_AUTHORITY drift precedence. That remains M3/F4-R1 work.

**[C13L-S4 LOCALLY VERIFIED]** Before integration, `scripts/kern-frontend-f4-declarations/c13-local-facts.test.mjs` passed 32/32 and the full `pnpm test:kern-frontend-f4-declarations` wall passed 362/362. Lint, repository consistency, all 34 F4 authority/prerequisite/composition path-order-SHA pins, and deterministic authority regeneration were also green. This is local candidate evidence, not a durable CI acceptance receipt; it does not accept C13-GLOBAL, promote F4, or change the KERN 5 terminal ledger.

## Baseline root cause and current closure

**[C13L-R1 VERIFIED]** `f4eligibilityleafadmit` validates a six-field row, frames it as `i<len>:`, calculates framed UTF-8 bytes, and rejects prospective count/bytes/work before returning a value to push. Bare, malformed-decorator, and missing-property paths already call it. Evidence: `examples/kern-frontend/f4-line-eligibility.kern:228-250` and `examples/kern-frontend/f4-declarations-semantic.kern:208-225,363-380,410-428`.

**[C13L-R2 BASELINE VERIFIED | CLOSED LOCALLY]** Unknown node/property, property-admission rejection, invalid child, and invalid root previously mutated `factParts`, `factBytes`, and `factCount` directly. The current candidate admits each row through `f4eligibilityleafadmit` before pushing its returned framed value. Evidence: `examples/kern-frontend/f4-declarations-semantic.kern`, `examples/kern-frontend/f4-declarations-semantic-tail.kernpart`, and the direct-push canaries in `scripts/kern-frontend-f4-declarations/c13-local-facts.test.mjs`.

**[C13L-R3 BASELINE VERIFIED | CLOSED LOCALLY]** The final `factCount > maxFacts` check previously followed the fact fold, so public low-cap tests could get the right fatal for the wrong reason. The current candidate checks count and fact bytes before folding, while structural canaries require successful prospective admission to dominate every local push. Evidence: `examples/kern-frontend/f4-declarations-semantic-tail.kernpart` and `scripts/kern-frontend-f4-declarations/c13-local-facts.test.mjs`.

**[C13L-R4 VERIFIED]** Profile limits must be safe integers at least one, so an oracle needs a positive preceding fact count; it cannot use `maxFacts=0`. Evidence: `scripts/kern-frontend-f4-declarations/policy-validation.mjs:169-175`.

## Contract (verified)

> Verified against the live F4 source, worker, decoder, policy validator, parent F4 spec, and M1.1 spec on 2026-08-21.

| Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| C13-LOCAL | The eight families above are constructed directly in F4A semantic/presence code. | `f4-declarations-semantic.kern:208-225,231-234,312-316,337-355,363-380,407-428`; `f4-declarations-semantic-tail.kernpart:51-54,100-103` | VERIFIED |
| C13-GLOBAL | Expression facts come from `expressionResult[3]`; path facts come from `pathBindings[2]`. | `f4-declarations-semantic-tail.kernpart:1-18,72-91` | VERIFIED |
| Facts bytes | The facts ledger sums `Text.utf8Length(f4item(row))`, including exact framing. | `f4-declarations-semantic.kern:159-177`; `f4-line-eligibility.kern:240-247` | VERIFIED |
| Diagnostics bytes | C14 separately counts framed diagnostic rows and their UTF-8 bytes; it is neither facts total nor document-total bytes. | `f4-diagnostic-merge.kern:62-70`; parent F4-C14 at `kern-5-f4-declarations-modules/spec.md:159-185` | VERIFIED |
| Fatality | Fatal receipts expose no ordinary tape; rejected ordinary receipts retain facts and clear symbols/bindings. | M1.1 C10 at `kern-5-f4-m1-1-eligibility/spec.md:153-159`; `decoder.mjs:283-350` | VERIFIED |
| Stability | The root remains 109 inputs, receipt remains 17-field document `.2`, and changed KERN source regenerates composition/policy/cache identity. | M1.1 C9-C10 at `kern-5-f4-m1-1-eligibility/spec.md:143-159`; `worker.mjs:201-246` | VERIFIED |

## C13-LOCAL frozen contract

**[C13L-C1 DECIDED]** Before retention, every C13-LOCAL candidate invokes one common KERN fact-admission operation with its existing six-field row and current `factCount`, `factBytes`, and `workSteps`. It validates six fields, creates one `i<len>:` frame, measures `Text.utf8Length`, and checks prospective next count, fact bytes, and work against `maxFacts`, `maxEncodedBytes`, and `maxWorkSteps`. Only its admitted frame may reach `factParts.push`.

**[C13L-C2 DECIDED]** A malformed locally constructed row is `F4_AUTHORITY_DRIFT`; a prospective local count/bytes/work crossing is atomic `F4_LIMIT` before retention. Before `f4balancedtapefold`, the root first checks `factCount > maxFacts` and returns `F4_LIMIT`; only if that passes, it checks `factBytes > maxEncodedBytes` and returns `F4_LIMIT`. These sequential pre-fold invariants prevent an unadmitted over-cap facts tape from being copied; they do not replace prospective admission.

**[C13L-C3 DECIDED]** Facts and diagnostics use independent field-local UTF-8 ledgers. Facts sum complete framed fact entries; diagnostics retain the C14 sum of complete framed diagnostic rows. Both include framing and Unicode UTF-8 bytes. C13-LOCAL introduces no all-17-field receipt, JSON, module-set, or runtime-envelope byte metric.

**[C13L-C4 DECIDED]** Normal order stays source scanner order, then required presence authority order, then child attachment order, then root source order. There is no fact sort/deduplication. Unknown node/property and property admission remain fact-only; existing bare/malformed/missing diagnostics and C14 phase/rule ranks do not change.

**[C13L-C5 DECIDED]** The shared operation is portable KERN. It may reuse or extract the existing helper, but cannot invoke a host parser, create a public test seam, or take handwritten source above 500 lines.

**[C13L-C6 DECIDED]** Existing pairwise fold dry-run-before-copy behavior may remain. It is bounded finalization, not proof of global F4/C14 linear scaling; that broader performance closure remains M3 work.

## C13-GLOBAL — explicit M3 obligation

**[C13G-C1 DECIDED]** Every imported expression/path fact tape must be consumed by an advancing framed cursor. F4 validates framing and every six-field row before retention or limit debit, then charges exact framed count, field-local UTF-8 bytes, and consumption/admission work. A malformed expression transport wins as `F4_F2B_DRIFT`; malformed path/internal provenance wins as `F4_AUTHORITY_DRIFT`, even if a valid tape would exceed a cap. A valid next candidate over cap is `F4_LIMIT` before retention.

**[C13G-C2 DECIDED]** C13-GLOBAL is open M3/F4-R1 work. Its later tests prove cursor advance/no re-scan, no growing-prefix accumulation, exact cap boundaries, and drift-before-limit precedence. It does not alter C13-LOCAL ABI, receipt, or acceptance. Evidence: parent F4-R1/R2 at `kern-5-f4-declarations-modules/spec.md:343-352`; M3 at `.Codex/goals/KERN-5-COMPLETION-GOAL.md:151-160`.

## Options and blast radius

| Option | Decision | Reason |
|---|---|---|
| Admit all eight constructed-here branches via one helper plus pre-fold invariant. | Selected | Closes real local bypasses without imported-tape precedence changes. |
| Keep direct pushes and use late aggregate check. | Rejected | Violates no-retention-before-admission and false-greens tests. |
| Implement imported expression/path handling in this slice. | Rejected | It is M3 streaming/resource/drift work. |

| Path | Action | Reason |
|---|---|---|
| `examples/kern-frontend/f4-declarations-semantic.kern` | Modify or extract | Admit unknown-node/property/admission-rejection facts. |
| `examples/kern-frontend/f4-declarations-semantic-tail.kernpart` | Modify | Admit child/root facts and pre-fold count/bytes invariant. |
| `f4-line-eligibility.kern` or small helper | Modify if needed | Own the common portable operation. |
| `scripts/kern-frontend-f4-declarations/c13-local-facts.test.mjs` | Add | Cover caps, precedence, and structural no-direct-push invariants. |
| `policy.json` | Regenerate pins | Changed composition requires exact policy/cache identity. |
| Worker API, decoder, F4B, F5 | No behavior change | 109/.2 contract remains stable. |

## Binary acceptance matrix

Each public cap oracle first obtains a baseline, selects a positive preceding count, then asserts atomic crossing and exact-cap baseline preservation. Every fatal assertion checks empty declarations, occurrences, presence, attachments, decorators, symbols, bindings, facts, detached ordinals, and expression evidence. C13L-A10 is mandatory because public caps alone can false-green.

| ID | Fixture / mutation | Binary pass condition |
|---|---|---|
| C13L-A1 | Existing bare/malformed fixtures | Exact facts/diagnostics remain; next count/bytes/work crossing is atomic, exact cap preserves rejection. |
| C13L-A2 | Existing required-missing single/authority-order fixtures | Missing facts admit in frozen order; exact cap passes and next crossing is atomic. |
| C13L-A3 | Preceding local fact then unsupported `screen` | Target unknown-node crossing is atomic; exact cap retains it; later root fact is not target. |
| C13L-A4 | `module name=app stray unknown=x` | Cap after `stray` and before unknown property is atomic; exact cap retains order and no new diagnostic. |
| C13L-A5 | Frozen excluded-host-expression/type/raw fixtures, each prefixed by admitted fact | Each property-admission fact crosses prospectively; exact cap keeps old code/order and no invented diagnostic/raw payload. |
| C13L-A6 | Invalid explicit/closed child fixtures | Invalid-child crosses before retention; exact cap preserves detached state/order. |
| C13L-A7 | Unsupported-root fixture with preceding fact | Invalid-module-root crosses before retention; exact cap preserves root order. |
| C13L-A8 | Unicode local fact | Independent frame-byte calculation passes exactly, one byte lower fails atomically, including framing. |
| C13L-A9 | Authority mutation plus would-be local crossing | Atomic F4_AUTHORITY_DRIFT wins over F4_LIMIT. |
| C13L-A10 | Bounded source/AST guard over scanner, presence, attachment, root blocks | Every direct C13-LOCAL push not dominated by successful common admission rejects; renamed direct-push control rejects, admitted control passes. Structural/scaling guard only. |
| C13L-A11 | Pre-fold invariant guard | Count or facts bytes over cap returns F4_LIMIT before fold; no folded over-cap tape is reachable. |
| C13L-A12 | ABI and identity controls | Public shape unchanged; one F4A call; root 109; receipt 17-field .2; stale composition/policy pins reject. |
| C13G-M3-A1 | Expression imported tape | Future M3: malformed tape beats cap as F4_F2B drift; valid boundary limits; cursor cannot re-scan. |
| C13G-M3-A2 | Path imported tape | Future M3: malformed tape beats cap as authority drift; valid boundary limits; cursor cannot re-scan. |

## Out of scope

- Implementing or accepting C13-GLOBAL expression/path streaming admission.
- Total F4A receipt-byte or runtime-envelope byte accounting.
- New fact/diagnostic/rank/ABI/receipt fields or document `.3`.
- F1/F2B/F3 schema changes, F4B graph work, F5 projection, or global scale/RSS acceptance.

## Deploy order and skew

**[C13L-D1 VERIFIED]** This is an internal composition/policy identity change. Worker validation pins composition descriptors before execution while public shape stays stable. Deploy KERN source, regenerated composition entries, policy bytes/SHA/cache identity, and tests atomically; a mixed pair rejects before ordinary receipt acceptance. Evidence: `scripts/kern-frontend-f4-declarations/worker.mjs:30-80,201-246` and `scripts/kern-frontend-f4-declarations/policy-validation.mjs:162-196`.

## Corrections log

| Original claim | Correction | Effect |
|---|---|---|
| Local C13 covered only scanner/presence facts. | Invalid-child and invalid-module-root are also constructed in F4A and join the eight local families. | Complete local construction boundary. |
| All unadmitted facts were one M1.1 change. | Imported expression/path tapes are C13-GLOBAL M3 work; child/root are local. | Preserves transport precedence and scope. |
| Public F4_LIMIT proves prospective admission. | The late aggregate guard can yield the same receipt. | Structural no-direct-push and pre-fold guards are required. |
| F4B all-field bytes define C13 bytes. | F4A facts and C14 diagnostics have independent framed-leaf ledgers. | No invented total-receipt contract. |
