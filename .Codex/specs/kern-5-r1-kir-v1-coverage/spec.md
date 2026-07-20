# KERN 5 R1.5a KIR v1 Eligibility Inventory

**Status:** IMPLEMENTED - LOCAL CLOSURE GREEN; CI WITNESS PENDING
**Date:** 2026-07-12
**Confidence:** 0.97
**Depends on:** R1.4b commit `edcab4a6ae8aed9cf8d045a39f1af75cfc373787`
**Tribunal:** `tribunal-1783817329505-yf7uuu` (`claude,codex,agy`, 3/3)
**Brainstorm:** `brainstorm-1783817699700-he24df` (`claude,codex,agy`, 3/3)

**Closure evidence:** the complete `pnpm fitness:kern-5` wall passed on
2026-07-12 over the exact staged state. The eligibility oracle passed 27/27
adversarial tests and reported `ALPHA-NO-GO`, 7/302 source nodes witnessed, and
16/16 runner contracts unresolved. Final three-engine Agon review
`review-1783820210303-a9a5yw-kern-5-r1-kir-v1-eligibility-sta` completed 3/3
with zero verified, needs-check, or speculative findings and one non-blocking
nit. Linux CI remains the post-push environment witness.

## Executive Summary

R1.5a adds an executable, source-bound eligibility inventory for the future KIR
v1 freeze. It does not rename the seven-node `kern.semantic-kir.probe.1`
candidate or claim Alpha. Instead, it makes every current source node type and
every native runner contract visible as either witnessed by the probe or
explicitly unresolved with stable blockers. Catalog drift, invented coverage,
silent removal, and premature freeze claims fail closed.

The only policy decisions frozen by this slice are those already supported by
the R1.3-R1.4 evidence: unknown versions and fields reject without fallback;
semantic identity excludes comments, trivia, diagnostics, and source locations;
diagnostic/location evidence is separately versioned; canonical locations use
UTF-8 byte offsets with half-open ends; and resource ceilings are named config
inputs rather than hidden implementation constants. **VERIFIED design decision**

## Current State and Root Cause

1. `NODE_TYPES` contains the complete static parser catalog, while the current
   KIR reader candidate admits only seven node kinds. **VERIFIED**
2. The native runner requires sixteen semantic contracts; the candidate does
   not provide a coverage matrix binding those contracts to KIR. **VERIFIED**
3. The current projector aborts on parser diagnostics and emits an empty
   diagnostics array on success. **VERIFIED**
4. Reader/writer operators differ, regex validation delegates to JavaScript,
   recursive values are unbounded, and the reader accepts an already-decoded
   string rather than strict UTF-8 bytes. **VERIFIED**
5. Source locations are host-shaped and currently participate in canonical
   bytes, so whitespace-length changes alter semantic identity. **VERIFIED**
6. Therefore the current candidate cannot honestly become KIR v1 or close
   Alpha. The missing prerequisite is an exact, executable inventory of what
   later slices must resolve. **VERIFIED conclusion**

## Contract

| Behavior | R1.5a contract | Tag |
|---|---|---|
| Source catalog | The inventory is bound to the `NODE_TYPES` array in `packages/core/src/spec.ts`; missing, extra, duplicate, reordered, or dynamically constructed entries reject | VERIFIED design decision |
| Runner catalog | The inventory is bound to `REQUIRED_RUNNER_CONTRACTS` in `packages/core/src/runner.ts` | VERIFIED design decision |
| Current witness | Exactly the seven probe node kinds are recorded as `candidate-witnessed`, with the current probe format and SHA-256-bound executable fixture projection | VERIFIED current evidence |
| Unresolved work | Every other source node and all sixteen runner contracts are mechanically classified `unresolved` with closed blocker IDs; projected node shapes are not runtime bindings | VERIFIED design decision |
| Identity | Semantic bytes exclude trivia, comments, diagnostics, and source locations; evidence uses a separate versioned envelope | VERIFIED tribunal decision |
| Locations | The future evidence envelope uses zero-based UTF-8 byte offsets and half-open end offsets; line/column are projections, not identity | VERIFIED tribunal decision |
| Bounds | Required byte, depth, node, module, collection, string, diagnostic, and integer-digit limit keys are policy/config inputs | VERIFIED design decision |
| Skew | Unknown versions, fields, node kinds, value tags, diagnostic IDs, and unlisted catalog entries fail closed without runtime/source fallback | VERIFIED existing policy direction |
| Claims | The gate prints `ALPHA-NO-GO` and preserves `kir-v1` and runtime ABI gates as planned | VERIFIED design decision |

