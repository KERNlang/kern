# KERN 5 Phase 2: generic property-loop shadow v1

**Milestone:** M4.165
**Status:** IMPLEMENTED; FULL WALL PASSED; REVIEWED; READY TO PUBLISH
**Date:** 2026-08-07
**Risk:** high, stateful parser evidence plus frozen-bootstrap safety boundary
**Adversarial challenge:** `nero-1786098129221-m6hl7x`
**Confidence:** 0.99

## Executive Summary

[D1] M4.165 adds the internal release-blocking format
`kern.frontend.generic-property-loop-shadow.1`.

[D2] The native-KERN successor composes M4.164 exactly once, independently
re-observes M4.159 exactly once, and owns the complete repeated generic
property loop for a bounded handler-free source profile. It emits every
property write, exact token cursor movement, duplicate warning evidence,
first-write property order, last-write values, and final quoted-property order.

[D3] The source profile is one unindented, non-export, LF-free line whose
admitted type has no built-in/runtime parser hint or keyword handler, followed
by zero or more generic properties separated by whitespace and then EOF or an
inline comment. Style/theme tokens, unexpected tokens, a property after one of
those boundaries, decorators, exports, and pre-populated properties are
rejected as out of profile rather than partially certified.

[D4] Bootstrap still accumulates properties in `{}` and checks duplicates with
`key in props`. Therefore first writes to inherited names such as `constructor`
and `toString` produce false duplicate warnings, while `__proto__` assignment
does not create the required own property. M4.165 adds a dedicated pre-parse
entry in the already post-M4.145 snapshot module that rejects every adjacent
property key inherited by an empty ordinary object before snapshot capture or
parser entry. M4.164 property semantics and M4.162 behavior remain unchanged;
the shared M4.164 safety helper now recognizes the tokenizer's actual `//`
marker and consumes bare values before considering later key candidates. The direct
bootstrap accumulator repair remains explicit debt for a separately authorized
compiled-core re-attestation epoch.

## Current State / Root Cause

[C1] **VERIFIED:** `parseLine` initializes `props = {}` and
`quotedProps = new Set()`, applies evolved hints and keyword handlers, and then
repeats style, theme, `parseProp`, or unexpected-token handling until the token
stream is exhausted (`packages/core/src/parser-core.ts:330-395`, read
2026-08-07).

[C2] **VERIFIED:** `parseProp` skips handoff whitespace, requires adjacent
identifier/equals tokens, warns when `key in props`, then overwrites the value.
Empty and non-quoted writes delete quote metadata; quoted writes add metadata;
expression writes are not quoted; bare values concatenate until whitespace,
style, or theme (`packages/core/src/parser-core.ts:185-245`, read 2026-08-07).

[C3] **VERIFIED:** A live bootstrap probe of
`screen a="one" b=two a=three c="four" b="five" a="six"` produces property
order `a,b,c`, final values `six,five,four`, quoted order `c,b,a`, and duplicate
warnings at columns 22, 39, and 48. This proves first insertion order,
last-write value semantics, and native `Set` delete/re-add ordering.

[C4] **VERIFIED:** Live probes of first writes `constructor=one` and
`toString=one` create own final properties but emit false `DUPLICATE_PROP`
warnings because inherited names satisfy `key in props`. The already guarded
`__proto__` spelling is more severe because ordinary-object assignment invokes
the legacy prototype setter (`parser-core.ts:193-245`; M4.164 review evidence).

[C5] **VERIFIED:** `parser-core.js` is byte-authenticated by the immutable
M4.106-M4.151 receipt chain. M4.164 already proved that changing this frozen
file invalidates the complete canonicalizer wall, while
`mutable-node-type-registry-snapshot.js` is a post-M4.145 module excluded from
historical reconstruction.

[C6] **VERIFIED:** Native KERN supports indexed array assignment and bounded
loops. Quote-order parity does not require `splice`: each unique property can
retain a boolean quote state and a monotonic quote-add generation. Scanning
generations in ascending order exactly projects final `Set` iteration order.

## Contract

> Verified from `parser-core.ts`, `parser-token-stream.ts`,
> `parser-tokenizer.ts`, and the M4.159-M4.164 contracts on 2026-08-07.

