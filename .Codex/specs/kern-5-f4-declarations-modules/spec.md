# KERN 5 Frontend F4 Declarations and Modules Contract

**Status:** DECIDED — IMPLEMENTATION IN PROGRESS

**Date:** 2026-08-20

**Parent contracts:**

- `.Codex/specs/kern-5-frontend-surface-closure/spec.md`
- `.Codex/specs/kern-5-f1-production-scanner/spec.md`
- `.Codex/specs/kern-5-f2-expression-parser/spec.md`
- `.Codex/specs/kern-5-f2-document-batch/spec.md`
- `.Codex/specs/kern-5-f3-line-tree/spec.md`
- `.Codex/specs/kern-5-post-m4-171-completion/spec.md`

**Decision tribunal:**
`~/.agon/runs/tribunal-1787227052121-yab2dz-kern5-f4-boundary`

**Conflict-resolution brainstorm:**
`~/.agon/runs/brainstorm-1787227438602-emj320-kern5-f4-taint`

**Completion-boundary tribunal:**
`~/.agon/runs/tribunal-1787233428157-nb1x1m-kern5-f4-remaining-boundary`

**Completion-plan brainstorm:**
`~/.agon/runs/brainstorm-1787233836549-zshvjd-kern5-f4-remaining-plan`

**Quoted-expression ownership tribunal:**
`~/.agon/runs/tribunal-1787234581026-9qxm88-kern5-f4-quoted-expression-owner`

**Expression-evidence brainstorm:**
`~/.agon/runs/brainstorm-1787235009341-z7h7ry-kern5-f4-expression-evidence-des`

**Review-blocker tribunal:**
`~/.agon/runs/tribunal-1787241805622-2a6t8j-kern5-f4-review-blockers`

**Path/ID contract tribunal:**
`~/.agon/runs/tribunal-1787249949827-4ik05c-kern5-f4-path-id-contract`

**Path failure-boundary follow-up:**
`~/.agon/runs/tribunal-1787250548434-mkhx1n-kern5-f4-path-failure-boundary`

**Request-precedence tribunal:**
`~/.agon/runs/tribunal-1787255055837-yvvst6`

**Non-evidence:** The malformed aborted run `w2h61m` is explicitly ignored.

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
  The constitution authority therefore has exactly 1,451 rows: 302 node rows
  plus 1,149 property rows.
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

- **[F4-C1 DECIDED]** F4A is exactly one KERN invocation per document request.
  Its cacheable `.2` receipt binds only its KERN-selected F4 result. Available
  F1/F2B/F3 transports are authenticated during that invocation; they and their
  private availability states are not durably identified by a fatal receipt.
  A receipt alone is therefore not a prerequisite-vector witness: any caller
  cache key must include the private envelope state and the F4 policy identity.
  F4B is one closed-world
  invocation over the ordered module IDs and exact F4A receipts; its seal binds
  their ordered receipt identities.
- **[F4-C2 DECIDED]** Host code may load, hash, order, and frame the frozen node,
  constitution, module, and keyword-source-form authorities. It may not classify
  a source token, choose a schema/property disposition, apply a default, attach
  a decorator, or resolve a binding.
- **[F4-C3 DECIDED]** KERN independently authenticates every *available*
  prerequisite tape against the exact source and validates catalog counts,
  order, row shape, and closed vocabularies before it emits a semantic row. A
  non-available prerequisite has canonical empty payload and is never traversed;
  after authority identity KERN, not the host, maps the one legal failed
  F1/F2B/F3 stage to the existing F4 prerequisite-drift vocabulary.
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
- **[F4-C12 DECIDED]** `use` paths resolve from canonical module IDs within the
  supplied closed set. Their exact F4 grammar, lexical resolution, and failure
  boundary are frozen in the Path and Module-ID Amendment below. `from`
  defaults `as` to the imported name, defaults `reexport` to false, validates
  kind against `class|fn`, and rejects missing, duplicate, unknown, or
  conflicting bindings deterministically. These are link-time syntactic
  normalizations already owned by the immutable module graph contract, not
  schema-property default materialization.
- **[F4-C13 DECIDED]** Schema/default validation and module linking have distinct
  immutable rejection vocabularies. F4A structural rejection facts use existing
  `StructuralKirErrorCode` values; its module-ID/root/symbol facts and all F4B
  graph facts use existing `ModuleKirErrorCode` values, including the exact
  `module-cycle` spelling. They are internal failure facts, not parser
  diagnostics and not module artifact diagnostics. No new code is added and no
  existing code is overloaded.
- **[F4-C14 DECIDED | IMPLEMENTED — VERIFIED]** F4A KERN constructs and seals recoverable parser
  diagnostics in canonical `(module order, source position, phase rank, rule
  rank)` order before its document terminal seal. The module outcome is latched
  by the independently evaluated F4A precedence contract, never inferred from
  the first diagnostic or from diagnostic-tape order. F4 rejection facts remain
  in separate ordered partitions. A fatal prerequisite, authority, limit, or
  forced-late failure is atomic and exposes no ordinary success tape. A host
  consumer may validate the sealed order but may not sort, normalize, or repair
  it. The KERN construction is a four-head streaming merge of the existing
  property, expression, decorator, and root framed phase tapes. Each producer
  uses KERN-private phase ranks `property=0`, `expression=1`,
  `decorator=2`, and `root=3`. Its closed rule ranks are property:
  `DUPLICATE_PROP=0`, `UNEXPECTED_TOKEN=1`,
  `FRONTEND_EXCLUDED_HOST_EXPRESSION=2`, `FRONTEND_EXCLUDED_HOST_TYPE=3`,
  `FRONTEND_EXCLUDED_RAW_BLOCK=4`; expression:
  `FRONTEND_INVALID_EXPRESSION=0`; decorator:
  `DROPPED_DECORATOR=0`; root:
  `FRONTEND_UNSUPPORTED_MODULE_ROOT=0`. Each producer and the merged output
  must be strictly increasing by `(startScalar, phaseRank, ruleRank)`; an equal
  or decreasing key is `F4_AUTHORITY_DRIFT`. Equal distinct keys are forbidden:
  current emission families produce at most one row per rule at one source
  start, so a duplicate indicates producer drift. No `.3`, serialized order
  key/emission ordinal, or deduplication is permitted. A generic sort,
  source-scalar bucket scan, or host-side merge is not permitted.
  The decoder checks only the five-field shape, span, severity, and
  nondecreasing source start; KERN-owned oracles and mutations prove phase/rule
  tie behavior.
  Current KERN implementation and framed-cursor evidence:
  `examples/kern-frontend/f4-diagnostic-merge.kern:21-45,348-445`,
  `examples/kern-frontend/f4-declarations-main.kern:472-484`, and
  `scripts/kern-frontend-f4-declarations/decoder.mjs:185-191,270-319`.
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
- **[F4-C18 DECIDED]** F2B remains delimiter-only and never consumes property
  authority. After F4 classifies a property as `lowered-expression`, brace
  form binds the exact authenticated F2B receipt while quoted form is decoded
  once in KERN and dispatched to the existing pure KERN F2 parser inside the
  single external F4A invocation. Excluded `rawExpr` never binds expression
  evidence and never triggers an F4-local F2 call.
- **[F4-C19 DECIDED]** Expression evidence is a separately framed semantic
  section, so the private document format advances to
  `kern.frontend.f4-document.2`. A `.2` producer or consumer rejects `.1`, and
  F4B rejects mixed document receipt versions. Frozen F0 source/canonical
  goldens and F1/F2/F2B/F3 formats remain byte-identical.
- **[F4-C20 DECIDED]** Let `S_total` be decoded scalars across all successful
  expression-evidence rows, `S_local` the subset from `f4-local` rows,
  `E_local_success` the count of those rows, `L_attempted` the number of local
  F2 dispatch attempts, and `B` the aggregate local boundary entries. The exact
  runtime identity is `B = S_local + E_local_success`; failed local attempts
  and F2B-origin rows contribute zero to `B`. Receipt acceptance is the
  conjunction `S_total <= S_cap && L_attempted <= L_cap && B <= B_cap`, with
  deterministic limit evaluation in `S_total`, `L_attempted`, then `B` order.
  The shipped independent boundary cap remains 65,546.
- **[F4-C21 DECIDED | IMPLEMENTED — VERIFIED | HISTORICAL `.2` BASELINE —
  SUPERSEDED BY F4-RP9/RP11]** This records the initial F4B
  `kern.frontend.f4-module-set.2` identity commitment. The current F4B result
  contract is `kern.frontend.f4-module-set.3` under policy `.4`; F4A remains
  `kern.frontend.f4-document.2`. Before graph work, the historical F4B KERN
  accepted only F4A `.2` document identities and produced one ordered,
  length-framed identity
  commitment containing every input `{moduleId, format, status, seal}` in the
  supplied module order, including identities whose modules later enter `T`.
  A non-F4A `.2` format, malformed/extra framing, positional-ID disagreement,
  duplicate ID, invalid status vocabulary, or invalid seal shape returns an
  atomic F4B `F4_INVALID_REQUEST` result with no ordinary partitions. This
  commitment binds the exact trusted handoff presented to F4B; it does not
  authenticate an F4A document or recompute its seal from unavailable F4A
  fields. Its smallest result envelope has nine fields: the `.1` sections plus
  the identity tape immediately before the terminal field. Its input adds a
  same-length `f4aFormats` array alongside `f4aStatuses` and `f4aSeals`. The
  outer F4B receipt seal was SHA-256 over every `.2` field, including that tape.
  Historical `.2` input/output evidence:
  `scripts/kern-frontend-f4-declarations/module-set-worker.mjs:57-101`,
  `examples/kern-frontend/f4-module-set-main.kern:41-95,304-315`, and
  `scripts/kern-frontend-f4-declarations/module-set-decoder.mjs:19-83`.

## Protocol

### Inputs

F4A receives one closed document request containing:

1. a canonical module ID and exact source, subject to F4A KERN request
   validation before semantic processing;
2. one closed prerequisite envelope for each of F1, F2B, and F3; its state is
   `available|failed|not-attempted`, and its payload is the exact existing F1,
   F2B-plus-sidecar, or F3 transport only when available;
3. ordered node rows and property rows derived mechanically from the frozen
   authorities, including all ordinals and closed disposition strings;
4. the frozen module-root, symbol-kind, diagnostic, and keyword/source-form
   catalogs; and
5. downward-only F4A policy ceilings plus a test-only late-failure flag.

The host executes F1, F2B, and F3 once for the source when each earlier
prerequisite has its expected accepted state, then transports their exact
available results. On the first expected upstream rejection it transports that
stage as `failed`, marks later stages `not-attempted`, and still invokes F4A
exactly once. Infrastructure/runtime exceptions remain exceptions and are not
converted into state tags.

F4B separately receives the ordered canonical module IDs and their trusted F4A
`.2` identities, plus only the F4A-derived symbol/binding transport needed for
graph work, downward-only F4B ceilings, and a test-only late-failure flag. It
never receives a bootstrap AST, KIR node, or host-derived signature.

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
9. ordered parser-diagnostic rows;
10. ordered expression-evidence rows; and
11. one document terminal seal.

Every nested row is Unicode-scalar length-framed and source ordered. Declaration
and property rows contain source spans and catalog identities, not KIR objects.

Each expression-evidence row binds one property occurrence to one exact F2
receipt. It records a contiguous evidence ordinal, occurrence ordinal, origin
(`f2b|f4-local`), optional F2B segment ordinal, absolute expression span,
decoded expression source, quoted-boundary tape when local, exact nine-field F2
receipt tape, absolute node-span tape, node count, and a closed structural row
seal. F4B and F5 may consume only the sealed evidence row; neither may parse an
unsealed expression string.

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
- **[F4-R3 DECIDED]** F4A `maxWorkSteps` and its sealed `.2` `workSteps` count
  monotone, observable **post-authentication F4 semantic and output work**.
  A valid source row is visited once for classification and each property
  occurrence once for admission. This counter does not claim that a debit made
  after prerequisite replay bounds the replay that already occurred. Total F4A
  invocation cost is compositionally bounded by the explicit F4
  source/record/path ceilings and the independently enforced F2B batch and
  child-expression and F3 work ceilings. Module graph resolution is linear in
  modules, symbols, and bindings after map construction.
