# KERN 5 Phase 2: bounded pre-tokenization whitespace-trim shadow v1

**Milestone:** M4.158
**Status:** implementation contract
**Confidence:** 0.96

## Decision

[D1] M4.158 adds the internal release-blocking format
`kern.frontend.whitespace-trim-shadow.1`. It shadows only the line-local
ordering used by `parser-core.ts`: find an eligible inline comment boundary,
remove ECMAScript trailing whitespace from the code prefix, and tokenize only
the retained code. It does not cut the public parser over to KERN.

[D2] M4.158 is a deliberately bounded pre-tokenization source profile, not a
post-M4.157 mapper. M4.157 tokenizes the unstripped record and therefore
rejects non-ASCII trim scalars before a marker as `UNSUPPORTED_UNKNOWN`.
M4.158 must reach those scalars before tokenization to provide meaningful
integrated evidence for the normative trim table.

[D3] One shared native-KERN helper, `scanlexicalcontent`, owns the quote,
escape, expression-depth, style-depth, eligible-marker, and marker-offset
state transition. M4.156 `observelexical` and M4.158 both call that helper.
The existing M4.156 signature, 12-field records, failure ordering, and output
semantics remain unchanged.

[D4] The M4.158 input is one well-formed, LF/CR-free parser content record
after indentation and full-line comment routing. Multiline grouping, raw
blocks, boundary records, and full-line comment classification stay owned by
the existing stitch/parser layers and are outside this source profile.

[D5] M4.158 emits exactly one 18-field `trim` record followed by one 18-field
seal. The first 16 fields use the M4.157 partition meanings for the bounded
single-record profile; the last two fields are scalar offsets:

1. tag (`trim`)
2. trim index (`0`)
3. checkpoint index (`0`)
4. group index (`0`)
5. group-record index (`0`)
6. physical index (`0`)
7. exact content
8. terminal quote (`none`, `single`, `double`)
9. escape-pending (`0` or `1`)
10. expression depth
11. style depth
12. stop (`eligible-marker` or `record-end`)
13. marker offset (`none` or canonical scalar uint)
14. marker kind (`none`, `hash`, `slash-slash`)
15. marker text (``, `#`, `//`)
16. exact raw payload
17. code-end offset
18. trivia-end offset

[D6] No derived `raw`, `code`, `trivia`, `trimmedContent`, or code-prefix
string is serialized. The authenticated content plus offsets and marker fields
derive every partition:

`scalarSlice(content, 0, codeEndOffset)` is retained code.

`scalarSlice(content, codeEndOffset, triviaEndOffset)` is the exact removed
trailing-whitespace interval.

For eligible markers, `triviaEndOffset == markerOffset` and:

`code + removedWhitespace + markerText + rawPayload == content`.

[D7] Eligible-marker records satisfy:

`0 <= codeEndOffset < triviaEndOffset == markerOffset < scalarLength(content)`.

`codeEndOffset` is the maximal prefix end obtained by scanning backward from
`markerOffset` while the preceding scalar belongs to the frozen trim table.
The marker remains eligible only after ASCII space or tab under the shared
M4.156 scanner; the larger trim table does not widen marker eligibility.

[D8] Record-end records are never trimmed. They satisfy:

`codeEndOffset == triviaEndOffset == scalarLength(content)`

and contain no marker or payload fields. This intentionally preserves the
bootstrap asymmetry: trailing whitespace is retained without an eligible
comment and removed only from the prefix before an eligible comment.

[D9] Every offset is a Unicode-scalar index. UTF-16 code-unit and UTF-8 byte
offsets are forbidden. KERN `Text.length`, `Text.charAt`, and `Text.slice`
provide the native scalar address space; host validation uses scalar arrays.

## Normative whitespace table

[W1] M4.158 owns an explicit KERN predicate for the ECMAScript
WhiteSpace/LineTerminator set:

- U+0009 CHARACTER TABULATION
- U+000A LINE FEED
- U+000B LINE TABULATION
- U+000C FORM FEED
- U+000D CARRIAGE RETURN
- U+0020 SPACE
- U+00A0 NO-BREAK SPACE
- U+1680 OGHAM SPACE MARK
- U+2000 through U+200A
- U+2028 LINE SEPARATOR
- U+2029 PARAGRAPH SEPARATOR
- U+202F NARROW NO-BREAK SPACE
- U+205F MEDIUM MATHEMATICAL SPACE
- U+3000 IDEOGRAPHIC SPACE
- U+FEFF ZERO WIDTH NO-BREAK SPACE

[W2] U+0085 and U+180E are explicit negative sentinels. No host `trim`,
`trimEnd`, regular-expression whitespace class, Unicode property lookup,
platform `isspace`, locale, or target-specific whitespace function may decide
membership.

[W3] LF and CR are members of the normative predicate but cannot occur inside
the admitted single physical record. Their predicate membership is tested
directly; every other reachable table member is also tested in an integrated
eligible-marker record.

## Source profile and tokenizer boundary

[S1] Host admission rejects malformed UTF-16, raw source byte overflow,
raw scalar overflow, and any LF or CR before native execution. These checks
cover the complete record, including the discarded whitespace and payload.
Trimming may never make an oversized or malformed input admissible.

[S2] The shared scanner runs over the complete admitted content. For an
eligible marker, M4.158 reverse-scans only the prefix ending at markerOffset.
It then invokes the unchanged `tokenizeline` KERN function on retained code
only. Payload and removed whitespace are not tokenized, matching bootstrap
parser ordering.

[S3] A non-table unknown scalar in retained code remains subject to the
unchanged tokenizer and fails `UNSUPPORTED_UNKNOWN`. A table scalar in the
removed interval and any well-formed scalar in raw payload do not widen the
general tokenizer profile.

[S4] On sources already admitted by M4.157, marker identity, terminal lexical
state, raw payload, and derived offsets must agree with an independent M4.157
comparison. On the widened discarded-suffix/payload profile, M4.158 is
intentionally not failure-equivalent to M4.157.

## Failure and containment contract

[F1] Observable failure precedence is:

1. host `MALFORMED_UTF16`;
2. host `SOURCE_BYTES_LIMIT`;
3. host `CODE_POINTS_LIMIT`;
4. host `UNSUPPORTED_LINE_ENDING` for LF or CR;
5. native `INVALID_LIMITS`;
6. shared scanner `LEXICAL_DEPTH_LIMIT`;
7. unchanged tokenizer failures on retained code:
   `CODE_POINTS_LIMIT`, `TOKEN_LIMIT`, `DIAGNOSTIC_LIMIT`, `RECORD_LIMIT`, or
   `UNSUPPORTED_UNKNOWN`;
8. strict envelope, offset, reconstruction, seal, and oracle rejection.

[F2] A native failure uses the same 18-field width as success records. It
contains `failure`, exact code, exact detail, and fifteen empty padding fields.
Partial trim records may never escape.

[F3] The policy is exact and closed. It fixes the new format and source-profile
identifier, reuses the tokenizer and lexical limits, and proves that one
format field plus one 18-field record plus one 18-field seal fits the runtime
collection bound. No mutable trim table, engine identity, or routing choice is
policy data.

[F4] The KERN source files must be regular, LF-only repository files. Every
handler is `lang="kern"`. Source validation rejects host execution helpers,
bootstrap parser/tokenizer calls, oracle names, `trim`, `trimEnd`, regex
whitespace delegation, and duplicate scanner implementations.

## Verification contract

[V1] The implementation starts red because the M4.158 source, checker, policy,
oracle, fixtures, tests, package command, and fitness entries do not exist.

[V2] Existing M4.156 and M4.157 dedicated gates are mandatory regression
gates after the shared-scanner extraction. Their record bytes and failure
results must remain behaviorally identical for the existing fixture corpora.

[V3] Integrated success cases cover both marker kinds, empty and non-empty
payloads, one-scalar and mixed removed whitespace, every reachable
trim-table scalar, astral code before the boundary, astral and non-ASCII
payloads, quotes, expressions, styles, and exact scalar reconstruction.

