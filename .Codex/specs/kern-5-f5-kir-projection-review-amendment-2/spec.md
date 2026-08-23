# KERN 5 F5 Review Amendment 2

**Status:** DECIDED — READY TO BUILD
**Date:** 2026-08-23
**Confidence:** 0.93
**Parent contract:** `.Codex/specs/kern-5-f5-kir-projection/spec.md`
**Amendment 1:** `.Codex/specs/kern-5-f5-kir-projection-review-amendment/spec.md`
**Rejected draft:** `review-1787477353677-89fn07`
**Tribunal:** `tribunal-1787477976832-r2kw5d`

## Executive Summary

The first repair draft measured a completely retained instruction artifact after
construction. That cannot enforce prospective resource admission, omitted
integer and decimal payloads from `maxStringCodePoints`, and left module sorting
and binding scans uncharged. This amendment replaces that design with one
KERN-owned framed result tape whose metrics are computed by every constructor
before its result is retained. A helper may expose an ephemeral nine-field tuple
while executing, but no tuple or parallel metric array may be stored between
constructor calls.

## [F5-R8 VERIFIED] Rejected post-hoc design

The post-hoc `f5measureinstructions(artifact, 0)` design is not an acceptance
owner. It allocates and retains the attacker-controlled artifact before checking
the seven profile limits, and its parser can fail before KERN returns the
required atomic `F5_LIMIT`. The implementation must delete that scanner and any
root estimate such as `requiredNodes = moduleCount + 1` after constructor-owned
metrics are green.

Review evidence: `review-1787477353677-89fn07` reached consensus on the
pre-admission allocation defect, omitted numeric payload lengths, and uncharged
sort/binding work. The exact live draft demonstrated the integer case by letting
a 50-scalar integer reach the host decoder under a 32-scalar string cap.

## [F5-R9 DECIDED] Retained result representation

Every retained constructor result is one scalar frame:

```text
status\x1Fcode\x1FinstructionScalars\x1Fwork\x1Fnodes\x1Fdepth\x1FmaxCollection\x1FmaxString\x1Flen#text\x1E
```

The fields are:

1. `status`: `0` success, `1` limit, `2` drift;
2. `code`: empty on success, otherwise the exact fatal code;
3. `instructionScalars`;
4. `work` incurred through success or failure discovery;
5. `nodes`;
6. `depth`;
7. `maxCollection`;
8. `maxString`;
9. `len#text`, where `len` is the Unicode-scalar length of `text`.

All numeric fields are checked canonical unsigned integers. A reader consumes
exactly `len` Unicode scalars, requires the terminal record separator, and
rejects trailing material as `F5_F4_DRIFT`. A failure has empty text and zero
instruction/node/depth/collection/string metrics. A helper may decode the frame
to an ephemeral nine-slot scalar tuple, but no tuple or seven parallel metric
arrays may be pushed into an authored array. A composite retains exactly one
frame per child.

The payload is eagerly materialized canonical instruction text. It may not
contain a source slice, span, thunk, deferred child reference, compression
descriptor, host pointer, native word, or target-dependent binary layout.
Downstream consumers only decode and copy the already-materialized payload;
they perform no delayed projection, sorting, or metric-bearing construction.

Codec work is explicit: decoding charges the scanned header and copied payload;
encoding charges the produced frame scalars. These charges are included before
the parent commits the child frame.

## [F5-R10 DECIDED] Exact constructor metrics

Let `cp(s)` be Unicode-scalar length and `digits(n)` the scalar length of the
canonical decimal spelling of `n`.

Leaf values:

```text
null:        text=N,                 I=1, W=1, N=1, D=1, C=0, S=0
bool:        text=B0|B1,             I=2, W=1, N=1, D=1, C=0, S=0
int/decimal/text(p):
             text=tag+digits(cp(p))+":"+p
             I=2+digits(cp(p))+cp(p), W=1, N=1, D=1, C=0, S=cp(p)
```

For a list of `M` children:

```text
text = "L" + M + "[" + concat(childText) + "]"
I = 3 + digits(M) + sum(childI)
N = 1 + sum(childN)
D = M == 0 ? 1 : 1 + max(childD)
C = max(M, childC...)
S = M == 0 ? 0 : max(childS)
```

For a record of `K` sorted entries:

```text
keyFrame(k) = "K" + digits(cp(k)) + ":" + k
text = "R" + K + "{" + concat(keyFrame(k) + childText) + "}"
I = 3 + digits(K) + sum(2 + digits(cp(k)) + cp(k) + childI)
N = 1 + sum(childN)
D = K == 0 ? 1 : 1 + max(childD)
C = max(K, childC...)
S = max(cp(k)..., childS...)
```

Integer, decimal, text, and record-key payloads contribute to `S`; structural
syntax, booleans, and null do not. Keys are not instruction nodes. `C` is the
largest individual collection, not a sum. The decoder starts root depth at one,
so the builder and `validate.ts` agree.

`W` is deterministic event work, not wall time. It includes child work, F4 rows
and binding entries examined, duplicate probes, Unicode scalars inspected in
record/module comparisons through first difference or exhaustion, order moves,
codec scans/copies, and balanced-fold instruction copies. The contract does not
claim `K log K`; it charges the operations actually performed.

## [F5-R11 DECIDED] Prospective admission and precedence

Each constructor performs these steps in order:

1. decode and validate every input frame;
2. compute the complete candidate text and metrics in local scalars/frames;
3. finish shape, reference, duplicate, order, and translation-domain checks;
4. return drift when any such check fails;
5. compare every candidate metric with its configured limit and return
   `F5_LIMIT` on the first crossing;
6. commit the one result frame to its parent only after all checks pass.

No parent array, map, output part list, or accumulator retains a candidate before
step 6. Drift therefore beats a simultaneous low resource cap. The public error
order from Amendment 1 remains unchanged. Host `StructuralKirError` is not
caught and converted into an authored diagnostic; KERN must classify every
ordinary semantic rejection before the discard-only host validator.

Exactly one successful root frame is admitted. A second root or trailing
instruction material is `F5_F4_DRIFT`. The emitted success payload must remain
byte-for-byte equal to the pinned TypeScript canonical encoder.

Scratch state is bounded and owned by the current admitted unit: at most one
frame per child, one scalar order index per child when sorting, logarithmic fold
buckets, and scalar counters. No second full instruction artifact, recursive
host stack, radix bucket family, or unbounded temporary copy is permitted. Copy
work charges every materialized scalar even when the final retained payload is
smaller than the aggregate scratch traffic.

## [F5-R12 DECIDED] Canonical ordering work

Record, module, import, export, binding, property, and expression-record order
use the already-proven KERN Unicode-scalar comparator. Sorting moves a single
frame array (record entries retain `keyFrame + valueText` in one frame), not
parallel arrays. Every comparison and move is charged before the sorted result
is retained. Duplicate keys and contradictory bindings are drift, not limits.

## [F5-R13 VERIFIED] Private ABI and public formats stay fixed

The exact private KERN ABI remains the eleven inputs from Amendment 1. The seven
profile fields and their policy values stay unchanged. No SHA-256, eighth limit,
decoded host KIR, or source text enters KERN. F4, KIR, F5 receipt, policy, and
public worker formats do not change; only composition content hashes and the
full policy/cache identity change atomically.

## Implementation Layout

The preferred split is:

- `f5-result-frame.kern`: canonical uint, frame encode/decode, checked math;
- `f5-leaf-instructions.kern`: null/bool/int/decimal/text/key constructors;
- `f5-charged-sort.kern`: scalar comparisons, duplicate checks, moves;
- `f5-composite-instructions.kern`: prospective list/record construction;
- existing expression/property/tree/module sources: call-site migration;
- `f5-projection-main.kern`: exact one-root admission and final frame return.

Names may vary, but every handwritten file remains below 500 lines. Existing
portable `Map.has` provenance rules and charged balanced-fold patterns are
mandatory. A direct `List.join` or dynamic `Map.get` without a same-key local
`Map.has` guard is forbidden.

## Acceptance Criteria

- [ ] The framing wall rejects malformed width, number, length, trailing bytes,
      empty-sentinel failures, and child-frame skew before limits.
- [ ] Every canonical fixture emits byte-identical instructions before and
      after the migration.
- [ ] Exact and one-under limits discriminate modules, instruction scalars,
      work, nodes, depth, collection length, and string scalars atomically.
- [ ] A 50-scalar integer, decimal, text, and record key each return `F5_LIMIT`
      under `maxStringCodePoints=32` before host decoding.
- [ ] Node/depth/collection metrics equal an independent decoded-KIR walk; the
      one-under cap for each returns atomic `F5_LIMIT`.
- [ ] Sort, binding, F4-row, codec, and fold work is positive and changes by the
      exact tested operation delta; deterministic 1x/2x/4x/8x work bounds replace
      wall-clock assertions.
- [ ] Sorted, reverse-sorted, rotated, duplicate, astral/BMP, and long
      equal-prefix record/module inputs prove comparison and move charging; no
      fixture-specific monotonic fast path can satisfy every expected delta.
- [ ] Every success frame decodes to the exact full independent TypeScript KIR
      and re-encodes byte-identically; omitted, duplicated, reordered, truncated,
      or deferred children fail the parity/shape oracle.
- [ ] A valid unit with both a drift mutation and a lower cap returns the drift
      code.
- [ ] Source guards reject post-hoc measurement, unbounded growing-prefix
      writers, retained metric tuples/parallel arrays, deferred payload
      descriptors, oversized scratch structures, and commits before gates.
- [ ] Focused framing, semantic, resource, policy, and parity walls pass, then
      the complete F5 and affected F4 suites pass.

## Kill Criteria

Kill the repair if it retains a full unmeasured artifact, catches host
`StructuralKirError` as an F5 receipt, omits numeric/key payloads from `S`, uses
post-hoc metrics as acceptance authority, changes a public format/ABI, weakens
drift-before-limit precedence, or leaves any handwritten source at 500 lines or
more.

## Corrections Log

| Earlier claim | Corrected contract | Impact |
|---|---|---|
| A post-hoc instruction scanner can enforce limits. | Every constructor must measure and gate before retention. | The first repair draft is rejected. |
| A nested tuple can be retained portably. | Only one scalar frame is retained; tuples are ephemeral. | Prevents child text/metric skew. |
| `maxString` covers text only. | Integer, decimal, text, and record keys contribute. | Closes host-decoder escape. |
| Total module/root estimates are sufficient. | Metrics are inductive from one admitted root. | Exact nodes/depth/collection become testable. |
