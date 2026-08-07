# KERN 5 Phase 2: generic property-admission shadow v1

**Milestone:** M4.164
**Status:** IMPLEMENTED; VERIFIED; READY FOR SIGNED PUBLICATION
**Date:** 2026-08-07
**Risk:** high, inherited parser evidence plus property-value contract
**Adversarial challenge:** `nero-1786078071432-4gvs9n-m4164-property-admission-challen`
**Confidence:** 0.95

## Executive Summary

[D1] M4.164 adds the internal release-blocking format
`kern.frontend.generic-property-admission-shadow.1`.

[D2] The new native-KERN successor composes M4.163 exactly once and owns one
complete generic `parseProp` unit over an initially empty property state. It
recognizes the immediate post-type `identifier` + adjacent `equals` pair,
consumes exactly one property, projects empty, quoted, expression, and bare
values, tracks whether the value was quoted, and reports exact token-cursor
evidence.

[D3] This is intentionally not the complete generic parser loop. Duplicate
last-write behavior, a second property, style/theme consumption, evolved and
keyword handlers, unexpected-token warnings, full `ParsedLine` construction,
tree construction, AST/KIR, public APIs, and frontend cutover remain deferred.

[D4] The high-risk post-implementation security review found one bootstrap
blocker in the contract M4.164 shadows: authored `__proto__` property keys are
assigned into a normal object. The frozen bootstrap cannot be edited without
invalidating the immutable M4.106-M4.151 compiled-core receipt chain. M4.164
therefore adds a dedicated pre-parse safe-evidence entry in the already
post-M4.145 M4.162 module and rejects adjacent `__proto__=` spellings before
snapshot capture or bootstrap parser entry. Direct bootstrap callers remain
named security debt for a separately authorized compiled-core re-attestation
epoch.

## Current State / Root Cause

[C1] **VERIFIED:** Bootstrap initializes `props` and `quotedProps`, runs evolved
and keyword handlers, and only then enters the generic style/theme/property
loop (`packages/core/src/parser-core.ts:330-385`, read 2026-08-07).

[C2] **VERIFIED:** `parseProp` first calls `isKeyValue`, skips whitespace,
consumes identifier and equals, then selects empty, quoted, expression, or bare
aggregation behavior. Bare aggregation stops before whitespace, style, or
theme-ref token kinds (`packages/core/src/parser-core.ts:185-245`, read
2026-08-07).

[C3] **VERIFIED:** `TokenStream.isKeyValue` skips leading whitespace but
requires the identifier and equals tokens to be adjacent; `skipWS` also means
the whitespace after one property is a valid handoff before a later property
(`packages/core/src/parser-token-stream.ts:28-54`, read 2026-08-07).

[C4] **VERIFIED:** Styles and themes are tokenizer-owned `{...}` and `$name`
tokens. `@mobile` is not a style delimiter; it is an `unknown` token and is
therefore intentionally aggregated into a bare value (`packages/core/src/parser-tokenizer.ts:13-24,178-213,258-264,315-317`,
read 2026-08-07).

[C5] **VERIFIED:** Unclosed expression/string/style diagnostics are emitted by
the tokenizer before `TokenStream` and `parseProp` run
(`packages/core/src/parser-tokenizer.ts:143-175,178-213,215-255`, read
2026-08-07). M4.164 must preserve and authenticate this inherited diagnostic
evidence; it must not invent replacement property diagnostics.

[C6] **VERIFIED:** M4.163 owns only node-type knownness plus the bounded
`UNKNOWN_NODE_TYPE` recognition and explicitly defers properties and successful
parsed nodes (`.Codex/specs/kern-5-p2-frontend-known-node-warning-shadow-v1/spec.md`,
claims D1-D6 and X1-X3).

[C7] **VERIFIED REVIEW FINDING:** `parseProp` accepts every identifier key, but
bootstrap initializes its mutable property accumulator with `{}` and tests
duplicates with `key in props`. For `__proto__`, assignment invokes the legacy
prototype setter instead of creating an own property; inherited names such as
`constructor` are also falsely diagnosed as duplicates
(`packages/core/src/parser-core.ts:193-245,330`, read 2026-08-07; review
`review-1786085480265-hzq69s-m4164-generic-property-admission`).

