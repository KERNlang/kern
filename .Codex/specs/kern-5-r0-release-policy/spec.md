# KERN 5 R0.1 Release Policy Contract

**Status:** DONE
**Date:** 2026-07-10
**Confidence:** 0.93
**Parent:** `docs/kern-5-release-train.md` R0
**Tribunal:** `tribunal-1783695392674-dgrv2l-kern5-r0-slice1`
**Final review:** `review-1783700542520-ev8jcq-kern5-r0-release-policy-final`

## Executive Summary

R0.1 makes release intent a pure, versioned `ReleasePlan` before later R0
slices pack, publish, resume, or promote anything. A checked-in policy maps a
configured release channel to an exact version, explicit npm dist-tag, stable-
only dev-sync decision, resolved commit SHA, and dependency-ordered public
package list. GitHub workflows become consumers of the same tested CLI output
instead of reimplementing release rules in shell.

This slice also disables cancellation of active publish workflows. It does not
claim artifact integrity, resumable publication, atomic dist-tag promotion, or
exact-SHA gate attestation; those remain R0.2-R0.4.

## Current State and Root Cause

- Stable tags accept only `vX.Y.Z` and derive a version in workflow shell.
  **VERIFIED:** `.github/workflows/release.yml:28-37`.
- Release preflight separately validates plain stable SemVer.
  **VERIFIED:** `.github/workflows/release-preflight.yml:31-37`.
- Stable publication omits an explicit npm dist-tag.
  **VERIFIED:** `.github/workflows/release-pipeline.yml:89-99`.
- Canary accepts a free-form `npm_tag` and can therefore select `latest`.
  **VERIFIED:** `.github/workflows/canary-publish.yml:21-27,72-99`.
- Canary derives the next patch from the 4.5 source version rather than a
  configured KERN 5 release line. **VERIFIED:**
  `.github/workflows/canary-publish.yml:76-89`.
- Stable publish and canary workflows use `cancel-in-progress: true`.
  **VERIFIED:** `.github/workflows/release.yml:7-9` and
  `.github/workflows/canary-publish.yml:29-31`.
- Public packages are the non-private manifests under `packages/*`; the
  playground is private, and runtime ordering must ignore `devDependencies`.
  **VERIFIED:** `pnpm-workspace.yaml:1-2`; `packages/playground/package.json`;
  package manifest census on 2026-07-10 found 22 public of 23 manifests.
- `scripts/check-repo-consistency.mjs` pins literal workflow phrases rather
  than one release-policy contract. **VERIFIED:**
  `scripts/check-repo-consistency.mjs:84-148`.

The root cause is duplicated release intent in YAML/shell. Downstream artifact
and recovery code cannot safely compose until version, channel, tag, package
graph, and dev-sync decisions have one testable representation.

## What Already Works

- Stable package versions and `KERN_VERSION` are kept in lockstep by the
  existing pipeline and repository consistency check.
- Published `workspace:*` runtime dependencies are intended to resolve to the
  common release version; the release remains a coordinated package graph.
- Main CI already supplies Node 22, Python 3.12, pnpm 10.32.1, build, tests,
  conformance, native KERN tests, runner smoke, and browser budget checks.
- Current stable release tag validation and main-ancestor validation remain
  supported; R0.1 centralizes intent without removing those protections.

## Contract

> Verified against the workflow and package sources listed above on 2026-07-10.

| Field / behavior | Contract | Evidence | Tag |
|---|---|---|---|
| `planVersion` | literal `1`; future slices add fields without retyping existing fields | R0 release-train composition requirement | VERIFIED |
| `sha` | lowercase resolved Git commit, never branch/ref input | release workflow checks `GITHUB_SHA` against main | VERIFIED |
| `channel` | a key present in checked-in policy; not a hardcoded source union | config-tunable rule | VERIFIED |
| `version` | exact plain SemVer; channel-specific stable/prerelease rules | existing workflow input forms | VERIFIED |
| `distTag` | required and policy-derived for every channel | current omission/free-form root cause | VERIFIED |
| `packages` | all non-private workspace packages, dependency-first by runtime dependencies only | package census and manifests | VERIFIED |
| `syncsDev` | true only when policy marks a stable non-prerelease channel | current release sync/canary conflict | VERIFIED |
| stable channel | stable version only; explicit configured `latest` tag | current stable behavior plus explicit-tag requirement | VERIFIED |
| canary channel | configured KERN 5 base, deterministic run/SHA suffix, configured non-`latest` tag | R0 release-train requirement | VERIFIED |
| workflow output | JSON plan plus individual GitHub outputs; failure precedes publish | workflow consumer requirement | VERIFIED |

### ReleasePlan v1

```text
{
  planVersion: 1,
  sha: string,
  channel: string,
  version: string,
  distTag: string,
  packages: [{ name, path, dependencies }],
  syncsDev: boolean
}
```

Invariants:

1. `distTag` is never absent.
2. A prerelease channel can never resolve to `latest`.
3. A stable channel can never accept a prerelease version.
4. Only a stable non-prerelease plan may set `syncsDev=true`.
5. Package ordering uses internal runtime `dependencies` and
   `optionalDependencies`, never `devDependencies`.
6. Unknown channels, dependency cycles, missing internal packages, duplicate
   package names, invalid SHAs, and invalid versions fail closed.
7. Policy errors are deterministic and contain no secrets.

## Implementation Decision

The tribunal selected the policy contract first because every later R0 slice
consumes it. The repo-native implementation is plain ESM under
`scripts/release/`, using Node's test runner and JSDoc/type checking patterns;
no new workspace package or runtime dependency is introduced.

