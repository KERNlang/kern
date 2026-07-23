# KERN 5 R2 M4.69 — Node-Row Parameter Migration

**Status:** IMPLEMENTED — REVIEW GREEN, PUBLISH PENDING
**Date:** 2026-07-20
**Confidence:** 0.99

## Executive Summary

[VERIFIED] Published M4.68 commit
`c0a84888c53325a5c7dd6e19ba4f002b6b28d1a4` promotes only the active
node-row ceiling from 28 to 30 and exposes one exact base-only parameter queue:
`examples/capstone-checker-subset/checker.kern#3:isSurfaceKind`, one row,
30/32/219, tool `checker`.

[DECIDED] M4.69 freezes the exact M4.68 prerequisite summary and migrates only
that function's legacy `kind:string` signature to one direct structured
`param`. Function identity, return contract, handler position, semantic body,
callers, active 30/50/388 policy, cumulative base, canonicalizer, runtime, KIR,
ABI, package versions, and historical receipts remain unchanged. KERN 5
remains incomplete.

## Published Input

[VERIFIED] The fresh branch starts at exact `origin/main` commit
`c0a84888c53325a5c7dd6e19ba4f002b6b28d1a4`.

[VERIFIED] M4.68 input bindings are:

- prerequisite summary SHA-256
  `0038f2a831533a8c6494a56a83cc4af96a50a2416d62de772707624cf634412c`;
- coverage summary SHA-256
  `c3b95e682d40254c1b9d9c96d38e72af47596168104c260ec6b83a45dbf576e2`;
- canonicalizer policy SHA-256
  `63f5cfdbf980ed1300bbe3a4d6be1e8409dc20ed9c51b13b1873ebafcd186826`;
- exact active profile 30/50/388, 77/104 base-complete functions, 26 legacy
  blockers, and 25 functions outside the sealed queue; and
- queue identity 1 function / 1 tool / 1 row with exact witness rows
  30/32/219 and active `exception-flow` residual family.

## Exact Target Contract

| Field | Required value |
|---|---|
| path | `examples/capstone-checker-subset/checker.kern` |
| function ordinal | 2 zero-based / 3 one-based |
| coverage id | `examples/capstone-checker-subset/checker.kern#3:isSurfaceKind` |
| name | `isSurfaceKind` |
| export | no |
| returns | `boolean`, unquoted |
| parameter | `kind:string` |
| pre/post profile rows | 30/32/219 |
| semantic body SHA-256 | `991be5df8acc62f68778b8c74efe2013b2d621cbe6c5423dbfdff60e28797e34` |

[DECIDED] The target loses only root property `params="kind:string"` and gains
exact direct child `param name=kind type=string` before the existing KERN
handler. The body digest and all other root properties remain exact.

## Source and Generated-Artifact Contract

[VERIFIED] Before migration, `checker.kern` is 447 lines, contains 24 function
roots, has SHA-256
`a2aa6ade4a9eb216b8264435bec7b2d63d556e4b980ddc0f8130f87b946d0d16`,
and has these nine legacy roots in authored order: `rejectLine`,
`isSurfaceKind`, `argProvenanced`, `paramCallsitesOk`, `indexRejectDetail`,
`mapKeyToken`, `mapKnownBefore`, `callRejectCode`, `checkModule`.

[DECIDED] Post-migration `checker.kern` must be 448 lines with the same 24
function roots and exactly eight remaining legacy roots: the pre-state list
without `isSurfaceKind`. No other handwritten corpus file may change.

[VERIFIED] Post-migration `checker.kern` is exactly 448 lines, retains 24
function roots, contains the required eight legacy roots in authored order,
and has SHA-256
`a703952e717a77015179987a4e5a6940b0b16846a9c122810e959a595eee5017`.

[VERIFIED] Pre-migration generated artifact digests are:

- checker main: `d3f2634afd1a52d27a50748a94e25cad67870eb9b54adec329939935e8818645`;
- numeric checker main: `4bef89f9e64ab8a5e8aa0341bce3a28d1b77439e496fd19e4d7da1194182de4a`;
- assertion main: `a9df3dca6aa1eb6aa705446e4bb37ee7934ce507fb059e791ca42ed624cc9a03`;
- validator main: `9ac7774a50ad9bcb7852340baf6844f130066f7eb004aa3b56e1974ce2a469b7`;
- canonicalizer composite: `94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56`;
- composition record: `cab6c1e38591e0a75cf717691c9d7247b623ddc849bc65bdf021cdcd3b914995`.

[DECIDED] Regenerate the checker aggregate through its repository writer after
the handwritten migration. Numeric checker, assertion, validator,
canonicalizer composite, and composition record must remain byte-identical.

[VERIFIED] The repository writer produces checker main SHA-256
`c73f0356534ee83eac5d81609d178fcbc67709a0c3ca291a62f79eeb9ad19c2e`;
every other pinned generated artifact remains byte-identical.

## Post-Migration Contract

[DECIDED] Consuming the sealed queue must produce exactly 78/104 base-complete
functions and 25 legacy `fn.params` blockers under unchanged active 30/50/388
policy. The base-only parameter queue must be empty. M4.69 records but does not
infer or implement the next residual action.

