# KERN 5 F2 Production Expression Parser

**Status:** READY TO BUILD — TRIBUNAL CORRECTIONS APPLIED

**Date:** 2026-08-16

**Baseline:** `41c49879b7331cbe599621f435971b1949539888`

**Tribunal:**
`/Users/nicolascukas/.agon/runs/tribunal-1786886766811-rijbet-kern5-f2-expression-contract`

**Independent contract review:**
`/Users/nicolascukas/.agon/runs/review-1786898221656-uz93we`

**Scalar-construction amendment:**
`.Codex/specs/kern-5-f2-private-scalar-constructor/spec.md`

**Confidence:** 0.98 after the tribunal corrections, repeated contract review,
and a final review with no verified blockers

## Executive Summary

F1 now owns physical scanning but deliberately treats each `{{ ... }}` body as
opaque text. F2 adds the next production frontend module: a bounded, iterative,
KERN-owned parser for the frozen 16-kind expression catalog, 24 binary
operators, and 6 unary operators. It emits an authenticated private postorder
node tape for F3/F5 consumption; it does not emit canonical KIR or promote the
terminal `test:kern-frontend` gate.

## Current State / Root Cause

- **[VERIFIED]** F0 fixes F2 as an iterative operator/value-stack expression
  parser between physical F1 scanning and F3 line/tree construction. Evidence:
  `.Codex/specs/kern-5-frontend-surface-closure/spec.md:68-82`.
- **[VERIFIED]** The machine authority contains exactly 16 expression kinds,
  24 binary operators, 6 unary operators, and the terminal failure disposition
  `FRONTEND_INVALID_EXPRESSION`. Evidence:
  `scripts/kern-frontend-closure/closure-ledger.json:85-90`.
- **[VERIFIED]** The existing TypeScript parser exposes a much wider `ValueIR`
  surface than F2: templates, regex, undefined, spread, await, type assertions,
  non-null, propagation, and block-bodied lambdas are present in the bootstrap
  parser but absent from the frozen expression catalog. Evidence:
  `packages/core/src/value-ir.ts:24-84` and
  `packages/core/src/kir-structural/expression.ts:7-51,144-210`.
- **[VERIFIED]** The current structural projector parses through TypeScript and
  then rejects values outside the frozen catalog, including bigint, negative
  zero, record spread, typed/block lambdas, typed calls, and unsupported
  constructors. Evidence:
  `packages/core/src/kir-structural/expression.ts:71-141,214-222`.
- **[VERIFIED]** The result catalog is not a source grammar: it includes unary
  `+` and `void`, while the bootstrap `parseUnary` implements neither. Evidence:
  `scripts/kern-frontend-closure/closure-ledger.json:87-89` and
  `packages/core/src/parser-expression.ts:1224-1272`.
- **[VERIFIED]** F1 preserves `{{ ... }}` spans, delimiters, physical newlines,
  nested-pair depth, and quote state but does not parse expression bodies.
  Evidence: `.Codex/specs/kern-5-f1-production-scanner/spec.md:130-176` and
  `examples/kern-frontend/f1-scan-main.kern:103-148`.

The missing ownership is therefore not another scanner or a port of the full
bootstrap parser. It is a closed production parser with a separate authenticated
source grammar, a bounded private interchange, and exact result-schema
coverage. The source authority is
`scripts/kern-frontend-f2-expression/source-form-ledger.json`; the F0 ledger
remains the independent result-kind authority.

Keyword spellings remain positional: standalone `await` and `undefined` reject
before the unlisted-word identifier fallback. After a member separator, they
and `false`, `null`, `none`, `true`, `new`, `typeof`, and `void` are identifier member names;
`instanceof` is an identifier outside binary-operator position. The ledger
states these fallbacks explicitly rather than relying on host reserved words.

## What Already Works

- F1 owns Unicode-scalar source coordinates, malformed-source rejection, and
  exact physical expression spans. F2 must not rescan document-level trivia or
  redefine F1 lexical state.
