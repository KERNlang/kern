# KERN 5 R1.5d Diagnostic and Location Evidence

## Status

R1.5d.1 implementation contract. This is an internal evidence format and does
not freeze or export KIR v1. **DECIDED**

## Baseline

- The accepted R1.5c.4 baseline is commit
  `4345084846ca794456daad65ecf1a094382cd503`. **VERIFIED**
- Structural module KIR remains `kern.kir.modules.r1.5c.3-alpha`, requires an
  empty diagnostics array, and omits node locations from semantic bytes.
  **VERIFIED**
- Eligibility defines locations as zero-based UTF-8 byte offsets with half-open
  ends and requires the evidence envelope to be versioned separately.
  **VERIFIED**
- `IRSourceLocation` and parse diagnostics use line/column data. They are not
  accepted directly as portable evidence. **VERIFIED**

## Decision Evidence

Agon tribunal `tribunal-1783855159806-73uj4m` completed 3/3 on 2026-07-12.
It rejected checked-in self-SHA manifests and selected two serial slices:
R1.5d.1 evidence codec, then R1.5d.2 clean-HEAD manifest generation.
**VERIFIED**

Initial Agon review `review-1783856003524-1o3xwg-r1-5d1-initial`
completed 3/3 with zero verified findings. Its containment nit was hardened,
and an explicit multi-module ordering witness was added. **VERIFIED**

Final Agon review `review-1783858897204-mjbt8d-r1-5d1-final` found one
verified expression-source binding gap. The exact source bytes are now
reprojected and compared to the bound canonical expression. Final fixed review
`review-1783860568036-cqywpu-r1-5d1-final-fixed` completed 3/3 with zero
verified findings. **VERIFIED**

## R1.5d.1 Contract

### Envelope

The exact internal format is `kern.kir.evidence.r1.5d.1-alpha`. It contains:

- a SHA-256 and exact format binding to the complete structural module KIR
  bytes;
- one source record per structural module, binding normalized module ID,
  original UTF-8 byte length, and SHA-256 of the exact source bytes;
- stable node or expression spans;
- stable diagnostic identities plus evidence-only messages;
- `ALPHA-NO-GO` as the only proof label. **DECIDED**

All records are canonical-value encoded under the existing bounded reader
limits. Arrays are unique and strict code-point sorted. Unknown format,
unknown field, duplicate ID, noncanonical order, invalid UTF-8, or resource
overflow rejects before an artifact is returned. **GUARD**

### Span identity

A span contains a stable ID, normalized module ID, a non-empty structural
`nodePath`, nullable `propertyKey`, exact source content plus SHA-256, and
`[startByte, endByte)` offsets.
`nodePath[0]` selects a module root; later indexes select children. Every index
is a non-negative safe integer. **DECIDED**

- `propertyKey = null` binds a node span.
- A text `propertyKey` binds an expression span and must resolve to a present
  structural property whose canonical value is in the closed expression
  catalog.
- `0 <= startByte < endByte <= source.utf8ByteLength`.
- Line/column, UTF-16-unit, inclusive, reversed, empty, dangling module,
  dangling node, and dangling property representations reject. **GUARD**

The span envelope never changes structural KIR semantic bytes. A span mutation
changes evidence bytes only. **GUARD**

### Diagnostic identity

Stable diagnostic identity is exactly diagnostic ID, code, severity, category,
module ID, and span ID. Severity is `error | warning | info`; category is
`source | parser | validator | codegen | migration`. IDs and codes are bounded
portable identifiers. **DECIDED**

Message text is required, well-formed evidence and carries a verified SHA-256,
but it is excluded from diagnostic identity and semantic KIR bytes. Message
wording can evolve only by changing evidence bytes and future manifests, not by
renaming the diagnostic identity. **DECIDED**

At least one diagnostic and at least one expression span are required by the
R1.5d.1 acceptance witness. Empty evidence is not release evidence. **GUARD**

### Containment

The codec remains unexported from every package surface and unreachable from
runtime/browser/public entry graphs. Module KIR continues to reject non-empty
`diagnostics`. `test:kern-ir`, KIR v1 freeze, runtime adoption, public export,
and semantic cutover remain absent/false. **GUARD**

## R1.5d.1 Acceptance

- [x] Positive artifact with non-ASCII source, non-empty diagnostic evidence,
      node span, and expression span round-trips byte-canonically.
- [x] UTF-16/code-point confusion is killed by a UTF-8 byte-offset witness.
- [x] Unknown fields/versions, invalid hashes, message/hash mismatch, duplicate
      or reordered rows, unsafe paths, invalid ranges, and dangling bindings
      reject deterministically.
- [x] Mutating message or span changes evidence bytes but not semantic bytes.
- [x] Structural mutation changes semantic bytes and invalidates the evidence
      semantic digest.
- [x] Existing R1.5a-c, ownership, browser containment, and full KERN 5 fitness
      gates remain green.
- [x] Final Agon review with exactly `claude,codex,agy` has zero verified
      findings before commit and push.

## R1.5d.2 Deferred Contract

R1.5d.2 generates an immutable, untracked build receipt only from a clean HEAD.
It records the exact accepted commit SHA, frozen schema/codec hashes, oracle
results, known exclusions, and evidence results; regeneration must compare
byte-for-byte. Oracle execution must not dirty tracked files. **DEFERRED**

Only `alphaAccepted` may become true after both d.1 and d.2 pass. KIR v1,
runtime ABI, public export, and semantic cutover remain false. No package
version, npm tag, or public release occurs. **GUARD**

## Kill Switches

- Any diagnostic/location data enters structural KIR semantic bytes.
- Any checked-in artifact claims its containing commit SHA.
- Any unknown version, field, identity, or path falls back.
- Any evidence codec becomes public or runtime reachable.
- Any Alpha claim flips before the clean-HEAD manifest gate passes.
