# KERN 5 F4A — A6/C8 Detached-Subtree Closure

**Status:** IMPLEMENTATION SPEC — not accepted, promoted, released, or published
**Scope:** F4A declaration/attachment projection only
**Base:** `origin/main` `4c0ade6305b374d273550df686b827877417dc46`
**Owner:** M1 F4A A6/C8 closure slice

## 1. Problem and claim ledger

| ID | Claim | Status | Evidence |
|---|---|---|---|
| A6-1 | An invalid frozen F3 parent edge detaches its child and every descendant semantically, while F3 geometry remains unchanged. | **VERIFIED** | Parent F4 contract [F4-C7/C8](../kern-5-f4-declarations-modules/spec.md:123) states immutable edges and full descendant detachment. |
| A6-2 | Current F4 marks a direct invalid child detached but leaves a descendant declaration public; its occurrence/presence rows are existing intrinsic-validation provenance and are not themselves an A6 suppression target. | **VERIFIED** | `f4-declarations-semantic-tail.kernpart:19-59` only appends the direct invalid child to `detached`; declarations are emitted earlier at `f4-declarations-semantic.kern:241-243`, while property rows are separately emitted at `350-373,419-422`. |
| A6-3 | Current F4 path binding filter receives only that direct detached tape, so a descendant `use` can emit an `invalid-import-path` fact. | **VERIFIED** | `f4-path-contract.kern:177-231` constructs its map from the supplied detached tape; the tail calls it with `detached` at `f4-declarations-semantic-tail.kernpart:77-96`. |
| A6-4 | Candidate decorators in a detached subtree currently still emit public decorator rows and can update an effective export value. | **VERIFIED** | `f4-declarations-semantic-tail.kernpart:60-76` has no detached-closure filter and writes `effectiveValues` for export. |
| A6-5 | F3 edge ordering, duplication, or omission must fail as F4 F3 drift before semantic projection. | **VERIFIED** | `f4-declarations-main.kern:168-184` compares restructured and transported sidecar edge tapes, returning `F4_F3_DRIFT`. |
| A6-6 | Closure suppresses the C8-forbidden declaration and interface effects, not intrinsic validation provenance: local facts retain their existing emission/phase order and diagnostics retain C14 order. | **DECIDED** | F4-C7 preserves source-ordered local rejection reporting; F4-C8 requires intrinsic-property validation while naming only declaration/import/export/binding/default/parent-scope effects as forbidden. |
| A6-7 | C9 wins for decorator disposition: a valid closure-targeted candidate becomes an ordered `dropped` decorator with `DROPPED_DECORATOR`, never attaches or exports; F3 orphans use ordinary C9 behavior. | **DECIDED** | F4-C9 explicitly requires one ordered `DROPPED_DECORATOR` for every non-admitted candidate or F3 orphan; C8 forbids the attachment/export effect, not that diagnostic disposition. |
| A6-8 | No ABI, document-format, policy-format, decoder grammar, or F0-F3 byte change is required. | **VERIFIED** | `policy.json:1-13` pins document `.2`, policy `.4`, and private F4 ABI arity `109`; `decoder.mjs:283-350` already decodes all affected sections. |

## 2. Frozen semantic contract

### A6-C1 — Full closure

For every authenticated F3 edge `[parent, child]` rejected by the frozen
allowed-child catalog, `child` and every transitively reachable F3 descendant
belong to the detached semantic closure. The closure is calculated from the
full authenticated edge tape, in F3 source-edge order. It is not merely the
direct invalid child list.

F4 does not drop, rewrite, reorder, or reparent an F3 edge. It validates every
edge, preserves F3 drift detection, and seals the exact F3 geometry as it does
today. The only new semantic outcome is the complete closure used by F4A
projection.

### A6-C2 — Exact public receipt projection

For a logical line in the closure, the receipt projection is constrained as
follows. C8 suppresses declaration/interface effects, while intrinsic
property-validation provenance and C9-mandated dropped-decorator reporting are
retained:

