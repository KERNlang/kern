# KERN 5 Frontend F3 Logical-Line and Tree Contract

**Status:** DECIDED; IMPLEMENTATION PENDING

**Date:** 2026-08-20

**Parent contracts:**

- `.Codex/specs/kern-5-frontend-surface-closure/spec.md`
- `.Codex/specs/kern-5-f1-production-scanner/spec.md`
- `.Codex/specs/kern-5-f2-expression-parser/spec.md`
- `.Codex/specs/kern-5-f2-document-batch/spec.md`
- `.Codex/specs/kern-5-post-m4-171-completion/spec.md`

**Decision tribunal:**
`/Users/nicolascukas/.agon/runs/tribunal-1787221353486-k767zd`

**Conflict-resolution brainstorm:**
`/Users/nicolascukas/.agon/runs/brainstorm-1787221740211-i8xxeu`

**Confidence:** 0.93

## Decision

F3 is the sole KERN owner of document-to-logical-line framing and geometric
tree topology. One authenticated KERN handler consumes the exact source, the
authenticated F1 physical-record evidence, and the accepted F2B segment
geometry. It emits bounded logical-line, parent-edge, decorator-adjacency,
raw-block, and structural-diagnostic tapes under one terminal seal.

F3 does not parse declaration grammar, properties, defaults, modules, node
schema, expression payloads, or KIR fields. F4 consumes F3 rows and decides
which declaration roles are valid, including whether a provisional decorator
successor is a legal `fn` target. F5 alone selects canonical KIR fields.

## F0 Interpretive Addendum

- **[F3-I1 DECIDED]** The frozen F0 closure ledger SHA-256 is
  `bf5d6ce132e3173de8c14af3b78c84e740928bea86dcd755fb9e311b1794b69a`.
  Its bytes remain unchanged.
- **[F3-I2 DECIDED]** The ledger phrase `same-indent-next-fn` describes the
  committed F3+F4 outcome. It does not require F3 to classify declaration
  keywords.
- **[F3-I3 DECIDED]** F3 emits a provisional decorator adjacency only to the
  immediate next semantic row when it has the same indent. Otherwise it emits
  a geometric-orphan disposition. F4 consumes either disposition and is the
  sole emitter of the frozen `DROPPED_DECORATOR` diagnostic.
- **[F3-I4 DECIDED]** No new public diagnostic code, F0 ledger mutation, or
  golden rewrite is authorized. If future governance rules that F0 binds
  phase-internal bytes, work stops for append-only supersession; in-place
  ledger editing is forbidden.

The boundary invariant is: **layout decides adjacency; grammar decides
admission**. Replacing a decorator successor's declaration keyword while
preserving its physical geometry must leave the F3 projection byte-identical.

## Claims

- **[F3-C1 VERIFIED]** F1 already owns the exact physical source partition,
  newline terminators, comments, quoted/expression continuation flags, fence
  markers/bodies, Unicode-scalar spans, and atomic lexical failures.
- **[F3-C2 VERIFIED]** F2B already binds every expression segment to F1 record
  ordinals and absolute document spans under one ordered batch result.
- **[F3-C3 DECIDED]** F3 may inspect F1 record kind, flags, raw source slice,
  ordinal, and span only. It may inspect F2B segment ordinals and geometry but
  never node kinds, node payloads, operators, or F2 receipt contents.
- **[F3-C4 DECIDED]** Blank and comment-only physical lines remain authenticated
  F1 evidence but do not become semantic logical-line rows and do not reset
  indentation state.
- **[F3-C5 DECIDED]** A quoted or expression continuation forms one logical row
  spanning its first through final physical line. A recognized fence owner and
  its closed fence body form one raw-owner row plus one raw-block row.
- **[F3-C6 DECIDED]** Decorator rows are excluded from the indentation parent
  stack. Their eventual tree membership is an F4 decision over the immutable
  provisional adjacency tape.
- **[F3-C7 DECIDED]** Non-decorator semantic rows attach to the nearest prior
  non-decorator row with lower indentation, or to the document root when none
  exists. Child order is source order and cannot be sorted afterward.
- **[F3-C8 DECIDED]** Dedent to an indentation width not previously observed
  emits `INDENT_JUMP` at the affected row without changing the deterministic
  nearest-lower-indent parent edge.
