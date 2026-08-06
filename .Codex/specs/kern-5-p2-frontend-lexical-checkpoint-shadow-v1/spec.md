# KERN 5 Phase 2: bounded conditional lexical-checkpoint shadow v1

Status: implemented, reviewed, and fully verified; publication pending

Confidence: 0.99

## Decision

[D1] M4.156 adds an internal, release-blocking
`kern.frontend.lexical-checkpoint-shadow.1` oracle. It composes the existing
KERN-authored M4.154 stitch envelope and emits one bounded conditional lexical
checkpoint per physical record in each `complete` ordinary stitch group.

[D2] A checkpoint is state evidence, not a comment split. It records either
the lexical state immediately before the record separator LF or the state
immediately before the first structurally eligible inline-comment marker.
Marker recognition is required because scanning comment payload as code would
corrupt quote, escape, and delimiter state. The checkpoint does not own the
preceding whitespace, stripped code, marker text, comment payload, or trivia
attachment.

[D3] Candidate A, a per-code-point transition tape, is rejected because it
creates linear output without a necessary semantic witness. Candidate B, an
exact comment splitter, is rejected because it duplicates bootstrap
`stripInlineComment` and prematurely owns `trimEnd`, slices, and attachment.
M4.156 is the corrected Candidate C selected by exact-roster tribunal
`tribunal-1786000834424-gbydg5-kern-5-m4-156-lexical-state-scop`.

[D4] The transition contract is pinned to the post-join bootstrap scanner:
physical record contents are scanned in group order and exactly one U+000A is
fed between adjacent group members. The checkpoint is captured before that LF.
This is not a new newline language rule. It models the exact joined string that
bootstrap `parseLine` gives `stripInlineComment`.

## Current evidence

[E1] Bootstrap `parseLines` uses `scanLineState` only to decide continuation.
That narrower scanner carries an unclosed double quote or nested `{{ ... }}`
depth and stops before full-line comments and raw openers.

[E2] Bootstrap `parseLine` later calls `stripInlineComment` on the joined group.
That pass recognizes single and double quotes, quote escapes, nested expression
and style delimiters, ASCII-whitespace marker eligibility, and `trimEnd`.

[E3] M4.154 already owns LF physical framing, exact group membership,
termination, source identity, tokenizer evidence, and all inherited limits.
M4.155 owns complete-group indentation observations. Neither claims comment or
trivia semantics.

[E4] M4.154 rejects every carriage return as `UNSUPPORTED_LINE_ENDING`.
M4.156 therefore rejects CR and CRLF through the inherited failure contract; it
does not normalize or preserve them.

[E5] The tribunal found that a marker-blind state machine is unsound. For
example, `text # payload with "` is a complete group whose raw terminal quote
state differs from the effective pre-marker state. Marker eligibility and
lexical state are mutually dependent even when splitting remains deferred.

## Contract

### Composition and admission

[C1] The handler accepts the same scalar-safe LF document, raw-opener profile,
and policy-owned M4.154 limits, plus positive policy limits for aggregate
checkpoints and lexical delimiter depth.

[C2] The handler calls `stitchdocument` in KERN. Every inherited failure is
returned atomically with the exact same code and detail and with no checkpoint
records.

[C3] Only groups whose M4.154 termination is exactly `complete` are admitted.
No checkpoint is emitted for `comment-boundary`, `raw-opener-boundary`, or
`eof-unclosed` groups. Group membership and termination are never recomputed.

[C4] State starts neutral for each admitted stitch group. M4.156 does not make
single-quote or style state a cross-group continuation rule; those constructs
remain outside M4.154 group admission.

### Conditional checkpoint tape

[C5] Exactly one checkpoint is emitted for every physical record belonging to
an admitted group, in group and record order. Each checkpoint binds:

- zero-based aggregate checkpoint index;
- M4.154 group index;
- zero-based ordinal within the group;
- M4.154 physical-record index;
- exact record content as an identity witness;
- `quote` as `none`, `single`, or `double`;
- `escapePending` as `0` or `1`;
- canonical unsigned `expressionDepth`;
- canonical unsigned `styleDepth`;
- `stop` as `record-end` or `eligible-marker`;
- record-relative Unicode-scalar marker offset, or `none`.

