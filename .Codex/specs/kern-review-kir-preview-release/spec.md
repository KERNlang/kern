# KERN KIR-Backed Review Preview Release

**Status:** IN PROGRESS — FIRST PRODUCT GOAL
**Date:** 2026-08-24
**Baseline:** `032f9e574673dcc1ca497458452556da49e2d4cd`
**Proposed release:** next KERN 4.x minor; `4.8.0` is the working label, not an
authorized version change or publication
**Implementation satellite:**
`.Codex/specs/kern-review-kir-preview-implementation/spec.md`
**Confidence:** 0.91 for the opt-in feature branch after current-main discovery
and full-roster challenge; release confidence remains capped by version/name
decisions below

## Executive Summary

The first shippable goal after the F5 source-to-KIR foundation is a KIR-backed
Review preview. A packed KERN installation must accept real `.kern` modules,
produce authenticated canonical F5 KIR, and use that KIR to report semantic
API, import/export, dependency, capability, call, effect, and structural
changes. Formatting-only edits must produce no semantic change.

The feature ships as an explicit advisory preview. Existing Review remains the
default during the skew window; the preview never silently falls back or
reports an empty success when projection or analysis fails. This release is a
bounded product milestone, not KERN 5 canonical cutover and not authorization
to publish.

## Current State and Root Cause

- **[KRP-C1 VERIFIED]** F5 already produces validated canonical module-KIR
  bytes from a module set. It authenticates policy/composition, executes F4 and
  F5, stages canonical bytes, and validates them with `decodeModuleKir` before
  returning. Evidence:
  `scripts/kern-frontend-f5-projection/worker.mjs:1-25,95-127`.
- **[KRP-C2 VERIFIED]** F5 is deliberately private: the current API-isolation
  oracle requires no `f5-projection`/`frontend-f5` public core export.
  Evidence: `scripts/kern-frontend-f5-projection/api-isolation.test.mjs:9-15`.
- **[KRP-C3 VERIFIED]** The canonical module artifact already exposes modules,
  imports, bindings, exports, and structural roots, with strict versioned
  formats and decoding. Evidence:
  `packages/core/src/kir-structural/module-types.ts:5-52` and
  `packages/core/src/kir-structural/module-canonical.ts:154-213,220-240`.
- **[KRP-C4 VERIFIED]** Current `.kern` Review does not consume F5. It invokes
  `parseWithDiagnostics` with TypeScript classifiers and converts that legacy
  tree into the existing rule pipeline. Evidence:
  `packages/review/src/index.ts:1080-1119`.
- **[KRP-C5 VERIFIED]** The existing semantic-diff implementation is
  TypeScript/inference-oriented: its public engine accepts `InferResult[]` and
  `ConceptMap`, while its source helper reparses through TS inference and
  ts-morph. Evidence:
  `packages/review/src/semantic-diff.ts:1-15,117-130,324-369`.
- **[KRP-C6 VERIFIED]** Review already has a stable unified report containing
  findings, semantic changes, health, provenance-related state, and stats.
  Evidence: `packages/review/src/types.ts:348-408`.
- **[KRP-C7 VERIFIED]** The CLI imports Review's public API and routes reviewed
  files through `reviewFile`; the MCP server separately calls
  `reviewKernSource`. Evidence:
  `packages/cli/src/commands/review.ts:1-46,218-229` and
  `packages/mcp-server/src/index.ts:386-407`.
- **[KRP-C8 VERIFIED]** Published `@kernlang/review` contains only `dist`,
  already depends on `@kernlang/core`, and currently reports version `4.6.0`.
  Core likewise ships only `dist`; its exports contain no frontend-projection
  subpath. Evidence: `packages/review/package.json:1-31` and
  `packages/core/package.json:1-78`.
- **[KRP-C9 VERIFIED]** The release train expects exactly 22 public packages,
  not a one-package ad hoc publish. Evidence:
  `scripts/release/release-policy.json:5-9` and
  `scripts/release/package-graph.test.mjs:26-33`.

The missing feature is therefore a packaged contract chain, not another Review
rule:

```text
.kern module set
  -> packaged authenticated F1-F5 projection
  -> canonical ModuleKirArtifact + source provenance
  -> KIR-native Review model and semantic diff
  -> existing ReviewReport / CLI / JSON / SARIF surfaces
```

## What Already Works

- F1-F5 semantics, canonical encoders/decoders, and mutation walls remain the
  authority. The preview reuses them; it does not design another parser.
- Existing Review reporting, filtering, baselines, JSON, SARIF, health,
  suppressions, and CLI presentation remain reusable.
- TypeScript, JavaScript, and Python Review paths remain unchanged.
- Existing KERN source rules may be reused only where a rule can consume an
  explicitly derived KIR view without reconstructing legacy parser semantics.
- KERN 5 runtime/compiler/import work continues in parallel; this release does
  not wait for those lanes.

## Product Contract

> Verified against baseline `032f9e57` on 2026-08-24.

| Boundary | Required behavior | Status | Tag |
| --- | --- | --- | --- |
| Source request | Ordered, non-empty `{moduleId, source}` module set with exact shape and limits | F5 worker already enforces the private form | VERIFIED |
| Projection | One authenticated F1-F5 execution returns canonical bytes or an atomic diagnostic receipt | Private implementation exists; packed form missing | VERIFIED |
| KIR input | Exact `kern.kir.modules.r1.5e.1-alpha` bytes plus authenticated format/policy/provenance identities | Codec exists | VERIFIED |
| Review model | KIR-derived modules, declarations, handler signatures, imports/exports, calls/effects/capabilities, and source spans | Missing | DECIDED |
| Semantic diff | Compare two validated KIR artifacts; stable identities and source provenance determine findings | Missing | DECIDED |
| Report | Reuse `ReviewReport`, adding explicit analysis-mode and artifact-identity evidence without breaking existing optional consumers | Existing public report is extensible | DECIDED |
| CLI | Explicit advisory preview selector; default legacy behavior is unchanged during the preview release | Missing | DECIDED |
| Failure | Projection/version/policy/provenance/analysis failure is visible degraded/error evidence; never empty success or silent legacy fallback | Missing | DECIDED |
| Packaging | Packed consumer installs the release train and runs the feature without workspace files, examples, or script-relative imports | Missing | DECIDED |

### Public preview surface

The implementation satellite must freeze exact TypeScript names, but the
semantic shape is decided here:

1. A package-owned core projection service accepts module sources and returns
   canonical KIR bytes, projection receipt, format/policy identities, and
   source-provenance data. It packages every required KERN composition and
   policy artifact under `dist`; it cannot load repository `examples/` or
   `scripts/` paths.
2. `@kernlang/review` exposes a direct KIR review entrypoint for callers that
   already own validated bytes and a module-set convenience entrypoint that
   invokes the packaged projection service exactly once.
3. Review output identifies `legacy-source`, `canonical-kir-preview`, or
   `dual-compare` analysis mode and the canonical artifact identity.
4. The CLI exposes a configurable preview mode and dual-comparison mode. Exact
   flag/config spelling is frozen by the implementation satellite before RED
   fixtures; it is not hardcoded operational policy.
5. Existing `reviewKernSource` remains source-compatible. The MCP and playground
   may adopt the preview in later slices; they must not be silently rerouted in
   this first release.

### Useful first-release findings

The preview is release-worthy only if it reports all of these from canonical
KIR rather than source text:

- module added/removed/renamed;
- public function/class export added, removed, renamed, or re-exported;
- import source/binding/re-export changes;
- handler parameter and return-type changes;
- structural node/property changes with canonical values;
- call target/argument-shape changes represented in admitted expressions;
- effect/capability addition or removal represented in admitted KIR; and
- target-compatibility exclusions or frontend diagnostics carried by the
  authenticated projection/provenance envelope.

If current F5 does not carry enough authenticated source-span or diagnostic
provenance for a listed finding, that omission is a frontend productization RED
for this slice. Review must not infer the missing information through the
legacy parser.

## Implementation Options

### Option A — Packed core projection plus KIR-native Review adapter (recommended, 0.94)

