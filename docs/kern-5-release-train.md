# KERN 5.0 Release Train

**Status:** PLAN ONLY
**Date:** 2026-07-10
**Baseline:** `main` at `477063a1`; source version `4.5.0`
**Architecture:** `docs/kern-5-own-language-plan.md`
**Oracles:** `docs/kern-5-release-oracles.md`
**Recommended bar:** Bar C via B
**Schedule confidence:** 0.82
**Sequence confidence:** 0.94
**Adversarial pass:** Agon Nero `nero-1783661241064-hz8z9t`

## Release Decision

KERN 5 should use four evidence stages, but only one required public release:

```text
R0 release machinery
        |
        v
internal Alpha: contracts and non-circular runtime seam
        |
        v
internal Beta: feature complete, all new paths blocking in shadow
        |
        v
internal RC: canonical cutover, exact packed artifact proof
        |
        v
public v5.0.0: same accepted source SHA, version-injected and promoted
```

Alpha, Beta, and RC are quality bars recorded by commit SHA and an immutable
release manifest. They do not change package versions or create public releases
by default. A public Beta or RC is justified only when a named external consumer
cannot test the packed tarballs or a downstream canary.

This keeps npm and CI noise low during a projected 14-24-calendar-day train.
It also avoids pretending that a prerelease is useful merely because SemVer can
name one.

## Non-Negotiable Release Meaning

The final claim remains:

> KERN 5 parses, checks, compiles, and executes its canonical handler language
> through KERN-authored semantic tooling over versioned KIR. Host code provides
> explicit capabilities and transport only. A clean bootstrap proves the KERN
> compiler reaches a deterministic stage1==stage2 fixed point.

The following decisions are frozen for this train:

- Bar B+ is the Beta checkpoint, not an acceptable silent redefinition of
  `5.0.0`.
- If the KERN semantic interpreter cannot become canonical, the train remains
  Beta until it can. The release oracle is not weakened.
- TypeScript remains a separately selectable, continuously gated bootstrap
  oracle and emergency engine. It is never an automatic semantic fallback.
- WASM, all-target self-hosting, a package manager, and an LSP are not blockers.
- `vscode-kern` is outside the workspace package graph and outside this release;
  it needs its own version and Marketplace/Open VSX train.

## Verified Release-Machinery Gaps

These are current facts, not proposed work:

| Current behavior | Evidence | Consequence | Tag |
|---|---|---|---|
| Stable release accepts only `vX.Y.Z` | `.github/workflows/release.yml:28-37` | Public prereleases cannot use the stable workflow | VERIFIED |
| Preflight accepts only stable SemVer | `.github/workflows/release-preflight.yml:31-37` | Alpha/Beta/RC cannot preflight | VERIFIED |
| Stable publish omits `--tag` | `.github/workflows/release-pipeline.yml:89-99` | A prerelease would move npm `latest` | VERIFIED |
| Canary derives the next 4.5 patch | `.github/workflows/canary-publish.yml:72-99` | Current main produces `4.5.1-canary...`, not a KERN 5 canary | VERIFIED |
| Manual canary tag is free-form and bypasses CI | `.github/workflows/canary-publish.yml:21-27,39-43,89-93` | An operator can select `latest` without a CI result | VERIFIED |
| Publish runs no test wall | `.github/workflows/release-pipeline.yml:75-99` | The exact version-injected artifact is less proven than main | VERIFIED |
| Registry verification checks only version URLs | `.github/workflows/release-pipeline.yml:101-131` | It does not prove integrity, dependencies, install, or execution | VERIFIED |
| Publish workflows are cancellable | `.github/workflows/release.yml:7-9`; `.github/workflows/canary-publish.yml:29-31` | Cancellation can strand a partial immutable package upload | VERIFIED |
| Every release syncs its version to `dev` | `.github/workflows/release-pipeline.yml:139-210` | A prerelease would break stable-only canary generation | VERIFIED |
| CI runs on main, not dev | `.github/workflows/ci.yml:3-11` | The documented automatic canary-on-green-dev trigger has no CI run to observe | VERIFIED |

Therefore R0 is a release blocker even if all language work is already green.

## R0 - Make Publication Recoverable

**Purpose:** ensure the exact tested package graph is what reaches npm.

**Work:**

1. Create one release-policy/config source for target version, allowed channels,
   channel-to-dist-tag mapping, public package discovery, and stable-only dev
   synchronization. Workflows consume it; they do not duplicate policy.
