# KERN 5 R0.2 Exact Artifact Manifest

**Status:** COMPLETE
**Date:** 2026-07-10
**Confidence:** 0.98
**Parent:** `docs/kern-5-release-train.md` R0 items 5-8
**Depends on:** R0.1 commit `3d53243257e1462879bf59ca50261f2ef86ce22d`
**Tribunal:** `tribunal-1783702520588-6zswaa-kern5-r0-artifact-manifest`
**Initial review:** `review-1783706504561-7kc6k3-kern5-r0-artifact-manifest`
**Final review:** `review-1783707150884-0qhqdi-kern5-r0-artifact-manifest-final`

## Executive Summary

R0.2 turns `ReleasePlan v1` into an exact, locally verifiable artifact set
without touching npm registry state. It consumes the plan as the sole package
membership and order authority, packs every planned public package exactly
once, reads the effective metadata back from each tarball, records byte-level
integrity, and proves that a clean temporary consumer can install the exact
KERN tarballs in a final offline install after read-only external dependency
priming.

This slice is deliberately not a publication transaction. Resumable registry
reconciliation, `npm publish <tarball>`, staging tags, public-channel promotion,
and provenance remain R0.3.

## Current State and Verified Facts

- [VERIFIED] R0.1 produces a frozen `ReleasePlan v1` containing the exact SHA,
  channel, version, dist-tag, dev-sync decision, and dependency-ordered public
  package graph.
- [VERIFIED] The graph contains 22 non-private manifests under `packages/*`.
  `@kernlang/playground` is private and excluded.
- [VERIFIED] The public compatibility/root artifact is `kern-lang` at
  `packages/compat`; the workspace-management root package is private
  `kern-monorepo` and is not publishable.
- [VERIFIED] `pnpm 10.32.1 pack` supports `--pack-destination` and `--json`.
- [VERIFIED] Packing `packages/compat` rewrites packed `workspace:*` runtime
  dependencies to exact `4.5.0` pins inside `package/package.json`.
- [VERIFIED] No planned public package currently declares `prepack`, `prepare`,
  `postpack`, or `pack`. The private workspace root declares `prepare`, which
  is irrelevant because it is not in the plan.
- [VERIFIED] The stable workflow already computes the release plan, rewrites
  package versions, checks repository consistency, and builds before its
  preflight/publish split.

## Root Cause

Current preflight and publication invoke recursive pnpm commands over the live
workspace. They do not freeze tarball filenames or bytes, do not inspect the
metadata consumers receive after workspace protocol rewriting, and do not
record integrity. A later publish can therefore re-pack different bytes from
those that a preflight implicitly checked.

The missing contract is a versioned, canonical mapping:

```text
ReleasePlan v1 -> exactly one tarball per planned package -> ArtifactManifest v1
```

R0.2 supplies that mapping. R0.3 will make the manifest load-bearing for
registry publication.

## Scope

### Included

1. Consume a checked-in/generated `ReleasePlan v1` JSON file.
2. Reject plans that fail the existing R0.1 validator.
3. Reject pack lifecycle scripts on any planned package.
4. Require a nonexistent or empty artifact output directory.
5. Invoke `pnpm --dir <package-path> pack --pack-destination <absolute-out>
   --json` sequentially in plan order, exactly once per package.
6. Require each invocation to report exactly one `.tgz` inside the configured
   output directory.
7. Read `package/package.json` from the tarball with a cross-platform Node tar
   reader; do not shell out to platform-specific `tar` in production code.
8. Validate packed name/version and exact internal runtime pins from
   `dependencies` plus `optionalDependencies`.
9. Reject missing, extra, duplicate, private, or unplanned artifacts.
10. Record SHA-512 hex, npm-style SHA-512 integrity, byte size, exports, bin,
    and internal runtime pins.
11. Emit canonical `ArtifactManifest v1` JSON.
12. Resolve and fetch external dependencies read-only, then install exact KERN
    tarballs in a temporary pnpm consumer using `file:` overrides and a final
    `--offline --frozen-lockfile` install. Permit install scripts only for the
    explicit external build-dependency allowlist.
13. Smoke-import declared package roots except policy-declared executable-only
    packages. Require every import exclusion to expose a bin, and execute safe
    declared bins with `--help` only when the policy allowlist marks the bin safe.
14. Integrate the exact-artifact wall into non-publishing release preflight
    after the single build and before the legacy publish dry run.

### Excluded

- Any registry mutation. Read-only external dependency resolution and cache
  priming are permitted before the final offline install.
- `npm publish`, provenance, trusted publishing, or access-token logic.
- Resume state or partially published version reconciliation.
- Staging/public dist-tag creation, movement, rollback, or verification.
- Claiming byte-identical tarballs across two separate pack executions.
- Replacing the existing real publish path before R0.3 can publish the frozen
  R0.2 tarballs.
- Changing peer dependency compatibility ranges or exact-pinning
  `devDependencies`.