| Receipt section | Closure rule |
|---|---|
| declarations | suppress every declaration row with the detached owner ordinal |
| occurrences and effective presence | retain intrinsic property-validation provenance, including source spans and effective occurrence selection; these are separate property rows in the result contract, not a C8-listed declaration/interface effect |
| attachments | preserve only geometry rows: an edge with an already-detached parent is emitted as `detached-local`; the original invalid edge has no admitted attachment row and is represented by its `invalid-child` fact |
| decorators | a grammar-valid candidate whose target is in the closure is retained as an ordered `dropped` row with target ordinal `-1`, its original explicit-export bit, no attachment/export effect, and one ordered `DROPPED_DECORATOR`; a detached F3 orphan follows ordinary C9 `dropped` behavior |
| symbols, bindings, defaults, and parent-scope effects | suppress entirely for closure owners |
| expression evidence and aggregate C20 contribution | suppress evidence rows for closure-owned occurrences. `S_total` and `B` are recomputed only from retained evidence (`B = S_local + E_local_success`); `L_attempted` remains every actual local-F2 dispatch attempt, including detached attempts. Parser/local-expression work remains charged, and a local expression failure retains its existing fact/diagnostic outcome. |
| detached logical ordinals | contain every closure ordinal exactly once in F3 source-edge order |

The document result remains the exact 17-string `.2` receipt. A rejected
receipt remains atomic for consumable interface fields: symbols and bindings are
empty, as today. This slice additionally prevents leaked detached rows from the
other semantic sections; it does not introduce a new receipt field or a host
post-filter.

### A6-C3 — Validation, facts, and diagnostics

The closure does not excuse malformed local syntax, missing properties, unknown
nodes/properties, rejected values, or local child-edge validation. Facts retain
their existing phase/emission order and are neither sorted nor deduplicated by
C14; diagnostics retain their established C14 rank/no-dedup order. Every
intrinsically invalid descendant edge emits its own existing `invalid-child`
fact at that edge's child source location, even if its parent is already in the
closure. Closure membership itself is deduplicated. A valid descendant-local
edge is represented by its `detached-local` geometry disposition, not relabelled
as an invalid child.

Import/path and module-binding resolution are semantic interface effects, not
intrinsic detached validation. F4 does not invoke path/binding projection for a
closure owner and therefore must not emit a path-resolution fact merely because
the detached owner would have escaped or failed a module path check.

Candidate decorator runs are still authenticated against F3's decorator run and
same-indent successor geometry. C9 controls their disposition: a grammar-valid
candidate targeting a detached `fn` is emitted as an ordered `dropped`
decorator with exactly one `DROPPED_DECORATOR`, never as an attached child and
never with an export mutation. A detached F3 orphan remains an ordinary C9
orphan and gets its ordinary `dropped` outcome. A malformed decorator retains
its pre-existing syntax fact and `UNEXPECTED_TOKEN` diagnostic. This resolves
the C8/C9 boundary without suppressing C9's mandated reporting.

### A6-C4 — Precedence and failure

1. ABI/envelope, policy/composition, and prerequisite transport validation stay
   outside this slice and retain their current precedence.
2. F3 replay and full edge-sidecar comparison occur before attachment closure
   or semantic projection. Any well-shaped aligned reordered, duplicate,
   missing, or forged edge vector yields one atomic `F4_F3_DRIFT` fatal, with
   ordinary semantic partitions empty. A malformed/non-aligned edge transport
   is instead atomic `F4_INVALID_REQUEST`.
3. With authentic F3 input, F4 performs one bounded preprojection
   classification-and-closure pass before emitting semantic rows. For each
   logical line `i`, it calls `f4lineeligibility` once, retains that exact
   result for later semantic use, and incrementally debits
   `f2uint(eligibility[i][11])` exactly once—the current eligibility work slot
   charged at `f4-declarations-semantic.kern:198`. It then debits exactly one
   scalar unit for each authenticated edge validation (`E`), one for each
   closure-propagation edge inspection (`P`), and one for each first detached
   ordinal admission (`A`). Thus the prepass advances the incoming meter by
   `sum_i f2uint(eligibility[i][11]) + E + P + A`, with `P <= E` and `A <= L`.
   Before retaining an eligibility result, validating/propagating an edge, or
   appending a first detached ordinal, it checks the next meter; the first
   excess returns atomic `F4_LIMIT` before projection. Later semantic code
   reuses retained eligibility results and must not debit slot `[11]` again.
   This pass is O(L+E), not a second eligibility scan.
4. Otherwise all local validation is scanned in source order, closure projection
   is applied, and the regular F4 status/seal rules apply.

### A6-C5 — Compatibility fence

The following are unchanged: public `runDocument` API, 109-argument private
F4 root ABI, document receipt `.2`, policy format `.4`, C14 diagnostic ranks
and no-dedup policy, F0/F1/F2/F2B/F3 semantics, KIR/module formats, error-code
vocabulary, and decoder field grammar. The composition manifest and complete
policy bytes/SHA/cache identity change atomically because a new F4 helper is
pinned; that is a composition identity update, not a format bump.