- **[F4-R4 DECIDED]** F4A failure precedence is request shape (including module
  ID and prerequisite-envelope shape); request-level limits; authority identity;
  F1; F2B; F3; declaration syntax; property/default admission; attachment;
  decorator; module roots/symbols/bindings; aggregate limits; seal; forced late
  failure. F4B precedence is
  request/authentication/canonical transported IDs; rejected/blocked partition;
  component-local module graph phase; limits;
  seal; forced late failure. Rejection facts are emitted directly in canonical
  order; C14 diagnostics use the KERN-owned pre-seal streaming merge. Host-side
  post-hoc diagnostic sorting is forbidden.
- **[F4-R5 DECIDED]** F4 policy pins the exact F2 module, parser-fragment,
  composite, ledger, and policy identities used for local calls. Per-call F2
  ceilings are never raised, and aggregate evidence count, local-call count,
  decoded scalars, nodes, absolute spans, boundary entries, receipt scalars,
  and work steps have downward-only F4 ceilings shared with F2B-bound evidence.
- **[F4-R6 DECIDED]** Quoted-expression decoding emits one monotone `N+1`
  boundary tape mapping decoded Unicode-scalar boundaries back to absolute
  document boundaries. F2 node and diagnostic half-open spans are rebased only
  through that tape; constant-offset rebasing is forbidden when escapes or
  line continuations are present.
- **[F4-R7 DECIDED]** Policy validity requires
  `S_cap + 1 <= B_cap <= S_cap + L_cap`. The lower bound admits one successful
  maximal-scalar local expression; the upper bound rejects unreachable dead
  configuration. F4 checks a prospective successful local boundary total
  before materializing its complete boundary/evidence tape. The decoder
  recomputes `S_total` and `B` from authenticated evidence rows and rejects any
  mismatch with the aggregates embedded in the document terminal seal.

## Review-Blocker Amendment: C14 Canonical Diagnostics and Historical F4B `.2`

**Status:** IMPLEMENTED — ACCEPTANCE REVIEW PENDING

**Version note:** C14 and F4A document `.2` remain current. The F4B `.2`
identity/deploy portions below are historical evidence only and are superseded
by the F4B `.3` receipt and policy `.4` in F4-RP9/F4-RP11.

**Date:** 2026-08-20

**Confidence:** 0.98. The amendment implementation is source- and gate-evidenced;
the overall F4 programme remains implementation-in-progress because the wider
F4 acceptance surface is intentionally not promoted by this amendment.

### Implemented state and gate evidence

- **[VERIFIED]** F4A now builds four KERN-framed phase tapes, validates the
  closed code-aware phase/rule rank table, and performs the guarded four-head
  cursor merge before the terminal seal. The decoder preserves the resulting
  order and validates only five-field row shape, span, severity, and source
  monotonicity; it never sorts or repairs. Evidence:
  `examples/kern-frontend/f4-diagnostic-merge.kern:21-45,348-445`,
  `examples/kern-frontend/f4-declarations-main.kern:472-484`, and
  `scripts/kern-frontend-f4-declarations/decoder.mjs:185-191,270-319`.
- **[VERIFIED]** This historical `.2` identity amendment added same-length F4A
  formats, strict document `.2` identity validation before graph work, ordered
  identity framing including later-blocked inputs, decoder handoff comparison,
  and a nine-field seal. Its current `.3` successor preserves that identity
  rule in the 18-argument admission path and ten-field result contract:
  `scripts/kern-frontend-f4-declarations/module-set-worker.mjs:72-154`,
  `examples/kern-frontend/f4-module-set-main.kern:1-252`, and
  `scripts/kern-frontend-f4-declarations/module-set-decoder.mjs:137-215`.
- **[VERIFIED]** Recorded green acceptance evidence on 2026-08-20: focused
  blocker guards 2/2; C14 oracles 3/3; F4B identity/atomicity oracles 4/4;
  resource guards 3/3; expression-evidence guards 6/6; full F4/core build
  37/37; and an independent audit reported no blockers. The focused blocker
  probe is evidenced at `scripts/kern-frontend-f4-declarations/document.test.mjs:177-209`;
  C14 at `:146-175`; F4B at `module-set.test.mjs:101-202`; resource at
  `resource-limits.test.mjs:32-72`; and expression evidence at
  `expression-evidence.test.mjs:33-147`.

### Producer and consumer contract chain

| Hop | Current responsibility and evidence | Required `.2` amendment | Tag |
|---|---|---|---|
| F4A host worker | Builds 97 runtime arguments, executes `classifyf4document`, and sends returned fields to the document decoder: `scripts/kern-frontend-f4-declarations/worker.mjs:323-393`. | Carry no host ordering decision; pass the KERN-produced diagnostic tape unchanged to decode/seal validation. | **VERIFIED** |
| F4A KERN producer | Builds four guarded phase tapes and merges them before `f4terminal(...)`: `examples/kern-frontend/f4-diagnostic-merge.kern:21-45,348-445`, `examples/kern-frontend/f4-declarations-main.kern:472-484`. | KERN owns order and the independent status latch. | **IMPLEMENTED — VERIFIED** |
| F4A decoder consumer | Decodes strict five-field rows, validates shape/span/severity and source monotonicity, and does not sort: `scripts/kern-frontend-f4-declarations/decoder.mjs:185-191,270-319`. | Consumes the sealed KERN order unchanged. | **IMPLEMENTED — VERIFIED** |
| F4A tests | Canonical-order, isolated-recovery, phase-key, rank, and scaling oracles: `scripts/kern-frontend-f4-declarations/document.test.mjs:146-209`. | Supplies the C14 acceptance evidence. | **IMPLEMENTED — VERIFIED** |
| Historical F4B `.2` host worker | Transported same-length format/status/seal identity inputs: `scripts/kern-frontend-f4-declarations/module-set-worker.mjs:57-101`. | Preserved ordered `{moduleId,format,status,seal}` handoff. | **IMPLEMENTED — VERIFIED** |
| Historical F4B `.2` KERN producer | Rejected non-document `.2` formats before graph work and emitted nine fields with every identity: `examples/kern-frontend/f4-module-set-main.kern:68-95,304-315`. | Preserved atomic fatal behavior. | **IMPLEMENTED — VERIFIED** |
| Historical F4B `.2` decoder consumer | Decoded nine `.2` fields, exact-compared ordered identities, and sealed all fields: `scripts/kern-frontend-f4-declarations/module-set-decoder.mjs:19-83`. | Did not claim F4A seal authentication. | **IMPLEMENTED — VERIFIED** |
| Historical F4B `.2` tests and downstream client | `.2` skew, identity, blocked-seal, and atomicity oracles: `scripts/kern-frontend-f4-declarations/module-set.test.mjs:101-202`. | Supplied F4B acceptance evidence. | **IMPLEMENTED — VERIFIED** |

### Decided behavior and resource boundary

- **[IMPLEMENTED — VERIFIED]** F4-C14 now uses KERN-owned canonical construction
  before the document seal and an independent precedence latch; host sorting is
  prohibited by F4-C14 and F4-R4. Evidence:
  `examples/kern-frontend/f4-diagnostic-merge.kern:348-445` and
  `examples/kern-frontend/f4-declarations-main.kern:466-484`.
- **[IMPLEMENTED — VERIFIED]** The property, expression, decorator, and root
  phase tapes are merged by four advancing framed cursors in `O(D + row-bytes)`
  without a generic sort or source buckets. Evidence:
  `examples/kern-frontend/f4-diagnostic-merge.kern:348-445` and
  `scripts/kern-frontend-f4-declarations/document.test.mjs:146-209`.
- **[IMPLEMENTED — VERIFIED]** Diagnostic rows remain the strict
  five-field `.2` shape. The KERN-private phase/rule ranks are those frozen in
  F4-C14; no `orderKey`, phase-emission ordinal, `.3` document format, or
  deduplication exists. A direct framed-cursor four-head merge consumes each
  scalar once, compares heads, and appends one output row. It prospectively
  enforces `maxDiagnostics` and `maxEncodedBytes` at phase append, then charges
  every consumed framed scalar, head comparison, and output append incrementally
  against the existing `maxWorkSteps`; no new policy cap is required. The
  admissible resource simplex is the conjunction of those existing ceilings.
  Evidence: `scripts/kern-frontend-f4-declarations/policy.json:119,128-137`,
  `examples/kern-frontend/f4-diagnostic-merge.kern:47-102,348-445`, and
  `examples/kern-frontend/f4-declarations-main.kern:472-484`.
- **[IMPLEMENTED — VERIFIED | HISTORICAL `.2` BASELINE]** F4B accepted the
  format input and included the complete ordered framed identity commitment from
  F4-C21, including later-blocked modules. The commitment was to
  the trusted handoff bytes only, not a proof that a seal names a real F4A
  receipt. Evidence: `scripts/kern-frontend-f4-declarations/module-set-worker.mjs:57-101`
  and `examples/kern-frontend/f4-module-set-main.kern:41-95`.
- **[IMPLEMENTED — VERIFIED]** F4A and F4B fatal results remain structurally
  atomic, with no invented blocker-seal semantics. Evidence:
  `scripts/kern-frontend-f4-declarations/decoder.mjs:315-319`,
  `scripts/kern-frontend-f4-declarations/module-set-decoder.mjs:56-61`,
  `scripts/kern-frontend-f4-declarations/document.test.mjs:244-250`, and
  `scripts/kern-frontend-f4-declarations/module-set.test.mjs:199-202`.

### Acceptance criteria

The following are required discriminating fixtures. They specify observable
contracts and the decided KERN merge invariants, not a host ordering algorithm.

- **[F4-A12 IMPLEMENTED | VERIFIED]** A precedence-versus-position fixture emits
  an earlier recoverable diagnostic and a later module-blocking condition. Its
  sealed diagnostic tape is source-position canonical while status is rejected.
  Evidence:
  `scripts/kern-frontend-f4-declarations/document.test.mjs:146-156`.
- **[F4-A13 IMPLEMENTED | VERIFIED]** An injected equal or decreasing
  intra-phase `(startScalar, phaseRank, ruleRank)` key is rejected with
  `F4_AUTHORITY_DRIFT` before an ordinary receipt is sealed. This proves the
  required strict phase-local guard and the no-dedup rule. The code-aware
  rank probe accepts each frozen property rank and rejects mismatched pairs.
  Evidence: `scripts/kern-frontend-f4-declarations/document.test.mjs:165-209`
  and `examples/kern-frontend/f4-diagnostic-merge.kern:21-45,331-346`.
- **[F4-A14 IMPLEMENTED | VERIFIED]** `@trace\nmodule name=app\n` is a classified,
  recoverable dropped-decorator receipt with exactly one `DROPPED_DECORATOR`, no
  facts, and no interface suppression. Evidence:
  `scripts/kern-frontend-f4-declarations/document.test.mjs:158-163`.
- **[F4-A15 IMPLEMENTED | VERIFIED]** A mixed F4A `.1`/`.2` identity set, or any
  identity not naming `kern.frontend.f4-document.2`, returns atomic F4B
  `F4_INVALID_REQUEST` before graph work. Evidence:
  `scripts/kern-frontend-f4-declarations/module-set.test.mjs:107-115`.
- **[F4-A16 IMPLEMENTED | VERIFIED | HISTORICAL `.2` ORACLE]** Reordering two
  valid identities changed the ordered ninth-field F4B `.2` commitment and its
  outer SHA-256 receipt
  seal, or is rejected on positional mismatch; it cannot silently preserve a
  set result. Evidence: `scripts/kern-frontend-f4-declarations/module-set.test.mjs:101-105,118-131`.
- **[F4-A17 IMPLEMENTED | VERIFIED | HISTORICAL `.2` ORACLE]** Changing the
  supplied valid-shaped seal of an identity for a later-blocked module changed
  the sealed `.2` identity
  commitment. This is a commitment oracle, not an authentication oracle: F4B
  must not claim it recomputed that F4A seal. The F4B decoder exact-compares the
  commitment against the actual F4A receipt handoff. Evidence:
  `scripts/kern-frontend-f4-declarations/module-set.test.mjs:134-147` and
  `scripts/kern-frontend-f4-declarations/module-set-decoder.mjs:64-83`.
