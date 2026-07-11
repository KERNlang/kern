# KERN 5 R1.1 Alpha Constitution

**Status:** READY TO BUILD
**Date:** 2026-07-11
**Confidence:** 0.97
**Depends on:** R0.4 branch head `b9546b3c24a09b0d06197e4b086362e9f178a8d3`
**Primary tribunal:** `tribunal-1783774186425-20aegs-kern5-r1-alpha-constitution`
**MiniMax/GLM red-team:** `tribunal-1783774425009-zxjz74-kern5-r1-alpha-constitution-seco`

## Executive Summary

R1.1 makes the KERN 5 release claim machine-readable and honest before Alpha
language work starts. It replaces the narrow `fitness:kern-5` alias with a
self-contained aggregate of every release command that exists today, names the
already-implemented app-behavior harness, and structurally binds a human support
matrix to one versioned fitness policy. Future checker-v2, KIR, formatter,
frontend, compiler, runtime-ABI, fixed-point, interpreter, and packed-release
gates remain explicitly planned and must not be reported as shipped.

This slice adds no language feature, public package, public tag, KIR schema, or
Alpha manifest. Bar C remains the final KERN 5 release meaning; the current
4.5 runtime and self-hosted fixture oracles remain the rollback path while R1
is incomplete.

## Current State / Root Cause

- [VERIFIED] `fitness:kern-5` runs only three focused core test groups plus
  `test:runner-smoke`; it omits repository consistency, lint, the full workspace
  wall, differential conformance, native KERN coverage, app behavior, drift,
  and the required browser gate (`package.json:16-43`).
- [VERIFIED] The tracked release train explicitly requires R1 to correct the
  support matrix and planned aggregate before checker or KIR work, and marks
  nonexistent commands as TARGET (`docs/kern-5-release-train.md:146-193`,
  `docs/kern-5-release-train.md:337-364`).
- [VERIFIED] The tracked support matrix currently calls KERN 5 “final-complete”
  despite Alpha not starting and contains stale “KERN 5.2”/“5.3” future claims
  (`docs/kern-5-support-matrix.md:1-6`,
  `docs/kern-5-support-matrix.md:78-96`).
- [VERIFIED] The app-behavior three-leg/whole-app harness already exists and
  exits nonzero on failure, but no root package command names it
  (`scripts/app-behavior-conformance.mjs:1-1085`; `rg
  'test:app-behavior' package.json` returned zero hits on 2026-07-11).
- [VERIFIED] CI already runs lint, build, conformance, native KERN, and runner
  smoke as separate blocking steps; the new aggregate must not duplicate the
  whole wall inside CI (`.github/workflows/ci.yml:45-121`).
- [VERIFIED] `check:repo` is already the cross-workflow consistency boundary and
  is called by CI/release workflows; it currently validates no KERN 5 support
  contract (`scripts/check-repo-consistency.mjs:1-11,312-387,417-480`).
- [VERIFIED] The 4.5 product baseline `477063a1` and the R0.4 dependency
  `b9546b3c` are both ancestors of this branch (`git merge-base --is-ancestor
  <sha> HEAD` returned 0 for both on 2026-07-11). Neither is a public release
  tag for R1.1.

## What Already Works

- The detailed native-runner, capability, and app evidence tables remain useful
  4.5 substrate documentation; only their release-status framing and stale
  future claims need correction.
- Every current wall component already has an executable command except the
  app-behavior harness, which only needs a root alias.
- R0.1-R0.4 publication policy and recovery remain unchanged and continue to be
  exercised through `pnpm test` -> `test:infra` -> `test:release-policy`.
- Existing CI keeps its decomposed commands for useful step-level diagnostics.
  `fitness:kern-5` is the single local/release aggregate, not an additional CI
  duplicate.

## Contract (Verified and Frozen)

> Verified against `package.json`, `docs/kern-5-support-matrix.md`,
> `docs/kern-5-release-train.md`, `.github/workflows/ci.yml`, and
> `scripts/check-repo-consistency.mjs` on 2026-07-11.