### A6-C6 — C20 evidence identity

Closure filtering happens after a local expression is attempted, but before an
evidence row is retained. Therefore `L_attempted` is the actual number of local
F2 dispatch attempts across both retained and detached occurrences. In contrast,
`S_total`, `S_local`, `E_local_success`, and `B` are derived only from retained
evidence rows, preserving C20's exact identity
`B = S_local + E_local_success`. C20 cap evaluation remains in its frozen order
`S_total`, then `L_attempted`, then `B`; a detached attempt can consume the L
budget even though it contributes zero visible evidence scalars/boundaries.

## 3. Root cause and bounded implementation shape

Current code projects declarations before the tail establishes detachment. The
tail tracks `detachedByLine`, but exports only the direct invalid-child tape;
downstream path binding receives that incomplete tape. Decorator disposition and
expression-evidence projection are outside a full closure decision. Property
occurrence/presence rows are retained intrinsic-validation provenance, not
blanket-suppressed declaration rows: the parent receipt contract lists property
rows independently from declaration rows, and C8 expressly preserves intrinsic
property validation while forbidding only the named declaration/interface
effects. The existing semantic loop calls `f4lineeligibility` and immediately
debits `eligibility[11]` at `f4-declarations-semantic.kern:185-200`; a tail-only
closure cannot both decide projection early and reuse that exact work result.
This is a KERN source defect, not a decoder limitation.

| Surface | Required bounded change |
|---|---|
| `examples/kern-frontend/f4-attachment-closure.kern` (new, under 500 lines) | Portable preprojection eligibility/edge traversal returning retained eligibility results, full closure membership, ordered detached tape, admitted attachment geometry, every intrinsic invalid-edge input, and checked `sum eligibility[11] + E + P + A` work. It must use scalar/map/tape patterns accepted by the portable evaluator; no dynamic host normalization. |
| `f4-declarations-semantic.kern` / `f4-declarations-semantic-tail.kernpart` | Consume cached eligibility/closure before declaration/interface projection; retain intrinsic property occurrence/presence provenance and local validation facts, but gate declarations, path binding, attached decorator/export, and expression evidence through the closure result. Keep handwritten files below 500 lines by extracting, not growing. |
| `scripts/kern-frontend-f4-declarations/policy.json` and composition validation | Add the helper in deterministic composition order and update every pinned SHA plus the full policy identity atomically. |
| focused tests | Add only public/explicit-private transport mutation oracles; never fabricate a receipt or host-side closure result. |

The closure construction is bounded by already-capped F3 logical lines/edges.
It is a preprojection KERN oracle, not a decoder reconstruction: the decoder
does not receive trusted F3 edge/catalog context and therefore cannot determine
which ordinals belong to the closure. KERN must enforce source-edge order and
exact-once membership; the decoder remains limited to generic framed-row and
receipt-shape validation. Exactness tests therefore mutate the KERN closure
helper's dedupe/order branch and require the real-output/source canary to fail,
not a fabricated raw receipt mutation that the decoder cannot semantically
adjudicate. The helper may construct parent/child membership maps and a
source-ordered worklist, but must charge every traversal and never use a
repeated growing-prefix tape concatenation or a host graph API. A child visited
more than once is ignored after its first source-order admission; F3's
authenticated tree geometry normally gives one parent per non-decorator logical
line.

## 4. Acceptance matrix (RED before production repair)