- **[F4-A18 IMPLEMENTED | VERIFIED]** A forced late failure returns the current atomic
  fatal F4A/F4B shapes with no ordinary success partitions. Evidence:
  `scripts/kern-frontend-f4-declarations/document.test.mjs:244-250` and
  `scripts/kern-frontend-f4-declarations/module-set.test.mjs:199-202`.

### Historical `.2` deploy order and skew behavior

- **[IMPLEMENTED — VERIFIED | HISTORICAL `.2` BASELINE]** F4A and F4B were
  strict `.2` formats, with the policy pinning both identities. The current
  deployment contract is F4A `.2`, F4B `.3`, and policy `.4` under F4-RP11.
  Historical evidence:
  `scripts/kern-frontend-f4-declarations/policy.json:2-5`,
  `scripts/kern-frontend-f4-declarations/decoder.mjs:270-275`, and
  `scripts/kern-frontend-f4-declarations/module-set-decoder.mjs:19-24`.
- **[DECIDED | IMPLEMENTED — VERIFIED | HISTORICAL `.2` BASELINE]** Worker,
  KERN producer, decoder, policy, and tests activated atomically. The historical
  F4B `.2` path fail-stopped on `.1` or mixed inputs before graph work. The
  current no-skew `.2`/`.3` fence is F4-RP11; archival `.1` decoding is read-only
  and outside linking. Historical evidence:
  `examples/kern-frontend/f4-module-set-main.kern:68-95` and
  `scripts/kern-frontend-f4-declarations/module-set.test.mjs:107-115`.

### Blast radius

| File / contract | Implemented action | Tag |
|---|---|---|
| `examples/kern-frontend/f4-declarations-main.kern` and bounded KERN helper | Four monotone phase tapes, guarded four-head merge, and independent precedence latch. | **IMPLEMENTED — VERIFIED** |
| `scripts/kern-frontend-f4-declarations/worker.mjs`, `decoder.mjs`, and `document.test.mjs` | Preserve KERN order, validate five-field structural/source monotonicity, and provide C14/recovery fixtures. | **IMPLEMENTED — VERIFIED** |
| `examples/kern-frontend/f4-module-set-main.kern` | Historical same-length formats and ninth-field F4B `.2` identity commitment before graph work, with atomic fatal output. | **IMPLEMENTED — VERIFIED** |
| `scripts/kern-frontend-f4-declarations/module-set-worker.mjs`, `module-set-decoder.mjs`, `module-set.test.mjs`, and `policy.json` | Historical `.2` transport/consumption exact-compared actual F4A identities and pinned identities/digests; F4-RP9/RP11 supersede it with `.3`/`.4`. | **IMPLEMENTED — VERIFIED** |
| F5/F6/F7 and public frontend/KIR contracts | No change: F4 remains internal-oracle and this amendment adds no KIR, public API, or blocker-seal payload semantics. | **VERIFIED** — `spec.md:150-152,219-220` |

### Out of scope

- **[VERIFIED]** This amendment does not change F0-F3 bytes, F2/F2B expression
  semantics, F5 KIR selection, or public frontend promotion. Evidence:
  `spec.md:150-163,214-220`.
- **[DECIDED target]** It does not add an F4B claim that
  received seals are cryptographically authenticated, does not invent a
  blocker-seal row grammar, and does not authorize a `.1` fallback.

### Corrections log

| Original claim | Reality | Impact |
|---|---|---|
| The current decorator test established C14 order. | It asserts later excluded-property output before a scalar-zero decorator diagnostic: `document.test.mjs:139-143`. | Replace it with source-order and isolated-recovery fixtures. |
| A KERN phase append is automatically canonical. | Four separate, individually source-monotone phase tapes make global append noncanonical: `f4-declarations-main.kern:197-330,357-369,416-439,466-479`. | C14 requires guarded four-head pre-seal KERN merge; no host sort or generic sort. |
| F4B can validate F4A receipt authenticity from IDs, statuses, and seals. | Current F4B receives only parallel status/seal arrays and no F4A fields: `module-set-worker.mjs:57-74`. | `.2` commits to trusted identity; it does not claim F4A authentication. |
| Existing blocked rows bind receipt identities. | They contain only `{moduleId,rejectedDependency}`: `module-set-decoder.mjs:29-32`. | Commit every input identity, including blocked modules, without inventing separate blocker-seal semantics. |
| A sixth opaque diagnostic `orderKey` and `kern.frontend.f4-document.3` are needed to prove C14. | Five-field rows already participate in the sealed fields, while F4B/F5 have no verified diagnostic-order consumer: `decoder.mjs:270-310`, `module-set-worker.mjs:57-74`, and `spec.md:249-252`. | Retain strict document `.2`; KERN keeps ranks/tie enforcement private and tests the invariant. |
| This amendment was READY TO BUILD and implementation had not begun. | The guarded C14 merge, strict code-aware rank validation, F4B `.2` identity commitment, and their focused acceptance tests are implemented: `f4-diagnostic-merge.kern:21-45,348-445`, `f4-module-set-main.kern:68-95,304-315`, `document.test.mjs:146-209`, `module-set.test.mjs:101-202`. | Mark the amendment IMPLEMENTED — ACCEPTANCE REVIEW PENDING while retaining the overall F4 implementation-in-progress status. |

## Path and Module-ID Amendment

**Status:** IMPLEMENTED — ACCEPTANCE REVIEW PENDING. The overall F4 programme remains
**DECIDED — IMPLEMENTATION IN PROGRESS**; this amendment does not promote the
unimplemented wider acceptance surface.

**Date:** 2026-08-20

**Confidence:** 0.98. The implementation is source-evidenced and the recorded
green gate is path 41/41 and full F4 82/82, with an independent audit reporting
no blocker. This status update does not rerun those gates and does not promote
unrelated F4-A7–F4-A10.

### Implemented state and recorded gate evidence

- **[IMPLEMENTED — VERIFIED]** Within an invoked F4A KERN handler, the portable
  `f4pathmoduleid(...)` runs before F4-internal prerequisite authentication and
  replay, then passes the validated directory to `f4pathbindings(...)`; invalid IDs produce `F4_INVALID_REQUEST`,
  and path-local failures produce the existing `invalid-import-path` fact.
  Evidence: `examples/kern-frontend/f4-declarations-main.kern:101-115,440-452`
  and `examples/kern-frontend/f4-path-contract.kern:1-42,145-231`.
- **[IMPLEMENTED — VERIFIED]** F4B preflights every external ID and transported
  binding target before maps, identity tape, partitions, or graph work.
  Evidence: `examples/kern-frontend/f4-module-set-main.kern:61-100`; the
  decoder rechecks returned IDs/targets at
  `scripts/kern-frontend-f4-declarations/module-set-decoder.mjs:25-58`.
- **[IMPLEMENTED — VERIFIED]** The F4 workers hash-pin and compose the shared
  portable path helper in both KERN entrypoints and transport the four policy
  limits without host normalization. Evidence:
  `scripts/kern-frontend-f4-declarations/worker.mjs:27-35,364-370` and
  `scripts/kern-frontend-f4-declarations/module-set-worker.mjs:8-26,64-104`.
- **[IMPLEMENTED — VERIFIED]** Recorded green evidence is path-contract 41/41,
  full F4 82/82, and an independent audit with no blocker. The focused path
  oracle covers invalid IDs, Unicode/control compatibility, invalid/relative
  specifiers, exact target lookup, transported-target mutation, duplicates,
  policy presence, and frozen F0 bytes:
  `scripts/kern-frontend-f4-declarations/path-contract.test.mjs:55-165`.

### Frozen contract

- **[VERIFIED]** The downstream canonical module-ID predicate is exactly
  `normalizeModuleId` in
  `packages/core/src/kir-structural/module-path.ts:8-25`: a module ID is a
  nonempty string ending in `.kern`, is not absolute, contains no backslash,
  colon, `//`, or trailing slash, and has no empty, `.` or `..` slash segment.
  It preserves existing well-formed Unicode bytes/scalars. It does **not** add
  a final-basename rule, control-character rule, or Unicode normalization rule.
- **[IMPLEMENTED — VERIFIED]** F4A treats that predicate as a request precondition and
  KERN validates it before any keyed/sealed structure, `R`, tape, fact, or
  ordinary semantic sibling is constructed. An invalid ID returns the existing
  atomic `F4_INVALID_REQUEST` shape. F4B independently applies the same
  predicate to every supplied module ID and every transported canonical binding
  target before keyed/sealed structures or graph work. An invalid or duplicate
  ID, or impossible invalid transported target, likewise returns atomic
  `F4_INVALID_REQUEST`, with no `R`, tape, fact, blocked partition, or partial
  sibling. Duplicate means duplicate canonical input spelling; there is no host
  normalization or alias collapse.
- **[IMPLEMENTED — VERIFIED]** A `use` source specifier is a source spelling, not an
  external module ID. It must begin with explicit `./` or one-or-more leading
  `../` segments, then have a nonempty tail. It must not contain a backslash,
  colon, absolute prefix, trailing slash, `//`, or an interior `.` or `..`
  segment. Existing well-formed Unicode is preserved without normalization.
  The optional `.kern` source spelling remains valid because frozen F0 source
  uses extensionless `./lib/symbols`
  (`scripts/kern-frontend-closure/static-goldens.json:13`).
- **[IMPLEMENTED — VERIFIED]** KERN resolves the source specifier lexically: start with
  the importer directory, pop one directory for each leading `../`, append the
  remaining tail, and append `.kern` exactly once iff that candidate does not
  already end in `.kern`. A pop above the closed-set root emits the existing
  `invalid-import-path` structural fact, whose current precedent is
  `packages/core/src/kir-structural/node.ts:85-107`. F4 does no filesystem,
  realpath, exact-then-fallback, or extension-probe resolution.
- **[IMPLEMENTED — VERIFIED]** For a syntactically invalid source specifier or a root
  escape, F4A rejects that document through the existing import-path failure
  vocabulary and clears its interface/binding output; it does not manufacture
  a canonical target. For a valid source specifier, F4A emits the resolved
  canonical target in the existing `binding.targetModuleId` field. F4B uses
  exact lookup only: a valid canonical target absent from the closed set is the
  existing nonfatal `missing-module` case, never `F4_INVALID_REQUEST`.
- **[IMPLEMENTED — VERIFIED | HISTORICAL F4B `.2` BASELINE]**
  `kern.frontend.f4-document.2` and the former
  `kern.frontend.f4-module-set.2` were shape-identical. F4-RP9/F4-RP11
  supersede the module-set receipt with `.3` under policy `.4`; this Path/ID
  amendment itself changes KERN acceptance and existing-field contents only. It
  serializes no new row, receipt field, error code, warning mode, or public
  release format.

### Producer and consumer chain

| Hop | Responsibility | Required target / evidence | Tag |
|---|---|---|---|
| F4A request host | Supplies `{moduleId, source}` and the authenticated F1/F2B/F3 arguments. | Preserves source and ID bytes; does not normalize. Evidence: `scripts/kern-frontend-f4-declarations/worker.mjs:208-216,324-396`. | **IMPLEMENTED — VERIFIED** |
| F4A KERN | Validates ID first; classifies and lexically resolves `use`; writes canonical target into the existing binding row; rejects invalid specifier/root escape and clears interface. | Evidence: `examples/kern-frontend/f4-declarations-main.kern:101-115,440-452`, `examples/kern-frontend/f4-path-contract.kern:1-231`. | **IMPLEMENTED — VERIFIED** |
| F4A decoder | Validates the returned binding target under the exact predicate and preserves ordinary atomic/rejected shapes. | Evidence: `scripts/kern-frontend-f4-declarations/decoder.mjs:183-190,278-330`. | **IMPLEMENTED — VERIFIED** |
| F4A policy and tests | Transports downward-only ID/specifier scalar/segment ceilings and proves F4A request/path boundaries. | Evidence: `policy.json:120-145`, `path-contract.test.mjs:55-165`. | **IMPLEMENTED — VERIFIED** |
| F4B host worker | Passes ordered F4A module IDs, formats/statuses/seals, symbols, and binding targets unchanged. | Evidence: `scripts/kern-frontend-f4-declarations/module-set-worker.mjs:27-83`. | **IMPLEMENTED — VERIFIED** |
| F4B KERN | Revalidates IDs/targets before maps, identity tape, seal, partitions, and graph work; exact-lookups only. | Evidence: `examples/kern-frontend/f4-module-set-main.kern:61-100,148-165`. | **IMPLEMENTED — VERIFIED** |
| F4B decoder and receipt | Validates returned IDs/targets and exact-compares the `.3` full identity commitment without normalizing or repairing. | Evidence: `scripts/kern-frontend-f4-declarations/module-set-decoder.mjs:137-215`. | **IMPLEMENTED — VERIFIED** |
| F4B tests / F5 consumer | Prove transport integrity and accepted exact targets; F5 consumes only sealed F4 interfaces and receives no new field. | Evidence: `path-contract.test.mjs:110-145`, `module-set.test.mjs:101-202`, and F4-C17. | **IMPLEMENTED — VERIFIED** |