- **[F3-C9 DECIDED]** F3 remains `internal-oracle`. It does not promote
  `test:kern-frontend` or the `kern-frontend` ownership row.

## Inputs and Authentication

The host worker performs no semantic classification. It:

1. runs the authenticated F1 scanner exactly once;
2. passes that same F1 result into F2B without rescanning;
3. rejects if either prerequisite fails;
4. passes exact F1 record geometry/kinds/flags and exact F2B segment geometry
   into one `structuref3document` KERN invocation; and
5. strictly decodes and replays standalone receipts under the same effective
   policy, matching the F2B verification model.

KERN independently proves that record ordinals are contiguous, spans partition
the source, raw values equal their source slices, composite modes close, every
F2B segment matches an F1 expression run, and every expression is contained in
exactly one logical row.

## Success Protocol

The KERN result is a fixed thirteen-field list:

1. format;
2. status;
3. structural diagnostic tape;
4. source scalar count;
5. logical-line count;
6. parent-edge count;
7. decorator-run count;
8. raw-block count;
9. logical-line tape;
10. parent-edge tape;
11. decorator-adjacency tape;
12. raw-block tape; and
13. structural seal.

All nested rows are scalar-length-framed and appear in source order.

### Logical-line row

Each row has exactly twelve fields:

1. logical ordinal;
2. first F1 record ordinal;
3. last F1 record ordinal;
4. source start scalar;
5. source end scalar excluding the final physical terminator;
6. first physical line, one-based;
7. last physical line, one-based;
8. indent scalar count;
9. content start scalar;
10. closed framing role: `ordinary`, `decorator`, `raw-owner`, or `error`;
11. first contained F2B segment ordinal, or `-1`; and
12. contained F2B segment count.

Rows contain no declaration keyword, name, export flag, property, default,
module, node-schema, expression-node, or KIR field.

### Parent-edge row

Each non-decorator logical row has one four-field edge:

1. child logical ordinal;
2. parent logical ordinal, or `-1` for document root;
3. child indent; and
4. parent indent, or `-1` for document root.

The edge tape is a preorder source projection. A parent ordinal is always less
than its child ordinal.

### Decorator-adjacency row

Consecutive decorator rows with identical indentation form one five-field run:

1. run ordinal;
2. first decorator logical ordinal;
3. last decorator logical ordinal;
4. immediate successor logical ordinal, or `-1`; and
5. disposition: `candidate`, `orphan-eof`, or `orphan-indent`.

`candidate` requires only immediate semantic succession and equal indentation.
It is invariant under every successor source substitution that preserves row
geometry. No F3 branch may inspect the successor's first token.

### Raw-block row

Each recognized raw owner has exactly eight fields:

1. raw ordinal;
2. owner logical ordinal;
3. opener F1 record ordinal;
4. closer F1 record ordinal;
5. body start scalar;
6. body end scalar;
7. inline flag; and
8. recognized multiline type.

F3 recognizes the type only against the authenticated runtime registry
snapshot. It does not interpret or admit the body. F5 retains the frozen
fail-closed `FRONTEND_EXCLUDED_RAW_BLOCK` disposition where applicable.

## Structural Diagnostics

Successful F3 receipts may carry ordered, recoverable structural diagnostics:

- `INVALID_INDENT` for a tab in leading indentation;
- `DROPPED_LINE` when a nonblank, noncomment, nondecorator, non-raw row does not
  begin with an F1 identifier token; and
- `INDENT_JUMP` for dedent to a previously unseen indentation width.

Decorator orphan status remains in the adjacency tape. F4 alone turns a
geometric orphan or invalid target into `DROPPED_DECORATOR`, preserving the F0
catalog and end-to-end ordering contract.

Malformed requests, prerequisite drift, limit exhaustion, receipt mismatch,
or a forced late failure produce an atomic failure with empty success tapes.
The closed failure codes are `F3_INVALID_REQUEST`, `F3_LIMIT`,
`F3_F1_DRIFT`, `F3_F2B_DRIFT`, and test-only `FORCED_LATE_FAILURE`.

## Resource Contract