- The structural expression validator already fixes each catalog kind's field
  shape and rejects unknown kinds/operators. It remains an independent oracle;
  F2 must not import or call it.
- P0/F1 already prove the nine-text-field runtime envelope, chunked scalar
  framing, exact source cap, mutation decoding, and full-cap transport.
- F3 remains responsible for reassembling cross-line F1 expression segments and
  deciding where expressions occur in logical lines. The F2 handler accepts
  one already-extracted expression body; seam tests independently derive such
  bodies from authenticated F1 receipts.

## Contract (Verified and Decided)

> Verified against the cited sources on 2026-08-16. Decisions below define a
> private F2/F3/F5 protocol and do not add a public parser or KIR API.

### Input and ownership

| Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| input | one immutable expression body, excluding outer `{{`/`}}` | F1 preserves delimiters; F3 owns assembly | DECIDED |
| coordinates | Unicode-scalar half-open offsets relative to the body | F1 uses scalar coordinates | DECIDED |
| source grammar | exact authenticated source-form ledger; every unlisted form rejects | F2 source ledger | DECIDED |
| result grammar | exactly the F0 16/24/6 catalog | closure ledger | VERIFIED |
| parser machine | two-state transition table, operator table, and bounded open frames; no source-proportional recursion | F0 delivery architecture and F2 source ledger | DECIDED |
| output | private postorder node tape, not canonical KIR | F5 owns projection | DECIDED |
| failure | atomic empty tape with `FRONTEND_INVALID_EXPRESSION` or a limit/transport failure | closure ledger and P0 atomic shape | DECIDED |

Whitespace inside an expression is non-semantic except inside text literals.
Newlines are admitted as whitespace because F1 may preserve a multiline
expression body. Lone malformed Unicode never reaches F2 through the F1 seam
and fails before tokenization when the standalone handler is exercised.
An empty or whitespace-only body fails `FRONTEND_INVALID_EXPRESSION` over the
complete body span; no zero-node success envelope exists.

The source-form ledger is normative for literals, escapes, keywords,
collections, postfix forms, constructors, lambdas, operator precedence and
associativity, the `expect-value`/`expect-operator` transition states, and open
frame types. “Shunting-yard” is an informative implementation description, not
the contract; the authenticated tables are the contract.

### Closed source forms

F2 admits only source forms that can become the frozen structural catalog:

- ASCII identifiers matching `[A-Za-z_$][A-Za-z0-9_$]*`;
- `null`/`none`, `true`, and `false`;
- canonical unsigned integer and decimal literals; unary `-` represents
  negative values, and unary minus directly over a zero integer/decimal rejects
  even when whitespace or parentheses separate the operator and literal;
- single- or double-quoted text with the ledger's closed escape table,
  deterministic scalar decoding, and rejection of isolated escaped surrogates;
- lists, records without spread or duplicate decoded keys, member access,
  index access, calls, optional member/index/call, and parentheses;
- only `new Map()` and `new Error(expr)` with exact arity;
- untyped expression-bodied lambdas with identifier parameters;
- all 24 frozen binary operators, all 6 frozen unary operators, and ternary
  conditionals with the exact precedence/associativity rows in the source-form
  ledger.

Decoded record-key equality is one Unicode-scalar-sequence domain across every
key spelling, so `0` and `"0"` collide. `__proto__`, `constructor`, and
`prototype` remain valid decoded text keys; duplicate detection and all
intermediate key maps must therefore use `Map` or null-prototype records with
own-key checks, never ordinary object property assignment. Unparenthesized
mixing of `??` with `&&`/`||` rejects; explicit grouping admits it. The ledger's
bounded delimiter prepass resolves `(` as call, lambda parameters, or one
grouped expression and does not add a recursive parser path.

Templates, regex, `undefined`, bigint, spread, await, assignments, type syntax,
non-null assertions, propagation operators, typed calls/lambdas, block lambdas,
unsupported constructors, and any other bootstrap-only form fail closed as
`FRONTEND_INVALID_EXPRESSION`.

