# KERN Frontend Theme-Enabled Generic-Property Loop Shadow v1

**Status:** DONE — SIGNED PUBLICATION PENDING
**Milestone:** M4.166
**Date:** 2026-08-05
**Confidence:** 0.99

## Executive Summary

[D1] M4.166 adds the smallest complete successor to the generic-property loop:
a native KERN theme-enabled generic-property loop shadow. The successor will
authenticate M4.165 once, re-observe the retained token stream once, replay and
own property parsing across theme boundaries, preserve theme-reference
occurrence order including duplicates, and resume generic property parsing
after each theme boundary.

[D2] Style blocks are deliberately not bundled into this slice. They introduce
a nested comma/quote/parenthesis grammar plus normal, quoted-key, and
pseudo-selector writes, while a theme reference is one already-tokenized value
with append-only semantics. Unexpected-token diagnostics remain the next
generic-loop branch after style/theme ownership.

## Current State / Root Cause

[V1] The bootstrap generic loop handles style, theme, property, and unexpected
tokens as four separate branches. A `themeRef` appends `tok.value`, advances
exactly one token, and continues the loop (`packages/core/src/parser-core.ts:363-401`).
**VERIFIED.**

[V2] Bare property values stop before either `style` or `themeRef`, leaving the
boundary token for the generic loop (`packages/core/src/parser-core.ts:235-245`).
**VERIFIED.**

[V3] The tokenizer emits `$name` as one `themeRef` token whose value excludes
the `$`; the name begins with an identifier-start character and continues with
identifier characters (`packages/core/src/parser-tokenizer.ts:258-264`).
**VERIFIED.**

[V4] M4.165 currently fails closed with `LOOP_PROFILE` whenever its property
state machine reaches a `style` or `themeRef` token
(`examples/kern-frontend/generic-property-loop.kern:151-166,184-190`).
**VERIFIED.**

[V5] Direct bootstrap probes on 2026-08-05 proved that `screen $base $accent`
produces `themeRefs: ["base", "accent"]`, `screen a=one $base b=two` preserves
both properties around the reference, and `screen a=bare$base` stops the bare
value before the adjacent reference. The command imported
`parseWithDiagnostics` and `tokenizeLine` from the freshly built core `dist`;
all three probes emitted zero diagnostics. **VERIFIED.**

[V6] M4.165 has no representation for theme-reference records, and its 18
fixtures contain no admitted `themeRef` (`scripts/kern-frontend-generic-property-loop/fixtures.mjs:1-20`,
`scripts/kern-frontend-generic-property-loop/oracle.mjs:1-165`). **VERIFIED.**

The missing ownership boundary is therefore not tokenization. It is the
generic-loop transition that consumes a retained theme token, records its
value and order, then hands control back to property parsing.

## What Already Works

[W1] M4.153-M4.165 already own the bounded token stream, admitted node type,
known-node warning, first property, repeated properties, last-write behavior,
quoted-property ordering, duplicate diagnostics, and UTF-16 duplicate columns.
M4.166 composes those contracts, but it necessarily replays and owns the
property loop for its wider grammar because M4.165 sets `LOOP_PROFILE` before
committing an in-flight bare property at a theme boundary
(`examples/kern-frontend/generic-property-loop.kern:157-194`). **VERIFIED**
against `scripts/check-kern-frontend-generic-property-loop.mjs:1-331` and
`examples/kern-frontend/generic-property-loop.kern:1-426`.

[W2] The frozen bootstrap parser already attaches non-empty `themeRefs` to
node props (`packages/core/src/parser-core.ts:718-719`), and live consumers
serialize, decompile, or expose that array (`packages/core/src/utils.ts:43-47`,
`packages/core/src/decompiler.ts:290-291`,
`packages/core/src/codegen/helpers.ts:34-35`). M4.166 changes none of those
production consumers. **VERIFIED.**

[W3] The fused evidence path already binds source, runtime instance, and parse
epoch and is one-shot (`packages/core/src/mutable-node-type-registry-snapshot.ts:430-455`).
M4.166 needs a profile-specific entry but no new evidence primitive.
**VERIFIED.**

## Contract (Verified)

> Verified against the listed source and direct bootstrap probes on 2026-08-05.

