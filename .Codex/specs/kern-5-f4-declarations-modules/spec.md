# KERN 5 Frontend F4 Declarations and Modules Contract

**Status:** DECIDED — IMPLEMENTATION PENDING

**Date:** 2026-08-20

**Parent contracts:**

- `.Codex/specs/kern-5-frontend-surface-closure/spec.md`
- `.Codex/specs/kern-5-f1-production-scanner/spec.md`
- `.Codex/specs/kern-5-f2-expression-parser/spec.md`
- `.Codex/specs/kern-5-f2-document-batch/spec.md`
- `.Codex/specs/kern-5-f3-line-tree/spec.md`
- `.Codex/specs/kern-5-post-m4-171-completion/spec.md`

**Decision tribunal:**
`/Users/nicolascukas/.agon/runs/tribunal-1787227052121-yab2dz-kern5-f4-boundary`

**Conflict-resolution brainstorm:**
`/Users/nicolascukas/.agon/runs/brainstorm-1787227438602-emj320-kern5-f4-taint`

**Confidence:** 0.91 (initial 0.82)

## Decision

F4 is the sole KERN owner of declaration classification, property/default-rule
admission, schema child attachment, decorator target admission, module-root
classification, import/export binding validation, and module-graph diagnostics.
It has two separately sealed KERN subphases. F4A consumes authenticated F1
records, F2B expression receipts, and the exact sealed F3 structural result for
one document. F4B consumes an ordered closed module set plus the exact F4A
receipts and links only the structurally accepted dependency subgraph. The
terminal F4 result is either one sealed complete success or one sealed failure
report; no partial module artifact escapes.

F4 does not select canonical KIR fields, lower expression nodes, emit KIR,
change the frozen schema/module contracts, or promote the public frontend.
Those remain F5-F7 work.

## Current Evidence

- **[F4-E1 VERIFIED]** F0 freezes 302 ordered source node types, 1,149 ordered
  structural properties, five module root kinds, two symbol kinds, the parser
  diagnostic catalog, five fail-closed frontend diagnostics, and F1-F7 order.
- **[F4-E2 VERIFIED]** F3 emits source-ordered logical rows, nearest-lower-indent
  parent edges, provisional decorator adjacency, raw geometry, and structural
  diagnostics without declaration or property fields.
- **[F4-E3 VERIFIED]** F2B retains every exact F2 receipt and binds its absolute
  document spans without interpreting expression payloads.
- **[F4-E4 VERIFIED]** Bootstrap `parseLines` attaches decorators only to a
  same-indent following `fn`, applies explicit exported-decorator state only to
  that function, and emits `DROPPED_DECORATOR` for every invalid target.
- **[F4-E5 VERIFIED]** The structural constitution owns node schema status,
  allowed-child catalogs, and every property disposition. The module contract
  owns the five admitted roots and two exported symbol kinds.
- **[F4-E6 VERIFIED]** The earlier successful-line and keyword-handler receipts
  are `*-shadow.*` evidence. F0 forbids a production frontend module from
  consuming them, so F4 may not delegate to or reseal those receipts.

## Boundary Claims

- **[F4-C1 DECIDED]** F4A is one invocation per document and emits a cacheable
  receipt sealed over its F1/F2B/F3 prerequisites. F4B is one closed-world
  invocation over the ordered module IDs and exact F4A receipts; its seal binds
  their ordered receipt identities.
- **[F4-C2 DECIDED]** Host code may load, hash, order, and frame the frozen node,
  constitution, module, and keyword-source-form authorities. It may not classify
  a source token, choose a schema/property disposition, apply a default, attach
  a decorator, or resolve a binding.
- **[F4-C3 DECIDED]** KERN independently authenticates every prerequisite tape
  against the exact source and validates catalog counts, order, row shape, and
  closed vocabularies before it emits a semantic row.
- **[F4-C4 DECIDED]** F4 recognizes all 302 frozen source node types and the
  closed 26-entry keyword/source-form catalog. A source-admitted node without a
  structural schema retains its frozen fail-closed disposition.
