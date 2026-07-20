# KERN 5 R1.5e.1 — Runtime-Handler Type KIR Bridge

**Status:** COMPLETE — FULL FITNESS AND TERMINAL REVIEW PASS
**Date:** 2026-07-17
**Confidence:** 0.99
**Parent objective:** close the exact KIR blocker before M4 canonicalizer/frontend work

## Executive Summary

M3.31c empties the source-runner convergence ledger, but M4 still cannot start
against a truthful typed KIR contract. The live structural codec deliberately
publishes an empty type catalog and rejects every `typeAnnotation`, including
the `string`, `number`, `boolean`, `void`, and one-dimensional list annotations
already admitted by `kern.runtime.handler.v1`. A direct probe of a typed `fn`
fails at `fn.returns` with `excluded-host-type` before an artifact exists.
**VERIFIED:** `packages/core/src/kir-structural/types.ts:3-12,61-69`,
`packages/core/src/kir-structural/node.ts:144-154`, and the 2026-07-17 probe
`encodeModuleKir([{ fn returns=string }]) -> StructuralKirError at
$.root.props.returns`.

R1.5e.1 introduces one shared, host-independent type owner for the exact public
runtime-handler domain, lowers those annotations into canonical structural KIR,
and bumps every affected internal wire identifier. It does not serialize raw
type text, admit arbitrary TypeScript-shaped types, freeze public KIR v1, or
start the formatter. Its purpose is to make the already-shipped typed handler
language representable before M4 consumes the seam.

## Current State / Root Cause

- **VERIFIED:** the structural artifact advertises
  `kern.type-admission.r1.5c.2-empty`, requires `admittedKinds: []`, and contains
  no `lowered-type` disposition. Evidence:
  `packages/core/src/kir-structural/types.ts:3-12,61-69` and
  `packages/core/src/kir-structural/canonical.ts:29-48,74-91`.
- **VERIFIED:** all `typeAnnotation` values currently hit the generic
  `excluded-*` failure before encoding. The reader likewise has no type-value
  validator. Evidence: `packages/core/src/kir-structural/node.ts:144-154,275-294`.
- **VERIFIED:** the public runtime handler already admits exactly scalar
  `string | number | boolean`, one-dimensional arrays of those scalars, and
  return-only `void`. Evidence:
  `packages/core/src/runtime-handler-contract.ts:14-35`.
- **VERIFIED:** that type logic is private duplication inside the handler
  contract, so KIR cannot reuse it without extracting a neutral owner.
  Evidence: `packages/core/src/runtime-handler-contract.ts:19-27`.
- **VERIFIED:** the source constitution contains 95 `typeAnnotation` property
  contracts, all currently `excluded-host-type`; only three are schema-required.
  Evidence: command
  `node -e "...constitution.properties.filter(schemaKind === typeAnnotation)..."`
  on 2026-07-17 reported `count 95 required 3 optional 92`.
- **VERIFIED:** 150 committed `.kern` files parse without parser errors and
  contain 577 type-annotation occurrences across 109 distinct spellings. The
  exact runtime-handler subset is common, but the corpus also contains unions,
  records, generics, tuples, function types, indexed access, type predicates,
  and host-oriented types. Evidence: the source-bound parser census run on
  2026-07-17.
- **VERIFIED:** the release fitness policy still calls versioned KIR v1
  `not-shipped`, while the runtime handler ABI is already an `internal-oracle`.
  Evidence: `scripts/kern-5-fitness-policy.json:407-416` and the
  `versioned-kir-v1` row immediately above it.
- **VERIFIED:** M3.31c marks the convergence manifest at
  `KERN-5-R2-M3.31c`, promotes `runner-classes-state`, and leaves no deferred
  rows. This closes runtime compatibility migration, not KIR type identity.
  Evidence: `scripts/source-runner-convergence-manifest.json` and
  `docs/kern-5-release-train.md:780-803`.

## What Already Works

- R1.5b canonical values already provide strict UTF-8 bytes, bounded recursive
  values, canonical record ordering, and unknown-field rejection. Reuse this
  encoding unchanged.
- R1.5c.2 structural nodes already sort properties, preserve child order, and
  validate expression/import-path payloads. Add a type branch; do not build a
  second codec.
