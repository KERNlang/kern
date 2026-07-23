# KERN 5 R2 M4.65 — Node-Row Parameter Migration

**Status:** IMPLEMENTED — VERIFIED — REVIEWED — PUBLISH PENDING
**Date:** 2026-07-23
**Confidence:** 0.97

## Executive Summary

[VERIFIED] Published M4.64 commit
`9f60e3c3a43dd029626466223effbc08b51696b2` raises only the active node-row
ceiling from 25 to 28. Its exact base-only queue contains four functions in two
tools and 37 legacy parameter rows. Live coverage remains 73/104 base-complete
with 30 `fn.params` blockers and 26 functions outside the sealed queue.

[DECIDED] M4.65 freezes the M4.64 prerequisite receipt and migrates only those
four legacy signatures to direct structured `param` children. Function identity,
parameter order/type, returns/export contract, handler position, semantic body,
callers, policy/profile semantics, canonicalizer bytes, runtime/KIR/ABI, and all
historical receipts remain exact. Current receipts and the repository-owned
checker aggregate are regenerated only after the handwritten mutations settle.
KERN 5 remains incomplete.

## Published Input

[VERIFIED] The exact M4.64 boundary is:

- source commit `9f60e3c3a43dd029626466223effbc08b51696b2`;
- M4.63 headroom receipt SHA-256
  `110260eb3a2c9ed942e309d5b6e1331f2752bc486bfe99840c887e2a6ef7e7c3`;
- policy, coverage-summary, and prerequisite-summary SHA-256 values
  `589de16d30335145b89dfe50f57721ae2424f580b659749d7b5de8f4f771257c`,
  `d7a284c00163199a247df6c6aeec13cde06cc786ca9a7423eacc619bfbc937c9`,
  and `9bba0c10b55e732392fa68dd7f7174135a4ff380875e15ea787e045b46d5610f`;
- coverage implementation, function-fact, and corpus digests
  `5b3bfb87d739d37d9617fdbe22e97febc214edda298199764d0b756c51eee3f9`,
  `4ef2c486bbff42c35795789ac66e362863a357f5e7d6ca10dd77525576dc761d`,
  and `1ce05b6867a583aef963ee5a8cd087c1865ca88173dc8c4432d3680a382078ae`;
- active profile 28/50/388, base identity
  `kern.kir-canonicalizer.profile.m4.60`, 73/104 completion, and 30 legacy
  blockers; and
- exact queue 4 functions / 2 tools / 37 rows with 26 residual functions.

## Exact Target Contract

| Function | Ordinal | Export | Params | Rows N/P/V | Body SHA-256 |
|---|---:|---|---:|---:|---|
| `checker-while.kern#1:isSafeMagnitude` | 1 | no | 2 | 27/39/288 | `c59ee3eaea805e80363c3ce62b8ab4af3786f77fda9364f94eaa5d47d75b511b` |
| `checker.kern#22:mapCallRejectDetail` | 21 | no | 13 | 28/42/309 | `072e5e4f3e8d483b5f86db3eb6b041a195cac734a65e30e66ccff9d7581999ba` |
| `validator.kern#10:fnokat` | 10 | yes | 8 | 28/38/270 | `396cb0c68e779689979d21d774a27db0df5cd05588b3a3f469bc05de3a25dd87` |
| `validator.kern#12:ownexportkind` | 12 | yes | 14 | 28/48/260 | `b9939d73ba23e8e52beb618584d80074a5ada3248914f12bc0fe2505d76be083` |

[VERIFIED] Parameter pairs, in exact order, are:

- `isSafeMagnitude`: `raw:string`, `start:number`;
- `mapCallRejectDetail`: `callId:number`, `callStmtKind:string[]`,
  `callMemberProp:string[]`, `callStmt:number[]`, `callFn:string[]`,
  `callMemberObject:string[]`, `argCall:number[]`, `argOrdinal:number[]`,
  `argKind:string[]`, `argName:string[]`, `stmtKind:string[]`,
  `stmtFn:string[]`, `stmtTarget:string[]`;
