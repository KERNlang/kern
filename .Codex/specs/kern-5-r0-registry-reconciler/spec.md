# KERN 5 R0.3 Registry Reconciler

**Status:** IMPLEMENTED - FINAL VERIFICATION
**Date:** 2026-07-10
**Confidence:** 0.93
**Parent:** `docs/kern-5-release-train.md` R0 items 5-10
**Depends on:** R0.2 commit `59ce74d8aae1553a884f15b257d880aeb19f18fe`
**Tribunal:** `tribunal-1783709030448-m4ifxi-kern5-r0-registry-transaction`
**Durable-bundle brainstorm:** `brainstorm-1783709314875-mifl19-kern5-r0-durable-bundle`

## Executive Summary

R0.3 replaces live-workspace recursive publication with a resumable registry
reconciler over the exact R0.2 release bundle. It does not claim transactions,
atomic npm publication, hidden staged versions, or reliable rollback of every
dist-tag. It makes each decision from `ReleasePlan v1`, `ArtifactManifest v1`,
the recovered exact tarball bytes, and current npm registry state.

Before the first npm mutation, the workflow persists one immutable GitHub
Actions release-bundle artifact containing the plan, manifest, bundle index,
and all 22 tarballs. A rerun of the same workflow run recovers those original
bytes instead of repacking. Before the first public-channel tag move, it also
persists an immutable promotion snapshot containing the prior public tags.

The runtime journal is evidence only. It may explain what happened, but it is
never read to decide whether a package is complete or which operation comes
next.

## Claim Ledger

- [VERIFIED] R0.2 produces exactly 22 dependency-ordered public package
  tarballs and records their packed metadata, sizes, and SHA-512 integrity.
- [VERIFIED] The current publish workflow still bypasses those tarballs and
  runs `pnpm -r publish` over the live workspace.
- [VERIFIED] npm accepts a gzipped tarball path as the publish input, submits a
  SHA-512 integrity value, permanently reserves a published name/version, and
  applies `latest` unless an explicit `--tag` is supplied.
- [VERIFIED] Current npm registry metadata for `@kernlang/core@4.5.0` and
  `kern-lang@4.5.0` exposes `dist.integrity`; both packages currently have
  `latest=4.5.0` and an older `canary` tag.
- [VERIFIED] GitHub Actions reruns retain the original `GITHUB_SHA` and
  `GITHUB_REF`; the Actions artifact API can list artifacts for a run and
  exposes artifact identity, expiry, source SHA, and archive digest.
- [VERIFIED] Current `upload-artifact` artifacts are immutable and return an
  artifact id and digest.
- [VERIFIED] Only a subset of the 22 package manifests declares a public
  repository field, and npm trusted-publisher configuration is not represented
  in this repository.
- [INFERRED] On the configured npmjs registry, equality between local tarball
  SHA-512 integrity and registry `dist.integrity` is the correct immutable-byte
  recovery comparison because npm documents submitting the tarball SHA-512.
- [INFERRED] A staging tag prevents package-by-package movement of `latest` or
  `canary`, but does not hide the uploaded version from exact or SemVer-range
  consumers.
- [OPEN] Organization-level npm trusted publishing is configured for every
  package. R0.3 must not claim or require it until inspected externally.

## Corrections to the Initial Tribunal

| Tribunal claim | Verified constraint | Decision |
|---|---|---|
| Build a registry transaction | npm has no atomic multi-package transaction | name and implement a reconciler |
| The journal can drive resume | runners and journal uploads may disappear | derive every decision from manifest, bundle bytes, and live registry |
| Drop staging tags and publish under the channel tag | `npm publish` always applies a tag; direct channel publication moves public tags package-by-package before reconciliation | retain a version-specific staging tag solely to protect public tag pointers, never as visibility isolation |
| A fresh run can repack and compare | R0.2 does not promise cross-pack byte identity | recover an immutable original bundle; hard-stop if it is unavailable after partial publication |
| Registry proxies may normalize tarballs | the release policy targets npmjs, whose publish contract records tarball SHA-512 | bind the client to the configured registry and fail closed on mismatch; alternate registries are outside R0.3 |

