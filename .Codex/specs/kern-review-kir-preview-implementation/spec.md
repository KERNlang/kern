# KIR-Backed Review Preview Implementation Contract

**Status:** READY TO BUILD
**Date:** 2026-08-24
**Baseline:** `032f9e574673dcc1ca497458452556da49e2d4cd`
**Branch:** `feat/kir-backed-review-preview`
**Challenges:** full-roster brainstorm `brainstorm-1787558312573-lcj6gd`;
oracle Nero passes `nero-1787560164355-typdkl`,
`nero-1787560643192-0np2j2`, and `nero-1787561028406-n3132d`
**Confidence:** 0.91 after challenge-driven oracle hardening

## Executive Summary

Ship an opt-in, receipt-verified Review path that projects ordered `.kern`
module sets through the accepted F1-F5 implementation packaged inside
`@kernlang/core`, decodes only authenticated canonical module KIR, and compares
deterministic KIR-derived semantic facts. The stable Review path remains the
default. Preview failure is a typed failure and dual mode keeps canonical and
legacy results separate; neither mode may substitute legacy results for missing
canonical evidence.

The accepted design is a receipt-closed packed projection followed by a pure
Review fact model. A per-node Merkle format is deferred because F5 has no stable
node identity today; v1 instead uses stable semantic keys for named declarations
and set-valued facts, plus canonical digests for anonymous structural facts.

## Current State / Root Cause

- **[KRI-C1 VERIFIED]** F5 accepts exact `{moduleId, source}` records, executes
  F4 once, executes F5 once only after F4 classification, stages canonical
  bytes, validates those bytes through `decodeModuleKir`, and returns atomic
  rejection/fatal results with `bytes: null`.
  Evidence: `scripts/kern-frontend-f5-projection/worker.mjs:65-123`.
- **[KRI-C2 VERIFIED]** F5's receipt contains its format, policy digest,
  terminal seal, diagnostics, and work steps, but does not bind the request or
  output-byte digest. Evidence:
  `scripts/kern-frontend-f5-projection/worker.mjs:50-62,116-123`.
- **[KRI-C3 VERIFIED]** The decoded module artifact contains sorted module IDs,
  imports, bindings, exports, and structural roots. Root properties include
  canonical expressions and handler types. Evidence:
  `packages/core/src/kir-structural/module-types.ts:5-52`,
  `packages/core/src/kir-structural/module-canonical.ts:40-74,154-254`, and
  `packages/core/src/kir-structural/expression.ts:9-189`.
- **[KRI-C4 VERIFIED]** Capability, effect, fetch, emit, return, and throw are
  admitted structural node kinds; call sites are canonical `call` expressions.
  Evidence: `packages/core/src/kir-structural/catalog.generated.ts:2084`,
  `:2954`, `:2979`, `:3419`, `:5028`, `:9840`, and
  `packages/core/src/kir-structural/expression.ts:121-128`.
- **[KRI-C5 VERIFIED]** F5 is intentionally unexported and its worker loads
  repository `scripts/`, `examples/`, and source-policy paths that are absent
  from the core tarball. Evidence:
  `scripts/kern-frontend-f5-projection/api-isolation.test.mjs:9-15`,
  `scripts/kern-frontend-f5-projection/worker.mjs:1-26`, and
  `packages/core/package.json:8-72`.
- **[KRI-C6 VERIFIED]** Current `.kern` Review calls the legacy
  `parseWithDiagnostics`; existing semantic diff consumes legacy inference and
  is not wired into actual CLI diff reports. Evidence:
  `packages/review/src/index.ts:1085-1119`,
  `packages/review/src/semantic-diff.ts:117-130,324-369`, and
  `rg -n 'computeSemanticDiff' packages/cli/src packages/review/src/index.ts`
  on 2026-08-24 (exports only; no CLI call).
- **[KRI-C7 VERIFIED]** The release policy requires exactly 22 public packages
  and the existing clean consumer packs and imports public exports from exact
  tarballs. Evidence: `scripts/release/release-policy.json:5-9`,
  `scripts/release/package-graph.test.mjs:26-33`, and
  `scripts/release/offline-consumer.mjs:60-248`.

The root cause is a missing supported contract chain. Canonical source-to-KIR
exists only as a private repository oracle; Review has no verified projection
input and therefore reconstructs `.kern` semantics through the legacy parser.

## What Already Works

- F1-F5 KERN compositions, policies, decoders, canonical codecs, limits, and
  focused gates remain authoritative and are packaged byte-for-byte. They are
  not reimplemented in TypeScript.
- Existing `ReviewReport`, findings, JSON, SARIF, baseline, suppression,
  TypeScript, JavaScript, Python, MCP, playground, and evolve behavior remains
  unchanged when preview is not explicitly selected.
