# KERN 5 Phase 2 M4.170: keyword-handler shadow v1

**Status:** SPEC
**Date:** 2026-08-10
**Risk:** high; shared parser semantics, authenticated predecessor evidence, and a new native KERN mode
**Confidence:** 0.91

## Executive summary

M4.170 extends the internal KERN frontend shadow through the complete closed
`KEYWORD_HANDLERS` catalog. A new native KERN member observes one already
stitched and parser-normalized logical line, authenticates M4.169's evolved-hint
decision, applies exactly the selected bootstrap keyword handler's bounded
property writes and cursor decision, masks only the source spans that handler
committed, and runs the existing generic property/style/theme/diagnostic
continuation on that residual source. Because the predecessor generic loop
cannot receive initial handler properties, M4.170 also owns the bounded seeded
duplicate-property projection needed to compose hint, export, handler, and
generic writes in the live order. The strict host checker independently
reconstructs the expected local and composed outcomes and compares them with
the fused bootstrap parse evidence.

This is an internal differential oracle. It does not replace the TypeScript
parser, construct `ParsedLine`/`IRNode`, own physical-line stitching, publish a
frontend API, or promote `kern-frontend` beyond `not-shipped`.

## Goal and non-goals

[G1] **DECIDED:** Own the exact property-delta, token-cursor/rewind, and
post-handler generic-loop semantics of every current keyword-handler catalog
entry. The catalog is the 26 entries at
`packages/core/src/parser-keywords.ts:398-741` (read 2026-08-10).

[G2] **DECIDED:** Keep the bootstrap parser authoritative. M4.170 is a native
KERN shadow checked against fused bootstrap evidence; it changes no public
parser behavior or package export.

[G3] **OUT OF SCOPE:** Physical-line collection, quote/expression stitching,
indentation/tree construction, post-tree function/import canonicalization,
schema/semantic validation, KIR emission, public frontend APIs, cutover, and
the KERN 5 completion claim.

## Current state and root cause

[C1] **VERIFIED:** `parseLine` strips inline comments, tokenizes one logical
line, admits the node type, applies evolved hints, invokes at most one selected
keyword handler, and only then runs the generic property/style/theme loop
(`packages/core/src/parser-core.ts:250-413`, read 2026-08-10).

[C2] **VERIFIED:** The handler receives only `(TokenStream, props, content)`.
There is no runtime, registry, capability, callback, or global-state argument
(`packages/core/src/parser-keywords.ts:1-5`, read 2026-08-10).

[C3] **VERIFIED:** `TokenStream` owns one linear token array and numeric cursor.
Its only rewind surface is `setPosition`; `remainingRaw` consumes the remainder,
and `consumeAnyValue` consumes one non-whitespace token
(`packages/core/src/parser-token-stream.ts:4-85`, read 2026-08-10).

[C4] **VERIFIED:** M4.169 already authenticates the original retained stream,
the evolved-hint writes, the hint-masked stream, and the complete M4.168
predecessor envelope. Its host parser reconstructs final properties and
diagnostics (`scripts/kern-frontend-evolved-hints/envelope.mjs:1-169` and
`examples/kern-frontend/evolved-hints.kern:1-321`, read 2026-08-10).

[C5] **VERIFIED:** The remaining unowned line-parser seam is the handler catalog
between evolved hints and the generic loop. M4.169 deliberately calls M4.168
on a hint-masked line without keyword-handler semantics; no M4.170 source,
checker, gate, or support claim exists at this baseline (`package.json:64-86`;
repository search for `M4.170`, read 2026-08-10).

[C6] **VERIFIED:** `parseLines` performs physical-line collection and multiline
quote/expression stitching before `parseLine` (`packages/core/src/parser-core.ts:552-704`,
read 2026-08-10). Therefore newline-containing fixtures may test already
stitched logical input, but M4.170 cannot claim stitching ownership.

[C7] **VERIFIED:** `toNode` copies `ParsedLine.props`, while later passes consume
and delete the hidden `__firstClassSyntax`, `__firstClassImport`, and
`__firstClassBindings` markers (`packages/core/src/parser-core.ts:709-721,759-829`,
read 2026-08-10). M4.170 must preserve these handler writes but does not own the
later canonicalization passes.

[C8] **VERIFIED:** M4.169's host envelope merges hint writes only after parsing
its generic predecessor. It therefore cannot by itself reproduce a bootstrap
`DUPLICATE_PROP` emitted when a generic property collides with an existing hint
or handler property (`scripts/kern-frontend-evolved-hints/envelope.mjs:72-88`;
`packages/core/src/parser-core.ts:193-245`, read 2026-08-10). M4.170 must bind
the seeded collision projection explicitly rather than treating M4.169's final
`props` object as a complete continuation contract.

