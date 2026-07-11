# KERN 5 R0.4 Publication Recovery Drill

**Status:** COMPLETE
**Date:** 2026-07-11
**Confidence:** 0.99
**Parent:** `docs/kern-5-release-train.md` R0 exit gate
**Depends on:** R0.3 commit `76dd2f1d1616d01d828160fe19546bbb9ffccef2`
**Primary tribunal:** `tribunal-1783764821526-rge9bo-kern5-r0-recovery-drill`
**MiniMax/GLM red-team:** `tribunal-1783765221863-zohlfi-kern5-r0-recovery-drill-secondar`

## Executive Summary

R0.4 proves the R0.3 npm publication state machine can resume after every
mutation boundary without republishing matching bytes, accepting conflicting
bytes, moving a public tag out of order, or reporting an incomplete release as
successful. Failures before the `kern-lang` root marker resume forward from
live registry state. A failure in the post-promotion smoke, after the root
marker has moved, enters a narrow containment path: restore only configured
root/CLI entry tags from the durable pre-promotion snapshot, deprecate every
package at the failed release version, verify the restored entry channel, and
leave the workflow failed so a new patch or prerelease is required.

The validated release bundle, its durability receipt, the validated promotion
snapshot, its durability receipt, and live npm metadata remain the only
decision authority. The journal remains optional evidence. R0.4 adds no broad
dependency-tag rollback, mutable `broken-*` marker tag, unpublish action,
transaction claim, or automatic version selection.

## Current State / Root Cause

- [VERIFIED] R0.3 already captures a prior public-tag value, including `null`,
  for every package and binds the snapshot to source SHA, version, channel,
  staging tag, and artifact-manifest digest
  (`scripts/release/promotion.mjs:20-40`, `scripts/release/promotion.mjs:43-77`).
- [VERIFIED] Promotion permits only the snapshotted prior value or the planned
  version and moves `kern-lang` last, but an acknowledged registry mutation
  followed by a client error is currently treated as a hard failure rather
  than reconciled from live state
  (`scripts/release/promotion.mjs:89-167`).
- [VERIFIED] Version reconciliation skips an existing version only after exact
  metadata and integrity validation, but a publish command that stores bytes
  and then returns an error is not re-read before failure
  (`scripts/release/registry-metadata.mjs:45-108`).
- [VERIFIED] Packed KERN runtime dependencies and optional dependencies must
  equal the exact planned version. Old entry packages therefore cannot float
  onto the failed v5 dependency graph after their public tags are restored
  (`scripts/release/artifact-manifest.mjs:22-53`).
- [VERIFIED] The current smoke is the only operation that marks the journal
  successful, but smoke failure has no containment or recovery mode
  (`scripts/release/registry-reconciler.mjs:211-229`).
- [VERIFIED] The registry adapter exposes publish and add-tag mutations only;
  it has no remove-tag or deprecate-version operation
  (`scripts/release/registry-client.mjs:79-126`).
- [VERIFIED] The workflow runs promotion immediately before smoke and uploads
  the journal with `if: always()`, but it has no failed-smoke containment step
  (`.github/workflows/release-pipeline.yml:170-192`).
- [VERIFIED] The release workflow pins Node 22 and pnpm 10.32.1
  (`.github/workflows/release-pipeline.yml:29-38`), while the release policy has
  no machine-validated runtime requirement
  (`scripts/release/release-policy.json`).
- [VERIFIED] The journal ignores absent/corrupt prior evidence and suppresses
  persistence errors, so it is structurally suitable only as non-authoritative
  evidence (`scripts/release/journal.mjs:23-52`,
  `scripts/release/journal.mjs:92-103`).

## What Already Works

- The exact bundle, offline consumer wall, bundle recovery, and content-bound
  durability receipt remain unchanged.
- The promotion snapshot already contains the complete package tag map; R0.4
  does not add a second snapshot format or make a journal record authoritative.
- Exact internal version pins eliminate the primary tribunal's floated-range
  “Frankenstein” failure for KERN-owned dependencies.
- Dependency-first public promotion and the root-last marker remain the normal
  path. Before the root moves, recovery is forward-only.
- The workflow's global serialization and non-cancellation policy remain the
  concurrency control. R0.4 does not invent a dist-tag lock that npm cannot
  atomically acquire.

## Contract (Verified and Frozen)

> Verified against the cited R0.3 sources and both tribunals on 2026-07-11.

