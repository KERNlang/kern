# KERN 5 R2 M4.1 — KERN-Authored KIR Canonicalizer Profile

**Status:** IMPLEMENTED AND VERIFIED
**Date:** 2026-07-17
**Confidence:** 0.99 after implementation, adversarial hardening, complete fitness proof, and six-engine review
**Parent objective:** begin R2 M4 formatter/frontend ownership without overstating a production formatter or KIR v1 freeze

## Executive Summary

M4.1 adds the first release-blocking KERN-authored canonicalizer over the current
typed structural KIR. A generic host adapter mechanically flattens decoded KIR
records into parallel primitive arrays. A KERN handler—not JavaScript—owns the
semantic decisions that turn the admitted profile into deterministic source:
node spelling, property ordering, type spelling, expression spelling, quoting,
indentation, and child order.

The slice is deliberately an internal oracle. It accepts a bounded function
profile, emits trivia-free canonical source, proves byte-stable idempotence and
exact KIR round-trip equivalence, and fails closed for every unsupported shape.
It does not expose `kern format`, preserve comments, own tokenization/parsing,
freeze public KIR v1, or claim the full R2 formatter/frontend exit.

## Current State

- **VERIFIED:** the release train still marks formatter/canonicalizer,
  KERN-authored frontend, compiler, fixed point, interpreter shadow, and packed
  release incomplete. KERN 5.0 therefore is not achieved.
- **VERIFIED:** the structural KIR and module codecs are internal alpha formats,
  with typed semantic records now carried for every portable runtime-handler
  type admitted by R1.5e.1.
- **VERIFIED:** decoded structural nodes expose `kind`, canonical property
  records, and authored `children`; expression values are canonical tagged
  records rather than raw parser AST objects.
- **VERIFIED:** the public typed runtime-handler boundary accepts the scalar and
  one-dimensional primitive array arguments required by a flattened KIR table.
- **VERIFIED:** KERN source can iterate arrays, recurse through helpers, inspect
  text character-by-character, concatenate text, and throw before returning.
- **VERIFIED:** before this slice, no current root script or ownership receipt
  proved a KERN-authored formatter/canonicalizer.
- **VERIFIED:** this bounded internal-oracle profile is the smallest honest step
  that moves semantic source emission into KERN before source frontend work.

## Claim Ledger

| Claim | Status | Evidence or oracle |
| --- | --- | --- |
| KERN 5.0 is complete before M4.1 | REJECTED | release-train binary exit and remaining `not-shipped` ownership rows |
| Host code may decode KIR and mechanically flatten tagged records | VERIFIED | adapter contract plus cheat-kill mutations |
| Host code may choose source syntax, ordering, escaping, or indentation | REJECTED | semantic decisions belong to the KERN handler |
| The admitted profile can be emitted deterministically by KERN | VERIFIED | golden, shuffle, idempotence, and exact KIR byte oracles |
| The slice is a public production formatter | REJECTED | no CLI/API, trivia, recovery, or full grammar |
| The slice owns source parsing/tokenization | REJECTED | bootstrap TS parser remains the comparison oracle |
| The slice freezes public KIR v1 | REJECTED | current formats remain internal alpha |
| The slice earns a bounded canonicalizer-profile `internal-oracle` receipt | VERIFIED | distinct ownership row, terminal gate, and Agon review |
| The broad `kern-formatter` ownership row may be promoted by M4.1 | REJECTED | full-roster tribunal; production formatter exit remains open |

## Admitted Profile

The input is exactly one decoded module's ordered root list. M4.1 admits:

- one or more top-level `fn` roots;
- function properties `name`, `returns`, and `export` only;
- zero or more direct `param` children, exactly one `handler lang=kern`
  child, and a direct `return` inside that handler;
- exact handler types `boolean`, `integer`, `text`, `void`, and one-dimensional
  lists of the three non-void scalar types;
- expression values `identifier`, `null`, `boolean`, non-negative `integer`,
  `text`, and `list` only;