[C9] **VERIFIED:** The live handler sees `contentForParse`, after inline-comment
removal and optional `export ` prefix removal; `props.export=true` is seeded
before hints and handler dispatch (`packages/core/src/parser-core.ts:258-265,330-361`,
read 2026-08-10). The M4.170 entry contract therefore receives normalized
logical content plus an authenticated `exported` seed instead of silently
parsing the physical raw line under a different phase order.

## Closed handler contract

The independent oracle and native member must cover every row below. A handler
outcome consists of ordered property writes, the terminal stream cursor, and
whether the generic loop subsequently overwrites or augments those writes.

| Family | Catalog entries | Required behavior | Evidence |
| --- | --- | --- | --- |
| first-class declarations | `fn`, `let` | balanced signature/assignment parsing; full rewind on invalid or legacy fallback; hidden first-class markers | `parser-keywords.ts:292-330,398-440` VERIFIED |
| raw expression/control | `return`, `throw`, `do`, `if`, `while` | if the tail is nonempty and not key/value, consume the exact remaining raw source into `value` or `cond`; otherwise leave it to the generic loop | `parser-keywords.ts:442-485` VERIFIED |
| documentation/name shorthand | `doc`, `theme`, `derive`, `guard`, `effect`, `strategy`, `trigger`, `rule` | exact single-token/bare-identifier guards, including doc rewind to the complete raw tail | `parser-keywords.ts:7-13,487-517,644-673,699-706` VERIFIED |
| imports/islands/routes | `import`, `island`, `route` | first-class and legacy fallbacks, hidden import metadata, island kind/name cases, HTTP verb normalization, slash-path consumption, invalid-verb rewind | `parser-keywords.ts:332-396,519-599` VERIFIED |
| structured metadata | `params`, `auth`, `validate`, `error`, `respond`, `expect`, `message`, `middleware` | exact arrays/list parsing, number/quoted-token handling, expect allowlist/rewind, quoted template, and comma-list middleware behavior | `parser-keywords.ts:15-78,601-642,675-697,708-741` VERIFIED |

[H1] **DECIDED:** The catalog is atomic for the support claim. Per-family KERN
modules are an implementation split only; no partial catalog may be reported as
M4.170 complete.

[H2] **DECIDED:** Exactly one selected handler runs for one admitted type, then
the generic loop continues from the handler's terminal cursor. Tests assert the
handler-local outcome and the composed final state separately so rewind/fallback
bugs cannot hide behind generic-loop parity.

[H3] **DECIDED:** Property deltas use the real `ParsedLine.props` value shapes,
including booleans, numbers, strings, parameter-item records, binding records,
and hidden first-class markers. A temporary string-only or mock schema is not
acceptable.

[H4] **DECIDED:** Source masking is evidence transport, not semantics. It must
preserve UTF-16 width and every unconsumed token's original location while
preventing the predecessor from re-consuming handler-owned spans.

[H5] **DECIDED:** Rewind outcomes authenticate both the probe cursor and the
restored cursor. The composed predecessor must receive source equivalent to the
restored stream, not a probe-consumed tail.

[H6] **DECIDED:** The composed continuation is seeded in live order with the
optional export write, ordered hint writes, and ordered handler writes. A first
generic write to an already present key emits `DUPLICATE_PROP` before applying
last-write-wins; later generic duplicates keep the predecessor's existing
ordering. The final diagnostic stream is ordered by generic-loop encounter, not
by diagnostic category.

[H7] **DECIDED:** Handler strings do not create `quotedProps`; only generic
key/value parsing does. Numeric `error`/`respond` cases preserve current
`parseInt(text, 10)` behavior for every tokenizer number spelling in profile.

[H8] **DECIDED:** Dynamic trailing keys accepted by `fn`/foreign `import`,
including `__proto__`, `constructor`, and inherited ordinary-object names, are
explicit parity fixtures. The shadow neither widens nor silently sanitizes this
bootstrap surface; any security-policy change requires a separate parser change.

## Oracle independence and safety boundary

[O1] **DECIDED:** The oracle may use raw logical source, authenticated M4.169
records, the independently normalized `contentForParse`/export seed, static
policy, and the fused bootstrap `parseResult` only for final
differential comparison. It must not import or invoke `KEYWORD_HANDLERS`,
`TokenStream`, `tokenizeLineInternal`, `parseLine`, `parseDocument`, parser
helpers, or the M4.170 native implementation.

[O2] **DECIDED:** Fixture expectations are independently authored from the
verified source contract and committed as explicit expected deltas/cursors.
They must not be generated by running the bootstrap handler catalog.

[O3] **DECIDED:** The native source validator forbids parser/tokenizer imports,
host parser/oracle delegation, capabilities, crypto/digest substitutes, dynamic
catalogs, and undeclared exported functions. Every KERN handler remains
`lang="kern"` and each handwritten source file stays below 500 lines.