## Non-Atomicity Model

The reconciler recognizes three different boundaries:

1. **Version upload boundary:** immutable and immediately visible. A staging tag
   changes only the default/tag install pointer; it does not hide the version.
2. **Public package tag boundary:** mutable and individually visible. There is
   an unavoidable direct-package window while dependency tags move.
3. **Root commit-marker boundary:** `kern-lang@<channel-tag>` moves last. Until
   it moves, the release is operationally incomplete even if dependency tags
   already point to the new version.

The implementation must never use words such as atomic commit or rollback
without qualifying the exact boundary.

## Scope

### Included

1. Create and validate `ReleaseBundle v1` from the R0.2 plan, manifest, and
   exact tarball directory.
2. Give the bundle a deterministic name from configured prefix, full source
   SHA, and resolved version.
3. Recover an unexpired exact-name bundle from the current GitHub workflow run
   before deciding to repack.
4. Verify recovered plan/manifest identity and every tarball path, size, digest,
   packed name/version, runtime pins, exports, and bins.
5. Upload a newly created bundle with immutable/no-overwrite semantics before
   the first npm mutation.
6. Query configured npm registry state and classify each package version as
   missing, exact match, or conflict.
7. Publish only missing exact tarballs under a deterministic version-specific
   staging tag, dependency-first.
8. Poll and verify every uploaded or pre-existing version before proceeding.
9. Reconcile the staging tag for every exact version and verify it.
10. Capture all current public channel tags in `PromotionSnapshot v1` after
    version reconciliation and before public promotion.
11. Persist that immutable snapshot before the first public tag move.
12. Promote dependency-first and `kern-lang` last, verifying every move.
13. Write an append-only-in-meaning JSON journal after each observed or
    attempted operation and upload it with `if: always()` under a unique
    run-attempt name.
14. Run exact-version and channel consumer/CLI smoke after promotion.
15. Remove the live-workspace `pnpm -r publish` path once the reconciler is
    load-bearing.
16. Run the complete release wall inside real publish mode, regardless of an
    earlier preflight result.

### Excluded

- Claiming that staged versions are hidden or isolated.
- Treating a local or uploaded journal as recovery authority.
- Searching arbitrary historical workflow runs for a similarly named bundle.
- Repacking after any version from the release is present in npm.
- Automatically deleting published versions.
- Automatically moving public tags backward before the root marker moves.
- Full failure injection after every package and tag boundary; R0.4 owns the
  exhaustive recovery drill over the R0.3 seam.
- Enabling provenance or trusted publishing before all package metadata and npm
  organization configuration are verified.
- Supporting registries other than the configured npmjs endpoint.

## ReleaseBundle v1

The bundle directory contains only:

```text
release-bundle.json
release-plan.json
artifact-manifest.json
artifacts/<exact 22 manifest tarball filenames>
```

`release-bundle.json` is canonical JSON:

```json
{
  "schemaVersion": 1,
  "sha": "40 lowercase hex",
  "channel": "stable",
  "version": "5.0.0",
  "bundleName": "kern-release-<sha>-5.0.0",
  "releasePlanSha512": "128 lowercase hex",
  "artifactManifestSha512": "128 lowercase hex",
  "packageCount": 22
}
```

Rules:

- No timestamp, runner path, artifact id, run id, or journal field enters the
  bundle index.
- Bundle name prefix and retention days are release-policy fields.
- Bundle name must be safe for GitHub Actions and bounded in length.
- The full SHA, not a short SHA, is part of identity.
- The bundle validator rejects every missing, duplicate, extra, nested, or
  symlinked file.
- Recovery re-runs R0.2 tar inspection and manifest reconstruction; matching
  the outer GitHub artifact digest alone is insufficient.

## Registry Version Reconciliation

For each package in ReleasePlan order:

```text
GET configured registry package@version
  404/missing -> npm publish <exact absolute .tgz> --tag <staging> ...
  exists      -> validate registry identity and metadata
                   exact match -> skip upload
                   any mismatch -> hard stop, require a new version
```

Exact registry match requires:

- registry name and version equal the plan;
- `dist.integrity` equals manifest integrity;
- internal `dependencies` and `optionalDependencies` equal the manifest's exact
  runtime dependency set and version;
- normalized exports and bins equal packed manifest values.

After a publish command returns, the reconciler polls registry reads using
policy-configured attempts, delay, request timeout, and command-output limit.
It does not trust command exit alone.

If any version already exists but the original bundle is unavailable, the
workflow hard-stops before repacking. The operator must recover the artifact
within retention or issue a new prerelease/patch version.

## Staging Tag

The default configured form is:

```text
kern-stage-<resolved-version>-g<sha8>
```

Rules:

- Prefix is policy-configurable and starts with a nonnumeric lowercase letter.
- The resolved version is normalized to the existing dist-tag character set.
- The tag must not equal any public channel tag.
- The same plan always derives the same staging tag.
- All 22 staged tags must point at the exact version before public promotion.
- The tag is an operational breadcrumb only; the version is already public.

## PromotionSnapshot v1

The snapshot contains plan identity, manifest digest, staging tag, public tag,
and the prior public-tag value or explicit absence for all 22 packages. It is
canonical and contains no credentials.

The workflow uploads it immutably before public promotion. On rerun it recovers
the exact snapshot for the current workflow run. The promoter validates each
live tag as either the recorded prior value or the target version. Any third
value is external interference and hard-stops.

Promotion order is dependency-first with `kern-lang` forced last. A failure
before the root marker moves leaves the release incomplete and resumes forward;
it does not oscillate dependency tags backward. R0.4 will exercise the special
post-root failure procedure using the durable prior-tag snapshot.

## Journal v1

The journal records:

- schema, run id/attempt when available, plan identity, bundle digest;
- ordered events with wall-clock time, phase, package, operation, outcome, and
  redacted error summary;
- final observed registry classification and tag state.

The journal writer uses atomic replace for each update so a readable prefix is
preserved. It never records tokens, authorization headers, registry responses
outside the bounded normalized fields, or full command environments.

Production code never reads journal events to choose an operation.

## Provenance Boundary

R0.3 defines two provenance states, but only the first is executable in this
slice:

- `disabled-unverified`: current default; do not pass `--provenance` and state
  clearly that provenance is not established.
- `required`: reserved and rejected until a repository consistency oracle proves every
  public packed manifest has the correct repository field and the operator has
  separately recorded npm trusted-publisher verification.

Because organization configuration cannot be proven from this repository,
this slice keeps `disabled-unverified`. It must not silently infer provenance
from GitHub Actions `id-token` permission.

## Workflow Contract

Real publish mode performs:

1. compute and persist ReleasePlan;
2. set versions and run repository consistency;
3. build and run full tests, native KERN, conformance, and runner smoke;
4. derive bundle name and query current-run artifacts;
5. recover and verify the existing exact bundle, or pack/test/create a new one;
6. immutably upload a new bundle and capture artifact id/digest;
7. reconcile all versions and staging tags;
8. recover or create/upload PromotionSnapshot;
9. promote and verify public tags, root marker last;
10. run exact-version and channel smoke;
11. upload journal on every outcome;
12. synchronize stable version to dev only after all prior steps pass.

Preflight continues to build a local R0.2 bundle but performs no registry or
GitHub artifact mutation.

## Test Seam and Failure Oracle

Production orchestration accepts injected interfaces:

```text
ArtifactStore: recoverBundle, recoverSnapshot, writeSnapshot
RegistryClient: getVersion, getDistTags, publishTarball, setDistTag
Clock: now, sleep
JournalSink: writeEvent, setBundleDigest, setFinalState
```