[C8] **VERIFIED:** `parser-core.js` is part of the exact historically
authenticated M4.145 compiled-core membership. A two-line null-prototype repair
passed focused parser and M4.164 tests but made the complete canonicalizer wall
reject dozens of M4.106-M4.151 receipts. By contrast,
`mutable-node-type-registry-snapshot.js` is explicitly one of the eight
post-M4.145 modules omitted from historical reconstruction
(`scripts/kern-canonicalizer/coverage-dependencies.mjs:17-31,96-122`;
`coverage-integrity.test.mjs:329-385`, verified 2026-08-07).

## What Already Works

[W1] M4.159 already authenticates the full retained token stream and tokenizer
diagnostics. M4.160-M4.163 already authenticate first-token admission,
built-in membership, mutable known-node registries, and warning recognition.
Those formats and implementations remain unchanged.

[W2] The TypeScript `parseProp` helper and public parser remain bootstrap
authority. This slice adds an independent native-KERN shadow and strict host
checker. M4.164's safe fused-evidence entry narrows only this shadow's
single-line bootstrap-parity profile: unsafe `__proto__=` never reaches
`parseProp`. Other accepted keys, value behavior, quoted metadata, diagnostics,
and the public IR object shape remain the authority compared by the shadow.

## Contract (Verified)

> Verified against `packages/core/src/parser-core.ts`,
> `packages/core/src/parser-token-stream.ts`,
> `packages/core/src/parser-tokenizer.ts`, and the M4.159-M4.163 specs/source on
> 2026-08-07.

| Field / Behavior | Type | Evidence | Tag |
| --- | --- | --- | --- |
| predecessor state | `dropped \| known \| unknown \| failure` | `parser-core.ts:283-328`; M4.163 E3-E8 | VERIFIED |
| lookahead | skip whitespace, then adjacent identifier + equals | `parser-token-stream.ts:48-54` | VERIFIED |
| empty value | `''`, not quoted | `parser-core.ts:219-224` | VERIFIED |
| quoted value | normalized token value, quoted | `parser-core.ts:226-232` | VERIFIED |
| expression value | `{ __expr: true, code }`, not quoted | `parser-core.ts:185-189,226-232` | VERIFIED |
| bare value | concatenate token values until whitespace/style/theme-ref | `parser-core.ts:235-245` | VERIFIED |
| bootstrap projection | `IRNode.props` plus `IRNode.__quotedProps` | `parser-core.ts:709-721`; `types.ts:28-40` | VERIFIED |
| adjacent `__proto__=` after admitted type | reject before snapshot capture and parser entry | `mutable-node-type-registry-snapshot.ts`; M4.164 tests | REVIEW FIX |
| direct bootstrap `__proto__=` | excluded security debt pending compiled-core re-attestation | `parser-core.ts:193-245,330` | VERIFIED DEBT |
| tokenizer diagnostics | precede property parsing and remain independently ordered | `parser-core.ts:273-280`; `parser-tokenizer.ts:143-255` | VERIFIED |

## Implementation Options

### Option A — one complete property unit (selected)

[O1] Compose M4.163 once, re-observe the same retained token stream through
the already composed M4.159 observer, and emit one property
decision plus complete chunked M4.163 authentication and a terminal seal.

Benefits: the value taxonomy is complete rather than throwaway; cursor and
boundary mutations are observable; stateful duplicate/map behavior remains a
clean next slice. Cost: one deterministic M4.159 re-observation, including its
already frozen trim and tokenizer behavior.

### Option B — complete `parseProp` including duplicate map state (rejected)

[O2] Duplicate detection depends on a pre-existing props map, diagnostic
emission, last-write semantics, and quoted-metadata deletion. Adding it now
would mix one-unit parsing with stateful loop behavior and broaden the oracle.

### Option C — completed `ParsedLine` (rejected)

[O3] A completed line necessarily absorbs parser hints, keyword handlers,
styles, themes, unexpected-token warnings, locations, and repeated properties.
It is not the smallest independently reviewable successor to M4.163.