- **[F4-C5 DECIDED]** Each property is bound to an exact source span, owner row,
  catalog ordinal, schema kind, required flag, constitution disposition, value
  representation class, and optional F2B segment ordinal. Absence is recorded
  only as `absent`; neither the structural property contract nor `PropSchema`
  contains a default-value slot. F4 never invents one. F5 alone selects any
  projection-time default rule, materializes its value, and chooses KIR field
  order.
- **[F4-C6 DECIDED]** Duplicate properties are last-write-wins for the effective
  declaration row and emit the frozen `DUPLICATE_PROP` diagnostic at the later
  property span. Required omissions and malformed/unexpected tokens emit
  `UNEXPECTED_TOKEN`; unknown node types retain `UNKNOWN_NODE_TYPE`.
- **[F4-C7 DECIDED]** F3 parent edges are immutable geometry. F4A validates every
  edge against the frozen allowed-child catalog without rewriting, dropping, or
  reparenting it. `invalid-child` rejects F4A semantic success but does not stop
  source-ordered local rejection reporting.
- **[F4-C8 DECIDED]** When an edge is invalid, its child and descendants form a
  detached semantic subtree. F4A still validates their intrinsic properties and
  descendant-local edges, but detached rows contribute no declaration, import,
  export, binding, default, or parent-scope effect. Their F3 edges remain exact.
- **[F4-C9 DECIDED]** A candidate decorator run is admitted only when its
  immediate same-indent successor classifies as `fn`. Its decorator rows become
  ordered children of that function; an exported decorator sets the function's
  effective export flag only when explicitly present. Every other candidate or
  F3 orphan emits one ordered `DROPPED_DECORATOR` per decorator row.
- **[F4-C10 DECIDED]** Raw-block ownership is classified as a property payload
  of its authenticated owner, but F4 retains the frozen excluded-raw
  disposition. F4 never interprets or copies the raw body into an admitted
  semantic value.
- **[F4-C11 DECIDED]** Module roots are limited to `class`, `fn`, `from`,
  `module`, and `use`; exported symbols are limited to `class` and `fn`.
  Unsupported roots emit `FRONTEND_UNSUPPORTED_MODULE_ROOT` without entering
  the graph.
- **[F4-C12 DECIDED]** `use` paths resolve from normalized module IDs within the
  supplied closed set. `from` defaults `as` to the imported name, defaults
  `reexport` to false, validates kind against `class|fn`, and rejects missing,
  duplicate, unknown, or conflicting bindings deterministically. These are
  link-time syntactic normalizations already owned by the immutable module
  graph contract, not schema-property default materialization.
- **[F4-C13 DECIDED]** Schema/default validation and module linking have distinct
  immutable rejection vocabularies. F4A structural rejection facts use existing
  `StructuralKirErrorCode` values; its module-ID/root/symbol facts and all F4B
  graph facts use existing `ModuleKirErrorCode` values, including the exact
  `module-cycle` spelling. They are internal failure facts, not parser
  diagnostics and not module artifact diagnostics. No new code is added and no
  existing code is overloaded.
- **[F4-C14 DECIDED]** Recoverable parser diagnostics remain ordered by module
  order, source position, phase rank, then rule rank. F4 rejection facts remain
  in separate ordered partitions. Fatal prerequisite, authority, limit, or
  forced-late failures expose no success tapes.
- **[F4-C15 DECIDED]** F4B defines `R` as F4A-rejected modules, `T` as every
  transitive importer of `R`, and `V = All \\ (R union T)`. Reverse reachability
  uses normalized edges from importers; rejected modules expose no interface or
  degraded signature. F4B fully validates only the induced `V` subgraph.
  Modules in `T` emit no F4B error code; they appear only in the deterministic
  blocked partition. A target present in `R` or `T` never fabricates
  `missing-module`, `missing-export`, or `kind-mismatch`.
- **[F4-C16 DECIDED]** Whole-set success requires empty `R`, empty `T`, and no
  F4B rejection facts. Any failure produces one sealed failure report with no
  partial artifact. Independent components in `V` are nevertheless fully
  validated and their real link failures are reported.