[C6] For `record-end`, the state is captured after the last source scalar and
before any separator LF. For `eligible-marker`, the state and offset are
captured immediately before the marker and no comment-payload scalar advances
the checkpoint state. The source witness still preserves the complete record.

[C7] A marker is eligible only when quote is `none`, expression depth and style
depth are zero, and the marker is immediately preceded by ASCII space (`0x20`)
or tab (`0x09`). A record whose first non-indent scalar is `#` or `//` is an
inherited M4.154 comment boundary and cannot belong to an admitted group. The
inline marker is `#` or the first slash of `//`. Other admitted whitespace,
including vertical tab and form feed, and a single slash do not qualify.
Non-ASCII whitespace outside the inherited tokenizer profile keeps its
`UNSUPPORTED_UNKNOWN` failure. Markers inside quotes, expressions, or styles
do not qualify.

[C8] Transition precedence is bootstrap-exact:

1. an active quote handles escapes and its matching quote;
2. outside a quote, `{{` opens or nests expression depth and `}}` closes it;
3. while expression depth is positive, style and marker syntax is inert;
4. outside an expression, `{`/`}` update style depth;
5. while style depth is positive, quote processing still has the global
   precedence above and markers are inert;
6. only neutral state tests marker eligibility.

[C9] Quote escapes consume exactly the next Unicode scalar. If a record ends
with an escaping backslash, its pre-LF checkpoint has `escapePending=1`. When
another group member follows, feeding the exact separator LF consumes that
pending escape before the next record begins. Even and odd backslash runs are
therefore distinguished.

[C10] Delimiters are exact ASCII scalars. Scanning and marker offsets use
Unicode scalar values, not UTF-8 bytes or UTF-16 code units. Malformed UTF-16
rejects before execution. Astral content counts as one scalar.

[C11] `{{{`, `}}}`, adjacent closing delimiters, and quote characters inside
styles follow the stated precedence without normalization. Depth overflow
fails atomically; it never saturates, wraps, or clamps.

[C12] Exactly one U+000A is transitioned between adjacent physical records in
the same admitted group after the prior pre-LF checkpoint. A source-final LF
does not create a phantom physical record or checkpoint.

[C13] A terminal source seal binds the result to the exact input. Unknown,
reordered, duplicated, orphaned, missing, or post-seal checkpoint records fail
before oracle comparison.

### Limits and containment

[C14] Policy owns maximum checkpoints and lexical depth in addition to every
inherited M4.154 source, physical-record, group, tokenizer, envelope, output,
and runtime limit. Maximum checkpoints cannot exceed inherited physical
records. Limits are checked before partial results escape.

[C15] Output is O(admitted physical records), never O(source scalars). KERN
sources are regular LF files with native KERN handlers and contain no bootstrap
parser/tokenizer call, runtime capability, host handler, or host-supplied
physical/group/checkpoint evidence.

## Binary acceptance criteria

[A1] A dedicated `pnpm test:kern-frontend-lexical-shadow` gate is RED at the
slice base because its checker and contract are absent.

[A2] Every physical record in every complete M4.154 ordinary group emits one
checkpoint. Excluded groups emit none, and no per-code-point record can escape.

[A3] Every checkpoint byte-matches an independent host oracle for group and
record identity, source witness, conditional stop, marker scalar offset, quote
identity, escape state, expression depth, and style depth.

[A4] Fixtures cover neutral records; single and double quotes; escaped quotes
and backslash parity; nested and adjacent `{{`/`}}`; nested styles; quotes in
styles; full-line comment boundaries; inline markers after ASCII space/tab;
ineligible markers after admitted vertical-tab/form-feed whitespace; inherited non-ASCII unknown
rejection; markers inside every non-neutral state; comment
payload containing quotes, braces, slashes, and trailing backslashes; astral
content before markers; multiline double quotes and expressions; a trailing
escape before inserted LF; final LF; inherited boundaries; and CR/CRLF reject.