| ID | Fixture / mutation | Required assertion |
|---|---|---|
| E1 | `module -> list -> text -> use path="../../escape"` under an explicit catalog that rejects `list -> text` | Current base is RED. Repaired receipt is rejected; detached ordinals are exactly `[text,use]`; only non-detached declaration rows escape, while intrinsic occurrence/presence provenance remains; attachment geometry is `[module,list,attached]`, `[text,use,detached-local]`; facts contain `invalid-child` but no detached `invalid-import-path`; bindings/evidence are empty. |
| E2 | Same shape with a valid quoted expression owned by detached `text` | It makes one actual local-F2 attempt and charges parser work, but no detached expression-evidence row escapes. Assert C20: `L_attempted` includes that attempt, while `S_total` and `B` equal the retained-evidence recomputation and the detached attempt contributes zero to both. A local expression failure retains its existing fact and C14 diagnostic. |
| E3 | `module -> list -> text -> @trace export -> fn`, with `list -> text` invalid | Current base is RED. F3 decorator geometry remains authenticated; the valid candidate is exactly one row `[trace,dropped,-1,true,start,end]` plus one ordered `DROPPED_DECORATOR`, never attached/exported; detached declaration is absent, intrinsic occurrence/presence provenance remains, and direct `invalid-child` remains. |
| E4 | Unrestricted and explicit valid-catalog controls | Classified receipts retain every declaration/occurrence/presence/decorator/expression row and all attachments as `attached`; detached tape and facts are empty. |
| E5 | Nested `invalid parent -> child -> invalid grandchild -> descendant` catalog fixture | Both intrinsically invalid edges emit their own `invalid-child` fact in existing emission order; no invalid edge gets an attachment row; closure ordinals deduplicate and include the complete descendant chain in F3 source-edge order. |
| E6 | Real well-shaped aligned `edgeChildren`, `edgeParents`, `edgeChildIndents`, `edgeParentIndents` reorder, duplicate insertion, deletion, and swap | Each runs exactly one real F4 invocation and returns atomic `F4_F3_DRIFT`; all ordinary sections are empty. A malformed/non-aligned shape is instead atomic `F4_INVALID_REQUEST`. Valid unmutated geometry remains a green control. |
| E7 | Mixed invalid edge plus malformed/missing/unknown local detached line | Facts retain exact existing phase/emission order and spans; diagnostics retain C14 order/spans; no forbidden declaration/interface/evidence row from its closure owner escapes. |
| E8 | Closure fixture with captured eligibility results and multiple descendants | Compute the preprojection boundary from the real retained `sum eligibility[11] + E + P + A`: one less is atomic `F4_LIMIT` before projection, and the exact boundary proves every eligibility result is reused with no second slot-`[11]` debit. C13 fact/diagnostic limits remain atomic with no partial public projection. |
| E9 | Capture actual private runtime args and result | Exactly 109 args, policy `.4`, document `.2`, exactly 17 receipt fields. An old composition pin/policy skew rejects before acceptance. |
| E10 | KERN integrity mutations and structural canary | KERN tests prove exact-once source-edge closure membership and the incremental `sum eligibility[11] + E + P + A` cap boundary before projection; canaries mutate the retained-eligibility reuse/debit branch or closure dedupe/order branch and fail if slot `[11]` is replayed, only direct invalid children are recorded, any intrinsic invalid descendant edge loses its fact, a forbidden declaration/path/attached-decorator/export/expression-evidence push bypasses closure disposition, or F3 edges are rewritten/dropped. The decoder is intentionally not assigned closure semantic validation without trusted F3 context. Mutation controls must alter source before evaluation. |

The E1/E3 current behavior is the discriminating base RED: current code exposes
descendant declaration/interface rows and attaches/exports a detached decorator
instead of applying full closure projection with C9's dropped disposition. E6
and E9 are intended green compatibility controls at base.

## 5. Explicit exclusions and kill switches

This slice does not alter F3's indentation/tree construction, repair malformed
source, introduce a new error code, publish F4, or promote a KERN 5 terminal.

Stop and redesign if implementation requires any of the following:

1. host-side parsing, catalog selection, closure calculation, or receipt
   filtering;
2. modifying F0-F3, normalizing/reparenting/dropping an F3 edge, or accepting a
   partial F3 edge tape;
3. a document/policy format or ABI bump rather than an atomic composition-pin
   update;
4. suppressing intrinsic local facts/diagnostics merely because their owner is
   detached;
5. preserving an import/path/binding/default/export effect for a closure owner;
6. an O(E²), O(L²), or repeated growing-prefix closure/output algorithm; or
7. a handwritten KERN source file at or above 500 lines.

## 6. Verification and handoff

Implementation must first demonstrate E1/E3 semantic REDs on the unmodified
base, then make the focused A6 suite green without weakening them. Required
local evidence after implementation: Node syntax checks, forced core build,
focused F4 declaration tests including A6 and mutation controls, policy
composition validation, `git diff --check`, and an independent post-change
review routed by the actual primary implementation identity. Broader F4/KERN-5
fitness remains a separate acceptance gate; passing this slice does not close
A3-A5 or promote F4.

## 7. Corrections log

| Date | Correction |
|---|---|
| 2026-08-21 | Replaced the direct-child interpretation exposed by the current tail with the parent-spec's full descendant closure requirement. |
| 2026-08-21 | Corrected the C8/C9 boundary: valid detached-target decorators remain ordered C9 `dropped` rows with `DROPPED_DECORATOR`; only attachment/export is suppressed. |
| 2026-08-21 | Distinguished retained intrinsic validation from forbidden detached import/path/binding projection, preventing detached path facts from leaking as semantic work. |
