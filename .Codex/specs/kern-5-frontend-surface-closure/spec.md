# KERN 5 Frontend Surface Closure (F0)

**Status:** F0 COMPLETE — NON-PROMOTING

**Date:** 2026-08-13

**Baseline:** `fa11d52d841508ed0ad0d5c2b9a62a00c6eb4970`

**Tribunal:** `tribunal-1786601303025-nve8dx` (`claude,codex,agy`, 3/3)

**Confidence:** 0.78 before challenge; 0.97 for F0 after implementation and
review; 0.83 for terminal frontend completion until F1-F6 prove the
implementation.

## Decision

- **[F0-D1 DECIDED]** Do not add or promote `test:kern-frontend` in F0. F0
  freezes the exact source/KIR intersection and the fail-closed boundary that
  F1-F6 must implement.
- **[F0-D2 DECIDED]** The current KIR contracts are immutable inputs. F0 does
  not add node kinds, properties, expression forms, module roots, symbols,
  diagnostics to the module artifact, or public exports.
- **[F0-D3 DECIDED]** The complete source catalog is the 302 ordered
  `NODE_TYPES` entries. Every row is already assigned one of four structural
  dispositions in the KIR coverage ledger. The frontend closure binds that
  full ordered ledger rather than duplicating a second hand-maintained node
  table.
- **[F0-D4 DECIDED]** The complete property catalog is the 1,149 ordered
  structural-constitution properties. Every property must retain its explicit
  include, lower, or exclude disposition. Required excluded properties reject;
  optional excluded properties may be omitted only after the KERN frontend has
  recognized and diagnosed the excluded payload.
- **[F0-D5 DECIDED]** Raw blocks, opaque host expressions, and unsupported host
  types are parsed source families with explicit fail-closed KIR dispositions;
  they are never silently skipped or copied into KIR.
- **[F0-D6 DECIDED]** The production design is a fused KERN-owned pipeline of
  small modules communicating through bounded scalar length-framed tapes. No
  production module may consume a `kern.frontend.*-shadow.*` receipt.
- **[F0-D7 DECIDED]** The static golden contract is authored and checked in
  before the production entry point. Runtime tests may validate its canonical
  bytes but may not regenerate it through `parseInternal`, `parseDocument`, the
  TypeScript expression parser, or a bootstrap KIR projector.

## Frozen Surface

The machine authority is
`scripts/kern-frontend-closure/closure-ledger.json`. It binds:

1. the complete ordered node and property coverage ledgers;
2. the structural expression kinds and operator catalogs;
3. physical framing, lexical modes, trivia, logical lines, indentation,
   decorators, raw/multiline forms, declarations, and module graphs;
4. the parser diagnostic catalog and F0-only fail-closed frontend codes;
5. the five current module roots and two current symbol kinds;
6. the F1-F7 delivery order and hard-stop rules; and
7. immutable static valid and malformed goldens.

`admitted` has two explicit meanings:

- **source-admitted:** the lexer/parser must recognize the family and select a
  stable success or failure disposition;
- **KIR-admitted:** the frozen structural/module KIR can represent the result
  without an excluded payload.

Source-admitted does not imply KIR-admitted. This distinction resolves the
contract contradiction caught by the tribunal without weakening KERN 5.

## Delivery Architecture

- **F1 scan:** physical source to token/trivia tape, including quotes,
  comments, fences, newlines, indentation, and scalar spans.
- **F2 expression:** iterative operator/value-stack parser for the full frozen
  expression catalog.
- **F3 line/tree:** logical continuation, indentation attachment, decorators,
  raw/multiline recognition, and attachment diagnostics.
- **F4 declarations/modules:** properties, defaults, declarations, `module`,
  `use`, `from`, binding validation, and graph diagnostics.
- **F5 projection:** sole KERN owner of KIR field selection, exclusions,
  defaults, canonical ordering, and instruction emission.
- **F6 adversarial closure:** full ledger coverage, mutations, import closure,
  deterministic limits, and scaling.