| Field / Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Release meaning | Bar C: KERN-authored parsing, checking, compilation, and semantic interpretation over versioned KIR; host provides explicit capabilities and transport | `docs/kern-5-release-train.md:42-58` | VERIFIED |
| Policy authority | One tracked JSON policy defines current/planned gate IDs, argv, and ownership statuses | This spec; both tribunals rejected prose/grep authority | VERIFIED design decision |
| Human mirror | `docs/kern-5-support-matrix.md` contains exact structured gate and ownership rows matching policy | Existing tracked matrix at `docs/kern-5-support-matrix.md:1-119` | VERIFIED design decision |
| Current command | Every `current` gate uses argv execution without a shell and must map to an existing root script, except bounded `git diff --check` | Root scripts at `package.json:15-49` | VERIFIED |
| Planned command | Every `planned` gate must be absent from root scripts until the same slice promotes its policy/matrix status | TARGET list at `docs/kern-5-release-train.md:350-359` | VERIFIED design decision |
| App behavior | `test:app-behavior` names the existing `scripts/app-behavior-conformance.mjs` harness | Harness completion output at `scripts/app-behavior-conformance.mjs:1084-1085` | VERIFIED |
| Aggregate order | Validate contract, then repo consistency, lint, build, full tests, conformance, native KERN, runner smoke, app behavior, drift, required browser budget, and diff hygiene | Target wall at `docs/kern-5-release-train.md:342-360` | VERIFIED |
| Baseline identity | Docs may record the immutable 4.5 audit SHA and this slice dependency, but fitness never requires an unmerged tag or mutable branch SHA | `origin/main` is `477063a1`; branch dependency is `b9546b3c` | VERIFIED |
| CI consumption | `check:repo` invokes only the structural contract validation; CI keeps its existing decomposed execution wall | `.github/workflows/ci.yml:45-121` | VERIFIED design decision |
| Ignored design docs | `own-language-plan`, baseline audit, and release-oracles remain non-authoritative local design inputs; the tracked release train, policy, and matrix carry the executable contract | `.gitignore:11`; `git ls-files docs` on 2026-07-11 | VERIFIED |

### Policy schema v1

`scripts/kern-5-fitness-policy.json` has:

- `schemaVersion: 1`;
- a non-empty ordered `gates` array whose rows contain unique safe `id`, status
  `current|planned`, non-empty display label, and bounded argv;
- a non-empty ordered `ownership` array whose rows contain unique safe `id`,
  status `shipped-4.5|internal-oracle|not-shipped`, and evidence text;
- no arbitrary shell strings, environment overrides, working-directory escape,
  or raw command substitution.

The matrix tables are exact ordered mirrors. Deleting, adding, renaming,
reordering, or changing a row on only one side fails closed.

### Current aggregate

The v1 current gate argv is:

1. `pnpm check:repo`
2. `pnpm lint`
3. `pnpm build`
4. `pnpm test`
5. `pnpm check:conformance`
6. `pnpm test:kern`
7. `pnpm test:runner-smoke`
8. `pnpm test:app-behavior`
9. `pnpm test:drift-showcase`
10. `pnpm check:runner-browser-budget:required`
11. `git diff --check`

The validator runs before step 1. Each child inherits stdio, uses `shell: false`,
and stops on the first nonzero status or signal. The aggregate does not inspect
or reuse old `dist/`; each existing command retains its own build prerequisites.

### Planned gates

The matrix and policy declare these `planned`/`not-shipped` boundaries until
their implementation slice promotes them atomically: KIR v1, runtime/handler
ABI, KERN frontend, KERN compiler, self-host fixed point, KERN interpreter
shadow, and packed-release proof. Checker v2 and formatter are ownership rows
even though their final gate may be absorbed by frontend/compiler walls.

## Implementation Plan

There is one viable option: structural policy/matrix equality plus argv-based
execution. A global or surface-bounded vocabulary grep cannot distinguish a
release claim from legitimate design/code text. Creating an annotated tag or
post-merge tag helper in this unmerged slice would mutate external release state
without certifying an Alpha artifact.

1. Add the policy schema and parser/validator with unit-test dependency
   injection.
2. Rewrite the support matrix framing, canonical gates, ownership status, and
   exclusions while preserving verified 4.5 runtime evidence.
3. Name the existing app-behavior harness and replace `fitness:kern-5` with the
   policy-driven aggregate.
4. Call structural validation from `check:repo` and add mutation killers for
   status, row, command, evidence, ordering, zero-current-gate, and early-exit
   drift. Preserve `fitness` as a compatibility alias to the canonical wall.
5. Run the contract killers, `check:repo`, the complete `fitness:kern-5` wall,
   final full-roster Agon review, then close R1.1 in the release train and push
   one stacked branch.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `scripts/kern-5-fitness-policy.json` | add | machine-owned current/planned gates and ownership statuses |
| `scripts/kern-5-fitness.mjs` | add | validate policy/matrix/package contract and execute current argv |
| `scripts/kern-5-fitness.test.mjs` | add | RED mutation killers and aggregate control-flow tests |
| `docs/kern-5-support-matrix.md` | modify | truthful Alpha framing and exact human policy mirror |
| `package.json` | modify | app-behavior alias, contract check, and real aggregate |
| `biome.json` | modify | align the checked schema URL with the already-frozen Biome 2.5.2 lockfile |
| `scripts/check-repo-consistency.mjs` | modify | make structural KERN 5 truth a shared workflow gate |
| `docs/kern-5-release-train.md` | modify at closeout | record R1.1 evidence without claiming Alpha complete |
| `.Codex/specs/kern-5-r1-alpha-constitution/spec.md` | add/update | frozen design and completion evidence |