[DECIDED] Current live coverage and prerequisite summaries are regenerated only
after all source, oracle, and generated-consumer bytes settle. Historical M4.68
bytes are frozen independently before live summaries move.

[VERIFIED] The settled live state is 78/104 base-complete functions, 25 legacy
blockers, an empty 0-function/0-row parameter queue, bounded residual count 25,
and unchanged reason-assignment digest
`42ea4f41e325a8743710cb29b4f3b275dc2df7e2a233662d1e952df0568f8685`.
The active profile remains 30/50/388. Final live digests are:

- coverage summary: `b560b3db4986ef317946e795d4ae700d1a4fd9e3edc094f5788222e3d361bdf7`;
- prerequisite summary: `3d8f65eb97d522f4c585e35eac8a7840ccbd031fcee85c89ae322f7738b0d389`;
- coverage implementation: `fd676b3f50986582e76ee96ea93df91d02f36772234770359f35a2bcf5546251`;
- coverage policy: `10f2a65c811aef65be7cf0190017010f0bd79d5c6c5245221135ed9e2ca31fda`;
- corpus: `2d76f3cc2874f90ef24f070a4f342f22668659fc2ef472f4b754c1ac0ee7f2b2`;
- function facts: `869bfeb7d4694f22ae9c088c649be1c3750a4ca576eef651c7244c31bec0ddee`.

## RED and Mutation Plan

1. Add the exact one-target migration oracle and capture RED because the
   published source still exposes `props.params`.
2. Freeze `coverage-prerequisite-summary.json` byte-identically as the M4.68
   published receipt, digest-bound to commit `c0a84888` and a regular
   non-symlink canonical JSON path.
3. Replace only `isSurfaceKind`'s legacy signature with one ordered direct
   `param` child.
4. Regenerate only the checker aggregate and the live coverage/prerequisite
   summaries through repository-owned writers.
5. Pin target identity/body/signature/rows, source hash/lines, remaining legacy
   roots, generated artifacts, exact totals, prior migrations, and historical
   receipts.
6. Run focused, complete canonicalizer, and full Node 22 fitness gates; obtain
   high-risk role-lens review; create one Agon-signed commit; fetch/rebase; push
   once with `--no-verify` to fresh feature and authorized `main` refs; verify
   both remote hashes.

## Verification Evidence

[VERIFIED] The focused M4.69 cluster passed 74/74 tests. The complete
canonicalizer gate passed 258/258 tests, including the exact 17,552-row M4.67
structural floor witness. The full Node 22 `pnpm fitness:kern-5` wall passed
from repository consistency through the explicit final canonicalizer gate and
printed `KERN 5 current fitness wall passed.`

[VERIFIED] The first full wall exposed one stale historical-test assumption:
the M4.67 performance proof reconstructed its witness from the live corpus and
asserted that `isSurfaceKind` still used legacy `fn.params`. M4.69 intentionally
migrates that live root. The test now binds the target to the frozen M4.67 row
identity, asserts the live root's exact direct structured parameter prefix, and
leaves the historical M4.67 receipt byte-identical. The focused performance
test and the complete restarted fitness wall both pass.

[VERIFIED] Independent high-risk role-lens review completed with all 6/6
usable reviewers, zero verified findings, two non-blocking needs-check DRY
observations, and three nits. The DRY observations do not apply to this sealed
receipt architecture: milestone-local digest and validation contracts must not
inherit mutable shared state. The possible unused constant is referenced by
the current test; the M4.67 row comes from its digest-pinned receipt and is
cross-asserted against the live M4.69 target; the remaining source-root alias is
behavior-neutral. No material finding remains unresolved.

## Acceptance Criteria

- [x] Fresh branch starts at exact M4.68 commit `c0a84888`.
- [x] Queue, target, signature, body digest, source/artifact hashes, profile,
      and baseline are grounded.
- [x] RED fails because `isSurfaceKind` still uses legacy `props.params`.
- [x] M4.68 prerequisite summary is frozen byte-identically and source-bound.
- [x] Exactly one function gains exactly one ordered direct parameter.
- [x] Target identity, semantic body, handler, callers, returns, and export stay.
- [x] `checker.kern` is exactly 448 lines with eight expected legacy roots.
- [x] Checker main is writer-regenerated and all other pinned artifacts stay.
- [x] Coverage becomes 78/104 with 25 legacy blockers and an empty parameter
      queue under unchanged 30/50/388 policy.
- [x] Prior migrations and every historical receipt remain exact.
- [x] Focused, complete canonicalizer, and full Node 22 fitness gates pass.
- [x] Independent high-risk review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one atomic `--no-verify` push;
      feature and `main` refs verify identically.

## Stop Conditions

- Published M4.68 receipt bytes, digest, queue order, or source commit differs.
- Target ordinal, identity, signature, body digest, or profile rows differ.
- Any second function changes or migration needs policy/family/runtime/KIR work.
- Generated artifacts outside checker main drift.
- Post-state differs from 78/104, 25 legacy blockers, or an empty queue.
- Any required gate or verified review finding remains unresolved.

## Out of Scope

- Any migration outside the exact M4.68 queue.
- Any profile, family, parser, runtime, KIR, ABI, public API, package, or version
  change.
- Residual analysis, KIR v1 freeze, runtime cutover, RC publication, Fable work,
  or a KERN 5 completion claim.