- **[F4-C17 DECIDED]** F4 remains `internal-oracle`; F5 alone selects included
  fields, applies exclusion outcomes to KIR construction, and emits canonical
  module KIR.

## Protocol

### Inputs

F4A receives one closed document request containing:

1. normalized module ID and exact source;
2. exact F1 record arrays and record tape;
3. exact F2B fields plus sidecar F2 receipt fields;
4. exact F3 fields;
5. ordered node rows and property rows derived mechanically from the frozen
   authorities, including all ordinals and closed disposition strings;
6. the frozen module-root, symbol-kind, diagnostic, and keyword/source-form
   catalogs; and
7. downward-only F4A policy ceilings plus a test-only late-failure flag.

The host executes F1, F2B, and F3 once for the source and reuses those exact
results. F4B separately receives the ordered normalized module IDs, their exact
F4A fields and seals, downward-only F4B ceilings, and a test-only late-failure
flag. It never receives a bootstrap AST, KIR node, or host-derived signature.

### F4A success sections

The fixed-shape result contains:

1. identity, prerequisite-count, authority-count, and terminal-count fields;
2. declaration rows;
3. property occurrence rows;
4. property presence rows;
5. validated attachment rows;
6. decorator attachment/disposition rows;
7. complete top-level symbol candidates;
8. normalized import-edge and binding-intent rows;
9. ordered parser-diagnostic rows; and
10. one document terminal seal.

Every nested row is Unicode-scalar length-framed and source ordered. Declaration
and property rows contain source spans and catalog identities, not KIR objects.

### F4A rejection report

F4A scans to its deterministic reporting boundary and returns no consumable
interface. Its sealed failure data contains ordered parser diagnostics,
`StructuralKirErrorCode` and document-local `ModuleKirErrorCode` facts with
exact row/property/edge spans, detached-row ordinals, and normalized import-edge
observations only where they were independently well formed. No declaration,
export, binding, or signature tape from a rejected document is consumable by
F4B.

### F4B result

F4B success contains exact module, import-binding, export, and component rows
for the complete set plus one seal. F4B failure contains four non-artifact
partitions in this exact order:

1. `rejected`: `R` rows sorted by normalized module ID, each binding its exact
   F4A failure seal;
2. `blocked`: `T` rows sorted by normalized module ID, each carrying the
   lexicographically smallest rejected dependency reachable from that module;
3. `link-facts`: existing `ModuleKirErrorCode` rows from `V`, ordered by
   component minimum ID, module ID, source position, rule rank, then code; and
4. `validated-components`: identities and receipt seals for independently
   checked `V` components, never KIR or partial artifact payloads.

The whole failure envelope has one terminal seal. Blocked rows are status data,
not diagnostics and not module error codes.

### Fatal failure sections

Fatal failure returns empty success sections and one closed diagnostic:

- `F4_INVALID_REQUEST`
- `F4_AUTHORITY_DRIFT`
- `F4_F1_DRIFT`
- `F4_F2B_DRIFT`
- `F4_F3_DRIFT`
- `F4_LIMIT`
- `FORCED_LATE_FAILURE` (test-only)

## Resource and Precedence Contract

- **[F4-R1 DECIDED]** Every module, F1 record, F2B segment/node, F3 row/edge,
  source scalar, catalog row, declaration, property occurrence, property
  presence, attachment, decorator, symbol, binding, diagnostic, work step, and
  encoded byte has a policy-owned ceiling.
- **[F4-R2 DECIDED]** Catalog lookup uses bounded KERN-owned ordinal maps built
  once per invocation. Source and prerequisite tapes are each consumed by
  advancing cursors; whole-document substring search and per-row rescans are
  forbidden.
- **[F4-R3 DECIDED]** Charging is monotone and observable. A valid source row is
  visited once for classification and each property occurrence once for
  admission. Module graph resolution is linear in modules, symbols, and
  bindings after map construction.
