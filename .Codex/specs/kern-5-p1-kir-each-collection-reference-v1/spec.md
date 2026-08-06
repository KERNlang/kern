# KERN 5 Phase 1: each Collection Reference v1

**Status:** approved implementation contract
**Base:** `ef3dce44a20781d6eeb75ec79043e735c7e66fb1`
**Risk:** high internal shared-format, runtime-classifier, and historical-evidence change
**Planning tribunal:** `tribunal-1785971663022-1iuw25-kern-5-each-in-plan`
**Confidence:** 0.97

## Problem

[FACT] Current eligibility contains sixteen runner identities: fourteen exact
composed witnesses and two structural blockers. The blockers are required
`each.in` and the absent source node `lambda`.

[FACT] `each.in` is a required `rawExpr`. The global structural policy excludes
`rawExpr`; exact overrides currently admit only `branch.on` and
`expression-v1.expr` through the general structural expression codec.

[FACT] The internal each runtime accepts an exact direct binding name or a
proven, non-optional record-array member whose receiver is an unparenthesized
identifier. It rejects parenthesized bindings, parenthesized receivers,
optional or nested members, indexes, calls, lists, binary expressions, and
other expression shapes.

[FACT] Runtime acceptance is raw-source-sensitive for direct bindings. `items`
can resolve while ` items`, `items `, and `(items)` reject. Parser whitespace
around a valid member is not semantic: `record.items`, ` record.items `, and
`record . items` resolve to the same proven member.

[FACT] The general structural expression codec canonicalizes expression
syntax. It therefore maps runtime-rejected `(items)` to the same artifact form
as runtime-accepted `items`, and maps `(record).items` to the same form as
`record.items`. Inflating that artifact can change rejection into acceptance.

[DECISION] A generic `each.in -> lowered-expression` override is prohibited.
This slice may close the blocker only through a collection-reference codec
whose domain and normalization preserve runtime acceptance and lookup meaning.

## Tribunal plan delta

[DECISION] The initial plan reused `lowered-expression`, retained optional
`each.key` and `each.type` exclusions, and added a composed array witness.

[DECISION] The tribunal found the slice boundary sound but the codec mechanism
non-injective for runtime-significant parentheses. The accepted delta is a new
`lowered-each-collection-reference` disposition backed by one shared pure
classifier.

[DECISION] `each.key` and `each.type` stay excluded. Neither property is read by
the internal each runtime, so admitting either would widen the portable claim
without executable evidence.

[DECISION] No dependency remains unresolved. Parser/runtime probes at the base
commit bind exact whitespace and parenthesis behavior; the classifier will be
shared; the compiled and source reconstruction inventory is enumerated below.

## Shared collection-reference contract

[DECISION] Add a host-free pure module outside both the runtime and structural
directories. It parses text with the existing expression parser and returns
one of exactly two semantic references:

- `binding`: an unparenthesized identifier whose source text is exactly the
  identifier name;
- `record-array-field`: a non-optional member with an unparenthesized identifier
  receiver and one identifier property.

[DECISION] Binding source must be canonical text. Leading/trailing whitespace
and parentheses reject because the runtime's exact binding lookup rejects
them.

[DECISION] Member source may contain parser-accepted surrounding or dot
whitespace. The classifier returns receiver and property names, and its
canonical spelling is `receiver.property`. All accepted whitespace variants
have identical runtime lookup meaning, so normalization is semantic-preserving.

[DECISION] Parenthesized receivers, optional members, nested members, indexes,
calls, arrays, records, literals, unary/binary/conditional expressions, and
parse failures return no reference.

[DECISION] `each-runtime` consumes the shared classifier after preserving its
existing exact direct-binding fast path. A classified binding with no binding
still reports the missing canonical binding. A classified member retains the
existing record-array proof and portable-scalar checks.

[INVARIANT] The runtime change is behavior-preserving. Existing acceptance and
error behavior for direct bindings, member whitespace, proven member fields,
and every rejected expression family remains covered by differential tests.

## Constitution and canonical representation

[DECISION] Add the exact override:

- `each.in`: `rawExpr -> lowered-each-collection-reference`, reason
  `portable-each-collection-reference-required`.

[DECISION] The global `rawExpr` policy remains excluded. The exact override set
after this slice is `branch.on`, `each.in`, `expression-v1.expr`, and
`path.value`; invented, duplicate, missing-target, and schema-kind-drift rows
fail closed.

[DECISION] `each.in` canonicalizes to an exact record with fields `form` and
`source`:

- `form=binding`, `source=<identifier>`;
- `form=record-array-field`, `source=<receiver>.<property>`.

[DECISION] The writer accepts text only, classifies it through the shared
contract, and stores the canonical spelling. Accepted member whitespace may
produce identical bytes; runtime meaning is identical. Every rejected syntax
shape fails before bytes are emitted.

[DECISION] The reader requires the exact two-field record, the exact form enum,
and canonical source spelling. It reclassifies source through the shared
contract and requires the resulting form and canonical spelling to match.
Raw text, missing/extra/reordered fields, unknown forms, non-canonical binding
or member source, and unsupported expression shapes reject.

[DECISION] Inflation restores only the canonical source text. Re-encoding an
inflated node must reproduce identical bytes.

