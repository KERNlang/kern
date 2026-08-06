# KERN 5 Phase 2: node-type-token admission shadow v1

**Milestone:** M4.160
**Status:** implementation contract
**Confidence:** 0.98

## Decision

[D1] M4.160 adds the internal release-blocking format
`kern.frontend.node-type-token-admission-shadow.1`. It authenticates the
bootstrap parser's first `TokenStream.tryIdent()` decision over M4.159's exact
retained token stream and preserves the matching `DROPPED_LINE` diagnostic and
`__error` recovery value. It does not admit a known parser node or cut the
public parser over to KERN.

[D2] The admitted source is the non-empty retained-code prefix produced by
M4.159 after inline-comment removal and comment-adjacent ASCII-whitespace
trimming. The original comment marker, payload, and removed trivia remain
authenticated by M4.159 but are not part of bootstrap `ParsedLine.rawLength`,
`props.raw`, or location end columns.

[D3] Admission is cursor-exact. Cursor zero advances to one only when token
zero has kind `identifier`; otherwise it remains zero. No whitespace is
skipped. A later identifier cannot rescue a token-zero whitespace, number,
quoted, style, expression, punctuation, slash, theme-ref, or unknown token.

[D4] An admitted identifier exposes its exact normalized token value as the
provisional node type. In particular, `evolved:name` admits `name`. M4.160
does not call `isKnownNodeType`, inspect multiline/template registries, or emit
`UNKNOWN_NODE_TYPE`; those are mutable classification concerns for a later
slice.

[D5] A rejected token stream emits the exact single-line, content-relative
bootstrap projection for synthetic line 1 and parse column 1: one
`DROPPED_LINE` error diagnostic and one `__error` recovery record. This proves
diagnostic and positional recovery preservation, not successful node
admission.

[D6] Empty, ASCII-whitespace-only, and comment-only retained code remain
M4.159 typed failures. Indentation, physical line numbers, full-line comments,
multiline stitching, `export fn` rewriting, document tree placement, and
partial/error counts are not claimed by this content-relative seam.

## Envelope contract

[E1] One format field precedes fixed-width 16-field records. A successful
admission contains exactly `decision`, `seal`. A dropped stream contains
exactly `decision`, `diagnostic`, `error`, `seal`. A failure contains exactly
one `failure` record. Partial records may never escape.

[E2] The `decision` record fields are:

1. tag (`decision`);
2. status (`admitted` or `dropped`);
3. exact retained source;
4. cursor before (`0`);
5. cursor after (`1` or `0`);
6. exact token count;
7. token-zero kind;
8. token-zero normalized value;
9. token-zero scalar start;
10. first-nonwhitespace token index;
11. first-nonwhitespace scalar start;
12. admitted type or empty;
13. M4.159 format link;
14. M4.159 code-end offset;
15. M4.159 trivia-end offset;
16. exact M4.159 envelope field count.

[E3] Token zero always exists because M4.159 rejects empty retained streams.
The first-nonwhitespace index/start are exact diagnostic-position evidence,
not an admission cursor. They are canonical uints when present and `none`
only when no nonwhitespace token exists.

[E4] One or more `stream-auth` records immediately follow the decision. Their
fields are tag, contiguous chunk index, contiguous inherited field start,
field count from 1 through 12, the next exact M4.159 fields, and empty padding
through field 16. Concatenating the counted payloads reconstructs every
M4.159 field byte-for-byte. The host compares that sequence to its independent
canonical M4.159 projection.

[E5] The `diagnostic` record fields are:

1. tag (`diagnostic`);
2. code (`DROPPED_LINE`);
3. severity (`error`);
4. exact message (`Dropped line 1: expected a node type at the start of the line`);
5. line (`1`);
6. content-relative UTF-16 column (`1 + firstNonWhitespaceUtf16Start`);
7. UTF-16 end column (`1 + retainedSourceUtf16Length`);
8. exact bootstrap suggestion;
9. category (`parser`);
10-16. empty reserved fields.

[E6] The `error` record fields are:

1. tag (`error`);
2. type (`__error`);
3. indent (`0`);
4. raw length (retained-source UTF-16 code-unit length);
5. props message (`Dropped line 1: expected a node type`);
6. props raw (exact retained source);
7. props code (`DROPPED_LINE`);
8. quoted-props state (`absent`);
9. styles count (`0`);
10. pseudo-styles count (`0`);
11. theme-ref count (`0`);
12. location line (`1`);
13. location column (`1`);
14. location end line (`1`);
15. location UTF-16 end column (`1 + retainedSourceUtf16Length`);
16. empty reserved field.

[E7] The terminal `seal` fields are tag, status, exact retained source, exact
token count, cursor after, first-nonwhitespace index, admitted type or empty,
diagnostic count, error count, retained scalar length, retained UTF-8 byte
length, M4.159 original content, M4.159 code-end offset, M4.159 trivia-end
offset, M4.159 marker kind, and one empty reserved field.

[E8] A failure record contains tag, exact code, exact detail, and thirteen
empty padding fields. Inherited M4.159 failures retain their code/detail;
malformed composed evidence becomes `ADMISSION_INVALID`.

## Native composition contract

[N1] The KERN handler calls the unchanged M4.159
`observeretainedtokenstream` with the exact M4.160 policy limits. M4.160
configures at most 512 tokens and 64 tokenizer diagnostics inside M4.159's
broader bounds, so over-limit inputs fail in the producer before authentication
work begins. It accepts only
the exact M4.159 format, 10-field alignment, one stream header, ordered token
and diagnostic phases, one terminal seal, canonical counts and offsets, and
matching source/boundary identity.

[N2] Before using token zero, the handler validates every M4.159 record's
phase, contiguous index, padding, delta coordinates, counts, and terminal seal,
including both complete source delta tapes. It may not decide from a shallow
prefix of an otherwise malformed stream. It copies every inherited field into
counted fixed-width `stream-auth` records, which the independent host oracle
compares against its own canonical M4.159 projection; catalog-valid
substitutions are therefore observable without a collision-prone digest or an
oversized string. Inherited failures map atomically.

[N3] The retained source is `Text.slice(originalContent, 0, codeEndOffset)`.
The decision uses only token record zero. `identifier` advances cursor and
admits the normalized token value; every other kind drops without cursor
movement. The first nonwhitespace token is scanned independently only to
derive the bootstrap diagnostic column.

[N4] No host parser/tokenizer, `TokenStream`, `tryIdent`, known-type registry,
oracle function, capability, or runtime callback may appear in KERN source.
Every handler is `lang="kern"`; the composed source contains exactly one each
of M4.153 tokenizer, shared lexical scanner, M4.158 trim handler, M4.159 stream
handler, and M4.160 admission handler.

## Failure and containment contract

[F1] Observable failure precedence is inherited M4.159 failure, malformed
M4.159 envelope as `ADMISSION_INVALID`, then strict admission record/count/
coordinate/seal/output/oracle rejection. Marker offset, kind, text, and raw
payload are re-derived from the original content, and token kinds plus
tokenizer diagnostic codes are closed catalogs rather than trusted producer
strings. An inherited failure propagates only after exact M4.159 format, width,
code, detail, and padding validation. There is no local source-profile failure
after a valid M4.159 stream.

[F2] Source input remains one well-formed LF/CR-free bounded content record.
The policy fixes format/profile, configures the 512-token/64-diagnostic
authentication ceiling, and inherits byte, scalar, lexical-depth,
runtime-collection, and runtime-output ceilings. The derived stream-record
ceiling is their sum. No changeable limit is hardcoded in KERN source.

[F3] The complete runtime result is bounded by four 16-field records plus the
format field and is proven below runtime collection and byte ceilings. An
admitted result cannot contain diagnostic/error records; a dropped result
must contain exactly one of each.

## Independent oracle

[O1] The host oracle independently calls the M4.159 oracle, projects its first
token exactly, and simulates cursor zero. It does not parse the M4.160 result
to derive expected admission, coordinates, diagnostic, or recovery fields.

[O2] On drop, the oracle scans the independent token list for the first
nonwhitespace token and converts its authenticated scalar start back to the
bootstrap tokenizer's UTF-16 `Token.pos` address space. It derives end columns
and recovery raw length from retained-source UTF-16 code-unit length. Scalar
and UTF-8 byte lengths remain separately sealed.