Productize the accepted F5 chain behind a narrow packed core subpath, build a
KIR-native Review model/diff, and expose opt-in CLI/package entrypoints. This
makes the release useful to both CLI users and API consumers while preserving
the existing default during the preview window.

### Option B — CLI-only bridge to repository scripts (0.35)

Import the current F5 worker directly from the CLI. This may work in the
monorepo but fails packed consumers because F5 currently depends on repository
scripts/examples. Rejected.

### Option C — Wait for KERN 5 canonical cutover (0.45)

This avoids a preview surface but postpones user value and leaves Review on the
legacy parser throughout compiler/runtime development. Rejected.

## Bounded Slices

1. **RP0 — Packed projection contract:** move/copy no semantics; package the
   authenticated F1-F5 composition, policy, decoder, and immutable identities
   behind a narrow core service. Prove byte equality with the accepted private
   worker and kill script/example/workspace reachability.
2. **RP1 — KIR Review model:** derive immutable Review entities from decoded
   `ModuleKirArtifact` plus authenticated provenance. No findings yet.
3. **RP2 — Semantic diff and findings:** implement the first-release finding
   matrix, formatter-insensitive equality, stable fingerprints, and explicit
   unsupported/degraded evidence.
4. **RP3 — CLI and dual mode:** wire advisory preview and dual comparison into
   `kern review`; preserve existing defaults and machine formats.
5. **RP4 — Packed preview RC:** pack the complete 22-package train, install in a
   fresh root, run source and diff fixtures, and verify exact artifact/package
   identity. Only after this slice is independently reviewed may a release be
   recommended.

RP0 and RP1 can run in parallel after their shared input/output fixture is
frozen. RP2 depends on RP1. RP3 can prepare presentation/config plumbing in
parallel but cannot claim KIR findings before RP2. RP4 is the convergence gate.

## Expected Blast Radius

| Area | Action | Reason |
| --- | --- | --- |
| `packages/core/src/` and package exports/assets | add bounded packed projection service | Make accepted F5 available without repository paths |
| `packages/review/src/` | add KIR model, diff, findings, optional report evidence | Review canonical semantics |
| `packages/cli/src/commands/review.ts` | add explicit preview/dual routing | User-facing access |
| F5 projection scripts/tests | retain as independent oracle; adapt isolation contract deliberately | Prove packaged/private parity |
| release and packed-consumer fixtures | add preview manifest and clean-root test | Prove the release helps installed users |
| MCP/playground/evolve | compatibility tests only in this release | Prevent accidental client skew |

No handwritten file may exceed 500 lines. New Review logic is split by KIR
model, diff, findings, and adapter rather than added to the already-large
`packages/review/src/index.ts`.

## Binary Acceptance Criteria

- [ ] **KRP-A1 Packed projection:** a clean packed consumer projects the frozen
      module set to bytes identical to the accepted F5 worker, with no access to
      repository `scripts/`, `examples/`, workspace links, stale `dist`, or
      untracked files.
- [ ] **KRP-A2 Authentication:** policy/composition/provenance/format mutations,
      missing packaged assets, duplicate modules, and version skew fail before
      Review findings; no partial report is retained.
- [ ] **KRP-A3 KIR ownership:** import/call traps prove preview mode cannot reach
      `parseWithDiagnostics`, TypeScript classifiers, `inferFromSource`, or
      ts-morph for `.kern` semantics.
- [ ] **KRP-A4 Semantic matrix:** each first-release finding family has one
      positive old/new KIR pair, one unchanged pair, one reordered-but-equal
      pair, and one mutation that kills its comparator.
- [ ] **KRP-A5 Formatting:** source files differing only by accepted formatting
      produce byte-identical semantic artifacts or an empty semantic-change
      list with matching artifact semantics.
- [ ] **KRP-A6 Visibility:** projection or analysis failure produces explicit
      report health/error evidence and CLI output; it cannot become “no issues,”
      empty SARIF success, or automatic legacy fallback.
- [ ] **KRP-A7 Dual comparison:** dual mode runs canonical and legacy analysis
      independently, labels both, reports divergence, and never lets legacy
      output satisfy a missing canonical result.