## Native and Envelope Contract

[N1] Native KERN calls `observeknownnodewarning` exactly once. The complete
M4.163 envelope is copied into bounded, contiguous authentication chunks and
is accepted by the host only after the existing M4.163 parser authenticates it.

[N2] The successor calls `observeretainedtokenstream` exactly once over the
same original content and exact inherited limits. That observer derives the
retained source and invokes the existing native tokenizer; the successor must
not tokenize original comment/trivia payload. This re-observation is not
accepted as authority by itself: the host compares the property decision to
the independently validated nested M4.159 semantics and the synchronous
bootstrap parse result already bound by M4.162/M4.163 evidence.

[N3] A fixed-width decision record distinguishes:

- `dropped`: inherited first-token non-admission; no property fields;
- `none`: an admitted node whose immediate generic checkpoint is not an
  adjacent identifier/equals candidate;
- `property`: one admitted property with exact key, value class, normalized
  value payload, quoted flag, cursor-before, property-token index,
  equals-token index, value-token index or `none`, cursor-after, and consumed
  value-token count;
- `failure`: atomic propagation of an inherited failure or malformed local
  tokenizer envelope.

[N4] Expression values use an explicit record shape rather than JSON or a
caller-defined serialization: class `expr`, code equal to the normalized token
value, and quoted `false`. Empty/quoted/bare values carry text directly.

[N5] `empty` includes end-of-stream or immediate whitespace after equals.
Style/theme boundaries reached immediately after equals produce a zero-token
`bare` value because that is the existing bootstrap branch, not the earlier
empty branch. The distinction is release-blocking even though both projected
values equal `''`.

[N6] The terminal seal repeats decision state, admitted type/knownness, exact
source, runtime instance, parse epoch, cursor fields, value class, inherited
format, and complete inherited field count. All counts and indices are
canonical bounded unsigned integers or the literal `none`.

## Independent Oracle

[I1] The oracle calls the existing M4.163 independent oracle/parser first. It
then reads tokens only from the fully authenticated nested M4.159 result; it
does not derive expected tokens from the new M4.164 envelope.

[I2] Starting at the authenticated M4.160 `cursorAfter`, the oracle implements
the frozen `isKeyValue` and one-unit value rules from the verified contract.
It compares every decision, index, count, normalized value, inherited field,
and seal field exactly.

[I3] Bootstrap parity uses single-line, unindented, non-export sources whose
admitted node type has no built-in hint, runtime parser hint, or keyword
handler. The differential harness compares the resulting IR node's exact
property value and `__quotedProps` membership, along with all tokenizer and
known-node diagnostics. Handler/hint-bearing types are out of profile rather
than silently treated as generic. Adjacent `__proto__=` is actively rejected
by the safe fused-evidence entry before bootstrap parse; it is not silently
omitted from fixtures or certified as parity.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `.Codex/specs/kern-5-p2-frontend-generic-property-admission-shadow-v1/spec.md` | add | claim-tagged contract |
| `examples/kern-frontend/generic-property-admission.kern` | add | native successor |
| `scripts/check-kern-frontend-generic-property-admission.mjs` | add | strict host parser, execution, parity |
| `scripts/check-kern-frontend-generic-property-admission-regressions.mjs` | add | cumulative frontend receipt |
| `scripts/kern-frontend-generic-property-admission/*` | add | policy, oracle, fixtures, adversarial tests |
| `package.json` | edit | focused command and infra promotion |
| `scripts/kern-5-fitness-policy.json` | edit | gate and ownership rows |
| `scripts/kern-5-fitness.test.mjs` | edit | matrix mutation coverage |
| `docs/kern-5-support-matrix.md` | edit | truthful internal-oracle row |
| `docs/kern-5-release-train.md` | edit | publish M4.163 and record M4.164 |
| `.Codex/goals/KERN-5-COMPLETION-GOAL.md` | edit | baseline and active-slice truth |
| `packages/core/src/mutable-node-type-registry-snapshot.ts` | edit | M4.164-only pre-parse safe-evidence entry |
| `packages/core/tests/mutable-node-type-registry-snapshot.test.ts` | edit | pre-parse rejection and M4.162 non-regression |
| `scripts/kern-canonicalizer/coverage-summary.json` | edit | refresh current compiled-core identity only |
| `scripts/kern-canonicalizer/coverage-prerequisite-summary.json` | edit | refresh current frontier identity only |
| `scripts/kern-canonicalizer/coverage-prerequisite.test.mjs` | edit | pin refreshed current identity |