- **[F4-R4 DECIDED]** F4A failure precedence is request shape; authority identity;
  F1; F2B; F3; declaration syntax; property/default admission; attachment;
  decorator; module roots/symbols/bindings; aggregate limits; seal; forced late
  failure. F4B precedence is request/authentication; normalized module IDs;
  rejected/blocked partition; component-local module graph phase; limits;
  seal; forced late failure. Facts are emitted directly in canonical order;
  post-hoc diagnostic sorting is forbidden.

## Acceptance

- **[F4-A1 PROPOSED]** RED at the F3 baseline is semantic: F3 produces identical
  geometry for `fn` and non-`fn` decorator targets and cannot emit the required
  F4 declaration/diagnostic rows.
- **[F4-A2 PROPOSED]** All 302 source node rows and all 1,149 property rows have
  direct full-table admission evidence; row deletion, reorder, duplicate,
  disposition drift, and same-length substitution reject.
- **[F4-A3 PROPOSED]** Every closed keyword/source form has positive, malformed,
  fallback, multiline, quoted, astral, and trailing-property evidence where
  applicable, with exact parity to hand-authored expectations.
- **[F4-A4 PROPOSED]** Decorator tests cover runs, explicit export, EOF,
  indentation mismatch, non-`fn` substitution, malformed decorator syntax,
  and one diagnostic per dropped decorator.
- **[F4-A5 PROPOSED]** Property tests cover required/optional/absent,
  duplicate/unknown, every value representation, expression binding, raw/host
  exclusions, link-time `from.as`/`reexport` normalization, and property names
  that collide with object prototypes.
- **[F4-A6 PROPOSED]** Attachment tests cover unrestricted, empty, and explicit
  child catalogs plus reordered/duplicated/missing F3 edges without semantic
  reparenting.
- **[F4-A7 PROPOSED]** Module-set tests cover the immutable valid/malformed F0
  goldens, forward/backward imports, aliases, reexports, duplicates, missing
  modules/symbols, wrong kinds, cycles, unsupported roots, and deterministic
  diagnostic order.
- **[F4-A8 PROPOSED]** Mutations kill prerequisite forgery, semantic host
  delegation, shadow-receipt consumption, catalog omission, constant output,
  partial failure, post-hoc sorting, hardcoded limits, and seal drift.
- **[F4-A9 PROPOSED]** Frozen 1x/2x/4x/8x declaration, property, attachment,
  decorator, and module-density families satisfy adjacent and absolute time,
  RSS, envelope-size, and work-step walls. Each document uses one F4A runtime
  invocation and the closed set uses one F4B runtime invocation.
- **[F4-A10 PROPOSED]** Focused F1/F2/F2B/F3/F4, runtime ABI, canonicalizer,
  checker, formatter, lint, and cumulative KERN 5 gates pass before acceptance;
  independent automatic-risk Agon review has no unresolved verified blocker.

## Kill Switches

Stop and redesign if implementation requires any of the following:

1. consuming a `kern.frontend.*-shadow.*` receipt in production;
2. using TypeScript/bootstrap parser output as a production input;
3. host-side source classification, schema decisions, defaults, attachment, or
   module binding resolution;
4. changing F0, F1, F2, F2B, F3, KIR, schema, module, diagnostic, or public API
   bytes to fit F4;
5. scanning a source or prerequisite tape quadratically;
6. dropping or reparenting an F3 edge to make schema attachment pass;
7. exposing a successful sibling after a fatal module-set failure; or
8. promoting `test:kern-frontend` before F5-F6 complete.

## Challenge Resolution

The tribunal rejected the initial single-invocation/effective-default design.
It established the F4A/F4B split, F5-only schema-default materialization,
failure-report versus successful-artifact distinction, and detached-subtree
rule. Its proposed `upstream-module-failed` and `cyclic-dependency` names were
rejected after direct code verification: the immutable catalog contains no
upstream code and spells the cycle code `module-cycle`.

The full-roster grounded brainstorm replaced degraded signatures with the
`R/T/V` quarantine protocol above. This removes the last semantic dependency:
F4B never needs an interface from a rejected document, never fabricates a
cascade, and still proves every independent accepted component. The remaining
implementation risk is mechanical breadth across the 302-node/1,149-property
catalog and is addressed by full-table, mutation, and scaling acceptance.