## Rejected Options

### Rename the current probe format to KIR v1

Rejected because seven node kinds do not cover the language and the value,
diagnostic, location, regex, and resource contracts remain host-dependent.

### Freeze trace, handler, and capability ABIs in R1

Rejected by the tribunal. Those are executable runtime convergence contracts
owned by M3. R1.5 covers implementation-independent KIR/value/evidence wire
contracts only; M8 later changes semantic authority without redesigning them.

### Start with strict UTF-8 diagnostics without an inventory

Rejected as the first slice. It is valuable R1.5b work, but without total
catalog and blocker identity it could make one path green while leaving silent
coverage holes and no defensible Alpha denominator.

### Treat every unsupported node as excluded from KERN 5

Rejected. That would turn implementation absence into a language decision.
Unsupported nodes remain `unresolved` until a later slice explicitly includes,
lowers, or excludes them with a compatibility consequence.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `scripts/kir-v1/eligibility.json` | add | Versioned inventory, blockers, decisions, bounds, and non-claims |
| `scripts/kir-v1/validate-eligibility.mjs` | add | Pure source-bound validator |
| `scripts/kir-v1/validate-eligibility.test.mjs` | add | Adversarial catalog, claim, policy, and witness mutations |
| `scripts/kir-v1/verify-fixture-witness.mjs` | add | Execute the declared hostile fixture through the selected projector |
| `scripts/check-kir-v1-eligibility.mjs` | add | Repository gate with visible `ALPHA-NO-GO` output |
| `package.json` | modify | Add `test:kern-ir-eligibility` only; keep `test:kern-ir` absent |
| `scripts/kern-5-fitness-policy.json` | modify | Add a current eligibility gate and ownership oracle |
| `scripts/kern-5-fitness.test.mjs` | modify | Lock the aggregate order and status |
| `docs/kern-5-support-matrix.md` | modify | Mirror the machine-readable gate and correct ABI phase wording |
| `docs/kern-5-release-train.md` | modify | Split R1.5a-d and preserve Alpha no-go |

No runtime, parser, reader candidate, package export, or default execution path
changes. Handwritten source files remain below 500 lines.

## Acceptance Criteria

- [x] Base R1.4b is RED because `test:kern-ir-eligibility` is absent.
- [x] The repository inventory exactly equals the static source and runner
      catalogs, with no missing, extra, duplicate, or reordered entries.
- [x] The seven candidate-witnessed kinds exactly equal the candidate type
      union and name the live probe format and fixture.
- [x] Every unwitnessed entry has a stable blocker ID; no default disposition
      or wildcard can silently absorb a new language feature.
- [x] Mutations deleting/adding/reordering a node, inventing a witness, removing
      a blocker, weakening fail-closed policy, admitting trivia/evidence into
      semantic identity, removing a limit key, or claiming Alpha fail.
- [x] The gate prints `ALPHA-NO-GO`, the candidate remains internal and
      unexported, and `test:kern-ir` remains absent/planned.
- [x] Existing KIR probe, reader, ownership, and full KERN 5 fitness gates pass.
- [x] Agon review runs with exactly `claude,codex,agy`; verified blockers are
      fixed and the complete wall is rerun before commit/push.

## Subsequent Serial Slices

1. **R1.5b:** bounded strict UTF-8 canonical/value reader, closed scalar and
   collection wire shapes, portable operator/regex grammar, hostile fixtures.
2. **R1.5c:** coverage-closed module/node writer-reader parity; replace every
   unresolved source/runner row with `included`, `lowered`, or justified
   `excluded`, each carrying executable fixtures.
3. **R1.5d:** separately versioned diagnostic/location evidence contract,
   non-empty stable diagnostics, expression spans, manifest generator, clean-SHA
   Alpha acceptance artifact.
4. **R2/M3:** versioned typed handler, public event/outcome, capability
   request/result/error, and one scheduler implementation. These are explicitly
   not part of R1.5.

## Out of Scope / Explicit Non-Claims

- KIR v1, value ABI, diagnostic ABI, or Alpha freeze.
- Runtime trace, handler, capability, scheduler, or completion ABI.
- KERN-authored frontend/interpreter implementation or semantic cutover.
- Public exports, package version, public tag, or compatibility promise.
- Fixed-point self-hosting.

## Deploy and Rollback

R1.5a ships only an internal release oracle and documentation. Rollback removes
the eligibility gate and reopens the source inventory; KERN 4.5 execution and
the internal probe/reader candidate remain unchanged.