[O3] The strict host parser validates the entire M4.159-linked identity,
fixed-width phase machine, canonical uints, exact constants, status-dependent
record count, counts, scalar/byte lengths, and terminal seal before comparing
the result with the independent oracle.

## Verification contract

[V1] The slice starts RED because its source, checker, policy, fixtures,
oracle, tests, root command, fitness rows, ownership row, and documentation do
not exist at the M4.159 base.

[V2] Success fixtures include plain identifiers, `evolved:name`, Unicode
identifier values, identifier plus later tokenizer diagnostics, both comment
markers, removed Unicode payload, no-marker trailing whitespace, and multiple
later tokens. Unknown-but-identifier node names remain admitted.

[V3] Drop fixtures cover every non-identifier token-zero kind and a synthetic
leading-whitespace token followed by an identifier. They prove cursor zero,
first-nonwhitespace diagnostic coordinates, exact retained raw value, Unicode
UTF-16/scalar/byte separation, and comment-trimmed end columns.

[V4] The exact configured 512-token maximum succeeds inside the deterministic
runtime step budget and 513 tokens fail atomically with `TOKEN_LIMIT`.

[V5] Named mutations must kill at least: skipping whitespace; admitting the
first nonwhitespace identifier; classifying known node names; using the raw
`evolved:name` source instead of normalized `name`; cursor movement on drop;
diagnostic position from token zero; code-unit/byte confusion; original
comment-bearing content in `props.raw`; missing/duplicated/reordered status
records; forged M4.159 link/boundaries/counts or a later token delta; collapsed
astral UTF-16 width; forged marker offset/text/raw payload, diagnostic code, or
later token kind; partial output after failure; and a constant result.

[V6] M4.153 through M4.159 dedicated gates are mandatory regressions. The
release-blocking command is
`pnpm test:kern-frontend-node-type-token-admission-shadow`; it runs the core
build, M4.160 adversarial tests and differential checker, then the complete
M4.153-M4.159 frontend regression wall. It is promoted into `test:infra` and
the current KERN 5 fitness wall.

## Tribunal and plan delta

[T1] Exact-roster tribunal
`tribunal-1786027011311-w6j9ao-kern-5-m4-160-first-node-admissi` selected
cursor-zero token admission plus exact drop recovery over known-type
classification or broader property/node parsing.

[T2] The tribunal caught that `TokenStream.tryIdent()` does not skip
whitespace, that `UNKNOWN_NODE_TYPE` is a nonblocking warning dependent on
mutable runtime registries, and that `__error` proves recovery rather than
successful node admission.

[T3] Source tracing after the tribunal established that bootstrap
`stripInlineComment` returns `trimEnd()` only when it finds a marker, making
M4.159 retained code the exact bootstrap raw/error source for this seam.
Indentation and `export fn` preprocessing remain separate dependencies.

[T4] Initial confidence was 0.92. The tribunal and direct source evidence
removed the whitespace, classification, and raw-source ambiguities. New
confidence is 0.98; the remaining implementation dependency is preserving the
complete M4.159 validation before projecting a two- or four-record result.

## Expected files

- `.Codex/specs/kern-5-p2-frontend-node-type-token-admission-shadow-v1/spec.md`
- `examples/kern-frontend/node-type-token-admission.kern`
- `scripts/check-kern-frontend-node-type-token-admission.mjs`
- `scripts/check-kern-frontend-node-type-token-admission-regressions.mjs`
- `scripts/kern-frontend-node-type-token-admission/{fixtures,oracle,policy}.mjs`
- `scripts/kern-frontend-node-type-token-admission/policy.json`
- `scripts/kern-frontend-node-type-token-admission/node-type-token-admission.test.mjs`
- package, fitness-policy, fitness-test, goal, release, support-matrix, and gate documentation

## Explicit deferrals

[X1] M4.160 does not classify known/evolved/template/multiline node types,
emit `UNKNOWN_NODE_TYPE`, parse props/styles/themes, or build a successful
`ParsedLine`/IR node.

[X2] It does not own indentation, `export fn` rewriting, physical/document
coordinates, full-line comments, multiline stitching, tree recovery counts,
public APIs, parser cutover, or Unicode tokenizer widening.
