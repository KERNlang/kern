# KERN 5 M1 — F4A A1/A2/A11 Evidence Closure

**Status:** READY TO BUILD — evidence slice only; F4 acceptance remains pending
**Date:** 2026-08-21
**Confidence:** 0.97

## Executive summary

**[EA-S1 VERIFIED]** F4A already authenticates the complete 302-node, 1,149-property,
and 26-form authority transport in KERN before prerequisite replay or semantic output.
The root returns atomic `F4_AUTHORITY_DRIFT` when that check fails. Evidence:
`examples/kern-frontend/f4-declarations-main.kern:112-187` and
`examples/kern-frontend/f4-declarations-helpers.kern:185-217,322-349`.

**[EA-S2 DECIDED]** This slice supplies discriminating executable evidence for only
parent acceptance claims F4-A1, F4-A2, and F4-A11. It does not alter F4 semantics
unless that evidence first exposes a real semantic defect. It adds neither a receipt
field nor a host semantic decision.

**[EA-S3 DECIDED]** The A1 proof is an in-tree two-leg witness: the independently
probed equal-width sources `@trace\nfn name=WorldX\n` and
`@trace\ntype name=Main\n` are executed through F3 and F4A. Their F3 fields are
equal, while KERN-owned F4 rows differ. Historical checkouts, transcripts, and
hand-copied old results are not inputs or oracles.

**[EA-S4 DECIDED]** A2 executes the current F4A root with the complete authority
transport and with mechanical test-only transport perturbations. The host may select
an ordinal and copy, delete, duplicate, rotate, or substitute transport scalars; it
may not classify the source, choose an authority disposition, or manufacture a
receipt. KERN remains the sole authority that returns the fatal result.

**[EA-S5 DECIDED]** A11 proves the independent expression-boundary relation both at
policy admission and at receipt decoding. It separately proves zero expression,
failed-local-F2, and F2B-origin aggregate behavior, valid runtime crossing, and
overflow rejection. It does not change the existing `.4` policy, 109-argument
private root ABI, or 17-field document `.2` wire format.

**[EA-S6 DECIDED]** F4-A3 remains a required M1 semantic corpus obligation. M3 owns
only the scale and adversarial closure around it; this slice must not relabel A3 as
an M3-only requirement or accept it by counting the 26 authority rows.

**[EA-S7 VERIFIED]** The intentional pinned baseline is `d0631aff`, including the
landed C13-LOCAL work. This evidence slice is evaluated against that current tree;
it neither reopens C13 nor attributes its behavior to a historical checkout.

## Current state and evidence gap

| Parent claim | Current verified implementation | Missing acceptance-quality evidence |
| --- | --- | --- |
| F4-A1 | F3 can preserve complete geometry for equal-width role substitutions; F4 attaches a decorator only when its immediate same-indent successor kind is `fn`. | One in-tree test must prove the independently probed `fn`/`type` pair has equal F3 fields plus the required different F4 projection. |
| F4-A2 | The worker validates 302/1,149/26 source authorities, transports their ordered columns, and F4 compares every framed frozen row. Existing tests compare generated text and a small first-row mutation set. | Full executable 302/1,149 traversal and delete/duplicate/reorder/same-length-substitution witnesses, including a guard against a shortened comparison loop. |
| F4-A11 | The policy accepts `S + 1 <= B <= S + L`; the decoder recomputes local boundary entries from authenticated evidence. Existing test has endpoints, one small crossing, and two seal mutations. | Isolated interior/endpoints/crossing coverage, zero contribution, arithmetic overflow, and explicit independent decoder mutations for `S` and `B`. |

**[EA-R1 VERIFIED]** The committed F3 role-substitution test establishes the
appropriate evidence pattern: equal scalar width and byte-for-byte equal F3 fields
can coexist with candidate decorator runs. It is not the A1 fixture. Evidence:
`scripts/kern-frontend-f3-line-tree/fixtures.mjs:21-36` and
`scripts/kern-frontend-f3-line-tree/line-tree.test.mjs:79-89`.

**[EA-R2 VERIFIED]** F4 computes `attach` from the successor kind and indent inside
portable KERN; it emits an attached/dropped row from that decision and only attached
explicit decorators affect export targets. Evidence:
`examples/kern-frontend/f4-line-eligibility.kern:153-226`.

