# KERN 5 Phase 1: branch Path Provenance v1

**Status:** approved implementation contract
**Base:** `f1ebff5d73b49380513015289d1d851dddfaa69f`
**Risk:** high internal shared-format and runtime-evidence change
**Planning tribunal:** `tribunal-1785964215507-ro0pey`
**Confidence:** 0.90

## Problem

[FACT] Current eligibility contains sixteen runner identities: thirteen exact
composed witnesses and three structural blockers. The blockers are `branch.on`,
`each.in`, and the absent source node `lambda`.

[FACT] `branch` is schema-bound with required `name:identifier`, required
`on:rawExpr`, and `path` children. Its machine contract evaluates `on` once,
compares finite strings or numbers using same-type equality, runs the first
matching value path or one default, and executes the selected body in a child
scope.

[FACT] The global structural policy excludes `rawExpr`. The validated override
table currently admits only `expression-v1.expr` through the closed structural
expression codec.

[FACT] Branch selection distinguishes `path value="paid"` from
`path value=paid` using `IRNode.__quotedProps`. The first is the literal text
`paid`; the second resolves the binding named `paid`.

[FACT] The structural writer currently accepts `__quotedProps` as an IR field
but does not serialize it. A quoted path value and an unquoted path value with
the same property text therefore collapse to identical canonical bytes and
inflate without the runtime-significant provenance.

[DECISION] A `branch.on`-only promotion is prohibited. This slice may close the
branch blocker only by also preserving the exact path-value provenance that the
branch runtime consumes.

## Tribunal plan delta

[DECISION] The initial plan was one property override for `branch.on` plus one
composed witness.

[DECISION] The tribunal found that plan unsound because downstream evidence
cannot repair a non-injective writer. The accepted plan is the smallest
re-scoping: one `branch.on` expression override plus one path-specific
provenance codec for `path.value`.

[DECISION] Do not serialize generalized `__quotedProps`. The new authority is
closed to the exact `(path, value)` pair so unrelated parser metadata cannot
become a new protocol surface.

[DECISION] No unresolved dependency blocks implementation. This depends on the
existing expression codec remaining closed and the existing branch runtime
continuing to use `__quotedProps` for quoted path literals. Tests bind both.

## Constitution and canonical representation

[DECISION] The validated override table contains exactly three rows after this
slice: retain one and add two:

- `expression-v1.expr`: unchanged `rawExpr -> lowered-expression`;
- `branch.on`: `rawExpr -> lowered-expression`, reason
  `portable-expression-required`;
- `path.value`: `string -> lowered-branch-path-value`, reason
  `portable-branch-path-value`.

[DECISION] The global `rawExpr` and `string` policies remain unchanged.
`each.in` remains excluded. Invented, duplicate, missing-target, and
schema-kind-drift override rows fail closed.

[DECISION] `path.value` canonicalizes to an exact record with fields
`form` and `source`:

- `form=quoted-text` means the source IR contained `__quotedProps: ['value']`;
- `form=unquoted-expression` means `value` was not quoted and remains an
  identifier or canonical finite-number source in the branch contract domain;
- `source` is the exact authored property text.

[DECISION] The writer admits path quote metadata only when it is an exact,
dense, unique string array whose entries name present path properties. For
`path.value`, only absent metadata or the exact semantic marker `value` affects
the canonical record. Unknown, duplicate, sparse, accessor-backed, or stale
metadata rejects.

[DECISION] The reader requires the exact record shape, exact form enum, and a
valid source for that form. It rejects raw text, missing or extra fields,
unknown forms, empty unquoted sources, and unquoted sources outside the branch
identifier/finite-number domain.

[DECISION] Inflation restores `props.value=source` and restores
`__quotedProps:['value']` only for `quoted-text`. Unquoted forms inflate without
that metadata. Re-encoding the inflated node must reproduce identical bytes.

## Validation boundary

[DECISION] Structural KIR preserves branch inputs; it does not duplicate the
whole branch semantic validator.

[DECISION] The reader enforces canonical path-value form and source grammar.
The existing internal machine preflight remains authoritative for branch shape:
at least one path, exactly one of `value` or `default` per path, and at most one
default. Existing tests must continue proving malformed branch trees fail before
capability dispatch.

[DECISION] Duplicate value paths remain legal because first-match behavior is
an intentional runtime contract. A default path's source position remains
unobservable because branch has no fallthrough.

## Version transition and historical evidence

[DECISION] Bump the internal constitution and artifact formats from `r1.5f.1`
to `r1.5g.1`, and bump the coverage-ledger format to `r1.5g.1`. The independent
handler type-admission format stays `r1.5e.1-handler`.

[DECISION] The reader rejects `r1.5f.1-alpha` and unknown formats. There is no
dual-version reader or compatibility fallback.

[DECISION] Add exact historical reconstruction from current `r1.5g.1` bytes to
the pre-branch `r1.5f.1` constitution, compiled catalog, and compiled artifact
type bytes.

[DECISION] Preserve the existing `r1.5f.1 -> r1.5e.1` pre-expression
reconstruction as a second authenticated step. Do not rewrite frozen M4.127,
M4.141, M4.145, M4.147, or M4.148 receipts.

[DECISION] Runtime constitution resolution accepts only exact validated live
`r1.5g.1`, exact reconstructed pre-branch `r1.5f.1`, or exact reconstructed
pre-expression `r1.5e.1` bytes. Arbitrary byte inputs fail closed.