### Precedence, resource, and seal rules

- **[IMPLEMENTED — VERIFIED]** ID request validation is first in F4A and F4B. In F4B it
  precedes F4A identity-format validation, identity-tape construction, module
  maps, `R`/`T` classification, and all graph facts. Transported binding-target
  validation precedes the same graph structures. Thus invalid transport cannot
  be reclassified as a link fact or a partially sealed receipt.
- **[IMPLEMENTED — VERIFIED]** Policy-owned, downward-only ceilings named
  `maxModuleIdScalars`, `maxModuleIdSegments`, `maxImportSpecifierScalars`, and
  `maxImportSpecifierSegments` to the F4A/F4B policy transport and validation.
  The contract intentionally freezes no arbitrary numeric defaults. KERN walks
  each relevant string once, incrementally charges every scalar and segment to
  the existing monotone work ledger, and prospectively rejects a ceiling breach
  before materializing its keyed/sealed result. Policy validation owns the
  configured safe values and any necessary relationship to existing envelope
  ceilings.
- **[IMPLEMENTED — VERIFIED]** Canonical IDs and canonical binding targets enter existing
  framed/sealed fields unchanged in format. F4A seals the rejected or successful
  document according to the existing terminal contract; current F4B `.3` binds
  its ordered `{moduleId,format,status,seal}` identity commitment on a full
  result and all ten fields under its outer SHA-256. No host rewrite, warning,
  recovery, or reseal makes an invalid value acceptable.

### Acceptance / RED matrix

| Oracle | Required discriminating result | Tag |
|---|---|---|
| Frozen compatibility | All frozen F0 and current F4 fixture IDs remain valid under the exact predicate; extensionless `./lib/symbols` resolves to `lib/symbols.kern`. | **IMPLEMENTED \| VERIFIED** — `path-contract.test.mjs:71-79,158-165`. |
| F4A invalid request IDs | Empty, no-suffix, absolute, backslash, colon, `//`, trailing slash, empty, `.`, or `..` segment ID each returns atomic `F4_INVALID_REQUEST` with no ordinary sections/facts/tapes. | **IMPLEMENTED \| VERIFIED** — `path-contract.test.mjs:17-25,55-68`. |
| F4B duplicate / transport mutation | A duplicate valid ID and a mutated invalid transported ID or binding target each fail atomically before identity tape, partitions, or graph work. | **IMPLEMENTED \| VERIFIED** — `path-contract.test.mjs:27-37,127-145`. |
| Source grammar | Bare, empty-tail, absolute, backslash, colon, trailing slash, doubled slash, interior-dot, and interior-dotdot source specifiers reject the document and clear interface; no canonical target is emitted. | **IMPLEMENTED \| VERIFIED** — `path-contract.test.mjs:81-95`. |
| Parent/root boundary | A valid leading `../` chain resolves by lexical pops; a root escape emits existing `invalid-import-path`, rejects the document, and clears interface. | **IMPLEMENTED \| VERIFIED** — `path-contract.test.mjs:81-107`. |
| Extension and lookup | `./x` resolves exactly to `x.kern`; `./x.kern` does not acquire a second suffix; a valid absent target emits only existing `missing-module`; no probe/fallback finds an alternative. | **IMPLEMENTED \| VERIFIED** — `path-contract.test.mjs:97-125`. |
| Receipt / skew | Validated canonical values leave `.2` field count and F4B identity commitment semantics unchanged; an invalid value never produces a compatible partial `.2` handoff. | **IMPLEMENTED \| VERIFIED** — `path-contract.test.mjs:27-37,127-145`; `.2` envelope evidence remains `module-set.test.mjs:101-202`. |
| Resource | Scalar/segment cap boundary fixtures show one-pass charging, a deterministic `F4_LIMIT`, and no keyed/sealed partial sibling on overflow. | **DECIDED target** — policy presence is verified at `path-contract.test.mjs:147-155`, but this matrix item still needs its own overflow boundary oracle. |

### Deployment, blast radius, and exclusions

- **[IMPLEMENTED — VERIFIED]** Worker, KERN F4A/F4B, decoder, policy, and their
  oracles as one atomic internal-oracle deployment. There is no supported skew:
  a producer/consumer mismatch fail-stops under the existing strict `.2`
  contracts rather than accepting legacy or normalized fallback data.
- **[IMPLEMENTED — VERIFIED]** F4B composes the policy-pinned
  `examples/kern-frontend/f4-module-set-f2-helpers.kern`, containing the small
  pure `f2uint`, `f2batchreadto`, and `f2batchmarked` helper subset required by
  its framed cursors. This helper is module-set-only; F4A retains the existing
  authenticated F2/F2B composition and F4B does not pull in the expression
  parser surface. Evidence: `f4-module-set-f2-helpers.kern:1-41`,
  `module-set-worker.mjs:8-26`, and `policy.json:106-112`.
- **[IMPLEMENTED — VERIFIED]** The implementation blast radius is limited to
  `examples/kern-frontend/f4-declarations-main.kern`,
  `examples/kern-frontend/f4-module-set-main.kern`, the F4 workers/decoders,
  `policy.json`, and focused F4 document/module-set/resource tests. F0 source,
  F1-F3/F2B receipts, F5-F7/public KIR contracts, filesystem access, and public
  release/migration behavior remain unchanged.
- **[VERIFIED]** `kir-seam-probe` ingress normalization is a test/probe adapter,
  not F4 production authority; it is outside this F4 amendment and is not
  deleted. The production authority cited by this amendment is
  `packages/core/src/kir-structural/module-path.ts:8-25`.

### Corrections log

| Rejected or corrected claim | Frozen conclusion | Impact |
|---|---|---|
| “Normalized POSIX ID” may omit `.kern`, allow a colon, or add NFC/control/final-basename restrictions. | The exact production predicate is only `normalizeModuleId` as cited above: `.kern` required; any colon rejected; no added final-basename, control, or normalization rule. | F4 clones that predicate exactly. |
| F4 should retain current exact-then-`.kern` fallback probing. | Source spelling is lexical: append once iff necessary, then exact lookup. | No probe or alternate-module discovery enters F4. |
| Probe ingress normalization is production ID authority and should be removed. | It is test/probe-only and outside this scope. | No probe deletion or source change. |
| The malformed tribunal run `w2h61m` supplied contract evidence. | It aborted malformed and is intentionally non-evidence. | Only tribunals `4ik05c` and `mkhx1n` inform this amendment. |
| Calling TypeScript `normalizeModuleId` directly is portable KERN implementation. | `normalizeModuleId` remains the exact behavioral authority; portable runtime uses the bounded KERN subset `f4pathmoduleid`/`f4pathresolve`, hash-pinned into both compositions. | The path 41/41 parity/oracle suite, rather than a host import, guards equivalence. |

## Request-Precedence Amendment: Single F4A State Transport

**Status:** IMPLEMENTED — ACCEPTANCE REVIEW PENDING. The overall F4 programme remains
**DECIDED — IMPLEMENTATION IN PROGRESS**. This amendment corrects a verified
host-ordering defect; it does not promote the still-open path/graph acceptance
surface.

**Version note:** References to policy `.3` in this amendment record the
then-current F4A 109-input ABI. F4-RP11 supersedes the current policy identity
with `.4`; F4A document `.2` and the carried-forward 109-input ABI remain
unchanged.

**Decision evidence:**
`~/.agon/runs/tribunal-1787255055837-yvvst6`

**Confidence:** 0.96. The single-invocation state-transport design is the
tribunal decision and is grounded in the current F4A worker/KERN boundary. The
wire-format conclusion is constrained by the current 17-field `.2` decoder and
is explicitly frozen below.

### Verified current defect

- **[VERIFIED]** The host currently calls `runF3Document(source)` before it
  enters `classifyf4document`:
  `scripts/kern-frontend-f4-declarations/worker.mjs:215-228`. F3 in turn runs
  F1 then F2B and throws when either has no expected accepted receipt:
  `scripts/kern-frontend-f3-line-tree/worker.mjs:117-125`. F4A KERN checks the
  module ID only after that host work has completed:
  `examples/kern-frontend/f4-declarations-main.kern:106-119`.
- **[VERIFIED]** Therefore an invalid module ID with empty source reaches the
  existing atomic `F4_INVALID_REQUEST` receipt, while the same invalid ID with
  an unclosed F1 expression or string fails at the F3 worker before F4A runs.
  This contradicts any temporal reading of “request first”; it does not
  contradict the current in-handler order.

### Decided F4A prerequisite envelope

- **[DECIDED]** F4A has exactly one KERN `classifyf4document` invocation for
  every well-formed host request, including a request whose expected F1, F2B,
  or F3 prerequisite rejects. It is request-verdict precedence, not temporal
  avoidance of prerequisite work: the host may perform prerequisite work before
  the invocation, but only KERN chooses the returned F4 verdict.
- **[DECIDED]** The private F4A input ABI carries three fixed-order envelopes,
  `F1`, `F2B`, then `F3`. Each has precisely one closed state:
  `available`, `failed`, or `not-attempted`. When `available`, its payload is
  the exact current authenticated transport for that prerequisite. When
  `failed` or `not-attempted`, every payload member for that prerequisite is
  canonical-empty: empty framed tape/string and empty arrays, never a partial
  receipt or a host error string.
- **[DECIDED]** `available` with a canonical empty payload is valid and distinct
  from `failed`/`not-attempted` with canonical empty payload. For example, a
  valid empty document has available F2B/F3 transports even when their
  collections are empty; KERN branches on the explicit state, never collection
  length.
- **[DECIDED]** The only legal producer state vectors are `AAA`, `FNN`, `AFN`,
  and `AAF`, where `A=available`, `F=failed`, and `N=not-attempted` in fixed
  F1→F2B→F3 order. `AAA` is the successful prerequisite pipeline; each other
  legal vector represents exactly the first expected upstream rejection and
  the mechanically unexecuted suffix. Every other vector—including an `N`
  before the first `F`, multiple `F` states, or an `A` after `F`/`N`—is
  `F4_INVALID_REQUEST` before authority, replay, or semantic work.
- **[DECIDED]** The host mechanically follows the pinned pipeline order. It
  records the first expected upstream rejection as `failed`, records every later
  prerequisite as `not-attempted`, and invokes F4A once. It does not classify
  upstream error text, create a fourth state, normalize an ID, alter payloads,
  or retry a prerequisite. Infrastructure, runtime-envelope, policy-loading,
  and ill-formed-host-request exceptions remain exceptions outside this F4A
  state protocol.
- **[DECIDED]** KERN alone maps a runtime-admitted, typed envelope state to an
  existing F4 code. An invalid state spelling, state/payload mismatch,
  non-empty unavailable payload, or malformed available payload is
  `F4_INVALID_REQUEST`. After authority authentication, the sole legal failed
  stage or an authentication failure of an available F1/F2B/F3 transport maps,
  respectively, to `F4_F1_DRIFT`, `F4_F2B_DRIFT`, or `F4_F3_DRIFT`. No new
  diagnostic vocabulary is introduced, and a non-available state performs zero
  semantic classification/replay.

### Exact private ABI and canonical empties

