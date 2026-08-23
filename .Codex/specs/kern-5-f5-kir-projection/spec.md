# KERN 5 M4 — F5 KIR Projection

**Status:** IMPLEMENTATION REVIEW BLOCKED — REVIEW AMENDMENTS 1–2 DECIDED
**Date:** 2026-08-23
**Baseline:** `a7587da97f0e83f0b36ed150ecfe2eeb4fe32c40`
**Tribunal:** `tribunal-1787460641694-4ij0sc-kern5-f5-architecture`
(`claude,codex,agy,kimi-for-coding-k3`, 4/4)
**Confidence:** 0.88 before tribunal; 0.93 after corrections

## Executive Summary

F5 converts the accepted F4 document and module-set receipts into the frozen
structural module KIR using KERN-owned semantic selection. KERN, not TypeScript,
chooses included fields, omissions, lowered values, child order, roots, imports,
exports, and module order. The host is limited to authenticated file loading,
F4 invocation, strict canonical-instruction decoding, canonical byte encoding,
and fail-closed validation of the already-selected artifact.

F5 remains a private, nonterminal `internal-oracle`. It does not add or promote
`test:kern-frontend`, change KIR v1, expose a public KIR API, or move production
consumers away from TypeScript. F6 owns adversarial whole-ledger closure and F7
owns terminal frontend promotion.

## Current State and Root Cause

- **[F5-C1 VERIFIED]** Current `origin/main` and this fresh worktree start at
  `a7587da97f0e83f0b36ed150ecfe2eeb4fe32c40`; `git rev-parse HEAD`,
  2026-08-23.
- **[F5-C2 VERIFIED]** The completion goal marks M3 accepted and M4/F5 as the
  first unfinished milestone. It requires canonical KIR rows, provenance,
  malformed atomicity, and static-golden parity without TypeScript semantic
  delegation. Evidence:
  `.Codex/goals/KERN-5-COMPLETION-GOAL.md:199-205`.
- **[F5-C3 VERIFIED]** F0 freezes F5 as the sole KERN owner of KIR field
  selection, exclusions, defaults, canonical order, and instruction emission.
  Evidence: `.Codex/specs/kern-5-frontend-surface-closure/spec.md:72-85`.
- **[F5-C4 VERIFIED]** F4 intentionally emits facts, declaration/property
  rows, expression evidence, and a linked module-set receipt, but no KIR.
  Evidence: `.Codex/specs/kern-5-f4-declarations-modules/spec.md:62-64` and
  `:201-203`.
- **[F5-C5 VERIFIED]** The live F4 boundary is raw scalar data: each F4A result
  has 17 strings in `kern.frontend.f4-document.2`, and F4B has 10 strings in
  `kern.frontend.f4-module-set.4`. The JS decoders validate those receipts but
  do not emit KIR. Evidence:
  `scripts/kern-frontend-f4-declarations/decoder.mjs:313-386` and
  `scripts/kern-frontend-f4-declarations/module-set-decoder.mjs:201-325`.
- **[F5-C6 VERIFIED]** The frozen module artifact is
  `kern.kir.modules.r1.5e.1-alpha`, contains exact constitution, diagnostics,
  modules, proof label, and symbol catalog fields, and requires canonical
  modules/exports/imports/bindings. Evidence:
  `packages/core/src/kir-structural/module-types.ts:3-50` and
  `packages/core/src/kir-structural/module-canonical.ts:71-112,187-263`.
- **[F5-C7 VERIFIED]** The static valid fixture contains two modules and frozen
  canonical bytes; six malformed fixtures freeze exact diagnostic
  code/severity/span order. Its validator decodes and round-trips the checked-in
  bytes without regenerating them. Evidence:
  `scripts/kern-frontend-closure/static-goldens.json` and
  `scripts/kern-frontend-closure/validate.mjs:237-305`.
