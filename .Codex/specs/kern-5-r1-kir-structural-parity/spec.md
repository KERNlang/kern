# KERN 5 R1.5c Structural KIR Writer-Reader Parity

**Status:** APPROVED FOR IMPLEMENTATION
**Date:** 2026-07-12
**Confidence:** 0.96
**Depends on:** R1.5b commit `6cb544e359e852d860df98fc657f6efa1967dc78`
**Tribunal:** `tribunal-1783835067558-kx1n7x-kern-5-r1-5c-parity`
(`claude,codex,agy`, 3/3)

## Executive Summary

R1.5c introduces the internal-only structural format
`kern.kir.structural.alpha.1`. It closes writer-reader parity over the complete
302-kind source catalog without renaming the seven-node semantic probe, binding
the runtime, or claiming KIR v1. Every source node and property contract must
be included, deterministically lowered, or explicitly rejected with executable
evidence. Raw host expressions and blocks never cross the format as opaque
strings. **VERIFIED tribunal decision**

R1.5c is implemented as four serial, releasable sub-slices. Each sub-slice has
its own gate, full KERN 5 wall, three-engine review, commit, and push. R1.5c is
not complete until all four are green. **VERIFIED delivery decision**

## Current State and Root Cause

1. The live `NODE_TYPES` catalog contains 302 source kinds; the semantic probe
   witnesses seven, leaving 295 source rows unresolved. **VERIFIED**
2. All 16 runner contracts remain unresolved, but they describe M3 execution
   ABIs rather than R1.5c source serialization. **VERIFIED prior tribunal
   decision**
3. `NODE_SCHEMAS` is not catalog-total: `alternate-screen` and `scroll-box`
   have no schema. It also contains seven names outside `NODE_TYPES`: `trim`,
   `split`, `replaceFirst`, `replaceAll`, `case`, `fixture`, and `mock`.
   **VERIFIED audit**
4. The 300 catalog-backed schemas contain 1,149 property contracts: 343
   identifiers, 261 strings, 188 raw expressions, 150 booleans, 95 type
   annotations, 72 numbers, 29 parsed expressions, six raw blocks, and five
   import paths. **VERIFIED audit**
5. The current projector accepts only `fn`, `param`, `handler`, `return`, `let`,
   `capability`, and `print`; imports/exports are fixed to `kind: 'fn'`, integer
   admission is host-safe-number bounded, regex admission calls host `RegExp`,
   and source locations participate in bytes. **VERIFIED**
6. Therefore expanding the old probe or bulk-marking 295 kinds excluded would
   produce false closure. The structural contract needs its own format,
   property-level disposition matrix, and generated fixture census.
   **VERIFIED conclusion**

## Contract Boundary

| Area | R1.5c contract | Claim |
|---|---|---|
| Format | Exact `kern.kir.structural.alpha.1`; internal, non-exported, non-runtime | VERIFIED tribunal decision |
| Envelope | Canonical value envelope containing exact `format` and ordered `modules`; evidence/locations absent | VERIFIED design decision |
| Catalog | Exact ordered equality with all 302 live `NODE_TYPES`; no wildcard/default row | VERIFIED design decision |
| Node | Exact `kind`, code-point-sorted property entries, and ordered children | VERIFIED design decision |
| Properties | Each of 1,149 live schema properties has a frozen disposition and reason | VERIFIED audit requirement |
| Direct values | Identifier, string, boolean, number, and import-path contracts normalize into R1.5b portable values | VERIFIED design decision |
| Expressions | Parsed `expression` and eligible `rawExpr` values lower into a separately enumerated portable expression tree; opaque source text never crosses | VERIFIED tribunal decision |
| Host syntax | Non-portable `rawExpr`, all `rawBlock`, and unlowered host type syntax reject before an artifact is returned | VERIFIED tribunal decision |
| Types | Portable types require an enumerated KERN type grammar; host-specific type annotations reject rather than pass through | VERIFIED design decision |
| Regex | No host `RegExp` validation; either an enumerated portable grammar is frozen or regex expressions reject | VERIFIED tribunal decision |
| Modules | Normalized relative module IDs; deterministic import/export order; bindings carry the declared included symbol kind, not only `fn` | VERIFIED tribunal decision |
| Bounds | Caller supplies all byte/depth/node/module/collection/string/integer limits; writer output must decode under the same limits | VERIFIED R1.5b inheritance |
| Runtime | No trace, handler, scheduler, capability, completion, or runner-consumption ABI | VERIFIED M3 deferral |
| Claims | `ALPHA-NO-GO`; no `test:kern-ir`, public export, semantic cutover, or KIR v1 freeze | VERIFIED release constraint |

