# KERN 5 F5 Review Amendment 1

**Status:** DECIDED — RED WALL REQUIRED BEFORE REPAIR
**Date:** 2026-08-23
**Rejected baseline:** `3ae1a6b4`
**Review:** `review-1787472091415-i7r84v-kern5-f5-integrated-review`
**Tribunal:** `tribunal-1787472834618-pkofpb-kern5-f5-blocker-adjudication`
**Parent contract:** `.Codex/specs/kern-5-f5-kir-projection/spec.md`

The integrated high-risk review and follow-up tribunal unanimously confirmed
seven contract blockers: incomplete raw-F4 consistency checks, unbounded
growing-prefix output, unsorted record expressions, mismatched Unicode ordering,
context-free handler-type lowering, incomplete branch/each lowering, and
empty-sentinel failures misclassified as `F5_LIMIT`. This amendment is
normative and supersedes any earlier ambiguous remedy wording.

## [F5-R1 DECIDED] Exact private KERN ABI

`projectf5moduleset` has exactly eleven positional inputs, in this order:

1. ordered request `moduleIds`;
2. flattened raw F4A `documentFields`;
3. ordered opaque `documentReceiptSeals` produced by the already-validated F4A
   host boundary;
4. raw F4B `moduleSetFields`;
5. `maxModules`;
6. `maxInstructionScalars`;
7. `maxWorkSteps`;
8. `maxNodes`;
9. `maxDepth`;
10. `maxCollectionLength`;
11. `maxStringCodePoints`.

These are the seven existing F5 profile limits, not a policy expansion. Canonical
encoded-byte admission remains the mechanical host codec's separately pinned
`canonicalLimits.maxBytes` responsibility. No source text, decoded semantic
rows, host-built KIR, or additional evidence-free capacity enters KERN.

## [F5-R2 DECIDED] Raw F4 producer-consistency boundary

KERN performs all consistency checks before projection or resource-limit
classification:

- every F4A record has exactly 17 scalar fields; its format, status, module ID,
  integers, framed tapes, row arities, and terminal descriptor are validated;
- F4A field 16 is a structural `document:...:closed` descriptor. KERN
  reconstructs it from the raw field/tape scalar lengths and aggregate fields;
- F4B has exactly 10 scalar fields; its linked-success partitions, framed row
  shapes, identities, binding/component structure, and field-9 terminal
  descriptor are reconstructed from the raw fields;
- each F4B field-7 identity row is positionally equal to the matching request
  module ID, F4A fields 2/0/1, and the matching opaque
  `documentReceiptSeals[index]`;
- the structural F4A terminal descriptor is never compared to an F4B receipt
  seal. They are different types;
- KERN never computes SHA-256. The opaque seals are host-authenticated framing
  values used only for equality binding, not semantic selection or a security
  claim.

Any deletion, duplication, reorder, substitution, cardinality mismatch, invalid
row shape, terminal mismatch, or identity/seal mismatch in raw F4 input returns
one atomic `F5_F4_DRIFT` result before ordinary limits are considered.

## [F5-R3 DECIDED] Error precedence and typed internal results

The fixed order is:

1. infrastructure/runtime/codec failure throws outward with no forged F5
   receipt;
2. public F4 fatal/rejected diagnostics return before F5 execution;
3. `F5_F4_DRIFT` for malformed or contradictory authenticated F4 transport;
4. `F5_AUTHORITY_DRIFT` for an impossible F5 state or a value outside the
   pinned translation authority;
5. `F5_LIMIT` for a valid unit whose prospective debit crosses a configured
   limit;
6. `projected`.

Each bounded unit is structurally validated first and only then debited. Drift
therefore beats a simultaneous limit crossing. Projection helpers return an
explicit typed status/code/value/accounting tuple; the empty string is never a
shared failure sentinel and can never be reclassified as `F5_LIMIT`.