- text expression payloads containing Unicode scalar values except the
  non-source-stable U+2028 line separator, U+2029 paragraph separator, and
  U+FEFF byte-order mark, plus newline, carriage return, and tab; the other C0
  controls, DEL, and C1 controls remain outside this bounded profile;
- authored root, parameter, and list-item order.

The checked-in canonicalizer policy further bounds one invocation to at most
16 node rows, 30 property rows, and 72 value rows. These caller-owned ceilings
are passed into and enforced by the KERN handler before its quadratic table
validation begins. The exact-boundary valid oracle reaches all 16/30/72 rows and must
complete within the separately configured 65,536-step runtime budget; each
table also has an explicit over-limit rejection oracle. Changing either the
profile ceilings or runtime budget requires changing the policy and renewing
the focused and aggregate fitness evidence.

The same policy owns a 4x maximum KIR-to-source expansion factor and a 2x
runtime-envelope factor. Validation binds `runtimeLimits.maxStringBytes` to the
configured KIR byte ceiling and `runtimeLimits.maxBytes` to the expanded string
ceiling before any fixture runs. A source-derived fixture containing two legal
8,192-byte backslash strings proves escaping cannot exhaust the admitted
runtime envelope.

Everything else—including an empty root list, unknown properties, duplicate
required properties, duplicate function or parameter names, unknown tags,
malformed table references, nested type
lists, records, maps, errors, decimals, expression-reserved literal/prefix
tokens presented as identifiers, unsupported C0 text controls, binary
expressions, calls, lambdas,
member/index access, conditionals, unary expressions, extra handler children,
negative integer expressions, or non-KERN handlers—fails before a result is
returned.

The tribunal explicitly removed decimals and binaries so M4.1 does not import a
numeric spelling, precedence, associativity, or parenthesization contract by
reference. The profile may not be broadened during implementation without a new
claim-tagged spec and RED oracles.

## Flattened Input Contract

The runtime handler receives twelve typed primitive arrays plus three positive
integer policy arguments (`maxNodeRows`, `maxPropertyRows`, and
`maxValueRows`):

| Array | Meaning |
| --- | --- |
| `nodeKind: string[]` | structural node kind by 1-based node id |
| `nodeParent: integer[]` | zero for roots, otherwise parent node id |
| `nodeOrder: integer[]` | authored sibling order |
| `propNode: integer[]` | owning structural node id |
| `propKey: string[]` | property key without syntax spelling |
| `propValue: integer[]` | canonical value id |
| `valueTag: string[]` | canonical value tag |
| `valueParent: integer[]` | zero for property roots, otherwise parent value id |
| `valueRole: string[]` | record key/list item/map key/map value/error-field role |
| `valueOrder: integer[]` | authored order within a composite value |
| `valueText: string[]` | text/integer/decimal payload; empty for composites |
| `valueBool: integer[]` | `1` or `0` for boolean; zero otherwise |

All related arrays must have equal lengths within their table. IDs are dense,
one-based, and allocated in preorder so every non-root parent id precedes its
child id. The adapter preserves the decoded structure verbatim; it may allocate
IDs and copy tag/payload/parent/order facts but may not rename types, sort
properties, omit unknown facts, escape source text, or recognize function,
handler, parameter, return, type, or expression semantics.

The value table stays lossless and self-describing for canonical value tags even
when the M4.1 KERN handler rejects a tag. Unsupported data is never silently
discarded by the adapter.

The host proof rehydrates every flattened valid and hostile-but-structurally
representable KIR graph and requires deep equality with the decoded graph before
the KERN handler runs. A cycle/alias-detecting generic traversal rejects cyclic
or shared object graphs before id allocation; decoded canonical KIR is an owned
tree, so host alias identity is not an admissible transport fact. Exact record
and array inspection rejects symbol keys, accessors, non-enumerable facts,
sparse indexes, and extra keys. Static tests forbid admitted KERN node, property,
type, expression, indentation, quoting, or source-keyword literals in the
adapter. `valueRole` may encode only generic container relationships already
present in the canonical-value schema; it may not carry profile-specific hints.