No frozen parser byte, historical receipt, public package export, serialized
format, or public API changes.

## Acceptance Criteria

- [x] RED-at-base proves the M4.164 source, checker, policy, oracle, fixtures,
  command, fitness rows, and support claim are absent.
- [x] Native source contains exactly one M4.164 member, one M4.163 call, and
  one direct M4.159 retained-stream re-observation; parser entry points, `TokenStream`,
  `parseProp`, host oracle helpers, crypto, capabilities, and callbacks are
  forbidden.
- [x] Differential fixtures cover no-candidate, empty-at-EOF,
  empty-before-whitespace, quoted including quoted-empty and escapes,
  expression including trimmed/nested and unclosed, bare single/multi-token,
  adjacent style/theme zero-token boundary, `@` unknown aggregation, leading
  inter-token whitespace, non-adjacent equals rejection, known/unknown node
  states, inline-comment retention, and a deferred second property.
- [x] Exact parity covers key/value, expression record shape, quoted metadata,
  inherited tokenizer/known-node diagnostics, token indices, cursor handoff,
  consumed-value count, source/runtime/epoch identity, and field counts.
- [x] Inherited failures remain atomic and cover every input-reachable M4.163
  family; malformed outer and inherited envelopes reject truncation,
  duplication, reordering, forged chunk counts/padding, forged state/value/
  quoted/cursor/source/runtime/epoch, and success/failure coercion.
- [x] Named mutations kill constant property/none; key or equals index shifts;
  no whitespace lookahead; whitespace allowed between key and equals; missing
  equals consumption; quoted treated as bare; expression treated as text;
  bare stop-set omission for whitespace/style/theme; unknown `@` treated as a
  boundary; zero/two M4.163 calls; zero/two tokenizer calls; forged inherited
  chunks; and forged terminal seal.
- [x] Policy derives maximum outer fields and runtime/output bounds from the
  inherited maximum and fixed record width; one-above values reject before
  execution.
- [x] The focused M4.164 gate, cumulative M4.153-M4.164 frontend receipt,
  touched-package tests, lint/diff checks, and complete Node 22
  `pnpm fitness:kern-5` wall pass.
- [x] Automatic high-risk role-lens review runs with primary engine `codex`;
  every source-verified blocker is fixed and affected gates rerun before the
  signed single push.
- [x] Bare and expression-valued adjacent `__proto__=` inputs reject before
  snapshot epoch allocation or bootstrap parse; quoted text and inline-comment
  payload containing the same bytes remain safe; the standard M4.162 fused
  entry remains behaviorally unchanged and the unsafe direct-bootstrap path is
  explicitly recorded as debt rather than claimed fixed.

## Out of Scope

[X1] Native-shadow ownership of duplicate-property diagnostics and last-write
metadata, repeated generic loop ownership, property ordering, pre-populated/export props, styles,
pseudo-styles, themes, evolved/runtime parser hints, keyword handlers,
unexpected-token diagnostics, `ParsedLine` locations, successful-node/tree
construction, multiline/indent coordinates, AST/KIR, public parser APIs, and
frontend cutover are excluded.

[X2] M4.164 does not modify `parser-token-stream.ts`, `parser-tokenizer.ts`,
`parser-core.ts`, M4.153-M4.163 formats, or bootstrap authority. Its dedicated
safe-evidence entry rejects one spelling from the M4.164 shadow profile without
changing the standard M4.162 entry or claiming that direct bootstrap is safe.

[X3] M4.165 should own the smallest stateful successor: repeated generic
property loop plus duplicate last-write and quoted-metadata behavior, before
styles/themes or full successful-node construction are considered.

## Open Questions

