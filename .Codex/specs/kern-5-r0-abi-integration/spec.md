# KERN 5 R0 Executable ABI Integration

**Status:** IMPLEMENTED AND FOCUSED GATE GREEN — AWAITING FINAL REVIEW
**Date:** 2026-08-26  
**Current base:** `origin/main` at `7212b0498ffbaa1ede3a4cb36ff50bb1e4208dff`  
**Historical candidate:** `feat/kern-5-r0-abi`, commits `d4f401c1..b7fb9492`  
**Initial integration confidence:** 0.89  
**Nero verdict:** FLAWED, critic confidence in the original plan 0.18  
**Revised confidence:** 0.93

## Objective

Integrate the already implemented private R0 executable compiler/runtime ABI
cell onto current `main`, preserve its reviewed commit provenance, and add one
current-main convergence witness proving that exact packaged F1-F5 KIR bytes
drive both provisional target adapters while KIR-backed Review reports one
exact advisory semantic delta.

This is a bounded KERN 5 contract cell. It is not a public compiler/runtime
cutover or a KERN 5 release.

## Current State

- **VERIFIED:** Current `main` has the accepted packaged F1-F5 projection at
  `@kernlang/core/frontend-projection` and the advisory KIR-backed Review API
  at `@kernlang/review/kir-preview`.
- **VERIFIED:** Current production CLI compilation and execution remain
  source/legacy paths and do not consume R0 KIR target artifacts.
- **VERIFIED:** The historical candidate adds a private authenticated bundle
  under `scripts/kern-5-r0-contracts/` and only one root test command.
- **VERIFIED:** The candidate defines closed compiler request/result, target
  artifact, runtime request/envelope, value, effect, error, cancellation,
  timeout, log, digest, and budget contracts.
- **VERIFIED:** It generates and executes real ESM and Python files from the
  same authenticated KIR v1 bytes, compares canonical output bytes, and rejects
  source/AST/legacy-IR compiler input.
- **VERIFIED:** It covers nine deterministic topologies including nested
  records/lists through strict JSON text, zero/one/two capabilities,
  capability error, pre-cancel, cancel/timeout ordering, and concurrency.
- **VERIFIED:** The relevant authority files in `packages/core/src/kir-v1`,
  `kir-structural`, `runtime-envelope`, `runtime-handler.ts`,
  `canonical-value`, and `codegen/kern-stdlib.ts` are unchanged between the
  historical base `032f9e57` and current `main`.
- **VERIFIED:** Current-main changes in scope are the packaged Review Preview
  and dependency/CI metadata; no KIR/runtime semantic implementation drift was
  found.
- **VERIFIED:** The historical RED oracle patch applies to current `main` with
  the same stable patch ID and fails only at the deliberately absent
  `scripts/kern-5-r0-contracts/oracle.mjs` seam.
- **VERIFIED:** The historical candidate is merged with current `main`, its
  artifacts were regenerated there, and the focused R0 gate passes 40 tests
  plus the authenticated checker.
- **VERIFIED:** The current convergence witness proves that its representative
  semantic bytes came from the packaged F1-F5 projection and binds an exact
  current KIR Review capability delta.

## Producer and Consumer Chain

1. **VERIFIED:** `projectKernModules({modules})` normalizes ordered `.kern`
   modules, invokes packaged F1-F5 assets, and returns issued semantic KIR
   bytes, an artifact, diagnostics, and an integrity receipt.
2. **VERIFIED:** `verifyKernProjection(request, result)` rechecks the issued
   receipt, byte digest, packaged decoder, and artifact equality.
3. **VERIFIED:** The convergence witness wraps the exact verified F5 semantic
   bytes in accepted KIR v1 evidence without reparsing or re-encoding the
   semantic component.
4. **VERIFIED:** The R0 compiler input contains only ID, selected entry,
   authenticated KIR v1 bytes, and source-evidence catalog. Runtime arguments,
   transcripts, controls, topology descriptions, and expected output do not
   cross the compiler call.
5. **VERIFIED:** `generateR0AbiArtifacts` authenticates KIR/evidence, lowers the
   admitted subset, and emits deterministic ESM/Python artifacts and manifests.
6. **VERIFIED:** Each target process consumes the same canonical runtime request
   shape and emits one canonical `kern.runtime.kir.r0` envelope.