[V4] Record-end cases prove trailing whitespace is retained, markers inside
quotes/expressions/styles remain inert, `x#y` and `http://` remain inert, and
non-table U+0085/U+180E in retained code fail through the tokenizer.

[V5] The direct predicate matrix covers every table member including LF/CR,
U+0085/U+180E negatives, and adjacent scalar sentinels. The integrated oracle
must not derive expected offsets by parsing the M4.158 envelope.

[V6] Named mutations must kill at least: scanner quote state, expression
depth, style depth, marker eligibility, marker width, one included table
member, U+0085 false admission, forward instead of reverse trim, record-end
trimming, code-end offset, trivia-end offset, scalar/code-unit confusion,
payload slicing, tokenizer-on-raw-content, terminal seal, and source identity.

[V7] Exact lower/upper boundaries cover source bytes, scalar length, lexical
depth, tokenizer token/diagnostic/record counts, runtime collection length,
output JSON bytes, and the single-record LF/CR exclusion.

[V8] The release-blocking command is
`pnpm test:kern-frontend-whitespace-trim-shadow`. It runs the focused build,
shared-scanner regression tests, M4.158 adversarial tests, differential cases,
and full-table predicate matrix. The command is promoted into both
`test:infra` and the current KERN 5 fitness wall.

## Tribunal, brainstorm, and plan delta

[T1] Exact-roster tribunal
`tribunal-1786016189236-iqi0rt-kern-5-m4-158-whitespace-trim` selected a narrow
18-field offsets-only contract, no serialized derived strings, and record-end
no-trim behavior. Its verdict proposed UTF-16 offsets; direct inspection of
the shipped M4.156/M4.157 contracts disproved that point because their KERN
and host validators intentionally use Unicode-scalar offsets.

[T2] The pure mapper plan started at confidence 0.93, then fell to 0.79 after
proving that M4.157 rejects non-ASCII trim scalars before M4.158 can observe
them. Exact-roster brainstorm
`brainstorm-1786016657470-d540u8-kern-5-m4-158-source-admission` changed the
architecture to a pre-tokenization boundary backed by one shared scanner.

[T3] Nero challenge
`nero-1786016820380-sbpwks-kern-5-m4-158-plan-challenge` identified payload,
surrogate, limit, and record-end risks. The final contract resolves them by
checking the complete host input before trimming, intentionally admitting only
discarded suffix/payload beyond the old profile, retaining scalar addressing,
keeping eligible marker fields, and deferring all attachment consumers.

[T4] Confidence after the complete challenge sequence is 0.96. The remaining
implementation dependency is regression-proving that extracting the shared
scanner leaves M4.156/M4.157 behavior unchanged.

## Expected files

- `.Codex/specs/kern-5-p2-frontend-whitespace-trim-shadow-v1/spec.md`
- `examples/kern-frontend/lexical-scan.kern`
- `examples/kern-frontend/lexical-checkpoints.kern`
- `examples/kern-frontend/whitespace-trim.kern`
- `scripts/check-kern-frontend-lexical.mjs`
- `scripts/check-kern-frontend-whitespace-trim.mjs`
- `scripts/kern-frontend-whitespace-trim/fixtures.mjs`
- `scripts/kern-frontend-whitespace-trim/oracle.mjs`
- `scripts/kern-frontend-whitespace-trim/policy.json`
- `scripts/kern-frontend-whitespace-trim/policy.mjs`
- `scripts/kern-frontend-whitespace-trim/whitespace-trim.test.mjs`
- `package.json`
- `scripts/kern-5-fitness-policy.json`
- KERN 5 goal, release, support-matrix, and gate documentation

## Explicit deferrals

[N1] M4.158 does not attach comments or whitespace, create trivia nodes or
source spans, alter marker eligibility, interpret payloads, normalize comment
text, trim leading whitespace, or change parser diagnostics.

[N2] It does not own multiline grouping, raw-block handling, full-line comment
routing, indentation validity, AST/KIR admission, public APIs, parser cutover,
or general Unicode tokenizer widening.

[N3] The record-end/comment trailing-whitespace asymmetry remains observable
bootstrap behavior. A later parser-semantics milestone may reconsider it only
with an explicit compatibility decision.