- `fnokat`: `idx:number`, `fnName:string[]`, `fnReturns:string[]`,
  `fnAsync:number[]`, `fnStream:number[]`, `fnHandlers:number[]`,
  `fnParams:string[]`, `paramFn:number[]`; and
- `ownexportkind`: `module:number`, `name:string`, `fnModule:number[]`,
  `fnName:string[]`, `fnReturns:string[]`, `fnAsync:number[]`,
  `fnStream:number[]`, `fnHandlers:number[]`, `fnParams:string[]`,
  `fnExport:number[]`, `paramFn:number[]`, `classModule:number[]`,
  `className:string[]`, `classExport:number[]`.

[DECIDED] Each target loses only its root `params` property and gains the exact
ordered direct `param` prefix before the existing KERN handler. The body digest
and all other root properties must remain unchanged.

## File and Artifact Contract

[VERIFIED] Pre-migration handwritten source contracts are:

| Path | Lines | Functions | SHA-256 |
|---|---:|---:|---|
| `examples/capstone-checker-subset/checker-while.kern` | 301 | 18 | `424a5a3fc76a149efd6ba4ae8358dc025e06bed6873d466ba42d4fba19e8c46b` |
| `examples/capstone-checker-subset/checker.kern` | 434 | 24 | `61453a2f2aec5de05973bf0c6a0c9e84e9f00d7d501a80993ea02f57a518fd2d` |
| `examples/selfhost-validator/validator.kern` | 514 | 21 | `99717668519d853fa83805189626957c1565a415dbfd135c9fe3b1abccfb46a4` |

[DECIDED] Exact post-migration line counts are 303, 447, and 536. Remaining
legacy roots are four in checker-while, nine in checker, and three in validator.
No other handwritten corpus member changes.

[VERIFIED] Before migration, generated checker, numeric checker, validator,
assertion, canonicalizer composite, and composition-record SHA-256 values are
`68b80ab1a720bc2de985fb624ce6f5d543c981d56fcd78816bc44b860a128020`,
`4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a`,
`9ac7774a50ad9bcb7852340baf6844f130066f7eb004aa3b56e1974ce2a469b7`,
`a9df3dca6aa1eb6aa705446e4bb37ee7934ce507fb059e791ca42ed624cc9a03`,
`94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56`,
and `cab6c1e38591e0a75cf717691c9d7247b623ddc849bc65bdf021cdcd3b914995`.

[DECIDED] The checker aggregate is regenerated by its repository writer because
it embeds all three changed source files and their locations. Numeric checker,
validator main, assertion main, canonicalizer composite, and composition record
must stay byte-identical.

[VERIFIED] The post-migration handwritten SHA-256 values are
`84ca20346a655595cbaab095e3b46b964e46acabd90ead29d1d1a3c6813e8b60`,
`a2aa6ade4a9eb216b8264435bec7b2d63d556e4b980ddc0f8130f87b946d0d16`,
and `a9d278832edf050f3a96699980d88fa740f345d85192222b241bb6cc3ac2a2ee`.
The writer-regenerated checker aggregate is
`d3f2634afd1a52d27a50748a94e25cad67870eb9b54adec329939935e8818645`;
the five artifacts required to remain unchanged match their published hashes.

## Post-Migration Contract

[DECIDED] Consuming the sealed queue must produce exactly 77/104 base-complete
functions and 26 legacy `fn.params` blockers. The base-only parameter queue must
be empty without changing the active 28/50/388 profile, cumulative base,
promotion provenance, active `exception-flow` family, corpus membership, or
denominator. The 26-function residual blocker state determines M4.66; M4.65
does not infer or implement that next action.