- **[DECIDED | HISTORICAL `.3` POLICY BASELINE]** `classifyf4document` has
  exactly **109** inputs under the `.3` policy baseline: the existing 103
  inputs, then three fixed-order state strings, then
  `f4MaxSourceScalars`, `f4MaxRecords`, and `f4MaxLogicalLines`. These are
  F4-owned admission controls, not receipt fields, and are explicitly distinct
  from the existing F3-replay `maxRecords` and `maxLogicalLines` within the
  103-input baseline. A runtime-admitted, typed, malformed **well-arity 109**
  value envelope (including an invalid state/payload or changed semantic
  argument order) is an atomic `F4_INVALID_REQUEST`. A wrong outer value or
  list-element type at any 109 slot, an actual 103-, 108-, or 110-input call,
  or a policy/composition identity skew is rejected by the host/runtime
  envelope boundary and produces no F4 receipt.

| Input group | Fields / count | Canonical value when its state is `failed` or `not-attempted` |
|---|---|---|
| Existing non-prerequisite inputs | Module/source, authority, F4 controls, and existing policy inputs: **61**, including the existing F3-replay `maxRecords`/`maxLogicalLines` | Not conditional; retain their existing exact values. |
| F1 transport | `recordKinds`, `recordFlags`, `recordStarts`, `recordEnds` (**4 arrays**) and `f1RecordTape` (**1 string**) = **5** | `[]`, `[]`, `[]`, `[]`, `''` respectively. |
| F2B transport | Six geometry arrays (`segmentFirstRecords`, `segmentLastRecords`, `segmentOuterStarts`, `segmentOuterEnds`, `segmentBodyStarts`, `segmentBodyEnds`), three sidecar string arrays (`segmentBodies`, `segmentBodyDigests`, `segmentRecordDigests`), and `f2bExpectedFields` = **10** | Every field is exactly `[]`. |
| F3 transport | `f3ExpectedFields`; eleven line arrays; four edge arrays; four decorator arrays; seven raw-block arrays = **27** | Every field is exactly `[]`. |
| State tags | `f1State`, `f2bState`, `f3State` = **3 strings** | The legal vector determines their exact strings; no missing, null, or alias spelling. |
| New F4 admission limits | `f4MaxSourceScalars`, `f4MaxRecords`, `f4MaxLogicalLines` = **3 numbers** | Not conditional; exact policy-constrained scalar values, distinct from F3 replay limits. |
| **Total** | **61 + 5 + 10 + 27 + 3 + 3 = 109** | — |

- **[DECIDED]** An `available` group is the exact current transport and is
  validated under its existing stage contract; a valid empty collection remains
  `[]`. Canonical emptiness is an exact value rule, not a length heuristic:
  only unavailable F1 uses `''` for its framed `f1RecordTape`; all unavailable
  F2B/F3 members are `[]`. A supplied non-empty unavailable member, an
  unavailable string other than `''`, or an otherwise typed but malformed
  available member is request-invalid and cannot be reinterpreted as a
  prerequisite drift. A missing or wrong-typed member instead fails at the
  outer runtime envelope with no F4 receipt.

### Exact precedence and receipt boundary

- **[DECIDED]** The F4A ladder is: (1) request shape, canonical module ID,
  private 109-input ABI, and legal envelope vector; (2) request-level limits;
  (3) authority identity; (4) F1
  state/authentication; (5) F2B state/authentication; (6) F3
  state/authentication; (7) declaration/property/attachment/decorator/module
  semantics; (8) aggregate/output limits; (9) terminal seal; (10) test-only
  forced late failure. Invalid request and request-level limits always dominate
  prerequisite state, including every legal unavailable state. Authority
  identity always dominates an otherwise legal `FNN`, `AFN`, or `AAF` vector;
  the one legal failed stage then wins over semantic-limit and late-failure
  outcomes.
- **[DECIDED]** The host sends no upstream error text, reason code, opaque
  digest, or retry history in a seal-bearing F4 field. The existing receipt
  binds the KERN-selected status and winning existing diagnostic. Thus two
  different host exception texts cannot alter a valid F4 receipt; expected
  upstream rejections are represented only by the closed input state and the
  KERN-selected drift code.
- **[DECIDED]** `kern.frontend.f4-document.2` remains the document format
  because its 17 output fields, terminal grammar, fatal shape, and downstream
  decoder contract remain byte-identical; the envelope is a private invocation
  input and introduces no receipt row or field. The F4B `.2` statement is
  historical: F4-RP11 supersedes it with F4B `.3`, which continues to consume
  the same F4A `{moduleId, format, status, seal}` identity. This amendment
  originally required `kern.frontend.f4-declarations-policy.3`; current policy
  `.4` carries forward that ABI, canonical-empty representation, and the pinned
  policy/composition identities. A wire change to the document receipt instead
  requires a document-format revision and is outside this decided path.
- **[DECIDED]** A caller may cache an F4A `.2` receipt only under a key that
  includes the ordinary document request identity, all three private envelope
  states, and the current `.4` policy identity (formerly `.3`). The receipt by
  itself proves neither
  which prerequisite vector was supplied nor which policy ABI admitted it.

### Producer / consumer chain and implementation boundary

| Hop | Decided responsibility | Evidence / target | Tag |
|---|---|---|---|
| F1, F2B, F3 host workers | Execute only while prior expected prerequisite state is accepted; preserve their ordinary receipts or first expected rejection. | Current chaining/throw seam: `f3-line-tree/worker.mjs:117-125`; replace throw-to-F4 loss with envelope transport. | **DECIDED** |
| F4A host worker | Constructs only the three fixed state tags and canonical-empty unavailable payloads; invokes KERN once; never maps a failure to an F4 code. | Current early F3 call: `f4-declarations/worker.mjs:215-228`; private ABI/worker target. | **DECIDED** |
| F4A KERN | Applies the ladder, independently authenticates available payloads, selects existing drift code, and returns atomic fatal before semantic work when required. | Current in-handler request check and replay seam: `f4-declarations-main.kern:106-138`. | **DECIDED** |
| F4A decoder | Keeps `.2` output shape and validates atomic existing fatal codes; it never reads host failure text or reconstructs a state. | Current fixed-shape/fatal contract: `decoder.mjs:278-346`. | **DECIDED** |
| F4B worker/KERN/decoder and F5 | Consume unchanged F4A `.2` identities/receipts; no new state reaches the graph or KIR boundary. | F4-C17/C21 and `module-set-worker.mjs:56-104`. | **DECIDED** |
| Policy and lockstep tests | Historical `.3` pinning established the 109-input value ABI, canonical empties, host/runtime arity boundary, worker/KERN agreement, and browser/Python lockstep; current policy `.4` carries it forward. | Current policy guard: `f4-declarations/worker.mjs:36-64`; F4-RP11. | **DECIDED** |

### Acceptance / RED matrix

| Oracle | Required observable result | Tag |
|---|---|---|
| Invalid-ID dominance | Invalid ID with each legal failed vector `FNN`, `AFN`, and `AAF` returns exactly one atomic `F4_INVALID_REQUEST`; no semantic section is present. | **DECIDED** |
| Request-limit dominance | Valid ID plus request-level-limit overflow and each legal failed vector `FNN`, `AFN`, and `AAF` returns exactly `F4_LIMIT`. | **DECIDED** |
| Authority dominance | An authority mutation with each otherwise legal unavailable vector `FNN`, `AFN`, and `AAF` returns exactly `F4_AUTHORITY_DRIFT`, never an F1/F2B/F3 drift, and does no replay/semantic work. | **DECIDED** |
| State-to-code / no semantic work | Valid `FNN`, `AFN`, and `AAF` requests return, respectively, the existing F1/F2B/F3 drift code, one fatal diagnostic, empty ordinary sections, and work no greater than the fixed admission budget. | **DECIDED** |
| Empty-state discrimination | An available empty F2B/F3 transport in `AAA` and the corresponding canonical-empty failed F2B/F3 group in `AFN`/`AAF` yield distinct status/diagnostic/seal outcomes. | **DECIDED** |
| Single invocation | A mixed valid, request-limit, and prerequisite-state matrix increments the F4A KERN entrypoint exactly once per request, with no retry or preflight invocation. | **DECIDED** |
| Stop-after-first failure | F1 failure yields F2B/F3 `not-attempted`; F2B failure yields F3 `not-attempted`; later executors do not run. | **DECIDED** |
| Legal-vector admission | Only `AAA`, `FNN`, `AFN`, and `AAF` reach authority; every other state vector, including `N` first or multiple `F`, returns `F4_INVALID_REQUEST` before authority/replay/semantics. | **DECIDED** |
| Envelope abuse / per-stage tamper | A runtime-admitted non-empty unavailable payload, malformed available transport, unknown state, or altered fixed order is `F4_INVALID_REQUEST`; a missing/wrong-typed outer member is a no-receipt runtime-envelope rejection. A same-shape tamper of available F1, F2B, or F3 instead returns its corresponding `F4_F1_DRIFT`, `F4_F2B_DRIFT`, or `F4_F3_DRIFT`. | **DECIDED** |
| Producer spy / no-later executor | A host spy proves the legal `FNN` and `AFN` producer vectors, with no F2B/F3 call after F1 failure and no F3 call after F2B failure; exactly one F4A invocation still occurs. | **DECIDED** |
| ABI / policy-skew boundary | A runtime-admitted typed but malformed well-arity 109-input value envelope (including changed semantic argument order) returns atomic `F4_INVALID_REQUEST`. Wrong outer/list-element types at 109 inputs, actual 103-, 108-, or 110-input calls, historical `.2` policy, or policy/composition hash mismatch are host/runtime envelope rejections with no F4 receipt. A matching current `.4` 109-input caller preserves byte-identical document `.2` output. | **DECIDED** |
| Cache-key scope | Reusing a receipt across distinct legal state vectors or policy identities is rejected by a caller-cache mutation oracle; a cache key containing request identity, all three state tags, and current policy `.4` identity (formerly `.3`) keeps those entries disjoint. | **DECIDED** |
| Text non-attribution / exceptions | Distinct expected-rejection texts never enter a receipt; Node, browser portable runtime, and Python twin produce identical F4 status, diagnostic, and seal for every legal state vector. An infrastructure/runtime/policy-loading/ill-formed-host-request exception produces no F4 receipt. | **DECIDED** |

### Corrections and scope

| Corrected claim | Verified reality / decided correction |
|---|---|
| “F4A request validation occurs before prerequisite processing.” | Current KERN validates first only after the host has already called F3. The amended contract makes the returned F4 verdict request-first through state transport, not by claiming prerequisite work was temporally avoided. |
| Host-thrown expected F1/F2B/F3 rejection is an F4 receipt. | It currently is not. The amendment makes it an explicit, non-semantic state input and requires one F4A invocation. |
| A host failure reason can be sealed to explain an F4 drift. | No host error text/reason/digest is an F4 receipt input or seal field; KERN emits only the existing selected drift code. |
| This requires `f4-document.3`. | It does not on the decided path: only the private input ABI and policy identity change. Any output-wire alteration is explicitly out of scope and would require a format revision. |

## Work-Accounting Clarification: Current F4A Slice

**Status:** DECIDED — READY TO BUILD. The overall F4 programme remains
**DECIDED — IMPLEMENTATION IN PROGRESS**. This clarification corrects the
scope claimed for current accounting and isolates one independently shippable
single-replay repair.

**Version note:** This clarification's policy `.3` references record the
pre-resource-prefix F4A baseline. F4-RP11 supersedes the current policy identity
with `.4` while retaining the document `.2`, 109-input F4A ABI, and this
clarification's accounting scope.

**Decision evidence:**
`~/.agon/runs/tribunal-1787260061774-77fynl`

**Confidence:** 0.96.

### Verified boundary and decided current contract

- **[VERIFIED]** F4A authenticates authority and available F1/F2B/F3 inputs
  before semantic classification at `examples/kern-frontend/f4-declarations-main.kern:150-185`.
  The semantic helper initializes the sealed work counter at
  `examples/kern-frontend/f4-declarations-semantic.kern:106-116`; this is the
  post-authentication semantic/output ledger. Its present F2B/F3 replay at
  `:116-135` duplicates work already completed by the F4A entry path.
- **[DECIDED]** Current `maxWorkSteps` and sealed `.2` `workSteps` cover
  post-authentication F4 semantic and output work only. No current claim says
  a debit after replay bounds replay, nor does the receipt purport to publish a
  total invocation-cost counter.