- R1.5c.3 module artifacts already revalidate every embedded root and recompute
  graph metadata. Retain that mechanism and change the format identity because
  the admitted payload domain changes.
- M3.17 already owns public handler argument/result validation. Extract its
  type parser; do not invent a wider KIR type domain than the executable ABI.
- R1.5c.4 already binds all 95 type rows to executable rejection witnesses.
  Promote only the exact structured handler rows and retain explicit rejection
  witnesses for the other type locations; do not discard the coverage ledger.

## Contract (Verified and Proposed)

> Verified against the current branch on 2026-07-17. `PROPOSED` rows become
> build oracles only after the required full-roster brainstorm resolves them.

| Field / Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Runtime scalar syntax | exact trimmed `string`, `number`, `boolean` | `runtime-handler-contract.ts:19-26` | VERIFIED |
| Runtime list syntax | exactly one `[]` suffix over a runtime scalar | `runtime-handler-contract.ts:23-26` | VERIFIED |
| Runtime void syntax | exact `void`, admitted only for handler returns by the runtime consumer | `runtime-handler-contract.ts:19-26` | VERIFIED |
| Neutral semantic kinds | `text`, `integer`, `boolean`, `list`, `void` | matches `KernRuntimeHandlerAdmittedType` | PROPOSED |
| Type KIR scalar | canonical record `{ kind }` | R1.5b record encoding | VERIFIED design, brainstorm `brainstorm-1784280922754-r1rhbq` |
| Type KIR list | canonical record `{ element, kind: "list" }`, where `element` is one scalar kind | runtime domain is one-dimensional | VERIFIED design, brainstorm |
| Shared parser | neutral registry-independent owner; retain `KernRuntimeHandlerAdmittedType` as compatibility alias | removes current duplicated authority | VERIFIED design, brainstorm |
| Structural version | new internal format; old c.2 bytes reject as unsupported | semantic payload domain changes | VERIFIED design, brainstorm |
| Module version | new internal format without a duplicate type catalog; roots receive exact structural validation | embedded root domain changes | VERIFIED design, brainstorm |
| Type catalog | structural envelope only, with exact ordered kinds and a new non-empty catalog format | module duplication adds no proof | VERIFIED design, brainstorm |
| Unsupported type syntax | stable `invalid-type` error/path before artifact return | no raw host type transport | VERIFIED design, brainstorm |
| Public KIR v1 | remains false and unexported | fitness policy currently says not shipped | VERIFIED guard |

## Selected Design

### 1. One neutral portable handler-type owner

Extract the annotation parser from `runtime-handler-contract.ts` into a focused
browser-safe module with no parser, TypeScript compiler, KIR, runner, registry,
or Node dependency. It returns the existing semantic shape:

```text
boolean | integer | text | void | list<boolean|integer|text>
```

The parser accepts surrounding whitespace exactly as the current runtime
handler does. It rejects empty annotations, case changes, aliases, nested
lists, `void[]`, unions, records, generics, optional markers, defaults, and all
other syntax. The neutral owner takes an explicit `parameter | return`
position: `void` is admitted only for returns and scalar/list types are admitted
for both. KIR and runtime admission call that same contextual owner.

### 2. Canonical type value inside structural properties

Add `lowered-type` to the structural disposition vocabulary only for the exact
runtime-handler contexts: `fn.returns` and `param.type` where that `param` is a
direct child of the same `fn`. Projection maps those annotations to canonical
records; validation accepts only those exact canonical shapes, positions, and
catalog kinds. All other `typeAnnotation` locations retain
`excluded-host-type`.

A typed KIR handler must use structured `param` children. A non-empty legacy
`fn params="name:type"` remains a raw string and therefore rejects from this
profile instead of leaking type syntax into KIR. Untyped empty `params` may be
omitted/canonicalized by existing parser behavior. Parent context must be
verified during both projection and decode so a detached or reparented `param`
cannot smuggle a lowered type into a non-handler node.

### 3. Honest wire versioning