- **[F5-C8 VERIFIED]** The accepted F4 path already classifies the static valid
  fixture as linked with two classified documents and one resolved binding;
  direct Node 22 probe through public `runModuleSet`, 2026-08-23.
- **[F5-C9 VERIFIED]** The existing strict instruction decoder accepts only one
  complete, bounded canonical-value tree, enforces canonical record key order,
  and rejects malformed counts, depth, nodes, collection length, or trailing
  bytes. Evidence:
  `scripts/kern-frontend-falsification/instruction-decoder.mjs:1-91`.

The missing ownership boundary is therefore not parsing or module linking. It
is the deterministic projection of sealed F4 rows into the exact frozen KIR
value tree. Calling `parseInternal`, `parseDocument`, `parseLines`,
`parseExpression`, `projectStructuralNode`, `deriveModuleGraph`, or
`encodeModuleKir` to choose that tree would retain TypeScript semantic
authority and fail F5.

## What Already Works

- F0 authorities cover 302 node rows, 1,149 property rows, 16 expression kinds,
  24 binary operators, 6 unary operators, 5 module roots, and 2 symbol kinds.
- F1-F4 authenticate physical input, expression node tapes, logical trees,
  declarations, properties, diagnostics, source geometry, module IDs,
  bindings, components, and seals.
- KIR canonical-value encoding and structural/module decoding are strict and
  versioned.
- The static golden already provides an immutable byte comparator.
- The earlier scalar-tape probe establishes a reusable strict instruction
  format; F5 does not need a new public byte codec.

None of those facts proves F5: a host-built IR object, bootstrap AST, copied
golden, constant instruction stream, or semantic use of JS receipt objects
could still fake parity without a new KERN projection oracle.

## Contract

> Verified against the baseline sources above on 2026-08-23.

| Boundary | Required behavior | Evidence | Tag |
| --- | --- | --- | --- |
| Input | Exact module request identities plus raw F4A 17-field results and raw F4B 10-field result | F4 workers/decoders | VERIFIED |
| Input authority | F5 policy pins F0 authorities, F4 policy bytes, every F5 KERN source, canonical limits, and exact accepted input formats | F4 policy pattern and F0 closure | DECIDED |
| Semantic owner | KERN selects every module/root/node/property/expression/import/export field and its canonical order | F0-D6/F0 delivery architecture | DECIDED |
| Output | `kern.frontend.f5-projection.1`, status, one canonical instruction stream or one atomic diagnostic tape, input identity tape, work, and terminal seal | New private contract | DECIDED |
| Host decoder | Validate exact output shape, instruction grammar, limits, identities, seals, and atomicity | Existing strict decoder pattern | DECIDED |
| Host encoder | `decodeInstructionStream` then `encodeCanonicalValue`; it does not choose fields/defaults/order | FFP-D4 and decoder | DECIDED |
| Structural validation | `decodeModuleKir` may reject already-emitted bytes, but its derived metadata is never returned to or substituted for KERN output | Module decoder behavior | DECIDED |
| Diagnostic geometry | KERN returns the authenticated F4 scalar spans; the host converts scalar spans to line/column after failure only, as a separately tested output transform | F4 scalar spans and F0 line/column goldens | DECIDED |
| Success | Byte-identical frozen module KIR and no diagnostics | Static valid golden | VERIFIED target |
| Failure | No instruction stream or KIR bytes; exact ordered diagnostics from authenticated F4 evidence | Static malformed goldens | VERIFIED target |
| Visibility | Private `internal-oracle`; no public package export and no terminal frontend promotion | Goal M4/M5 split | DECIDED |

### F5 input provenance

1. The worker validates its F5 policy and composition before invoking F4.
2. It calls public `runModuleSet` exactly once per request. Decoded receipt
   objects exist only for host-side input validation and result reporting; F5
   cannot read them.
3. It rejects any F4A/F4B fatal, unsupported format, identity mismatch, missing
   result, or decoder disagreement before F5 execution.