- **[DECIDED]** Total F4A invocation cost is compositionally bounded, rather
  than aggregate-metered: F4-owned source, record, logical-line, and path caps
  admit the request; authenticated F2B batch and child-expression limits bound
  F2B replay; and authenticated F3 work limits bound F3 reconstruction. These
  are independent enforced caps, not contributions to sealed F4 `.2`
  `workSteps`.
- **[DECIDED]** The F4A root authenticates every available prerequisite exactly
  once. Once that root succeeds, `classifyf4available` receives a private
  preauthenticated path and must not repeat F2B, F3, authority, or path replay.
  This removes duplicate execution without changing which failure vocabulary or
  precedence the root selects.
- **[DECIDED | HISTORICAL `.3` POLICY BASELINE]** The private 109-input ABI,
  17-field `kern.frontend.f4-document.2` receipt, historical F4B `.2` handoff,
  and all output bytes remained unchanged when the root carried its
  authenticated `requestPath` directory and work result into the semantic
  helper rather than recomputing it. F4-RP11 subsequently advanced current
  policy to `.4` and F4B to `.3`, without changing this F4A accounting rule.
  This clarification neither adds an accounting field nor changes a sealed
  accounting formula. Cache identity is the full policy bytes/SHA-256 plus the
  pinned composition identity, never the policy format string alone.

### Target, visibility, and acceptance

| Hop | Current evidence / target | Tag |
|---|---|---|
| F4A KERN root | Root owns the sole authority/F1/F2B/F3 authentication before semantic dispatch: `f4-declarations-main.kern:150-185`. | **VERIFIED** |
| F4 semantic helper | Receive the root's authenticated path directory/work and remove the duplicate F2B/F3/authority/path replay at `f4-declarations-semantic.kern:107-138` only on the private preauthenticated call path; direct isolated helper testing, if retained, remains internal. | **DECIDED** |
| F4 worker/policy/decoder/F4B | Historical `.3` preserved the private 109 input positions, document `.2`, decoder shape, and F4B `{moduleId,format,status,seal}` handoff; current `.4`/F4B `.3` carry the applicable pieces forward. Cache/pin full policy bytes SHA-256 and composition identity rather than merely the format label: `worker.mjs:143-145,324-378`, `decoder.mjs:270-346`, `module-set-worker.mjs:57-104`; F4-RP11. | **DECIDED** |

| Oracle | Required discriminating result | Tag |
|---|---|---|
| Single replay | An instrumented available request proves exactly one **root** call each to `f4pathmoduleid`, `f4authoritydrift`, `f4f1drift`, `f4f2bdrift`, `structuref3document`, and `f4f3sidecartapes`, and zero corresponding semantic-helper calls. A discriminating mutation that restores any second semantic call fails this oracle. | **DECIDED** |
| Direct F4 cap / cap-1 | Scaled source, record, logical-line, and canonical-path fixtures succeed exactly at their F4 admission cap and return atomic `F4_LIMIT` at cap minus one, before semantic dispatch. | **DECIDED** |
| Prerequisite cap / cap-1 | A lowered F2B batch or child-expression cap and a lowered F3 replay cap each admit the exact boundary transport, while cap minus one invalidates the otherwise available transport and yields exactly `F4_F2B_DRIFT` or `F4_F3_DRIFT`, respectively, with no semantic dispatch. | **DECIDED** |
| Work-count visibility | A receipt's `workSteps` remains the post-auth semantic/output count and is never asserted to include prerequisite replay. The exact/cap-1 fixtures above prove the independent composite bounds rather than a fictional aggregate meter. | **DECIDED** |
| Wire and cache stability | The repair preserves a 109-input F4A invocation and byte-compatible 17-field document `.2`. Its original policy `.3` and F4B `.2` baseline are superseded by current policy `.4` and F4B `.3` in F4-RP11. A cache mutation of full policy bytes/SHA-256 or pinned composition identity must not reuse a receipt merely because the policy format string is unchanged. | **DECIDED** |

### Future work deliberately not required for this slice

- **[PROPOSED]** A unified caller-selected aggregate invocation budget is a
  separate versioned design. It requires authenticated upstream work evidence
  with a versioned receipt/ABI contract, a defined precedence rule for a late
  discovered drift, and new aggregate-cap oracles. It is not a current F4
  completion blocker and this slice must not emulate it with conservative
  precharge or post-replay debit.

### Corrections

| Rejected claim | Decided correction |
|---|---|
| Existing F4 `maxWorkSteps` bounds all deterministic replay from entry through output. | Current-slice scope is post-authentication semantic/output work; prerequisite replay is compositionally bounded by independently authenticated caps. |
| A fixed precharge or a debit after replay can supply a sound aggregate replay budget. | Precharge can mask later drift and post-replay debit cannot bound already-completed work; neither is adopted. |
| Eliminating duplicated semantic reauthentication needs a policy or receipt revision. | The preauthenticated internal call path changes no F4A `.2` shape or output bytes; F4-RP11 separately supersedes the historical `.3` policy/F4B `.2` baseline with `.4`/`.3`. |

## Resource-Prefix Admission Amendment: F4B `.3`

**Status:** IMPLEMENTED — ACCEPTANCE REVIEW PENDING. The overall F4 programme remains
**DECIDED — IMPLEMENTATION IN PROGRESS**; this amendment owns only F4B
resource admission and its sealed failure proof.

**Decision evidence:**
`~/.agon/runs/tribunal-1787262296936-jhatr1`

**Confidence:** 0.96 (initial 0.93). The tribunal required that an incomplete
prefix itself prove overflow; the chosen path therefore rejects every
under-cap, malformed, or nonminimal truncation instead of trusting a host
count.

### Verified boundary and root cause

- **[VERIFIED]** The implemented host preserves the complete request-order
  manifest, invokes F4A sequentially, constructs a complete interface block
  for each executed identity, and stops on the first completed resource
  crossing before one F4B invocation:
  `scripts/kern-frontend-f4-declarations/module-set-worker.mjs:72-154`.
- **[VERIFIED]** F4B `.3` retains exact positional F4A identity validation for
  full results, while a resource fatal deliberately exposes no identity tape
  and only compact non-consumable proof metadata:
  `scripts/kern-frontend-f4-declarations/module-set-decoder.mjs:137-215`.
- **[VERIFIED]** Current F4B accepts trusted F4A-decoded symbol/binding
  transport but receives only F4A `{moduleId, format, status, seal}` identity
  material, not all F4A receipt fields from which it could recompute those
  interfaces: `scripts/kern-frontend-f4-declarations/module-set-worker.mjs:42-79`.
  A prefix can therefore prove the cap from transported rows KERN counts; it
  cannot authenticate host extraction beyond the existing trusted transport
  boundary.

### Decided `.3` admission contract

- **[F4-RP1 DECIDED]** The private F4B `.3` ABI is exactly 18 arguments, in
  this order: `moduleIds`, `mode`, `resourceKind`, `f4aModuleIds`,
  `f4aFormats`, `f4aStatuses`, `f4aSeals`, `interfaceBlocks`, `maxModules`,
  `maxSymbols`, `maxBindings`, `maxWorkSteps`, `forceLateFailure`,
  `maxModuleIdScalars`, `maxModuleIdSegments`, `maxImportSpecifierScalars`,
  `maxImportSpecifierSegments`, and `maxEncodedBytes`. Policy `.4` adds exact
  `moduleSetPrivateAbi = {arity,argumentOrder,argumentTypes,modes,resourceKinds}`
  and pins the corresponding type vector
  `(string[],string,string,string[],string[],string[],string[],string[],number,number,number,number,boolean,number,number,number,number,number)`,
  this arity/name/order, `full|resource-prefix`, the three resource kinds,
  module-set `.3`, all result-format identities, and composition bytes.
- **[F4-RP2 DECIDED]** Every invocation carries the complete request-order
  `moduleIds` manifest. Before resource, path, or work limits, KERN performs a
  grammar-only canonical-ID pass over every entry and builds the duplicate Map;
  it must not reuse current `f4pathmoduleid` for this phase because that helper
  returns a limit before completing a grammar scan. An invalid or duplicate
  suffix ID is therefore atomic `F4_INVALID_REQUEST` even when an earlier
  prefix proves cardinality overflow. The grammar-only scan charges manifest
  work, but the `maxWorkSteps` verdict is deferred until the entire
  grammar/duplicate pass completes so invalid/duplicate still wins. Only then
  may scalar, segment, and work caps run; a module-ID path-cap breach is the
  non-proof atomic `F4_LIMIT` shape with an empty witness. These protocol
  precedence guarantees apply only after the outer runtime has admitted the
  18-argument envelope; an outer ABI/type/runtime-envelope rejection has no
  F4B receipt.
- **[F4-RP3 DECIDED]** The closed modes are exactly `full` with canonical-empty
  `resourceKind`, and `resource-prefix` with `resourceKind` exactly one of
  `maxModules`, `maxSymbols`, or `maxBindings`. There is no count-only proof,
  retry, fallback, host-selected status, host sort, source classification,
  graph result, or host semantic receipt. The host may validate complete public
  `{moduleId,source}` object shapes and monotonically count decoded F4A rows.
- **[F4-RP4 DECIDED]** `interfaceBlocks` has exactly one entry for each executed
  prefix identity. Every entry uses the existing scalar frame `i<len>:` and is
  exactly one nested two-field framed row `(symbolTape,bindingTape)`. Each
  `symbolTape` is an exhaustively cursor-consumed sequence of framed four-field
  rows `(moduleId,kind,name,exported)`; each `bindingTape` is an exhaustively
  cursor-consumed sequence of framed six-field rows
  `(moduleId,canonicalTarget,imported,local,requestedKind,reexport)`. Row
  `moduleId` must equal the positional F4A identity ID, `canonicalTarget` uses
  the existing canonical-ID predicate, and non-`classified` identities require
  both tapes empty. Trailing scalar data, an unterminated frame, a wrong field
  count, cross-owner row, or any nonempty rejected/fatal interface is
  `F4_INVALID_REQUEST`.
- **[F4-RP5 DECIDED]** In `full`, every F4A document executes once in request
  order, `k = moduleIds.length`, the identity arrays and `interfaceBlocks` all
  have exactly `k` entries, and KERN derives `S` and `B` from all complete
  blocks. A full-mode derived `S > maxSymbols` or `B > maxBindings` is
  `F4_INVALID_REQUEST`, never a retroactive resource proof. Only `full` may
  allocate graph state or produce a nonfatal graph result.
- **[F4-RP6 DECIDED]** In `resource-prefix`, `k` is the shared length of the
  four F4A identity arrays and `interfaceBlocks`, and each identity is exactly
  `moduleIds[0..k)` with document `.2` format, closed status vocabulary, and
  valid seal shape. `maxModules` requires `k = 0`, all five prefix arrays
  empty, and `moduleIds.length > maxModules`; the host runs zero F4A documents.
  `maxSymbols`/`maxBindings` require `0 < k <= moduleIds.length`; KERN derives
  counts from complete blocks, requires the final block to be the first
  completed crossing, and freezes `maxSymbols` before `maxBindings` when both
  first cross there. The worker stops immediately after that completed block,
  invokes F4B exactly once, and propagates infrastructure/runtime exceptions
  rather than manufacturing a receipt.
- **[F4-RP7 DECIDED]** A non-prefix identity, missing/extra block, malformed
  nested frame, nonminimal crossing, under-cap prefix, or resource kind
  inconsistent with KERN-derived counts is atomic `F4_INVALID_REQUEST`. Only
  F4-RP6's closed proof yields `F4_LIMIT`. KERN does not invent suffix
  identities or authenticate host extraction beyond the existing trusted
  F4A-decoded transport boundary.
- **[F4-RP8 DECIDED]** A valid resource-prefix proof returns atomic
  `F4_LIMIT` before graph allocation: field 2 is `fatal`; fields 3, 4, 6, 7,
  and 8 are empty; field 5 contains exactly one existing `F4_LIMIT` fact;
  field 9 is the non-consumable compact proof; and field 10 is the proof
  terminal. KERN validates prefix identities internally but field 8 remains
  empty: the witness binds KERN-selected counts, not identities. If the compact
  proof cannot fit `maxEncodedBytes`, KERN emits the non-proof atomic
  `F4_LIMIT` failure shape instead.

### Exact `.3` receipt, seal, byte accounting, and version fence