**[EA-R3 VERIFIED]** The current authority test proves generated-text inclusion and
only a finite mutation list; its sole ordinary F4 call has empty source. It is not
full executable row evidence. Evidence:
`scripts/kern-frontend-f4-declarations/authority.test.mjs:20-68`.

**[EA-R4 VERIFIED]** The KERN comparator checks row count, then loops through every
provided node, property, and keyword ordinal; `f4authoritydrift` separately pins
the 302/1,149/26 cardinalities, property ranges, and child tapes. Evidence:
`examples/kern-frontend/f4-declarations-helpers.kern:185-217,322-349`.

**[EA-R5 VERIFIED]** The policy validator requires positive safe-integer profile
limits, admits the two inclusive `B` endpoints, and rejects the values immediately
outside them. Evidence:
`scripts/kern-frontend-f4-declarations/policy-validation.mjs:169-195`.

**[EA-R6 VERIFIED]** For a nonfatal document, the decoder recomputes local
boundary entries as local expression scalars plus local evidence rows, compares both
the sealed scalar aggregate and boundary aggregate, and rejects mismatch. Evidence:
`scripts/kern-frontend-f4-declarations/decoder.mjs:283-350`.

## Frozen contract

| Surface | Frozen behavior | Evidence |
| --- | --- | --- |
| Public F4A | `runDocument(moduleId, source)` performs one F4A KERN invocation; it exposes no options or mutation capability. | `scripts/kern-frontend-f4-declarations/worker.mjs:274-276` |
| Private test seam | `__test` owns explicit mutation/profile helpers and is not reachable through the public entry point. | `scripts/kern-frontend-f4-declarations/worker.mjs:278-359` |
| Authority | The worker may load/hash/order/frame authorities; F4 authenticates them before F1/F2B/F3 drift checks. | Parent F4-C2/C3 at `kern-5-f4-declarations-modules/spec.md:99-108`; `f4-declarations-main.kern:150-184` |
| Result | F4A remains a 17-string `kern.frontend.f4-document.2` receipt. Fatal results have exactly one fatal diagnostic and no ordinary rows. | `scripts/kern-frontend-f4-declarations/decoder.mjs:283-350` |
| Policy and ABI | Policy remains `kern.frontend.f4-declarations-policy.4`; F4A private ABI remains 109. | `scripts/kern-frontend-f4-declarations/policy-validation.mjs:114-141`; `worker.mjs:201-246` |

**[EA-C1 DECIDED]** The evidence implementation may add a narrowly named
`__test`-only authority-vector mutator or observer if the existing string mutation
names cannot express an index and operation. It accepts only a mechanically checked
descriptor (`family`, `ordinal`, `operation`) and edits existing transport arrays.
It must not accept source classification, receipt fields, status, disposition choice,
or a callback that can replace the KERN result. The public `runDocument` export and
its two-argument shape are unchanged.

**[EA-C2 DECIDED]** Each A2 transport mutation starts from `prepare`'s actual
loaded/hash-pinned authority input and reaches the existing F4A root. The test may
use the current JSON authorities only to enumerate row count and select source bytes;
the pass/fail assertion is F4's decoded atomic fatal result, not a host-computed
classification.

**[EA-C3 DECIDED]** Every A2 drift result must be `fatal` with the sole diagnostic
code `F4_AUTHORITY_DRIFT` and empty declarations, property occurrences, presence,
attachments, decorators, symbols, bindings, facts, detached ordinals, and expression
evidence. This confirms that authority failure wins before semantic output.

**[EA-C4 DECIDED]** A1 defines its fixture literals in the new evidence test only:
`@trace\nfn name=WorldX\n` and `@trace\ntype name=Main\n`. It first asserts equal
source scalar length and complete equal F3 fields. It then calls public F4A once per
leg and asserts the `fn` leg is `classified` with the decorator attached, while the
`type` leg is `rejected` with the decorator dropped and exactly the existing
`DROPPED_DECORATOR` and `FRONTEND_UNSUPPORTED_MODULE_ROOT` diagnostics. The F4
receipt inequality is a supplemental control, never the acceptance oracle. The
committed F3 role-substitution fixtures remain an evidence-pattern control only and
are not reused as this witness.

