# KERN 5 R2 M4.135 — Bounded New-Expression Contract

**Status:** VERIFIED — READY TO PUBLISH
**Date:** 2026-07-29
**Confidence:** 0.98

## Executive Summary

[VERIFIED] M4.134 is published on `main` at
`26cd72448409d5ce7dd78a5c83b1a07989e77175`. Its immutable remediation
receipt selects bounded constructor support for exactly two functions and 21
legacy parameter rows: four zero-argument `Map` constructions in
`expressionsources` and seventeen one-argument `Error` constructions in
`canonicalize`.

[VERIFIED] Runtime semantics for those exact forms already exist:
`new Map()` is the only admitted Map constructor, and explicit errors require
`new Error(<one expression>)` whose evaluated value is a string.

[DECIDED] M4.135 adds one dedicated structural expression kind named `new`
with exact canonical fields `{ args, constructor }`. `constructor` is exactly
`Map` or `Error`; `Map` requires zero args and `Error` requires one recursively
valid structural expression. This preserves construction intent without
admitting arbitrary class construction.

[DECIDED] Structural projection, structural validation, KERN-authored
canonical-source emission, coverage-family registration, golden/hostile
fixtures, and release-wall assertions ship atomically. M4.135 does not promote
the family into the cumulative base and does not migrate either function
signature. The resulting exact selection is the M4.136 handoff.

## Current State / Root Cause

- [VERIFIED] `ValueIR` represents construction distinctly as
  `{ kind: 'new', argument }`, while a constructor invocation inside it is a
  `call` node (`packages/core/src/value-ir.ts`).
- [VERIFIED] Structural KIR currently admits fifteen expression kinds and
  rejects every `new` node with `unknown-expression-kind`
  (`packages/core/src/kir-structural/expression.ts`).
- [VERIFIED] The current KERN canonical-source emitter owns explicit cases for
  null, identifier, scalar, binary, unary, member, index, call, and list, but
  has no construction case
  (`examples/kern-canonicalizer/canonicalizer.kern`, `expressionsources`).
- [VERIFIED] Coverage can only measure unsupported expression families that
  exist in both the structural expression catalog and the frozen family
  registry. Construction currently exists in neither
  (`scripts/kern-canonicalizer/coverage-families.mjs`,
  `coverage-family-registry.json`).
- [VERIFIED] M4.134 measured exactly four `new Map()` and seventeen
  `new Error("KERN_CANONICALIZER_PROFILE")` occurrences, covering
  `expressionsources` (6 rows) and `canonicalize` (15 rows).

## Contract

| Behavior | Canonical representation | Tag |
|---|---|---|
| Empty Map construction | `kind="new"`, `fields={args: [], constructor: "Map"}` | DECIDED |
| Explicit Error construction | `kind="new"`, `fields={args: [expression], constructor: "Error"}` | DECIDED |
| Canonical field order | `args`, then `constructor` | DECIDED |
| Projection input | non-optional, untyped call of a bare identifier inside `new` | DECIDED |
| Map arity | exactly zero | VERIFIED |
| Error arity | exactly one | VERIFIED |
| Error argument | recursively valid structural expression; runtime still requires a string value | DECIDED |
| Unsupported constructor | `invalid-expression` | DECIDED |
| Unsupported arity or optional/typed form | `invalid-expression` | DECIDED |
| Reader mutation | reject before decoded structural KIR escapes | DECIDED |
| KERN emission | exactly `new Map()` or `new Error(<canonical arg>)` | DECIDED |
| Coverage family | `new-expression`, expression kind `new` | DECIDED |
| Base profile | remains `kern.kir-canonicalizer.profile.m4.60` at 104/112 | DECIDED |

## Alternatives

### A — Dedicated bounded `new` kind (selected)

Keep construction distinct from ordinary calls and store only the constructor
name plus arguments. Both structural validation and the KERN emitter can
enforce the exact constructor/arity matrix independently.

### B — Reuse `call` with an extra flag (rejected)

This changes the existing call shape and makes call consumers understand a
construction-only flag. It also weakens the distinction between invocation
and allocation.

### C — Generic `new { argument: expression }` (rejected)

This mirrors `ValueIR`, but recursively validating the nested call would admit
arbitrary constructors unless every consumer repeats additional semantic
inspection. The admitted contract is intentionally smaller.

### D — Preserve raw source text (rejected)

Raw source would bypass structural canonicalization and reintroduce a host
payload into the KIR seam.

## Atomic Deploy Order

1. Add RED structural writer/reader tests and KERN golden/hostile fixtures.
2. Add the structural `new` producer and exact reader validator.
3. Add independent KERN source emission for the exact constructor/arity
   matrix.
