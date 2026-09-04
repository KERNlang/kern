# CI Path Filters

**Status:** IMPLEMENTED
**Date:** 2026-09-04
**Confidence:** 0.88

## Executive Summary

Every pull request against `kern-lang` runs the complete 13-job, ~26-runner CI matrix regardless of what changed, including documentation-only edits. A tribunal (`~/.agon/runs/tribunal-1788492416854-5o6i1y`, 4 engines, 2 adversarial rounds) evaluated finer-grained path taxonomies (per-slice, per-oracle, per-frontend classes) against the actual dependency structure of the test suite and rejected all of them: the frontend and package-test jobs read files across `packages/core/src`, `scripts/kern-5-*`, and `scripts/kern-frontend-*` in ways a hand-written path-to-job map cannot honestly claim to track, and a first-draft narrow class (`KERN5_ORACLE_SPEC_ONLY`) was shown to already misclassify a spec change that the frontend F1–F4 jobs actually consume. The tribunal's converged position (independently reached by two of four engines, and explicitly adopted as this slice's decided design) is: ship exactly one narrow class, `DOCS_ONLY`, with everything else defaulting to `FULL`; add a fail-closed in-tree classifier and a manifest-verifying aggregator; and queue any further narrowing behind a dependency-derived measurement pass, not another guess. This slice adds the claim-tagged spec, a RED oracle for that design, and — landed on the same branch, turning the oracle GREEN — the production code itself: `classify-ci-changes.mjs`, `evaluate-ci-lanes.mjs`, `ci-lane-policy.json`, and the `ci.yml` gating edit (see Corrections Log: the Blast Radius table below still marks these "future slice, NOT this one" from the spec's original scoping — that plan changed, this is that slice).

## Current State / Root Cause

- **VERIFIED:** `.github/workflows/ci.yml` runs on `push` to `main` and on `pull_request` to `main` with no path filtering of any kind; `grep -n paths .github/workflows/ci.yml` → zero hits, 2026-09-04.
- **VERIFIED:** `.github/workflows/ci.yml` defines 13 jobs: `quality`, `infrastructure-contracts`, `package-tests` (2-leg matrix), `semantics`, `frontend-foundation`, `frontend-properties-core`, `frontend-properties-extended` (3-leg matrix), `frontend-composition` (3-leg matrix), `frontend-language` (6-leg matrix), `frontend-tooling` (3-leg matrix), `product-smoke`, `kern-5-evidence`, and the aggregator `build-and-test` (source inspection, 2026-09-04).
- **VERIFIED:** `build-and-test` already has `if: ${{ always() }}`, `needs` on all 12 worker jobs, and a shell loop that fails unless every named job's `.result` is exactly `success` (`.github/workflows/ci.yml`, `build-and-test` job body).
- **VERIFIED:** `scripts/ci/test-tier-contract.test.mjs` pins the workflow's job graph, matrix shapes, and the KERN 5 evidence family script list (`kern5EvidenceCommands`) via string/regex assertions on the raw YAML text and `package.json`, not a YAML dependency — this is the established pinning style this slice's oracle follows (`scripts/ci/test-tier-contract.test.mjs:14-20` defines the reusable `workflowJob` extractor).
- **VERIFIED:** exactly four third-party actions are in use across the workflow: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/setup-python@v7`, `actions/upload-artifact@v7` (`grep -n uses: .github/workflows/ci.yml | sort -u`, 2026-09-04).
- **VERIFIED:** the concurrency block is exactly `group: ${{ github.workflow }}-${{ github.ref }}` / `cancel-in-progress: true` (`.github/workflows/ci.yml:9-11`).
- **VERIFIED:** the tribunal's dissenting-and-converged position (`claude-output.txt`, round 2) computed that finer-grained classes claimed by the initial FOR position collapsed under scrutiny (oracle-class savings dropped from 61% to 41% between rounds as the mapping was patched), found a concrete misclassification in the first-draft allowlist (`.Codex/specs/**` paired with frontend classes when F1–F4 jobs actually read specs), and converged on: "At most one narrow class: `DOCS_ONLY` = every changed path matches `**/*.md` … everything else FULL … Every other class … is an unverified bet that a path boundary equals a dependency boundary."
- **VERIFIED:** `codex-output.txt` (round 2, same tribunal) independently reached the identical `DOCS_ONLY`-only conclusion from a different angle (reading the sharded frontend scripts directly, e.g. `test:kern-frontend-runtime-text-cache` reads both `packages/core/tests/...` and `scripts/kern-frontend-falsification/...`), and additionally specified: fetch-depth 0 does not guarantee `origin/<base ref>` is present, so an explicit `git fetch origin <base ref>` step is required before merge-base computation; both sides of a rename must be checked; the aggregator must not trust a manifest the detector emits, only a checked-in policy file.
- **VERIFIED:** no `scripts/ci/classify-ci-changes.mjs`, `scripts/ci/evaluate-ci-lanes.mjs`, or `scripts/ci/ci-lane-policy.json` exists at base (`ls scripts/ci/` → 7 existing files, none matching, 2026-09-04).

## What Already Works

- `build-and-test`'s `if: always()` plus explicit per-job `.result` checking is the correct aggregator shape for a required check that must not go green on a skipped-but-needed job; this slice extends it (adds a policy-driven expected-state table) rather than replacing it.
- The existing `workflowJob`/string-pin testing style in `scripts/ci/test-tier-contract.test.mjs` is reused verbatim (a locally duplicated helper, since the original is not exported) rather than inventing a YAML-parsing dependency.
- The 12 existing lanes, their matrix shapes, and their build preambles are untouched; `FULL` classification runs CI exactly as today.

## Contract (Verified)

> Verified against: `.github/workflows/ci.yml`, `scripts/ci/test-tier-contract.test.mjs`, `scripts/ci/kern-5-census-sweep.mjs`, `scripts/ci/run-prebuilt-test.mjs`, and `/Users/nicolascukas/.agon/runs/tribunal-1788492416854-5o6i1y/{status.json,tribunal_3798618b.jsonl,claude-output.txt,codex-output.txt}` on 2026-09-04.

| Claim | Evidence | Tag |
|---|---|---|
| The tribunal ran 4 engines over 2 adversarial rounds and completed with `ok: true` | `status.json` | VERIFIED |
| Two independent engines (claude, codex) converged on exactly one narrow class, `DOCS_ONLY`, with everything else `FULL` | `claude-output.txt` §8 "What I'd accept"; `codex-output.txt` "Devil's-advocate decision" | VERIFIED |
| A first-draft finer taxonomy misclassified a spec change consumed by frontend jobs as skippable | `claude-output.txt` round 2, point 3 | VERIFIED |
| The aggregator must verify an exact expected state from a checked-in policy file, not a detector-emitted manifest | `codex-output.txt` §C "The expected map should be derived from the class in the aggregator, not accepted as arbitrary JSON emitted by the detector" | VERIFIED |
| `fetch-depth: 0` does not guarantee `origin/<base_ref>` is present; an explicit fetch is required | `claude-output.txt` round 2, point 5; `codex-output.txt` §A step 2 | VERIFIED |
| Both sides of a rename must be checked for the docs-only predicate | `codex-output.txt` §B "A rename from or to a non-Markdown path is FULL" | VERIFIED |
| `build-and-test` needs all 12 lanes and checks `.result == 'success'` for each | `.github/workflows/ci.yml` `build-and-test` job body | VERIFIED |
| No `pull_request.paths` filter exists today | `grep -n paths .github/workflows/ci.yml` → zero hits | VERIFIED |
| Exactly four `uses:` actions are in the workflow today | `grep -n uses: .github/workflows/ci.yml \| sort -u` → 4 distinct values | VERIFIED |
| `test-tier-contract.test.mjs`'s `workflowJob` helper is not exported | `scripts/ci/test-tier-contract.test.mjs:14` — `function workflowJob(...)`, no `export` keyword | VERIFIED |

## Decided Design (inherited from tribunal, not re-litigated)

1. **Classifier.** A new first job `detect-changes` runs `node scripts/ci/classify-ci-changes.mjs` after `actions/checkout@v7` (`fetch-depth: 0`) and an explicit `git fetch origin <base ref>` step. The script computes `git diff --name-status -z -M` against the merge base of `origin/<base ref>` and `HEAD`, considers both old and new paths of every entry (including renames), and exposes exactly one output, `ci_class` ∈ `{DOCS_ONLY, FULL}`. A `push` event short-circuits to `FULL` without touching git. An empty diff, a missing/unreachable merge base, any git subprocess failure, or any other classifier exception is caught and defaults to `FULL`; the CLI always exits `0` (a classifier bug must never fail the required check by crashing the job — it must fail open to the safe, complete answer). No `dorny/paths-filter`, no `on.pull_request.paths`.
2. **Exactly two classes.** `DOCS_ONLY` = diff is non-empty and every old and new path of every changed file ends in the literal, lowercase, non-empty-basename suffix `.md`, excluding any path under `.Codex/specs/`, `scripts/kern-5-*/`, or `scripts/kern-frontend-*/` (those `.md` files are read by tests, per the tribunal's misclassification finding). `FULL` = everything else, including the empty-diff and error cases. `DOCS_ONLY` runs `detect-changes` + `quality` + `build-and-test` only; every other lane is skipped via a job-level `if:` referencing `needs.detect-changes.outputs.ci_class` plus `needs: detect-changes`. `FULL` runs every lane exactly as today.
3. **Aggregator.** `build-and-test` keeps `if: always()`, adds `detect-changes` to its `needs` list, and evaluates an exact expected-state table read from a checked-in `scripts/ci/ci-lane-policy.json` (class → sorted set of lanes expected `success`; every other lane in the policy's lane universe expected `skipped`) crossed with the actual `needs.*.result` values. `failure`, `cancelled`, an empty/undefined result, a lane missing from the results, a lane present in results but absent from the policy's lane universe, or an unexpected `success`/`skipped` all fail the aggregator. The aggregator reads the policy file directly; it does not trust anything the detector itself emits about which lanes it thinks should have run.
4. **Pure modules.** Both scripts are dependency-free ES modules exporting testable pure functions: `classifyChanges({ eventName, baseRef, files: [{status, oldPath, newPath}] }) → 'DOCS_ONLY' | 'FULL'` and `evaluateLanes({ policy, ciClass, results }) → { ok, violations }`. The git plumbing (fetch verification, merge-base, diff, parsing) and the fail-closed try/catch live only in each script's CLI entry point (`if (process.argv[1] === fileURLToPath(import.meta.url))`), matching the existing `scripts/ci/kern-5-census-sweep.mjs` pattern of a testable core plus a thin CLI shell.
5. **Policy file shape.** `scripts/ci/ci-lane-policy.json` carries a `lanes` array (the complete, sorted, 12-entry lane universe — every current job id except `detect-changes` and `build-and-test`) and a `classes` object with exactly two keys, `DOCS_ONLY` (`["quality"]`) and `FULL` (the full sorted 12-lane array). It is self-consistent with the workflow's own job ids, checked by parsing `ci.yml` with a regex (mirroring `test-tier-contract.test.mjs`'s style), never a YAML dependency.

## Implementation Options

### A. Finer per-slice/per-oracle path classes

Rejected. This is what the tribunal's FOR position originally proposed and what both converged dissents rejected: the frontend and package-test jobs read across `packages/core/src`, `scripts/kern-5-*`, and `scripts/kern-frontend-*` in ways no hand-written map currently tracks, and the first draft already produced a live misclassification (a spec-only change starving frontend coverage while still going green). Revisiting this requires a dependency-derived mapping (see Standing Rule below), not another taxonomy guess.

### B. `dorny/paths-filter` or `on.pull_request.paths`

Rejected per the task's explicit constraint and the tribunal's framing: `on.pull_request.paths` breaks required-check semantics (a required check that never runs on an unmatched PR blocks merge forever), and `dorny/paths-filter` is a new third-party action when an in-tree classifier already covers the one class that matters and keeps the fail-closed logic auditable and testable in the same test runner as everything else in `scripts/ci/`.

### C. Exactly one narrow class (`DOCS_ONLY`), fail-closed detector, policy-verified aggregator

Selected — this is the tribunal's decided design, restated as claims above and carried into this slice's oracle unchanged.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.github/workflows/ci.yml` | Modify (future slice, NOT this one) | Add `detect-changes` job, gate 11 worker lanes on `ci_class`, extend `build-and-test`'s `needs` and verification step |
| `scripts/ci/classify-ci-changes.mjs` | Add (future slice, NOT this one) | Fail-closed classifier: pure `classifyChanges` plus a git-backed CLI entry point |
| `scripts/ci/evaluate-ci-lanes.mjs` | Add (future slice, NOT this one) | Pure `evaluateLanes` plus a CLI entry point invoked by `build-and-test` |
| `scripts/ci/ci-lane-policy.json` | Add (future slice, NOT this one) | Checked-in class → lane-set policy, self-consistent with `ci.yml` |
| `scripts/kern-5-ci-path-filters/*.test.mjs` | Add (this slice) | RED oracle: `classifier.test.mjs`, `classifier-cli.test.mjs`, `aggregator.test.mjs`, `workflow.test.mjs`, `policy.test.mjs` |
| `package.json` | Modify (this slice) | Add `test:kern-5-ci-path-filters` script; append it to `test:kern-5-script-family` |
| `scripts/ci/test-tier-contract.test.mjs` | Modify (this slice) | Append `'pnpm test:kern-5-ci-path-filters'` to `kern5EvidenceCommands` so the existing family-completeness assertion stays accurate |

## Acceptance Criteria

- [x] The oracle is RED at base for a single, correctly-attributed reason per file: `classifier.test.mjs` and `aggregator.test.mjs` fail at module resolution (`classify-ci-changes.mjs` / `evaluate-ci-lanes.mjs` do not exist); `classifier-cli.test.mjs` fails because the CLI file does not exist to spawn; `policy.test.mjs` fails on `ENOENT` reading `ci-lane-policy.json`; `workflow.test.mjs` fails its four detect-changes/gating assertions because the job does not exist, while its four structural-invariant assertions (no `paths:`, exactly four actions, unchanged concurrency block, quality ungated) already pass.
- [x] `pnpm test:ci-contract` is GREEN at base (16/16) after the `kern5EvidenceCommands` append, proving the append alone does not regress the existing family-completeness contract.
- [x] `pnpm lint` is GREEN at base (exit 0; pre-existing informational findings only, unrelated to this change; `scripts/kern-5-ci-path-filters/**` and `scripts/ci/**` are outside biome's `files.includes`, so this oracle never becomes lint-relevant).
- [x] `classify-ci-changes.mjs`, `evaluate-ci-lanes.mjs`, and `ci-lane-policy.json` exist and every row in this oracle is GREEN (`pnpm test:kern-5-ci-path-filters` → 32/32 subtests pass, exit 0, 2026-09-04); `ci.yml` gains `detect-changes`, gates the 11 skippable lanes, and `build-and-test` calls the evaluator against the policy file.
- [x] `pnpm test:kern-5-script-family`'s own member, `pnpm test:kern-5-ci-path-filters`, is GREEN in isolation, closing the intended ladder-slice RED window between the oracle commit and the implementation commit. The full chained `pnpm test:kern-5-script-family` command was not re-run end-to-end in the rescue worktree: that worktree symlinks only the repo-root `node_modules` (per its operating constraints, `pnpm install` is not permitted there), and every `packages/*/` workspace is missing its own `node_modules` symlink as a result, so `pnpm --filter @kernlang/core build` (the first step of the chain) fails on unresolvable `decimal.js` imports — a pre-existing property of that worktree's setup, unrelated to any file this slice touches (`scripts/ci/**`, `scripts/kern-5-ci-path-filters/**`, `package.json`, `.github/workflows/ci.yml`, `.Codex/specs/**`, none of which `packages/core`'s build reads). The identical build command succeeds from the fully-installed sibling checkout (`/Users/nicolascukas/KERN/kern-lang`) against the unmodified `packages/core` sources, and the conquer builder's own (fully `pnpm install`-ed) worktree reported the full family GREEN before this rescue began.

## Out of Scope (NOT NOW)

- **Any other narrow class** (per-slice, per-oracle, per-frontend-family, workflow/lockfile-aware, etc.). Queued as a follow-up slice, `ci-narrow-classes-v2` or similar, gated by the Standing Rule below.
- **Matrix leg collapse** (e.g. `frontend-tooling` 3→1, `frontend-properties-extended` 3→2). Queued as slice `ci-wall-clock`, per both `claude-output.txt` §7 and `codex-output.txt` §E: requires checking independent-leg-failure history first; a shared-fixture leg that has ever failed independently of its siblings must not be merged.
- **pnpm store / dependency caching.** Queued as part of `ci-wall-clock`.
- **A shared build artifact across jobs** (build once, fan out). Queued as part of `ci-wall-clock`.
- **The `ci-wall-clock` slice's required first step, per the tribunal:** pull the file-change statistics of roughly the last 200 merged PRs (`git log --stat` or the GitHub API) before proposing any further narrowing or matrix change, so the savings estimate is measured, not guessed — this is exactly the discipline this slice's own tribunal round 2 showed was missing from the first draft.
- **Production code for this slice's own design** (`classify-ci-changes.mjs`, `evaluate-ci-lanes.mjs`, `ci-lane-policy.json`, and the `ci.yml` edit itself). This spec and its oracle are the complete deliverable of this slice; implementation is the next slice, made trivial by a RED oracle that already pins every required row.

## Standing Rule

**A new narrow class may not be added by editing the allowlist alone.** It requires (a) a dependency-derived mapping — i.e., a verified accounting of which files each candidate-skippable lane actually reads, obtained by inspection of the lane's scripts and fixtures (not by assuming a path prefix implies a dependency boundary), and (b) its own PR, reviewed independently of any other CI change, carrying that verified mapping as evidence in its spec. This directly encodes the tribunal's central finding: the first `DOCS_ONLY`-adjacent taxonomy that was *not* dependency-derived (`KERN5_ORACLE_SPEC_ONLY` paired with skipping frontend lanes) was wrong on the first read of the actual scripts.

## Open Questions

- **OPEN (product decision, not blocking this slice):** whether `DOCS_ONLY` should also cover root `LICENSE`/`NOTICE` files if they are ever renamed to carry a `.md` suffix. The tribunal explicitly called the bare pattern "dead weight" today (no such files exist with `.md` suffixes); left as `FULL` by the exact-suffix rule with no special-casing, consistent with "everything not proven safe defaults to FULL."
- **OPEN (implementation detail deferred to the next slice, not a spec gap):** the exact `GITHUB_OUTPUT`/env-var contract asserted by `classifier-cli.test.mjs` (`GITHUB_EVENT_NAME`, `GITHUB_BASE_REF`, `GITHUB_OUTPUT` file, `ci_class=<value>\n` line, CLI always exits 0) is this spec's own design choice for testability, modeled on GitHub Actions' documented step-output mechanism; it is not independently re-verified against a live Actions run in this slice. Confidence impact: this is a well-documented, stable GitHub Actions mechanism (`$GITHUB_OUTPUT` file appending), not a novel or contested claim, so it is accepted as ASSUMED-but-low-risk rather than blocking.

## Deploy Order

The spec and RED oracle (this slice's first two commits) and the implementation (classifier, policy, evaluator, workflow gating — this slice's remaining commits) landed on the same branch and merge together in one PR: the three production files and the `ci.yml` edit are load-bearing together (a policy file without the workflow gating, or a classifier without the aggregator check, is not safely mergeable on its own), so splitting them across two PRs would have left an intermediate state where the oracle exists but nothing implements it, or the workflow gates on a script that fails to resolve. There is no mixed-version skew window: `detect-changes`, the gating `if:` conditions, and `build-and-test`'s policy-driven check land atomically in the workflow file in a single commit, and a PR opened against the old `main` before this merges still runs the full matrix (no partial-rollout state is possible in a single YAML file evaluated once per run). After merge, every subsequent PR against `main` is classified by `detect-changes` before any worker lane starts.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| The task's oracle-row list implied `classifyChanges` itself should surface a "throws" case unit-testably | The decided design's fail-closed catch lives in the CLI wrapper around git subprocess calls, not in the pure classification predicate; a pure function given well-formed input has nothing to "throw" over | Split into `classifier.test.mjs` (pure predicate, 11 unit rows) and `classifier-cli.test.mjs` (1 subprocess row, scratch git repo with no reachable merge base, asserting exit 0 and `ci_class=FULL`) |
| Assumed `test-tier-contract.test.mjs`'s `workflowJob` helper could be imported into the new workflow/policy oracle files | It is a local, unexported function (`scripts/ci/test-tier-contract.test.mjs:14`, no `export` keyword) | Duplicated a minimal equivalent locally in `workflow.test.mjs`, matching the project's existing precedent of small test-local helpers rather than adding a shared test-utility module |
| Assumed adding `test:kern-5-ci-path-filters` to `kern5EvidenceCommands` might destabilize `pnpm test:ci-contract` at base | Ran it after the edit: 16/16 GREEN, because that specific test only checks the aggregate script list against the array, not that every listed script's underlying files exist | No further action; documented as a base-gate result instead of a risk |
| `policy.test.mjs`'s `workflowJobIds()` helper claimed to extract "the workflow job ids" with `/^ {2}([a-z][\w-]*):\n/gmu` applied to the whole of `ci.yml` | The same two-space indentation is used by the `on:` block's trigger keys (`push:`, `pull_request:`), so the regex also matched those, returning 14 ids against a declared 12-lane universe and failing "the lane universe is sorted and self-consistent with the workflow job ids" for a reason unrelated to the lane universe itself | RULING (this rescue): scoped the scan to the `jobs:` section — `workflowJobIds()` now slices `text` from `text.indexOf('\njobs:\n')` before matching, so only job ids under `jobs:` are ever candidates. This strengthens the assertion to what its name already claimed ("workflow job ids") without weakening any row; it is the only oracle edit made in this rescue. `ci.yml`'s trigger and concurrency blocks are otherwise untouched (`git diff origin/main -- .github/workflows/ci.yml` shows no hunk before the `jobs:` line) |
| The builder proposed fixing the same regex collision by rewriting `ci.yml`'s `on:` trigger block from its multi-line form to an inline form (`push: { branches: [main] }`), reasoning that a PyYAML round-trip proved the two forms parse identically (commit `b7140718`, "chore(ci): inline the trigger values so job-id scans see only jobs") | Rejected in this rescue: (a) the fix belongs in the test, not the workflow — the trigger block was byte-identical and load-bearing on `origin/main` before this slice touched it, and changing its literal form to satisfy a test's regex conflates "make the oracle correct" with "make the workflow match the oracle's incidental blind spot"; (b) YAML-equivalence by re-serialization does not establish the two forms are equivalent to every consumer of the raw text, including this same oracle's own `workflow.test.mjs` string/regex pins, which are deliberately YAML-naive by design (see `test-tier-contract.test.mjs`'s established pinning style, referenced in Current State above) | `b7140718` was cherry-picked out of this rescue's branch; `ci.yml`'s trigger block (lines 1-11: `on:`/`push:`/`pull_request:` and `concurrency:`) is byte-identical to `origin/main`, verified by `git diff origin/main -- .github/workflows/ci.yml` showing the first hunk starting at `jobs:` |
| Spec's `evaluate-ci-lanes.mjs` design didn't specify whether `build-and-test` needs its own checkout/Node setup | The prior shell-loop aggregator needed neither; the new one calls `node scripts/ci/evaluate-ci-lanes.mjs`, which requires a Node runtime and a checked-out repo to read `ci-lane-policy.json` from | `build-and-test` gained `actions/checkout@v7` and `actions/setup-node@v7` (both already among the four permitted actions, so "no new `uses:`" holds); the twelve lane results are folded into one `LANE_RESULTS` JSON env var, matching `evaluate-ci-lanes.mjs`'s CLI signature (`<policy.json> <ci-class> <results-json>`) |
| The `GITHUB_OUTPUT`/policy-parsing robustness concern raised during implementation (CRLF, inline comments) | Verified moot for this design: `classify-ci-changes.mjs` only ever calls `appendFileSync(GITHUB_OUTPUT, 'ci_class=<value>\n')` and never reads that file back; `evaluate-ci-lanes.mjs` reads `ci-lane-policy.json` and its `LANE_RESULTS` argument with `JSON.parse`, which is line-ending- and comment-agnostic by construction (JSON has no comment syntax to misparse) | No code change required; confirmed by re-reading both CLI entry points and by the CLI dry-run scenarios below (docs-only, mixed, empty diff, missing base each yield exactly `ci_class=<value>\n`, nothing else, in `$GITHUB_OUTPUT`) |

## Gate Table (base, pre-implementation)

| Command | Result | Detail |
|---|---|---|
| `pnpm test:kern-5-ci-path-filters` | RED (exit 1) — 15 reported test units, 4 pass / 11 fail | See RED reasons per file below |
| `pnpm test:ci-contract` | GREEN (exit 0) — 16/16 | Confirms the `kern5EvidenceCommands` append does not regress the existing contract |
| `pnpm lint` | GREEN (exit 0) | 2 pre-existing informational findings unrelated to this change; new files are outside biome's `files.includes` |

### RED reasons, per oracle file

| File | Rows | Result at base | Reason |
|---|---|---|---|
| `classifier.test.mjs` | 11 | Whole file fails as 1 unit (0 rows execute) | `ERR_MODULE_NOT_FOUND: scripts/ci/classify-ci-changes.mjs` |
| `classifier-cli.test.mjs` | 1 | Fails | `execFileSync` spawn error: `Cannot find module .../classify-ci-changes.mjs` |
| `aggregator.test.mjs` | 8 | Whole file fails as 1 unit (0 rows execute) | `ERR_MODULE_NOT_FOUND: scripts/ci/evaluate-ci-lanes.mjs` |
| `policy.test.mjs` | 4 | All 4 fail individually | `ENOENT: scripts/ci/ci-lane-policy.json` |
| `workflow.test.mjs` | 8 | 4 fail, 4 pass | Fail: `workflow must define detect-changes` / `... must need detect-changes` (job absent). Pass (GREEN-at-base pins): no `paths:`/`paths-ignore:`, exactly the 4 existing actions, concurrency block unchanged, quality not gated on `DOCS_ONLY` |

## Gate Table (post-implementation)

| Command | Result | Detail |
|---|---|---|
| `pnpm test:kern-5-ci-path-filters` | GREEN (exit 0) — 32/32 subtests | All five oracle files pass against the landed `classify-ci-changes.mjs`, `evaluate-ci-lanes.mjs`, `ci-lane-policy.json`, and `ci.yml` |
| `pnpm test:ci-contract` | GREEN (exit 0) — 16/16 | Unaffected by the implementation commits |
| `pnpm lint` | GREEN (exit 0) | Same 2 pre-existing informational findings as base; `scripts/ci/**` remains outside biome's `files.includes` |
| `node --check scripts/ci/classify-ci-changes.mjs` | GREEN | |
| `node --check scripts/ci/evaluate-ci-lanes.mjs` | GREEN | |

### Classifier CLI dry runs (scratch git repos, outside the pnpm workspace)

| Scenario | `GITHUB_OUTPUT` content | Exit code |
|---|---|---|
| Docs-only PR (README.md-only change vs. base) | `ci_class=DOCS_ONLY` | 0 |
| Mixed PR (README.md + source file changed) | `ci_class=FULL` | 0 |
| Empty diff (feature branch at base, no commits) | `ci_class=FULL` | 0 |
| Missing/unreachable base ref (`GITHUB_BASE_REF` names a ref `git fetch` cannot find) | `ci_class=FULL` (stderr logs the caught fetch failure) | 0 |
| `push` event (no `GITHUB_BASE_REF`) | `ci_class=FULL` | 0 |

### Hand mutants (each restored byte-exact after testing; verified with `git diff`)

| Mutant | Change | Caught by | Result |
|---|---|---|---|
| (a) | Predicate accepts `.MD` (`basename.endsWith(...)` → `basename.toLowerCase().endsWith(...)`) | `classifier.test.mjs` — "uppercase and longer markdown-like extensions do not match the exact lowercase suffix" | KILLED (1 fail) |
| (b) | Excluded-prefix list drops `scripts/kern-frontend-*/` | `classifier.test.mjs` — "a markdown file under a kern-frontend slice directory forces full" | KILLED (1 fail) |
| (c) | Evaluator treats an unexpectedly-`success` lane as passing (`actual !== expected` → `actual !== expected && actual !== 'success'`) | `aggregator.test.mjs` — "DOCS_ONLY with an unexpected lane run is not ok" | KILLED (1 fail) |
| (d) | `ci.yml`'s `semantics` lane loses its `needs`/`if` gate | `workflow.test.mjs` — "every skippable lane needs detect-changes and gates on its ci_class output" | KILLED (1 fail) |
| (e) | `ci-lane-policy.json`'s `DOCS_ONLY` class adds `package-tests` | `policy.test.mjs` — "DOCS_ONLY lists exactly quality" | KILLED (1 fail) |

No survivors across the five hand mutants.