7. **VERIFIED:** Review compares a base/head source pair through packaged KIR
   and must return exactly one matching `capability-changed` finding for the
   same operation mutation used by the executable convergence witness. Other
   deterministic cross-facet findings remain advisory.

## Contract Boundaries

### Compiler

The existing `kern.compiler.request.r0`, `kern.compiler.result.r0`, and
`kern.target.artifact.r0` formats remain unchanged. **VERIFIED:** No current
package export is added. The integration test may create a KIR v1 wrapper only
after proving its semantic bytes are byte-identical to the verified F5 result.

### Runtime

The existing `kern.runtime.kir.r0` data-only request/envelope remains the
authority. Portable tagged values, absent/value slots, ordered stdout/stderr/
capability events, diagnostics, completion, outcome, logical cancellation and
timeout controls, limits, and request identity remain closed and target-neutral.

### Review

Review remains advisory and uses `canonical-kir-preview`. **VERIFIED:** The
convergence witness requires one exact semantic finding and zero diagnostics;
it does not make Review a terminal gate, permit source fallback, or alter
production behavior.

### Policy

Latency and peak-memory ceilings remain manifest-configurable. No operational
model, engine, quota, rollout, or release policy is hardcoded.

The explicit `test:kern-5-r0-contracts` command remains a private sub-gate and
is intentionally absent from the default root/terminal aggregate until a later
promotion decision. This avoids expanding the required CI wall while preserving
an exact runnable command for the cell. **VERIFIED scope decision.**

## Integration Strategy

1. Add and commit this satellite spec on the fresh current-main branch.
2. Merge `feat/kern-5-r0-abi` with `--no-ff` so original commit identities,
   authorship, parentage, and prior review evidence remain reachable.
3. Resolve only genuine current-main integration conflicts; do not rewrite the
   historical series.
4. Add a separate Agon-signed integration commit for the F5/Review convergence
   witness, current baseline/status correction, and authenticated manifest
   rebinding.
5. Run the focused R0, KIR runtime binding, runtime contract, Review Preview,
   build/typecheck, lint, and diff/file-size gates in proportion to risk.
6. Run current high-risk Agon review with automatic live-roster routing and
   mutation testing, verify findings, and fix genuine blockers.
7. Push the complete feature branch once and verify the remote SHA.

## Alternatives

### Reimplement the R0 cell

**REJECTED:** It would replace 3,400 reviewed lines without any discovered
semantic drift in their dependencies, increasing regression and review cost.

### Cherry-pick or rebase the historical commits

**REJECTED:** It would rewrite commit identities and weaken the audit trail.
The non-fast-forward merge preserves the coherent historical chain.

### Merge without new convergence evidence

**REJECTED:** Historical tests authenticate KIR v1 but build semantic bytes
through the parser/structural encoder. The current goal explicitly requires
exact packaged F1-F5 bytes and current KIR Review convergence.

### Promote a public runtime/compiler route now

**REJECTED:** R0 is a feasibility contract cell. General lowering, production
routing, terminal promotion, and releases belong to later lanes.

## Blast Radius

| Path | Change | Purpose |
| --- | --- | --- |
| `.Codex/specs/kern-5-r0-abi-integration/spec.md` | add | Current integration authority |
| `.Codex/specs/kern-5-r0-abi/spec.md` | merge | Preserve historical R0 authority/evidence |
| `scripts/kern-5-r0-contracts/**` | merge | Existing authenticated R0 bundle |
| `scripts/kern-5-r0-contracts/*integration*.test.mjs` | add | Exact F5 plus Review convergence |
| `scripts/kern-5-r0-contracts/manifest.json` | rebind | Authenticate new integration evidence |
| `package.json` | merge/update | Focused R0 command and required package builds |

Production CLI target routing, package exports, terminal fitness rows, release
workflows, versions, tags, and publication configuration remain untouched.

## Binary Acceptance Criteria

- [x] Historical commits `d4f401c1..b7fb9492` remain reachable with their
      original object IDs after integration.
- [x] The current-main RED reproduction fails at the absent `oracle.mjs` seam
      for the right reason and its setup smoke parses all nine cases.
- [x] The merged manifest authenticates every schema, authority, fixture,
      generated artifact, validator, and test with no extra or missing file.