4. It passes raw F4 fields, ordered request module IDs, F4 policy/composition
   identities, and bounded scalar profile values to one KERN F5 root
   invocation. The categories are explicit: raw F4 fields are semantic input;
   request order, identities, seals, formats, and limits are framing input;
   there is no decoded semantic or source-text input.
5. KERN independently validates every F4 format/status/terminal shape and
   recomputes each F4A seal as producer-consistency evidence before binding it
   to the F4B input-identity tape. This is not a security/authentication claim.
   It never receives
   JS-decoded declarations, properties, expressions, roots, imports, exports,
   or graph objects.
6. Static source guards ban semantic receipt-property reads, and runtime traps
   throw on access to `declarations`, `propertyOccurrences`, `propertyPresence`,
   `attachments`, `decorators`, `symbols`, `bindings`, `expressionEvidence`,
   `modules`, and `validatedComponents` during F5 execution.

### KERN-owned projection

KERN must construct the complete canonical instruction stream for the frozen
module artifact:

- exact artifact fields in the frozen order `constitution`, `diagnostics`,
  `format`, `modules`, `proofLabel`, `symbolCatalog`, including the empty
  diagnostic list and constant metadata;
- exact module fields `exports`, `id`, `imports`, `roots`; node fields
  `children`, `kind`, `properties`; import fields `bindings`, `source`;
  binding fields `imported`, `kind`, `local`, `reexport`; export fields `kind`,
  `name`, `source`; and exact symbol-catalog fields;
- modules in Unicode-scalar canonical ID order;
- roots in retained source order;
- attached children in retained source order, with attached decorators placed
  at their target position and no dropped/detached rows;
- effective property occurrences only, property names in canonical scalar
  order, omitted absent optionals, and the frozen `fn.params=""` omission;
- `included-value` identifier/string/boolean/number conversion;
- import-path, branch-path, each-collection, handler-type, and expression
  lowerings matching the frozen structural contracts;
- all 16 expression kinds from authenticated F2 postorder nodes, without
  reparsing expression text;
- imports grouped/sorted by source and bindings sorted by
  `(imported, kind, local, reexport)`;
- direct and re-exported exports sorted by name, with duplicates rejected by
  F4B before projection.

The instruction stream is a private, versioned scalar tape. All text ordering
uses Unicode scalar/code-point order, never UTF-16 code units or locale order;
non-BMP module IDs, record keys, and names are discriminating fixtures. Record
keys are already strictly ordered by KERN. The host may not reorder it into
validity.

Reversible lowering details are not duplicated as prose pseudocode. The policy
pins the exact accepted mapping authorities and implementation identities:
`packages/core/src/kir-structural/expression.ts`, `handler-type.ts`,
`branch-path-value.ts`, `each-collection-reference.ts`, `node.ts`,
`module-canonical.ts`, and `module-path.ts`. A citation/hash gate fails when any
of those inputs drifts without an explicit F5 mapping review. Irreversible
rules remain normative here: F2 postorder evidence is the only expression
input; negative zero, typed/spread forms, and duplicate record keys reject;
`effectiveOccurrenceOrdinal=-1` means absence; trimmed-empty `fn.params` is
omitted; detached/dropped rows never emit; each retained node has unique
acyclic parenthood; and the whole module set, not individual modules, is the
atomic projection unit.

The test harness records a per-instruction provenance side table identifying
the raw F4 field/row and F5 projector version that emitted it. This table is
test-only, never appears in KIR, and cannot be read by the production encoder.

### Resource and atomicity contract

- Policy node, depth, byte, and work limits are safe positive integers and
  remain configurable. No evidence-free fixed capacity is introduced.
- KERN charges every consumed F4 row, canonical node/leaf/collection boundary,
  sort comparison/move, and copied instruction scalar prospectively.
- Output node/depth/byte/work caps are checked before allocation or retention.
  Any crossing returns
  one atomic `F5_LIMIT` result with no instruction stream.