- [ ] **KRP-A8 Compatibility:** existing TypeScript, JavaScript, Python, MCP,
      playground, evolve, JSON, SARIF, baseline, and suppression tests retain
      their current behavior unless the preview is explicitly selected.
- [ ] **KRP-A9 Performance:** configurable source/KIR/work/memory budgets are
      enforced prospectively; the reference corpus records latency and peak
      memory without turning measurements into hardcoded operational policy.
- [ ] **KRP-A10 Packed API:** generated declarations and package exports expose
      only the accepted preview entrypoints; consumer tests exercise both ESM
      imports and the CLI from packed tarballs.
- [ ] **KRP-A11 Release convergence:** planned
      `pnpm test:kern-review-kir-preview` and packed preview consumer gate pass
      on the exact candidate; independent risk-routed review has no verified
      blocker; release policy still sees exactly 22 public packages.
- [ ] **KRP-A12 Truth:** docs call the feature advisory preview, identify the
      KIR format as alpha/nonterminal, and make no KERN 5 runtime/compiler or
      canonical-cutover claim.

## Release and Skew Order

1. Land RP0 behind an unpublished/private selector and keep existing Review
   default.
2. Land RP1/RP2 API behind preview configuration; packed tests must pass before
   CLI exposure.
3. Land RP3 advisory CLI/dual mode. Old clients continue using legacy mode;
   new clients can select preview explicitly.
4. Build RP4 from a clean candidate and run the complete local release wall.
5. Stop before version mutation, tag, registry publication, or deployment.
   Those require explicit authority and an exact chosen version.
6. If authorized, publish the established dependency-first 22-package train;
   verify registry integrity and a clean consumer before moving any tag.

The preview does not become fail-closed CI authority in this release. KERN 5
R2/R3 promotion remains the point where canonical Review evidence becomes
mandatory.

## Out of Scope

- KERN-owned target compilation or runtime execution.
- npm/PyPI external-import semantics.
- Replacing TypeScript/Python Review paths.
- Canonical Review enforcement in CI.
- General cloud Review service or multi-tenant persistence.
- Publishing, tagging, or changing package versions in this planning slice.

## Human Decisions Before Release

1. **[OPEN — release decision]** Confirm the exact 4.x version. `4.8.0` is the
   current working label; the repository source is `4.6.0`.
2. **[OPEN — product decision]** Confirm whether preview mode is opt-in only or
   enabled by default for new `.kern` projects. Recommendation: opt-in for the
   first release.
3. **[OPEN — product decision]** Confirm release notes/product name:
   recommended “KIR-backed Review Preview.”

The current task resolves item 2 for this feature branch: preview remains
explicitly opt-in and legacy remains the default. Items 1 and 3 do not block
RP0-RP4 implementation, packing, or the authorized single feature-branch push;
they block version mutation, publication, and release-note finalization.

## Corrections Log

| Original claim | Reality | Impact |
| --- | --- | --- |
| F5 is merged, so Review can consume it immediately. | F5 is intentionally private and imports repository scripts/examples. | RP0 must productize a packed authenticated projection boundary first. |
| Existing semantic diff can be pointed at KIR. | It consumes legacy `InferResult`/`ConceptMap` and reparses old source with TS tooling. | Build a KIR-native model and diff rather than adapting TS inference. |
| A Review-only package release is sufficient. | Release policy expects the full 22-public-package train and Review depends on core/CLI integration. | Prove the exact packed train and clean consumer before release. |
| Advisory failure may silently use legacy results. | That would make preview success unverifiable. | Label dual results and surface canonical failure explicitly; never fallback silently. |
| F5 bytes are sufficient authenticated Review input. | The private receipt does not bind request identity or output-byte digest. | Add the packaged receipt/verifier contract before Review consumes the artifact. |
| F5 already provides stable node IDs, spans, and target profiles. | Those evidence fields are absent at `032f9e57`. | Use semantic set keys, omit unauthenticated locations in v1, and bind an explicit versioned target profile. |