At a bare-identifier `=>`, the transition first reduces every pending prefix,
binary, and conditional operator back to the current frame boundary. The
current-frame value segment must then contain exactly one ungrouped identifier
node. Thus `a + b => c`, `!a => b`, `a ? b : c => d`, and `(a + b) => c`
reject at the arrow rather than binding only the immediately preceding value.
A delimiter-prepass-classified lambda-parameters frame instead consumes its
closing `)` and following `=>` as one frame-close action; reduction never
crosses that frame boundary. Either admitted form captures the parameters,
pushes the right-associative lambda operator, and returns to `expect-value` for
the body.

### Private result envelope

The exported handler retains the proven nine-string runtime result:

| Position | Success | Failure |
|---:|---|---|
| 0 | `kern.frontend.f2-expression.1` | same |
| 1 | `parsed` | `failure` |
| 2 | empty | framed `code,startScalar,endScalar` |
| 3 | canonical source-scalar count | same |
| 4 | node count | `0` |
| 5 | chunk count | `0` |
| 6 | maximum guest-list length | `0` |
| 7 | sealed postorder node tape | empty |
| 8 | `root:<nodeId>:<nodes>:<chunks>:closed` | `failure` |

Each node is an eight-field scalar-length-framed record:

```text
node = id,kindId,startScalar,endScalar,flags,subtreeSize,payloadTape,childIdTape
```

The authenticated ledger fixes the byte-independent scalar framing exactly:
field `i` is `f<i>,<length>:<text>`, a node is
`n<nodePayloadLength>:<eightFieldFrames>`, each nested payload/child item is
`i<length>:<text>`, and an empty nested list is empty text. Node frames are
chunked as
`c<ordinal>,<firstNodeId>,<count>,<payloadLength>:<nodeFrames>s<ordinal>`.
All lengths and numeric fields are canonical unsigned decimal text.

The numeric kind/flag/payload/child schema is closed and ordered:

| ID | Kind | Flags | Payload items | Ordered children |
|---:|---|---|---|---|
| 0 | identifier | 0 | identifier name | none |
| 1 | null | 0 | none | none |
| 2 | boolean | 0 | exactly `true` or `false` | none |
| 3 | integer | 0 | canonical source text | none |
| 4 | decimal | 0 | canonical source text | none |
| 5 | text | 0 | decoded scalar text | none |
| 6 | list | 0 | none | items, 0..n |
| 7 | record | 0 | decoded source-order keys, n | aligned values, n |
| 8 | member | 0 or OPTIONAL=1 | member identifier | object |
| 9 | index | 0 or OPTIONAL=1 | none | object, index |
| 10 | call | 0 or OPTIONAL=1 | none | callee, arguments 0..n |
| 11 | new | 0 | exactly `Map` or `Error` | Map: none; Error: argument |
| 12 | lambda | 0 | ordered unique parameters, 0..n | body |
| 13 | binary | 0 | one frozen binary operator | left, right |
| 14 | unary | 0 | one frozen unary operator | operand |
| 15 | conditional | 0 | none | test, consequent, alternate |

OPTIONAL is the sole flag bit; every other bit rejects. For every row not
listing OPTIONAL, flags must be zero. Payload and child cardinalities are exact,
including equal record key/value counts.

Nodes have contiguous IDs `0..N-1`, are emitted in postorder, and the root is
exactly `N-1`. Every child ID is canonical unsigned decimal, strictly less than
its parent ID, referenced exactly once by one parent, and permitted by the kind
schema. Each subtree occupies one contiguous postorder interval and
`subtreeSize` equals one plus the sizes of its children. The decoder rejects
cycles, sharing, forward references, unreachable nodes, unknown flags,
kind/arity disagreement, duplicate record keys, non-canonical numbers, invalid
identifiers/operators, span drift, trailing data, and seal drift.

`payloadTape` and `childIdTape` are themselves scalar-length-framed lists. The
kind schema fixes their interpretation:

