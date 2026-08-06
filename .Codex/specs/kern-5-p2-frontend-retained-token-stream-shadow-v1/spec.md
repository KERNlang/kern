# KERN 5 Phase 2: retained-code token-stream shadow v1

**Milestone:** M4.159
**Status:** implementation contract
**Confidence:** 0.95

## Decision

[D1] M4.159 adds the internal release-blocking format
`kern.frontend.retained-token-stream-shadow.1`. It authenticates the previously
unproved handoff from M4.158's retained-code boundary to the complete ordered
line-mode token stream and tokenizer diagnostics. It does not admit a node or
cut the public parser over to KERN.

[D2] M4.159 composes the unchanged M4.158 `observewhitespacetrim` result and
the unchanged M4.153 `tokenizeline` result inside native KERN. It derives the
retained prefix only from authenticated content plus `codeEndOffset`; raw
content, removed whitespace, marker text, and payload may never be tokenized.

[D3] The input remains one well-formed, LF/CR-free parser content record after
indentation and full-line comment routing. Multiline grouping, raw blocks,
full-line comments, indentation diagnostics, and document coordinates remain
owned by earlier or bootstrap layers.

[D4] Empty or admitted ASCII-whitespace-only retained code is a typed profile
failure `EMPTY_RETAINED_CODE`. The bootstrap parser skips such a line before
constructing `TokenStream`; M4.159 therefore must not emit an apparently
admissible empty stream. Non-ASCII record-end whitespace remains subject to
M4.158's unchanged tokenizer profile and may fail earlier as
`UNSUPPORTED_UNKNOWN`.

[D5] M4.159 proves the complete ordered `Token[]` input used by bootstrap
`TokenStream`. It does not run or shadow `tryIdent()`. First-identifier
admission and `DROPPED_LINE` behavior are reserved for M4.160.

[D6] Token end positions are not invented. Bootstrap `Token` owns only
`kind`, `value`, and zero-based `pos`. M4.159 emits exact scalar and UTF-8 byte
start positions plus an exact source delta from the previous token start.
Diagnostics separately retain their exact start and end positions.

## Envelope contract

[E1] One format field precedes fixed-width 10-field records. Success contains:

1. exactly one `stream` header;
2. every `token` record in bootstrap token order;
3. every `diagnostic` record in bootstrap diagnostic order;
4. exactly one terminal `seal`.

[E2] The `stream` header fields are:

1. tag (`stream`);
2. stream index (`0`);
3. exact admitted content;
4. scalar code-end offset;
5. scalar trivia-end offset;
6. marker offset (`none` or canonical scalar uint);
7. marker kind (`none`, `hash`, or `slash-slash`);
8. marker text (``, `#`, or `//`);
9. exact raw payload;
10. retained-code scalar length, equal to code-end offset.

[E3] A `token` record contains:

1. tag (`token`);
2. zero-based canonical token index;
3. exact tokenizer kind;
4. exact tokenizer value;
5. exact retained-source slice from the previous token start to this start;
6. zero-based retained/content scalar start;
7. zero-based retained/content UTF-8 byte start;
8. empty reserved field;
9. empty reserved field;
10. empty reserved field.

[E4] A `diagnostic` record contains:

1. tag (`diagnostic`);
2. zero-based canonical diagnostic index;
3. exact tokenizer diagnostic code;
4. exact retained-source slice from the previous diagnostic start to this
   start;
5. exact diagnostic source span;
6. zero-based scalar start;
7. zero-based scalar end;
8. zero-based UTF-8 byte start;
9. zero-based UTF-8 byte end;
10. empty reserved field.

[E5] The terminal `seal` contains:

1. tag (`seal`);
2. exact token count;
3. exact diagnostic count;
4. retained-source tail from the last token start to retained end;
5. retained-source tail from the last diagnostic start to retained end;
6. retained scalar length;
7. retained UTF-8 byte length;
8. exact original content;
9. code-end offset;
10. trivia-end offset.

[E6] Token and diagnostic delta tapes independently reconstruct retained code:

`tokenDelta[0] + ... + tokenDelta[n-1] + tokenTail == retainedCode`

and, including the zero-diagnostic case:

`diagnosticDelta[0] + ... + diagnosticDelta[m-1] + diagnosticTail == retainedCode`.

The exact original content plus M4.158 offsets/marker fields independently
reconstruct code, removed whitespace, marker, and payload.