| Behavior | Required M4.165 evidence | Tag |
| --- | --- | --- |
| loop admission | skip whitespace, then adjacent identifier + equals | VERIFIED |
| write order | one record per consumed property in source order | VERIFIED |
| property order | unique keys in first-write order | VERIFIED |
| duplicate rule | every write after the first own write emits one warning | VERIFIED |
| duplicate location | line 1, `parseCol + keyToken.pos`, end plus key length | VERIFIED |
| final values | last write wins; expressions retain explicit expression shape | VERIFIED |
| quoted state | quoted add; empty/expression/bare delete | VERIFIED |
| quoted order | existing add stays in place; delete then add moves to end | VERIFIED |
| terminal boundary | EOF or authenticated inline comment only | DECIDED |
| inherited ordinary-object key | reject before epoch capture/parser entry | SECURITY BOUNDARY |
| direct bootstrap accumulator | excluded debt pending re-attestation epoch | VERIFIED DEBT |

## Selected Design

[S1] The M4.165 member authenticates the complete M4.164 envelope once. For a
known or unknown admitted type it authenticates a second M4.159 retained token
stream and begins at M4.164's cursor-before. M4.164's first decision must equal
the first M4.165 write or the M4.165 no-write state.

[S2] The loop repeats the exact `isKeyValue` and value-consumption rules. Each
write record contains key, value kind, normalized value, quoted flag,
duplicate flag, property/equals/value token indices, cursor before/after,
consumed value-token count, and duplicate diagnostic coordinates or `none`.

[S3] Parallel bounded arrays hold unique keys, value kinds, values, expression
flags, quote states, and quote-add generations. A duplicate linearly locates
the existing unique key and overwrites its final state without changing its
property-order index. This intentionally favors auditable bounded semantics
over an unbounded or host-specific map primitive.

[S4] `quoteGeneration` increments only when a quoted write changes a key from
not quoted to quoted. A quoted write to an already quoted key keeps its prior
generation. Every non-quoted write clears the key's quote state and generation.
Final quoted metadata is emitted by scanning generations from one through the
write count and selecting the matching currently quoted key.

[S5] The fixed header carries decision state, inherited knownness/type,
property-write count, unique-property count, duplicate count, final quoted
count, terminal cursor/kind, source/runtime/epoch identity, both inherited
formats, and full inherited field counts. Fixed-width write, final-property,
duplicate-diagnostic, authentication-chunk, and terminal-seal records follow.
Each final-property record carries its quote-add generation; the strict host
orders currently quoted properties by that authenticated field. All
counts/indices are canonical bounded unsigned integers or the literal `none`
where specified.

[S6] The M4.165 bootstrap helper first invokes the M4.164 source safety check,
then tokenizes the LF-free line and visits every generic property-key position
reachable under the frozen `parseProp` value-consumption rules, stopping at
the authenticated inline-comment boundary. It rejects any candidate whose
identifier token is immediately followed by an equals token and for
which `token.value in EMPTY_PARSER_PROPS` is true, where
`EMPTY_PARSER_PROPS` is a module-local frozen ordinary empty object. This
mirrors the frozen parser's exact first-write inheritance surface without
hardcoding a changeable name list or invoking property getters.

[S7] The guard and fused parse run synchronously. There is no `await`, promise,
timer, dynamic import, capability, caller callback, or diagnostic callback
between safety scan and bootstrap parser entry. Out-of-profile input raises the
safe entry's documented `TypeError` before snapshot epoch allocation; it is
not converted into a bootstrap parser diagnostic.

## Independent Oracle

[I1] The oracle calls the existing M4.164 oracle and M4.159 oracle independently.
It never derives expected tokens or property state from the M4.165 output.

[I2] It implements the verified loop over authenticated M4.159 tokens with an
own-key-safe `Map` and explicit quote-order list. It computes write records,
duplicate locations, first-write property order, last-write values, and final
quoted order independently from the native parallel-array representation.

[I3] Bootstrap parity uses only the declared handler/hint-free profile and the
dedicated M4.165 safe fused-evidence entry. It compares exact final own property
keys/order/values, expression record shape, `__quotedProps` presence/order, all
`DUPLICATE_PROP` diagnostics, inherited tokenizer/known-node diagnostics, and
source/runtime/epoch binding.