| Field / Behavior | Type | Evidence | Tag |
|---|---|---|---|
| inherited M4.165 envelope | authenticated field sequence | `scripts/check-kern-frontend-generic-property-loop.mjs:186-286` | VERIFIED |
| retained token stream | authenticated field sequence | `scripts/check-kern-frontend-generic-property-loop.mjs:235-286` | VERIFIED |
| theme token | `{ kind: "themeRef", value, pos }` | `packages/core/src/parser-tokenizer.ts:258-264` | VERIFIED |
| theme occurrence | `{ index, tokenIndex, value }` | derived only from the verified token order above | VERIFIED |
| `themeRefs` | ordered string array, duplicates retained | `packages/core/src/parser-core.ts:377-381`; direct duplicate/order probe is an acceptance fixture | VERIFIED |
| property handoff | style/theme stops a bare value without consuming the boundary | `packages/core/src/parser-core.ts:235-245` | VERIFIED |
| expected predecessor failure | exact M4.165 `LOOP_PROFILE`; because M4.165 does not expose its cursor, M4.166 independently replays the authenticated stream and proves that the first otherwise-failing transition is the recorded `themeRef` cursor | `examples/kern-frontend/generic-property-loop.kern:137-194` plus authenticated retained stream | VERIFIED |
| bootstrap parity | exact theme refs, properties, quoted properties, and duplicate diagnostics | `packages/core/src/parser-core.ts:403-412,718-719` | VERIFIED |

The native envelope will bind format/profile, source, runtime instance, parse
epoch, inherited M4.165 field count, retained-stream field count, ordered theme
records, final property records, quoted-property records derived from final
state, duplicate diagnostics, terminal cursor/kind, authenticated inherited
chunks, authenticated stream chunks, and a terminal seal. The seal binds the
source bytes, runtime instance, parse epoch, complete predecessor and stream
field counts, ordered records, and terminal cursor. Property writes and theme
occurrences have separate policy bounds. No model, roster, or mutable
operational choice is a literal in source.

## Implementation Options

### Option A — Theme-enabled generic-property loop successor (recommended, confidence 0.95)

Add `observegenericpropertythemerefs` as an additive successor. It accepts the
exact M4.165 success envelope for inputs without a theme boundary. It accepts
an M4.165 `LOOP_PROFILE` envelope only when independent replay reaches the same
first failure cursor, that cursor is a `themeRef`, and no earlier style or
unexpected-token transition exists. It owns the property state machine plus
append-only theme consumption and fails closed at the first style or
unexpected token.

Pros: smallest semantic increment; fixture and mutation space stays
discriminating; one-token transition is separable from style parsing; the
ownership claim accurately includes replayed property state.

Cons: the successor must reconstruct property state rather than inherit partial
state and must carefully distinguish an expected inherited profile failure
from corruption; styles remain deferred.

### Option B — Combined style-and-theme successor (confidence 0.76)

Own both boundary token kinds at once. This removes one future integration
step but also requires `splitStylePairs`, escaped quote/backslash behavior,
parenthesis depth, quoted keys, pseudo selectors, overwrite order, and unsafe
ordinary-object key handling in one slice (`packages/core/src/parser-style.ts:3-72`).
That is a materially larger grammar and safety proof.

### Option C — Unexpected-token successor first (confidence 0.63)

Own warning generation before styles/themes. This is poorly ordered because
the existing generic loop gives style/theme higher precedence, so a diagnostic
slice would still need to exclude two valid token kinds and would not unlock
property continuation across either boundary.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `examples/kern-frontend/generic-property-theme-refs.kern` | add | native successor member |
| `packages/core/src/mutable-node-type-registry-snapshot.ts` | edit | fused M4.166 source-profile safety entry |
| `packages/core/tests/mutable-node-type-registry-snapshot.test.ts` | edit | safety and evidence regression |
| `scripts/check-kern-frontend-generic-property-theme-refs.mjs` | add | structural, envelope, oracle, bootstrap parity checker |
| `scripts/check-kern-frontend-generic-property-theme-refs-regressions.mjs` | add | cumulative M4.153-M4.166 receipt |
| `scripts/kern-frontend-generic-property-theme-refs/*` | add | policy with distinct property/theme bounds, fixtures, independent oracle, tests |
| `package.json` | edit | focused gate |
| `scripts/kern-5-fitness-policy.json` | edit | promoted fitness command and row |
| `scripts/kern-5-fitness.test.mjs` | edit | exact promoted-row expectation |
| canonicalizer receipt/summary files | refresh if required | authenticate changed core/test surfaces |
| `docs/kern-5-release-train.md` | edit | close M4.165 and record M4.166 |
| `.Codex/goals/KERN-5-COMPLETION-GOAL.md` | edit | durable current-slice state |