- scalar literals/identifier/text: decoded semantic payload, no children;
- list: item children; record: decoded source-order keys aligned with value
  children;
- member/index/call: optional flag plus object/callee and ordered operands;
- `new`: constructor payload plus ordered arguments;
- lambda: ordered parameter payloads plus one body child;
- binary/unary: operator payload plus two/one children;
- conditional: test, consequent, alternate children.

Parentheses affect grouping but do not create a catalog node. Node spans still
cover their complete grouped source extent so the root covers the complete body
after permitted leading/trailing whitespace.

Span derivation is normative and uses Unicode-scalar half-open coordinates.
Leading and trailing body whitespace is excluded, so the root span equals the
complete trimmed body; whitespace between a node's first and last owning token
is included. Each grouping pair expands the contained root to the opening `(`
start and closing `)` end. Atom spans cover their exact source token (text
includes both quotes). List and record spans run from opener through closer;
member/index/call spans run from object or callee start through the final member
identifier or closer; `new` runs from `new` through the constructor closer;
lambda runs from its bare identifier or parameter `(` through body end; binary
runs from left start through right end; unary from operator start through
operand end; conditional from test start through alternate end. The ledger
repeats the exact rule on all 16 kind rows, and mutations must reject first/last
boundary, interior operator/delimiter, and grouping-expansion drift.

Payloads are semantic text, not host numeric values and not source-only range
references. Integers/decimals retain canonical source text; strings and record
keys contain decoded Unicode scalars. This prevents host numeric overflow and
lets F5 consume a valid tape without source access or duplicate escape parsing.
The private tape is deterministic and authenticated but is explicitly not the
canonical KIR serialization; F5 still owns record-key sorting and canonical
value encoding.

Production KERN's ordinary Text operations are substring-closed, so F2 uses the
reserved bounded `KernInternal.textFromScalar` lowering only after it has
independently validated a numeric escape as one non-surrogate Unicode scalar.
The intrinsic performs no parsing or classification; its three-leg contract is
specified separately and does not expand the documented public Text surface.

### Parsing and limits

The production implementation may use a shunting-yard operator stack combined
with explicit delimiter/collection frames. Regardless of implementation, it
must implement the authenticated maximal-munch lexer order, exhaustive
`expect-value`/`expect-operator` transition rows, and all eight frame rules
exactly. Each frame fixes empty/trailing-separator admission, delimiter action,
next state, and EOF span. The global EOF table accepts only one reduced root
with no open frame. No implementation may recurse in proportion to source
nesting or operator count.

Limits and operator tables live in authenticated policy/ledger, not source
literals.
The maximum expression body remains compatible with F1's 65,536-scalar source
ceiling. Token count, node count, nesting depth, framed bytes, chunk geometry,
and runtime scheduler limits are explicit policy fields with equality and
limit-plus-one tests. Internal guest lists remain bounded by the existing
chunk size.

Failure is atomic. The first deterministic token/span failure wins; no partial
node tape or root seal may escape. `FORCED_LATE_FAILURE` exists only in the test
entry point to prove atomicity after all nodes have been constructed.

The closed failure vocabulary is `ILL_FORMED_SOURCE`, `SOURCE_LIMIT`,
`FRONTEND_INVALID_EXPRESSION`, `EXPRESSION_LIMIT`, `TRANSPORT_LIMIT`, and the
test-only `FORCED_LATE_FAILURE`. `EXPRESSION_LIMIT` names the token whose
consumption would exceed the authenticated token, node, nesting, or work
budget; its half-open span is that token, and only an EOF-triggered limit may
use a zero-width EOF span.