**[EA-C5 DECIDED]** A2's exhaustive witness performs one unmutated F4A call with
the complete authority transport, then for every node ordinal `0..301` and property
ordinal `0..1148` performs a same-length whole-row cyclic substitution at that
ordinal. A whole node row includes its parallel node transport columns; a whole
property row includes all seven property columns. Every call must satisfy EA-C3.
This tests the last ordinal as well as the first and cannot pass if KERN silently
stops before an unvisited row. Each mutant performs exactly one F4A invocation;
the full F4/workspace wall is run once after the focused mutant matrix, never once
per mutant.

**[EA-C6 DECIDED]** In addition to EA-C5, A2 runs these mechanical perturbations
against each of the node and property families: remove one complete row, insert a
duplicate complete row, rotate/reorder two complete rows, and change exactly one
same-length scalar in a row. The duplicate and deletion cases prove cardinality
checks; reorder and scalar substitution prove ordinal/value identity. Existing
keyword reorder/profile drift coverage remains a control, not a substitute for the
302/1,149 witnesses.

**[EA-C7 DECIDED]** The A2 structural guard parses or bounds the KERN source block
for `f4authoritiesmatch` and requires all three cursor loops to be bounded by the
matching input lengths (`nodeIds.length`, `propertyNodes.length`, and
`keywordForms.length`) and to compare their complete framed rows. A renamed or
shortened-loop positive-control source snippet must fail the detector. This guard is
supplementary structural/scaling evidence; EA-C5's live KERN failures are the
semantic oracle.

**[EA-C8 DECIDED]** A11 uses `S = maxAggregateExpressionScalars`,
`L = maxF4LocalF2Calls`, and `B = maxExpressionBoundaryEntries` exactly as the
current validator does. It proves: an interior relaxed value; both exact endpoints
`B = S + 1` and `B = S + L`; lower and upper crossings `B = S` and `B = S + L + 1`;
and safe-arithmetic rejection when either required addition is not a safe integer.
All policy-only cases run `validatePolicy` and never fabricate a runtime receipt.

**[EA-C9 DECIDED]** A11's runtime witnesses are three separate public F4A cases.
First, a baseline with no expression evidence has local calls/scalars/boundaries all
zero. Second, an isolated quoted value whose local F2 parse fails has `L = 1`,
`S = 0`, and `B = 0`; it proves attempted local parsing is counted without invented
evidence. Third, a valid `{{...}}` F2B-origin expression has `L = 0` and `B = 0`;
its `S` may reflect authenticated F2B evidence and is not constrained to zero.
The existing mechanically repeated quoted-expression fixture then runs under a
small valid `(S,L,B)` profile: exact/under-cap input preserves its authenticated
header; the next local success returns atomic `F4_LIMIT` while the independent
`S` and `L` caps remain valid. The crossing assertion requires exactly the atomic
fatal `F4_LIMIT` diagnostic and every ordinary F4A partition empty; the under-cap
baseline must assert its exact decoded aggregate tuple. The test does not infer
aggregates from host parsing; it reads the decoded KERN receipt.

**[EA-C10 DECIDED]** A11 decoder mutations begin with a decoded, nonfatal receipt
whose evidence is unchanged. They independently change terminal-seal aggregate
slots for `aggregateExpressionScalars` and `expressionBoundaryEntries`, then call
`decodeDocument` with the actual prerequisite context. Each must reject as sealed
expression aggregate drift. No reseal, host repair, or changed evidence is allowed.

## Implementation options

| Option | Decision | Rationale |
| --- | --- | --- |
| In-tree F3/F4 two-leg witness, real F4 root authority mutations, and policy/decoder boundary oracles. | Selected | Tests the existing trust boundary without extending it. |
| Compare a current result to a historical checkout, transcript, or hand-recorded receipt. | Rejected | Non-reproducible and cannot prove current composition semantics. |
| Add a production authority probe, config toggle, global coverage ledger, or host-side semantic classifier. | Rejected | Changes the authority/ABI surface merely to test it and violates F4-C2. |
| Treat the 26 keyword rows as A3 completion. | Rejected | A3 is source-form semantic corpus evidence, not authority-count evidence. |

## File plan and blast radius

