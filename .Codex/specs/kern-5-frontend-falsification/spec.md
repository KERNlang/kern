# KERN 5 Frontend Architecture Falsification Probe

**Status:** FALSIFIED — RUNTIME PREREQUISITE REQUIRED

**Date:** 2026-08-13

**Baseline:** `41c877cf219813b9ac475b14c53c72a5a6b352de`

**Tribunal:**
`tribunal-1786594712412-jjj83e-kern5-full-frontend-architecture` (3/3,
`claude,codex,agy`; Architecture B selected)

**Confidence:** 0.82 for a bounded streaming architecture; 0.64 for terminal
frontend completion before this probe passes.

## Decision

- **[FFP-D1 DECIDED]** Do not create, promote, or publish
  `pnpm test:kern-frontend` during this probe. The terminal gate remains planned
  until a production source-to-KIR path exists.
- **[FFP-D2 DECIDED]** The candidate architecture is a fused KERN document
  frontend over classification-free physical records. Existing shadow receipt
  envelopes remain independent oracles; production may reuse proven primitive
  algorithms but may not compose receipt tapes as semantic authority.
- **[FFP-D3 DECIDED]** Ordinary KERN list growth is forbidden for unbounded
  document state. The measured push probe is approximately quadratic: 500
  fields took 26.6 ms, 1,000 took 85.1 ms, 2,000 took 316.2 ms, and 4,000 took
  1,230.0 ms on the baseline runtime. Production must stream sealed node or
  canonical-instruction chunks, or use bounded per-record scratch arrays.
- **[FFP-D4 DECIDED]** TypeScript may split physical lines, authenticate static
  assets, invoke KERN, and mechanically encode a KERN-selected ordered
  canonical-value instruction tape. It may not trim, tokenize, classify, parse,
  select semantic fields, choose ordering/defaults, construct locations or
  diagnostics, or substitute bootstrap output.
- **[FFP-D5 DECIDED]** SHA-256 over already-emitted component bytes is a
  mechanical host primitive. This remains acceptable only if mutations that
  reorder, default, delete, duplicate, suffix, or substitute KERN-selected
  instructions fail closed.
- **[FFP-D6 DECIDED]** The expression probe is iterative and recursion-free. It
  must dynamically parse source text into a canonical structural expression
  projection; retaining the expression source as an opaque string, accepting a
  host AST, or calling the TypeScript parser falsifies the architecture.
- **[FFP-D7 DECIDED]** All handwritten probe and candidate modules remain below
  500 lines. Probe limits are authenticated and deliberately small so immutable
  scratch-array cost cannot masquerade as scalable document storage.

## Probe Contracts

### Expression feasibility

The KERN probe consumes one expression string and returns either:

```text
kern.frontend.expression-probe.1
ok
<canonical structural expression projection>
<charged token count>
seal
<exact original source>
<projection repeat>
<charged token count repeat>
```

or a sealed failure with a stable code and no projection. The projection is a
KERN-selected, unambiguous length-framed representation of the same expression
kind and fields used by `packages/core/src/kir-structural/expression.ts`.

The first probe catalog covers identifiers, null/boolean/integer/decimal/text
literals, unary operators, precedence-sensitive binary operators, parenthesis,
list and record literals, member/index access, calls, and conditionals. Every
accepted expression is compared with the live bootstrap structural projection.
Unsupported syntax fails closed.

### Canonical instruction boundary

KERN-selected instructions use exact primitive records:

```text
record-begin <field-count>
field <key>
text|int|decimal|bool <value>
list-begin <item-count>
record-end|list-end
```

The host encoder validates exact nesting, counts, canonical key ordering, value
spelling, limits, and a terminal seal. It performs no semantic field selection.

## Binary Acceptance

- **[FFP-A1 ACCEPT]** RED fails because the KERN expression probe and strict
  instruction decoder do not exist at the baseline.
- **[FFP-A2 ACCEPT]** At least twelve valid expressions spanning the catalog
  produce byte-identical canonical-value encodings to the independent
  TypeScript structural-expression oracle.
- **[FFP-A3 ACCEPT]** Malformed, unsupported, depth-limit, token-limit, and
  limit-plus-one expressions fail deterministically with no partial projection.
- **[FFP-A4 ACCEPT]** Same-length substitutions, precedence changes, operand
  swaps, delimiter movement, non-BMP prefixes, constant output, copied oracle
  output, source-string placeholders, and forced-success mutations are killed.
- **[FFP-A5 ACCEPT]** Host instruction mutations covering field reorder,
  default insertion, deletion, duplication, suffixing, count drift, and payload
  substitution are rejected.
- **[FFP-A6 ACCEPT]** Dependency closure proves the production probe imports no
  parser, tokenizer, KIR structural projector, or bootstrap oracle module.
- **[FFP-A7 ACCEPT]** 1x/2x/4x bounded token probes stay within hard subprocess
  walls without superlinear document-state growth.
- **[FFP-A8 ACCEPT]** If the probe passes, write the full frontend claim-tagged
  spec and re-score confidence before product implementation. If it fails any
  load-bearing criterion, do not implement or promote the terminal gate; record
  the exact missing runtime or language capability instead.

## Exclusions

- Root `test:kern-frontend` script, fitness-policy promotion, support-matrix
  ownership promotion, or direct-main publication.
- Full document parsing, decorators, raw blocks, trees, modules/imports,
  diagnostics, evidence payloads, or complete KIR v1 construction.
- Any new public KIR or parser API.

## Falsification Result

- **[FFP-R1 OBSERVED]** The bounded `string[]` reducer passed static machine
  admission, then raw execution rejected a control condition that indexed the
  loop-populated token array (`tokens[cursor + n]`) with
  `unsupported-runtime-input`.
- **[FFP-R2 OBSERVED]** Tribunal
  `tribunal-1786595689488-ttuyui` rejected both immediate adoption and a
  pre-tokenized false-positive probe. It required one lexer-inclusive scalar
  length-framed tape probe and a fixed stop rule.
- **[FFP-R3 OBSERVED]** The lexer-inclusive scalar-tape probe also passed static
  admission and failed raw execution. The exact rejected node was assignment
  of a rewritten scalar tape from two data-derived `Text.slice` calls plus a
  nested canonical-subtree helper call after loop mutation:
  `tape = slice(prefix) + frame(binary(...)) + slice(suffix)`.
- **[FFP-R4 DECIDED]** The candidate native frontend architecture is halted on
  baseline `41c877cf`. Do not try a third parser representation. KERN 5 must
  first supply and independently validate a bounded runtime capability for
  data-dependent scalar rewriting after iterative scanning; only then may this
  exact probe be rerun.
- **[FFP-R5 REJECT]** `FFP-A2` through `FFP-A7` are not satisfied. No frontend
  terminal gate, ownership promotion, or release claim may be derived from
  this probe.