Failure precedence is normative and single-pass. Host preflight first applies
`ILL_FORMED_SOURCE`, then `SOURCE_LIMIT`. At each source cursor the bounded walk
checks, in order, lexical validity, delimiter/transition validity, and the work
limit (`EXPRESSION_LIMIT`) that would be crossed by consuming that token. The first failing cursor
wins; ties at that cursor use the listed check order. Parsing stops immediately,
so a later source position can never replace that diagnostic. `TRANSPORT_LIMIT`
is checked only after a complete valid tree, and test-only
`FORCED_LATE_FAILURE` only after successful transport construction. Each
failure carries a Unicode-scalar half-open span; EOF failures point to the
still-open token or frame opener.

### Authority and skew

The production module may call shared F1 transport helpers but may not import or
call `parseExpression`, `projectExpressionText`, structural KIR expression
modules, frontend shadow receipts, TypeScript, generated target parsers, or a
host semantic classifier. Tests may use the bootstrap parser/projector only as
an external oracle after independently authenticating the F2 sources/policy.

F1's expression-boundary rule is now explicit: inside a single/double quote, a
backslash consumes exactly the next raw source scalar for delimiter detection
unless that scalar is CR or LF. LF/CRLF remain independent newline records and
lone CR remains an independent `unknown` record, all without leaving quote or
expression state. Only an unescaped raw matching quote leaves quote state, and
only raw `{{`/`}}` outside quote state changes expression depth. F2 receives the
exact reassembled body and then applies its stricter escape decoder. This is a
record-boundary rule, not the semantic escape result: F2 decodes backslash-LF
(two scalars) and backslash-CRLF (three scalars) to empty exactly as the ledger
states, while backslash-lone-CR is unlisted and rejects. The F1 spec records this
seam addendum, and RED-first regressions correct the terminator/lone-CR gaps
found by review.

The authenticated F1 receipt is not trusted on numeric kind IDs alone. Its
strict decoder independently validates all 15 raw lexical forms and rejects
same-class substitution or ordinary records injected into open composites.
F2 seam tests may therefore consume decoded F1 classifications without taking
the KERN producer's labels on faith.

F2 lands as `internal-oracle`. No live product consumer changes in this slice,
so there is no version-skew window. F3 later consumes the exact authenticated
private format; F5 alone projects it into canonical KIR.

## Implementation Options

### Tribunal outcome and plan delta

The tribunal verdict blocked the original document while agreeing that F2 is
the next phase and that a bounded flat postorder parser is the correct
architectural direction. It caught four contract defects now resolved here:

1. the F0 result-kind catalog was incorrectly treated as a source grammar;
2. the algorithm name carried semantics that belong in authenticated tables;
3. the seven-field tape did not bind subtree topology strongly enough; and
4. the F1/F2 boundary and failure precedence were assertions rather than
   normative contracts.

The amended plan adds a source-form ledger, makes tables and spans normative,
adds contiguous IDs plus `subtreeSize`, records an F1 seam addendum, and narrows
the seam oracle. Independent review then found and reproduced the CRLF seam bug,
plus missing rules for empty bodies, negative zero, key equality, parentheses,
and nullish/logical mixing; these are now explicit. The tribunal's suggestion
to store payload ranges without
semantic payloads was rejected because it would require F5 to regain source
access and duplicate number/string decoding. No technical dependency remains
unresolved before RED-oracle construction.

### Option A — normative table machine with postorder tape (recommended, confidence 0.94)

Implement the authenticated transition/operator/frame tables iteratively and
emit flat postorder records. A shunting-yard stack is the expected technique
but not normative. The tape keeps child references backward-only, supports
one-pass strict decoding, and keeps F5 ownership separate.

### Option B — emit canonical expression values directly (confidence 0.42)

This simplifies parity comparison but violates the frozen phase split by moving
KIR projection and canonical record ordering into F2. Rejected.

### Option C — port recursive descent and serialize afterward (confidence 0.38)

