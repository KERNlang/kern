# KERN Frontend Style-Enabled Generic-Property Loop Shadow v1

**Status:** IMPLEMENTED — LOCAL GATES AND REVIEW PASS; PUBLICATION PENDING
**Milestone:** M4.167
**Date:** 2026-08-05
**Confidence:** 0.99

## Executive Summary

[D1] M4.167 adds the smallest complete successor that can prove style semantics
are executed at the same cursor as the production generic loop: a native KERN
style-enabled generic-property/theme loop shadow. It authenticates M4.166 once,
re-observes the M4.159 retained token stream once, replays properties, themes,
and styles in production precedence, and owns the nested style-block grammar.

[D2] The successor emits lossless style-segment evidence, ordered normal and
pseudo writes including invisible unsafe-key attempts, final bootstrap-visible
style/pseudo state, property/theme state, and exact transition cursors. It does
not scan style tokens that the loop cannot reach.

[D3] The production TypeScript parser remains the bootstrap oracle. This is an
internal release-blocking shadow and does not modify `parser-core.ts`,
`parser-style.ts`, tokenizer behavior, public AST/KIR, or runtime routing.

## Verified Current Contract

[V1] The bootstrap generic loop selects branches in this exact order: style,
theme reference, property, unexpected token. A reachable style token calls
`parseStyleBlock(tok.value, styles, pseudoStyles)`, advances once, and resumes
the loop (`packages/core/src/parser-core.ts:363-401`). **VERIFIED.**

[V2] A bare property value stops before either `style` or `themeRef` without
consuming the boundary (`packages/core/src/parser-core.ts:235-245`). Therefore
the property write commits before the style/theme transition. **VERIFIED.**

[V3] `splitStylePairs` scans JavaScript UTF-16 code units. Backslash plus one
following unit is copied and skipped. Double quote toggles quoted state.
Outside quotes, `(` increments and `)` decrements depth. A comma splits only at
exact depth zero. Empty/trim-only segments are discarded and retained pairs are
trimmed (`packages/core/src/parser-style.ts:3-32`). **VERIFIED.**

[V4] Pair interpretation precedence is pseudo, quoted key, normal first-colon,
then ignored. Pseudo syntax is
`^:([a-z]+):([A-Za-z0-9_-]+):(.+)$`; its value is trimmed but not unquoted.
Quoted-key syntax is `^\"([^\"]+)\"\s*:\s*(.*)`. Normal syntax requires its
first colon index to be greater than zero. Quoted-key and normal values are
trimmed and unwrapped only when both ends are `\"`; unescape order is
`\\\" -> \"` and then `\\\\ -> \\` (`packages/core/src/parser-style.ts:34-72`).
**VERIFIED.**

[V5] The tokenizer emits one `style` token whose value excludes braces, honors
backslash escapes and double quotes, and ends at the first unquoted/unescaped
`}`. An unclosed style still emits a retained style value plus an
`UNCLOSED_STYLE` diagnostic (`packages/core/src/parser-tokenizer.ts:180-212`).
**VERIFIED.**

[V6] Direct fresh-build probes on 2026-08-05 verified commas inside quotes and
parentheses, nested and negative depth, escaped commas, empty values, first
colon values, invalid-pair silence, multiple blocks, duplicate last-write,
quoted unescape behavior, unclosed style parsing, and style/theme/property
interleaving against `parseWithDiagnostics`. **VERIFIED.**

[V7] Bootstrap output objects use ordinary JavaScript assignment semantics.
For normal/quoted-key styles, a `__proto__` string write is not an own key;
`constructor` and `toString` are own keys. In an allocated pseudo map,
`__proto__` is invisible while `constructor` and `toString` are own keys. A
pseudo *name* must contain only lowercase ASCII letters; `constructor` is the
only matching inherited truthy `Object.prototype` name and therefore does not
allocate an own pseudo map. Its attempted key write targets the host `Object`
constructor and is not serialized. M4.167 models that visible result without
performing a host-global mutation. **VERIFIED** by direct `parseStyleBlock`
probe and the source assignment path.

[V8] Ordinary own-key enumeration orders canonical array-index keys first in
ascending numeric order, followed by other string keys in first-insertion
order; overwriting does not move an existing key. An array index is the
canonical decimal string for an integer from `0` through `4294967294`.
`4294967295`, `01`, and `-0` are non-index strings. **VERIFIED** against the
JavaScript object contract used by the bootstrap representation.