| Field / Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Decision authority | Valid bundle + receipt, valid snapshot + receipt, live registry metadata/tags | `registry-reconciler.mjs:159-208` | VERIFIED |
| Journal | Evidence only; deletion, corruption, or failed writes cannot alter mutations | `journal.mjs:23-52,92-103` | VERIFIED |
| Normal resume | Matching integrity/metadata is complete; mismatch hard-stops | `registry-metadata.mjs:45-108` | VERIFIED |
| Public commit marker | Configured `kern-lang` package moves last | `promotion.mjs:99-103` | VERIFIED |
| Snapshot tag domain | One prior public tag value for every planned package | `promotion.mjs:20-40,57-74` | VERIFIED |
| Internal graph | Every packed KERN runtime dependency is exact planned version | `artifact-manifest.mjs:22-53` | VERIFIED |
| Recovery authorization | Automated only when the workflow's promotion step succeeded and the following smoke step failed; manual mode requires the fixed reason `post-promotion-smoke-failed` | `.github/workflows/release-pipeline.yml:170-179` plus this spec | VERIFIED design decision |
| Recovery scope | Restore only policy-configured entry-package public tags; never dependency package tags | `docs/kern-5-release-train.md:130-135` | VERIFIED |
| Failed version disposition | Deprecate the planned version for every package after entry-tag restoration | npm versions are immutable; this spec | VERIFIED design decision |
| Recovery result | Contained or partially contained release remains a failed workflow and requires a new version | `docs/kern-5-release-train.md:132-135` | VERIFIED |

## State Machine

```text
BUNDLE_READY
  -> VERSIONS_RECONCILED
  -> STAGING_READY
  -> SNAPSHOT_DURABLE
  -> PUBLIC_PROMOTING
  -> ROOT_MARKED
  -> SMOKING
  -> SUCCEEDED

Any state before ROOT_MARKED:
  -> FAILED_RESUMABLE (rerun the same run, reconcile forward)

SMOKING failure after ROOT_MARKED:
  -> CONTAINING
  -> NON_ROOT_ENTRIES_RESTORED
  -> FAILED_VERSION_DEPRECATED
  -> ROOT_ENTRY_RESTORED
  -> RESTORED_ENTRY_SMOKED
  -> FAILED_CONTAINED (non-zero)

Any integrity, durability, third-party tag, or containment conflict:
  -> FAILED_TERMINAL (non-zero, no guessed mutation)
```

State names are explanatory outputs, not persisted authority. Every rerun
derives its next action again from validated immutable artifacts and live npm
state.

## Recovery Algorithm

1. Reload and validate the exact bundle and its durability receipt.
2. Reload and validate the promotion snapshot and its durability receipt.
3. Revalidate exact metadata/integrity and staging tag for every planned
   package.
4. Require the root public tag to equal the planned version. An interrupted
   containment retry may instead observe the snapshotted prior root tag only
   when the root package's planned version already has the exact deterministic
   recovery deprecation. Without that live containment marker, reject recovery
   and resume normal promotion.
5. Require every public tag to be either the planned version or, for configured
   entry packages only, its snapshotted prior value. Any third value is external
   interference and hard-stops before another mutation.
6. Restore each configured non-root entry tag to its prior value. If the prior
   value is `null`, remove the tag. After an ambiguous command error, re-read
   and accept only the exact desired state.
7. Deprecate every planned `name@version` with one deterministic,
   policy-configured message containing the source SHA. Repeating the same
   deprecation is idempotent. Do not add a mutable `broken-*` dist-tag.
8. Restore the configured root entry tag last. This is the containment commit
   marker: before it moves, the planned root still authorizes an interrupted
   retry; after it moves, its exact deprecation authorizes the retry.
9. Verify every restored entry tag from live registry state.
10. For every restored non-null entry tag, clean-install the entry package by
   channel, verify its installed name/version equals the snapshotted version,
   import its root export when present, and execute configured safe bins. For a
   null prior tag, verify tag absence instead.
11. Record evidence best-effort and return non-zero even when containment and
    restored smoke both succeed.

The automatic workflow calls this algorithm only after a failed smoke whose
preceding promotion step succeeded. `publish-recover --recovery-reason
post-promotion-smoke-failed` provides an idempotent operator retry if the
containment step itself is interrupted. `--dry-run true` performs steps 1-5 and
prints the exact planned mutations without writing registry or journal state.

## Ambiguous Mutation Rule

For publish, staging-tag, public-tag, restore-tag, remove-tag, and deprecation
commands, a command error is not proof that npm rejected the mutation. The
reconciler polls live state using the configured retry policy:

- desired exact state observed: accept the operation and continue;
- conflicting state observed: fail terminally;
- desired state never observed: rethrow a sanitized mutation failure.

No command is blindly repeated after an ambiguous acknowledgment.

## Failure-Drill Oracle

The test-only fake registry records a total ordered mutation trace and can fail
before or after applying one selected mutation. The production CLI exposes no
failpoint flag or environment variable.

