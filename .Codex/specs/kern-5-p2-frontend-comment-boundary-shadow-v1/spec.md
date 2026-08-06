# KERN 5 Phase 2: bounded inline-comment boundary shadow v1

Status: implementation contract

Confidence: 0.98

## Decision

[D1] M4.157 adds an internal, release-blocking
`kern.frontend.inline-comment-boundary-shadow.1` oracle. It composes the
KERN-authored M4.156 conditional lexical-checkpoint envelope and proves that
each checkpoint can be consumed as an exact marker/payload partition without
rescanning lexical state.

[D2] For every M4.156 checkpoint, M4.157 emits the complete checkpoint
identity and state plus `markerKind`, `markerText`, and the exact raw payload
after the marker. Eligible `#` and `//` checkpoints become `hash` and
`slash-slash` partitions. Record-end checkpoints become `none` with empty
marker and payload.

[D3] The partition invariant is:

`scalarSlice(content, 0, markerOffset) + markerText + rawPayload == content`.

The prefix is derivable and is not serialized. All offsets and slices count
Unicode scalar values, not UTF-16 code units or UTF-8 bytes.

[D4] M4.157 does not own `trimEnd`, stripped code, whitespace removal, comment
text normalization, trivia attachment, or node ownership. On admitted surface
records, non-ASCII whitespace outside expressions already fails as
`UNSUPPORTED_UNKNOWN`; therefore the meaningful ECMAScript `trimEnd` domain
cannot be made release-blocking without first deciding source-profile and
normative-whitespace ownership.

[D5] Full-line comments remain inherited M4.154 boundaries and emit no
checkpoint or partition. A column-zero marker cannot be forged into an inline
partition because M4.156 admits inline markers only after ASCII space/tab.

## Tribunal and plan delta

[T1] Exact-roster tribunal
`tribunal-1786008649278-edv9mw-kern-5-m4-157-comment-boundary` completed 3/3
with `claude,codex,agy`.

[T2] The initial Candidate A serialized code, trimmed suffix, marker, and
payload as one reversible split. The tribunal rejected it because it coupled
marker consumption to a not-yet-admitted Unicode trimming contract and
inflated the output envelope with derivable substrings.

[T3] The accepted tightened Candidate B serializes only marker kind/text and
raw payload while preserving the full M4.156 identity/state witness. Its value
is adversarial: scalar-safe slicing, hostile-payload non-rescanning, exact
source binding, and atomic failure inheritance.

[T4] Candidate C, attaching comments to nodes, remains blocked by absent span
and trivia-ownership contracts. No unresolved dependency blocks Candidate B.

## Format and ownership

[C1] The format is exactly
`kern.frontend.inline-comment-boundary-shadow.1`. It is a new format; M4.156's
`kern.frontend.lexical-checkpoint-shadow.1` is not widened.

[C2] Every success record has this fixed field order:

1. record tag `partition`;
2. partition index;
3. checkpoint index;
4. group index;
5. group-record index;
6. physical-record index;
7. original content;
8. quote state;
9. escape-pending bit;
10. expression depth;
11. style depth;
12. stop reason;
13. marker scalar offset or `none`;
14. marker kind: `none`, `hash`, or `slash-slash`;
15. marker text: empty, `#`, or `//`;
16. exact raw payload.

[C3] One terminal 16-field seal binds the complete source. Failure envelopes
also have exactly 16 fields and contain no partition or seal records.

[C4] M4.157 calls `observelexical` inside KERN. It does not call the bootstrap
parser, tokenizer, host handlers, or host oracles and does not rescan quotes,
expressions, styles, or payload text.

[C5] Marker classification reads only the scalar at the authenticated marker
offset. `#` consumes one scalar; `//` consumes two. Everything after that exact
width is raw payload, including tabs, spaces, quotes, braces, slashes, further
markers, and trailing backslashes. This is subordinate to inherited source
admission: the current tokenizer profile rejects an astral scalar in payload
text as `UNSUPPORTED_UNKNOWN` before M4.156 can emit a checkpoint.

[C6] A record-end checkpoint must emit `none`, empty marker text, empty
payload, and `markerOffset=none`. An eligible-marker checkpoint must emit one
of the two non-empty marker triples.

[C7] The host validator independently executes canonical M4.156 for the same
source before accepting either success or failure. A structurally valid
partition transplanted from another source or record rejects.

[C8] The independent host oracle consumes canonical M4.156 checkpoints but
implements partition slicing separately from the KERN source. It does not
derive expected data by parsing the M4.157 envelope.

## Limits and failure precedence