[E7] A failure is one 10-field record containing `failure`, exact code, exact
detail, and seven empty padding fields. Partial stream/header/token/diagnostic
records may never escape.

## Coordinate and source rules

[C1] KERN `Text.length`, `Text.charAt`, and `Text.slice` remain the scalar
address space. M4.159 adds a native, explicit UTF-8 byte-count helper over
well-formed scalars: one byte through U+007F, two through U+07FF, three through
U+FFFF, and four above U+FFFF. Host byte positions use `Buffer.byteLength`.

[C2] Retained and content-relative starts are identical because the admitted
record begins after indentation stripping. Document, physical-line, and
indent-relative offsets are not claimed.

[C3] Token starts come from the tokenizer's authenticated source-delta tape,
not from token value length. `evolved:name` is a mandatory witness: its token
value is `name`, while its source start remains at the `e` in `evolved`.
Quoted escapes, expression trimming, and styles likewise forbid deriving raw
positions from normalized values.

[C4] Token starts are strictly nondecreasing and token indices are contiguous.
Diagnostic starts are nondecreasing, end is at least start, and diagnostic
indices are contiguous. A diagnostic and token may share a start.

## Native composition contract

[N1] The new native handler first calls `observewhitespacetrim` with the exact
inherited limits. It accepts only the exact 37-field M4.158 success envelope,
validates format/tag/seal/source identity, parses canonical bounded offsets,
and maps an inherited failure atomically.

[N2] The handler slices retained code at the validated scalar code-end offset
and rejects an empty result. It then calls the unchanged `tokenizeline` with a
derived record ceiling of `maxTokens + maxDiagnostics`; this ceiling cannot
bind before the inherited token or diagnostic ceilings.

[N3] The tokenizer envelope must have the exact M4.153 format, four-field
record alignment, allowed token/diagnostic tags, one terminal seal, valid
source deltas, and no mixed failure/success records. Inherited tokenizer
failures map atomically.

[N4] The composer walks the tokenizer records to recover each record start,
then emits canonical token records in a token pass and canonical diagnostic
records in a diagnostic pass. This changes serialization order only; it does
not change either bootstrap array's order.

[N5] No host tokenizer/parser, `TokenStream`, `tryIdent`, oracle function,
capability, or runtime callback may appear in KERN source. Source files are
regular LF-only repository files, every handler is `lang="kern"`, and the
composed source contains exactly one tokenizer, one shared lexical scanner,
one M4.158 trim handler, and one M4.159 stream handler.

## Failure and containment contract

[F1] Observable failure precedence is:

1. host `MALFORMED_UTF16`;
2. host `SOURCE_BYTES_LIMIT`;
3. host `CODE_POINTS_LIMIT`;
4. host `UNSUPPORTED_LINE_ENDING`;
5. inherited M4.158 `INVALID_LIMITS` or `LEXICAL_DEPTH_LIMIT`;
6. inherited first tokenizer failure;
7. native `STREAM_INVALID` for malformed composed envelopes;
8. native `EMPTY_RETAINED_CODE`;
9. inherited second tokenizer failure;
10. strict record, delta, coordinate, count, seal, output-byte, and oracle
    rejection.

[F2] The first tokenizer call remains inside M4.158 and proves the retained
prefix is admissible before any stream header exists. The second deterministic
call exposes the authenticated stream. Any disagreement or malformed envelope
fails closed; no partial result is returned.

[F3] The policy is exact and closed. It fixes only the new format and source
profile, derives `maxStreamRecords = maxTokens + maxDiagnostics`, and proves:

`1 + (maxStreamRecords + 2) * 10 <= runtime maxCollectionLength`.

It also proves the complete runtime JSON envelope fits the inherited output
and runtime byte ceilings.

## Independent oracle

[O1] The host oracle independently rescans original content with the frozen
M4.158 lexical/trim rules, derives retained code, and rejects empty retained
code. It must not parse an M4.159 result to determine expected boundaries.

[O2] The oracle runs the compiled bootstrap `tokenizeLineInternal` in `line`
mode with a fresh parse state. It projects exact token kind/value plus scalar
and byte starts from bootstrap `pos`, and exact diagnostic scalar/byte spans
from bootstrap diagnostic columns.

[O3] The strict host parser independently reconstructs both delta tapes,
validates every offset against original content, checks M4.158 boundary
identity, validates counts and terminal seals, and then compares all projected
fields with the oracle.