| Path | Change | Contract effect |
| --- | --- | --- |
| `scripts/kern-frontend-f4-declarations/a1-a2-a11-evidence.test.mjs` | Add focused executable A1/A2/A11 witness matrix and structural positive controls. | Test only. |
| `scripts/kern-frontend-f4-declarations/worker.mjs` | Add/extend a private, descriptor-validated `__test` transport mutator only if current names cannot express EA-C5/C6. | No public API, ABI, policy, result, or semantic change. |
| `scripts/kern-frontend-f4-declarations/authority.test.mjs` | Retain generated-authority text regeneration control; optionally move shared authority fixture helpers. | Test only. |
| `scripts/kern-frontend-f4-declarations/resource-limits.test.mjs` | Retain existing resource controls; optionally move shared A11 helpers without weakening them. | Test only. |
| `scripts/kern-frontend-f3-line-tree/fixtures.mjs` | No change; its committed role-substitution pair remains an evidence-pattern control only. | No F3 byte change. |
| `examples/kern-frontend/*.kern`, `policy.json`, decoder public contract, F0–F3 bytes | No planned change. | Frozen. |

**[EA-B1 DECIDED]** If an A1/A2/A11 RED reveals a defect, stop after tracing the
actual KERN path. Any necessary production repair is a separate semantic fix with
its own composition hash/policy identity update, focused regression, and independent
review. The evidence slice itself does not authorize speculative production edits.

## Binary RED and witness matrix

| ID | Fixture / mutation | Required result |
| --- | --- | --- |
| EA-A1 | Literal `@trace\nfn name=WorldX\n` versus `@trace\ntype name=Main\n`. | Equal complete F3 fields; one public F4A call per leg; exact `fn` classified/attached and `type` rejected/dropped with `DROPPED_DECORATOR` plus `FRONTEND_UNSUPPORTED_MODULE_ROOT`. Projection inequality is supplemental only. |
| EA-A2 | Unmutated full 302/1,149 transport. | One F4A call returns a decoder-valid ordinary receipt; KERN traverses actual complete authority vectors. |
| EA-A3 | Each of 302 cyclic whole-node substitutions. | Atomic `F4_AUTHORITY_DRIFT`, no ordinary row. |
| EA-A4 | Each of 1,149 cyclic whole-property substitutions. | Atomic `F4_AUTHORITY_DRIFT`, no ordinary row. |
| EA-A5 | Node and property delete/duplicate/swap/same-length-scalar mutations. | Each operation is rejected by the same KERN authority verdict; the test verifies index zero and final index. |
| EA-A6 | `f4authoritiesmatch` source guard plus renamed shortened-loop positive control. | Actual source passes; the control fails; no source-text result is accepted as semantic proof. |
| EA-A7 | Policy interior, lower endpoint, upper endpoint, and lower/upper crossing. | Interior/endpoints validate; crossings fail with the existing boundary floor/reachable classes. |
| EA-A8 | `Number.MAX_SAFE_INTEGER`-adjacent `S`/`L` profiles. | Each unsafe required addition rejects during policy validation before invocation. |
| EA-A9 | Zero-expression baseline, failed quoted-local F2, and valid `{{...}}` F2B-origin expression. | Respectively `(L,S,B)=(0,0,0)`, `(1,0,0)`, and `(0,S,0)` where F2B-owned `S` is decoded rather than invented. |
| EA-A10 | Quoted-expression below/next-local pair under valid small `(S,L,B)`. | Under-cap receipt reports its exact decoded aggregate tuple; next local success has exactly atomic `F4_LIMIT` and every ordinary partition empty, with `S` and `L` individually still valid. |
| EA-A11 | Independent seal-slot `S` and `B` mutations with unchanged evidence/context. | `decodeDocument` rejects each; no host recomputation/reseal makes it pass. |
| EA-A12 | Public/private isolation and identity control. | Public worker accepts exactly two arguments and cannot request a mutation; private test path remains non-exported from public production use; current policy/format/ABI identity validates unchanged. |

**[EA-T1 DECIDED]** Each fatal assertion uses the existing atomic receipt helper or
an equivalent exhaustive partition assertion. It must inspect every ordinary F4A
partition, not only status/diagnostics, so an early authority or boundary fatal
cannot false-green by retaining an interface row.

**[EA-T2 DECIDED]** The exhaustive A2 loop may be isolated in its own focused Node
test file and must remain deterministic and bounded by 302 + 1,149 executions plus
the named family controls. It is semantic acceptance evidence, not M3 throughput,
RSS, or adversarial scale proof. The focused matrix runs before one subsequent full
F4/workspace wall; it must not multiply that wall by its mutant count.

## Precedence and status semantics

**[EA-P1 DECIDED]** A2 authority drift must dominate prerequisite and semantic work:
the root checks `f4authoritydrift` before F1/F2B/F3 status/replay and before
`classifyf4available`. The witness checks only the existing `F4_AUTHORITY_DRIFT`
fatal contract and must not introduce a new code or host classification.