- **[F4-RP9 DECIDED]** F4B result format is exactly ten strings:

  1. `kern.frontend.f4-module-set.3` format;
  2. status;
  3. rejected tape;
  4. blocked tape;
  5. facts tape;
  6. components tape;
  7. bindings tape;
  8. `inputIdentityPrefixTape`;
  9. `resourcePrefixWitness`; and
  10. terminal.

  Field 8 contains the full identity tape only on an ordinary nonfatal `full`
  result; field 9 is then empty and field 10 is the `full` terminal. Field 8
  is empty on every fatal. Field 9 contains a witness only on a valid
  `resource-prefix` `F4_LIMIT`; it is exactly one framed eight-field row
  `(resource-prefix,kind,fullModuleCount,prefixCount,priorSymbols,priorBindings,crossingSymbols,crossingBindings)`.
  It never repeats a manifest or interface block. The ordinary `full` terminal
  is exactly
  `module-set:<status>:<moduleCount>:<rejectedCount>:<blockedCount>:<factCount>:<componentCount>:<bindingCount>:<identityTapeScalars>:0:full:closed`.
  The valid resource-proof terminal is exactly
  `module-set:fatal:<fullModuleCount>:0:0:1:0:0:0:<witnessScalars>:<kind>:closed`.
  Every other fatal has field 2 `fatal`, fields 3, 4, 6, 7, 8, and 9 empty,
  field 5 exactly one corresponding fatal fact, and field 10 literal `failure`.
  The receipt seal remains SHA-256 over all ten `.3` fields. The decoder exposes
  a fatal witness only as proof metadata and never exposes fatal modules or
  bindings to F5 or another downstream consumer. At the live worker/decoder
  boundary it reparses the exact sealed 18-argument input and recomputes the
  selected prefix before exposing that metadata. This local binding is not
  detached proof authentication and does not replace KERN's trusted F4A
  transport validation.
- **[F4-RP10 DECIDED]** `maxEncodedBytes` is prospectively enforced over the
  exact UTF-8 byte length of all ten returned strings for both ordinary full and
  fatal results, including the existing scalar framing characters inside those
  strings; it is not JSON length and not the outer runtime envelope. A full
  result that would exceed the cap becomes the non-proof atomic `F4_LIMIT`
  failure shape. Its only byte oracle is the public portable
  `Text.utf8Length` contract in F4-U8-1; authored surrogate/string comparison
  helpers are prohibited here. Policy `.4` requires
  `maxEncodedBytes >= utf8(minimalNonProofF4Limit10FieldReceipt)`, where that
  receipt has format `.3`, status `fatal`, empty fields 3, 4, 6–9, exactly one
  framed `F4_LIMIT` fact in field 5, and terminal `failure`; a policy one byte
  below that exact floor is rejected before invocation. The old
  `f4butf8bytes` at `examples/kern-frontend/f4-module-set-output.kern:1-18`
  and F4A `f4diagutf8bytes` at
  `examples/kern-frontend/f4-diagnostic-merge.kern:1-19` are not portable
  UTF-8 oracles: their authored string-range classification disagrees between
  JS UTF-16 and Python Unicode-scalar comparison for astral text. One atomic
  F4-U8 rollout replaces **both** uses with `Text.utf8Length`; neither helper
  may remain in the F4 composition.
- **[F4-RP11 DECIDED]** F4A remains byte-identical
  `kern.frontend.f4-document.2`. F4 policy advances `.3` to `.4` to pin the
  new F4B private input ABI, module-set `.3` result format, composition bytes,
  and acceptance limits. `.2` decoders reject `.3`; `.3` decoders reject `.2`;
  worker, KERN, decoder, policy, and tests deploy atomically with no supported
  skew. F4B `.3` continues to require F4A document `.2` identities on every
  supplied prefix row. Full results bind every supplied F4A identity; a
  resource fatal binds only the compact KERN-selected proof and does not claim
  omitted identities.

### Public portable UTF-8 primitive amendment

**Status:** IMPLEMENTED — ACCEPTANCE REVIEW PENDING. This additive core-language
candidate implements the F4-RP10 prerequisite and simultaneous F4A
diagnostic-byte repair; it does not claim any unrelated F4 byte helper is
repaired or promote the overall F4 programme.

**Decision evidence:**
`~/.agon/runs/brainstorm-1787268337122-4686bz` (winner:
public `Text.utf8Length`, with the boundary-validator and scalar-inspection
alternatives rejected for this slice).

**Confidence:** 0.97 (initial 0.94). The current core already maintains the
needed fail-closed Unicode scan and exact UTF-8 byte total in its
effect-machine text index, so this is a narrowly additive public lowering
rather than a new host-owned F4 semantic path:
`packages/core/src/ir/semantics/internal-text-code-point-cache.ts:33-55`.

- **[F4-U8-1 DECIDED]** `Text.utf8Length(value: string): number` is a public,
  deterministic, pure `Text` operation. For a well-formed KERN string it
  returns the exact RFC 3629 UTF-8 byte count of its Unicode scalar sequence:
  each scalar U+0000..U+007F contributes 1, U+0080..U+07FF 2,
  U+0800..U+FFFF 3, and U+10000..U+10FFFF 4. The empty string returns 0.
  These are scalar ranges, never JS UTF-16-unit or lexicographic string ranges;
  neither replacement-character substitution nor Unicode normalization is
  permitted. This extends the existing KERN Text code-point contract rather
  than changing `Text.length` or framing scalar lengths:
  `packages/core/src/codegen/text-contract.ts:16-45,64-87`.
- **[F4-U8-2 DECIDED]** The malformed-text domain and error policy are exactly
  the existing shared Text policy. A lone high or low surrogate, reversed pair,
  high-high, or low-low run fails closed before a count is returned; well-formed
  astral pairs are valid and contribute 4. The three legs must enforce the same
  malformed-surrogate **class and condition** as the existing Text operations;
  this amendment does not add a byte-identical diagnostic-message requirement
  where current runner and emitted-helper messages are not intentionally
  normalized. There is no platform encoder fallback, replacement, silent
  coercion, or target-specific malformed behavior:
  `packages/core/src/codegen/text-contract.ts:29-35,58-76,110-125`.
- **[F4-U8-3 DECIDED]** Admission is exactly an unshadowed
  `Text.utf8Length` call with one string receiver. Its public arity is one;
  wrong arity fails as `portable: Text.utf8Length expects exactly 1 argument`,
  a non-string receiver fails as `portable: Text.utf8Length requires a string`,
  and a user binding named `Text` shadows the builtin just as it does for the
  existing Text methods. Optional or non-namespace calls are not newly
  admitted. This extends the existing admission/arity gates rather than
  creating an F4-only or `KernInternal` escape hatch:
  `packages/core/src/ir/semantics/portable-string.ts:59-80,91-129` and
  `packages/core/src/ir/semantics/portable-machine-shape.ts:35-41,101-111`.
- **[F4-U8-4 DECIDED]** The one public contract must agree on all three legs.
  The ReferenceRunner/effect machine calls the existing validated text-index
  scan's `utf8Bytes` result; the emitted TypeScript helper makes the same
  explicit scalar walk over a well-formed UTF-16 string; and the emitted Python
  helper makes the same explicit `ord` range walk after the shared malformed
  fence. `Buffer.byteLength`, `TextEncoder`, and `str.encode` may be independent
  test oracles only, never the production semantic definition. The core target
  is the existing single-sourced helper/lowering chain:
  `packages/core/src/codegen/text-contract.ts:152-318`,
  `packages/core/src/codegen/kern-stdlib.ts:60-113`, and
  `packages/core/src/codegen/stdlib-preamble.ts:72-83,136-156,504-513`.
- **[F4-U8-5 DECIDED]** The implementation extends, without bypassing, each
  current admission leg: `STRING_OP_ARITY` and `evalStringOpCall` in
  `portable-string.ts`; `TEXT_ARITY` in `portable-machine-shape.ts`; the
  cached validated scan in `internal-text-code-point-cache.ts`; the `Text`
  stdlib table; the once-per-module TS `textOps` preamble detector; and Python's
  existing `text-ops` helper requirement. The scalar cache already computes
  `utf8Bytes` only after its malformed-surrogate checks, so the reference leg
  must expose that value rather than rescan, while the generated TS/Python
  helper blocks remain explicit semantic twins. This preserves deterministic
  O(number of UTF-16 units) work and existing cache ownership:
  `packages/core/src/ir/semantics/internal-text-code-point-cache.ts:33-55,93-124,185-231`.
- **[F4-U8-6 DECIDED]** The atomic F4 rollout changes both byte-accounting
  authorities: delete F4B `f4butf8bytes` and F4A `f4diagutf8bytes`; make F4B
  `f4bframebytes`, `f4btenbytes`, proof construction, and full-result
  accounting, plus F4A diagnostic framed-row accounting, call
  `Text.utf8Length` for every non-ASCII string. The F4A and F4B composition
  hashes must be regenerated in the same deployment.
  `i<len>:` framing remains exact as
  `2 + Text.length(String(scalarLength)) + Text.utf8Length(value)`, because
  its literal marker, decimal digits, and colon are ASCII; the final admission
  sums the exact ten returned strings, including empty fields. No worker or
  decoder calculates, sorts, repairs, or accepts a host-supplied byte count:
  `examples/kern-frontend/f4-module-set-output.kern:1-44,53-72,74-121` and
  `examples/kern-frontend/f4-diagnostic-merge.kern:1-19,76-90,413-425`.
- **[F4-U8-7 DECIDED]** This is an additive core-language minor release
  (`4.5.0` to `4.6.0`) and an atomic deployment prerequisite. It
  does not revise the F4A document `.2`, F4B module-set `.3` ten-field receipt,
  F4B 18-argument private ABI, F4 policy `.4` field layout, receipt seal
  framing, or decoder result shape. It corrects the *value* of sealed F4B byte
  admission for non-ASCII output, so both F4A/F4B compiled-composition hashes
  and relevant goldens must be regenerated together. The root `package.json`,
  `packages/core/package.json`, `packages/core/src/spec.ts` (`KERN_VERSION`),
  generated/version fixtures, and public Text docs/export catalog advance in
  that same core release. An old core must not be paired with F4 KERN that
  calls the new public method: worker, compiler, ReferenceRunner, TS, Python,
  policy composition, decoder, and tests deploy as one no-skew unit.
  Receipt-only caches remain keyed by the full policy and composition identities
  already required by F4-RP11, not merely its format.
- **[F4-U8-8 DECIDED]** The public primitive is intentionally narrower than
  `Text.scalarAt` and preserves the F4 `F4_LIMIT` selection in authored KERN;
  it is not a private boundary validator, an output-format migration, an input
  restriction to ASCII, a repair of unrelated F4 UTF-8 helpers, or a new F5
  consumable field. Core documentation and public exports must list the method
  with the rest of the Text surface, including the three-leg conformance
  promise: `packages/core/src/index.ts:195-207`.

| Producer / consumer hop | Required responsibility | Evidence / target | Tag |
|---|---|---|---|
| Core Text contract | Define scalar widths and the same malformed-surrogate class/condition; export public contract helpers. | Existing shared contract and exports: `text-contract.ts:16-45,58-125`, `index.ts:195-207`; F4-U8-1–2 target. | **VERIFIED / DECIDED** |
| ReferenceRunner and portable machine | Admit exact arity only for unshadowed `Text`; obtain the validated cached UTF-8 total. | `portable-string.ts:70-80,91-172`, `portable-machine-shape.ts:35-41,101-111`, `internal-text-code-point-cache.ts:33-55`; F4-U8-3–5 target. | **VERIFIED / DECIDED** |
| TS and Python codegen | Lower to one shared Text helper family and inject it once only when emitted code calls it. | `kern-stdlib.ts:60-113`, `text-contract.ts:152-318`, `stdlib-preamble.ts:136-156,504-513`; F4-U8-4–5 target. | **VERIFIED / DECIDED** |
| F4B KERN output | Use only `Text.utf8Length` for content bytes and preserve scalar framing math/ten-field receipt construction. | Candidate source: `f4-module-set-output.kern:1-44,53-121`; F4-U8-6 acceptance remains pending. | **IMPLEMENTED / VERIFIED** |
| F4B worker, policy, decoder, F5 | Keep receipt and public API shapes unchanged; atomically pin the newly compiled composition and reject unsupported deployment skew before a receipt is consumed. | Existing F4B version fence and consumer boundary: F4-RP11, `module-set-decoder.mjs:19-86`, `policy-validation.mjs:80-106`; F4-U8-7 target. | **VERIFIED / DECIDED** |