No existing public parser, type, serializer, or code-generation API changes.

## Acceptance Criteria

- [x] RED-at-base proves the M4.166 source, checker, policy, oracle, fixtures,
      regression receipt, and promoted fitness row are all absent for the
      intended reason.
- [x] Native source contains exactly one M4.166 member, exactly one M4.165 call,
      exactly one retained-stream call, one `handler lang="kern"`, and no host
      parser/oracle delegation.
- [x] The successor accepts zero themes, one theme, repeated themes, duplicate
      themes, themes adjacent to properties, and a theme immediately following
      a bare value.
- [x] Theme occurrence order and duplicates exactly match bootstrap
      `themeRefs`; no deduplication or sorting is tolerated.
- [x] Theme occurrence count has its own positive, bounded policy value and
      cannot consume the generic-property-write budget.
- [x] Generic property values, last-write state, quoted-property order,
      duplicate diagnostics, UTF-16 columns, and terminal cursor remain exact
      across theme boundaries.
- [x] A theme-like spelling inside a quoted or expression value is not emitted
      as a theme occurrence.
- [x] Style tokens and unexpected tokens remain fail-closed outside the M4.166
      source profile.
- [x] An expected M4.165 `LOOP_PROFILE` is accepted only when independent
      replay proves the exact first failure cursor is a reachable `themeRef`;
      a later theme never launders an earlier style, malformed property head,
      missing equals, or unexpected token.
- [x] The checker rejects truncated, extended, reordered, duplicated,
      unauthenticated, corrupt-count, corrupt-theme, corrupt-property, and
      corrupt-seal envelopes.
- [x] Mutations that skip a theme, deduplicate themes, reorder themes, consume
      the boundary into a bare value, fail to resume properties, accept a style
      token, accept an unexpected token before a later theme, substitute
      predecessor/stream evidence across invocations, or corrupt a first-failure
      cursor/count/seal are killed.
- [x] The fused safety entry rejects every inherited generic-property key before
      epoch capture and preserves one-shot runtime/source binding.
- [x] Focused M4.166, cumulative M4.153-M4.166, touched-core tests, lint/diff,
      semantic validation, current canonicalizer receipts, and the complete
      Node 22 `pnpm fitness:kern-5` wall pass.
- [x] Automatic high-risk role-lens review uses live routing with primary
      engine `codex`; every source-verified blocker is repaired and affected
      gates rerun before the single signed push.

## Out of Scope

[X1] Style pair parsing, styles, pseudo-styles, unexpected-token warnings,
evolved/runtime parser hints, keyword handlers, exports/pre-populated props,
multiline/indent locations, successful `ParsedLine`/tree construction, AST/KIR,
public APIs, and frontend cutover are excluded.

[X2] M4.166 does not modify `parser-core.ts`, `parser-tokenizer.ts`,
`parser-token-stream.ts`, `parser-style.ts`, prior frontend formats, or
bootstrap authority.

[X3] M4.167 should own style-block parsing and style/theme integration before
unexpected-token handling, unless post-M4.166 source evidence selects an even
smaller coherent style-pair boundary.

## Open Questions

[Q1] None. The predecessor profile-failure rule, wider loop ownership, separate
theme bound, and style/unexpected-token fail-closed boundary are explicit and
testable.

## Deploy Order