2. Validate versions with one tested SemVer parser. Derive the channel from the
   version; never accept an arbitrary public dist-tag.
3. Reserve `latest` for stable versions. Explicitly reject it from canary,
   Alpha, Beta, and RC paths.
4. Make real publication globally serialized and non-cancellable. Concurrency
   may cancel preflight, but never an upload or tag-promotion transaction.
5. Bind the job to an exact commit SHA and injected release version. Run the
   full release wall inside that job; a separate preflight is only an early
   signal, not proof that the publish commit passed.
6. Build and pack once. Test those exact tarballs, record their SHA-512/integrity,
   then publish those exact files. Add npm provenance when the organization or
   trusted-publishing configuration is verified.
7. Compute package layers from runtime `dependencies` and
   `optionalDependencies`. Ignore `devDependencies` when ordering publication.
8. Upload every immutable version under a version-specific staging tag. Verify
   all package names, versions, internal exact dependencies, exports, binaries,
   integrity, and clean consumer execution before any public-channel movement.
9. Promote dependency layers first and `kern-lang` last. Treat the root package
   tag as the channel commit marker.
10. Verify every moved tag and run a post-promotion install by both exact version
    and channel. Only a stable final synchronizes versions back to `dev`.
11. Fix or remove the impossible automatic dev-canary trigger. A manual KERN 5
    canary must still require a recorded green SHA and a configured target
    release line.
12. Extend `check:repo` so release policy, package discovery, internal dependency
    versions, and workflow contracts cannot drift independently.

**Important limitation:** npm dist-tag updates are not atomic across packages.
The plan does not claim otherwise. Exact internal dependency pins, dependency-
first movement, a root-package commit marker, global serialization, and
roll-forward recovery make the normal install path coherent while minimizing
the unavoidable direct-package tag window.

**Recovery procedure:**

- Missing staged artifact: publish it, then resume verification.
- Existing artifact with matching integrity: treat it as complete and resume.
- Existing artifact with different integrity: hard stop; never overwrite or
  reuse the version. Diagnose and issue a new prerelease or patch version.
- Tag promotion fails before the root marker moves: leave the channel officially
  unpromoted and resume forward; do not alternate tags backward and forward.
- Root marker moved but post-promotion smoke fails: restore the root/CLI public
  entry tags to the previous coherent release, deprecate the broken version,
  and ship a fully gated next patch. Published versions are never rewritten.

**Exit gate:** simulate failure after every package layer and every tag layer;
the recovery tool resumes without republishing mismatched bytes, changing
`latest`, or producing a green result for an incomplete graph.

**Estimate:** 0.5-1.5 active days. This can overlap Alpha design, but it must
land before any public KERN 5 canary or release.

**Confidence:** 0.96 on necessity; 0.88 on the exact implementation until npm
trusted-publishing/provenance configuration is inspected.

## R1 - Internal Alpha: Freeze the Truth

**Scope:** M0-M2 from the architecture plan.

**Entry:**

- `main` baseline is green and recorded by SHA.
- Bar C, mandatory target legs, formatter wording, and exclusions are resolved.
- Every new oracle is RED at base for the intended missing behavior.

**Build order:**

**Slice progress:**

- [x] R1.1 Alpha constitution: truthful support matrix, versioned fitness
  policy, frozen current-wall oracle, canonical aggregate, and shared
  repository contract validation.
- [x] R1.2 checker v2 closure: 48/48 TS/KERN byte-matched fixtures,
  36 accept-but-abstain attacks rejected, 23 direct safe-integer cases, and the
  complete `fitness:kern-5` wall passed on 2026-07-11.
- [x] R1.3 KIR seam probe and selection: typed semantic projection selected;
  source AST and runner lowering rejected; 20/20 strict, hostile-value,
  module-graph, mutation, and subprocess checks passed on 2026-07-11.
- [x] R1.4a internal semantic KIR reader candidate: core/probe parity with no
  public export or stability claim.
- [x] R1.4b bootstrap-dependent, non-circular semantic ownership substrate:
  source-bound current TypeScript authority witness plus an acyclic,
  oracle-free planned path over the internal reader candidate. This is not
  executable handler-semantic ownership or runtime cutover.