This is structural transport only. M4.1 performs no borrow, lifetime,
drop-order, or execution-scope analysis; preserving the lossless parent/child
graph is the entire scope obligation of this slice.

## Output Contract

The handler returns `string[]`, one canonical source line per item. Canonical
source has:

- two spaces per structural depth;
- one ASCII space between a node kind and its properties;
- deterministic semantic property order selected by KERN;
- double-quoted escaped admitted text when a value is not an unquoted grammar
  atom;
- non-negative integer spelling derived from the canonical KIR payload;
- no comments, blank lines, or trailing whitespace;
- a final newline supplied mechanically by the harness when joining lines.

The handler constructs the complete result only after validating the full input
graph. Any invalid or unsupported fact throws; no partial line array is exposed.

## Selected Design

### 1. Generic host flattener

`scripts/kern-canonicalizer/flatten.mjs` recursively assigns stable ids to the
decoded structural and canonical value records, detects object cycles and
shared references, and can
be reversed by `rehydrate.mjs` to the same generic KIR graph. It validates only
generic table integrity and KIR codec shape, including canonical scalar text
and record/map key ordering. It contains no admitted KERN
node/property/type/expression names and no source formatting strings.

### 2. KERN semantic canonicalizer

`examples/kern-canonicalizer/canonicalizer.kern` validates the complete table,
rejects rows beyond the three caller-owned profile ceilings before quadratic
validation, indexes node/property/value relations, checks the exact admitted
profile, and emits canonical source. Source syntax constants and all
ordering/escaping rules live in this KERN file. The hand-written file remains
below 500 lines; focused KERN helpers are split only if necessary.

### 3. Differential release oracle

`scripts/check-kern-canonicalizer.mjs` runs the following pipeline per fixture:

1. parse source with the bootstrap frontend;
2. encode then decode module KIR;
3. mechanically flatten the decoded roots;
4. execute the KERN canonicalizer through the public typed runtime handler;
5. join returned lines into canonical source;
6. parse and encode that output and require the exact semantic structural module
   artifact emitted by `encodeModuleKir` to equal the original artifact byte for
   byte; source spans, file paths, diagnostics, evidence hashes, and trivia are
   not members of that artifact;
7. canonicalize the output again and require byte-identical canonical source;
8. require exact source-golden equality.

Fixtures include shuffled nonsemantic property order, multiple roots, multiple
parameters whose order must not be sorted, every admitted exact type,
expression-valid keyword-shaped identifiers, escaped text, nested lists, and
every admitted literal. Hostile fixtures are an audited matrix: empty roots,
table-length mismatch, non-dense ids, invalid parent ids, node cycles, value
cycles, duplicate sibling order, duplicate required properties, orphan values,
noncanonical scalar/map shapes, expression-reserved identifiers, retained map
and error values, every non-admitted C0/DEL/C1 text control, unknown retained
tags/properties, malformed role/order, unsupported child kind, and a valid
prefix followed by an invalid suffix. Each must reject without returning
partial source.

Harness failures use stable categories rather than incidental exception text:
`adapter rejection`, `profile rejection`, `parse rejection`, `KIR mismatch`,
`golden mismatch`, and `idempotence mismatch`. These are internal test
categories, not a new public diagnostics API. The fixed-point assertion runs for
every valid fixture, not a representative subset.

### 4. Release-policy receipt

Add `test:kern-canonicalizer` as a current release gate. The gate builds core,
runs `@kernlang/check` acceptance for the new KERN source, runs focused table
tests, and executes the differential oracle. Add a distinct ownership row
`kern-kir-canonicalizer-profile` with status `internal-oracle` and evidence
`pnpm test:kern-canonicalizer`. Terminal review evaluates the prospective exact
tree before publication; review-discovered defects require RED regressions,
renewed gates, and a new exact-tree review. Committing the final reviewed
candidate publishes the earned receipt. Keep the existing broad
`kern-formatter` row unchanged at `not-shipped` / `R2 planned`.