[P1] This is an internal additive shadow gate. Spec, source, checker, fixtures,
policy, cumulative receipt, fitness rows, documentation, safety entry, and any
required canonicalizer identity refresh ship atomically in one signed commit
and one push. There is no mixed-version public contract or runtime skew window.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| M4.166 owns only theme-reference consumption and does not reimplement property parsing | M4.165 emits `LOOP_PROFILE` before committing the in-flight property, so the wider grammar must replay and own the property loop | Renamed the boundary and made replay/parity part of the contract |
| M4.165 failure evidence exposes enough state to copy knownness directly from its header | A `LOOP_PROFILE` header omits known-state fields | M4.166 authenticates the nested M4.164 admission prefix and derives `knownState` and `admittedType` without another parse call |
| `a=$base` creates an empty-value property | The bootstrap parser sees a value token and classifies the zero-consumption value as `bare` before handing off the theme token | Native and independent oracle now preserve the exact `bare` taxonomy |
| The first mutation helper could replace a textual target without identifying its occurrence | Some KERN assignments intentionally repeat | Mutation targets are occurrence-explicit; production checks were not weakened |
| The first full canonicalizer run failed because of behavioral drift | The only failure was M4.151's stale compiled-core digest after adding the fused safety export | The exact digest literal and generated canonicalizer summaries were refreshed; the final 737/737 matrix and 112/112 coverage pass |
| A boolean option on the M4.165 parser was the smallest way to admit an expected profile failure | Although structurally safe, the option blurred structural parsing and oracle verification | Split the checker into an internal structural parser, the unchanged verified M4.165 wrapper, and a named exact-`LOOP_PROFILE` successor entry |
| Later tokens could not affect a failure already selected by the native loop | The loop continued after `THEME_LIMIT`, and an unguarded later style/unexpected branch could overwrite it with `THEME_PROFILE` | Added a red-first precedence fixture, froze token processing after the first failure, and expanded coverage for style-value, style-bare, property-limit, and theme-limit branches |

## Challenge and Plan Delta

[T1] Initial confidence was 0.91. Source evidence favored a theme-only token
transition over the nested style grammar, but expected predecessor-failure
composition was not yet fully specified.

[T2] Adversarial hybrid tribunal
`tribunal-1786111287658-ia6mn7` completed 3/3 with Claude, Codex, and agy. It
rejected combined style/theme ownership and rejected the original narrow
wording. The load-bearing finding was that M4.165 fails before committing a
bare property at the boundary; therefore M4.166 must be a theme-enabled
generic-property loop, not a theme append adapter.

[T3] The plan now requires exact first-failure replay before accepting
`LOOP_PROFILE`, fail-closed style/unexpected-token precedence, separate theme
and property bounds, complete source/runtime/epoch/envelope/stream/cursor seal
binding, and new laundering/substitution mutations. No dependency remains
unresolved. Confidence increased from 0.91 to 0.95.

[T4] Nero red-team `nero-1786111721652-idnb92` returned `FLAWED`, but its
runtime-CSS/cache/UTF-16-object-sealing claims did not match this repository's
actual contracts: the input is an authenticated retained-token record stream,
there is no global cache, duplicate references intentionally match bootstrap
occurrence order, malformed UTF-16 fails in the existing scanner path, and the
envelope is fixed-width text evidence rather than a mutable JavaScript object.
The useful concern—prove the predecessor failure cause rather than trusting its
label—was already incorporated through independent replay and laundering
fixtures. No unresolved dependency was introduced.

[T5] Local verification completed on Node 22.22.0. Focused M4.166 tests passed
6/6 over 23 fixtures; the cumulative M4.153-M4.166 receipt passed; the touched
core test, lint, semantic validation, diff hygiene, 737/737 canonicalizer
matrix, 112/112 canonicalizer coverage, cross-target conformance, runner and
application behavior, KIR/runtime gates, and the complete `pnpm
fitness:kern-5` wall all passed. The wall ended with `KERN 5 current fitness
wall passed.` Confidence was 0.97 pending independent review.

[T6] Automatic high-risk role-lens review
`review-1786120616378-tpt7dn` completed 6/6. It produced zero consensus-verified
findings and six needs-check items. Source verification rejected the claimed
runtime/epoch/count gap, default M4.165 failure-verification regression,
`THEME_INVALID` ambiguity, and independence-related duplication as non-defects.
The parser-option concern led to the named structural/verified split above.

[T7] Targeted correctness confirmation
`review-1786121647210-gxrx6x` then exposed the genuine first-failure precedence
gap and missing branch fixtures. A red test reproduced `THEME_PROFILE` replacing
an earlier `THEME_LIMIT`; the minimal native guard now freezes processing after
the first failure. The focused suite and cumulative receipt pass with 23
fixtures. Final targeted correctness review
`review-1786122588051-8ixoz2` completed 1/1 with zero findings. All acceptance
items are complete; only signed publication and remote verification remain.
Confidence is 0.99.