- Malformed input or impossible internal state returns atomic
  `F5_AUTHORITY_DRIFT` or `F5_F4_DRIFT`, never partial KIR.
- F4 fatal/rejected results map to frozen diagnostics without invoking semantic
  projection. Authority/F4 drift takes precedence over ordinary rejection and
  resource limits.
- The failure envelope has a statically reserved bound and remains emit-able
  after any ordinary cap crossing. Codec exceptions are infrastructure
  failures; the host may never forge them into KERN diagnostics.
- The whole output is staged. Host order is normative: decode the KERN
  instruction value, mechanically encode canonical bytes, call
  `decodeModuleKir` on the staged bytes, discard its return, then commit the
  original staged bytes. Decoder telemetry flows outward only. A canary makes
  the decoder return a different valid artifact and proves committed bytes are
  unchanged.
- No repeated growing-prefix string construction is allowed for unbounded
  output. The implementation uses bounded parts plus the established charged
  balanced fold or an equivalently charged pull cursor with O(depth) live
  state. Partial staged bytes are never observable.

## Implementation Options

### Option A — full KERN canonical instruction stream (recommended, 0.93)

KERN consumes raw F4 fields and emits the entire canonical artifact instruction
tree. The host strictly decodes and encodes the selected value.

Pros: satisfies sole semantic ownership; exact byte oracle; no new public KIR;
host behavior is mechanical and mutation-testable. Cons: largest KERN slice;
must port all five property lowering families and 16 expression projections.

### Option B — KERN semantic rows, host artifact builder (rejected, 0.35)

KERN emits normalized nodes/properties and TypeScript builds canonical values.
This leaves key order, defaults, graph metadata, and artifact fields selectable
by host code, so parity does not prove F5 ownership.

### Option C — KERN emits final serialized canonical bytes (rejected, 0.55)

This minimizes the host encoder, but duplicates the private canonical JSON byte
codec in KERN and makes mechanical-vs-semantic review harder. The existing
strict instruction boundary is simpler and already separately falsified.

## Planned Modules and Blast Radius

| Path | Action | Reason |
| --- | --- | --- |
| `.Codex/specs/kern-5-f5-kir-projection/spec.md` | add/update | Claim-tagged F5 contract and evidence |
| `examples/kern-frontend/f5-canonical-instructions.kern` | add | Canonical scalar instruction constructors and charged folds |
| `examples/kern-frontend/f5-expression-projection.kern` | add | F2 postorder-node to canonical expression instructions |
| `examples/kern-frontend/f5-property-projection.kern` | add | Effective-property selection and frozen lowering rules |
| `examples/kern-frontend/f5-tree-projection.kern` | add | Declaration/attachment/decorator tree construction |
| `examples/kern-frontend/f5-module-projection.kern` | add | Module order, imports, exports, roots, artifact metadata |
| `examples/kern-frontend/f5-projection-main.kern` | add | One exported F5 entry and atomic terminal result |
| `scripts/kern-frontend-f5-projection/policy.json` | add | Versioned limits and exact authority/composition pins |
| `scripts/kern-frontend-f5-projection/policy-validation.mjs` | add | Plain-data, identity, order, hash, and limit checks |
| `scripts/kern-frontend-f5-projection/decoder.mjs` | add | Strict private result and instruction validation |
| `scripts/kern-frontend-f5-projection/worker.mjs` | add | Public F4 call plus one KERN F5 invocation |
| `scripts/kern-frontend-f5-projection/*.test.mjs` | add | RED, parity, mutation, malformed, resource, ownership tests |
| root `package.json`, fitness policy/tests, support matrix | update only in a separate local promotion commit after all F5 evidence passes | Add nonterminal current F5 oracle, never terminal frontend |
| goal and parent F4/F0 specs | truth update after acceptance | Record F5 without overpromoting F6/F7 |

All handwritten files must remain below 500 lines. The split above is a
contract boundary, not permission for one generated monolith.

## Binary Acceptance Criteria