Alternatives B-D are not competing first implementations: artifact manifests,
resumable staging, and exact-SHA publish gates all require this release intent.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-r0-release-policy/spec.md` | add | durable contract and acceptance |
| `scripts/release/release-policy.json` | add | one config source for channel policy |
| `scripts/release/policy.mjs` | add | validate config and derive channel/version/tag/dev sync |
| `scripts/release/package-graph.mjs` | add | discover and dependency-order public packages |
| `scripts/release/plan.mjs` | add | compose and validate ReleasePlan v1 |
| `scripts/release/plan-cli.mjs` | add | workflow-facing plan command and GitHub outputs |
| `scripts/release/*.test.mjs` | add | discriminating local oracle, no network mutation |
| `package.json` | add script | canonical `test:release-policy` entry |
| `.github/workflows/release.yml` | modify | non-cancellable publish and central validation |
| `.github/workflows/release-preflight.yml` | modify | central validation and explicit channel |
| `.github/workflows/canary-publish.yml` | modify | configured v5 canary and no free-form tag |
| `.github/workflows/release-pipeline.yml` | modify | require explicit channel/tag and stable-only sync |
| `scripts/check-repo-consistency.mjs` | modify | reject workflow/policy drift |
| `README.md`, `CONTRIBUTING.md` | modify if required | truthful operator workflow |

Every new handwritten source file remains under 500 lines. Files already near
or above that limit receive validation calls only; new behavior stays extracted.

## Acceptance Criteria

- [x] Stable `4.5.0` produces explicit `latest`, `syncsDev=true`, and the
      resolved public package graph.
- [x] Configured KERN 5 canary inputs produce
      `5.0.0-canary.<run>.g<short-sha>`, explicit `canary`, and
      `syncsDev=false`.
- [x] Leading `v`, malformed SemVer, stable prerelease, unknown channel,
      invalid SHA, free-form tag input, prerelease-to-`latest`, and
      canary dev-sync all reject before workflow publication.
- [x] Package discovery returns exactly the current 22 public packages,
      excludes private playground/root manifests, orders internal runtime
      dependencies before consumers, and ignores the `@kernlang/test` -> CLI
      devDependency back-edge.
- [x] Missing internal runtime dependency, duplicate package name, and runtime
      dependency cycle fail closed in fixture repositories.
- [x] Mutation/discriminator cases prove the oracle rejects implementations
      that map canary to `latest`, omit a tag, sync canary to dev, classify a
      prerelease as stable, or include devDependencies in graph edges.
- [x] Tests perform no npm publish, dist-tag, registry write, or network call.
- [x] Stable and canary publication jobs cannot be cancelled in progress.
- [x] Workflows call the policy CLI, consume explicit version, channel,
      dist-tag, and dev-sync outputs, and emit the resolved package plan for
      R0.2 artifact packing.
- [x] The impossible automatic dev-canary trigger is removed; canary remains
      manual-only and main-only until exact-SHA CI attestation is implemented.
- [x] `npm run check:repo`, `pnpm test:release-policy`, type/build checks, and
      the full local repository gate pass.

## Out of Scope

- Packing tarballs, computing artifact integrity, or proving packed contents.
- Registry publication, provenance, resume state, or dist-tag promotion.
- Claiming npm multi-package tag updates are atomic.
- Final `fitness:kern-5` expansion or language/runtime work.
- Public Alpha/Beta/RC releases.

## Deploy Order and Skew

1. Disable cancellation for actual publish workflows.
2. Land the pure policy, package graph, plan, CLI, and discriminating tests.
3. Integrate workflows in validation-first mode while preserving valid stable
   release behavior.
4. Make version/tag/dev-sync outputs load-bearing together; do not leave a
   workflow accepting a free-form tag after the policy is present.
5. Run preflight on current stable and a configured canary without publication.
6. R0.2 consumes the frozen plan to pack and verify exact artifacts.

An in-flight workflow created from the previous commit continues with its old
definition. New workflows fail closed before publish if policy cannot produce
an explicit tag. No package schema or runtime contract changes in this slice.

## Kill Switch

There is no runtime bypass or warn-only mode in this slice. Rollback means
reverting the workflow consumers and policy together. These failures are never
bypassable while the slice is active:

- missing/invalid explicit dist-tag;
- any prerelease mapped to `latest`;
- unknown channel or invalid SemVer/SHA;
- canary/prerelease plan requesting dev sync.

The hard safety rules live in the pure policy module and are covered by the
discriminating oracle. Repo consistency checks reject workflow drift that
restores free-form tags, implicit `latest`, cancellation, or the dead dev
trigger.

## Open Questions

None feeds the oracle. npm trusted-publishing/provenance configuration remains
OPEN for R0.2 and is deliberately outside this slice.

## Corrections Log

| Original claim | Reality | Impact |
|---|---|---|
| Dist-tags can be promoted atomically | npm exposes per-package tag updates | Later promotion is ordered, verified, and resumable, never called atomic |
| Existing canary is a KERN 5 channel | it derives `4.5.1-canary...` from source `4.5.0` | canary base moves to checked-in release policy |
| Automatic canary observes green dev CI | CI runs on main while canary listens for dev | workflow integration must fix or remove that impossible trigger |
| R0.1 can safely automate canary publication | exact-SHA attestation and resumable publication are later R0 slices | canary is manual-only and main-only in this slice |
| R0.1 workflows consume the package graph for publication | package packing and resumable ordered publication belong to R0.2+ | R0.1 emits and validates the graph; R0.2 makes it load-bearing |
| A raw short SHA is always a valid prerelease identifier | an all-numeric SHA prefix with a leading zero violates strict SemVer | prefix the SHA identifier with `g` and keep the numeric-prefix fixture as a regression oracle |