- The existing 22-package release train remains the packaging boundary. No new
  public package or version change is introduced.

## Contract (Verified and Decided)

> Verified against `032f9e57` on 2026-08-24. `DECIDED` rows are frozen by this
> implementation satellite and must be proven by RED fixtures before export.

| Field / Behavior | Type | Evidence | Tag |
| --- | --- | --- | --- |
| Public projection subpath | `@kernlang/core/frontend-projection` | Current export map has no conflicting subpath: `packages/core/package.json:8-68` | DECIDED |
| Canonical Review subpath | `@kernlang/review/kir-preview` | Canonical CLI mode must not initialize the legacy Review root, parser, or `ts-morph` | DECIDED |
| Dual Review subpath | `@kernlang/review/kir-preview-dual` | Dual mode intentionally owns both canonical and legacy closures without making either reachable from the stable Review root | DECIDED |
| Projection call | `projectKernModules(request): Promise<KernProjectionResult>` | Async permits package-relative asset loading without exposing worker internals | DECIDED |
| Verification call | `verifyKernProjection(request, result): Promise<VerifiedKernProjection>` | Closes request/result detachment before Review and shares the async public boundary | DECIDED |
| Request | exact non-empty `modules` plus optional explicit budgets | Private request constraint: `worker.mjs:88-94` | DECIDED |
| Success | `status: 'projected'`, bytes, decoded artifact, receipt | Private F5 success: `worker.mjs:116-123` | DECIDED |
| Failure | `status: 'rejected' | 'fatal'`, `bytes: null`, receipt | Private F5 atomic failure: `worker.mjs:98-114` | DECIDED |
| Receipt format | `kern.frontend.packaged-projection.1` | New wrapper contract | DECIDED |
| Receipt bindings | request/module-set digest, artifact digest, F5 policy digest, F5 receipt format/status, projection asset-manifest digest, work counts, terminal seal | F5 currently lacks request/artifact binding: `worker.mjs:50-62` | DECIDED |
| Direct Review call | `compareCanonicalKir(base, head, options?)` accepts only verified projections | Prevent detached or merely decodable bytes | DECIDED |
| Convenience Review call | `reviewKernModuleSets({base, head, mode, targetProfiles?})` projects each side exactly once | Product request | DECIDED |
| Analysis modes | `legacy-source`, `canonical-kir-preview`, `dual-compare` | Product request | DECIDED |
| CLI selector | `--analysis-mode=legacy-source|canonical-kir-preview|dual-compare` | Existing output flag remains unrelated | DECIDED |
| CLI default | `legacy-source` | Required skew behavior | DECIDED |
| Comparison status | `complete | degraded | failed` plus typed diagnostics | Existing health precedent: `packages/review/src/types.ts:302-342` | DECIDED |
| Fact facets | modules, public API, imports/dependencies, capabilities, calls, effects, structure, target compatibility | Requested acceptance | DECIDED |
| Target profile | versioned caller-supplied or package-default immutable profile with its digest in evidence | Current KIR carries no target profile | DECIDED |
| Finding order | code-point order by facet, module, entity key, change kind, fingerprint | Current severity-only ordering is insufficient | DECIDED |

### CLI base/head resolution

The CLI must not manufacture a semantic comparison by passing one module set
as both `base` and `head`. The supported preview contracts are:

| Invocation | Canonical inputs | Observable contract |
| --- | --- | --- |
| `canonical-kir-preview` without `--diff` | the selected current module set is projected on both sides | labeled `snapshot`, proving projection/verification health only; it does not claim change findings |
| `canonical-kir-preview` with `--diff <ref>` | complete `.kern` module sets at `<ref>` and in the worktree, optionally scoped by the explicit path | labeled `git-diff`, with added, deleted, and renamed paths retained on their actual side |
| `dual-compare` with `--diff <ref>` | the same independently materialized base/head sets feed canonical analysis while legacy remains separately labeled | real comparison; canonical failure remains terminal for the CLI invocation |
| `dual-compare` without a resolvable baseline | none | typed CLI failure; never a same-set fallback |

Base source is read from Git object data and head source from the worktree.
Module IDs are repository-relative for Git comparisons and cannot contain
`..`; explicit files outside the current directory use a stable common source
root rather than invalid upward-relative IDs. If either Git side has no module
set that F5 can authenticate, the preview fails visibly instead of fabricating
an empty artifact or inferring removals. The legacy default path and its
existing diff loader remain byte-compatible.

### Projection receipt and verification