[L1] Policy adds positive `maxPartitions`, bounded by M4.156
`maxCheckpoints`. The fixed-width success envelope must fit the runtime
collection limit, and the policy remains closed to unknown fields.

[L2] Failure precedence is exact:

1. host malformed-UTF-16 and source-byte admission;
2. invalid policy/runtime limits;
3. inherited tokenizer, stitch, lexical-depth, checkpoint, envelope-record,
   and other M4.156 failures;
4. M4.157 `PARTITION_LIMIT` while mapping a successful lexical envelope;
5. runtime containment rejection;
6. host `maxOutputJsonBytes` rejection.

[L3] Any failure is atomic: no partition, partial record, or terminal seal may
escape. `maxEnvelopeRecords` remains owned by M4.154, `maxCheckpoints` by
M4.156, and `maxPartitions` by M4.157.

## Binary acceptance criteria

[A1] `pnpm test:kern-frontend-comment-boundary-shadow` is RED at the slice
base because the checker, source, policy, and command do not exist.

[A2] Exact `#` and `//` partitions cover non-empty and empty payloads,
space/tab payload prefixes, trailing whitespace, astral scalars before
markers, and hostile quotes/braces/slashes/markers/backslashes after the
boundary. An astral scalar after the marker proves the inherited
`UNSUPPORTED_UNKNOWN` failure remains atomic rather than widening source
admission in M4.157.

[A3] Record-end cases cover markers inside quotes, expressions, and styles;
`x#y`; `http://`; markers after vertical tab/form feed; and ordinary records
with trailing whitespace. Those records emit no marker or payload.

[A4] Full-line comments, raw blocks, boundary-terminated groups, and
EOF-unclosed groups emit no partitions beyond their inherited M4.156
checkpoint population.

[A5] Strict validation rejects omission, duplication, reordering, unknown
fields, noncanonical integers, source/content/state drift, marker-kind drift,
marker-width drift, payload drift, reconstruction failure, column-zero marker
forgery, stale seal, and post-seal records.

[A6] Named mutations kill swapped marker kinds, one-slash consumption,
off-by-one payload starts, marker text copied from payload, UTF-16 code-unit
slicing, payload rescanning/truncation, constant output, disabled partition
limits, and inherited-failure replacement.

[A7] Exact limit tests prove success at `maxPartitions` and atomic
`PARTITION_LIMIT` at one above. Inherited M4.156 failures remain byte-equivalent
in code and detail.

[A8] Public bootstrap parser witnesses prove that changing hostile payload
does not change parsed node data, while inert markers inside quoted/expression
content remain data. Bootstrap behavior is evidence, not the partition oracle.

[A9] M4.153 tokenizer, M4.154 stitch, M4.155 indentation, and M4.156 lexical
gates remain green. The new gate is current in `test:infra`, the KERN 5 fitness
policy, support matrix, and ownership matrix as an `internal-oracle`.

[A10] The dedicated gate covers every authored M4.156 fixture and corpus
document. Corpus resolution and source containment remain bounded and
symlink-safe through inherited owners.

[A11] Touched-package gates and the complete `pnpm fitness:kern-5` wall pass,
then exact-roster role-lens Agon review has no unresolved verified blocker.

## RED and red-team plan

[R1] Add only the root test command and capture its missing-checker failure.

[R2] Implement the independent oracle, policy, and strict parser before the
KERN source. Prove forged cross-source and marker/payload envelopes fail before
differential comparison.

[R3] Implement the KERN composition and named source mutations. A mutation
must be demonstrated distinguishable before it counts as a kill.

## Likely files

- `examples/kern-frontend/comment-boundaries.kern`
- `scripts/check-kern-frontend-comment-boundaries.mjs`
- `scripts/kern-frontend-comment-boundary/oracle.mjs`
- `scripts/kern-frontend-comment-boundary/fixtures.mjs`
- `scripts/kern-frontend-comment-boundary/policy.json`
- `scripts/kern-frontend-comment-boundary/policy.mjs`
- `scripts/kern-frontend-comment-boundary/comment-boundary.test.mjs`
- `package.json`
- `scripts/kern-5-fitness-policy.json`
- KERN 5 goal, gate, release, support, and ownership documentation

## Explicit deferrals

[N1] M4.158 owns the normative trim-partition decision: an explicit
ECMAScript WhiteSpace/LineTerminator table, source-profile admission, two
scalar offsets, and no host `trimEnd` or platform `isspace` delegation.

[N2] M4.157 does not emit code prefixes or trimmed suffixes and does not claim
which whitespace belongs to code, comments, or trivia.

[N3] It does not attach comments, create source spans, admit nodes, alter
diagnostics, build an indentation tree, create AST/KIR, export a package API,
or cut the frontend over to KERN.