Upstream-tape contradictions such as duplicate expression record keys,
duplicate decorator attachment, missing referenced rows, and invalid canonical
numbers are `F5_F4_DRIFT`. Translation-domain contradictions such as a
non-portable handler type or unsupported branch/each source are
`F5_AUTHORITY_DRIFT`.

## [F5-R4 DECIDED] Canonical scalar ordering and record construction

One KERN-owned scalar comparator is used by module, import, export, binding,
property, and expression-record ordering. It compares Unicode scalar values
lexicographically and then length; it never compares UTF-16 code units or uses
locale order. The host instruction decoder uses the pinned core
`compareCodePoints` authority or an exact mechanically tested equivalent.

Expression record entries are validated for equal key/value cardinality,
unique keys, and then sorted by that comparator before instruction emission.
Source order is not canonical order. The discriminating order is
`U+E000 < U+10000 < U+1F600`, with prefix ordering such as
`"a" < "a\u{10000}"`.

## [F5-R5 DECIDED] Exact property-lowering authority

Handler types retain their position. Parameters admit only `boolean`, `number`,
`string`, and lists of those scalar types. Returns admit the same set plus
`void`; `void` is never a parameter or list element. `unknown`, `json`, and
arbitrary list elements are outside the pinned portable-handler domain.

Quoted branch paths preserve text. Unquoted branch paths are exactly a bare
identifier or canonical finite integer/decimal source, excluding negative zero.
Each collection references are exactly the mapping authority's canonical bare
binding or non-optional bare-record member form. The canonical source and form
must agree. KERN validates these rules before emission; discard-only
`decodeModuleKir` is not a semantic fallback. Decimal `-0.0` and any all-zero
negative decimal are invalid, while `-0.1` is canonical.

## [F5-R6 DECIDED] Prospective staged builder

All canonical leaves and collection/record boundaries carry explicit node,
depth, collection, string-scalar, instruction-scalar, copied-scalar, and work
accounting. The builder validates a unit, computes its exact debit, checks every
relevant configured cap, and only then retains it. `maxModules` is checked
before reading document fields. Sort comparisons and moves, F4 rows, and copied
instruction scalars are charged.

Unbounded `out = out + part` loops are forbidden. Instruction parts are folded
with a portable charged balanced fold (or an equivalent bounded pull cursor)
that checks dynamic `Map.get` ownership with local `Map.has` provenance. The
whole artifact remains staged and atomic; no partial instruction stream or
encoded bytes are observable on failure.

## [F5-R7 DECIDED] RED wall before repair

The review repair starts only after executable REDs prove all of the following
against `3ae1a6b4` for the stated reason:

1. shape-preserving mutations across F4A fields 3-16 and F4B fields 2-9,
   document-seal permutation, and seal/cardinality mismatch return atomic
   `F5_F4_DRIFT` before a simultaneous low limit;
2. `{z: 1, a: 2}` emits `a,z`; a duplicate record key returns drift;
3. KERN and JS agree on BMP/astral/prefix scalar ordering;
4. parameter `void`, `unknown`, `json`, and invalid lists return
   `F5_AUTHORITY_DRIFT`, while return `void` remains projected;
5. invalid unquoted branch and each references return `F5_AUTHORITY_DRIFT`,
   while exact canonical forms remain byte-equal to the pinned TypeScript
   oracle;
6. a duplicate attached decorator and another impossible-state sentinel return
   drift even under a lower resource cap;
7. exact and one-over module, instruction-scalar, work, node, depth, collection,
   and string-scalar limits discriminate atomically;
8. 1x/2x/4x/8x growth proves the charged scaling envelope and the source guard
   rejects every unbounded growing-prefix writer.

## Kill Criteria

The repair is killed if it adds SHA-256 inside KERN, compares F4A field 16 to a
receipt seal, adds an eighth profile limit, consumes decoded F4 semantics,
changes F4/KIR/F5 formats, weakens error precedence, leaves a production file
at 500 lines or more, or cannot make a RED fail for its claimed reason.