- **[F5-A1] RED at baseline:** the focused gate fails because the F5 worker,
  policy, KERN entry, and result format do not exist; existing F0-F4 gates are
  green.
- **[F5-A2] Static valid parity:** the exact two frozen source modules produce
  bytes identical to `expectedCanonicalBase64`, decode as the same module KIR,
  and invoke F4 once plus F5 once.
- **[F5-A3] Independent semantic assertions:** decoded output contains the
  exact two modules, roots, decorator position, handler/return/param trees,
  precedence expression, import binding, direct exports, and re-export.
- **[F5-A4] Malformed parity:** all six frozen failure fixtures return exact
  code/severity/span order with no instruction stream/KIR bytes and no F5
  semantic projection after an inherited F4 rejection.
- **[F5-A5] Expression closure:** one hand-authored corpus covers all 16 frozen
  expression kinds, all 24 binary operators, all 6 unary operators, astral
  text/keys, precedence, nested collections, and constructor/lambda boundaries;
  output equals the independent frozen structural-expression oracle.
- **[F5-A6] Property lowering closure:** include identifier/string/boolean/
  integer/decimal, import path, quoted/unquoted branch path, each collection,
  parameter/return handler types, expression, optional absence, LWW presence,
  and `fn.params=""` omission. Same-length disposition/value/order mutations
  must change or reject output as specified.
- **[F5-A7] Tree closure:** roots and children preserve accepted source order;
  attached decorator order is exact; dropped and detached rows contribute no
  KIR. Missing/duplicate/reordered attachment or declaration rows reject
  atomically.
- **[F5-A8] Module closure:** Unicode module ordering, source grouping, binding
  ordering, direct exports, re-exports, and components match F4B. Missing,
  duplicated, reordered, or substituted identities/bindings reject. At least
  one three-module fixture and one disconnected-module fixture are required;
  reversing request order must leave canonical bytes unchanged.
- **[F5-A9] Provenance/delegation traps:** static dependency and runtime-call
  canaries forbid bootstrap parsers/projectors and forbid JS-decoded semantic
  rows from reaching F5. Constant/copy-golden, host-reorder, shortened-loop,
  ignored-row, stale-seal, and forged-seal mutants die.
- **[F5-A10] Instruction integrity:** field reorder, default insertion,
  deletion, duplication, count drift, suffix, unknown tag, malformed scalar
  length, noncanonical number, depth, and output-limit mutants reject.
- **[F5-A11] Resource closure:** exact/cap-minus-one count, byte, depth, node,
  collection, and work crossings are atomic; 1x/2x/4x/8x corpus growth stays
  within the authenticated scaling wall without uncharged growing prefixes.
- **[F5-A12] Identity/ABI isolation:** F4 formats remain document `.2` and
  module-set `.4`; F5 format is private `.1`; KIR module and KIR-v1 formats stay
  unchanged; no public export or terminal root script appears.
- **[F5-A13] Cumulative gate:** focused F5, F0 closure, F1-F4, KIR structural/
  module/v1 gates, core tests, lint, consistency, exact pins, deterministic
  generation, and `pnpm fitness:kern-5` pass on the final candidate.
- **[F5-A14] Independent review:** automatic-risk Agon review with the verified
  primary implementer has no unresolved verified blocker; review-driven fixes
  receive focused confirmation.

## Oracle Design Gate

The initial test must be RED for the missing F5 boundary, not for missing build
artifacts. Before implementation:

1. add the static valid and six malformed fixture tests;
2. prove the valid test fails only because F5 is absent;
3. run Agon Nero against the oracle and kill any constant-golden, JS-projector,
   host-sort, partial-expression, or ignored-receipt cheat it finds;
4. only then launch the build.

No `ASSUMED` or `OPEN` claim may feed these fixtures.

Acceptance uses asymmetric grading:

- exact bytes decide artifact acceptance;
- source-runner behavioral convergence is an independent trust signal, and any
  equal-byte behavioral divergence stops for adjudication rather than being
  normalized away;