[VERIFIED] The implemented post-state is exactly 77/104 base-complete, 26
legacy blockers, 26 residual functions, and an empty parameter queue. The
active profile remains 28/50/388 with base identity
`kern.kir-canonicalizer.profile.m4.60`; the exception-flow assignment digest
remains `68108254cf57ba70b019f6556c6808e585eeb63355078b7f9c243271fdb989c6`.
Current coverage-summary, prerequisite-summary, policy-file, coverage
implementation, function-fact, and corpus SHA-256 values are respectively
`22590f4e83fa52f239e0cb31359c83235b37690f6ad7036055cf0c33fd5dfb19`,
`5f15dd8f025f11812842471e4ed8f2e18a0529cbc28360d4eae78b6e8862ddaf`,
`b3f720fb34255cf93466430c17924fd9f3b6f81b588cae8a0526dc598ed8cfcf`,
`acac325be26eb7ec7ebdfbb0d5d1b7446a056333e63c3183d17e4fb322d56c8c`,
`5b2b03d3e5659e391462f3591416d3d032bf9becef42658396bf894af86bc4d1`,
and `e7acd4b5bcec72247b44347e90664fbe064d56380994078b312984e4ce68733c`.

## Independent Review

[VERIFIED] Agon review `review-1784813178263-0wmm11` routed high risk to all
six usable engines with automatic overall, security, correctness, dryness, and
performance lenses. All six completed: zero verified findings, one needs-check,
zero speculative findings, and four nits.

[VERIFIED] The needs-check observation correctly identifies repeated live-corpus
file and artifact contracts across historical target oracles, but it does not
identify incorrect data or behavior. Those repetitions independently bind each
historical migration target to the current corpus; centralizing them is a
separate cross-milestone refactor with a wider regression surface and is not a
required M4.65 correction. The remaining notes are hypothetical with the
current complete path maps, pre-existing architectural debt, or explicitly
non-blocking naming/style suggestions. No material finding remains unresolved.

## RED and Mutation Plan

1. Add an M4.65 target oracle that requires all 37 structured rows and capture
   RED against the unchanged M4.64 legacy signatures.
2. Freeze the exact M4.64 prerequisite summary as a canonical, digest-bound,
   regular non-symlink published handoff tied to `9f60e3c3`.
3. Replace only the four target legacy `params` properties with exact ordered
   direct `param` children.
4. Regenerate the checker aggregate and current coverage/prerequisite receipts
   through repository writers; update corpus digests to the measured source.
5. Pin target identity, body, signature, rows, source hashes/lines, remaining
   legacy roots, generated artifacts, prior migrations, historical receipts,
   and exact post-migration totals.
6. Run focused tests, complete canonicalizer, full Node 22 `fitness:kern-5`,
   high-risk role-lens review, targeted review-fix gates, signed commits,
   fetch/rebase, one atomic authorized push, and remote hash verification.

## Acceptance Criteria

- [x] Fresh branch starts at exact M4.64 commit `9f60e3c3`.
- [x] Exact queue, targets, signatures, body digests, source/artifact hashes,
      policy, profile, and baseline are grounded.
- [x] RED fails on the published corpus because the target roots expose legacy
      `props.params` instead of the required direct structured parameter rows.
- [x] M4.64 prerequisite receipt is frozen byte-identically and source-bound.
- [x] Exactly four functions gain exactly 37 ordered direct parameters.
- [x] Target identity, body, callers, handler, returns, and export state remain.
- [x] Handwritten source line counts are exactly 303/447/536 and only expected
      legacy roots remain.
- [x] Checker aggregate is writer-regenerated; all other pinned artifacts stay.
- [x] Coverage becomes exactly 77/104 with 26 legacy blockers and no base-only
      migration queue under unchanged 28/50/388 policy.
- [x] Prior migrations and every historical receipt remain exact.
- [x] Focused, complete canonicalizer, and full Node 22 fitness gates pass.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push;
      feature and `main` refs verify identically.

## Stop Conditions

- Published M4.64 receipt bytes, digest, queue order, or source commit differs.
- Any target ordinal, identity, signature, body digest, or profile rows differ.
- A fifth function changes or any target needs a policy/family/runtime/KIR edit.
- Generated artifacts outside the checker aggregate drift.
- Post-state differs from 77/104, 26 legacy blockers, or an empty migration queue.
- Any required gate or verified review finding remains unresolved.

## Out of Scope

- Any parameter migration outside the exact M4.64 queue.
- Any profile, family, parser, runtime, KIR, ABI, public API, package, or version
  change.
- Exception-flow work, residual promotion, KIR v1 freeze, runtime cutover,
  release-candidate publication, Fable work, or a KERN 5 completion claim.