The packaged asset builder copies the exact required F1-F5 script/KERN/policy
closure under `packages/core/dist/frontend-projection-assets/`. Policy-addressed
files retain their original virtual repository paths and bytes. Imports that
formerly targeted workspace `packages/core/dist` are rewritten only to the
installed core `dist`; the builder records every source/destination digest and
the rewritten runtime closure in `assets.json`.

Request identity uses a code-point-sorted module list and unambiguous
length-prefixed UTF-8 framing over module ID and source. The result receipt
binds that identity, the artifact SHA-256, the private F5 policy digest, the
asset manifest digest, the private receipt status/format, and work counts.
`verifyKernProjection` asynchronously recomputes every public binding, rejects
unknown fields, decodes the exact bytes, and returns a branded verified value.
SHA-256 here is
an integrity/content-identity mechanism, not remote signer authentication.

### KIR-native Review model

The model is immutable and contains only facts derived from decoded KIR plus a
versioned target profile:

- module identity and canonical module digest;
- public symbol key `moduleId/kind/name`, signature digest, and re-export route;
- import/dependency key `moduleId/source/imported/local/kind/reexport`;
- capability key from canonical namespace/name/operation properties and owner;
- call facts extracted recursively from canonical expression records, keyed by
  owning named declaration, property path, canonical callee, and argument
  shape; unresolved/dynamic targets are explicit facts;
- effect facts for admitted capability/effect/fetch/emit/throw nodes and their
  canonical properties, keyed by named owner plus canonical fact digest;
- structural facts keyed by named owner plus canonical subtree digest; and
- target compatibility facts emitted by evaluating KIR node/expression kinds
  against a versioned target profile whose digest is included in result
  evidence.

Source positions are display metadata only and are absent in v1 when F5 does
not authenticate them. No equality key uses a line, column, sibling ordinal, or
input ordering. Identical anonymous duplicates collapse as a multiset count;
count changes remain semantic. Renames are deterministic removed+added pairs
unless a unique equal-content pair permits a rename finding.

### Failure and dual semantics

Projection or verification failure returns `failed`, an explicit diagnostic,
no canonical findings, and no success artifact identity. A degraded comparison
may contain only facets proven complete on both sides; it cannot infer a
removal from missing evidence. Preview mode never imports/calls
`parseWithDiagnostics`, `reviewKernSource`, `inferFromSource`, or `ts-morph`.
Dual mode runs canonical and legacy independently and returns both labeled
results plus divergence; legacy success never fills a missing canonical result.
The canonical CLI path imports only `@kernlang/review/kir-preview`; dual mode
imports only `@kernlang/review/kir-preview-dual`. The stable Review root gains
no preview export or static/dynamic preview reachability, so existing Review,
playground, MCP, and browser consumers retain their prior module graph.

## Implementation Options

### Option A — Receipt-closed packed core service and Review fact model (selected, 0.91)

Meets the full requested product boundary while retaining stable defaults. The
packaged asset closure is mechanically generated and independently compared to
the private F5 worker.

### Option B — Review-owned deep import of repository workers (rejected, 0.20)

Cannot work from tarballs and violates the supported package boundary.

### Option C — Public bytes-only codec plus caller-owned projection (rejected, 0.48)

Would not let a clean consumer accept `.kern` sources and would leave Review
without authenticated projection provenance.

### Deferred v2 — Per-node content-addressed/Merkle evidence (0.72)

Potentially stronger and cheaper comparison, but blocked by stable node IDs and
not required for the first useful preview.

## Blast Radius and File Ownership

| Lane | Files | Reason |
| --- | --- | --- |
| RP0 | `packages/core/src/frontend-projection/**`, `packages/core/package.json`, `scripts/build-kern-frontend-projection-assets.mjs`, focused core tests | Packaged verified projection |
| RP1/RP2 | `packages/review/src/kir-preview/**`, `packages/review/src/index.ts`, Review tests | Model, comparator, findings, failure evidence |
| RP3 | `packages/cli/src/commands/review.ts`, CLI tests | Explicit preview/dual routing |
| RP4/oracle | `scripts/kern-review-kir-preview/**`, root `package.json`, release tests/docs | RED matrix, packed consumer, 22-package proof |

No worker may edit another lane's files. New handwritten source files stay
below 500 lines; generated asset manifests and copied build outputs are exempt.

## Acceptance Criteria / RED Oracle

- [ ] **KRI-A1 Packed projection parity:** workspace and packed calls project a
      frozen multi-module source set to byte-identical F5 KIR.
- [ ] **KRI-A2 Receipt closure:** source, module ID/order framing, policy,
      composition, asset manifest, receipt, and detached-byte mutations fail
      verification before Review.
- [ ] **KRI-A3 Atomicity:** duplicate modules, malformed source, budget limits,
      missing assets, and version skew return typed failure with no bytes or
      partial findings.
