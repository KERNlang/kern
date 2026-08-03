# KERN 5 R2 M4.153 Frontend Tokenizer Shadow

**Status:** IMPLEMENTED — VERIFIED
**Date:** 2026-08-03
**Confidence:** 0.99

## Executive Summary

M4.153 begins the KERN-authored frontend with one complete, bounded line-token
shadow. A handwritten KERN handler will reproduce the bootstrap tokenizer's
eleven current token kinds plus its four tokenizer diagnostics over a frozen
scalar-safe profile, while an internal release-blocking oracle compares values
and normalized UTF-8 byte locations. KERN owns each boundary through a sealed
tape of exact source deltas; the host validates and byte-counts those fragments.
This is the first
frontend ownership slice, not a parser, KIR
producer, production frontend, or public API cutover.

## Current State / Root Cause

- **VERIFIED:** The production parser delegates each parsed source line to
  `tokenizeLineInternal` before token-stream parsing
  (`packages/core/src/parser-core.ts:250-280`).
- **VERIFIED:** The current tokenizer owns eleven token kinds and line-mode
  scanning for whitespace, nested expressions, styles, quoted strings, theme
  references, equals, commas, slash paths, numbers, identifiers, and unknown
  input (`packages/core/src/parser-tokenizer.ts:13-30,125-320`).
- **VERIFIED:** Tokenizer diagnostics are `UNCLOSED_EXPR`, `UNCLOSED_STYLE`,
  `UNCLOSED_STRING`, and `INVALID_BIGINT`, with one-based columns and explicit
  end columns (`packages/core/src/parser-tokenizer.ts:143-254,289-297`).
- **VERIFIED:** The public bootstrap API exports `tokenizeLine`, while the
  production parser alone consumes `tokenizeLineInternal`; repository search
  found no other production consumer on 2026-08-03
  (`packages/core/src/parser.ts:20-23`; `rg -n
  "tokenizeLineInternal|tokenizeLine\\(" packages --glob '*.{ts,tsx}'`).
- **VERIFIED:** KERN portable `Text.*` operations index Unicode code points,
  unlike the bootstrap tokenizer's JavaScript string indexing
  (`packages/core/src/ir/semantics/portable-string.ts:1-37`; bootstrap positions
  at `packages/core/src/parser-tokenizer.ts:129-139`). Direct numeric position
  comparison would therefore be false for non-BMP text.
- **VERIFIED:** KIR evidence already defines portable source locations as
  UTF-8 byte ranges (`packages/core/src/kir-evidence/canonical.ts:305-316`).
- **VERIFIED:** There is no KERN frontend implementation or current frontend
  gate. `kern-frontend` remains planned/not-shipped
  (`scripts/kern-5-fitness-policy.json:196-200`;
  `docs/kern-5-support-matrix.md:52,106`).
- **VERIFIED:** A standalone non-BMP character cannot byte-match today: the
  bootstrap unknown branch advances one UTF-16 code unit
  (`packages/core/src/parser-tokenizer.ts:315-317`), while KERN `Text.charAt`
  returns one Unicode code point
  (`packages/core/src/ir/semantics/portable-string.ts:101-111`). The selected
  profile therefore admits non-BMP text inside aggregate tokens but rejects
  non-ASCII unknown-token input until bootstrap scalar semantics are migrated.

## What Already Works

- The TypeScript tokenizer remains the bootstrap oracle and does not need a
  production rewrite in this slice.
- The public runtime-handler ABI already executes typed string/list handlers
  and links same-source helpers; M4.153 consumes it without changing core.
- The UTF-8 evidence contract supplies the cross-runtime location unit.
- M4.152's canonicalizer stays unchanged and remains bootstrap-frontend
  dependent.

## Contract (Verified)

> Verified against the current source tree at `c3f0185b9505bb54f833798cb3c5ab7428ec8b08` on 2026-08-03.

| Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Token kinds | exact current eleven-kind ordered stream | `packages/core/src/parser-tokenizer.ts:13-30` | VERIFIED |
| Token values | exact bootstrap value after unquoting/escaping or prefix removal | `packages/core/src/parser-tokenizer.ts:132-320` | VERIFIED |
| Token locations | KERN returns the exact source delta from the preceding record start; the adapter validates the monotone tape and byte-counts it to a zero-based UTF-8 offset | `packages/core/src/kir-evidence/canonical.ts:305-316` | VERIFIED |
| Diagnostic codes | four tokenizer-owned codes only | `packages/core/src/parser-tokenizer.ts:143-254,289-297` | VERIFIED |
| Diagnostic locations | one-based UTF-8 byte columns with exclusive end column | `packages/core/src/parser-diagnostics.ts:145-165` and tokenizer call sites | VERIFIED |
| Runtime result | `kern.frontend.tokenizer-shadow.2` followed by ordered four-string records: `token,kind,value,startDelta`, `diagnostic,code,startDelta,endSpan`, one terminal `seal,remainingSource,"",""`, or one atomic `failure,code,detail,""` record | `packages/core/src/runtime-handler.ts:407-470` plus this selected contract | VERIFIED |
| Output ceiling | the complete public envelope JSON must fit `maxOutputJsonBytes`, which is policy-bound at or below runtime `maxBytes`; the host checks before record parsing | `scripts/kern-frontend-tokenizer/policy.json` and checker | VERIFIED |
| Production skew | none; oracle-only gate, no parser or package export changes | blast-radius audit below | VERIFIED |