Default adapters use bounded `fetch`/`execFile` argv calls. Tests use fakes and
never contact or mutate npm/GitHub.

R0.3 mutation killers:

1. Recovered bundle SHA/version differs from the current plan.
2. Outer artifact digest matches but one tarball byte differs.
3. Bundle is expired, duplicated, or has an unexpected file.
4. A registry version is missing and the reconciler skips publish.
5. A matching version is republished.
6. Integrity, runtime pins, exports, or bins mismatch but reconciliation
   continues.
7. Publish receives a directory or workspace instead of exact tarball path.
8. Publish omits explicit staging tag, access, registry, or script suppression.
9. Public tag moves before all versions and staging tags verify.
10. `kern-lang` moves before any other public package.
11. A public tag has a third-party value not allowed by the snapshot.
12. Journal loss changes reconciliation decisions.
13. Provenance is claimed in `disabled-unverified` mode.
14. Publish workflow retains any `pnpm -r publish` command.
15. Publish mode skips the full release wall.

R0.4 will add fail-after-N simulation at every version, staging-tag, public-tag,
and post-root smoke boundary and prove forward resume with the same bundle.

## File Plan

| File | Action | Responsibility |
|---|---|---|
| `scripts/release/bundle.mjs` | add | bundle creation, naming, validation, recovered-byte verification |
| `scripts/release/artifact-store.mjs` | add | current-run GitHub artifact discovery contract/default adapter |
| `scripts/release/registry-client.mjs` | add | bounded npmjs reads and argv-only writes |
| `scripts/release/registry-reconciler.mjs` | add | version/staging reconciliation and promotion state machine |
| `scripts/release/registry-cli.mjs` | add | strict phase-oriented CLI |
| `scripts/release/journal.mjs` | add | redacted evidence journal |
| `scripts/release/*registry*.test.mjs` | add | fake-client mutation killers |
| `scripts/release/release-policy.json` | modify | registry, bundle, retry, staging, provenance configuration |
| `scripts/release/policy.mjs` | modify | validate new configuration and cross-channel invariants |
| `.github/workflows/release-pipeline.yml` | modify | full publish wall, durable bundle/snapshot gates, exact publication |
| `scripts/check-repo-consistency.mjs` | modify | pin workflow and no-repack/no-recursive-publish contracts |

Every handwritten source file remains below 500 lines. Large test matrices are
split by responsibility rather than accumulated in one file.

## Acceptance Criteria

- [x] RED-at-base proves registry reconciler and bundle recovery are absent.
- [x] ReleaseBundle validator reconstructs the exact R0.2 manifest from bytes.
- [x] No npm mutation is reachable before immutable bundle persistence.
- [x] Missing/matching/conflicting version states behave exactly as specified.
- [x] A partial fake publish resumes without republishing completed packages.
- [x] Staging tags protect public channel tags but are never described as
      version visibility isolation.
- [x] Promotion snapshot is durable before the first public tag move.
- [x] Dependency-first promotion and root-last marker are enforced.
- [x] Journal deletion/corruption cannot change the next operation.
- [x] Workflow publish mode runs the full wall and contains no recursive/live
      workspace publish command.
- [x] Provenance remains explicitly disabled-unverified.
- [ ] Release-policy tests, repo consistency, lint, build, full tests,
      conformance, KERN tests, runner smoke, real local bundle verification,
      and final Agon review pass.

## Rollback and Recovery

Before any npm upload, rollback is deletion of local/generated and GitHub
artifacts only. After the first upload, published versions are immutable and
must never be deleted or reused as a normal recovery action.

If publication stops before root promotion, rerun the same workflow run within
the configured bundle retention period. Recover the exact bundle and reconcile
forward. If the bundle is unavailable or any registry version conflicts, hard
stop and issue a new version.

If the root marker moved and post-promotion smoke fails, stop automated forward
work. R0.4 defines and drills restoration of root/CLI entry tags from the
durable promotion snapshot, deprecation of the broken version, and the required
new patch/prerelease.
