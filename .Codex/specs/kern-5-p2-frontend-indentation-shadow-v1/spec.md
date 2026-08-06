# KERN 5 Phase 2: bounded indentation observation shadow v1

Status: implementation contract

Confidence: 0.95

## Decision

[D1] M4.155 adds an internal, release-blocking
`kern.frontend.indentation-shadow.1` oracle. It composes the KERN-authored
M4.154 physical-record and stitch-group envelope and emits one lossless
indentation observation for each `complete` ordinary stitch group.

[D2] An observation is source evidence, not an indentation tree. It owns the
exact maximal leading ASCII space/tab run on the group's first physical record
and the numeric relation between consecutive admitted observations. It does not
claim node admission, parent/child meaning, indentation validity, or diagnostic
parity.

[D3] The initial relation is `initial`. Subsequent relations are `same`,
`deeper`, or `shallower` by the number of exact ASCII indentation bytes. This
avoids inventing a virtual root indentation, which would depend on bootstrap
parser mode and root admission.

[D4] The bootstrap host may construct the differential oracle and validate the
returned envelope, but it may not supply physical records, stitch groups, or
indentation results to KERN execution. The new KERN handler must call the
existing KERN `stitchdocument` function through ordinary KERN composition.

## Current evidence

[E1] M4.154 already owns LF physical records, exact ASCII indentation-prefix
bytes, ordinary stitch-group membership, and group termination. Comment and raw
opener classes remain observational boundaries.

[E2] The bootstrap parser's tree builder operates on successfully admitted
`ParsedLine` objects. `INDENT_JUMP` depends on parser admission, decorators,
raw bodies, root indentation, skipped lines, and a global `seenIndents` set.
Physical-record or stitch-group parity cannot establish that contract.

[E3] Bootstrap full-line comment classification uses Unicode-aware
`trimStart()`, while indentation and inline-comment gating use ASCII space/tab
rules. Unicode whitespace is therefore deliberately content for this slice,
not indentation.

[E4] The required exact-roster tribunal
`tribunal-1785995960189-hn6x1t-kern-5-m4-155-trivia-scope` rejected a trivia
splitter because byte replay proves preservation but cannot prove correct
comment boundaries without a shared cross-record lexical-state contract.

## Contract

### Composition and admission

[C1] The handler accepts the same well-formed UTF-8 document, raw-opener
profile, and policy-owned limits as M4.154, plus a positive maximum observation
count.

[C2] The handler invokes `stitchdocument` in KERN. Every M4.154 failure is
propagated as the same failure code and detail with no partial indentation
records.

[C3] Only M4.154 groups whose termination is exactly `complete` are admitted.
Boundary and `eof-unclosed` groups remain represented only by their M4.154
evidence and emit no indentation observation.

### Observation tape

[C4] Every admitted group emits exactly one ordered observation anchored to
the group's first physical record. Each observation binds:

- zero-based observation index;
- M4.154 group index;
- first physical-record index;
- exact indentation bytes;
- relation to the preceding admitted observation;
- exact first-record content as an identity witness.

[C5] `indentBytes` is exactly the maximal leading run containing only ASCII
space (`0x20`) and tab (`0x09`). Concatenating it with the host-derived first
record remainder reconstructs the exact first-record content.

[C6] The checker derives the first non-indentation source offset in both UTF-8
bytes and JavaScript string code units from the trusted first-record span and
the exact ASCII indentation. Multibyte content after indentation must not
shift either boundary.

[C7] The first observation relation is `initial`. Later relations compare
`indentBytes.length` with the prior admitted observation and are exactly one of
`same`, `deeper`, or `shallower`. Tabs count as one observed source byte; no
visual-column or validity policy is implied.

[C8] Blank, file-comment-candidate, raw-opener-candidate, and continuation
records emit no independent observation. Inserting such non-admitted records
between completed ordinary groups does not reset or otherwise change the
neighboring observation relation.

[C9] ECMAScript whitespace other than ASCII space/tab produces empty
indentation whenever the inherited tokenizer admits the record. Standalone
non-ASCII unknown input retains M4.153's fail-closed `UNSUPPORTED_UNKNOWN`
boundary and emits no partial observation. A Unicode-aware trimming function
is forbidden as the indentation boundary.

[C10] A terminal source seal binds the observation result to the exact source.
Unknown, reordered, duplicated, orphaned, or post-seal records reject before
oracle comparison.

### Limits and containment

[C11] Policy owns the maximum observation count and output JSON bytes in
addition to every inherited M4.154 input, record, group, token, diagnostic, and
runtime limit. Limits are validated before range allocation or partial success
can escape.

[C12] The implementation sources are regular LF KERN files with native KERN
handlers. They contain no bootstrap tokenizer/parser call, runtime capability,
host handler, or host-provided stitch result.

## Binary acceptance criteria

[A1] A dedicated `pnpm test:kern-frontend-indentation-shadow` gate is RED at
the slice base because its checker and contract are absent.

[A2] Every completed ordinary M4.154 stitch group emits exactly one
observation, in group order, pointing to its first physical record. Blank,
file-comment-candidate, raw-opener-candidate, continuation, boundary, and
EOF-unclosed records or groups emit no independent observation.

[A3] Every observation byte-matches an independent host oracle for group
identity, first physical-record identity, indentation bytes, exact first-record
content witness, and relation.