## Implementation Options

### A. Complete bounded line-token shadow — selected

Implement the entire current `line` mode in handwritten KERN over well-formed
scalar input, with non-ASCII standalone unknowns explicitly outside the first
profile. Compare every token and tokenizer diagnostic after UTF-8 location
normalization. This creates a real closed frontend layer and a useful next
dependency for line parsing.

### B. ASCII-only seed

Smaller, but it preserves the wrong location model and cannot safely grow into
the frozen UTF-8 evidence contract. Rejected as misaligned with the release
goal.

### C. Host-pretokenized KERN classifier

Pass bootstrap token rows into KERN for validation. This would exercise KERN
policy without moving source-to-token ownership. Rejected because a delegating
implementation could pass while KERN never scans source.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| this spec | add | freeze the claim and oracle |
| `examples/kern-frontend/tokenizer*.kern` | add | handwritten KERN scanner and helpers |
| `scripts/kern-frontend-tokenizer/policy.json` | add | config-owned source-byte/code-point/record/diagnostic/runtime bounds |
| `scripts/kern-frontend-tokenizer/fixtures.mjs` | add | complete token/diagnostic/Unicode adversarial corpus |
| `scripts/check-kern-frontend-tokenizer.mjs` plus tests | add | direct public-handler parity, bounds, mutation, and containment oracle |
| root scripts and fitness policy | modify | promote only the tokenizer-shadow gate to current |
| support matrix and release train | modify | record the narrow internal-oracle ownership claim |

Core parser, tokenizer, runtime, exports, package versions, canonicalizer, and
CLI behavior remain unchanged.

## Acceptance Criteria

- [x] RED-at-base fails because the KERN tokenizer source and gate do not exist.
- [x] The handwritten KERN handler matches exact ordered token kind/value pairs
      for all eleven current line token kinds.
- [x] KERN emits exact start deltas and local diagnostic end spans plus one
      terminal source seal; the adapter validates the complete monotone tape
      and only UTF-8-byte-counts accepted fragments. Metamorphic 1/2/3/4-byte
      prefixes shift normalized positions by exactly their byte widths.
- [x] `UNCLOSED_EXPR`, `UNCLOSED_STYLE`, `UNCLOSED_STRING`, and
      `INVALID_BIGINT` match by code and normalized start/end byte columns.
- [x] Empty input, evolved identifiers, numeric bases/separators, quote escapes,
      nested expressions, style quotes/escapes, slash boundaries, and unknown
      Unicode characters have discriminating fixtures.
- [x] Non-BMP text inside quoted/style/expression/slash aggregate tokens is
      covered; non-ASCII standalone unknowns, malformed UTF-16, and malformed
      bootstrap aggregate-token slices fail closed without pretending scalar
      parity.
- [x] Config-owned source-byte, code-point, token, diagnostic, record, and
      runtime ceilings accept exact boundaries and fail above them without
      tokens, diagnostics, stdout, events, or effects.
- [x] The oracle executes source through `executeKernRuntimeHandlerSync`; source
      inspection and mutations reject delegation to tokenizer/parser host code,
      identity returns, constant streams, dropped diagnostics, or reordered
      tokens.
- [x] A deterministic policy-owned sample of committed handwritten `.kern`
      lines matches the bootstrap tokenizer.
- [x] `pnpm test:kern-frontend-tokenizer`, touched-package tests, and the current
      `pnpm fitness:kern-5` wall pass on Node 22.
- [x] Support claims add only `kern-frontend-tokenizer-shadow:
      internal-oracle`; `kern-frontend` remains planned/not-shipped.
- [x] Final Agon review with the current full usable roster has no unresolved
      source-verified blocker.

## Out of Scope

- Multi-line stitching, comment stripping, indentation trees, token-stream
  parsing, keyword/property parsing, KIR emission, or full diagnostic messages.
- Expression/path/regex lex modes, which the bootstrap still rejects.
- Standalone non-ASCII unknown-token parity until the bootstrap tokenizer moves
  from UTF-16 code-unit unknowns to the frozen scalar contract.
- Replacing `tokenizeLine`, adding a public export, changing parser behavior,
  or calling the KERN frontend production-ready.
- Formatter/trivia work, compiler ownership, fixed point, interpreter cutover,
  package versioning, or Fable.

## Open Questions

