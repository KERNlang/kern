# KERN 5 F5 KIR Projection — Review Amendment 3

Status: IMPLEMENTATION READY — ACCEPTANCE PENDING

Date: 2026-08-23

Baseline: signed checkpoint `d774c0c9` on the F5 repair lineage. This
amendment is additive to the parent F5 specification and review Amendments 1
and 2. Where accounting language conflicts, this amendment controls.

Evidence inputs:

- high-risk role review `review-1787492824774-h7j0tz`;
- grounded brainstorm `brainstorm-1787493503593-8k82mv-f5-ledger-ownership`;
- synthesis tribunal `tribunal-1787493729334-voci90-f5-scalar-ledger-tribunal`;
- complete baseline F5 wall: 52/52 at checkpoint content before this amendment.

## Objective

Close the remaining exact-work ownership defects without changing canonical
KIR bytes, the eleven-input private F5 entry ABI, the seven public profile
limits, the F5 receipt format, F4 formats, or KIR formats.

## [F5-A3-R1 DECIDED] Scalar result-frame ownership

Work remains a canonical unsigned scalar carried in result-frame field 3.
There is no shared keyed ledger, new policy field, new limit, host accumulator,
or mutable object passed between KERN handlers.

Each physical operation has exactly one owner:

1. a row decoder owns its row codec scan/copy work;
2. a child constructor owns the work in its result frame;
3. an entry producer adopts a child result's work exactly once into the entry
   seed given to `f5chargedsort`;
4. the sorter owns candidate probes, row decodes, comparisons, moves, duplicate
   discovery, and its returned ordinal vector;
5. an ordinal constructor adopts the sorter's terminal work exactly once and
   never adopts a child result's work again;
6. a parent adopts one completed child result frame exactly once;
7. a top-level root owns only work not already owned below it.

Re-reading an already-owned frame creates fresh codec work but does not re-own
the historical work stored inside that frame.

## [F5-A3-R2 DECIDED] Failure work is cumulative

Every metric-bearing failure reports all physical work completed before the
failure was identified. Prior completed siblings and prior completed modules
remain in the cumulative scalar ledger. No later error path may reconstruct
work from a subset of local arrays or discard a completed ledger.

Semantic drift, authority drift, shape drift, duplicate drift, and translation
domain drift are still decided before a simultaneous resource limit. Work is
charged before the classification branch, but a limit gate is evaluated only
after the governing drift checks have completed.

Private helper sentinels may remain only when the caller can add the helper's
complete work without ambiguity. Metric-bearing tree and module paths must
return a status plus work, not a workless bare sentinel.

## [F5-A3-R3 DECIDED] Expression tape work is owned once

The four authenticated expression tapes are charged exactly once per F2
expression projection. A record node starts its entry ledger at zero, adopts
each child result once, and owns its own framing/sort/codec/fold work. The final
expression root adopts the expression-tape work once.

An early record failure reports the expression-tape work plus work physically
completed through the failing record, without charging the expression tapes
for preceding sibling record nodes.

## [F5-A3-R4 DECIDED] Ordinal construction and limited children

`f5recordordinals` and `f5listordinals` receive sorter work that already owns
every entry producer's child work. A limited child therefore returns
`F5_LIMIT` with the current accumulated work; neither constructor adds
`child[3]` again.

Both constructors keep exactly:

- the original child entry-frame array;
- one scalar ordinal per child;
- logarithmic scalar-length and text fold buckets;
- scalar counters.

They may not retain parallel sorted payload arrays or a second full instruction
artifact.

## [F5-A3-R5 DECIDED] Prospective copy-pass pricing

The pre-gate dry run prices every physical operation that the post-gate copy
pass will perform, including entry-row decoding, child-result decoding, piece
construction, bucket merges, final consolidation, and result-frame encoding.
The copy pass does not alter the ledger after the gate.

The dry run and materialization must have a source-verifiable one-for-one
operation schedule. A performed decode may not be omitted merely because an
earlier validation pass decoded the same immutable frame. Caching decoded
tuples in one array per child is forbidden by the scratch contract.

Sizes 0, 1, powers of two, and power-of-two-plus-one must pin the merge and
consolidation work. Direct `List.join`, unbounded growing-prefix writers, and
materialization before the gate remain forbidden.

## [F5-A3-R6 DECIDED] Module ledger ownership

`f5projectmodules` maintains one cumulative scalar for physical module work.
It includes:

- the outer resolved-binding tape decode;
- every binding and symbol row decode at every physical read site;
- export, re-export, source, binding, import, root, module, and artifact child
  construction;
- every entry-frame encoding;
- all completed sorts and ordinal construction;
- every comparison, move, and duplicate probe;
- all completed prior modules and siblings.

The successful source-sort terminal work must be adopted before its ordinals
are consumed. The same applies to export, binding, and module sorts. Each sort
terminal is adopted once: either by its ordinal child constructor or, when no
child retains it, directly by the cumulative module scalar.

Every early export/source/binding/module failure returns the cumulative work
through that point. It may not omit `moduleEntryWork` or successful sibling
constructor work, and it may not add them twice on success.

## [F5-A3-R7 DECIDED] Tree projection returns real work

The current `f5worklength` declaration/occurrence/presence proxy is not exact
row-examination work and is removed from the F5 root path.

`f5projecttree` returns a private scalar array containing status, work, and the
root result frames. It charges every physical declaration, presence,
occurrence, attachment, decorator, expression-ordinal, property-entry, and
root-selection scan exactly once per execution. Its child constructors remain
ordinary result frames and are adopted once.