## Property Dispositions

The property constitution is source-bound to `NODE_SCHEMAS`. Every row is
identified by `(nodeKind, propertyName)` and records schema kind, requiredness,
and exactly one disposition:

- `included-value`: already-portable identifier/string/boolean/number value;
- `lowered-import-path`: normalized portable relative module path;
- `lowered-expression`: parsed and admitted portable expression tree;
- `lowered-type`: parsed and admitted portable KERN type tree;
- `excluded-host-expression`: raw expression outside the portable expression
  grammar;
- `excluded-host-type`: host type syntax outside the portable type grammar;
- `excluded-raw-block`: opaque host block, always forbidden.

An included node kind may still reject a particular source program when one of
its supplied properties has an excluded disposition. The rejection is a
language-profile boundary, never silent omission or opaque transport.
**VERIFIED tribunal interpretation**

## Serial Sub-slices

### R1.5c.1 — Schema and property constitution

- Make `NODE_SCHEMAS` exactly cover all 302 `NODE_TYPES` or explicitly bind
  schema aliases outside the catalog without counting them as source kinds.
- Add a generated, source-bound 302-node/1,149-property disposition census.
- Reject missing, extra, duplicate, reordered, wildcard, or stale rows.
- Keep every existing runtime and KIR candidate path unchanged.

**Exit:** `test:kern-kir-structural-constitution` reports exact node/property
counts and `ALPHA-NO-GO`.

### R1.5c.2 — Structural writer and bounded reader

- Add browser-safe internal writer/reader modules consuming the R1.5b value
  contract.
- Prove exact fields, canonical ordering, same-limit round trip, unknown-field
  rejection, and no raw host payload leakage.
- Add expression/type sub-catalogs; unsupported syntax rejects with stable
  codes and paths.

**Exit:** all admitted node/property fixtures round-trip byte-identically and
all exclusion fixtures reject before artifact return.

#### R1.5c.2 decided contract

- The internal artifact format is `kern.kir.structural.r1.5c.2-alpha`. Its
  canonical root record binds exactly `constitution`, `format`, `proofLabel`,
  one `root` node, and `typeCatalog`. The type catalog binds exactly its format
  and an empty `admittedKinds` list. A node contains only `children`, string
  `kind`, and a sorted property record. Children retain source order.
  **DECIDED**
- The writer returns R1.5b canonical-value bytes and the reader accepts only
  those bytes under the identical caller-supplied `CanonicalValueLimits`.
  Unknown fields, unsorted/duplicate keys, noncanonical bytes, and limit
  failures reject before an artifact is returned. **DECIDED**
- The expression catalog is closed over portable literal, identifier, list,
  record, member, index, call, expression-lambda, binary, unary, and
  conditional forms. Regex, template, undefined, spread, await, new, type
  assertion, non-null, propagation, typed lambda, and raw closure forms reject
  with stable code and path evidence. **DECIDED**
- The type catalog is deliberately empty. All 95 `typeAnnotation` contracts
  remain `excluded-host-type`; required-type nodes reject rather than degrade.
  A non-empty KERN-owned type grammar requires a later reviewed slice.
  **DECIDED**