## ArtifactManifest v1 Contract

```json
{
  "schemaVersion": 1,
  "releasePlan": {
    "planVersion": 1,
    "sha": "40 lowercase hex characters",
    "channel": "stable|canary|configured future channel",
    "version": "resolved SemVer",
    "distTag": "explicit configured tag"
  },
  "packages": [
    {
      "name": "@kernlang/core",
      "path": "packages/core",
      "version": "5.0.0-canary.1.g01234567",
      "tarball": "kernlang-core-5.0.0-canary.1.g01234567.tgz",
      "size": 123,
      "sha512": "lowercase hex",
      "integrity": "sha512-base64",
      "internalRuntimeDependencies": [
        {
          "name": "@kernlang/context",
          "kind": "dependency",
          "version": "5.0.0-canary.1.g01234567"
        }
      ],
      "exports": {},
      "bin": null
    }
  ]
}
```

Contract rules:

- `packages` order exactly equals ReleasePlan order.
- Package and dependency paths use `/` regardless of host platform.
- Object keys are recursively sorted in canonical output; arrays retain
  semantic order.
- JSON uses UTF-8, two spaces, LF, and exactly one final newline.
- No wall-clock timestamp, host path, temporary path, or run-local identifier
  enters the manifest.
- Tarball paths are filenames relative to the artifact directory, never
  absolute paths.
- `exports` and `bin` reflect packed metadata, not source metadata. Missing
  `exports` becomes `null`; a string `bin` is normalized to a one-entry object
  keyed by package basename where npm semantics permit it.
- Internal runtime dependencies are sorted by name then kind and include only
  dependencies that are also present in the release plan.
- Every internal runtime dependency must equal the plan's exact resolved
  version. Workspace ranges or alternate SemVer ranges in packed metadata fail.
- `sha512` and `integrity` are two encodings of the digest over the exact `.tgz`
  bytes.

## CLI Contract

```bash
node scripts/release/artifacts-cli.mjs \
  --plan .release/release-plan.json \
  --out .release/artifacts \
  --manifest .release/artifact-manifest.json \
  --offline-consumer-test
```

Rules:

- Unknown, duplicate, or missing-value flags fail closed.
- `--plan`, `--out`, and `--manifest` are required.
- `--offline-consumer-test` is a boolean flag and is required by workflow
  preflight even if the library keeps it optional for focused fixture tests.
- The output directory must be absent or empty. The CLI never recursively
  deletes an operator-supplied path.
- The manifest path must be outside the artifact directory so it cannot be
  mistaken for a tarball.
- The CLI does not build. Its caller must build exactly once first.
- The CLI writes the manifest only after all packages and offline checks pass.
  Failure leaves no green manifest.
- `--keep-temp` may retain inspection/consumer directories for diagnostics but
  may not change manifest bytes.

## File Plan

| File | Action | Responsibility |
|---|---|---|
| `scripts/release/artifact-types.mjs` | add | canonical JSON, normalization, manifest constants |
| `scripts/release/tar-entry.mjs` | add | bounded tar entry reader for packed package metadata |
| `scripts/release/artifact-manifest.mjs` | add | manifest construction and validation |
| `scripts/release/pack-artifacts.mjs` | add | lifecycle guard, sequential pack orchestration, hashing |
| `scripts/release/offline-consumer.mjs` | add | temp exact-tarball install and smoke checks |
| `scripts/release/artifacts-cli.mjs` | add | strict argument parsing and orchestration |
| `scripts/release/*.test.mjs` | add/modify | fixture tests and mutation killers |
| `.github/workflows/release-pipeline.yml` | modify | persist plan JSON and run R0.2 in preflight |
| `scripts/check-repo-consistency.mjs` | modify | pin workflow/manifest contracts |
| `packages/check/*` | modify | repair packed runtime dependency on public core exports |
| `packages/cli/src/cli.ts` | modify | make top-level help a successful executable smoke surface |
| `packages/cli/tests/cli-help.test.ts` | add | lock the help exit-code contract |

Every handwritten source file remains below 500 lines.

## Discriminating Oracle

The oracle must first fail against the R0.1 base because no artifact module or
CLI exists. It then kills at least these mutations:

1. Pack omits `kern-lang` / `packages/compat`.
2. Pack includes private playground or private workspace root.
3. Package order differs from the frozen plan.
4. One package is packed twice or produces two filenames.
5. An extra `.tgz` exists in the output directory.
6. Packed package name or version differs from the plan.
7. Packed internal dependency retains `workspace:*` or uses a range.
8. Optional internal dependency is omitted from validation.
9. Dev/peer dependency is incorrectly treated as a runtime exact-pin failure.
10. Hash is computed from unpacked metadata rather than complete tarball bytes.
11. Integrity and hex digest disagree.
12. Absolute/temp paths or timestamps leak into manifest output.
13. Recursive object key or dependency order changes manifest bytes.
14. Tar header is truncated, oversized, duplicate, or missing
    `package/package.json`.
