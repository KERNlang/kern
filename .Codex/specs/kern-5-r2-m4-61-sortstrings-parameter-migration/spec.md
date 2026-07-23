# KERN 5 R2 M4.61 — `sortstrings` Parameter Migration

**Status:** IMPLEMENTED — VERIFIED AND REVIEWED; PUBLISH PENDING
**Date:** 2026-07-23
**Confidence:** 0.98

## Executive Summary

[VERIFIED] Published `origin/main` commit
`828283e9694db3017dfc0121b6db8d6420f3988a` promotes exact
`while-iteration` into cumulative profile
`kern.kir-canonicalizer.profile.m4.60`. Live coverage is 72/104
base-complete with 31 legacy `fn.params` blockers. The authenticated
base-only migration queue is exactly one function, one tool, and one row:
`examples/selfhost-validator/validator.kern#19:sortstrings` at 25 node rows,
43 property rows, and 266 value rows.

[DECIDED] M4.61 migrates only that sealed legacy signature to one structured
direct `param` child. It preserves function identity, export/return contract,
handler position, semantic body, caller behavior, generated validator main,
canonicalizer bytes, profile/policy limits, promotion provenance, family
registry, and every historical receipt. The repository-owned checker aggregate
is regenerated because it embeds validator source line numbers. It then
regenerates live coverage to measure the next frontier; no subsequent migration
or exception-flow work is included.

## Published Input

[VERIFIED] The exact M4.60 boundary is:

- source commit `828283e9694db3017dfc0121b6db8d6420f3988a`;
- profile `kern.kir-canonicalizer.profile.m4.60`;
- 72/104 base-complete functions and 31 legacy `fn.params` blockers;
- policy SHA-256
  `d76a6f0acdc1b981014b192e424b150a7b802d44bd20bbdff31cd8bcafb5d76f`;
- coverage-summary SHA-256
  `0912893a2caf11c4132fa8c880d0835488e8254f42ea2599625133970e710836`;
- prerequisite-summary SHA-256
  `c24a3f59fab134a0845980550196f5d843c05d28986ea68a6e31642e3577dfdf`;
- coverage implementation SHA-256
  `122393317edb7cbd592ecad875e3d77b5cfa185a12c1f0f888bccef26b96f616`;
- validator source SHA-256
  `b8f2e779ced7577804686ac953cf555fffbc271b974bb29d64310245aa6270e2`;
- generated validator main SHA-256
  `9ac7774a50ad9bcb7852340baf6844f130066f7eb004aa3b56e1974ce2a469b7`;
- canonicalizer composite SHA-256
  `94ed7ac5d33f30d776f4171ee60d3c50fcf703fad97cf3734e629f9974007f56`.

## Exact Target Contract

[VERIFIED] `sortstrings` is function ordinal 19 of 21 in
`examples/selfhost-validator/validator.kern`. The current root is:

```kern
fn name=sortstrings params="xs:string[]" returns=string[] export=true
  handler lang="kern"
```

[VERIFIED] Its semantic body digest is
`2a5418abe4f41fc08fdf17b6822de65dfd444015884ed9f63093dbb7b1946bdf`.
Its only direct child is the handler, its only legacy row is `xs:string[]`,
and the M4.60 counterfactual proves the exact structured form completes under
the cumulative base at 25/43/266.

[DECIDED] The only handwritten source mutation is:

```kern
fn name=sortstrings returns=string[] export=true
  param name=xs type="string[]"
  handler lang="kern"
```

[DECIDED] The target guard must prove:

- `props.params` and quoted `params` metadata are absent;
- exactly one leading `param` exists before the handler;
- parameter name/type are exactly `xs` / `string[]`;
- function name, `returns=string[]`, and `export=true` remain exact;
- semantic body digest remains exact;
- the coverage fact retains the same id and 25/43/266 rows;
- `fn.params` is absent from exclusions and profile blockers are empty.

## Remeasurement Contract

[VERIFIED] Consuming the sealed one-row queue moves live coverage to 73/104
base-complete and 30 legacy parameter blockers. The regenerated base-only
parameter queue is empty. The only active family remains `exception-flow`, its
only non-empty closure completes zero functions, and the measured next action
is residual blocker analysis rather than another migration or promotion.

[VERIFIED] Current artifact evidence is:

- validator source SHA-256
  `99717668519d853fa83805189626957c1565a415dbfd135c9fe3b1abccfb46a4`;
- regenerated checker aggregate SHA-256
  `68b80ab1a720bc2de985fb624ce6f5d543c981d56fcd78816bc44b860a128020`;
- coverage policy SHA-256
  `00517a1a5e8958ed4158310a2c5c4815c9a8cf673d98e73f45c41f4edbae408e`;
- coverage summary SHA-256
  `07b9e09c860e803f493599eb809870916df470dfa66c488570d3129431c4a23e`;
- prerequisite summary SHA-256
  `135759db56ce009c72adedfc4caa0018e78709361388ad1b91ff33bf8c034dfd`;