[I4] Any style, theme, unexpected token, nonterminal boundary, inherited-name
property, line break, export, handler-bearing type, or hint-bearing type is
rejected before it can be counted as differential parity.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `.Codex/specs/kern-5-p2-frontend-generic-property-loop-shadow-v1/spec.md` | add | claim-tagged contract |
| `examples/kern-frontend/generic-property-loop.kern` | add | native successor |
| `scripts/check-kern-frontend-generic-property-loop.mjs` | add | strict execution/parity checker |
| `scripts/check-kern-frontend-generic-property-loop-regressions.mjs` | add | cumulative frontend receipt |
| `scripts/kern-frontend-generic-property-loop/*` | add | policy, oracle, fixtures, adversarial tests |
| `packages/core/src/mutable-node-type-registry-snapshot.ts` | edit | M4.165-only inherited-key rejection |
| `packages/core/tests/mutable-node-type-registry-snapshot.test.ts` | edit | safety and prior-entry non-regression |
| `package.json` | edit | focused command and infra promotion |
| `scripts/kern-5-fitness-policy.json` | edit | gate and ownership rows |
| `scripts/kern-5-fitness.test.mjs` | edit | policy mutation coverage |
| `docs/kern-5-support-matrix.md` | edit | truthful internal-oracle row |
| `docs/kern-5-release-train.md` | edit | close M4.164 and record M4.165 |
| `.Codex/goals/KERN-5-COMPLETION-GOAL.md` | edit | baseline/current-slice truth |
| current canonicalizer summaries/test pin | edit if digest changes | current identity only |

No frozen parser byte, historical receipt, public package export, serialized
public format, or public API changes.

## Acceptance Criteria

- [x] RED-at-base proves the M4.165 source, checker, policy, oracle, fixtures,
  command, fitness rows, and support claim are absent.
- [x] Native source has exactly one M4.165 member, one M4.164 call, and one
  M4.159 re-observation; parser entry points, host helpers, crypto,
  capabilities, callbacks, maps, sets, and object mutation are forbidden.
- [x] The corpus covers zero, one, two, and six writes; distinct and repeated
  keys; empty/quoted/expression/bare values; whitespace handoff; quoted-empty;
  repeated quoted add; quote-to-bare deletion; delete/re-add reorder; repeated
  empty/expression deletion; unknown admitted type; a dropped line; inherited-
  name text inside a bare value; an astral prefix before a duplicate; EOF and
  inline comment.
- [x] Exact duplicate warning count, order, code, severity, message, line,
  column, and end column match bootstrap for second and later writes.
- [x] Exact property key order, last-write value/value kind, expression shape,
  quote membership/order, per-write cursors/indices/counts, terminal cursor,
  inherited diagnostics, source/runtime/epoch, and field counts match.
- [x] The dedicated M4.165 entry rejects `__proto__`, `constructor`,
  `toString`, and every other inherited ordinary-object key before parse epoch
  allocation, including inherited keys separated by safe properties and
  properties added to `Object.prototype` before the call; ordinary safe keys
  and inherited-name text in quoted/comment payloads remain accepted.
- [x] M4.164 still accepts `constructor=...` with its legacy bootstrap warning,
  still rejects a reachable `__proto__` key, now accepts `__proto__=` text
  consumed inside a safe bare value and the tokenizer's actual `//` comment
  marker, and M4.162 remains unchanged.
- [x] Hostile envelopes reject truncation, duplication, reordering, bad
  padding/counts, forged write/final/quote/diagnostic fields, stale/replayed
  evidence, source/runtime/epoch drift, and success/failure coercion.
- [x] Named mutations kill phase-handoff drift, duplicate constant false,
  last-write failure, stale quote-add generation, expression-as-text, and a
  shifted duplicate coordinate. Composition checks reject omitted/duplicated
  M4.164 membership and host-parser delegation.
- [x] Policy derives maximum record counts, outer fields, and collection bounds
  from inherited limits and configured maximum properties; zero and an
  envelope-overflow value reject before native execution.
- [x] Focused M4.165, cumulative M4.153-M4.165, touched-core tests, lint/diff,
  and the complete Node 22 `pnpm fitness:kern-5` wall pass.
- [x] Automatic high-risk role-lens review uses the live usable roster with
  primary engine `codex`; every source-verified blocker is fixed and affected
  gates rerun before the one signed push.

## Out of Scope

[X1] Styles, pseudo-styles, themes, unexpected-token warnings, properties after
such a boundary, evolved/runtime parser hints, keyword handlers, exported or
otherwise pre-populated props, decorators, multiline/indent locations, full
`ParsedLine`/tree construction, AST/KIR, public APIs, and frontend cutover are
excluded.