[A5] Named mutations kill quote-identity collapse, physical-boundary reset,
missing inserted-LF consumption, escape-parity drift, quote/expression
precedence loss, first-brace close, marker blindness, markers inside expression
state, ASCII-whitespace widening, scalar-offset shifts, disabled depth limits,
and scalar-sized checkpoint indexing.

[A6] Strict validation rejects checkpoint omission, duplication, reordering,
unknown state values, noncanonical integers, group/record/content drift, marker
offset drift, marker/state inconsistency, limit overflow, stale seal, and
post-seal records.

[A7] Exact policy edges prove checkpoint acceptance at the limit and failure at
limit plus one, lexical depth acceptance at the limit and failure at limit plus
one, and unchanged inherited M4.154 failures.

[A8] The KERN handler itself composes `stitchdocument`, derives every state and
marker checkpoint, applies limits, and emits the sealed envelope. Constant
output, host delegation, host-supplied stitch evidence, and partial-group
mutations are killed.

[A9] M4.153 tokenizer, M4.154 stitch, and M4.155 indentation gates remain
green. The new gate is current in `test:infra`, the KERN 5 fitness policy,
support matrix, and ownership matrix as an `internal-oracle`.

[A10] `kern-frontend` remains planned/not-shipped. The output contains no
stripped code, removed whitespace, marker payload, comment attachment,
diagnostic claim, tree, AST/KIR, package export, or production cutover.

[A11] Touched-package gates and the complete `pnpm fitness:kern-5` wall pass,
then exact-roster role-lens Agon review has no unresolved verified blocker.

## Verification evidence

[V1] The dedicated gate passes 14 adversarial test blocks and all 23 authored
parity documents. M4.153 tokenizer, M4.154 stitch, M4.155 indentation, KERN 5
fitness-contract, lint, repository-consistency, contract, and diff-hygiene
gates remain green.

[V2] The complete Node 22.22 fitness wall passed on the pre-review integrated
tree. Exact-roster role-lens review
`review-1786004727651-qibguq-kern-5-m4-156-lexical-shadow` completed 3/3.
Its two verified findings are fixed: failure envelopes are now bound to the
canonical stitch result and independent lexical oracle, and the unreachable
column-zero inline-marker claim was removed. The named-mutation suite now
covers every mutation promised by [A5], and public bootstrap parser witnesses
bind the conditional marker boundary without making bootstrap an oracle.

[V3] The final post-review Node 22.22 `pnpm fitness:kern-5` wall passes. It
includes the full workspace suite, 434/434 cross-target conformance fixtures,
both complete 737-test canonicalizer proof runs, and the promoted lexical gate
in both aggregate positions. Publication is the only remaining slice step.

## RED and red-team plan

[R1] Add only the dedicated package command and capture its missing-checker
failure.

[R2] Implement the host oracle and strict envelope validator independently of
the KERN source. Prove forged checkpoints fail closed before differential
comparison.

[R3] Add named source mutations for every state, marker, scalar, LF, ordering,
limit, and containment invariant before promoting the gate.

## Likely files

- `examples/kern-frontend/lexical-checkpoints.kern`
- `scripts/check-kern-frontend-lexical.mjs`
- `scripts/kern-frontend-lexical/oracle.mjs`
- `scripts/kern-frontend-lexical/fixtures.mjs`
- `scripts/kern-frontend-lexical/policy.json`
- `scripts/kern-frontend-lexical/policy.mjs`
- `scripts/kern-frontend-lexical/lexical.test.mjs`
- `package.json`
- `scripts/kern-5-fitness-policy.json`
- KERN 5 gate and ownership documentation

## Explicit deferrals

[N1] M4.156 does not decide whether or how an eligible marker is stripped. It
does not own `trimEnd`, whitespace before the marker, stripped code, marker
kind/payload slices, comment text, or comment attachment.

[N2] It does not make single-quote or style state a cross-group continuation
rule, change M4.154 group membership, or process boundary-terminated groups.

[N3] It does not tokenize comments, alter diagnostics, admit semantic lines,
build an indentation tree, create AST/KIR, add a public package surface, or cut
the frontend over to KERN.

[N4] M4.157 must use these conditional checkpoints to specify exact marker
kind, code boundary, `trimEnd` ownership, and comment payload evidence before
any trivia attachment or comment-semantic claim.