- [ ] R1.5 eligible KIR/value/diagnostic contract freeze and Alpha manifest.
  Runtime trace, handler, scheduler, and capability ABIs are M3 work in R2.
  - [x] R1.5a source/runner eligibility inventory and identity constitution.
  - [x] R1.5b bounded strict UTF-8 canonical/value reader.
  - [ ] R1.5c coverage-closed module/node writer-reader parity.
    - [x] R1.5c.1 schema and property constitution: exact source-bound census
      covers all 302 node kinds and 1,149 property contracts; full fitness wall
      and final 3/3 Agon review passed on 2026-07-12 (`ALPHA-NO-GO`).
    - [x] R1.5c.2 structural writer and bounded reader: internal browser-safe
      codec uses identical bounded canonical-value limits, a closed portable
      expression catalog, and an explicit empty type catalog; full fitness wall
      and final 3/3 Agon review passed on 2026-07-12 (`ALPHA-NO-GO`).
    - [x] R1.5c.3 module and symbol-kind parity: ordered per-source roots,
      explicit `class | fn` symbols, dependency-ordered transitive re-exports,
      pure POSIX resolution, full fitness wall, and final 3/3 Agon review passed
      on 2026-07-12 (`ALPHA-NO-GO`).
    - [x] R1.5c.4 executable coverage closure: all 302 node kinds and 1,149
      properties have 2,286 executable include/exclude witnesses; 16 runtime
      contracts remain explicitly deferred to M3. Full fitness wall and final
      3/3 Agon review passed on 2026-07-12 (`ALPHA-NO-GO`).
  - [ ] R1.5d diagnostic/location evidence contract and Alpha manifest.
    - [x] R1.5d.1 separately versioned diagnostic and UTF-8 byte-location
      evidence, bound to exact source and structural KIR bytes. Full fitness
      wall and final 3/3 Agon review passed on 2026-07-12 (`ALPHA-NO-GO`).
    - [x] R1.5d.2 clean-HEAD immutable Alpha receipt generator and release
      gate: policy-bound hashes/oracles/exclusions, dirty-tree and symlink kill
      tests, full fitness wall, and final 3/3 Agon review passed on 2026-07-12.
      The SHA-named ignored receipt is generated only after commit.
- [ ] R2 M3 runtime and handler ownership.
  - [x] M3.1 internal transactional runtime envelope: default-off sync/async
    normalization with closed portable values, structural diagnostics, failure
    suppression, and containment from every public export. This deliberately
    leaves the public runtime/handler ABI and effect scheduler unpromoted. The
    full fitness wall and final 3/3 Agon review passed on 2026-07-12.
  - [x] M3.2 internal typed handler entry: exact-arity portable parameters feed
    fresh sync/async runtime environments, with invalid or currently
    non-executable argument shapes rejected before handler execution. Decimal,
    nested-record, source-linking, scheduler, and public-ABI work remain
    explicitly deferred. The full fitness wall and terminal 3/3 Agon review
    passed with zero verified findings on 2026-07-12.
  - [ ] M3.3 internal source handler identity/link: one bounded source document
    resolves a canonical source path and exact top-level KERN handler into the
    M3.2 typed entry. Modules, helper/class linking, scheduler, runner-contract,
    and public-ABI work remain explicitly deferred.

1. Correct the support matrix and make `fitness:kern-5` the planned aggregate,
   without pretending missing commands already exist.
2. Close checker v2: admit structured `while`/`else`, replace literal numeric
   whitelists with the designed integer contract, and accept-and-run every
   handwritten self-hosted tool.
3. Probe the three KIR seams and select one only after hostile values,
   diagnostics, effects, modules, capabilities, and determinism discriminate
   them.
4. Promote the selected strict reader into browser-safe core source as an
   internal candidate, parity-locked to the probe and deliberately unexported.
5. Prove the planned canonical runtime call chain is non-circular before any
   ABI promise: executing a KERN-authored interpreter through
   `referenceRunSequence` is not yet semantic ownership.
6. R1.5a: bind every static source node and native runner contract to an
   executable eligibility inventory. Preserve `ALPHA-NO-GO` while the selected
   probe covers only seven of 302 source node kinds.
7. R1.5b: implement the bounded strict UTF-8 canonical/value reader with closed
   scalar, collection, map, record, and error-data profiles. Regex, expression,
   and operator admission remain excluded from this portable value format.
8. R1.5c: close module/node writer-reader parity and freeze any portable regex
   and operator grammar that admitted nodes require. Every catalog row becomes
   included, deterministically lowered, or explicitly excluded with fixtures.