- coverage implementation SHA-256
  `613810d0b74e31f21cd756520dbfe94047ba06ee654ef349a86663a32b517d83`;
- function-facts SHA-256
  `4ef2c486bbff42c35795789ac66e362863a357f5e7d6ca10dd77525576dc761d`;
- corpus SHA-256
  `1ce05b6867a583aef963ee5a8cd087c1865ca88173dc8c4432d3680a382078ae`.

[DECIDED] The M4.60 policy, cumulative profile, ten ordered promotions,
M4.58 while provenance, sole active `exception-flow` family, structural row
limits, denominator, and corpus membership remain unchanged. Any policy or
profile change stops the slice.

## RED and Mutation Plan

[DECIDED] Before source mutation, add an M4.61 target oracle that requires the
structured direct parameter and therefore fails on sealed M4.60 at the legacy
signature.

[DECIDED] Mutation coverage rejects restoration of legacy `params`, missing,
renamed, mistyped, duplicated, reordered, or post-handler parameters; changed
name, return type, export state, handler language, semantic body, witness id,
coverage exclusions, blocker set, profile rows, and parameter occurrence.

[VERIFIED] File-level guards pin the validator root count, line count, exact
remaining legacy-function list, validator source hash, unchanged generated
validator main, regenerated checker aggregate, unchanged
canonicalizer/composition artifacts, and all prior parameter migrations.

## Implementation Plan

1. Add this spec plus the M4.61 target/mutation oracle and capture RED against
   exact published M4.60.
2. Replace only `sortstrings` legacy `params` with the exact direct structured
   parameter.
3. Pin the post-migration validator source/body/signature contract and preserve
   generated consumers plus all earlier migration contracts.
4. Regenerate coverage/prerequisite receipts through the repository writer and
   update only measured current-frontier/status/release evidence.
5. Run targeted Node 22 tests, the complete canonicalizer gate, the full
   `fitness:kern-5` wall, and automatic high-risk role-lens review.
6. Commit with Agon identity, fetch/rebase immediately before one atomic
   `--no-verify` push to the feature ref and explicitly authorized `main`,
   verify both refs, and start the next slice fresh from `origin/main`.

## Expected File Surface

| File | Action | Reason |
|---|---|---|
| this spec | add/seal | shared migration and evidence contract |
| `examples/selfhost-validator/validator.kern` | modify | exact one-row migration |
| `coverage-m4-61-parameter-migration.mjs` | add | target/source/artifact guard |
| `coverage-m4-61-parameter-migration.test.mjs` | add | RED and mutation proof |
| generated checker aggregate | regenerate | validator source locations shift by one line |
| prior migration/current-frontier tests | modify | cumulative source and measured state |
| coverage checker/status tests | modify | exact M4.61 release facts |
| coverage/prerequisite summaries | regenerate | authenticated post-migration state |
| release train | modify | durable M4.61 evidence and next action |

## Acceptance Criteria

- [x] Fresh branch starts from published M4.60 `origin/main` commit
      `828283e9694db3017dfc0121b6db8d6420f3988a`.
- [x] The exact ordinal, legacy signature, body digest, profile rows, source
      hash, generated consumer, and live one-row queue are grounded.
- [x] RED fails first because sealed M4.60 still uses legacy `fn.params`.
- [x] Only `sortstrings` gains exactly one direct structured parameter.
- [x] Identity, body, handler, caller behavior, and generated validator main
      remain exact under mutation guards.
- [x] The checker aggregate is regenerated solely by its repository writer and
      binds the one-line validator location shift.
- [x] Every prior migration, promotion, provenance record, policy/profile
      limit, family/corpus contract, and canonicalizer artifact remains exact.
- [x] Live coverage/prerequisite receipts are regenerated from measured facts
      and bind the exact post-migration next action.
- [x] Targeted, complete canonicalizer, and full KERN 5 fitness gates pass.
- [x] Automatic high-risk role-lens review has no unresolved material finding.
- [ ] Signed commit is fetched/rebased immediately before one atomic
      `--no-verify` push; feature and `main` refs are remotely verified.

## Out of Scope

- Migrating any function other than validator `sortstrings`.
- Implementing, promoting, or widening `exception-flow`.
- Changing while semantics, the cumulative base profile, policy limits,
  family registry, corpus membership, parser, KIR, runtime, ABI, or exports.
- Editing generated validator fixtures or the KERN canonicalizer. The generated
  checker aggregate is intentionally writer-regenerated because it authenticates
  validator source locations.
- KIR v1 freeze, runtime cutover, Fable work, or a KERN 5 completion claim.

## Stop Conditions

- The target differs from ordinal 19, one `xs:string[]` row, or 25/43/266.
- Migration changes the semantic body, caller behavior, generated validator
  main, canonicalizer bytes, policy/profile semantics, or historical receipts.
- Live measurement requires another source migration or policy/family change
  in the same slice.
- Any targeted/full gate or terminal review finding remains unresolved.
