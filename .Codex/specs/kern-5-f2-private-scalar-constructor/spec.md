# KERN 5 F2 Private Scalar Constructor

**Status:** READY TO BUILD — TRIBUNAL AND NERO RESOLVED

**Date:** 2026-08-16

**Baseline:** `7efa4c3a7fe134e3f269a161c92d94a86ad7e064`

**Tribunal:**
`/Users/nicolascukas/.agon/runs/tribunal-1786898800775-f2pykh`

**Nero challenge:**
`/Users/nicolascukas/.agon/runs/nero-1786899041359-ewluf5`

**Confidence:** 0.94 after rejecting both deferred code-point tape and
`Json.parse` reuse

## Problem and evidence

- **[VERIFIED]** F2 must turn `\\xHH`, `\\uHHHH`, valid escaped surrogate
  pairs, and `\\u{...}` into decoded Unicode-scalar text without source access
  in F5. Evidence: F2 source ledger `text.escapes` and node kind 5 payload.
- **[VERIFIED]** Production KERN can only derive Text through literals,
  concatenation, and substring-closed `Text` operations. A scalar absent from
  the input cannot be synthesized. Evidence:
  `packages/core/src/codegen/text-contract.ts` and
  `packages/core/src/ir/semantics/portable-string.ts`.
- **[VERIFIED]** `Json.parse` is not a portable substitute. CPython preserves
  JSON escaped surrogate pairs as two surrogate code points, while JavaScript
  produces one well-formed UTF-16 pair; attaching a scalar-only contract would
  also contradict the existing general JSON lowering. Evidence: Nero run.
- **[DECIDED]** Add one reserved compiler/runtime lowering,
  `KernInternal.textFromScalar(value)`, solely as the scalar-to-Text bridge for
  authenticated KERN-owned frontend modules.

## Contract

`KernInternal.textFromScalar(value)`:

- accepts exactly one Number that is a safe integer;
- accepts the closed range `0..0x10FFFF` except `0xD800..0xDFFF`;
- returns a Text containing exactly one Unicode scalar;
- rejects booleans, non-numbers, fractions, infinities, negatives, values above
  `0x10FFFF`, and every surrogate code point with a stable portable diagnostic;
- performs constant bounded work and allocates exactly one scalar of output;
- is an unshadowed reserved namespace operation and is not a documented public
  stdlib commitment or user-facing expression feature;
- has byte-equivalent semantics in ReferenceRunner, emitted TypeScript, and
  emitted Python.

F2 remains the semantic authority. It validates hexadecimal width, range,
surrogate pairing, and escape spelling before calling the constructor. The
constructor does not parse source, classify escapes, inspect F2 nodes, or admit
malformed input; it only converts one already-validated scalar integer.

The TypeScript lowering is a guarded `String.fromCodePoint(value)`. The Python
lowering is a guarded `chr(value)`. The ReferenceRunner performs the identical
predicate before `String.fromCodePoint`. The existing text-helper preambles
carry the emitted guards so no new public host capability or runtime handler
argument is introduced.

## Acceptance criteria

- [ ] **[SC-A1]** RED proves the current ReferenceRunner rejects the reserved
      call and current codegen has no lowering.
- [ ] **[SC-A2]** Boundary parity succeeds at `0`, `0xD7FF`, `0xE000`, and
      `0x10FFFF`, including an astral result of scalar length one.
- [ ] **[SC-A3]** `-1`, `0x110000`, `0xD800`, `0xDFFF`, a fraction, infinity,
      boolean, and text reject on all executable legs.
- [ ] **[SC-A4]** TypeScript and Python emit their guarded private helper and
      return the same scalar for the same accepted integer.
- [ ] **[SC-A5]** Existing five-operation public Text tests and source-runner
      convergence remain green.
- [ ] **[SC-A6]** Independent Agon review finds no unresolved verified blocker.

## Rejected alternatives

- A private code-point tape only moves the mandatory integer-to-scalar bridge
  into F5 and breaks the reviewed decoded-text payload.
- Narrowing escapes contradicts the authenticated F2 source grammar.
- `Json.parse` has cross-target surrogate divergence, general-parser resource
  exposure, and incompatible public result semantics.
- A host-predecoded handler argument delegates F2 semantic ownership and is
  prohibited.
