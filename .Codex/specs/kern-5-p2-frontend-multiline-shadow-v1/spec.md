# KERN 5 Phase 2: bounded multiline stitch shadow v1

Status: implementation contract

Confidence: 0.95

## Decision

[D1] This slice adds an internal, release-blocking
`kern.frontend.stitch-shadow.1` oracle. It owns lossless LF document framing
and the decision that an unterminated double-quoted property or nested
`{{ ... }}` expression continues across physical lines.

[D2] The emitted line classes are observational candidates, not parser
semantics. In particular, `file-comment-candidate`,
`raw-opener-candidate`, blankness, and indentation bytes do not claim that
the complete frontend has interpreted trivia, comments, raw bodies, or the
indentation tree.

[D3] The existing KERN-authored single-line tokenizer remains the token owner.
This slice may compose it only from ordinary KERN functions. TypeScript may
construct the differential oracle and validate the returned envelope, but no
bootstrap tokenizer/parser result may be supplied to KERN execution.

## Current evidence

[E1] M4.153 owns a bounded KERN line-tokenizer shadow, but its handler accepts
only one source line.

[E2] The bootstrap parser currently owns physical-line splitting, multiline
quote/expression stitching, and defensive stops at file-comment lines and
multiline raw-block openers.

[E3] `parser-tokenizer.ts` declares non-line lex modes but intentionally
rejects them; context-aware token dispatch remains deferred.

## Contract

### Input and line endings

[C1] The handler accepts one UTF-8 document represented by a well-formed
JavaScript string plus policy-owned positive limits.

[C2] LF is the only admitted record separator. Any carriage return anywhere
fails closed with `UNSUPPORTED_LINE_ENDING`. The handler emits no partial
success envelope on failure.

[C3] Empty input contains one empty physical record with no LF. A terminal LF
creates no invented extra semantic line, but its presence remains represented
in the preceding physical record's exact record extent.

### Physical record tape

[C4] Every admitted source byte belongs to exactly one ordered physical record.
Each record binds:

- zero-based physical record index;
- exact content bytes excluding LF;
- exact indentation prefix bytes, uninterpreted;
- whether an LF terminator is present;
- source boundary deltas sufficient for the host checker to derive exact
  `startByte`, `contentEndByte`, and `recordEndByte`;
- exactly one observational class from
  `blank`, `file-comment-candidate`, `raw-opener-candidate`, or
  `ordinary`.

[C5] Replaying ordered content plus each recorded LF reconstructs the original
document byte-for-byte. Reordered, missing, duplicated, overlapping, or
decorated records reject before oracle comparison.

### Stitch groups

[C6] Every non-boundary ordinary record begins or belongs to exactly one
ordered stitch group. A group references a contiguous ordered range of
physical record indexes; it never copies a normalized replacement document.

[C7] Group continuation is KERN-owned and is active only while the accumulated
line state is inside an unclosed double quote or has positive nested
double-brace expression depth. Escaped characters, style blocks, style quotes,
 and inline comment candidates must affect scanning exactly as the bounded
bootstrap oracle does.

[C8] A following `file-comment-candidate` or
`raw-opener-candidate` is never absorbed into an active group. The active
group terminates before it with `comment-boundary` or
`raw-opener-boundary`; the boundary record remains independently present.

[C9] A group terminates with exactly one reason:
`complete`, `comment-boundary`, `raw-opener-boundary`, or
`eof-unclosed`. Complete groups have neither open quote nor positive
expression depth. Boundary and EOF terminations disclose the remaining quote
and expression state.

[C10] The closed raw-opener candidate profile is policy-owned and source-bound.
It must not query the TypeScript runtime registry.

### Token composition

[C11] Each `complete` ordinary group is reconstructed from its physical
records using literal LF separators and passed to the existing KERN
`tokenizeline` implementation through ordinary KERN function composition.
Boundary and EOF-unclosed groups do not invent a successful token result.

[C12] Token and diagnostic records preserve their group identity and source
boundary tape. The checker derives document-relative UTF-8 byte positions from
the authoritative physical records and rejects any span that cannot be
reconstructed exactly.

[C13] Aggregate document token and diagnostic limits apply across all composed
tokenizer calls. Per-line success cannot evade document limits.

### Limits and containment

[C14] Policy owns at least: source bytes, code points, physical records,
physical-record bytes, stitch groups, group records, stitch depth, tokens,
diagnostics, envelope records, output JSON bytes, raw-opener candidates, and
runtime limits.

[C15] Every limit has exact-boundary evidence at `limit` and rejection at
`limit + 1` where constructible. Rejection is deterministic and returns no
partial success envelope.

[C16] KERN sources are regular LF files and contain no call or textual
dependency on `tokenizeLineInternal`, `parseDocument`, bootstrap
stitch helpers, runtime capabilities, or host handlers.

## Binary acceptance criteria

[A1] A dedicated `pnpm test:kern-frontend-stitch-shadow` gate is RED at the
slice base because the stitch-shadow implementation and contract are absent.

[A2] The gate byte-matches physical tape, group membership, termination reason,
open-state disclosure, token kinds/values, diagnostics, and derived UTF-8
positions against an independently computed bootstrap oracle for every
admitted fixture.

[A3] Fixtures cover empty input, no terminal LF, terminal LF, consecutive
blank lines, spaces and tabs, CR/CRLF rejection, astral and multibyte source,
single-line complete records, multiline quotes, escaped quotes/backslashes,
nested multiline expressions, styles containing quote/brace/comment text,
inline comments, comment boundaries, raw-opener boundaries, and EOF-unclosed
groups.

[A4] The source-tape validator rejects record omission, duplication,
reordering, offset drift, LF normalization, content mutation, indent mutation,
unknown fields/classes/reasons, non-contiguous groups, and a group swallowing a
boundary record.