9. R1.5d: version diagnostic/location evidence separately, require stable
   non-empty diagnostics and expression spans, then generate the clean-SHA
   Alpha manifest. Unknown versions and fields fail before effects.

The original broad R1.4-before-ownership order was withdrawn after the R1.3
probe. The selected projection covers seven of 302 source node kinds, while the
native runner requires 16 semantic contracts. R1.5a makes that denominator and
the remaining blockers executable. Trace, handler, scheduler, and capability
ABIs stay in M3 because they describe runtime convergence rather than KIR wire
identity. The split prevents an internal shadow schema from becoming an
accidental public promise.

**Binary exit:**

- Checker accepts and executes assertion, validator, and checker modules.
- Orphan/duplicate `else`, unsafe loops, invalid numeric boundaries, and every
  accept-but-abstain attack reject.
- Canonical KIR bytes match across the hostile corpus, process, OS, locale, and
  clean-root matrix.
- Unknown KIR/ABI input fails before any effect or partial output.
- No OPEN or ASSUMED claim feeds a build oracle.
- The complete 4.5 regression wall remains green.

**Artifact:** Alpha manifest containing commit SHA, frozen schema hashes,
oracle results, and known exclusions. No package version or public tag.

**Rollback:** disable readers/shadows; the current 4.5 path remains primary. If
the KIR leaks TypeScript coercion rules or the runtime seam is circular, Alpha
fails and the contract is redesigned.

**Scheduling rule:** release by binary slice completion, not calendar guesses.
Each R1.5a-d slice ships only after its named oracle, the complete 4.5 wall, and
three-engine review pass. Historical 4.0/4.5 throughput is useful for ordering,
but it is not evidence for the unresolved KIR coverage count.

**Confidence:** 0.97 in the R1.5a-d order after the completed KIR audit,
three-engine tribunal, and full-roster brainstorm. Confidence in Alpha timing
remains deliberately unstated until R1.5b measures the strict-reader work.

## R2 - Internal Beta: Become Feature Complete

**Scope:** M3-M8, with every new implementation default-off until the end.

After Alpha, two lanes may advance in isolated branches and merge serially:

- **Runtime/app lane:** one sync/async semantic scheduler, typed handler call,
  explicit effects, KERN policy decisions, generic app host, and native/TS/
  Python capability parity.
- **Toolchain lane:** KERN canonicalizer/formatter, frontend, compiler, and the
  clean Stage 0 -> Stage 1 -> Stage 2 fixed point.

The KERN interpreter shadow begins only after both lanes consume the frozen KIR
and handler/capability ABIs.

**Binary exit:**

- Typed handler arguments/results validate symmetrically; errors expose no
  partial result, stdout event, response, or host effect.
- Sync and immediately resolved async providers produce byte-identical semantic
  traces through one engine.
- No application-specific stdout marker becomes an HTTP response.
- Formatter is idempotent and preserves canonical KIR:
  `format(format(x)) == format(x)` and
  `KIR(parse(format(x))) == KIR(parse(x))`.
- KERN and bootstrap frontends emit byte-identical KIR and stable diagnostic
  code/location over the complete valid and malformed corpus. No tolerated
  drift list exists.
- KERN compiler output byte-matches the bootstrap output on the discriminating
  corpus and compiles its own sources.
- Stage 1 equals Stage 2 twice from separate clean roots using immutable packed
  inputs; behavior and diagnostics also match.
- Auth, HMAC, and RAG review pass the runner-host, Express, FastAPI, emitted
  capability, and whole-app failure matrix. Hosts provide facts; KERN decides.
- KERN interpreter shadow has zero typed-result, event, diagnostic, completion,
  or capability-request divergence across every supported v5 construct.
- Mutated parser/compiler/interpreter implementations are killed by the oracle.

**Artifact:** Beta manifest with exact SHA, schema/ABI hashes, fixed-point
hashes, packed-tarball integrities, full shadow report, and explicit gaps. The
new paths remain default-off.

**Optional public Beta:** allowed only after R0 and only for a named downstream
test plan. Use a configured `5.0.0-beta.N` channel; never `latest`. Every code or
semantic change increments `N` and reruns the exact publication wall.

**Rollback:** turn off the shadow path and keep the TS bootstrap engine primary.
Any KIR or ABI change invalidates Alpha and restarts Beta parity.