Quadratic but fully charged scans may remain in this amendment. Re-indexing or
memoizing them is a later performance refactor unless exact-work or profile
limits cannot bound them. No new public or policy ABI is introduced.

## [F5-A3-R8 DECIDED] Codec accounting

Every `f5rowread` in a metric-bearing path has one of two explicit treatments:

- a colocated `f5rowcodecwork(tape, values)` charge; or
- a named prospective copy-pass charge before the gate that is structurally
  paired with the later read.

`Text.length(row) + 1` is not a substitute for row codec work. The codec helper
is itself a pricing function and does not perform another decode.

## [F5-A3-R9 DECIDED] Stable contracts

This amendment changes only work totals, work-limit boundaries, private helper
shapes, composition bytes, descriptor SHA-256 values, and full-policy cache
identity. It does not change:

- canonical instruction bytes;
- node, depth, collection, or string metrics;
- F5 public result fields or codes;
- F4 document/module-set formats;
- KIR constitution or module format;
- F5 policy format or profile-limit names;
- the eleven-input private root signature.

## RED matrix

All REDs use the real composed F5 root unless a private helper seam is needed
to isolate one ownership boundary. A private seam may return actual KERN
results; it may not fabricate a receipt.

### [F5-A3-E1] Expression single adoption

- Compare one expression with zero record nodes, one record node, and two
  sibling record nodes.
- Pin the authenticated expression-tape charge independently.
- Each added record changes only its own entry/sort/fold work; it does not add
  another full expression-tape charge.
- Early record drift retains the one expression-tape charge.

### [F5-A3-E2] Limited child symmetry

- Feed the same limited child through record and list ordinal constructors.
- Assert exact equal child-ownership treatment.
- Exact work cap and one-under retain `F5_LIMIT` and the same completed-work
  ledger; no second child adoption is present.

### [F5-A3-E3] Source-sort work

- Two otherwise equal module graphs differ only by sorted versus reverse
  source discovery order.
- The reverse case has the exact comparison/move delta in the public receipt.
- A failure after source sorting retains that delta.

### [F5-A3-E4] Binding and symbol codec work

- Extend one binding or symbol field by a known scalar delta without changing
  row cardinality.
- Public work increases by the exact codec delta.
- Exact cap admits; one-under returns atomic `F5_LIMIT` unless a simultaneous
  authenticated drift must win.

### [F5-A3-E5] Cumulative module failures

- Compare the same failure in the first and second module.
- The second-module failure includes the first completed module's exact work.
- Compare early and late export/source/binding failures in one module.
- The late failure includes every completed preceding sibling exactly once.

### [F5-A3-E6] Copy-pass parity

- Constructor sizes 0, 1, 2, 3, 4, and 5 pin exact merge/consolidation work.
- A source guard pairs every post-gate row/result read with its prospective
  pre-gate charge.
- Canonical bytes stay byte-identical for every case.

### [F5-A3-E7] Tree scan work

- Add one irrelevant but authenticated presence, occurrence, attachment, or
  decorator row through an existing private F4 mutation seam.
- The tree result work changes by the exact physical scan/codec delta while KIR
  bytes stay unchanged.
- Early versus late tree drift reports distinct cumulative work.
- The F5 root no longer calls `f5worklength` for semantic tapes.

### [F5-A3-E8] Precedence and atomicity

- Every corrected family has unlimited, exact-cap, and one-under executions.
- Structural/authority/duplicate drift beats the lower cap with identical code
  and completed work.
- Pure resource crossings return atomic `F5_LIMIT` with empty instructions.

### [F5-A3-E9] Source closure

Composition-wide structural guards reject:

- a caller adopting the same `child[3]` twice;
- `f5rowread` without codec or explicit prospective pairing;
- workless sentinels on metric-bearing tree/module paths;
- post-gate work changes;
- direct `List.join` or unbounded growing-prefix writers;
- parallel sorted payload arrays or metric tuples.

## Implementation boundary

Expected production paths:

- `examples/kern-frontend/f5-canonical-instructions.kern`;
- `examples/kern-frontend/f5-charged-sort.kern`;
- `examples/kern-frontend/f5-ordinal-composites.kern`;
- `examples/kern-frontend/f5-expression-projection.kern`;
- `examples/kern-frontend/f5-tree-projection.kern`;
- `examples/kern-frontend/f5-module-projection.kern`;
- `examples/kern-frontend/f5-projection-main.kern`;
- F5 policy validation and descriptor SHA pins;
- focused F5 evidence tests.

No handwritten file may reach 500 lines. If a file would cross the boundary,
extract a single-purpose helper module and pin it in the composition policy.

## Acceptance gates

1. Each E1–E9 RED fails at the signed baseline for its named reason.
2. Focused accounting and source-wall tests pass.
3. Complete `test:kern-frontend-f5-projection` passes.
4. Affected complete F4 gate passes.
5. Lint, build, core tests, repo consistency, exact policy path/order/SHA
   validation, and deterministic authority regeneration pass.
6. Canonical KIR bytes and all non-work metrics remain byte-for-byte stable.
7. Independent high-risk role review reports no verified blocker.

## Kill criteria

Stop and return to the signed checkpoint if:

- a RED fails for a different stage or generic runtime setup;
- a canonical instruction byte or non-work metric changes;
- drift-before-limit changes;
- a child result is adopted twice or omitted;
- copy pricing cannot be paired with materialization;
- a workless sentinel remains on a metric-bearing path;
- a new policy/schema/public ABI field is required;
- a handwritten file reaches 500 lines;
- a focused repair needs unrelated F4, KIR, runtime, or release changes.