All new handwritten source remains below 500 lines. No generated output,
lockfile, package source, runtime, checker, parser, compiler, or workflow changes.

## Acceptance Criteria

- [ ] The support matrix no longer calls KERN 5 final-complete before Alpha and
      contains no KERN 5.2/5.3 release claims.
- [ ] Matrix gate and ownership tables exactly match policy order, IDs,
      statuses, commands, labels, and evidence.
- [ ] Every current pnpm gate maps to an existing root script; every planned
      pnpm gate is absent until promoted in the same policy/matrix change.
- [ ] Missing/duplicate/unknown/reordered rows, unsupported statuses, unsafe
      argv, missing evidence, missing current scripts, and prematurely added
      planned scripts each fail with the offending ID.
- [ ] `test:app-behavior` runs the existing three-leg plus Express/FastAPI boot
      harness and adds no new semantic implementation.
- [ ] `check:repo` fails on a mutated matrix or policy and remains green on the
      exact contract.
- [ ] `fitness:kern-5` validates first, executes every current gate in policy
      order with no shell, stops at the first failure, propagates signals/nonzero
      statuses, and reaches `git diff --check` only after all earlier gates pass.
- [ ] The complete aggregate passes from the current clean branch without
      reading a prior SHA's evidence.
- [ ] No public tag, package version, Alpha manifest, checker-v2, KIR,
      formatter, frontend, compiler, fixed-point, interpreter, runtime ABI, or
      packed-release implementation is created by this slice.
- [ ] Full-roster Agon review returns no verified or unresolved needs-check
      finding before commit.

## Out of Scope

- Checker v2 syntax/numeric work or production checker shadowing.
- Selecting or freezing a KIR seam, serializer, value model, diagnostic model,
  handler ABI, capability ABI, or trace ABI.
- Formatter/canonicalizer, frontend, compiler, bootstrap, interpreter, or WASM.
- Alpha manifest creation, package version changes, npm publication, public tags,
  or a post-merge tagging helper.
- Natural-language scanning or banning terms such as KIR/compiler from tracked
  source and design documents.
- Tracking the three ignored local design documents; their necessary release
  decisions are restated in tracked policy/matrix/train artifacts.

## Deploy Order

Policy, parser, matrix, aliases, and `check:repo` integration land atomically on
the stacked R1.1 branch. Existing CI/release consumers immediately gain the
structural check through `check:repo`; no command is removed and no mixed-version
runtime exists. Human merge must preserve or deliberately re-record the R0.4
dependency; no tag is created before merge and green main CI.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Primary tribunal: tag `b9546b3c` as `kern-5-r0.4` now | R0.4 is an unmerged stacked drill commit, not a certified release artifact | Record dependency in the spec; create no tag |
| Primary tribunal: reject future subsystem words across tracked files | KIR/compiler/formatter terms have legitimate code and design uses | Validate structured status rows, never prose vocabulary |
| Secondary tribunal: add a post-merge tag helper | Alpha tagging requires merged SHA and real CI state unavailable to this slice | Leave tag mechanics out of R1.1 |
| Secondary tribunal: reject excluded package exports by substring | Existing/future legitimate compiler-related exports are not equivalent to a shipped KERN-owned compiler | Bind explicit ownership IDs and gates instead |
| Existing matrix: KERN 5 is final-complete and has 5.2/5.3 lanes | The repo is 4.5 and R1 Alpha has not started | Reframe as current substrate plus explicit not-shipped ownership |
| Initial local install lacked the lockfile-declared `tsx` binary and exposed a Biome schema/CLI patch mismatch | Frozen install restored `tsx`; the lock already pins Biome 2.5.2 while `biome.json` referenced 2.5.1 | Keep the lock unchanged, align the schema URL, and avoid duplicating the app harness's internal prerequisite build |
| Review suggested an all-planned policy could pass without executing a gate and that legacy `fitness` remained narrower | Both would weaken the single canonical wall | Require at least one current gate, add its mutation killer, and route `fitness` to `fitness:kern-5` |
| Closure review found the new release-contract scripts outside the repository's package-only Biome include set | The canonical validator should be checked without pulling legacy scripts and their unrelated formatting debt into this slice | Add both new contract scripts to Biome's explicit include set and resolve all reported diagnostics |
| Final review noted that a coordinated policy and matrix edit could demote a current gate while preserving structural equality | The R1.1 constitution freezes the initial current wall; changing it must require an explicit test-oracle update | Assert the exact ordered 11-gate current wall in the real-file contract test |

## Open Questions

None. No ASSUMED or OPEN claim feeds the R1.1 oracle.