[O4] **DECIDED:** The result envelope uses a new versioned format with bounded
header, ordered typed property-write records, authenticated M4.169 and retained
stream chunks, one terminal seal, and a closed compact failure-code set. Policy
owns every field/byte/write/depth ceiling; no operational limit is hardcoded in
the source.

[O5] **DECIDED:** The cumulative M4.153-M4.169 regression wall remains mandatory.
This is required because a shared predecessor bug could otherwise produce equal
but wrong M4.170 and bootstrap projections.

[O6] **DECIDED:** The M4.170 envelope separately authenticates (a) the complete
M4.169 upstream decision, (b) the hint-and-handler-masked retained stream,
(c) the M4.168 generic continuation over that stream, and (d) seeded duplicate
events. The checker rejects omission, replay, reordering, or substitution of
any layer.

## Implementation design

### Selected design

1. Add independently authored fixtures and an oracle that normalize raw source
   into the expected selected-handler delta, terminal cursor, rewind decision,
   consumed spans, and composed final properties/diagnostics.
2. Add native KERN helper/family modules under 500 lines. The exported owner
   authenticates M4.169, selects one of the closed 26 handler names against the
   hint-masked stream, applies that family's semantics, masks only committed
   handler consumption, invokes the M4.168 generic continuation once, projects
   seeded duplicates, and emits the bounded sealed envelope.
3. Add a strict checker/parser that validates source containment, executes the
   public runtime-handler ABI, reconstructs the typed delta, authenticates every
   predecessor field, and compares both local and composed outcomes.
4. Add mutation, fallback/rewind, Unicode, multiline-logical-input, bounds,
   replay/identity, delegation, and full-catalog tests plus a cumulative receipt.
5. Wire a focused package script, fitness policy/fixtures, current goal status,
   and support matrix while retaining `kern-frontend: not-shipped`.

### Rejected alternatives

| Alternative | Confidence | Decision |
| --- | ---: | --- |
| own physical multiline stitching first | 0.34 | rejected; stitching is an upstream dependency already consumed before `parseLine` |
| construct `ParsedLine`/`IRNode` now | 0.48 | rejected; combines keyword semantics with indentation/tree/canonicalization contracts |
| ship one handler family as the M4.170 claim | 0.62 | rejected; leaves a mixed catalog seam and weakens the next composition boundary |
| call bootstrap handlers to generate expected fixtures | 0.18 | rejected; circular oracle cannot detect shared implementation drift |

## Blast radius

Expected additions or narrow updates:

- `.Codex/specs/kern-5-p2-frontend-keyword-handlers-v1/spec.md`
- `examples/kern-frontend/keyword-handlers*.kern` split by helper/family surface
- `scripts/check-kern-frontend-keyword-handlers.mjs`
- `scripts/check-kern-frontend-keyword-handlers-regressions.mjs`
- `scripts/kern-frontend-keyword-handlers/{policy,oracle,fixtures,envelope,*.test}.mjs|json`
- `package.json` focused and cumulative gate wiring
- KERN 5 fitness/support policy and matching assertions/fixtures
- `.Codex/goals/KERN-5-COMPLETION-GOAL.md` current-slice receipt

[B1] **DECIDED:** No edit is expected in `packages/core/src/parser-core.ts`,
`parser-keywords.ts`, `parser-token-stream.ts`, public barrels, package version,
runtime ABI, KIR schema, or generated code.

[B2] **DECIDED:** The already oversized bootstrap parser files are evidence only;
M4.170 adds no handwritten lines to them.

## RED-first proof

[R1] Add the complete independently authored fixture/oracle contract before the
native owner. The base revision must fail semantically because M4.169 lacks the
selected keyword-handler delta for a positive handler case, not merely because
a future file or npm script is absent.

[R2] The RED witness must include at least one committing handler and one rewind
case, and must compare the handler-local outcome separately from the final
generic-loop result.

[R3] **VERIFIED RED (2026-08-10):**
`pnpm test:kern-frontend-keyword-handlers` built `@kernlang/core`, passed the
closed 26-entry catalog assertion, and failed the committing route fixture at
`keyword-handlers.test.mjs:23`: M4.169 returned handler props `{}` instead of
the independently authored `{ method: "get", path: "/users" }`. This is the
intended semantic boundary failure, not a missing file/script failure. An
initial setup-only `tsc: command not found` result was discarded; the recorded
RED was rerun after `pnpm install --offline --frozen-lockfile` succeeded.

## Acceptance criteria

- [x] All 26 catalog entries have positive, fallback/guard, and composition
      evidence appropriate to their contract; every catalog name is enumerated
      exactly once by both policy and tests.
- [x] First-class `fn`, `let`, and `import` fixtures cover nested delimiters,
      quoted/escaped content, generics, trailing props, invalid syntax, legacy
      fallback, and hidden marker shapes.