- Import paths are syntax-normalized only. Module resolution and symbol-kind
  parity remain R1.5c.3; complete disposition witnesses remain R1.5c.4.
  **DECIDED**
- This boundary does not export from `@kernlang/core`, enter the runner/browser
  graph, replace the semantic probe, or claim KIR v1/Alpha. **GUARD**

Decision evidence: adversarial tribunal
`tribunal-1783838255063-eec72y` completed 3/3 on 2026-07-12 and selected this
tightened conservative boundary over a premature type AST. **VERIFIED**

Closure evidence: `pnpm test:kern-kir-structural-codec` passed with 38 codec
tests plus the AST-based containment regression; `pnpm fitness:kern-5` reached
`KERN 5 current fitness wall passed.` on 2026-07-12. Final Agon review
`review-1783846772713-dl5228-kern-5-r1-5c2-structural-codec-f` completed 3/3
with zero verified, needs-check, or speculative findings. The codec remains
internal, browser-safe, and `ALPHA-NO-GO`; it is not publicly exported or
adopted by the runtime. **VERIFIED**

### R1.5c.3 — Module and symbol-kind parity

- Generalize imports/exports beyond `fn` using the declared included symbol
  kind.
- Prove aliases, re-exports, duplicate local binding, missing export, kind
  mismatch, unsafe path, and cycle rejection.
- Preserve module input-order invariance and child-order significance.

**Exit:** module graph hostile corpus is deterministic across fresh processes,
locale, timezone, and clean roots.

#### R1.5c.3 decided contract

- Add a separate internal envelope `kern.kir.modules.r1.5c.3-alpha`; do not
  mutate the R1.5c.2 single-root format or its empty type catalog. The envelope
  binds exactly `constitution`, empty `diagnostics`, `format`, sorted `modules`,
  `proofLabel`, and `symbolCatalog`. **DECIDED**
- The symbol catalog admits exactly `class` and `fn`, matching the live runner
  linker while closing the old semantic probe's `fn`-only gap. Admission is
  structural: a top-level node of an embedded R1.5c.2 document root, portable
  text `name`, and boolean `export=true` for local exports. No schema-derived
  expansion is allowed. **DECIDED**
- Each module binds its normalized relative POSIX `.kern` `id`, an ordered
  `roots` list containing one independently projected R1.5c.2 structural node
  per source top-level node, sorted import records with sorted bindings, and
  sorted export records. `document` is not admitted by c.2 and is forbidden;
  no synthetic `module` wrapper may be invented. The narrow c.3 root catalog is
  `class | fn | from | module | use`; only `class`, `fn`, and `use/from` edges
  contribute graph semantics. Import resolution is pure, root-confined, and
  tries the exact normalized target followed by `.kern`; it performs no
  filesystem, package, loader, or host resolution. **DECIDED**
- The writer derives graph metadata from the roots. The reader revalidates every
  embedded root, recomputes declarations/imports/exports, compares them to the
  serialized metadata, then proves missing-module/export, kind, alias,
  re-export, duplicate-binding/export, and cycle invariants before return.
  Stable codes and canonical artifact paths identify every rejection.
  **DECIDED**
- Module records, imports, bindings, and exports use code-point ordering;
  semantic child order inside each root remains significant. Module input order,
  locale, timezone, and fresh-process state cannot alter bytes. **GUARD**
- Diagnostics must remain empty; diagnostic/location identity is R1.5d. This
  slice does not define type/value namespaces, host/default/type exports, full
  symbol semantics, codegen/runner behavior, M3 ABI, public export, KIR v1, or
  the R1.5c.4 302-node coverage closure. **GUARD**