[DECISION] Regenerate only current coverage summaries after implementation
source digests change. Frozen historical summary JSON remains byte-identical.

## Focused codec evidence

[DECISION] Add a new focused core test file rather than growing the existing
490-line structural test file.

[DECISION] The focused tests prove:

- exact `branch.on` expression lowering and inflation;
- quoted and unquoted `path.value` sources with identical text produce
  different bytes and inflate to different quote metadata;
- both forms round-trip byte-identically;
- quoted text, unquoted identifier, and unquoted numeric source are admitted;
- raw text and malformed canonical provenance records reject;
- missing `branch.on`, zero paths, invalid path alternatives, and multiple
  defaults reject at the documented structural/runtime boundary;
- predecessor artifact format rejects deterministically;
- `each.in` remains rejected.

## Exact composed runner witness

[DECISION] Add one runner tuple in live order:

- `id`: `branch`;
- `witnessId`: `kir-runtime-compose.branch.v1`;
- `semanticEnvelopeId`: `quoted-path-seven`;
- `fixtureId`: `branch-quoted-path-seven`;
- `oracleId`: `exact-branch-result`;
- `excludedProperties`: none.

[DECISION] The fixture handler declares identifier `paid` as `binding-value`.
Its branch subject is the literal expression `"paid"`. Keeping the binding in
the handler preserves the internal handler ABI, which intentionally does not
import arbitrary host bindings. The paths are, in order:

1. unquoted `value=paid`, which resolves to `binding-value` and must not match;
2. quoted `value="paid"`, which must match and return integer `7`;
3. `default=true`, which returns integer `9` only when nothing matches.

[DECISION] The independent oracle is one successful integer `7` envelope with
no events or diagnostics. The causal control changes only the subject to
`"missing"`, causing exact integer `9`; it must differ from the authoritative
envelope.

[DECISION] This witness proves quote-provenance preservation, selected-path
execution, and default control only. It does not claim to replace the broader
branch contract tests for single evaluation, scoping, completion, or all
malformed shapes.

## Coverage and eligibility

[DECISION] The branch node and `branch.on` ledger rows become exact admitted
witnesses. `path.value` changes from `included-value` to
`lowered-branch-path-value` and receives distinct quoted/unquoted acceptance
witnesses plus hostile canonical-record rejection evidence.

[DECISION] Every constitution node and property remains classified. Coverage
closure independently checks the exact provenance record instead of trusting
writer output as its own oracle.

[DECISION] Eligibility transitions atomically from `{16,13,3,0}` to
`{16,14,2,0}`. Remaining blockers are exactly:

- `each`: `required-in:excluded-host-expression`;
- `lambda`: `source-node-absent`.

[DECISION] Public KIR, `versioned-kir-v1`, runtime cutover, and Alpha status do
not change.

## Mutation attacks

[DECISION] Tests must kill at least these wrong implementations:

- promote all `rawExpr` properties;
- admit `each.in` with `branch.on`;
- serialize all `__quotedProps` generically;
- drop path quote provenance;
- encode quoted and unquoted `paid` to identical bytes;
- inflate both forms with the same metadata;
- accept a raw path text in place of the provenance record;
- accept unknown/decorated provenance forms;
- allow stale or duplicate quote metadata;
- retain the old format while widening the domain;
- bypass branch shape preflight or dispatch a capability before rejection;
- register a branch witness without exact Module KIR dataflow;
- use the runtime result as its own oracle;
- claim 15/16 or public KIR readiness.

## Binary acceptance criteria

1. [DECISION] A RED test demonstrates the quoted/unquoted byte collision on the
   current writer before implementation.
2. [DECISION] Exactly the branch and path-specific override rows are added;
   global policies and remaining blockers stay unchanged.
3. [DECISION] Current generated constitution/catalog reproduce byte-identically
   at `r1.5g.1`.
4. [DECISION] Focused writer, reader, inflation, provenance, predecessor, and
   hostile mutation tests pass.
5. [DECISION] Historical `r1.5f.1` and `r1.5e.1` reconstructions authenticate
   exact bytes and frozen receipt digests.
6. [DECISION] Composed evidence executes fourteen exact witnesses through both
   internal handlers and kills the branch causal control.
7. [DECISION] Coverage remains 302/302 nodes and 1149/1149 properties with no
   unclassified row; eligibility reports 14 witnessed / 2 blocked.
8. [DECISION] Alpha receipt bindings include every new authority and remain
   Alpha/no-public-status.
9. [DECISION] Lint, build, targeted gates, full canonicalizer, full KERN 5
   fitness, diff hygiene, and handwritten line limits pass.
10. [DECISION] Full-roster Agon review uses `claude,codex,agy`, automatic risk,
    `primary-engine=codex`, and role lenses. Findings are verified against
    current files before shipping.
11. [DECISION] The signed commit fetches current main, pushes once, verifies the
    remote SHA, and immediately begins the final lambda blocker slice.

## Likely file surfaces

[HYPOTHESIS] Expected handwritten changes include the constitution generator,
structural node writer/reader, runtime inflater, a new path-value codec, focused
tests, runner fixture/oracle tables, coverage/eligibility authorities,
historical canonicalizer reconstruction helpers, current summaries, and Alpha
receipt bindings.

[DECISION] Generated catalogs, constitutions, ledgers, and summaries may exceed
500 lines. No edited handwritten file may exceed 499 lines; extract new codec
logic rather than growing an oversized owner.