The drill enumerates every concrete mutation in the two-package fixture and
reruns from the resulting registry state:

| Boundary | Injected outcomes | Required proof |
|---|---|---|
| package publish | before apply, after apply/error, stale read, conflicting integrity | forward resume; zero duplicate publish after apply; conflict stops |
| staging tag | before apply, after apply/error, stale read, external value | exact resume or terminal interference |
| public dependency tag | before apply, after apply/error, stale read, external value | forward resume; root remains prior until last |
| root marker | before apply, after apply/error, external value | forward resume before root; containment eligible only after root |
| exact smoke | install/import/bin failure | entry restoration, deprecation, restored smoke, non-zero |
| channel smoke | install/version/import/bin failure | same containment behavior, non-zero |
| containment mutation | before/after apply at every restore/remove/deprecate | idempotent `publish-recover` completes without tag thrash; root restores last |

Mutation killers must fail an implementation that republishes a matching
version, trusts journal state, promotes root early, restores dependency tags,
reports success before smoke, skips deprecation, accepts a third-party tag
value, or treats an acknowledged-but-erroring mutation as definitely absent.

## Release Runtime Contract

R0.4 adds policy fields for the release-tool Node major and package-manager
identity. Policy validation and repository consistency require them to match
the workflow's `setup-node` pin and root `packageManager`. The release CLI
rejects a mismatched Node major before packing, reading credentials, or making
registry calls. This records the release-machine contract only; it does not
claim a public minimum consumer Node version without a consumer compatibility
matrix.

## Implementation Plan

There is one viable option. Broad tag rollback contradicts the frozen train,
and journal-authoritative recovery contradicts R0.3, so alternatives would be
strawmen.

1. Add generic retry-after-ambiguous-mutation helpers and extend the registry
   adapter with remove-tag and deprecate-version argv operations.
2. Add a recovery module for entry restoration, deprecation, and restored-entry
   smoke; expose `publish-recover` and a strict dry-run/reason contract.
3. Harden current reconcile/promotion operations to adopt only an observed
   exact desired state after ambiguous command failure.
4. Add the exhaustive fake-registry failpoint matrix and mutation killers.
5. Add the failed-smoke workflow containment step and release runtime-policy
   validation.
6. Run release tests, repo consistency, lint, build, full tests, conformance,
   native KERN tests, runner smoke, final full-roster Agon review, then commit
   and push once.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `scripts/release/recovery.mjs` | add | limited restoration, deprecation, restored-entry verification |
| `scripts/release/recovery.test.mjs` | add | containment and idempotency contract |
| `scripts/release/failure-drill.test.mjs` | add | exhaustive mutation-boundary simulation |
| `scripts/release/registry-client.mjs` | modify | remove tag and deprecate exact version |
| `scripts/release/registry-metadata.mjs` | modify | reconcile ambiguous publish/tag acknowledgments |
| `scripts/release/promotion.mjs` | modify | reconcile ambiguous public-tag acknowledgments |
| `scripts/release/registry-smoke.mjs` | modify | expose safe restored-entry install verification |
| `scripts/release/registry-reconciler.mjs` | modify | `publish-recover` orchestration |
| `scripts/release/registry-cli.mjs` | modify | strict recovery reason/dry-run and runtime guard |
| `scripts/release/registry-test-fixtures.mjs` | modify | observable failpoint fake and new mutations |
| `scripts/release/release-policy.json` | modify | entry packages, deprecation message, runtime policy |
| `scripts/release/policy.mjs` | modify | validate recovery/runtime policy |
| `scripts/release/workflow-contracts.test.mjs` | modify | failed-smoke recovery and toolchain pins |
| `scripts/check-repo-consistency.mjs` | modify | runtime/workflow/package-manager drift wall |
| `.github/workflows/release-pipeline.yml` | modify | id'd promotion/smoke plus failed-smoke containment |
| `docs/kern-5-release-train.md` | modify | record R0 exit-gate implementation evidence |

Every new handwritten source file must remain below 500 lines. Test matrices
are split by release phase if they approach that boundary.

## Acceptance Criteria

- [x] Every publish, staging-tag, public-tag, root-marker, smoke, restoration,
      removal, and deprecation boundary is failed before and after application.
- [x] An applied publish followed by an error resumes with zero additional
      publish calls after exact registry metadata/integrity is observed.
- [x] Conflicting integrity or metadata hard-stops before any later mutation.
- [x] Applied tag mutations followed by errors are adopted only after the exact
      desired tag is observed; third-party values hard-stop.
- [x] Every failure before the root marker resumes forward and never restores a
      tag or deprecates a version.
- [x] Root moved plus exact or channel smoke failure restores only configured
      entry tags, deprecates all planned versions, verifies restored entries,
      and exits non-zero.