Decision evidence: adversarial tribunal
`tribunal-1783847083626-s5bwle-kern-5-r1-5c3-module-symbol-cont` completed 3/3
on 2026-07-12 and selected the self-contained embed-and-revalidate envelope
with an explicit `class | fn` catalog. Follow-up brainstorm
`brainstorm-1783847677949-0wsjgo-kern-5-r1-5c3-module-container-c` completed
3/3 after focused tests proved `document` is non-catalog; it unanimously
selected ordered per-source `roots[]` over a synthetic wrapper. **VERIFIED**

Closure evidence: `pnpm test:kern-kir-module-graph` passed 23 focused graph,
hostile, transitive re-export, path, and fresh-process determinism tests plus a
16-module browser-containment check. `pnpm fitness:kern-5` reached
`KERN 5 current fitness wall passed.` on 2026-07-12. Final Agon review
`review-1783850995953-nye6e3-kern-5-r1-5c3-module-symbol-grap` completed 3/3
with zero verified findings. The remaining needs-check suggestions were
disproved by the gate's explicit core build and the inherited fail-closed c.2
error contract. The module codec remains internal and `ALPHA-NO-GO`, with no
public export or runtime adoption. **VERIFIED**

### R1.5c.4 — Coverage closure

- Generate one positive round-trip witness per included/lowered node kind.
- Generate one negative fixture per exclusion reason and bind every property
  row to an applicable witness.
- Transition all 302 source rows from `candidate-witnessed`/`unresolved` to
  `included-structural`, `lowered-semantic`, or `excluded-explicit`.
- Reclassify the 16 runner rows as `deferred-runtime-m3`, not source-parity
  failures, while retaining their unresolved runtime evidence.

**Exit:** zero source rows unresolved; `ALPHA-NO-GO` remains because R1.5d
diagnostic/location evidence and the clean-SHA Alpha manifest are absent.

#### R1.5c.4 decided contract

- Keep the constitution generator inventory-only. Add a compact checked-in
  witness ledger whose node/property expectations and fixture recipes are
  compared to, but never generated or auto-promoted from, the live
  constitution during a gate. **DECIDED**
- Source dispositions are exactly `included-structural`, `lowered-semantic`,
  `required-excluded-host-payload`, and `explicit-missing-schema`. Every row
  names a stable executable witness ID; zero `unresolved` or
  `candidate-witnessed` rows remain. **DECIDED**
- Every property row retains the c.1 disposition vocabulary and binds populated
  evidence. Optional properties additionally bind omitted-state evidence so
  defaults cannot cross the boundary. Properties on a globally rejected node
  bind to the explicit node-rejection context rather than claiming unreachable
  positive semantics. **DECIDED**
- The executor consumes ledger fixture recipes independently of `NODE_SCHEMAS`,
  round-trips admitted/lowered cases, and asserts stable rejection codes for
  host-only or missing-schema cases. The validator separately proves exact
  ordered equality with all 302 node and 1,149 property constitution rows.
  **GUARD**
- All 16 runner rows become `deferred-runtime-m3`, with an explicit M3 reason;
  they are neither covered nor unresolved source-parity failures. R1.5d
  diagnostics/locations, runtime ABI/execution, KIR v1 freeze, Alpha acceptance,
  public export, and semantic cutover remain false. **GUARD**

Decision evidence: adversarial tribunal
`tribunal-1783851382134-cywq23-kern-5-r1-5c4-coverage-closure-c` completed 3/3
on 2026-07-12 and selected independent checked-in ledger evidence over both
auto-generated self-proof and handwritten fixture explosion. **VERIFIED**

## Rejected Options

### Expand only the 16 runtime contracts

Rejected. This conflates M3 execution ABIs with the 302-kind source wire and
leaves module/node writer-reader parity open.

### Mark all unsupported source kinds excluded

Rejected. Absence of an implementation is not evidence of a language-level
exclusion. Each exclusion needs a property-level reason and executable reject
fixture.

### Serialize `NODE_SCHEMAS` plus raw property strings

Rejected. That would canonically preserve TypeScript/Python/host syntax rather
than define KERN-owned semantics.