4. Register `new-expression` in the closed catalog and active candidate
   families so coverage can rank it.
5. Regenerate composition metadata and current coverage summaries.
6. Add M4.135 central/status assertions that bind the M4.134 input, the exact
   live 2-family `canonicalize` closure (1 function/15 parameter rows),
   preserved base, projection-limited `expressionsources`, and pending
   `quotesource`.
7. Run focused gates, complete canonicalizer, full KERN 5 fitness wall,
   independent high-risk review, rebase, and publish.

## Blast Radius

| File/group | Action | Reason |
|---|---|---|
| `.Codex/specs/.../spec.md` | add | Claim/evidence boundary |
| `packages/core/src/kir-structural/expression.ts` | modify | Producer and reader contract |
| `packages/core/tests/kir-structural.test.ts` | modify | Exact writer/reader and fail-closed mutations |
| `canonicalizer.kern` + composed artifact/metadata | modify/regenerate | KERN-owned source emission |
| `new-expression-fixtures.mjs` + fixture registry | add/modify | Golden and hostile flat-table oracles |
| coverage family registry/policy | modify | Closed candidate-family ownership |
| coverage policy corpus digest | update | Authenticate changed handwritten canonicalizer |
| current coverage summaries | regenerate | Bind current implementation and selection |
| M4.135 central/status checks + wall wiring | add/modify | Release-blocking handoff |

## Acceptance Criteria

- [x] RED proved both exact constructor forms were absent from structural KIR
      and the KERN canonicalizer.
- [x] `new Map()` projects, validates, encodes, decodes, and re-encodes
      canonically.
- [x] `new Error("x")` and `new Error(message)` preserve one recursively valid
      argument and canonicalize source exactly.
- [x] Generic class constructors, member/index constructors, typed/optional
      calls, `Map` arguments, and wrong `Error` arities fail closed.
- [x] Reader mutations of kind, fields, constructor, args tag, arity, and
      nested argument fail before return.
- [x] KERN hostile flat-table mutations reject missing/extra/duplicate fields,
      wrong tags, constructors, arities, and missing argument source.
- [x] Existing call semantics and every pre-M4.135 golden byte remain
      unchanged.
- [x] Coverage remains 104/112 base-complete. The ordinary family ranking
      selects `new-expression` at 41 structural occurrences; the prerequisite
      ranking selects it inside the exact 2-family `canonicalize` closure
      (1 function/15 parameter rows). `expressionsources` remains independently
      blocked by `projection.limit-nodes`.
- [x] The six `quotesource` canonical-surface blockers remain pending.
- [x] No runtime, runtime ABI, profile-limit, parameter-signature, or KIR
      release-status change occurs.
- [x] Focused tests and the complete 619-test canonicalizer gate pass.
- [x] Full KERN 5 fitness wall passes.
- [x] Independent high-risk role review has no unresolved material finding
      (Agon full usable roster: 6/6 succeeded).
- [ ] Signed commit is fetched/rebased before one push and remote main verifies.

## Verification Evidence

- [VERIFIED] `pnpm fitness:kern-5` exited 0, including two complete
  619/619 canonicalizer runs, 56 golden/idempotence/KIR fixtures, 8 measured
  witnesses, 3 profile-limit fixtures, and 243 hostile fixtures.
- [VERIFIED] Cross-target conformance passed 434/434 fixtures plus 109/109
  class fixtures; native KERN passed 233/233 with 100% declared coverage.
- [VERIFIED] Agon high-risk review completed with the full six-engine usable
  roster and no unresolved material finding.
- [VERIFIED] The checked-in canonicalizer is 63,461 bytes with digest
  `e6b33ada0310452eb01f33426ef5a7d807b83b3de1637e01befdb541fcaa8e75`.
- [VERIFIED] The coverage policy digest is
  `f1a2a34ca9625a8753a3472e03af6acd6551a3d90ae1a81b1260685a28857cad`;
  compiled-core digest is
  `2641bba874fe19a079f4b03dabbddfee0d0cc56124d86f4080b612652a52eabc`;
  function-facts digest is
  `1de3ad0e16d981ce7233d0d3d7964ef6991e98b180435df625831e288904fb08`.

## Out of Scope

- Generic user-class construction in structural KIR.
- `new Map(entries)`, `new Error()` or multi-argument Error construction.
- Promotion of `new-expression` into the cumulative base.
- Migration of `expressionsources` or `canonicalize` parameters.
- `quotesource` code-point remediation.
- KIR v1 freeze, runtime cutover, RC/stable release, Fable, or KERN 5
  completion.

## Open Questions

None. The current code and M4.134 receipt determine the bounded constructor
set, arities, representation, and atomic consumer list.