15. Lifecycle script runs or a package declares a banned pack lifecycle.
16. Final offline install contacts a registry, KERN package lifecycle scripts
    run, or a dependency outside the explicit build allowlist runs scripts.
17. CLI accepts unknown/duplicate flags or a nonempty output directory.
18. Manifest is written after a partial failure.

Fixture tests use temporary package roots and injectable command runners. One
explicit integration smoke packs at least `@kernlang/core` and `kern-lang` from
the real built tree. Before commit, the complete 22-package artifact wall is
run once and its manifest is inspected.

## Acceptance Criteria

- [x] RED-at-base proves the artifact CLI/module is absent.
- [x] Fixture oracle and implemented mutation killers pass (70/70 release tests).
- [x] Real R0.2 wall packs exactly 22 artifacts in ReleasePlan order.
- [x] Manifest contains exactly 22 unique planned packages and tarballs.
- [x] Every packed package version and internal runtime pin equals the plan
      version.
- [x] Every artifact digest matches recomputation from exact tarball bytes.
- [x] Rebuilding a manifest from unchanged bytes yields identical bytes.
- [x] Mutating any tarball byte changes digest and fails tar inspection.
- [x] Temporary exact-tarball consumer completes a final offline frozen install;
      scripts are restricted to explicitly configured external build dependencies.
- [x] Root imports/subpath exports and selected safe bins pass smoke checks;
      executable-only MCP server import is explicitly excluded and bin-validated.
- [x] R0.2 performs no registry mutation; only external resolution/fetch may use
      the registry before the final offline install.
- [x] Stable preflight runs R0.2 after build and before legacy publish dry run.
- [x] Real publish remains unchanged and does not falsely claim to consume the
      manifest until R0.3.
- [x] `pnpm test:release-policy`, `npm run check:repo`, lint, build, full tests,
      conformance, KERN tests, and runner smoke pass.
- [x] Final Agon re-review passes with no verified findings.

## Deployment and Skew

R0.2 is stacked on R0.1 and cannot merge first. It adds validation to
non-publishing preflight only. The existing real publish path remains unchanged
and therefore remains blocked for public KERN 5 release until R0.3 makes exact
manifest tarballs load-bearing.

R0.2 artifacts are CI/local evidence, not durable release state. A later job may
upload the artifact directory for inspection, but R0.3 owns durable recovery
state and registry comparison.

## Rollback

Revert the workflow preflight step and artifact modules together. No registry
state exists to undo. Existing stable and canary publication behavior is not
modified by this slice.

## Corrections Log

| Original claim | Verified reality | Decision |
|---|---|---|
| The publishable root is repository `package.json` | root is private `kern-monorepo`; `kern-lang` lives at `packages/compat` | consume ReleasePlan membership, never infer root publication |
| Source manifests prove dependency pins | pnpm rewrites `workspace:*` during pack | inspect packed `package/package.json` |
| A second pack can prove reproducible bytes | tar metadata may vary between invocations | pack once; bind and test the exact produced bytes |
| A full workspace copy is more isolated | copying can change pnpm symlink/workspace behavior | pack built source in place, isolate artifacts and consumers |
| Existing publish dry-run is the exact artifact wall | it can repack the live workspace and records no integrity | retain as legacy compatibility gate; R0.2 adds an explicit manifest wall |
| An exact consumer can be created with zero registry reads | external non-KERN dependency metadata/content may be absent from the pnpm store | resolve and fetch external dependencies read-only, then require the final exact KERN install to run offline and frozen |
| Every package export can be imported as a library smoke | `@kernlang/mcp-server` starts its stdio server on root import and is executable-only | policy-exclude only bin-bearing executable packages from import smoke; still install and validate their tarballs |
| `@kernlang/check` packed its complete runtime graph | it imported workspace-relative core dist files while declaring core only as a dev dependency | import public core subpaths and declare exact packed runtime dependency through workspace rewriting |
| `kern --help` is a successful bin smoke | top-level help printed usage but exited 1 as though input were missing | make explicit `--help` and `-h` print usage and return successfully |
| Package metadata size is a suitable process-output cap | normal pnpm output can exceed the 1 MiB metadata bound and fail with ENOBUFS | add a separately configurable 16 MiB command-output bound for pack and consumer processes |
| Every explicit export subpath is JavaScript-importable | valid packages may expose JSON, CSS, WASM, or other assets | smoke-import only export targets that resolve to JavaScript; keep conditional JS exports covered |
| Duplicate workflow step names are harmless | identical publish and preflight dry-run labels obscure Actions diagnostics | name the nonpublishing step `Publish dry run (preflight)` |
| Hidden system files in the artifact directory should be ignored | the contract requires an exact output set and any unexpected entry makes the evidence ambiguous | keep strict rejection of every extra entry; create and use the directory non-interactively |