This receipt means only that KERN-authored semantic canonicalization logic exists
inside a release-blocking differential harness. `kern-frontend`, compiler,
fixed-point, interpreter-shadow, and packed-release rows remain `not-shipped`.

## Cheat-Kill Matrix

| Cheat | Oracle that kills it |
| --- | --- |
| return input source unchanged | handler never receives source text |
| host pretty-printer owns syntax | static adapter scan plus semantic mutation/golden tests |
| adapter smuggles normalized semantics | flatten→rehydrate deep equality and forbidden-literal scan |
| compare formatted source only | exact encoded KIR byte equality |
| normalize by sorting every child | two-parameter, two-root, and nested-list order fixtures |
| ignore unsupported nodes/properties | hostile unknown-fact fixtures must reject |
| silently omit malformed references | dense-id/parent/table-integrity rejection fixtures |
| crash accidentally instead of fail closed | stable adapter/profile error-category assertions |
| formatter works once but drifts | second-pass byte-identical source oracle |
| delegate to another runtime command | source/convergence scan and runtime-handler-only invocation |
| claim public KIR or frontend ownership | policy/matrix/release-train assertions keep those rows incomplete |

## Alternatives

### A. Build a production source formatter first

Rejected for M4.1. Comment/trivia preservation, recovery, full grammar coverage,
and public CLI/API design would combine formatter, frontend, and product surface
in one unverifiable slice.

### B. Let JavaScript recursively render decoded KIR

Rejected. That would test a host formatter while KERN merely returns or joins
preselected strings; it does not move semantic ownership.

### C. Pass JSON text to KERN

Rejected. It adds a JSON frontend dependency and permits host-selected schema
spelling at the ownership boundary. Primitive parallel tables use the already
proven runtime ABI.

### D. Promote the existing `kern-formatter` row

Rejected by the full-roster tribunal. Even though its label says "formatter or
canonicalizer," changing the broad row would make a bounded KIR-backend profile
look like release formatter readiness. M4.1 adds a distinct internal-oracle row
and leaves the binary-exit row untouched.

## Blast Radius

| Path | Action | Purpose |
| --- | --- | --- |
| `examples/kern-canonicalizer/canonicalizer.kern` | add | KERN-owned validation and source emission |
| `scripts/kern-canonicalizer/flatten.mjs` | add | generic lossless KIR-to-table adapter |
| `scripts/kern-canonicalizer/rehydrate.mjs` | add | independent table-to-KIR losslessness oracle |
| `scripts/kern-canonicalizer/fixtures.mjs` | add | source/golden/hostile corpus |
| `scripts/kern-canonicalizer/*.test.mjs` | add | adapter and cheat-kill mutations |
| `scripts/check-kern-canonicalizer.mjs` | add | differential/idempotence release oracle |
| `package.json` | modify | root test script and infra wall |
| fitness policy/test and support matrix | modify | exact gate and bounded ownership receipt |
| release train | modify after proof | record M4.1 without closing broad M4/R2 |

No public package export, CLI surface, parser, tokenizer, compatibility runtime,
or KIR format identifier changes in this slice.

## Acceptance Criteria

- [x] Claim-tagged spec and full-roster Agon tribunal complete before code; run
      `tribunal-1784289697339-9t9aes-kern-5-r2-m4-1-prebuild` succeeded 3/3 and
      its NO-GO risks were incorporated before implementation.
- [x] RED oracle fails on the current branch because no KERN canonicalizer or
      `test:kern-canonicalizer` gate exists.
- [x] Adapter is generic and lossless; it contains no admitted-profile semantic
      node/property/type/expression decisions, and flatten→rehydrate deep
      equality holds before handler invocation.
- [x] KERN owns validation, semantic ordering, syntax spelling, escaping,
      indentation, expression rendering, and complete-result construction.
