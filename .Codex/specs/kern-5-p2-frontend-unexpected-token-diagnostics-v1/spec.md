# KERN Frontend Unexpected-Token Diagnostic Loop Shadow v1

**Status:** IMPLEMENTED; REVIEWED; PUBLICATION PENDING
**Milestone:** M4.168
**Date:** 2026-08-05
**Confidence:** 0.99

## Executive Summary

[D1] M4.168 owns the remaining generic property-loop branch: constructing an
ordered `UNEXPECTED_TOKEN` warning, skipping exactly one unexpected retained
token, and continuing through later properties, themes, styles, duplicates,
and further unexpected tokens. It is an additive internal shadow; production
parser behavior and the public `ParseDiagnostic` shape do not change.

[D2] The behavior is source-grounded, but the implementation boundary needs an
external challenge. The smaller option derives a sanitized stream by replacing
only independently proven unexpected tokens with whitespace and reuses the
published M4.167 semantic replay. The direct option adds a diagnostic-aware copy
of the complete replay. The chosen design must prove semantic continuation
without laundering a malformed token or exceeding the 500-line source limit.

## Current State / Root Cause

[V1] The bootstrap generic loop gives style, theme, and property parsing
precedence. Only when all three decline does it consume exactly one token,
compute `errCol = parseCol + skipped.pos`, emit `UNEXPECTED_TOKEN`, and continue
(`packages/core/src/parser-core.ts:363-401`). **VERIFIED.**

[V2] `emitDiagnostic` materializes code, severity, message, line, col, endCol,
suggestion, and category; `endCol` is clamped to at least `col`
(`packages/core/src/parser-diagnostics.ts:104-122`). `UNEXPECTED_TOKEN` has the
fixed suggestion at line 19 and category `parser` at line 69. **VERIFIED.**

[V3] `ParseDiagnostic` is a public core type and `parseWithDiagnostics` returns
it to editor/lint callers (`packages/core/src/types.ts:190-205`,
`packages/core/src/parser.ts:94-120`). CLI compilation surfaces severity, code,
and message (`packages/cli/src/shared.ts:552-571`), while canonicalization maps
message/severity/line/column (`packages/cli/src/commands/canonicalize.ts:55-62`).
M4.168 changes none of those producers or consumers. **VERIFIED.**

[V4] A direct Node 22 probe against freshly built core `dist` on 2026-08-05
proved that `screen = stray {x:1} $base b=2` emits ordered warnings for `=` at
column 8 and `stray` at column 10, then preserves the later style, theme, and
property. `screen a=1 stray stray2 b=2` emits two ordered warnings and preserves
both properties. **VERIFIED** by the recorded `parseWithDiagnostics` probe in
the M4.168 execution log.

[V5] The same probe proved diagnostic span semantics use token value UTF-16
length, not lexical source width: quoted token `"q"` and expression token
`{{x}}` both report column 8 through 9. An astral symbol is currently tokenized
by bootstrap as two one-unit unexpected token values, but the current native
tokenizer deliberately rejects standalone non-ASCII unknown tokens as
`UNSUPPORTED_UNKNOWN` (`examples/kern-frontend/tokenizer.kern:291-292`). Those
spellings are outside the inherited retained-stream profile. **VERIFIED** by
the same probe and tokenizer source.

[V6] The M4.167 replay instead assigns `STYLE_PROFILE` when the handoff token is
not an identifier or when an identifier is not immediately followed by equals
(`examples/kern-frontend/generic-property-style-theme-replay.kern:153-180`). It
therefore cannot represent warning construction or post-warning continuation.
**VERIFIED.**

[V7] The fused source profile is LF-free and guards inherited ordinary-object
property keys before bootstrap evidence capture
(`packages/core/src/mutable-node-type-registry-snapshot.ts:384-421,454-465`).
Multiline diagnostic paths, including the separate unclosed-multiline
`UNEXPECTED_TOKEN` error at `packages/core/src/parser-core.ts:612-655`, are not
part of this slice. **VERIFIED.**

[V8] A direct native runtime probe on 2026-08-05 proved that `screen stray a=1`
returns a non-compact 2,521-field M4.167 failure envelope with exact
`STYLE_PROFILE`, 1,821 authenticated M4.166 fields, all 91 retained-stream
fields, 49 replay-failure fields, and a terminal failure seal. The original
retained tokens and source binding are therefore recoverable without another
tokenizer or predecessor call. Compact 41-field envelope-limit failures do not
carry those chunks and are terminal. **VERIFIED.**

## What Already Works