[V9] M4.166 authenticates M4.165 plus the retained stream, owns property/theme
transitions, and fails with `THEME_PROFILE` at the first reachable style token.
Its failure header does not contain replay state. A wider successor must replay
the integrated loop and prove that an expected predecessor failure occurs at
the same first reachable style cursor. **VERIFIED** against
`examples/kern-frontend/generic-property-theme-refs.kern` and its checker.

## Native Ownership Contract

[C1] `observegenericpropertystyletheme` accepts the inherited bounded frontend
inputs plus separate positive limits for style tokens, block code points,
block UTF-16 units, block UTF-8 bytes, raw segments, retained pairs, style
writes, positive parenthesis depth, output fields, and output bytes. Policy
values are configuration, never literals in semantic source.

[C2] It calls `observegenericpropertythemerefs` exactly once and
`observeretainedtokenstream` exactly once. It authenticates every inherited
field, source/runtime/epoch binding, record count, and seal before accepting a
decision. It never calls the production parser/tokenizer/style parser, an
oracle, host collection/map semantics, or another host semantic engine.

[C3] The integrated replay starts after the admitted node-type token and uses
production precedence. Every property/theme/style transition records
`transitionIndex`, retained token index, `cursorBefore`, and `cursorAfter`.
A style transition is valid only when replay reaches that exact retained token,
its kind/value/start match the authenticated stream, `cursorBefore == i`, and
`cursorAfter == i + 1`. A valid style fact displaced to another identical token
must be rejected.

[C4] Property state, quoted-property order, duplicate diagnostics, theme order,
and limits remain byte-for-byte compatible with M4.166. A property whose bare
value stops at a style token commits before the style transition. Properties
and themes after a style resume normally. An earlier unexpected token makes a
later style unreachable and fails before any later transition.

[C5] Style splitting emits one raw-segment record for every region before,
between, and after depth-zero comma delimiters, including empty/discarded
segments. Each record binds style ordinal/token index, segment ordinal,
untrimmed start/end UTF-16 offsets, trimmed start/end offsets, delimiter offset
or terminal marker, retained/discarded status, and trimmed text. Interpretation
records refer to retained segment records; no delimiter/empty history is lost.

[C6] The scanner is defined over UTF-16 units exactly. A backslash consumes at
most one following unit; a trailing backslash remains ordinary retained text.
Lone surrogate units are ordinary non-syntax content. Quote toggling,
positive/negative parenthesis depth, delimiter choice, and bounds are recorded.

[C7] Each retained pair emits exactly one interpretation record
(`pseudo`, `quoted-key`, `normal`, `ignored`). Each accepted interpretation
emits an ordered write attempt with exact raw/trimmed provenance, key, value,
style/pseudo target, and visible/invisible outcome. Pseudo values are never
unquoted. Normal/quoted-key values use the exact two-pass unescape order.

[C8] The native virtual ordinary-object model never mutates host prototypes.
It reproduces only bootstrap-visible own state. `__proto__` write attempts are
invisible; other string keys are visible. Pseudo name `constructor` produces
no own pseudo map or visible write. Final normal keys, pseudo names, and nested
pseudo keys use the normative array-index-first ordering from V8. Ordered write
attempts remain available even when final state omits or overwrites them.

[C9] The envelope binds format/profile, exact source, runtime instance, parse
epoch, all configured policy limits, inherited M4.166/stream formats and field
counts, every transition/segment/interpretation/write/final-state record, all
counts, first expected predecessor-failure cursor, terminal cursor/kind,
authenticated predecessor and stream chunks, and terminal seal.

[C10] Failure precedence is: invalid/non-positive limits; inherited M4.166 or
stream failure that is not the exact expected style profile; inherited evidence
authentication; integrated profile/reachability; style-token limit; per-block
code-point, UTF-16, byte, or positive-depth limit; segment limit; pair limit;
property/theme/style-write limit selected at the transition where it is first
reached; envelope field/byte limit. Once selected, no later token overwrites the
failure. Violations reject atomically rather than truncating evidence.