- [x] `params` covers documented array items and bare comma lists with nested
      comma-bearing defaults, malformed/skipped items, and exact record shapes.
- [x] Raw-tail handlers, doc, route, island, error/respond, expect, message, and
      middleware cover commit, no-op, and rewind/continuation semantics.
- [x] Handler-local writes/cursor/consumed spans and composed final
      props/styles/pseudoStyles/themeRefs/diagnostics match independent expected
      values and fused bootstrap evidence.
- [x] Hint→handler→generic phase order is mutation-killed, including runtime
      hints that consume an otherwise handler-significant token and generic
      properties that collide with export, hint, or handler seed writes.
- [x] Newline-containing already-stitched logical fixtures pass without claiming
      ownership of `parseLines` stitching.
- [x] UTF-16/astral width, quote escapes, nested delimiter depth, output bounds,
      field/write limits, stale epoch, replay, forged predecessor/seal, and
      source-containment mutations fail closed.
- [x] Numeric fixtures cover decimal, fractional, separator, hex/bin, bigint,
      leading-dot, and invalid spellings admitted by the tokenizer; handler
      strings never fabricate generic `quotedProps` evidence.
- [x] Dynamic fn/import trailing keys cover `__proto__`, `constructor`, and an
      inherited ordinary-object name with exact bootstrap parity.
- [x] Source validation proves no bootstrap handler/parser/tokenizer/oracle
      delegation, exactly one selected native handler path, exactly one M4.169
      predecessor invocation, and files below 500 lines.
- [x] `pnpm test:kern-frontend-keyword-handlers` passes.
- [x] The complete M4.153-M4.170 frontend regression receipt, relevant package
      typecheck/tests/build, `pnpm test:kern-5-fitness`, and `git diff --check`
      pass.
- [x] Independent post-implementation review runs through
      `agon review <target> --risk auto --primary-engine codex --roles auto`;
      every finding is verified against current source and genuine blockers are
      fixed with targeted regression tests.
- [ ] One Agon-signed KERN commit is pushed once after all local gates pass; the
      resulting PR is handed off without pushing to `main`.
- [x] `kern-frontend-keyword-handlers-shadow: internal-oracle` is added only
      after the gates pass; `kern-frontend` remains `not-shipped`.

## Dependencies and unresolved questions

[D1] **VERIFIED:** M4.169 is merged at `origin/main` commit
`5841f4e11a77177a7178d13377ddb94af25d84a3`; this worktree starts exactly there.

[D2] **RESOLVED:** The output is the real bounded property-delta contract, not a
temporary mock. This resolves the first Nero schema objection.

[D3] **RESOLVED:** Direct handler outcome and composed post-loop output are
separate assertions. This resolves the Nero handler/generic-loop ambiguity.

[D4] **RESOLVED:** Handler context is local and `TokenStream` rewind is linear;
source inspection falsified the proposed global-state and nonlinear-rewind risks.

[D5] **RESOLVED:** M4.169 is authenticated upstream evidence but is not reused
as the final seeded continuation. M4.170 invokes the generic continuation on
the post-handler residual stream and separately owns seed-collision events.

[D6] **OPEN:** The exact native file-family split may change during the RED and
line-count pass, but it may not change the atomic catalog or public claim.

No OPEN item feeds fixture expectations or oracle truth.

## Deployment and rollback

1. Commit the spec and semantic RED evidence locally.
2. Implement family modules and the sealed checker contract.
3. Run the focused gate, cumulative frontend receipt, fitness, typecheck/tests,
   build, and independent role-lens review.
4. Commit granularly with the required Agon authorship/footer, then perform one
   feature-branch push and publish the PR link.

Rollback is deletion/reversion of the isolated M4.170 files and narrow policy
wiring. Production parser behavior and public APIs remain unchanged throughout.

## Corrections log

- The tribunal selected complete keyword-handler semantics over multiline-first
  and construction-first proposals; the latter alternatives invert dependencies
  or combine unproved downstream contracts.
- Nero pass one correctly identified circular-oracle risk. It also proposed
  output-schema, multiline-rewind, and shared-state collisions that current
  source inspection did not support.
- Nero pass two prompted explicit separation of direct handler outcome from
  composed generic-loop state. Its global-side-effect and nonlinear-rewind
  premises were falsified by the closed handler signature and linear
  `TokenStream` implementation.
- The revised plan forbids bootstrap-derived fixture generation, authenticates
  the full predecessor chain, and keeps already-stitched multiline inputs as
  fixtures without claiming the upstream stitching phase.
- The final contract trace found that M4.169 post-merges hint writes and cannot
  express generic collisions against hint/handler seeds. The design now carries
  a normalized export seed, authenticates M4.169 separately, reruns the generic
  continuation on the post-handler residual stream, and binds seeded duplicate
  events explicitly.