**[EA-P2 DECIDED]** A11 policy shape/arithmetic failures are worker-side validation
failures with no F4 invocation or receipt. A valid runtime aggregate crossing is the
existing atomic KERN `F4_LIMIT`. Decoder seal mismatches are decoder failures, not
new F4 result statuses.

**[EA-P3 DECIDED]** A1 is ordinary semantic differentiation, not a prerequisite
failure. The evidence asserts only F4-owned decorator row/diagnostic differences;
it does not change C6's status/severity vocabulary or prescribe unrelated rows.

## Deploy, skew, and gates

**[EA-D1 VERIFIED]** The worker pins all F4 composition SHA-256 descriptors before
runtime execution, and the policy validator pins the exact policy/ABI/result-format
identity. Evidence: `scripts/kern-frontend-f4-declarations/worker.mjs:49-85,201-251`
and `scripts/kern-frontend-f4-declarations/policy-validation.mjs:114-196`.

**[EA-D2 DECIDED]** Test-only changes deploy atomically with their tests. No
supported production skew, policy bump, receipt migration, source regeneration, or
F0–F3 artifact update exists for the selected path. If a later evidence RED needs a
production semantic repair, it becomes a separately reviewed composition/policy
identity deployment; this specification does not pre-authorize it.

**[EA-G1 DECIDED]** Required gates, in order: `git diff --check`; Node syntax check
for the new test; the focused A1/A2/A11 test; focused F3 role-substitution,
authority, resource-limit, document, and decoder tests; then the current
`pnpm test:kern-frontend-f4-declarations` wall and the core TypeScript build. An
independent review follows the applicable code/test risk policy. A green test-only
slice promotes none of F4-A1/A2/A11 until those gates and review are recorded.

**[EA-G2 DECIDED]** Slice completion requires no diff to the global
remaining-gates ledger, fitness policy, `scripts/kern-frontend-f4-declarations/policy.json`,
generated authority, F0–F3, or production KERN. A production KERN change is allowed
only after a focused RED traces a real defect and an explicitly separate defect branch
is opened; it is not an evidence-slice completion shortcut.

## Goal-truth correction (follow-up documentation only)

**[EA-GT1 DECIDED]** After a separately authorized implementation/gate record,
update `KERN-5-COMPLETION-GOAL.md` M1/M3 wording to state that A3 remains an M1
semantic corpus requirement, while M3 owns A3 scale/adversarial proof and C13-GLOBAL.
Update K5-CS3 only with the actual recorded A1/A2/A11 gate evidence; do not claim
F4 accepted or promote a terminal row.

**[EA-GT2 DECIDED]** The goal correction must describe source and gate provenance
without asserting that a locally observed hash equals `origin/main`. It may cite the
landed source revision and a reproducible command receipt independently, but must
not manufacture remote-state equality or publication authority. The goal retains its
existing separation of merge and publication authority.

## Out of scope

- F4-A3 source-form corpus, F4-A4/A5/A6 semantic closure, F4B/C15 graph work,
  F5 projection, and terminal-gate promotion.
- M3 scaling/RSS/wall claims, adversarial host-delegation corpus, and C13-GLOBAL
  imported expression/path streaming admission.
- New F0/F1/F2/F2B/F3 bytes, generated authority rows, transcript JSON, global
  coverage ledger, runtime configuration toggle, public worker option, or host
  semantic classification.
- Policy `.5`, document `.3`, module-set change, private ABI change, result-field
  change, new diagnostic/fact code, or a status/severity change.

## Corrections log

| Earlier ambiguity | Correction in this slice |
| --- | --- |
| Equal F3 geometry was treated as sufficient decorator proof. | A1 now requires the independently probed `fn`/`type` pair, equal F3 fields, and its specified different F4 KERN result; the committed `fn`/`let` fixture is only a pattern control. |
| Generated authority source inclusion was treated as full-table admission. | A2 requires live F4A execution, full ordinal substitutions, and structural loop canaries. |
| Endpoint policy tests and one scaled pair were treated as complete A11. | A11 adds interior/crossing/overflow, zero-expression, failed-local-F2, F2B-origin, and independent sealed aggregate mutations. |
| M3's scale wording could imply A3 moved out of M1. | A3 semantic corpus stays M1; only scale/adversarial evidence belongs to M3. |