[C11] The independent oracle imports no production parser, tokenizer, style,
or prior style-oracle module directly or transitively. Static import-graph
containment enforces this. It derives expected integrated transitions from the
independent retained-stream and property-admission oracles. Bootstrap parity is
a separate path that compares actual visible props/styles/pseudoStyles,
themeRefs, quoted props, and diagnostics.

## Implementation Shape / Source-Size Resolution

[I1] The source-size dependency is resolved by three native files concatenated
into one KERN program by the checker, matching the established predecessor
composition pattern:

- `style-block-helpers.kern` owns bounded UTF-16 splitting, trimming,
  interpretation, unescape, virtual-key classification, and style evidence;
- `generic-property-style-theme-replay.kern` owns the integrated transition
  replay and authenticated property/theme/style state machine;
- `generic-property-style-theme.kern` owns M4.166 authentication, integrated
  entry, cross-block final state, envelope authentication records, and seal.

Each handwritten file remains below 500 lines. The public observer calls only
native helper members; helper output is structurally validated before use.

[I2] The host checker reconstructs state from records, independently validates
all cursor/provenance/count/order invariants, authenticates M4.166 and retained
stream envelopes with their existing verified parsers, compares to the
independent oracle, and only then performs bootstrap parity.

## Planned Files / Blast Radius

| File | Action | Reason |
|---|---|---|
| `examples/kern-frontend/style-block-helpers.kern` | add | bounded nested style grammar and virtual object helpers |
| `examples/kern-frontend/generic-property-style-theme.kern` | add | integrated M4.167 owner and envelope |
| `packages/core/src/mutable-node-type-registry-snapshot.ts` | edit | fused M4.167 source-profile safety entry |
| `packages/core/tests/mutable-node-type-registry-snapshot.test.ts` | edit | fused safety/evidence regression |
| `scripts/check-kern-frontend-generic-property-style-theme.mjs` | add | containment, envelope, oracle, bootstrap checker |
| `scripts/check-kern-frontend-generic-property-style-theme-regressions.mjs` | add | cumulative M4.153-M4.167 receipt |
| `scripts/kern-frontend-generic-property-style-theme/*` | add | policy, fixtures, independent oracle, tests |
| `package.json` | edit | focused M4.167 command |
| `scripts/kern-5-fitness-policy.json` | edit | promoted command and row |
| `scripts/kern-5-fitness.test.mjs` | edit | exact promoted-row expectation |
| canonicalizer receipt/summary files | refresh if required | authenticate touched core/test surfaces |
| `docs/kern-5-release-train.md` | edit | close published M4.166 and record M4.167 |
| `.Codex/goals/KERN-5-COMPLETION-GOAL.md` | edit | durable published/current slice state |

## Binary Acceptance Criteria

- [x] RED-at-base proves `pnpm test:kern-frontend-generic-property-style-theme`
      is absent and fails only for that intended reason.
- [x] Native containment proves one public M4.167 observer, one M4.166 call,
      one retained-stream call, KERN-only handlers, and no host delegation.
- [x] Every inherited M4.166/stream field is authenticated before a decision;
      exact expected `THEME_PROFILE` acceptance is independently replayed to
      the first reachable style cursor.
- [x] Fixtures cover zero/one/multiple styles, property/theme/style ordering,
      bare-property handoff, resume after style, earlier unexpected tokens,
      unclosed styles, and style-like quoted/expression text.
- [x] Fixtures distinguish every split/quote/escape/positive/negative-depth
      branch and preserve all raw segments including empty/discarded segments.
- [x] Fixtures cover pseudo/quoted-key/normal precedence, exact unescape order,
      whitespace, empty values/keys, invalid pairs, first-colon behavior,
      duplicates, Unicode/lone surrogates where the source profile admits them,
      and cross-block last-write state.
- [x] Fixtures prove visible semantics and ordered attempts for `__proto__`,
      `constructor`, `toString`, empty keys, `0`, `01`, `-0`, `4294967294`, and
      `4294967295`, including pseudo-name `constructor` without host mutation.
- [x] Each configurable limit has exact-at-limit success and first-over-limit
      failure; a precedence matrix proves later tokens cannot overwrite the
      first failure.
- [x] The parser rejects truncation, extension, reorder, duplicate/missing
      records, displaced identical style facts, corrupt offsets/counts/limits,
      evidence substitution, source/runtime/epoch drift, corrupt state/seal,
      and over-field/over-byte envelopes.