Change the structural artifact and type-catalog formats because previously
invalid inputs now encode. Change the module artifact format because its
embedded root payload domain changes. The type catalog stays in the structural
envelope; module decoding obtains its proof by exact root validation and does
not embed a second catalog. Old bytes must fail at the format field; they are
not silently reinterpreted. Constitution, coverage-ledger, eligibility, and
receipt hashes update through their existing source-bound checks.

The proof label remains `ALPHA-NO-GO`, `versioned-kir-v1` remains
`not-shipped`, and no package export is added.

### 4. Coverage migration without self-proof

Regenerate the source-bound constitution after changing the explicit
disposition policy. Migrate only `fn.returns` and context-qualified
`param.type` evidence to `lowered-type`; keep the other 93 schema-location rows
explicitly excluded. Add independent hostile fixtures for every rejected
grammar family, legacy raw `fn.params`, wrong-parent parameters, and canonical-
payload tampering. The checked-in ledger remains independent evidence; the
runtime implementation may not generate expected canonical values for its own
assertions.

### 5. Exact M4 handoff

After this slice, M4.1 may build a KERN-authored canonicalizer over typed handler
KIR. M4 still cannot claim the whole committed source corpus: arbitrary types,
opaque host expressions/blocks, full frontend ownership, comments, and trivia
remain explicit later work. The release train records that corrected boundary.

## Alternatives Considered

### A. Admit the exact runtime-handler type domain (selected)

Confidence 0.91 after full-roster brainstorm. It closes a real cross-contract
gap, has an executable consumer, and keeps the wire independent of TypeScript.

### B. Implement all 109 observed type spellings now

Confidence 0.61. Rejected for this slice. The corpus requires unions, records,
intersections, tuples, generics, function types, indexed access, predicates,
assertions, and host utility types. Freezing them before the KERN frontend and
compiler define semantic ownership would canonize TypeScript syntax by census.

### C. Store canonicalized raw type text

Confidence 0.18. Rejected. Whitespace normalization does not define type
semantics, and downstream KERN code would still need a host parser.

### D. Start M4 against the empty type catalog

Confidence 0.10. Rejected by the live RED probe: a typed handler cannot enter
the module artifact at all.

## Blast Radius

| File / Area | Action | Reason |
|---|---|---|
| neutral portable handler-type module | add | single registry-independent type owner |
| `runtime-handler-contract.ts` | modify | consume the shared type owner without ABI widening |
| `kir-structural/types.ts` and focused type module | modify/add | non-empty catalog, exact KIR type shape, stable errors |
| structural node/canonical codecs | modify | project/validate lowered type values and bumped formats |
| module KIR types/canonical codec | modify | reject old embedded-root wire identity |
| constitution generator/catalog | modify/regenerate | source-bind only exact handler type contexts to `lowered-type` |
| coverage ledger/validator/tests | modify | positive handler-context and retained exclusion evidence |
| runtime-handler and KIR focused tests | modify | parity, mutation, version, and fail-closed oracles |
| fitness policy/release train/spec | modify | truthful internal status and exact next boundary |

No handwritten source file may exceed 500 lines. Generated catalogs, ledgers,
and lockfiles remain exempt.

## Acceptance Criteria

- [x] A RED-at-base test proves `fn returns=string` and a structured
      `param type="string[]"` cannot currently enter structural/module KIR for
      the intended empty-catalog reason.
- [x] One neutral parser owns the exact handler type domain; runtime-handler
      signature admission has byte-for-byte unchanged accept/reject behavior.
- [x] Structural KIR round-trips structured handler `string`, `number`,
      `boolean`, `void`,
      `string[]`, `number[]`, and `boolean[]` as exact semantic canonical values,
      never annotation text.
- [x] Non-empty legacy `fn.params`, typed `param` outside a direct `fn`, and
      every non-handler type-annotation property remain fail-closed before
      artifact return.
- [x] Unknown names, case variants, `void[]`, nested arrays, unions, records,
      tuples, generics, optionals/defaults, function types, indexed access, and
      predicates reject with stable code and property path before artifact
      return.
- [x] Reader mutation tests reject wrong record keys/order, wrong scalar/list
      kinds, list-of-void, unknown catalog kinds, missing/extra catalog fields,
      and old structural/module format identities.
- [x] The complete 95-row type-annotation constitution and coverage ledger stay
      source-bound: exact handler rows have positive populated fixtures, all
      other rows retain explicit rejection, and omitted-state behavior plus
      hostile-type witnesses remain independent.