Policy owns downward-only ceilings for F1 records, logical rows, parent edges,
decorator runs, raw blocks, structural diagnostics, work steps, encoded bytes,
elapsed time, and peak RSS. F1/F2B retain their own source and expression
ceilings. The runtime envelope separately owns collection, depth, event, and
string bounds.

Charging is monotone: one unit per F1 record visit, logical row, edge,
decorator-run transition, raw row, diagnostic, and F2B segment binding. F3 uses
one forward record pass, one indentation stack, one pending decorator run, and
no whole-document substring search or post-hoc sort.

The gate includes 1x/2x/4x/8x depth, sibling, continuation, decorator, and raw
families plus an exact maximum-density document that remains below inherited
F1/F2B caps.

## Binary Acceptance

- **[F3-A1]** RED at the accepted F2B baseline is the missing
  `test:kern-frontend-f3-line-tree` script and protocol assets.
- **[F3-A2]** Hand-authored LF, CRLF, astral, blank/comment, quote/expression
  continuation, tab-indent, unseen-dedent, decorator-run, inline/multiline raw,
  and malformed-line fixtures match an independent geometric oracle.
- **[F3-A3]** Every F2B segment is bound exactly once to the containing logical
  row; crossing, missing, duplicated, reordered, or stale segments reject.
- **[F3-A4]** Parent edges match an independent nearest-lower-indent stack,
  preserve source order, and reject reordered, cyclic, forward, or skipped
  edges.
- **[F3-A5]** Decorator role-substitution and suffix-opacity metamorphics prove
  byte-identical F3 output for geometry-identical `fn`, `let`, `type`, unknown,
  and modifier-prefixed successor lines.
- **[F3-A6]** EOF, indent mismatch, intervening-row, and multiple-decorator
  fixtures prove exact candidate/orphan dispositions without emitting
  `DROPPED_DECORATOR` in F3.
- **[F3-A7]** Raw-block fixtures prove exact owner/opener/closer/body spans and
  registry-dependent recognition without inspecting body semantics.
- **[F3-A8]** Mutations kill host/TypeScript parse delegation, first-token target
  predicates, source searching, stale F1/F2B evidence, stack corruption,
  post-hoc sorting, partial failure, unchecked limits, and seal drift.
- **[F3-A9]** Scaling walls prove bounded adjacent ratios, absolute time,
  encoded bytes, and peak RSS under one F3 runtime invocation.
- **[F3-A10]** Focused F1, F2, F2B, F3, runtime ABI, source-runner,
  canonicalizer, checker, formatter, lint, and cumulative promoted fitness
  gates pass before promotion.
- **[F3-A11]** Independent automatic-risk Agon review has no unresolved verified
  blocker. F3 is current/internal-oracle while F4-F7 and all six terminal gates
  remain planned.

## Kill Switches

Stop the slice if any of these becomes necessary:

1. F3 output changes when only a decorator successor's declaration keyword or
   suffix changes at identical geometry.
2. F3 emits `DROPPED_DECORATOR` or decides target legality.
3. Host code classifies logical lines, indentation parents, decorators, or raw
   blocks.
4. F3 inspects F2 node kinds, payloads, operators, or receipt internals.
5. Any F1 record or F2B segment is silently skipped, duplicated, or reordered.
6. Tree edges require post-hoc sorting or parent mutation.
7. Raw bodies are interpreted, admitted, or copied into KIR.
8. F3 requires a public parser/KIR API, a new public diagnostic code, or a
   mutation of the frozen F0 ledger.
9. A failed request exposes a partial line, edge, decorator, or raw tape.
10. F3 implementation requires generated-target or bootstrap-parser parity to
    define correctness.

## Out of Scope

- Declaration/property/default/module parsing and decorator-target admission
  (F4).
- KIR field selection, exclusions, defaults, canonical ordering, and emission
  (F5).
- Full ledger adversarial closure (F6), terminal frontend promotion (F7), and
  every compiler/fixed-point/interpreter/cutover/release phase.

## Delivery Order

1. Land RED protocol, role-invariance, and geometry-oracle tests.
2. Reuse one authenticated F1 scan through F2B and implement the KERN F3
   handler plus strict decoder.
3. Close mutations, raw/decorator edges, limits, and scaling.
4. Run focused and cumulative gates plus independent automatic-risk review.
5. Only then write F4 against the immutable accepted F3 tapes.
