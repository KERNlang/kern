# KERN 5 Phase 1 Lossless Source Tape and Formatter

**Status:** IMPLEMENTED AND REVIEWED; READY FOR PUBLICATION

**Date:** 2026-08-13

**Baseline:** `eadd73296b237c451ff60a011de056b29d67e944`

**Tribunal:**
`tribunal-1786586085927-4a19ks-kern5-formatter-boundary` (3/3,
`claude,codex,agy`); performance remediation
`tribunal-1786588510615-smxjxl` (3/3, Option A selected 2-1)

**Confidence:** 0.99

## Decision

- **[FMT-D1 DECIDED]** Promote `kern-formatter` only with the lossless
  lexical/framing ownership it consumes. Do not wait for semantic tree, module,
  or KIR frontend ownership, and do not claim those later boundaries.
- **[FMT-D2 DECIDED]** The private production boundary is a packaged KERN
  composition that accepts raw source and returns `kern.formatter.result.1`.
  TypeScript owns bounded transport, mechanical LF/CRLF/EOF physical-record
  framing, immutable asset authentication, runtime invocation, and result-tape
  authentication only. It emits no lexical or classification metadata.
- **[FMT-D3 DECIDED]** `kern.formatter.source-tape.1` partitions every admitted
  source code point exactly once as ordered physical content plus its explicit
  `lf`, `crlf`, or `none` terminator. KERN authenticates ordinal order, record
  shape, terminator placement, and balanced reconstruction against the raw
  source. TypeScript supplies only the mechanical
  `kern.formatter.physical-records.1` witness.
- **[FMT-D4 DECIDED]** Uniform LF and CRLF are admitted and preserved. Mixed LF
  and CRLF fail closed. Empty input remains empty. A nonempty document without a
  final terminator receives the document style; when no prior terminator exists,
  the declared default is LF. Existing final terminators and trailing blank
  records are preserved.
- **[FMT-D5 DECIDED]** Opaque precedence is raw body/fence, quoted string,
  expression/style span, inline comment, ordinary code/trivia. Marker-like text
  in an earlier opaque class cannot be reclassified by a later class.
- **[FMT-D6 DECIDED]** Raw opener, raw body, and raw closer records, comment
  records, comment payloads, blank records, source order, token spelling, and
  opaque span bytes are emitted unchanged. Unterminated raw, quote, expression,
  or style framing fails deterministically with no formatted source.
- **[FMT-D7 DECIDED]** The first canonical layout policy removes trailing space
  and tab trivia only from ordinary comment-free code records. It does not
  rewrite indentation, token separators, comment bytes, blank records, raw
  records, or opaque bytes. This is a real non-identity formatter while keeping
  every edit mechanically authorized by the tape.
- **[FMT-D8 DECIDED]** The production interface is private during Phase 1. The
  root `test:kern-formatter` gate and internal product status are promoted; a
  broad public `kern format` command is deferred until the frontend/cutover
  phase owns the canonical raw-source consumer contract.
- **[FMT-D9 DECIDED]** Every handwritten source module stays below 500 lines.
  Generated authenticated compositions may exceed that boundary.
- **[FMT-D10 DECIDED]** Lexical nesting is capped by the authenticated
  `maxLexicalDepth` policy. State reconstruction work is bounded by that cap
  per physical record, and deeper input fails as `LEXICAL_DEPTH_LIMIT`.
- **[FMT-D11 DECIDED]** Repeated portable `Text.charAt` and `Text.slice` over
  the whole source are forbidden because the current runtime rematerializes
  code points per call. The configurable `maxRecordCodePoints` ceiling is 2048
  for this profile (tracked maximum: 1096). A fused scalar record pass owns
  production reconstruction and output; balanced chunk reduction is confined
  to the explicit source-tape oracle.
- **[FMT-D12 DECIDED]** Inline comments require the bootstrap parser's column
  zero or preceding-horizontal-trivia boundary. Nested style state is balanced
  through `maxLexicalDepth` before raw/comment recognition. Result capacity
  admits a missing CRLF, unexpected host errors are sanitized, and importing
  the private runner has no stdin or process-exit side effect.

## Contracts

### Source tape

`kern.formatter.source-tape.1` returns either a failure tuple or an ordered
record tape. Every success record contains:

1. zero-based record ordinal;
2. original content without its physical terminator;
3. terminator kind: `lf`, `crlf`, or `none`;
4. record class: `blank`, `comment`, `code`, `opaque`, `raw-opener`,
   `raw-body`, `raw-closer`, or `raw-inline`;
5. inline-comment offset or `-1`;
6. leading-horizontal-trivia width;
7. the exact record extent (`content + terminator`).