[X2] M4.165 does not modify `parser-core.ts`, `parser-token-stream.ts`,
`parser-tokenizer.ts`, prior frontend formats, or bootstrap authority. The
dedicated safe entry narrows only this shadow profile.

[X3] M4.166 should own the next smallest generic-loop successor selected from
style/theme consumption and unexpected-token handling, before handler-bearing
types or full successful-node construction.

## Open Questions

[Q1] No implementation dependency remains unresolved. The chosen terminal
profile and inherited-key guard are explicit and testable.

## Deploy Order

[P1] This is an internal additive gate. Spec, source, checker, tests, policy,
fitness rows, documentation, safety wrapper, and current identity refresh (if
needed) ship in one signed commit and one push. M4.164 is marked complete at
its already verified remote SHA before M4.165 publication is recorded.

## Challenge and Plan Delta

[T1] Initial confidence was 0.84 because property semantics were verified but
the native quote-order representation and loop boundary were unresolved.
Source/conformance inspection selected indexed parallel arrays plus quote-add
generations and narrowed the source profile to EOF/inline-comment termination,
raising confidence to 0.88.

[T2] Nero `nero-1786098129221-m6hl7x` returned a flawed verdict and challenged
string-embedded comment markers, inherited keys separated by other writes,
hard-exception behavior, and prototype freezing between guard and parse.
Source verification rejected its factual premises: comment boundaries are
recognized from tokenizer records rather than raw string search; the guard
scans every identifier/adjacent-equals candidate; pre-parse `TypeError` is the
existing safe-entry contract; and the fused path is synchronous with no caller
callback while freezing `Object.prototype` does not freeze the new `props`
object.

[T3] The challenge still exposed wording and fixture gaps. The plan now says
that every candidate is scanned and adds quoted `#`/`//`, inherited keys
separated by safe properties, pre-call `Object.prototype` additions,
unchanged-epoch rejection, and a no-callback source invariant. No dependency
remains unresolved. Confidence increased from 0.88 to 0.93.

[T4] Implementation hit two direct-runtime constraints that source-shape
preflight alone did not expose: string-to-number conversion and cursor-mutating
nested `while` loops are outside the current internal effect-machine corpus.
Tracing the exact rejected nodes replaced conversions with token-delta integer
accumulation and replaced nested cursor loops with one bounded token-phase
machine. A later provenance failure replaced variable-index final-state reads
with loop-counter scans. Quote order is now encoded by authenticated monotonic
generation fields instead of an unnecessary native reorder loop. These deltas
preserve the parser contract while staying inside the proved portable runtime
subset. The direct 8/8 suite, 18 differential fixtures, cumulative
M4.153-M4.165 receipt, touched-core tests, lint/diff hygiene, and complete
Node 22.22 `pnpm fitness:kern-5` wall pass, including both 737/737
canonicalizer proof runs. Confidence increased from 0.93 to 0.99.

[T5] Automatic high-risk role-lens review
`review-1786108411700-oej70o-m4165-generic-property-loop` completed all six
selected seats with zero consensus-verified findings. Source verification
confirmed three material gaps: the safety scan treated inherited-name text
inside a bare value as a key, the admitted dropped branch emitted cursor one
instead of zero, and scalar offsets diverged from bootstrap UTF-16 diagnostic
columns after astral text. RED regressions drove reachable-key scanning,
dropped cursor repair, and `utf16units` coordinate accumulation; the corpus is
now 18 fixtures. The stale spec header and two checker nits were also fixed.
The alleged corrupt-stream soundness hole is disproved because any invalid
record leaves `streamValid=false` and forces `LOOP_INVALID`; the max-eight
parallel-array scans, independent deep comparison, cumulative receipt
manifest, and colocated fused-evidence guard are intentional bounded proof
machinery. Targeted correctness confirmation
`review-1786110384636-73lp4n-m4165-review-fix-confirmation` completed 1/1 with
zero verified, needs-check, speculative, or blocking findings. Its five nits
are non-material: auth truncation already fails closed, the local `//` proof
is complemented by differential bootstrap parity, the two bounded scans keep
M4.164/M4.165 policy separate, `LOOP_PROFILE` is outside the admitted
differential corpus while real inherited failures cover the failure envelope,
and the prototype-pollution test is serial and restored in `finally`.
Confidence is 0.99.