- **F7 promotion:** add `test:kern-frontend` only when F0-F6 are green.

## Binary Acceptance

- **[F0-A1 ACCEPT]** RED is the missing
  `pnpm test:kern-frontend-closure` script at the baseline.
- **[F0-A2 ACCEPT]** The validator proves exact hashes and counts for 302 node
  rows, 1,149 property rows, 16 expression kinds, 24 binary operators, 6 unary
  operators, 5 module roots, 2 symbol kinds, and 27 parser diagnostic codes.
- **[F0-A3 ACCEPT]** Every node/property disposition is from the frozen
  vocabulary and its counted distribution matches the live ledgers.
- **[F0-A4 ACCEPT]** Every frontend family names lexical, parse, attachment,
  property/default, KIR, and malformed-diagnostic ownership. Empty fields,
  unknown dispositions, duplicates, or reordered authority rows reject.
- **[F0-A5 ACCEPT]** Static goldens contain two source modules, `use`/`from`, a
  decorated exported function, an indented handler/parameter, a precedence
  expression, trivia, explicit failures for every F0 fail-closed disposition,
  and a malformed attachment companion with exact ordered
  code/severity/span assertions.
- **[F0-A6 ACCEPT]** The checked-in valid canonical bytes decode under the
  current module KIR reader, round-trip identically, and are not generated by a
  parser or projector during the test.
- **[F0-A7 ACCEPT]** Mutation tests kill authority digest/count drift, missing
  family fields, unknown dispositions, duplicate diagnostics, altered golden
  bytes, and premature terminal-script exposure.
- **[F0-A8 ACCEPT]** The F0 gate is current in the KERN 5 internal fitness wall,
  while the terminal frontend gate and ownership row remain planned/not-shipped.

## Hard Stops

- Any source/node/property/expression/module family lacks an explicit current
  KIR or fail-closed disposition.
- Any F1-F6 success path needs a public KIR expansion.
- Any production frontend module reaches a shadow receipt, TypeScript parser,
  bootstrap projector, or host semantic classifier.
- Any unsupported family succeeds by omission, or any non-binding limit
  changes successful bytes.

## Exclusions

- Production parser implementation, terminal frontend promotion, compiler,
  fixed point, interpreter, cutover, packed release, and public publication.
- New public syntax/KIR/parser APIs or a new typed-array runtime ABI.

## Verification

- **[F0-V1 VERIFIED]** Focused closure, fitness-contract, semantic-ownership,
  structural-constitution, structural-codec, module-graph, and lint gates pass
  under Node 22.22.0.
- **[F0-V2 VERIFIED]** Role review
  `review-1786602640077-j5vb85-kern5-frontend-f0` produced all three live-roster
  reviews and verified one blocker: sources, diagnostics, and valid canonical
  bytes were insufficiently bound. The repair fixes authority paths/baseline,
  hashes the entire static golden and its canonical artifact, structurally
  checks every promised feature, covers every fail-closed code, validates UTF-16
  spans, and binds diagnostic types plus suggestions.
- **[F0-V3 VERIFIED]** Independent Claude correctness confirmation
  `review-1786603296561-2mfeo6-kern5-frontend-f0-review-fixes` passed 1/1 with
  zero findings on the repaired tree.
- **[F0-V4 VERIFIED]** Combined high-risk review
  `review-1786605270805-mkal1n-kern5-f0-runtime-owner-final` verified one
  remaining blocker: co-located checksum updates could retain unrelated source
  or fabricated malformed fixtures. The final design adds a separately hashed
  semantic-expectations manifest with exact module source/KIR hashes, failure
  source/diagnostic hashes, module-local required lines, and fixture-specific
  triggering syntax.
- **[F0-V5 VERIFIED]** Independent Claude correctness confirmation
  `review-1786605631309-k2b1sn-kern5-f0-semantic-binding-confir` passed 1/1
  with zero findings after the semantic-binding repair.