The tape seal repeats the exact original source, selected style, and final
terminator state. Production authentication requires exact arity, ordinal
order, allowed enums, and `concat(extents) == source`.

### Formatter result

`kern.formatter.result.1` returns one of:

- `formatted`: exact formatted source, source SHA-256 supplied by the compiled
  boundary, and ordered edit count;
- `failure`: stable code and detail, no source;
- no partial runtime events or host effects.

Exit semantics for the packaged private runner are 0 success and 2 failure.
The result contains no time, locale, temporary path, or process identity.

## Binary Acceptance

- **[FMT-A1 ACCEPT]** RED proves the source-tape/formatter assets, formats, and
  root gate do not exist at baseline; valid CRLF/raw/comment/EOF fixtures fail
  until implemented.
- **[FMT-A2 ACCEPT]** Tape reconstruction byte-equals every input over the
  admitted corpus, including astral text, marker-like opaque text, raw bodies,
  comments, blank records, LF, CRLF, and absent EOF terminators.
- **[FMT-A3 ACCEPT]** Formatting twice byte-equals formatting once for every
  valid fixture and tracked `.kern` source admitted by current policy.
- **[FMT-A4 ACCEPT]** The independent bootstrap parser produces byte-identical
  structural KIR before and after formatting for every valid fixture and
  tracked source admitted by the existing structural-KIR profile. Raw host
  blocks and source kinds outside that profile remain covered by byte-level
  losslessness and idempotence. Parser/KIR code is absent from packaged
  formatter dependencies.
- **[FMT-A5 ACCEPT]** Raw bodies, comments, blank records, indentation, token
  spelling, and opaque spans preserve exact bytes. Only ordinary comment-free
  trailing horizontal trivia and a missing final terminator may change.
- **[FMT-A6 ACCEPT]** Mixed terminators, unterminated raw/quote/expression/style
  spans, oversized inputs/records/tapes/results, malformed runtime tapes, and
  tampered assets fail closed before partial formatted output.
- **[FMT-A7 ACCEPT]** Mutations kill raw-before-comment precedence, comment
  recognition inside quotes/styles/expressions, blank-record collapse,
  terminator normalization, EOF inversion, tape gaps/overlaps/reordering,
  trailing-trivia overreach, constant output, TypeScript delegation, and mutable
  asset self-manifest bypass.
- **[FMT-A8 ACCEPT]** Packaged assets are an exact regular-file set whose source,
  policy, composition, and manifest identities are compiled outside the asset
  directory and reproduced by the repository writer.
- **[FMT-A9 ACCEPT]** `pnpm test:kern-formatter`, focused CLI/core builds and
  tests, repository consistency, lint, and diff hygiene pass before review.
- **[FMT-A10 ACCEPT]** Policy, remaining-gate ledger, support matrix, release
  train, goal, and root scripts agree on one promoted `kern-formatter` gate;
  `kern-frontend` remains planned and its root script remains absent.
- **[FMT-A11 ACCEPT]** Risk-routed independent Agon review runs after the local
  gate; every finding is verified against current source and genuine blockers
  are fixed before publication.
- **[FMT-A12 ACCEPT]** Timed 1x/2x/4x many-record and wide-record probes remain
  within hard subprocess walls; the tracked-source sweep completes within its
  wall. Exact-limit and limit-plus-one inputs prove record, source, and nesting
  ceilings, and hostile physical witnesses fail closed.

## Review Delta

Exact-roster review `review-1786590302499-g11p5f-kern5-formatter-final`
completed 3/3. The initial fused KERN scanner was retained, but the review
verified two blockers: style nesting was flattened, and the result ceiling
could not admit a missing CRLF at the exact source limit. It also verified
parser-comment divergence, import-time runner execution, unsanitized unexpected
errors, and a documentary corpus-count floor. RED regressions now cover every
confirmed issue. The raw-closer observation was rejected after tracing
`parser-core.ts`: `trimStart().startsWith('>>>')` is the current parser contract.
Targeted independent correctness confirmation
`review-1786591537959-93yuk1-kern5-formatter-review-fix-confi` completed 1/1
with zero findings after the repaired local gate passed.

## Exclusions

- Semantic node/tree construction, declarations, modules/imports, decorators,
  diagnostics beyond lexical/framing admission, and source-to-KIR emission.
- Re-indentation, token-separator normalization, comment reflow, raw-body
  language formatting, public CLI/API promises, and TypeScript formatter
  replacement outside this private KERN 5 product boundary.
- Promotion of `kern-frontend`, compiler, fixed point, interpreter, canonical
  cutover, packed release, or public `5.0.0`.