[A5] Mutation tests kill constant output, TypeScript/host delegation, partial
corpus handling, reordered output, dropped physical records, newline
normalization, changed group membership, comment swallowing, raw-opener
swallowing, stale output, and disabled aggregate limits.

[A6] Corpus selection is policy-owned, contained beneath `examples/`,
regular-file only, LF-only, bounded before execution, and cannot shrink
silently.

[A7] The current line-tokenizer gate remains green. The new gate is added to
`test:infra`, the KERN 5 fitness policy, gate matrix, and ownership matrix as
an `internal-oracle` labeled “bounded framing/stitch shadow.”

[A8] `kern-frontend` remains planned/not-shipped, and no package/public export
is added.

[A9] Touched-package tests and the complete `pnpm fitness:kern-5` wall pass,
then `agon review` succeeds with the full current roster and no unresolved
verified blocker.

## RED and red-team plan

[R1] First add the dedicated checker test entry that imports the expected
stitch contract; prove it fails at base due to the missing implementation, not
because of setup or unrelated tests.

[R2] Implement the independent host oracle and envelope validator before the
KERN implementation. Run it against deliberately wrong envelopes to prove the
oracle distinguishes membership and byte-tape drift.

[R3] Add named KERN-source mutations for constant, reordered, newline-dropped,
comment-swallowing, raw-opener-swallowing, and boundary-state changes.

## Likely files

- `examples/kern-frontend/stitcher.kern`
- `examples/kern-frontend/stitcher-helpers.kern` if required to keep source
  files below 500 lines
- `scripts/check-kern-frontend-stitcher.mjs`
- `scripts/kern-frontend-stitcher/policy.json`
- `scripts/kern-frontend-stitcher/policy.mjs`
- `scripts/kern-frontend-stitcher/fixtures.mjs`
- `scripts/kern-frontend-stitcher/stitcher.test.mjs`
- `package.json`
- `scripts/kern-5-fitness-policy.json`
- KERN 5 gate/ownership documentation

## Explicit deferrals

[N1] This slice does not define comment semantics, inline-comment stripping,
decorator attachment, raw-body parsing, indentation meaning, token-stream
parsing, declarations, properties, AST construction, canonical KIR emission,
the public frontend API, or frontend cutover.

[N2] This slice does not promote `pnpm test:kern-frontend`, does not make the
KERN frontend canonical, and does not change the public package surface.

[N3] Single-quoted multiline continuation is not claimed because the current
bootstrap stitch state owns only double-quoted continuation. Any future
expansion requires its own parity evidence.

## Implementation evidence

[V1] RED was captured after a frozen offline dependency install: the core
build succeeded and the dedicated gate failed with `ERR_MODULE_NOT_FOUND` for
`scripts/check-kern-frontend-stitcher.mjs`.

[V2] `stitchdocument` and its helpers are handwritten KERN sources of 195 and
173 lines. They compose the existing KERN `tokenizeline` function and contain
no bootstrap parser/tokenizer handler call or capability path.

[V3] The independent checker validates exact physical reconstruction,
envelope ordering, class/reason vocabulary, non-overlapping contiguous group
coverage, structural-boundary exclusion, remaining open state, composed token
tapes, aggregate limits, and document-relative UTF-8 positions.

[V4] The dedicated test suite has eleven passing test blocks covering policy,
source-hashed corpus containment, malformed admission, exact limit edges, and
constant, delegation, partial-corpus, physical omission, index reordering,
newline normalization, membership, comment swallowing, raw-opener swallowing,
stale seal, and disabled aggregate-limit mutations.

[V5] The differential command currently passes 22 fixture/corpus documents and
two CR/CRLF fail-closed cases. The predecessor line-tokenizer gate remains
green at 307 parity, six fail-closed, and eight boundary cases.

[V6] The fitness entrypoint, current gate, support gate matrix, and ownership
matrix add only `kern-frontend-stitch-shadow`. `kern-frontend` remains planned
and `not-shipped`; no package export or production selector changed.

[V7] The complete `pnpm fitness:kern-5` wall passed with the new gate promoted
before independent-review fixes. Its frontend results were 307 tokenizer parity
cases, six tokenizer fail-closed cases, eight tokenizer boundary cases, 11
stitch-shadow adversarial test blocks, 22 stitch-shadow parity cases, and two
stitch-shadow rejection cases.

[V8] Full-roster role-lens Agon review run
`review-1785994286321-cu1hue` found three unique blockers: pre-validation range
allocation, token-before-group order normalization, and ECMAScript leading
whitespace drift. The regressions reproduced all three before the fixes. The
checker now bounds ranges before allocation and binds token fields to the most
recent group; KERN reuses the existing exact `trimspace` predicate for
classification and raw-openers. The focused gate now passes 13 adversarial test
blocks, 24 parity cases, and two rejection cases. Lint, repository consistency,
the 307-case predecessor tokenizer gate, the KERN 5 fitness-contract tests, and
`git diff --check` also pass after the fixes.

[V9] Targeted security confirmation run
`review-1785994863065-delc9d-stitch-security-fixes` succeeded with no blocking
finding and independently reported zero framing/group/termination/open-state
divergences across 6,000 generated multiline documents. Its source-verified
follow-ups were resolved by removing reviewer-created untracked probes, adding
scalar-safe corpus admission, and independently enforcing physical-record and
raw-opener bounds with named disabled-counter mutations. The stable composed
tokenizer format remains an intentional protocol literal. The focused gate,
lint, repository consistency, and diff hygiene pass after these follow-ups.

[V10] Final targeted correctness run
`review-1785995732571-iyfwb8-stitch-final-hardening` reviewed the resolved
corpus/limit hardening and returned no findings of any severity.