| Oracle | Required discriminating result | Tag |
|---|---|---|
| Scalar-width conformance | ReferenceRunner, emitted TS, and emitted Python agree that `""` is 0 and `U+007F/U+0080/U+07FF/U+0800/U+FFFF/U+10000/U+1F30D` have widths `1/2/2/3/3/4/4`; mixed `A¢€🌍` totals 10. | **DECIDED** |
| Malformed and admission fence | Lone high/low, reversed, high-high, and low-low inputs fail under the same malformed-surrogate class and condition on all three legs; wrong arity, non-string receiver, optional/non-namespace shape, and shadowed `Text` retain existing rejection/shadowing semantics. | **DECIDED** |
| Effect/cache and lowering | A repeated valid call uses the existing effect-machine text-index path; emitted TS and Python each contain the helper once when used and no text helper when unused. A mutation returning scalar length or a host encoder result as the production implementation fails cross-leg/structural evidence. | **DECIDED** |
| F4B astral byte boundary | With a result containing an astral scalar and framed rows, an independent host test oracle over the ten returned strings verifies exact-cap success and cap-minus-one non-proof atomic `F4_LIMIT`; a mutation back to `f4butf8bytes` fails on TS/Python parity or the byte boundary. | **DECIDED** |
| F4A diagnostic astral boundary | A recoverable diagnostic containing an astral scalar has its exact F4A byte cap accepted at N and fails atomically at N-1; a mutation back to `f4diagutf8bytes` fails this oracle or cross-leg parity. | **DECIDED** |
| F4B shape and migration | The fix preserves F4B `.3` ten strings, policy `.4` ABI/layout, F4A `.2`, decoder fields, seal coverage, and public arity; a stale core/composition identity is rejected before a receipt is accepted. | **DECIDED** |

### UTF-8 primitive acceptance gates

- **[F4-U8-A1 DECIDED]** Extend the existing Text runner, portable-machine,
  effect-machine-cache, stdlib-lowering, and TS/Python generated-runtime suites
  at `packages/core/tests/runner-string-ops.test.ts`,
  `packages/core/tests/portable-machine-evaluator.test.ts`,
  `packages/core/tests/runtime-envelope-effect-machine-text-cache.test.ts`,
  `packages/core/tests/native-handlers-stdlib.test.ts`, and
  `packages/core/tests/native-handlers-slice2.test.ts` with the F4-U8 oracle
  matrix before changing F4B production source.
- **[F4-U8-A2 DECIDED]** Extend the F4B resource-prefix/decoder tests with an
  independent UTF-8 byte oracle for all ten receipt strings, including the
  exact/cap-minus-one astral and framing cases, and a source-architecture
  assertion that F4B no longer contains the authored `f4butf8bytes` decision
  loop. The test oracle may use a platform encoder only outside production
  semantic code. Add the matching F4A diagnostic astral N/N-1 oracle and
  source-architecture assertion that `f4diagutf8bytes` no longer participates
  in the F4 composition.
- **[F4-U8-A3 DECIDED]** The core build/type gate and the focused Text and F4B
  suites must pass on ReferenceRunner, emitted TS, and emitted Python before an
  F4B `.3` policy/composition/golden regeneration is accepted. The downstream
  F4/F5 decoder gate must prove unchanged ten-field shape and fatal
  non-consumability after the corrected byte decision.

### Producer / consumer chain

| Hop | Responsibility | Evidence / decided target | Tag |
|---|---|---|---|
| F4B request host | Validate all public `{moduleId,source}` object shapes and preserve the complete request-order manifest before dispatch. At `maxModules` overflow execute zero F4A documents; otherwise execute F4A sequentially, construct one complete block per result, stop immediately after the first completed symbol-priority crossing, and call F4B once. Infrastructure/runtime exceptions propagate and make no F4B call. | Implemented sequential producer: `module-set-worker.mjs:72-154`; F4-RP1–6. | **IMPLEMENTED — VERIFIED** |
| F4A worker and decoder | Produce unchanged sealed document `.2` identities and their existing decoded symbol/binding transport for each executed prefix document. | `worker.mjs:279-280`, `decoder.mjs:278-321`; no F4A wire change. | **VERIFIED / DECIDED** |
| F4B KERN | Validate full IDs/duplicates first, validate the closed prefix proof, derive counts, and select only atomic `F4_INVALID_REQUEST` or `F4_LIMIT` before graph allocation. | Implemented admission path: `f4-module-set-main.kern:1-252`; F4-RP1–7. | **IMPLEMENTED — VERIFIED** |
| F4B decoder | Decode ten `.3` fields; exact-compare the full or prefix context as its mode permits; retain proof metadata only on fatal `F4_LIMIT`; reject all version/shape drift. | Implemented ten-field consumer: `module-set-decoder.mjs:137-215`; F4-RP8–9. | **IMPLEMENTED — VERIFIED** |
| Policy, tests, downstream F5 boundary | Pin policy `.4`/composition and fence `.2` versus `.3`; treat every fatal receipt, including one with proof metadata, as non-consumable. | Implemented policy fence: `policy-validation.mjs:114-195`; current F5 boundary: F4-C17 and `spec.md:201-203`. | **IMPLEMENTED — VERIFIED** |

### RED matrix

| Oracle | Required discriminating result | Tag |
|---|---|---|
| `maxModules + 1` | A complete valid unique manifest at one above cap runs **zero** F4A documents, invokes F4B exactly once with `k=0`, and returns sealed atomic `.3` `F4_LIMIT` with only the compact eight-field proof. | **DECIDED** |
| Zero-prefix below cap | `M <= maxModules` with `k=0` is not an overflow proof and returns atomic `F4_INVALID_REQUEST`. | **DECIDED** |
| Minimal symbol/binding prefix | Sequential complete F4A blocks stop at the first completed prefix crossing; KERN recomputes the count, selects symbols before bindings on a simultaneous first crossing, invokes F4B once, and emits no graph/artifact row. | **DECIDED** |
| Forged / nonminimal prefix | A skipped identity, wrong positional ID, missing/extra/incomplete block, under-cap prefix, later-than-first crossing, or mismatched kind returns atomic `F4_INVALID_REQUEST`, never `F4_LIMIT`. | **DECIDED** |
| Block grammar | A wrong nested field count, unframed/trailing scalar, cross-owner symbol/binding row, noncanonical target, or nonempty rejected/fatal block is atomic `F4_INVALID_REQUEST`. | **DECIDED** |
| Invalid suffix-ID dominance | At `M > maxModules`, and also behind an otherwise valid symbol/binding prefix, a later grammar-invalid or duplicate manifest ID returns atomic `F4_INVALID_REQUEST` after zero F4A suffix invocations. | **DECIDED** |
| ABI and mode fence | A 17- or 19-argument F4B `.3` call produces no receipt; a well-arity type-vector mismatch produces no receipt; a runtime-admitted well-arity call with an unknown/misplaced mode or resource kind returns atomic `F4_INVALID_REQUEST`. Policy `.4` ABI/composition skew is a host/runtime rejection with no receipt. | **DECIDED** |
| `.2` / `.3` fence | A `.2` module-set decoder rejects `.3`, a `.3` decoder rejects `.2`, while every prefix F4A identity remains strict document `.2`; no mixed result is decoded as a seal mismatch. | **DECIDED** |
| Full identity / witness fields | A nonfatal full result has field 8 equal to the complete ordered identity tape and field 9 empty. A valid resource proof has field 8 empty and the exact compact field-9 witness. | **DECIDED** |
| Proof versus non-proof fatal | A valid prefix proof has field 2 `fatal`, only the field-5 `F4_LIMIT` fact, empty fields 3, 4, 6–8, compact field 9, and a proof terminal. Invalid request, path/work/output-byte limit, and forced late failure each have field 2 `fatal`, exactly one corresponding field-5 fact, empty fields 3, 4, 6–9, and terminal `failure`. | **DECIDED** |
| Exact encoded bytes | The exact `maxEncodedBytes` boundary passes and one UTF-8 byte over, including an astral scalar and `i<len>:` framing bytes, converts a full result to non-proof atomic `F4_LIMIT` with the required field-5 fact and terminal `failure`. A policy one byte below the minimal non-proof-failure floor is rejected. | **DECIDED** |
| Manifest-scan work edge | A complete-manifest grammar/duplicate scan whose charged work crosses `maxWorkSteps` still returns a later invalid/duplicate ID as `F4_INVALID_REQUEST`; an otherwise valid manifest then returns non-proof `F4_LIMIT`. | **DECIDED** |
| Public atomicity and exceptions | Public `runModuleSet` exposes no prefix-control option; every resource fatal exposes empty modules/bindings/ordinary partitions and non-consumable proof metadata. A sequential producer infrastructure throw propagates with no F4B invocation and no receipt. | **DECIDED** |

### Explicitly deferred

- **[DECIDED]** This narrow slice does not solve C15 canonical `R`/`T`/link-fact
  ordering, lexicographically minimum blocked reasons, true SCC/component
  rows, or broader graph-output redesign. It does implement the `.3` total
  result-byte ceiling in F4-RP10. The deferred graph-output amendment addresses
  current rejected request order, repeated blocked scans, absent transported
  binding source positions, and per-module components at
  `examples/kern-frontend/f4-module-set-main.kern:282-328`.
- **[DECIDED]** The prefix witness is not an F4A authenticity proof, a new F4A
  receipt field, a host semantic receipt, a host sort, an F5 interface, or a
  public release format.

### Corrections

| Rejected claim | Decided correction |
|---|---|
| F4B `.2` can carry a partial identity tape and still bind every input F4A receipt. | It cannot: `.2` requires every identity and an empty fatal tape. `.3` explicitly distinguishes complete full identity from an overflow-only prefix proof. |
| A host count or stop index proves resource overflow. | KERN must derive the first crossing from complete framed prefix blocks; every other truncation is `F4_INVALID_REQUEST`. |
| A resource witness should repeat the manifest and transported interface blocks. | The `.3` witness is compact eight-field KERN-selected proof metadata; it echoes neither manifest nor blocks. |
| One colon terminal grammar applies to every `.3` result. | The ordinary full terminal and valid resource-proof terminal are distinct colon grammars; every non-proof fatal terminal is the literal `failure`. |
| Resource-prefix work also fixes canonical graph output. | It performs no graph work and deliberately defers C15/SCC/output-order defects. |

## Acceptance

- **[F4-A1 IMPLEMENTED | VERIFIED]** F3 produces identical
  geometry for `fn` and non-`fn` decorator targets and cannot emit the required
  F4 declaration/diagnostic rows. The exact equal-F3 `fn`/`type` witness and
  divergent KERN-owned F4 projection are pinned by
  `a1-a2-a11-evidence.test.mjs`.
- **[F4-A2 IMPLEMENTED | VERIFIED]** All 302 source node rows and all 1,149 property rows have
  direct full-table admission evidence; row deletion, reorder, duplicate,
  disposition drift, and same-length substitution reject. The exhaustive cyclic
  matrix invokes real F4 once per mutated row and retains structural loop canaries.
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
- **[F4-A11 IMPLEMENTED | VERIFIED]** Relational policy tests accept both valid endpoints and
  reject values immediately outside them. A safely scaled runtime pair passes
  immediately below the independent `B` ceiling and fails on the next local
  success while `S` and `L` remain valid. Decoder mutations that change sealed
  `S` or `B` without changing evidence reject. Zero, failed-local, F2B-origin,
  overflow, and independent seal evidence are pinned by
  `a1-a2-a11-evidence.test.mjs`.

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
7. exposing a successful sibling after a fatal module-set failure;
8. promoting `test:kern-frontend` before F5-F6 complete;
9. extending the strict 16-field `.1` document under the same identity,
   normalizing quoted expressions into brace syntax, or changing frozen F0
   source bytes to simplify evidence binding;
10. teaching F2B property semantics, invoking F2 through the host, dispatching
    excluded `rawExpr`, or allowing F5 to parse raw expression text; or
11. rebasing escaped quoted expressions by adding one constant source offset.

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