- [x] Mutations kill: every-comma splitting; ignored escapes/quotes/depth;
      scalar rather than UTF-16 scanning; dropped empty segments; precedence or
      unescape reorder; last-colon parsing; invalid-pair retention; reordered,
      deduplicated, skipped, or first-write style transitions; unsafe-key
      exposure; host style parsing; non-style inspection; cursor displacement;
      predecessor laundering; and first-failure overwrite.
- [x] The oracle import graph is structurally independent and bootstrap parity
      is separate. All three native source files are below 500 lines.
- [x] Focused/cumulative frontend gates, touched-core tests, semantic validation,
      lint/diff hygiene, canonicalizer matrix/coverage, and the complete Node 22
      `pnpm fitness:kern-5` wall pass.
- [x] Automatic post-implementation role review uses live risk routing with
      primary `codex`; all source-verified blockers are fixed and affected
      gates rerun before one signed push.

## Out of Scope

[X1] Unexpected-token diagnostic construction remains the next branch after
style integration. M4.167 only fails closed at an unexpected token.

[X2] Parser hints, keyword handlers, export/pre-populated props, multiline tree
construction, public AST/KIR, frontend cutover, and production routing remain
excluded.

[X3] M4.167 does not repair the bootstrap inherited-key hazard. It models exact
visible parity without reproducing host-global side effects. A production fix
requires a separate red-first compatibility decision.

## Four-Step Execution Plan

1. Prove RED at the untouched M4.166 base; implement the two-file native owner,
   independent oracle, lossless checker, bounded policy, fixtures, mutations,
   and fused safety entry.
2. Run focused and cumulative gates, then red-team every transition, unsafe-key,
   ordering, bound, evidence, and envelope claim with explicit mutations.
3. Run touched-core and semantic gates, the complete promoted KERN 5 wall, and
   automatic risk-routed role review; repair source-verified blockers and rerun
   affected gates.
4. Complete the evidence ledger, rebase once on `origin/main`, commit with the
   required Agon identity/footer, push once to `main`, verify remote SHA, and
   start the next slice from a fresh worktree.

## Challenge and Plan Delta

[T1] Initial confidence was 0.84. The first plan isolated style semantics from
generic-loop reachability and deferred integration to M4.168.

[T2] Full automatic-roster brainstorm `brainstorm-1786123443764-sl0qpg`
completed 6/6. All engines preferred the standalone style semantic owner over a
splitter-only slice, but the useful consensus required exact token/cursor
handoff, UTF-16 behavior, integer-index ordering, total envelope bounds, and a
displaced-fact mutation. Suggestions to retokenize style interiors or reject
bootstrap-accepted keys contradicted source and were discarded. Confidence
rose to 0.91 pending tribunal.

[T3] Three-seat adversarial hybrid tribunal
`tribunal-1786123562512-pyq4ww` completed 3/3 and rejected the written Option A.
Its decisive source-grounded finding was that scanning every retained style
token proves occurrence, not production reachability. It also found that
trimmed-only pair records were not lossless, ordinary-object projection was not
fully normative, failure precedence was incomplete, and oracle independence
was not mechanically enforced.

[T4] The plan changed to the integrated Option B successor. Reachability and
nested semantics are now one state machine; raw-segment evidence, virtual
object ordering, all resource bounds, failure precedence, import-graph
independence, and displaced-fact rejection are normative. The original plan
resolved the <500-line dependency through composed native KERN files with a
validated helper ABI. No dependency remained unresolved. Confidence was 0.92.

[T5] Implementation split the integrated owner into three composed native KERN
files so every handwritten source remains below 500 lines. The complete Node 22
`pnpm fitness:kern-5` wall exited 0 on 2026-08-05, including two 737-test
canonicalizer passes and both full M4.153-M4.167 cumulative frontend receipts.
Automatic high-risk role review `review-1786136262856-9i123s` completed all six
usable seats and found three source-verified blockers: containment covered only
the final observer, replay failures could exceed caller limits, and outer
failure paths bypassed envelope limits. The fixes close the native function
surface, bound every failure constructor, and regression-cover 48-field replay,
41-field outer, and byte-constrained failures. The focused/cumulative gate
passes after repair; targeted correctness review
`review-1786137584529-ycnwnc-m4-167-blocker-fixes` passed 1/1 with zero findings.
Signed publication remains pending. Confidence is 0.99.