- [x] A null prior entry tag is removed and verified absent.
- [x] Interrupted containment resumes idempotently without changing dependency
      tags or duplicating effective mutations.
- [x] Missing/corrupt/stale journal yields the same registry mutation trace as
      no journal; journal write failure cannot block containment.
- [x] Missing/expired/mismatched bundle, receipt, snapshot, or receipt stops
      before registry mutation.
- [x] `--dry-run true` writes neither registry nor journal state and reports the
      exact proposed entry restorations and deprecations.
- [x] Workflow containment runs only after successful promotion plus failed
      smoke, and the overall job remains failed after successful containment.
- [x] Release CLI rejects the wrong Node major before artifact or registry I/O;
      workflow/runtime/root package-manager pins cannot drift independently.
- [x] The full R0-R0.4 release-policy suite, repo consistency, lint, build,
      package tests, differential conformance, native KERN tests, runner smoke,
      and final full-roster Agon review pass.

## Completion Evidence

- Release-policy suite: 168/168 tests pass, including mutation-boundary,
  snapshot-loss, rendered-message bound, and recovery-idempotency killers.
- Repository consistency, Biome lint, build, full package tests, differential
  conformance, native KERN tests, and runner/self-host smoke pass on this slice.
- Final full-roster review:
  `review-1783771521904-n7jukx-kern5-r0-recovery-drill-closure-` completed with
  zero verified findings; Kimi's panel parse failure was retried successfully as
  `review-1783772250063-bvlcb0-kern5-r0-recovery-drill-kimi-fin`.
- The final review's needs-check claims were reconciled against current source:
  rendered deprecation text is bounded before mutation, artifact limits are
  validated before template sizing, snapshot keys use exact set equality, and
  staging-tag validation is an explicit frozen recovery-authority requirement.

## Out of Scope

- npm unpublish or rewriting immutable package versions.
- Restoring dependency-package public tags after the root marker moves.
- Deprecating staged-but-still-resumable versions before root promotion.
- Mutable `broken-*` tags, journal authority, smoke-intent authority, or a
  second promotion-snapshot format.
- Automatic next-version selection, automatic new release dispatch, or release
  success after containment.
- Provenance/trusted-publisher setup, package signing, CDN invalidation, npm
  server transactions, or cross-registry replication guarantees.
- Public consumer Node-version support claims; those require a separate test
  matrix.

## Deploy Order

This slice ships as one stacked branch after R0.3. The runtime/recovery code,
policy, tests, and workflow land together; there is no supported mixed-version
window because the workflow calls only code from its checked-out SHA. Until the
branch is merged, R0.3 behavior remains active. After merge, old release runs
remain bound to their original SHA and artifacts; new runs use R0.4.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Secondary tribunal: R0.3 has no prior-tag snapshot | R0.3 snapshots every planned package's prior public tag and durably binds it before promotion | No new snapshot schema or authority is needed |
| Primary/secondary concern: restored old entries may float to new KERN dependencies | R0.3 rejects any packed internal runtime dependency not exactly equal to the release version | Limited entry restoration remains coherent for KERN-owned dependencies |
| Secondary recommendation: restore all moved public tags | The frozen train explicitly specifies root/CLI entry restoration and forbids backward/forward oscillation before root | Broad dependency rollback remains out of scope |
| Primary recommendation: add `broken-<run-id>` tag | npm dist-tags are mutable and would add a second recovery signal | Use deterministic exact-version deprecation only |
| Secondary recommendation: deprecate published-but-unpromoted versions | Before root, the same exact run is deliberately resumable and those versions may still become the accepted release | Do not taint a forward-resumable release |
| Primary recommendation: smoke-intent record proves authorization | A journal record cannot be authority, and changing the durable snapshot after upload would invalidate its receipt | Workflow control flow plus explicit operator reason authorizes containment; registry/snapshot still determine mutations |
| Secondary recommendation: add a registry lock | npm offers no atomic lock primitive; a lock-shaped dist-tag is another mutable race | Keep workflow serialization and live interference checks |
| First review: a pre-root operator retry could enter containment | The root public tag or an exact deterministic root deprecation must authorize containment | Restore the root last and use its exact deprecation as the interrupted-containment marker |
| Final review: a missing snapshot could be recreated after public promotion | Live tags can no longer reveal the true prior value after any public move | Fail closed and require recovery of the durable snapshot if any public tag already equals the planned version |
| Final review: sizing only the deprecation template is sufficient | Placeholder expansion can exceed the configured command-output bound | Validate the fully rendered deterministic message before the first registry mutation |

## Open Questions

None. No ASSUMED or OPEN claim feeds the recovery oracle.