## Verification contract

[V1] The implementation starts RED because the M4.159 source, checker, policy,
oracle, fixtures, tests, package command, fitness rows, and ownership row do
not exist.

[V2] Release-blocking success cases cover both marker kinds, record-end input,
empty/nonempty payloads, every token kind, multiple tokens, multiple
diagnostics, diagnostic/token shared starts, astral content before later
tokens, escaped quotes, nested expressions/styles, `evolved:name`, and
non-ASCII removed suffix/payload scalars that the raw tokenizer rejects.

[V3] Empty source, admitted ASCII-whitespace-only source, and comment-only
retained prefixes must produce `EMPTY_RETAINED_CODE`, never a sealed
zero-token/whitespace-only success. Non-ASCII record-end whitespace remains an
explicit inherited exclusion.

[V4] Named mutations must kill at least: tokenizing original content; code-end
offset ±1; missing/duplicated/swapped token two; missing/duplicated/swapped
diagnostics; token start from normalized value length; scalar/code-unit/byte
confusion; forged token or diagnostic delta; changed marker/payload identity;
forged counts; forged terminal source or retained tails; partial output after
any inherited limit failure; and a constant stream.

[V5] Exact lower/upper bounds cover complete input bytes/scalars, lexical
depth, token/diagnostic/derived-record counts, runtime collection length,
complete runtime-envelope JSON bytes, and LF/CR exclusion.

[V6] M4.153 through M4.158 dedicated gates are mandatory regressions. M4.158
success/failure values remain byte-stable because no earlier source or policy
format is changed.

[V7] The release-blocking command is
`pnpm test:kern-frontend-retained-token-stream-shadow`. It runs the focused
core build, M4.159 adversarial tests, independent differential cases, and the
M4.153-M4.158 regression set. The command is promoted into `test:infra` and
the current KERN 5 fitness wall.

## Tribunal and plan delta

[T1] Exact-roster tribunal
`tribunal-1786021620790-3zqwqb-kern-5-m4-159-selection` selected the retained
token-stream composition seam over comment attachment or first-node
admission. M4.158 calls the tokenizer but discards its result, so this is a
real unauthenticated handoff rather than a wrapper around already published
evidence.

[T2] The tribunal rejected first-node admission because a correct first token
can coexist with dropped, duplicated, reordered, or shifted later tokens. It
also caught invented node-type enums, comment tokens, and multiline identifier
semantics that do not exist in the bootstrap contract.

[T3] Direct source inspection narrowed the tribunal's proposed generic token
"spans": bootstrap `Token` exposes only `pos`, so M4.159 binds scalar/byte
starts and exact delta tapes without inventing token end positions. Diagnostic
end spans remain real and are included.

[T4] Confidence after tribunal and contract grounding is 0.95. The remaining
implementation dependency is proving the KERN UTF-8 byte helper and two-pass
projection preserve the M4.153 tokenizer's delta semantics, especially for
astral prefixes, diagnostics that share token starts, and `evolved:name`.

## Expected files

- `.Codex/specs/kern-5-p2-frontend-retained-token-stream-shadow-v1/spec.md`
- `examples/kern-frontend/retained-token-stream.kern`
- `scripts/check-kern-frontend-retained-token-stream.mjs`
- `scripts/kern-frontend-retained-token-stream/fixtures.mjs`
- `scripts/kern-frontend-retained-token-stream/oracle.mjs`
- `scripts/kern-frontend-retained-token-stream/policy.json`
- `scripts/kern-frontend-retained-token-stream/policy.mjs`
- `scripts/kern-frontend-retained-token-stream/retained-token-stream.test.mjs`
- `package.json`
- `scripts/kern-5-fitness-policy.json`
- `scripts/kern-5-fitness.test.mjs`
- KERN 5 goal, release, support-matrix, and gate documentation

## Explicit deferrals

[X1] M4.159 does not attach comments/whitespace as trivia, interpret payloads,
normalize comment text, emit token end spans, or change tokenizer behavior.

[X2] It does not run `TokenStream`, `tryIdent`, node-type admission,
`DROPPED_LINE`, declarations, properties, expressions, AST/KIR emission, or
parser diagnostics outside the tokenizer's existing diagnostic set.

[X3] It does not own multiline/document/indent coordinates, non-line lex
modes, public APIs, parser cutover, or general Unicode tokenizer widening.