This follows the bootstrap shape but violates F0's iterative requirement and
creates nesting-depth/stack risks at the F1 source ceiling. Rejected.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `.Codex/specs/kern-5-f2-expression-parser/spec.md` | add | durable F2 contract and evidence |
| `scripts/kern-frontend-f2-expression/source-form-ledger.json` | add | authenticated closed source grammar, operator table, transitions, and frames |
| `examples/kern-frontend/f2-expression-*.kern` | add | split handwritten tokenizer, stack parser, catalog, and transport modules below 500 lines |
| `scripts/kern-frontend-f2-expression/policy.json` | add | authenticated grammar tables, limits, flags, and scaling policy |
| `scripts/kern-frontend-f2-expression/decoder.mjs` | add | independent strict envelope/node decoder |
| `scripts/kern-frontend-f2-expression/fixtures.mjs` | add | all kinds/operators, precedence, malformed, and F1-seam corpus |
| `scripts/kern-frontend-f2-expression/mutations.mjs` | add | delegation, tree, span, stack, framing, and atomicity kills |
| `scripts/kern-frontend-f2-expression/worker.mjs` | add | source authentication and real runtime invocation |
| `scripts/kern-frontend-f2-expression/expression.test.mjs` | add | RED/GREEN, differential, limits, fuzz, and scaling oracle |
| `package.json` | edit | add only `test:kern-frontend-f2-expression` |
| fitness policy/tests, support matrix, goal, release train | edit | promote non-terminal F2 evidence while terminal frontend remains planned |

## Acceptance Criteria

- [ ] **[F2-A1]** RED at `41c49879` is the missing
      `test:kern-frontend-f2-expression` script and production F2 assets; all F1
      gates remain green.
- [ ] **[F2-A2]** Authenticated KERN alone emits all 16 kinds, 24 binary
      operators, and 6 unary operators through the strict decoder.
- [ ] **[F2-A3]** Distinguishing fixtures prove precedence and associativity,
      including right-folded `**` and ternary, unary/power restrictions,
      optional postfix chains, nested calls/index/member forms, collection
      frames, and lambda/conditional ambiguity; every source-form ledger row has
      at least one positive or negative witness.
- [ ] **[F2-A4]** Decoded postorder trees match the independent structural
      projector for every overlapping bootstrap source form. F2-only adopted
      forms (including unary `+` and `void`) are independently converted to a
      structural expression value and accepted by `validateExpressionValue`;
      they are not compared through the bootstrap parser. Each root covers the
      complete trimmed body, every node/child/payload span is coherent, and the
      tape determines exactly one structural expression without source access.
- [ ] **[F2-A5]** Every bootstrap-only or malformed form fails with the exact
      first diagnostic under the normative failure ladder and atomic empty
      output; exact limits pass and each limit-plus-one fails before unbounded
      work.
- [ ] **[F2-A6]** Predetermined single- and multi-record expression bodies are
      reconstructed from authenticated F1 receipts by the test oracle, including
      every intervening LF/CRLF record, and match direct-body F2 parsing.
      Discovery, grouping, absolute-span remapping, or assembly of arbitrary F1
      expressions is prohibited here and remains F3 ownership. The executable
      physical-boundary fingerprint lives in
      `scripts/kern-frontend-f1-scan/scan.test.mjs`; the F2 seam test consumes
      that authenticated record shape rather than restating it as prose only.
- [ ] **[F2-A7]** A hashed conformance corpus and frozen deterministic generator
      cover nested expressions, operator chains, collections, decoded text,
      whitespace/newlines, astral spans, surrogate escapes, and terminators in
      strings; repeated runs are byte-identical and the corpus is bound into
      rule coverage.
- [ ] **[F2-A8]** Mutations kill precedence/associativity drift, constant or
      stale output, child reorder/forward/cycle/unreachable references,
      kind/arity/flag/payload/span drift, duplicate keys, permissive decoding,
      prototype-polluting key storage, partial failure, changed module order,
      and TypeScript/host delegation.
- [ ] **[F2-A9]** 1x/2x/4x/8x flat and nested corpora satisfy authenticated
      adjacent and absolute scaling walls without recursion or guest-list
      growth beyond policy. The exact-cap and cap-plus-one families derive from
      measured passes-per-scalar and framed-output budgets, not arbitrary
      nesting constants.