### Rename the semantic probe to KIR v1

Rejected. The seven-node probe remains a differential oracle and does not
cover the language, structural module graph, diagnostics, or runtime.

## Acceptance Criteria

- [x] R1.5c.1 exact 302-node and property constitution is source-bound and
      mutation-tested.
- [x] R1.5c.2 writer output decodes under identical limits, admitted portable
      values/expressions are byte-canonical, and the empty type catalog rejects
      required types without degradation.
- [x] R1.5c.3 imports/exports support the explicit `class | fn` symbol catalog,
      including transitive re-exports, and hostile graph cases reject
      deterministically.
- [x] R1.5c.4 leaves zero unresolved source rows and binds every disposition to
      executable evidence.
- [x] No raw expression, raw block, host regex validation, host numeric
      conversion, unknown field, or fallback crosses the boundary.
- [x] Existing semantic probe, reader candidate, ownership, and R1.5a/R1.5b
      gates remain unchanged and green.
- [x] Full `fitness:kern-5` and Agon review with exactly `claude,codex,agy`
      pass for every serial sub-slice before commit/push.
- [x] `ALPHA-NO-GO`, absent `test:kern-ir`, internal containment, and all M3
      runtime deferrals remain true after R1.5c.

### R1.5c.1 Closure Evidence

- `test:kern-kir-structural-constitution`: 5/5 tests passed; 300/302
  schema-bound nodes, 1,149 exact property dispositions, two explicit
  missing-schema exclusions, and seven fully bound non-catalog schemas.
- `fitness:kern-5`: complete current wall passed on 2026-07-12.
- Agon review `review-1783838024689-5t2dq4-kern-5-r1-5c1-constitution-final`:
  `claude,codex,agy` all succeeded with zero findings.
- Status remains `ALPHA-NO-GO`; there is no public KIR export, runtime adoption,
  probe replacement, or KIR v1 freeze.

### R1.5c.4 Closure Evidence

- `test:kern-kir-coverage-closure`: 302/302 node dispositions and 1,149/1,149
  property dispositions are ledger-bound; 2,286 populated/omitted executable
  witnesses passed with exact canonical values or stable rejection codes.
- `test:kern-ir-eligibility`: zero unresolved source rows; all 16 runner
  contracts are explicit `deferred-runtime-m3` rows, while all promotion claims
  remain false.
- `fitness:kern-5`: the complete current wall passed on 2026-07-12, including
  existing seam, reader, ownership, R1.5a/R1.5b, conformance, native, browser,
  and diff-hygiene gates.
- Agon review `review-1783852143959-dalddv` completed 3/3. Its canonical-value
  needs-check was fixed by comparing every admitted fixture to an independent
  canonical value recipe; the decoded-property-shape needs-check was disproved
  by the structural reader contract and made explicit in the executor failure.
- Final Agon review `review-1783853586198-sevw0o` completed 3/3 with zero
  verified findings. Its order-sensitive equality needs-check was dismissed:
  canonical record ordering is semantic evidence here, not incidental object
  equality.
- Status remains `ALPHA-NO-GO`; R1.5d diagnostic/location evidence and the
  clean-SHA Alpha manifest remain absent, with no KIR v1 freeze, public export,
  runtime adoption, or semantic cutover.

## Out of Scope / Explicit Non-Claims

- Diagnostic IDs/messages/categories, source spans, or evidence envelope.
- KIR v1 public freeze, package export, Alpha acceptance, or semantic cutover.
- Runtime trace, handler, capability, scheduler, outcome, or completion ABI.
- KERN-authored frontend/interpreter and fixed-point self-hosting.

## Rollback

Each sub-slice is internal and additive. Rollback removes its constitution or
reader gate; the R1.5b canonical value reader, seven-node semantic probe, KERN
4.5 runtime, and all public package surfaces remain unchanged.