- the enumerated emitter mutation suite must kill 100% of applicable semantic
  mutants, including every expression kind/operand mapping, key sequence,
  empty/null field, sort key, omission, provenance binding, and terminal field;
- a corrupted-golden test proves the implementation does not read or copy the
  expected bytes; the gate prints exact corpus and mutant counts.

## Deploy and Skew Order

F5 KERN sources, policy descriptors, worker, decoder, and tests land in granular
local commits. Only after byte parity, behavioral convergence, mutation closure,
resource gates, and independent review pass does a separate local commit add
the nonterminal fitness row, matrix, and goal truth update. The complete feature
still uses one push. The
worker rejects any old/new policy or composition skew before invoking F5.
Existing F0-F4 and KIR formats remain unchanged, so there is no public consumer
skew. F6/F7 must branch from the landed F5 `origin/main`; this branch is never
reused after merge.

## Out of Scope

- F6 adversarial full-ledger promotion work beyond F5's discriminating corpus.
- `test:kern-frontend`, terminal ownership, production parser cutover, public
  KIR exports, KIR schema changes, compiler/interpreter work, release, tag, or
  publication.
- Using TypeScript semantic output as an implementation input, even if guarded
  by byte equality.

## Tribunal Resolution

- **[F5-T1 DECIDED]** Raw F4 fields are the only semantic input. Decoded JS
  receipt objects are banned by source guard and runtime trap.
- **[F5-T2 DECIDED]** KERN emits the complete logical canonical value tree for
  the whole module set. Constant metadata, empty lists, null sources, exact key
  sequences, and Unicode-scalar sorting are part of acceptance.
- **[F5-T3 DECIDED]** Host `decodeModuleKir` is a discard-only, post-emission
  validator. Its return cannot influence committed bytes.
- **[F5-T4 DECIDED]** Diagnostics preserve exact F4/F0 warning and error order.
  Scalar-to-line/column conversion is a mechanical failure-output transform,
  separately tested and never supplied to the KERN projector.
- **[F5-T5 DECIDED]** The existing instruction primitives are reused inside a
  versioned private F5 envelope; no KIR schema or public codec is added.
- **[F5-T6 DECIDED]** F5 is implemented before its nonterminal gate is promoted;
  the terminal frontend gate remains planned.

## Review Amendment 1

The first integrated high-risk review rejected `3ae1a6b4`. The normative repair
contract is `.Codex/specs/kern-5-f5-kir-projection-review-amendment/spec.md`.
The prospective typed-builder repair is further governed by
`.Codex/specs/kern-5-f5-kir-projection-review-amendment-2/spec.md`.
Its decided claims supersede ambiguous remedy wording here; the original F5
ownership, format, nonpromotion, and out-of-scope boundaries remain unchanged.

## Corrections Log

| Original claim | Reality | Impact |
| --- | --- | --- |
| The historical attachment's 45-55% post-M4.171 estimate described current progress. | Current goal records accepted F4/M3 and a later 54-64% directional estimate. | Attachment is intent/provenance only; current goal controls execution. |
| F5 could call `encodeModuleKir` after constructing roots. | `encodeModuleKir` invokes TypeScript `projectStructuralNode` and `deriveModuleGraph`, which select semantic output. | F5 emits the complete artifact instruction stream; host only canonical-encodes and validates it. |
| The two-module static golden was enough to establish ownership. | It cannot kill constant output, missing generic mappings, disconnected graph, or request-order cheats. | Add three-module/disconnected, full expression/lowering, corrupted-golden, and 100% enumerated mutation gates. |
| In-process F4 seal checks authenticate producer input. | They prove consistency, not a security boundary. | Use producer-consistency terminology and bind raw F4A rows to F4B identities. |
| F5 needed a host-built newline index as input. | Success KIR has no locations, while failure scalar spans can be converted mechanically after KERN returns. | Keep source/newline data out of the semantic projector; test the output transform independently. |