- [ ] **[F2-A10]** F1 scan/transport, runtime envelope, source-runner
      convergence, canonicalizer, checker, formatter, lint, and the complete
      promoted KERN 5 wall remain green.
- [ ] **[F2-A11]** Independent high-risk Agon review has no unresolved verified
      blocker after all findings are checked against the actual tree.
- [ ] **[F2-A12]** `test:kern-frontend-f2-expression` is current and
      `internal-oracle`; `test:kern-frontend` remains absent/planned and all six
      terminal ownership gates remain open.

## Out of Scope

- F3 logical-line assembly, indentation/tree attachment, decorators, raw block
  recognition, and attachment diagnostics.
- F4 declarations/modules, F5 canonical KIR projection, F6 full closure, F7
  terminal promotion, compiler, fixed point, interpreter, cutover, and release.
- Public parser/KIR APIs, generated TypeScript/Python parser parity, templates,
  regex, host closures, type syntax, assignments, or expansion of the frozen
  expression catalog.

## Open Questions

No human product decision or unresolved technical dependency remains. The
tribunal's blocking questions are resolved by the authenticated source-form
ledger, the eight-field topology-bound tape, semantic payloads for source-free
F5 consumption, the explicit F1 raw-boundary rule, and the narrowed seam
criterion. Any later ledger/schema contradiction reopens this section and
blocks implementation.

## Deploy Order

1. Challenge and correct this spec; derive discriminating RED fixtures from the
   resolved acceptance criteria.
2. Land F2 as a private non-terminal gate only after focused, cumulative, full
   fitness, and independent review pass.
3. Start F3 from the landed `origin/main` and consume the exact F1/F2 formats.
4. F5 alone emits canonical KIR; F7 alone exposes the terminal frontend gate.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| F2 should own logical-line stitching after F1. | F0 assigns expression parsing to F2 and logical line/tree ownership to F3. | The next slice is the closed expression parser; no indentation/tree work is included. |
| Porting the bootstrap parser would define F2. | The bootstrap `ValueIR` contains many forms outside the frozen 16-kind catalog. | F2 implements the closed structural subset and fails bootstrap-only forms. |
| The F0 16/24/6 result catalog was also the verified source grammar. | It includes unary `+` and `void`, which the bootstrap parser cannot produce, and says nothing about escapes or source spellings. | A separate authenticated source-form ledger now owns syntax and fail-closed gaps. |
| Naming shunting-yard was enough to fix parser behavior. | An algorithm label does not bind transitions, precedence, frames, spans, or failures. | Authenticated tables are normative; the algorithm name is informative. |
| Seven fields plus child IDs completely bound the tree. | It allowed underspecified sharing/topology invariants. | Contiguous postorder IDs, root-last, single-parent references, and `subtreeSize` bind one tree. |
| F2 could use only source-range payloads. | F5 would need source access and duplicate literal decoding. | F2 emits decoded semantic payloads plus source spans; F5 retains only canonical projection. |
| One bootstrap-projector oracle could cover every admitted F2 form. | The bootstrap parser cannot produce frozen unary `+` or `void`. | Overlapping forms use projector parity; F2-only forms use independent tree conversion plus structural validation. |
| `new` belonged in the six-operator unary precedence row. | It produces the separate `new` result kind with an exact constructor/arity contract. | Unary remains exactly six; constructor parsing is a prefix value form that can receive postfix forms. |
| Backslash always consumed the next raw scalar inside an F1 expression quote. | That rule split backslash-before-CRLF into expression-owned CR plus an LF newline. | Physical LF/CRLF wins; a RED-first F1 seam regression and minimal scanner fix preserve CRLF atomically. |
| Decoded record keys could use any ordinary host map. | `__proto__`, `constructor`, and `prototype` are admitted text keys and ordinary property assignment can alter lookup semantics or prototypes. | The ledger requires `Map` or null-prototype own-key storage and a mutation must kill unsafe duplicate detection. |