- [x] Runtime-handler public ABI tests, structural codec tests, module graph
      tests, coverage closure, eligibility, Alpha receipt, and source-runner
      convergence all pass together.
- [x] `versioned-kir-v1`, public KIR export, Alpha acceptance, formatter,
      frontend, compiler, interpreter, and semantic cutover remain unclaimed.
- [x] Focused gates, `pnpm lint`, `pnpm check:kern-5-contract`, full
      `pnpm fitness:kern-5`, `git diff --check`, and terminal
      `agon review -e claude,codex,agy` pass with every verified blocker fixed.

## RED Oracle Matrix

1. Typed `fn` with structured scalar/list params and scalar/list/void returns:
   current branch rejects; implementation round-trips semantic type records.
2. Same source through runtime-handler signature admission and KIR projection:
   accepted spellings map to identical semantic kinds.
3. `Custom`, `String`, `string[][]`, `void[]`, `string | null`,
   `Record<string, unknown>`, `(x:string)=>void`, and `value is string` all
   reject in KIR; runtime handler remains equally conservative.
4. Tamper an encoded scalar to `{kind:"number"}` rather than `integer`, reorder
   list fields, add a field, or use list element `void`: decode rejects.
5. Replace the new structural/module/type-catalog version with each predecessor:
   decode rejects as unsupported before returning an artifact.
6. Take an old module/root containing raw type text, change only its outer
   format to the new identifier, and prove exact root validation still rejects.
7. Use `fn params="value:string"`, reparent a typed `param` below a non-`fn`, or
   place a valid `string` annotation on `field.type`; all remain rejected.
8. Remove the shared parser call from either consumer or restore a private
   annotation regex: convergence/mutation evidence fails.
9. Alter a type coverage row to raw text, auto-derived expected output, or an
   omitted witness: the coverage gate fails.

## Out of Scope

- General named types, unions, intersections, records, tuples, generics,
  functions, indexed access, predicates, assertions, or host utility types.
- Normalizing legacy `params="name:type"` into structured parameter children;
  this slice rejects it from typed KIR instead.
- Opaque host expressions/blocks or changes to their explicit rejection.
- Public KIR v1 export/freeze, reader compatibility promise, or package API.
- KERN canonicalizer/parser/compiler/interpreter implementation.
- Comment/trivia preservation or user-facing `kern format` behavior.
- Runtime-handler ABI widening, capability ABI changes, or semantic cutover.

## Open Questions

None. Full-roster brainstorm `brainstorm-1784280922754-r1rhbq` resolved both
pre-build questions: the module envelope does not duplicate the structural type
catalog, and the semantic owner is neutral while
`KernRuntimeHandlerAdmittedType` remains a compatibility alias.

## Deploy Order

Build and gate the complete slice on the current stacked branch because fresh
`origin/main` still ends at `377a12ef` and does not contain the pushed M3.31c
commit `579fec98`. Immediately before publication, run `git fetch origin` and
rebase first. If `579fec98` has landed by then, create a fresh
`feat/kern-5-r1-5e1-handler-type-kir` from `origin/main` and transplant only
this slice. Otherwise stack and push once on the existing branch. Never push an
old merged branch.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| M3.31c completion means M4.1 is immediately buildable. | Runtime convergence is complete, but typed handlers still cannot enter the empty-catalog KIR. | Insert R1.5e.1 before M4. |
| The next slice should be the KERN canonicalizer. | A live `returns=string` module-KIR probe fails before artifact creation. | Do not canonize an Alpha-only incomplete seam. |
| The whole source type corpus should be frozen now. | 109 observed spellings include host-specific and unresolved semantic families. | Admit only the executable runtime-handler domain first. |
| All 95 `typeAnnotation` schema locations should share the new grammar. | That would admit valid-looking types outside the executable handler contract and erase explicit exclusions. | Lower only direct structured `fn` params and `fn.returns`; retain the other exclusions. |
| The module artifact should repeat the type catalog. | Its roots are already revalidated and the module format is versioned. | Keep the catalog structural-only and add a stale-root-with-new-envelope kill test. |