- [ ] **KRI-A4 Ownership traps:** preview cannot reach the legacy KERN parser,
      inference, TS classifiers, or ts-morph.
- [ ] **KRI-A5 Semantic matrix:** every required facet has positive,
      unchanged, reordered-equivalent, rename/move where supported, and
      comparator-killing mutation fixtures.
- [ ] **KRI-A6 Formatting:** comment/whitespace-only source pairs have equal
      semantic models and zero changes, irrespective of source positions.
- [ ] **KRI-A7 Determinism:** repeated and permuted module requests yield
      byte-identical JSON findings and fingerprints.
- [ ] **KRI-A8 Visible failure:** text, JSON, and SARIF surface canonical
      projection/analysis failure and cannot encode it as empty success.
- [ ] **KRI-A9 Dual isolation:** canonical and legacy outputs are labeled and
      independent; canonical failure remains failure when legacy succeeds.
- [ ] **KRI-A10 Stable defaults:** all existing Review/library/CLI/MCP/
      playground/evolve behavior is byte-compatible unless the selector is
      explicit.
- [ ] **KRI-A11 Packed API:** clean tarball consumer typechecks/imports the core
      subpath and Review API, projects real `.kern`, runs comparison, and invokes
      the packed CLI without repository or workspace reachability.
- [ ] **KRI-A12 Release policy:** package graph remains exactly 22 public
      packages and generated declarations/exports expose only accepted APIs.
- [ ] **KRI-A13 Gate:** `pnpm test:kern-review-kir-preview` covers the focused
      oracle; relevant core, Review, CLI, packaging, consistency, lint, build,
      identity/hash, release-policy, workspace, and final fitness walls pass on
      the exact integrated candidate.
- [ ] **KRI-A14 Truth:** docs call the format alpha/nonterminal and the feature
      advisory; they make no compiler/runtime/canonical-cutover/release claim.

## Out of Scope

- Versions, tags, registry publication, deployment, or enabling preview by
  default.
- KERN-owned target compiler/runtime implementation.
- npm/PyPI external-package semantics.
- Authenticated source spans or per-node Merkle identity in preview v1.
- Silent repair, heuristic source parsing, or legacy substitution.

## Deploy Order and Skew Window

1. Land RP0 and RP1/RP2 behind exports with no default consumer.
2. Land RP3 explicit selector after packed API proof.
3. Run RP4 on the exact candidate and keep stable defaults unchanged.
4. Push the complete feature branch once; do not merge, version, tag, publish,
   deploy, or push main.
5. During skew, old clients remain legacy; new clients opt into preview or dual.
   Canonical failure is visible and the feature remains advisory.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| F5 canonical bytes alone authenticate Review evidence. | The private receipt does not bind request identity or output digest. | Add a packaged receipt wrapper and verifier before Review. |
| Current F5 has stable node identity and spans. | It has structural roots and positional form but no authenticated stable node IDs/spans. | Use semantic keys/set facts; omit locations and defer per-node Merkle identity. |
| Target compatibility is already in KIR. | No target-profile identity exists in F5. | Make the target profile explicit, versioned, immutable, and digest-bound in Review evidence. |
| Existing semantic diff can be extended. | It is legacy-inference based and not wired into CLI diff. | Build an isolated KIR-native model/comparator. |
| Core package can directly export the F5 worker. | The worker depends on unshipped repository assets. | Build and audit a private packed asset closure; export only the typed service. |
| The old goal forbade every push. | This task explicitly authorizes one feature-branch push after gates/review. | Permit only the final feature-branch push; main/release operations remain forbidden. |

## Challenge Delta

Initial confidence was 0.78. Full-roster brainstorm
`brainstorm-1787558312573-lcj6gd` caught receipt detachment, missing stable node
identity/spans, absent target-profile evidence, and the semver cost of a public
subpath. The corrected plan adds request/artifact/asset bindings, semantic
set-key identity, explicit target profiles, location-free v1 findings, and a
flag-based revert path. Three Nero passes then exposed gameable test surfaces:
same-process reference pollution, hardcoded single-fixture/facet behavior,
weak target/diagnostic/dual identity checks, ambient packed state, bootstrap
semantic reconstruction, and cyclic dependency omission. The RED suite now
uses child-process private-F5 parity, generated non-fixture and combined-facet
sources, exact delta/profile/receipt/diagnostic assertions, poisoned isolated
packed execution, source-closure traps, and cyclic atomic failure. Remaining
unknown implementation defects are handled by post-implementation mutation and
risk-routed review, not by weakening the oracle. No unresolved technical OPEN
claim feeds the RED fixtures; release version/name decisions remain outside
this implementation and do not block an opt-in feature branch. Confidence:
0.91.