**Estimate:** 6-9 active / 8-14 calendar days after Alpha, assuming the proven
parallel design/build cadence.

**Confidence:** 0.86 after Alpha freezes KIR; 0.72 today because the semantic
interpreter remains the largest technical risk.

## R3 - Internal RC: Cut Over, Do Not Add Features

**Scope:** canonical cutover and release proof only.

**Entry:** Beta is feature complete, Stage 1 equals Stage 2, interpreter shadow
is zero-drift, and the full support matrix contains no future-tense v5 claim.

**Order:**

1. Freeze public APIs, KIR, handler ABI, capability ABI, configuration schema,
   CLI behavior, and package graph.
2. Make the KERN semantic engine canonical for internal packages, then CLI Node,
   then browser. Each flip has its own trace and budget wall.
3. Keep the TS oracle inside the same built release graph behind an explicit,
   config-driven engine selector. Run both canonical and forced-TS lanes in CI;
   unsupported canonical input fails loudly instead of falling back.
4. Remove the scheduled 4.x root re-exports and prove the selected browser-safe
   public graph reaches no TypeScript compiler or Node-only module.
5. Correct README, support matrix, runtime roadmap, migration guide, changelog,
   examples, and wording. “Preview” remains only on genuinely gated surfaces.
6. Pack the exact graph and run one clean downstream KERN product canary.
7. Run the full local wall, then full-roster `agon review`; fix every verified
   blocker and restart RC if source changes.

**Binary exit:**

- `pnpm fitness:kern-5` passes twice from separate fresh roots and builds every
  artifact it reads.
- Normal execution has a static/dynamic witness that it never invokes the TS
  ReferenceRunner semantic path.
- Forced TS-oracle mode remains buildable, executable, and trace-compatible.
- No hidden fallback test can make canonical mode pass unsupported input.
- Exact packed tarballs pass imports, CLI check/compile/run, reference app,
  Express/FastAPI app, and clean fixed-point bootstrap.
- Browser graph and configured performance budgets pass.
- Full-roster review reports no verified blocker.

**Artifact:** immutable RC manifest with source SHA, toolchain versions, policy
hashes, all tarball integrities, all gate results, and the only intentional
RC-to-final difference: injected SemVer/version stamps.

**Optional public RC:** allowed only when external installation is itself an
acceptance dependency. Use `5.0.0-rc.N` on the configured RC tag. Any source
change creates a new RC and reruns all proof.

**Rollback:** select the already-built TS oracle explicitly and restore the
previous package entry tag if necessary. This rollback is tested in the exact
RC artifact; it is not a promise to rebuild an old source tree later.

**Estimate:** 1-2 active / 2-3 calendar days.

**Confidence:** 0.92 after Beta exits; 0.78 today because cutover cost depends
on the still-unmeasured interpreter and browser budgets.

## R4 - Public v5.0.0

**Rule:** final contains no new source work.

1. Point the final tag at the exact accepted RC source SHA. If RC was internal,
   verify the manifest SHA; if it was public, both release tags identify the
   same source commit.
2. Inject `5.0.0` through the configured release policy. Rebuild from a clean
   root and compare the result with the RC manifest after normalizing only the
   enumerated version-stamp fields.
3. Run the complete release wall again inside the publish job.
4. Pack once, verify, and upload every exact tarball under a version-specific
   staging tag using the R0 recovery algorithm.
5. Verify registry integrity, exact internal dependencies, exports/binaries,
   clean exact-version install, CLI/runtime/app execution, and fixed-point
   bootstrap.
6. Promote public tags dependency-first and `kern-lang@latest` last. Verify each
   move, acknowledge the non-atomic direct-package window, and keep `4.5.0`
   recoverable throughout.
7. Install from `latest` in a clean consumer and rerun the representative smoke
   wall. Then create/finalize the public release record and sync the stable
   baseline to `dev`.
8. Record tag, source SHA, workflow run, provenance, package integrities, and
   post-publish results in the final release manifest.

**Failure after upload:** never reuse `5.0.0`. Deprecate it, restore public
entry tags to the last coherent release when necessary, fix on main, run a new
RC, and publish `5.0.1`.

**Estimate:** 0.5-1 active day; about one calendar day.

**Confidence:** 0.96 once the RC manifest is accepted.

## Target Release Wall