[W1] M4.153-M4.159 already own retained token kinds, values, ordering, and
independent scalar/byte positions. M4.167 owns property/theme/style reachability,
style-block semantics, final state, duplicate diagnostics, source/runtime/epoch
binding, and bounded authenticated envelopes. M4.168 composes these contracts;
it does not retokenize source or reimplement style parsing. **VERIFIED** against
`examples/kern-frontend/retained-token-stream.kern` and the three M4.167 native
source members.

[W2] `TokenStream.isKeyValue` requires an identifier followed immediately by
`equals`; it does not skip whitespace between them
(`packages/core/src/parser-token-stream.ts:48-54`). `parseProp` consumes quoted
or expression values once and otherwise concatenates tokens until whitespace,
style, or theme (`packages/core/src/parser-core.ts:192-245`). These rules fully
determine whether a token is unexpected. **VERIFIED.**

[W3] Production continues after warnings because warning severity does not make
strict parsing fail; strict parsing filters only severity `error`
(`packages/core/src/parser.ts:123-139`). No production behavior needs changing.
**VERIFIED.**

## Contract (Verified)

> Verified against the listed current source and direct Node 22 probes on
> 2026-08-05.

| Field / Behavior | Type | Evidence | Tag |
|---|---|---|---|
| code | literal `UNEXPECTED_TOKEN` | `parser-core.ts:390-394` | VERIFIED |
| severity | literal `warning` | `parser-core.ts:390-394` | VERIFIED |
| message | `Unexpected token "${value}" at line 1:${col}` | `parser-core.ts:394`; direct probe | VERIFIED |
| line | `1` in the LF-free profile | `mutable-node-type-registry-snapshot.ts:384-387`; `parser-core.ts:395` | VERIFIED |
| col | `1 + token.pos` | `parser-core.ts:262-265,388-396`; direct probe | VERIFIED |
| endCol | `col + token.value.length` in UTF-16 units | `parser-core.ts:397-399`; direct quoted/astral probes | VERIFIED |
| suggestion | fixed parser suggestion | `parser-diagnostics.ts:15-20,119-120` | VERIFIED |
| category | `parser` | `parser-diagnostics.ts:60-71,121` | VERIFIED |
| order | loop encounter order, interleaved with duplicate warnings | `parser-core.ts:364-400`; `parseProp` at lines 201-217 | VERIFIED |
| continuation | consume one unexpected token, then resume the generic loop | `parser-core.ts:387-401`; direct mixed probe | VERIFIED |
| source | exact authenticated M4.159 retained stream | M4.167 outer envelope and checker | VERIFIED |

The internal successor envelope must bind format/profile, source, runtime
instance, parse epoch, complete M4.167 predecessor fields, every derived
diagnostic and its token index/value/span, complete semantic replay, caller
limits, and a terminal seal. Unexpected-warning count has its own positive
configurable bound and cannot consume property, theme, style, or tokenizer
diagnostic budgets.

## Implementation Options

### Option A — Authenticated derived stream plus published semantic replay (selected, confidence 0.93)

Call M4.167 exactly once and authenticate its complete outer envelope. Recover
the original retained stream from its authenticated chunks. A native KERN
classifier walks that stream with the exact generic-loop phases, emits one
diagnostic record per unexpected token, and derives a same-length stream whose
only changes are those token kinds becoming `whitespace`. The existing
`replaygenericpropertystyletheme` then computes property/theme/style semantics
over that derived stream. The M4.168 envelope authenticates the original stream,
the complete replacement map, the derived stream, and the replay result; the
independent checker reconstructs all four and rejects any unexplained change.

Pros: reuses the reviewed style and property semantics; isolates the new branch;
keeps each KERN source under 500 lines; mutations can target every replacement.

Cons: the derived stream is not itself the original retained evidence. The
proof must be strong enough that replacing a token cannot hide a valid property,
style, theme, earlier failure, or source mismatch. The checker must reconstruct
the complete same-cardinality map and reject any value, index, position, source,
or non-recorded-kind change. Non-compact M4.167 envelopes contain the required
state and stream; compact envelope-limit failures are propagated terminally.

### Option B — New diagnostic-aware full semantic replay (confidence 0.78)

Add a successor replay that directly owns property/theme/style/unexpected
branches and emits both semantic and diagnostic transitions. Split structural
decoding, state transitions, and final projection across composed native KERN
members to remain below 500 lines.

Pros: no transformed-input argument; direct correspondence with the bootstrap
loop; diagnostic and duplicate ordering are produced by one state machine.

Cons: duplicates nearly all of M4.167's 478-line replay, or requires a risky
refactor of the just-published predecessor. Either route expands mutation and
regression surface materially.

### Option C — Diagnostic occurrence observer only (confidence 0.48)

Scan retained tokens and emit warning occurrences without recomputing final
semantic state.