- [x] Every valid fixture produces exact golden canonical source.
- [x] `format(format(x))` is byte-identical for every valid fixture.
- [x] Encoded module KIR before and after formatting is byte-identical.
- [x] Shuffled property input converges while root/child/list order is
      preserved.
- [x] Every enumerated unsupported or malformed graph fixture rejects with no
      partial source result and the expected stable error category.
- [x] Config-owned 16/30/72 row ceilings reach the KERN handler, an exact
      16/30/72 valid fixture completes inside the configured runtime budget,
      and each table rejects above its ceiling without partial output.
- [x] `@kernlang/check` accepts the KERN source.
- [x] `pnpm test:kern-canonicalizer` is a current fitness gate and the support
      matrix exactly matches the policy.
- [x] New `kern-kir-canonicalizer-profile` ownership language remains
      `internal-oracle`; `kern-formatter`, public frontend, KIR v1, compiler,
      fixed point, interpreter, and packed release stay open.
- [x] Focused gate and full `pnpm fitness:kern-5` pass on Node 22 with 11 valid
      fixtures, 3 otherwise-valid profile-limit fixtures, 105 hostile fixtures,
      and the complete repository wall, including the prefix-complete
      runtime-ABI gate. The renewed complete wall passed on 2026-07-17; the
      policy-derived escaped-output fixture then passed the focused gate
      byte-identically.
- [x] Terminal `agon review` with the current six-engine usable roster has no unresolved material
      findings. Exact-tree review
      `review-1784301738713-whskgx-kern-5-r2-m4-1-terminal-final` found the
      `$` structural-name round-trip blocker; its RED regression and KERN-owned
      conditional quoting fix passed the renewed complete wall. Expanded-roster
      review `review-1784308684184-pq6a0r-kern-5-r2-m4-1-dollar-fix-termin`
      found the missing non-string parameter coverage and the runtime-ABI
      public-entry omission; both passed the renewed complete wall. Six-engine
      exact-tree review
      `review-1784318402831-2a1ipx-kern-5-r2-m4-1-terminal-sealed-v` then found
      signed-integer expression drift, spoofable array density, lossy root
      order, and missing direct-handler table-integrity proof. Their RED
      regressions and narrow fixes passed renewed aggregate proof. Six-engine
      exact-tree review
      `review-1784321138406-a6tlpu-kern-5-r2-m4-1-terminal-sealed-v` then found
      escaped-output amplification, symbol-record omission, and shared-array
      alias acceptance. Their RED regressions and policy/adapter fixes passed
      renewed aggregate proof. Final exact-tree review
      `review-1784323647882-9ylf9g-kern-5-r2-m4-1-terminal-sealed-v`
      completed four engines; Codex hit a transport safety false positive and
      Kimi timed out. Both were rerun against the identical exact range in
      `review-1784324869674-axw52z-kern-5-r2-m4-1-terminal-sealed-v` and
      completed. Across all six usable engines there were no blockers. The
      only needs-check code claim was disproved because the named helper-link
      test exists in the reviewed base tree; the other two merely observed
      this intentionally unchecked close gate before it was recorded.
- [x] The publication contract requires Agon-authored/signed granular commits,
      a rebase onto fresh `origin/main`, and one push to the still-open stacked
      branch unless its commits land on main first.

## Confidence Dependencies

- **0.95:** typed handler table transport—the live twelve-array probe passed.
- **0.92:** generic flattening can stay semantics-free—depends on static and
  mutation oracles forbidding KERN-specific adapter decisions.
- **0.96:** exact KIR preservation for the narrowed expression subset—decimal,
  binary, precedence, associativity, and numeric normalization are excluded.
- **0.98:** ownership receipt is honest—the tribunal requires a new bounded row
  and leaves the broad formatter row unchanged.
- **Overall: 0.99** after the 11/3/105 focused corpus, prefix-complete
  runtime-ABI gate, renewed complete wall, and completed six-engine exact-tree
  review with no unresolved material finding.