No open question remains after the three-engine brainstorm
`brainstorm-1785767396096-q5ww2b`. It retained the selected complete line-mode
slice and required scalar-profile closure, KERN-owned boundary evidence,
separate bounds, metamorphic Unicode cases, generated adversarial cases,
anti-delegation mutations, and worst-case runtime fixtures.

## Deploy Order

One atomic repository slice: add the KERN source and oracle first, then promote
that exact command and ownership row in the same commit. There is no mixed
runtime skew because production parser/export behavior does not change.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Compare tokenizer numeric positions directly | Bootstrap uses UTF-16 code units while KERN uses Unicode code points | Normalize both independently to UTF-8 byte locations |
| Host may convert a KERN numeric code-point index to bytes | That lets the adapter own too much of the boundary and is easier to game | KERN returns exact source fragments in a sealed delta tape; host validates and counts UTF-8 bytes |
| Every well-formed scalar can match the current bootstrap unknown branch | Bootstrap splits standalone astral unknowns into surrogate tokens | Freeze non-ASCII unknowns outside M4.153 and fail closed |
| Compound loop conditions would execute correctly in the direct runtime | Conditions combining loop-mutated bindings produced incorrect direct-runtime behavior in this profile | Split affected scanner conditions into explicit nested checks without changing core/runtime |
| Returning a helper-created failure list from inside the scan loop was portable | The direct handler rejected that result shape as unsupported runtime input | Return the same atomic failure envelope as an inline list literal |
| A bounded source length alone kept repeated style tokens inside the runtime envelope | Each style token scanned the full line after finding its close, making repeated `{}` tokens quadratic | Start at the style body and break on the first unquoted close; regress 64 consecutive style tokens |
| Lexical `examples/*.kern` validation fully contained corpus reads | URL percent-decoding and symlinked parents could escape the lexical path | Restrict the path grammar and require the resolved real path to remain below the real `examples` directory |
| Complete prefixes were a bounded boundary proof | Repeating every growing prefix made the public envelope quadratic and exceeded `maxBytes` at 1,024 tokens | Adopt the `.2` rolling-delta tape with a terminal seal and enforce a policy-owned whole-envelope JSON ceiling before parsing |
| Well-formed scalar input guaranteed well-formed bootstrap token values | An unclosed expression ending in an astral scalar leaves the bootstrap UTF-16 scanner's dangling high surrogate in the token value | Reject malformed non-unknown bootstrap token slices at scalar-profile admission and freeze the terminal-astral regression |
| Trimming space and tab matched expression token values | Bootstrap expression values use JavaScript `.trim()`, whose set contains 25 ECMAScript whitespace and line-terminator code points | Implement the complete frozen set in KERN and exhaustively regress every member |
| Rejecting characters below space implemented the non-ASCII unknown exclusion | Bootstrap emits ASCII controls and DEL as ordinary unknown tokens | Admit all U+0000 through U+007F unknowns and regress the complete control/DEL set |
| Filtering the committed corpus preserved a scalar-safe sample | Silent filtering allowed selected corpus coverage to shrink without failing | Reject any policy-selected line outside the profile and select the handwritten validator source instead of its generated em-dash comments |
| `maxLines` bounded policy corpus work before tokenization | Reading whole files and accepting fewer-than-declared lines allowed resource abuse or silent corpus shrink | Derive a pre-read file byte ceiling, bound each selected line before bootstrap tokenization, and require the declared line count |

## Verification Evidence

- `pnpm fitness:kern-5`: passed the definitive complete current wall on the
  exact final source on Node 22, including
  all workspace tests, cross-target conformance, native tests (233/233), KIR
  ownership/coverage gates, canonicalizer (732/732 and 112/112), and the new
  frontend-tokenizer gate.
- `pnpm test:kern-frontend-tokenizer`: 307 parity cases, 6 fail-closed cases,
  and 8 boundary cases passed on the final `.2` rolling-delta protocol,
  including exact/over output-ceiling, maximum-token, maximum-record, seal,
  and delta mutation coverage.
- `pnpm lint`, `pnpm build`, `pnpm test:kern-5-fitness`, and
  `pnpm check:kern-5-contract`: passed.
- Initial Agon review `review-1785771091618-ibrwvf-kern-5-r2-m4-153`
  identified the repeated-style runtime exhaustion and corpus real-path escape;
  both are fixed with regression coverage. Review
  `review-1785773771434-ejvmfk-kern-5-r2-m4-153-final` identified the quadratic
  full-prefix envelope; brainstorm
  `brainstorm-1785774171777-b2bgto-kern-5-m4-153-output-bound` selected the
  sealed rolling-delta protocol. The terminal full-roster review
  `review-1785784168048-rbng4x-kern-5-r2-m4-153-final-bounded-c` found zero
  verified findings and zero needs-check findings; security was clean and the
  correctness reviewer reported only two non-blocking nits before the overall
  review timed out after 600 seconds.