[A4] `indentBytes` is exactly the maximal leading `0x20`/`0x09` run, and
`indentBytes + remainder` reconstructs the exact first-record content.

[A5] Fixtures cover no indent, spaces, tabs, mixed space/tab prefixes, repeated
levels, deeper and shallower relations, multibyte/astral content after indent,
vertical-tab/form-feed content at column zero, inherited non-ASCII-unknown
failure, blank/comment/raw boundaries, complete
multiline groups, continuation indentation, and boundary/EOF-unclosed groups.

[A6] Mutating a first-record indentation changes the corresponding observation.
Mutating only continuation-record indentation changes neither observation
count nor the transition sequence.

[A7] Inserting blank or full-line-comment records between complete ordinary
groups does not change the relations between the neighboring admitted groups.

[A8] Named mutations using Unicode-aware indentation, one transition per
physical record, or indentation derived from stripped/trimmed semantic code are
killed by the dedicated gate.

[A9] The envelope validator rejects record omission, duplication, reordering,
unknown tags/relations, group/physical identity drift, indentation mutation,
content-witness mutation, relation mutation, observation-count overflow,
post-seal records, and stale source seals.

[A10] Exact policy-edge evidence proves `maxObservations` acceptance at the
limit and deterministic failure at `limit + 1`; inherited M4.154 rejection
behavior remains unchanged.

[A11] Source validation and mutation tests kill constant output, host
delegation, host-supplied stitch evidence, partial corpus handling, and disabled
observation limits.

[A12] The M4.153 tokenizer and M4.154 stitch-shadow gates remain green. The new
gate is added to `test:infra`, the KERN 5 fitness policy, current gate matrix,
and ownership matrix as an `internal-oracle` labeled bounded indentation
observation.

[A13] `kern-frontend` remains planned/not-shipped. The output exposes no tree
token, `INDENT_JUMP`, comment split or attachment, AST/KIR, formatter mutation,
package export, or production cutover claim.

[A14] Touched-package tests and the complete `pnpm fitness:kern-5` wall pass,
then exact-roster `agon review` succeeds with no unresolved verified blocker.

## Implementation evidence

[V1] The dedicated gate passes 11 adversarial test blocks and 17 differential
parity documents. The retained tokenizer and stitch-shadow gates pass 307
parity plus 6 fail-closed plus 8 boundary cases, and 24 parity plus 2 rejection
cases, respectively.

[V2] `pnpm lint`, `pnpm check:repo`, `pnpm check:kern-5-contract`, and
`git diff --check` pass on the integrated slice tree.

[V3] The complete Node 22.22 `pnpm fitness:kern-5` wall exits 0 with
`KERN 5 current fitness wall passed.` It includes all workspace and
infrastructure suites, the 434/434 cross-target conformance corpus, the full
canonicalizer wall, and the promoted tokenizer, stitch-shadow, and indentation
shadow gates.

[V4] Exact-roster role-lens Agon review
`review-1785999788862-37mvwu-kern-5-m4-155-indentation-shadow` completed 3/3.
It found one verified blocker: `firstContentCodeUnit` was record-relative in
both the validator and oracle. The fix independently derives physical-record
document starts in each path, and a RED-first astral-prefix regression proves
the second record reports code-unit offset 18 rather than 2.

[V5] After the review fix, the dedicated gate passes 11/11, the retained
tokenizer and stitch gates pass, the fitness policy passes 9/9, and lint, repo
consistency, KERN 5 contract, and diff-hygiene gates pass. The review has no
unresolved verified blocker.

## RED and red-team plan

[R1] First add only the package command for the dedicated checker and capture
its failure because the checker module is absent.

[R2] Implement the independent host oracle and strict envelope validator before
the KERN handler. Prove forged observations fail identity, indentation,
relation, limit, ordering, and seal checks.

[R3] Add named KERN-source mutations for Unicode trimming, physical-record
transitions, semantic-code-derived indentation, constant output, delegation,
and disabled limits.

## Likely files

- `examples/kern-frontend/indentation.kern`
- `scripts/check-kern-frontend-indentation.mjs`
- `scripts/kern-frontend-indentation/oracle.mjs`
- `scripts/kern-frontend-indentation/fixtures.mjs`
- `scripts/kern-frontend-indentation/policy.json`
- `scripts/kern-frontend-indentation/policy.mjs`
- `scripts/kern-frontend-indentation/indentation.test.mjs`
- `package.json`
- `scripts/kern-5-fitness-policy.json`
- KERN 5 gate/ownership documentation

## Explicit deferrals

[N1] This slice does not define inline-comment boundaries, semantic stripped
code, full-line comment attachment, decorator attachment, or trivia relocation.

[N2] This slice does not define indentation parent/child construction,
`INDENT`/`DEDENT` tokens, root indentation, `INDENT_JUMP`, tab validity, visual
columns, node admission, or recovery.

[N3] This slice does not parse raw bodies, create AST/KIR, add a public package
surface, promote `pnpm test:kern-frontend`, or cut production over to KERN.

[N4] Before comment ownership, one shared cross-record lexical-state contract
must cover single and double quotes, escapes, nested expressions, styles,
closing-delimiter adjacency, and exact whitespace boundaries.

[N5] Before tree or `INDENT_JUMP` ownership, KERN must own semantic-line
admission, root initialization, decorator buffering, raw-body admission,
skipped/dropped lines, and the `seenIndents` rule.