This is rejected unless the external challenge proves otherwise: occurrence
evidence cannot demonstrate that parsing resumes correctly after a warning and
would repeat the occurrence-only ownership flaw rejected during M4.167 design.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `examples/kern-frontend/*unexpected-token*.kern` | add | native classifier/replay and integrated owner |
| `packages/core/src/mutable-node-type-registry-snapshot.ts` | edit | fused M4.168 source-profile safety entry |
| `packages/core/tests/mutable-node-type-registry-snapshot.test.ts` | edit | source/evidence regression |
| `scripts/check-kern-frontend-generic-property-style-theme-diagnostics.mjs` | add | containment, envelope, oracle, bootstrap parity |
| `scripts/check-kern-frontend-generic-property-style-theme-diagnostics-regressions.mjs` | add | cumulative M4.153-M4.168 receipt |
| `scripts/kern-frontend-generic-property-style-theme-diagnostics/*` | add | policy, fixtures, independent oracle, parser, tests |
| `package.json` | edit | focused M4.168 command |
| `scripts/kern-5-fitness-policy.json` | edit | promoted command and fitness row |
| `scripts/kern-5-fitness.test.mjs` | edit | exact promoted-row expectation |
| canonicalizer receipt/summary files | refresh if required | authenticate touched core/test surfaces |
| release train, support matrix, completion goal | edit | durable slice evidence |

No current public parser, diagnostic type, CLI, serializer, code generator, or
runtime route changes.

## Acceptance Criteria

- [x] RED-at-base proves the M4.168 source, checker, policy, fixtures, cumulative
      receipt, and promoted fitness row are absent for exactly that reason.
- [x] Native containment proves a closed function surface, KERN-only handlers,
      exactly one M4.167 predecessor call, and no host tokenizer/parser/oracle
      delegation.
- [x] Zero, one, adjacent, and repeated unexpected tokens exactly match
      bootstrap diagnostics and preserve later property/theme/style semantics.
- [x] Every retained token kind is classified at handoff; valid property heads,
      property-value tokens, style, theme, whitespace, and comment-stripped text
      never produce an unexpected warning.
- [x] Warning code, severity, message, line, UTF-16 col/endCol, suggestion,
      category, token index, value, and encounter order match bootstrap.
- [x] Quoted/expression value-width spans, ASCII unknown/punctuation tokens,
      empty-looking values, and preceding admitted Unicode aggregates are covered.
- [x] Duplicate and unexpected warnings preserve exact shared order while
      final property/quote/style/pseudo/theme state remains exact.
- [x] Unexpected-warning count has an independent configurable positive bound;
      exact-at-limit succeeds and first-over fails without overwriting an
      earlier semantic/resource failure.
- [x] Every returned failure, replay, and outer envelope obeys caller field and
      byte limits, including limits below the fixed failure-envelope size.
- [x] The checker rejects truncation, extension, reorder, duplicate/missing
      records, token substitution, shifted spans, forged messages/categories,
      predecessor/source/runtime/epoch drift, and corrupt counts/seals.
- [x] Mutations kill skipped, duplicated, reordered, or widened replacements;
      replacement of a valid token; failure to resume; diagnostic reordering;
      UTF-16/scalar confusion; token-value/source-width confusion; and first-
      failure overwrite.
- [x] The fused safety entry preserves the LF-free and inherited-key source
      profile and one-shot source/runtime/epoch binding.
- [x] Focused/cumulative frontend gates, touched-core tests, semantic validation,
      lint/diff hygiene, canonicalizer matrix/coverage, and complete Node 22
      `pnpm fitness:kern-5` pass.
- [x] Automatic risk-routed role review uses primary `codex`; all verified
      blockers are fixed and affected gates rerun before one signed push.

## Out of Scope

[X1] Tokenizer diagnostics, unknown-node warnings, dropped-line diagnostics,
unclosed multiline errors, invalid indentation, and tree-level diagnostics are
not owned here.

[X1a] Standalone non-ASCII unknown tokens, combining-mark unknowns, and lone
surrogates remain outside the inherited native tokenizer/retained-stream source
profile. M4.168 does not widen M4.153 tokenizer admission under a diagnostic
slice.

[X1b] Parenthesized source, including bootstrap-minified `screen ()`, remains
outside the M4.168 fused source profile. The new wrapper rejects any source
containing `(` before evidence capture so transformed bootstrap token streams
cannot be authenticated as if they described the original source.

[X2] Parser hints, keyword handlers, exports/pre-populated props, multiline tree
construction, public AST/KIR, frontend cutover, and production routing remain
excluded.

[X3] The bootstrap inherited-key hazard remains a separately scoped production
compatibility decision. M4.168 preserves the current fused guard.

## Open Questions