## Exact composed runner witness

[DECISION] Add one runner tuple in live order:

- `id`: `each`;
- `witnessId`: `kir-runtime-compose.each.v1`;
- `semanticEnvelopeId`: `array-sum-seven`;
- `fixtureId`: `each-array-sum-seven`;
- `oracleId`: `exact-each-sum`;
- `excludedProperties`: `key:excluded-host-expression` and
  `type:excluded-host-type`.

[DECISION] The handler is self-contained: bind `items=[3,4]`, bind `total=0`,
iterate `each name=item in=items`, add each item to `total`, then return
integer `7`. The causal control changes only the list to `[3,5]` and must return
integer `8`.

[DECISION] The witness proves structural preservation of the admitted binding
reference, two body iterations, child binding use, outer accumulator write
through, and result causality. It does not replace the machine contract suite.

[FACT] The existing each contract source and tests already bind all six shapes:
array, indexed array, pair sync, pair async, entry key, and entry value, plus
completion propagation and shape rejection. Eligibility continues digest-
binding that source; the new composed witness proves KIR-to-runtime integration.

## Version transition and historical evidence

[DECISION] Bump the internal constitution and artifact formats from `r1.5g.1`
to `r1.5h.1`, and bump the coverage-ledger format to `r1.5h.1`. The independent
handler type-admission format remains unchanged.

[DECISION] The reader rejects `r1.5g.1-alpha` and unknown formats. There is no
dual-version artifact reader or compatibility fallback.

[DECISION] Add exact current-to-pre-each reconstruction before every existing
history step:

1. `r1.5h.1 -> r1.5g.1` pre-each;
2. `r1.5g.1 -> r1.5f.1` pre-branch;
3. `r1.5f.1 -> r1.5e.1` pre-expression.

[DECISION] Source reconstruction reverses the format and exact `each.in`
constitution row. Runtime constitution resolution admits only exact validated
live `h`, exact reconstructed `g`, exact reconstructed `f`, or exact
reconstructed `e` bytes.

[DECISION] Compiled `h -> g` reconstruction covers the generated catalog,
artifact types, structural node projector/validator, and `each-runtime` shared-
classifier integration. The new shared classifier and structural codec compiled
modules are post-M4.145 inventory members and are removed exactly before the
existing historical digest is measured.

[DECISION] `runtime-inflate.js` remains in the already-authenticated post-M4.145
removal set, so its new disposition branch cannot enter the frozen M4.145
digest. The live compiled-core digest still binds it normally.

[DECISION] Do not rewrite frozen M4.127, M4.141, M4.145, M4.147, or M4.148
receipts. Regenerate only current coverage summaries after live implementation
and compiled-core digests change.

## Coverage and eligibility

[DECISION] The `each` node changes from required excluded payload to lowered
semantic. `each.in` receives an admitted canonical witness. Optional
`each.key` and `each.type` retain populated rejection and omitted acceptance;
all included each properties transition from node-level rejection to exact
admitted witnesses.

[DECISION] Coverage closure independently checks the exact collection-reference
record instead of treating writer output as its own oracle.

[DECISION] Eligibility transitions atomically from `{16,14,2,0}` to
`{16,15,1,0}`. The sole remaining blocker is exactly:

- `lambda`: `source-node-absent`.

[DECISION] Public KIR, `versioned-kir-v1`, runtime cutover, and Alpha status do
not change.

## Mutation attacks and focused evidence

[DECISION] Focused tests must kill at least these wrong implementations:

- route `each.in` through unrestricted `lowered-expression`;
- encode `items` and `(items)` to the same accepted artifact;
- encode `record.items` and `(record).items` to the same accepted artifact;
- accept whitespace around a direct binding;
- reject runtime-equivalent whitespace around a valid member;
- accept optional, nested, indexed, called, literal, list, or binary sources;
- accept raw text instead of the exact canonical record;
- accept unknown, decorated, reordered, or non-canonical records;
- inflate a member to a different receiver or property;
- bypass record-array proof or portable-scalar checks in the runtime;
- change any of the six established each shapes;
- admit `each.key` or `each.type`;
- retain the old format while widening the domain;
- reconstruct `g` directly from live `h` without the exact `h -> g` stage;
- leave either new compiled module in the frozen M4.145 inventory;
- register an each witness without exact KIR dataflow or a causal control;
- claim 16/16 or public KIR readiness.

## Binary acceptance criteria

[ACCEPTANCE] The shared classifier and runtime differential suite pass for the
complete accepted/rejected source matrix.

[ACCEPTANCE] Focused structural tests prove canonical records, hostile-reader
rejection, byte-stable round trips, predecessor rejection, and exact optional
exclusions.

[ACCEPTANCE] Composed evidence returns exactly `7`, its control returns exactly
`8`, and sync/async internal engines agree.

[ACCEPTANCE] Constitution, coverage closure, eligibility, Alpha receipt,
historical canonicalizer floors, full canonicalizer coverage, lint, typecheck,
build, and the complete KERN 5 fitness wall pass.

[ACCEPTANCE] Independent Agon review runs after the local wall with automatic
risk, primary engine `codex`, roles `auto`, and exact roster
`claude,codex,agy`; all verified blockers are fixed before commit.