The current `fitness:kern-5` implements every CURRENT row in the versioned
fitness policy, but it is not yet the full target wall. Commands marked TARGET
must be created and promoted atomically in the policy and support matrix before
RC.

```text
pnpm check:repo
pnpm lint
pnpm build
pnpm test
pnpm check:conformance
pnpm test:kern
pnpm test:runner-smoke
pnpm test:app-behavior
pnpm test:drift-showcase
pnpm check:runner-browser-budget:required
pnpm test:kern-ir-probe               # CURRENT experimental seam oracle
pnpm test:kern-ir-reader-candidate    # CURRENT internal reader candidate
pnpm test:kern-semantic-ownership     # CURRENT bootstrap-dependent ownership proof
pnpm test:kern-ir-eligibility         # CURRENT Alpha no-go coverage/identity inventory
pnpm test:kern-canonical-value        # CURRENT bounded internal value reader
pnpm test:kern-ir                      # TARGET
pnpm test:runtime-abi                  # TARGET
pnpm test:kern-frontend                # TARGET
pnpm test:kern-compiler                # TARGET
pnpm test:selfhost-fixed-point         # TARGET
pnpm test:kern-interpreter-shadow      # TARGET
pnpm test:packed-release               # TARGET
git diff --check
```

`fitness:kern-5` becomes the self-contained aggregator for this wall. It cannot
read stale `dist/`, workspace-linked packages, or evidence from another SHA.

## Slice-to-Main Operating Rhythm

Every feature slice follows the same sequence:

1. Start from current `origin/main`; restate the 3-5-step slice plan and freeze
   its claim-tagged contract.
2. Write a discriminating oracle, prove RED-at-base for the intended reason,
   and red-team it for a subtly wrong passing implementation.
3. Implement in an isolated branch/worktree. The design lane may prepare only
   the next slice; the build lane remains serial at integration.
4. Run touched-package gates plus the complete currently available repository
   wall.
5. Run full-roster `agon review`, verify findings from source/reproduction, fix,
   and rerun until there is no blocker.
6. Make granular local Agon-signed commits, push the complete feature once, and
   hand over the native-git PR link. Never push directly to main without
   explicit confirmation.
7. After human merge, record the merge SHA and oracle evidence in the current
   stage manifest before starting a dependent slice.

## Schedule Based on Actual KERN Velocity

| Evidence window | Observed result |
|---|---:|
| v3.5.8 -> v4.0 | 33 commits over 7 active days / 6d 7h elapsed |
| v4.0 -> v4.1 | 44 commits over 10 active days / 11d 21h elapsed |
| v4.1 -> v4.5 | 32 commits over 10 active days / 14d 22h elapsed |
| Self-host ladder #488 -> #500 | 13 landings in 27h 54m |

The critical-path projection is **10-16 active build days / 14-24 calendar
days**. R0 overlaps Alpha design; internal manifests add little release latency.
The serial sum is closer to 10-17 active days if publication machinery cannot
overlap.

This is not a commitment to a calendar date. The two confidence dependencies
are the KIR seam and the non-circular interpreter substrate. If either misses
its probe exit after one milestone cycle, report the evidence and replan rather
than silently consuming contingency.

## Go/No-Go Summary

KERN 5.0 is releasable only when all are true:

- [x] R0 publication failure/recovery simulations pass. R0.1-R0.4 now enforce
      policy-bound planning, exact 22-package artifact validation, durable
      forward-only registry publication, and root-last failed-smoke containment
      with exhaustive ambiguous-mutation drills.
- [ ] Alpha freezes non-host-specific KIR and a non-circular runtime seam.
- [ ] Beta is feature complete and all shadow parity is zero-drift.
- [ ] Stage 1 equals Stage 2 twice from clean packed inputs.
- [ ] KERN policies and capabilities pass native/TS/Python and whole-app walls.
- [ ] RC canonical execution has no TS semantic call or silent fallback.
- [ ] The forced TS oracle remains operational in the same artifact.
- [ ] Root/browser public boundaries match the v5 support matrix.
- [ ] Exact RC tarballs pass downstream canary and packed bootstrap.
- [ ] Final source SHA equals accepted RC source SHA.
- [ ] Final exact-version wall, staging upload, integrity verification,
      dependency-first promotion, and post-`latest` smoke pass.
- [ ] Documentation says no more than the binary oracles prove.

If any item is false, remain at the prior internal stage. Do not relabel the
remaining work as Fable merely to make `5.0.0` ship.