[Q1] None. The selected proof is a complete index-preserving transformation:
every original stream field is authenticated, every replacement is recorded,
only a proven unexpected token's kind may change to whitespace, and the checker
reconstructs both the derived stream and semantic replay. Direct runtime evidence
resolved predecessor-state recovery. Compact failures remain terminal.

## Deploy Order

[P1] This is an internal additive shadow gate. Spec, native source, checker,
fixtures, policy, cumulative receipt, fitness rows, documentation, fused safety
entry, and refreshed canonicalizer identities ship atomically in one signed
commit and one push. There is no public mixed-version skew window because no
production parser or public diagnostic contract changes.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| M4.168 could merely append unexpected diagnostics to M4.167 output | M4.167 fails at the first unexpected token and therefore has no post-warning semantic state | The successor must prove continuation and final semantics, not only warning occurrence |
| Diagnostic end columns should span the lexical token | Bootstrap uses `skipped.value.length`; quoted/expression delimiters are excluded and astral input is currently split into UTF-16-unit tokens | Fixtures and envelope fields must preserve exact value-width behavior |
| External synthesis proposed block resynchronization, primary/secondary warning suppression, surrogate snapping, severity `error`, and category `syntax` | Production consumes exactly one unexpected token, emits every warning as severity `warning` / category `parser`, and preserves current UTF-16-unit tokenization | Those proposals were rejected; the successor matches bootstrap literally |
| M4.167 needed new hash/lookahead fields before M4.168 could proceed | Its normal failure envelope already authenticates the complete retained stream, nested predecessor, source, runtime, epoch, and replay; only compact limit failures omit them | No published M4.167 format changes; compact failures are terminal |
| Bootstrap astral unexpected-token probes should become M4.168 fixtures | M4.153 deliberately fails standalone non-ASCII unknown tokens as `UNSUPPORTED_UNKNOWN`, so no retained stream reaches M4.168 | Keep exact bootstrap evidence documented but restrict fixtures to the inherited admitted token profile |
| A successful predecessor replay could reuse the last semantic cursor as the terminal cursor | Terminal ASCII whitespace is retained after the last semantic token, so the semantic cursor can stop before the authenticated token count | M4.165-M4.167 now derive the terminal cursor from authenticated `realTokenCount` only after a successful non-dropped replay; three RED-first fixtures and mutations lock the correction |
| M4.168 could authenticate the original source after bootstrap minification | Bootstrap rewrites parenthesized empty groups before tokenization, so `screen ()` produces tokens for transformed source | The M4.168 fused wrapper rejects all parenthesized source; core parser behavior and the historical canonicalizer digest remain unchanged |

## Challenge and Plan Delta

[T1] Initial confidence is 0.82. Behavior and public contract are verified, but
the derived-stream ownership proof and predecessor-state recovery remain open.
A full usable-roster brainstorm is required before implementation.

[T2] Full usable-roster brainstorm
`brainstorm-1786138302242-kaiirt-m4-168-unexpected-token-architec` completed 6/6.
All seats favored Option A and correctly emphasized index-preserving replacement,
checker reconstruction, compact-failure propagation, warning bounds, and merged
diagnostic order. The winning synthesis also invented TypeScript brands,
source hashes, resynchronization, warning suppression, and diagnostic fields
that do not exist in this repository; those suggestions were source-rejected.

[T3] A direct native probe then resolved the remaining state-recovery question:
normal M4.167 `STYLE_PROFILE` failures authenticate the complete nested
predecessor and retained stream, whereas the bounded 41-field failure is visibly
compact. The plan now selects Option A without changing M4.167: authenticate its
full envelope once, classify and record every exact one-token replacement,
derive a same-cardinality stream, reuse the published semantic replay once,
merge duplicate/unexpected warnings by token encounter, and propagate compact
failures terminally. No dependency remains unresolved. Confidence increased
from 0.82 to 0.93.

[T4] Automatic high-risk role review
`review-1786153109403-sy29o0-m4-168-unexpected-token-diagnost` completed 4/6
reviewers and identified two verified blockers: M4.165-M4.167 terminal cursors
did not consume retained trailing whitespace, and the M4.168 fused wrapper could
bind an original parenthesized source to bootstrap-minified tokens. Three other
reported loop/index claims were source-checked and rejected. RED-first fixtures
then fixed the three terminal cursor owners and narrowed the new M4.168 profile
to non-parenthesized source. The complete Node 22 `pnpm lint && pnpm
fitness:kern-5` wall passed, including the 15-fixture M4.168 cumulative receipt.
Targeted independent review
`review-1786164424792-k10u0d-m4-168-blocker-fixes` passed 1/1 with zero
findings. No dependency remains unresolved. Confidence increased to 0.99.