No implementation ambiguity remains. The handler/hint-free bootstrap profile
and reserved-key rejection are explicit and test-enforced. The direct-bootstrap
security debt is unresolved by design and must be fixed only with a separately
authorized compiled-core re-attestation epoch.

## Deploy Order

[P1] This is an internal additive gate. Source, checker, tests, policy, fitness
rows, support matrix, release train, and goal state ship in one commit. There
is no mixed-version public API window. M4.163 publication is recorded at its
already verified remote SHA before M4.164 is marked complete.

## Challenge and Plan Delta

[T1] The initial 0.89 approach selected one complete property unit and deferred
duplicates/full nodes. An attempted exact-roster tribunal
`tribunal-1786077996771-13a5ux-m4164-next-frontend-seam` did not complete its
selected seats and supplied no consensus, so it is not used as approval.

[T2] Nero `nero-1786078071432-4gvs9n-m4164-property-admission-challen`
challenged style/theme delimiter knowledge, multi-property cursor handoff, and
malformed-expression diagnostics. Source verification rejected the first two
premises: token kinds freeze `{...}`/`$name` boundaries and `isKeyValue`
skips handoff whitespace. The third became a real plan delta: M4.164 explicitly
authenticates inherited tokenizer diagnostics and tests unclosed expressions.

[T3] The final plan also adds one direct native M4.159 re-observation,
complete inherited M4.163 authentication, exact cursor evidence, and a
handler/hint-free bootstrap parity profile. There are no unresolved
dependencies. Confidence increased from 0.89 to 0.93.

[T4] Automatic high-risk role review
`review-1786085480265-hzq69s-m4164-generic-property-admission` verified that
`__proto__` violates the claimed complete bootstrap parity surface. A RED
parser regression proved the finding and the minimal null-prototype repair
passed focused tests, but the full wall proved that `parser-core.js` is frozen
historical evidence. Rewriting the receipt chain was rejected rather than used
to conceal the scope expansion.

[T5] Exact-roster brainstorm
`brainstorm-1786088054796-bduyh3-m4164-frozen-parser-security-sco` completed
6/6 engines. It rejected post-hoc sanitization because `parseProp` has already
lost the own property, rejected historical receipt rewriting, and converged on
pre-parse fail-closed rejection plus explicit debt. Source verification refined
its generic wrapper proposal to a dedicated M4.164 entry in the existing
post-M4.145 M4.162 module, so standard M4.162 behavior and all frozen parser
bytes remain unchanged. Confidence increased from 0.82 to 0.95.

[T6] After the final formatted core build, the live compiled-core and coverage
implementation identities stabilized at
`a7d78fd8e5a110296c64ec59adc39bf238d729413e84a7ab732c4056f63289c5`
and
`6797225e3f409e93fc6bddf2b9fabe5a16268fe6aa63c70ee40c8e5aad401285`.
Only the current coverage and prerequisite summaries plus the current-frontier
test pin changed; both 737-test canonicalizer runs and historical reconstruction
passed. The complete Node 22 KERN 5 wall then passed, including direct 8/8
M4.164 tests, 21 differential fixtures, and both cumulative M4.153-M4.164
receipts. Targeted independent security review
`review-1786097103850-a3dn9x-m4164-security-fix-confirmation` completed 1/1
with zero findings. Confidence increased from 0.95 to 0.99.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| A style boundary might use `@mobile`. | Styles are `{...}` and themes are `$name`; `@` is an ordinary unknown token. | Add a release-blocking `@` bare-aggregation fixture. |
| A trailing whitespace handoff could block a second property. | `isKeyValue` skips leading whitespace. | Preserve exact cursor; defer repeated-loop ownership without claiming it fails. |
| Malformed expressions belong to property diagnostics. | The tokenizer emits `UNCLOSED_EXPR` before property admission. | Authenticate inherited diagnostics; do not invent a new diagnostic. |
| The bootstrap blocker could be repaired in `parser-core.ts` inside M4.164. | That file is byte-authenticated by historical canonicalizer receipts; the attempted fix correctly failed the full wall. | Revert frozen bytes, reject before parse on the M4.164 path, and record direct bootstrap as debt. |