- [x] Two clean generations reproduce exact target and manifest digests.
- [x] The convergence fixture is projected by packaged F1-F5 and verified by
      `verifyKernProjection`.
- [x] The KIR v1 semantic component passed to the compiler is byte-identical to
      the verified F5 projection bytes.
- [x] Compiler input has no source, AST, legacy IR, topology, arguments,
      transcript, control, or expected-output field.
- [x] Generated JavaScript and Python artifacts execute in separate real
      processes and emit byte-identical canonical envelopes.
- [x] The representative envelope contains the exact capability event,
      structured stdout log, normal return, record/list JSON text, and request
      identity expected by the fixture.
- [x] Capability error, cancellation, timeout ties, and concurrent request
      isolation remain identical across targets.
- [x] Tampered KIR/evidence/artifact/manifest digests and unsupported semantic
      operations fail closed.
- [x] Static closure checks continue to reject parser, source handler, legacy
      runner, dynamic loaders, network, filesystem writes, and target-specific
      KIR variants from target artifacts.
- [x] KIR-backed Review returns `status=complete`, zero diagnostics,
      `equalSemantics=false`, and exactly one matching finding with facet
      `capabilities`, change `capability-changed`, before
      `r0fixture/resolve`, and after `r0fixture/resolveNext`.
- [x] Review remains advisory and no terminal KERN 5 gate is promoted.
- [ ] Focused gates and current risk-routed independent review pass on the
      final candidate.
- [x] All handwritten source files remain under 500 lines.
- [ ] All new commits carry the required Agon author and footer.
- [ ] The feature branch is pushed once and remote SHA equals local HEAD.

## Mutation Controls

The final tests must kill or explicitly report survivors for mutations that:

1. replace F5 semantic bytes with parser-generated or stale fixture bytes;
2. pass source/AST/legacy IR to the compiler;
3. hardcode expected envelopes or ignore KIR topology;
4. drop/reorder capability or stdout events;
5. accept stale KIR, evidence, artifact, or manifest digests;
6. return success or partial events after cancellation/timeout;
7. share transcript/request state across concurrent runs;
8. change Review operation semantics without the exact advisory finding;
9. silently fall back to legacy Review or production source execution.

## RED-at-Base Evidence

**VERIFIED:** On current `origin/main` `7212b049`, applying only historical
commit `d4f401c1` yields the same stable patch ID as the original. Under Node
22.22.0, the narrow `r0-abi.test.mjs` exits 1 before running tests with
`ERR_MODULE_NOT_FOUND` for the deliberately absent `oracle.mjs`. A separate
setup smoke loads the helper and all nine topology cases. Commit `9e6e5246`
then removes topology/runtime/expected data from compiler input and binds the
generator to accepted KIR v1, closing the practical fixture-façade hole.

## Nero Challenge Delta

The initial plan was to cherry-pick the historical series and trust its prior
tests. Nero rated that plan FLAWED and identified four risks: hidden KIR drift,
stale checked artifacts, obsolete mutation coverage, and rewritten commit
provenance/intermediate states.

Live evidence changed the plan:

- relevant KIR/runtime/canonical authority files have no diff since the old
  base;
- the gate performs fresh clean generations and executes both target files;
- current integration adds F5-origin, Review, and fresh mutation evidence;
- a non-fast-forward merge preserves historical commit IDs and coherent
  intermediate parentage.

No unresolved semantic or provenance dependency remains before final review.
The revised implementation confidence is 0.93.

## Deployment, Skew, and Rollback

The cell is private and additive. Downstream RT, C-JS, and C-PY work may pin
the final bundle manifest digest after merge. Any contract correction requires
a new component version and explicit producer-first/consumer-second skew plan;
silent mutation is forbidden.

Rollback removes the private sub-gate, bundle, and integration spec. No 4.x
public API or production compiler/runtime route changes, so mixed published
installations have no runtime skew.

## Out of Scope

- General KIR lowering beyond the representative subset.
- Production CLI compiler/runtime cutover or terminal gate promotion.
- Public KIR/runtime/compiler package exports.
- npm/PyPI import contracts or publication.
- Microservices, network/filesystem providers, and deployment.
- Complete stream, class, generator, or async language semantics.
- Self-hosting, release/version/tag/publication work, or merge to `main`.
