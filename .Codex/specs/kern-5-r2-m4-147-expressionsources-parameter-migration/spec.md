# M4.147 `expressionsources` parameter migration

Status: approved for implementation by the user's standing `go ahead`
authorization.

## Goal

Consume only the exact one-function, six-row `expressionsources` parameter
migration queue published by M4.146. Advance the canonicalizer base from
110/112 to 111/112 without changing the function body, the active KIR/profile/
runtime limits, or the remaining `quotesource` blocker.

## Claims and evidence

- [VERIFIED] M4.146 publishes exactly one canonicalizer witness,
  `examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources`, with six
  parameter rows and profile rows 205/332/6304.
  Evidence: `scripts/kern-canonicalizer/coverage-m4-146-combined-promotion.mjs:49-59`.
- [VERIFIED] The live `expressionsources` function still encodes the same six
  parameters in the legacy quoted `fn.params` property and contains no direct
  parameter children.
  Evidence: `examples/kern-canonicalizer/canonicalizer.kern:64-65`; command
  `node --input-type=module -e "<parameterMigrationRoots inspection>"` reported
  `props.params` and body digest
  `127f36b512e4a869031be1430f1d26b4ccee11a9a81e889ac2f6a45ccfcf0075`.
- [VERIFIED] The existing M4.142 queue-consumption contract authenticates the
  prior queue, requires the direct parameter prefix, preserves a semantic body
  digest, checks exact function facts/profile rows, and asserts cumulative
  coverage and residual IDs.
  Evidence:
  `scripts/kern-canonicalizer/coverage-m4-142-parameter-migration.mjs:36-99`.
- [VERIFIED] Historical coverage can safely measure an archived source through
  authenticated `sourceOverrides`; the override must name a declared corpus
  member and its bytes must match the archived policy digest.
  Evidence:
  `scripts/kern-canonicalizer/coverage-implementation.mjs:380-391`,
  `scripts/kern-canonicalizer/coverage-implementation.mjs:430-445`.
- [VERIFIED] M4.145 currently authenticates the live composition against the
  exact pre-M4.147 composite and record digests, so changing the main source
  requires explicit historical reconstruction rather than weakening those
  identities.
  Evidence: `scripts/kern-canonicalizer/combined-headroom-m4-145.mjs:124-152`.
- [VERIFIED] The current frontier already authenticates one residual function
  with exactly six text-character reasons, so consuming `expressionsources`
  must preserve that bounded `quotesource` exhaustion.
  Evidence: `scripts/kern-canonicalizer/coverage-current.mjs:117-157`.

## Contract

1. Replace only the legacy `params="..."` portion of the
   `expressionsources` signature with these direct children, in this order:
   `valueTag:string[]`, `valueParent:number[]`, `valueRole:string[]`,
   `valueOrder:number[]`, `valueText:string[]`, `valueBool:number[]`.
2. Preserve the exact function name, export bit, quoted `string[]` return,
   semantic body digest, function ordinal/path/id, and measured profile rows
   205/332/6304.
3. Authenticate that the consumed input equals the complete M4.146 queue.
   Publish an empty post-migration queue.
4. Require current coverage to be 111/112 with exactly one remaining legacy
   parameter blocker: `quotesource`.
5. Preserve the active M4.146 limits and the current one-function/six-reason
   bounded exhaustion. M4.148 owns fresh residual remeasurement; this slice
   does not alter `quotesource`.
6. Reconstruct the exact pre-M4.147 main source/composition for all historical
   M4.142-M4.146 evidence. Historical receipt digests remain unchanged.
7. Regenerate only derived live composition and coverage summaries whose
   authenticated source identities necessarily change.

## Red oracle

Before editing the KERN source, the new M4.147 migration test must fail because
`expressionsources` still exposes `fn.params`. The oracle must also reject:

- reordered, renamed, missing, duplicated, or mistyped parameters;
- name/export/return/body/identity/profile drift;
- a forged M4.146 input queue or non-empty post-migration queue;
- coverage other than 111/112 or any residual ID other than `quotesource`;
- historical composition drift.

## Acceptance

- Focused M4.147, historical composition, M4.143-M4.146, coverage,
  prerequisite, composition, and canonicalizer tests pass.
- `pnpm test:kern-canonicalizer` passes on Node 22.
- `pnpm fitness:kern-5` passes on the same tree.
- Exact `agon review uncommitted -e claude,codex,agy` reports no verified
  blocker after any accepted fixes are rerun through both gates.
- The Agon-signed commit is rebased onto current `origin/main`, pushed once to
  `main` under the user's standing authorization, and the remote SHA is
  verified.

## Blast radius and rollback

This changes one KERN function signature plus its generated composition,
coverage summaries, current milestone assertions, and historical source
reconstruction. No public API, package version, runtime policy, body semantics,
or `quotesource` behavior changes. Rollback is the single M4.147 commit; all
historical receipts remain independently authenticated.

## Out of scope

- Rewriting or migrating `quotesource`.
- Widening KIR, profile, runtime, or expansion limits.
- Starting M4.148 residual analysis.
- Claiming Alpha, Beta, RC, or KERN 5 completion.

## Options

The contract admits one real implementation: consume the exact authenticated
queue. Migrating `quotesource`, widening policy, or folding M4.148 into this
slice would violate the published milestone boundary and are not alternatives.

