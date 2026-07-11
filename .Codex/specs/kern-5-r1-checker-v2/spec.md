# KERN 5 R1.2 Checker v2 Closure

**Status:** COMPLETE
**Date:** 2026-07-11
**Confidence:** 0.98
**Depends on:** R1.1 branch head `3dbcbc30301a33679b6cc37ad7da0e3584972629`
**Primary tribunal:** `tribunal-1783782212177-8i6tsj-kern5-r1-checker-v2`
**MiniMax/GLM red-team:** `tribunal-1783782490835-om2w4w-kern5-r1-checker-v2-secondary`

## Executive Summary

R1.2 closes the existing self-hosted checker subset over the real handwritten
assertion, validator, and checker modules. It adds the already-supported KERN
`while`/`else` surface, preserves enough structural identity in the flattened
rows to reject malformed `else`, retains binary operand kinds so invalid while
comparisons fail closed, and replaces the five-literal numeric whitelist with a
KERN-executable canonical decimal safe-integer predicate.

The checker remains a release-blocking shadow oracle. TypeScript remains the
authoritative production checker, KIR and formatter work remain out of scope,
and the 4.5 runtime iteration ceiling remains the dynamic nontermination
failsafe.

## Current State / Root Cause

- [VERIFIED] The v1 KERN checker accepts only `-1,0,1,2,3` in
  `isSafeIntText` and does not admit `while` or `else`
  (`examples/capstone-checker-subset/checker.kern:9-48`).
- [VERIFIED] The real self-host validator uses `while` at line 275 and a nested
  `else` at line 283 (`examples/selfhost-validator/validator.kern:268-291`).
- [VERIFIED] Running the current TS reference over the real validator on
  2026-07-11 returned exactly two rejects:
  `unsupported_while` at 275:5 and `unsupported_else` at 283:11; its `main.kern`
  was accepted.
- [VERIFIED] The parser accepts valid sibling `if`/`else`, orphan `else`, a
  duplicate second `else`, and `else` following `while` with no parse diagnostic
  (`parseDocumentWithDiagnostics` four-case probe on 2026-07-11). The checker
  must therefore reject malformed pairing itself.
- [VERIFIED] `flattenKernSource` traverses preorder and records statement kind,
  function, location, and expression summaries, but not parent identity
  (`scripts/capstone-checker-subset/flatten-kern.mjs:4-117`). A flat row cannot
  distinguish a preceding descendant from the immediately preceding sibling.
- [VERIFIED] KERN can implement the decimal bound without a host binding:
  `Text.length` and `Text.charAt` are portable code-point operations
  (`packages/core/src/codegen/text-contract.ts:1-43`), and ordered comparison
  accepts same-typed strings (`packages/core/src/ir/semantics/portable-scalar.ts:1466-1497`).
  The existing safe-int helper fixture already executes a lexical comparison
  with `"9007199254740991"`
  (`scripts/capstone-checker-subset/fixtures.mjs:65-84`).
- [VERIFIED] Runtime `while` requires a strict boolean condition and caps
  execution at 100,000 iterations
  (`packages/core/src/ir/semantics/while.ts:1-26,43-82`).

## What Already Works

- The v1 three-leg pattern is sound: host flattening carries structural facts,
  the TypeScript reference and KERN checker consume identical rows, output is
  byte-compared, reject-fixture polarity is checked, and every accepted runnable
  fixture is executed (`scripts/check-capstone-checker-subset.mjs:1-100`).
- The assertion engine's four handwritten modules are already accepted, and its
  main module is executed (`scripts/capstone-checker-subset/fixtures.mjs:27-48`).
- The KERN checker itself is already executed because generated `main.kern`
  imports `checker.kern` and calls `checkModule` for every fixture
  (`scripts/capstone-checker-subset/gen-fixtures-kern.mjs:12-39`).
- Production `kern check`, KIR, parser grammar, code generation, and runtime
  `while` semantics need no change.

## Contract (Verified and Frozen)

> Verified against the files and probes cited below on 2026-07-11.

| Field / Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Flattened parent | `stmtParent[i]` is the zero-based parent statement row or `-1`; preorder and every existing array remain unchanged | `flatten-kern.mjs:60-117`; four-case parser probe | VERIFIED |
| While operand shape | Binary summaries retain operand kind/token/member receiver shape and parameter types; dynamic ordered comparisons require a prior safe-integer induction binding and a proven string/array `.length` receiver | final reviews reproduced `[] == []`, `xs == xs`, late declarations, and `missing.length`; portable scalar comparison contract | VERIFIED design decision |
| `else` attachment | An `else` row is valid only when its immediately preceding sibling under the same parent is `if`; orphan, duplicate, and after-`while` reject | parser probe; runtime pairs body `else` only with `if` | VERIFIED design decision |
| `while` surface | `while` is admitted only with a non-empty body and a syntactically boolean condition summary; numeric/string/array/identifier conditions and literal `true` reject | `while.ts:1-26`; release train R1 exit | VERIFIED design decision |
| Dynamic loop safety | The checker does not attempt general or path-sensitive termination proof. Directional step checks reject cheap known-bad mutations but do not prove a nested step executes; accepted runnable fixtures remain bounded by the existing 100,000-iteration runtime ceiling | `while.ts:43-82`; final review disposition | VERIFIED |
| Integer text | Canonical base-10 integers only: `0` or optional `-` plus digits; no `+`, leading zero, `-0`, decimal, exponent, whitespace, `NaN`, or `Infinity` | release train and handoff numeric ledger; tribunal decision | VERIFIED design decision |
| Integer bound | Magnitude must be lexically at most `9007199254740991` after equal-length digit validation; both signed boundaries accept and one-step overflow rejects | JS safe-integer substrate used by current runner; pure-KERN text primitives above | VERIFIED design decision |
| Required modules | Assertion `diag/sort/compare/main`, validator `validator/main`, and checker `checker` plus generated executable `main` must be covered without stubs | handoff lines 15-21, 37-43; release train R1 binary exit | VERIFIED |
| Authority | KERN checker is CI/release shadow only; TS reference remains authoritative and any byte drift fails | current capstone harness; release train R1 rollback | VERIFIED |
| Verdicts | Every fixture is binary accept or reject; no abstain result exists. Every reject fixture must produce at least one reject and every accepted runnable fixture must execute cleanly | `check-capstone-checker-subset.mjs:31-100` | VERIFIED |

### Structural `else` algorithm

For an `else` row `i`, scan earlier rows and retain the latest row whose
`stmtParent` equals `stmtParent[i]`. It must exist and have kind `if`. A previous
`else` is `duplicate_else`; no previous sibling is `orphan_else`; any other kind
is `invalid_predecessor`. The `else` must also have at least one direct child.
Nested descendants cannot masquerade as siblings because their parent row
differs.

### Syntactically boolean `while` boundary

The v2 checker accepts the real validator's comparison-root condition and
literal `false`. Comparison binary operators are boolean by construction.
Logical `&&`/`||` are rejected because KERN returns an operand rather than
coercing to boolean, and unary `!` is rejected because the flattened summary
does not preserve its operand or prove boundedness. Literal `true`, numeric,
string, array, bare identifier, parse-error, and every other root reject. This
is deliberately conservative and does not claim full type inference.

### Canonical safe-integer algorithm

`isSafeIntText` executes in KERN: validate sign, digit count, leading zero, and
every digit with `Text.length`/`Text.charAt`; lengths below 16 accept, lengths
above 16 reject, and 16-digit magnitudes compare lexically to the fixed protocol
bound. The TS reference mirrors the algorithm. A dedicated numeric probe invokes
the exported KERN predicate directly so parser rejection cannot falsely stand in
for predicate coverage.

## Implementation Plan

There is one viable option: evolve the existing t10 capstone contract in place.
A TypeScript host binding would defeat the self-hosting purpose, while grammar,
KIR, or production-checker changes would expand beyond R1.2.

1. Add RED fixtures for validator/checker self-acceptance, malformed `else`,
   unsafe `while`, and the complete numeric boundary table; prove base failure
   for the intended reasons.
2. Add `stmtParent` to the flat schema/generator and mirror structural
   `else`/`while` verdicts in the TS reference and KERN checker.
3. Replace the numeric whitelist in both references with the canonical decimal
   algorithm and run a direct KERN predicate probe.
4. Regenerate the checked-in KERN fixture main; run checker, validator,
   assertion, native KERN, conformance, fitness, and `@kernlang/check`
   acceptance walls.
5. Run full-roster Agon review, fix verified findings, promote checker-v2
   ownership to `internal-oracle`, close R1.2 evidence, commit, and push once.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `scripts/capstone-checker-subset/flatten-kern.mjs` | modify | preserve parent row identity |
| `scripts/capstone-checker-subset/reference.mjs` | modify | TS v2 structural/numeric mirror |
| `scripts/capstone-checker-subset/fixtures.mjs` | modify | real-module and adversarial corpus |
| `scripts/capstone-checker-subset/gen-fixtures-kern.mjs` | modify if needed | generate direct numeric probe inputs |
| `scripts/check-capstone-checker-subset.mjs` | modify | direct KERN numeric predicate oracle and stronger counters |
| `examples/capstone-checker-subset/checker.kern` | modify | KERN checker v2 implementation |
| `examples/capstone-checker-subset/checker-while.kern` | add | extracted numeric, structural, and while proof helpers below 500 lines |
| `examples/capstone-checker-subset/main.kern` | regenerate | checked-in executable fixture payload |
| `scripts/kern-5-fitness-policy.json` | modify at closeout | promote checker-v2 ownership only |
| `docs/kern-5-support-matrix.md` | modify at closeout | exact policy mirror |
| `docs/kern-5-release-train.md` | modify at closeout | mark R1.2 complete |
| `.Codex/specs/kern-5-r1-checker-v2/spec.md` | add/update | frozen contract and evidence |

No handwritten source is expected to cross 500 lines; generated `main.kern` is
exempt. If an existing file is already above 500 lines, new logic is extracted
rather than expanding it further.

## Acceptance Criteria

- [x] RED-at-base fixtures fail because `while`/`else` are unsupported, parent
      rows are absent, wide canonical integers are rejected, or malformed
      constructs are wrongly accepted—not because of stale build output.
- [x] The real validator and checker modules are accepted; assertion modules
      remain accepted; every accepted runnable main executes with no stderr,
      timeout, signal, or nonzero status.
- [x] Valid nested `if`/`else` accepts. Orphan, duplicate, after-`while`, empty,
      and descendant-masquerading-as-sibling `else` fixtures reject with stable
      details on both TS and KERN legs.
- [x] Real validator `while` accepts. Literal-true, numeric, string, array,
      identifier, empty-body, and malformed-expression `while` fixtures reject.
- [x] Direct KERN and TS numeric tables agree for signed safe boundaries,
      ordinary multi-digit values, zero, and every noncanonical/overflow class.
- [x] Numeric prints and indices use the new predicate; no five-literal
      whitelist remains in executable checker/reference code.
- [x] Fixture polarity and byte comparison remain exact; an accept-all,
      reject-all, or accept-but-abstain mutation is killed.
- [x] `pnpm test:capstone-checker-subset`, `pnpm test:selfhost-validator`,
      `pnpm test:capstone-assertion-engine`, `pnpm test:kern`,
      `pnpm check:conformance`, `pnpm --filter @kernlang/check test`, and the
      complete current `pnpm fitness:kern-5` wall pass.
- [x] Policy and support matrix promote `checker-v2` to `internal-oracle` and
      reclassify the superseded `kern-checker-v1` as the shipped 4.5 baseline;
      no KIR, formatter, frontend, compiler, runtime ABI, production authority,
      package version, or tag is added.
- [x] Full-roster Agon review has no unresolved in-scope blocker or needs-check
      finding; the accepted path-sensitive termination limitation is recorded
      below and remains runtime-capped.

## Completion Evidence

- The base RED probe failed 12/30 intended cases for unsupported `while`/`else`,
  missing stable structural details, and wide safe integers before implementation.
- `pnpm test:capstone-checker-subset` passed 48/48 byte-matched TS/KERN fixtures,
  rejected 36 red-team attempts, and directly matched 23 safe-integer predicate
  cases in KERN.
- The complete `pnpm fitness:kern-5` wall passed after review fixes, including
  168 release-policy tests, 432 cross-target plus 109 class-conformance fixtures,
  233 native KERN tests, 39 validator verdicts, 40 app-behavior fixtures, drift
  proof, browser budget, and diff hygiene.
- Initial full-roster review:
  `review-1783784689014-j8gpzb-kern5-r1-checker-v2`. It found logical/unary
  while soundness gaps, parameter shadowing, partial arithmetic provenance, and
  import-alias handling; each local issue received a byte-compared red fixture
  and mirrored TS/KERN fix.
- Closure full-roster review:
  `review-1783786731301-spepvl-kern5-r1-checker-v2-closure`. Its only verified
  blockers were the normal pre-commit untracked state of the new fixture module
  and numeric generated main; both are staged with the atomic slice. Remaining
  needs-check items were resolved against passing contract tests or the frozen
  conservative boundary: KERN `for` is exclusive, matrix/policy equality is
  enforced, generated arrays are drift-checked, boolean variables/logical roots
  intentionally fail closed, general static termination and transitive call-graph
  provenance are out of scope, and runtime loops retain the 100,000-iteration cap.
- Final staged full-roster review:
  `review-1783787255316-zon11c-kern5-r1-checker-v2-final`. It found that a
  comparison-root summary could accept unsupported operand shapes such as array
  equality. RED fixtures now cover mismatched literal and array comparisons;
  left/right operand kinds are preserved, and both TS/KERN legs require portable
  scalar-compatible shapes before accepting a while comparison.
- Post-fix full-roster review:
  `review-1783789221809-u2sjnk-kern5-r1-checker-v2-final-postfi`. It proved that
  kind-only identifier admission still allowed an array binding such as
  `xs == xs`. The final proof now rejects nonliteral equality and accepts a
  dynamic ordered comparison only when a locally declared safe-integer binding
  changes exclusively by safe `+`/`-` literal steps and is compared with another
  proven number or a `.length` member.
- Verified-final full-roster review:
  `review-1783791154508-m84c07-kern5-r1-checker-v2-verified-fin`. It proved that
  a later declaration and an unresolved `.length` receiver still satisfied the
  first provenance scan, and corroborated constant-true literal comparisons.
  The final schema carries member receivers and parameter types, scans only
  statements before the loop plus its contiguous preorder subtree, proves
  string/array length receivers, and rejects statically true literal equality.
- Proof-final full-roster review:
  `review-1783792975508-1ys7d4-kern5-r1-checker-v2-proof-final`. It proved that
  a declaration nested in an earlier branch was not definitely available and
  identified non-progressing induction steps plus unsafe-literal parity. The
  conservative admission rule requires a direct function-body declaration,
  rejects zero or wrong-direction mutations, and keeps safe-literal handling
  identical on the TS and KERN legs without claiming termination. Its
  subtree-boundary concern was disproved: in a
  preorder row table, the first later row whose parent index is below the
  ancestor row is exactly the first row outside that subtree.
- Post-shadow full-roster review:
  `review-1783796273862-7uqemd`. It identified stale completion counts and
  correctly observed that a syntactically safe update nested under a branch is
  not a path-sensitive termination proof. The counts are corrected; nested
  induction-binding shadowing now has a mirrored rejection fixture; and the
  contract explicitly retains path-sensitive termination outside R1.2. A
  direct-child-only rule was rejected because it false-rejects the real
  self-host validator's `while -> for -> if -> assign emitted` update. The
  runtime ceiling remains the deliberate nontermination failsafe. The review's
  arithmetic-provenance claim was disproved because `termProvenanced` directly
  accepts canonical safe numeric literals.

## Out of Scope

- Parser grammar changes, Python `while ... else`, `each`, static general or
  path-sensitive termination proof, or changing the runtime iteration ceiling.
- Transitive index-provenance proof across forwarded function parameters. The
  v1 bounded corpus admits forwarded parameters so the assertion sorter and
  checker can check themselves; a sound general solution needs call-graph cycle
  handling and belongs in checker v3 rather than a recursive R1.2 patch.
- KIR/value/diagnostic/trace/handler/capability ABI freeze.
- Formatter, frontend, compiler, fixed point, interpreter, WASM, or production
  `kern check` authority.
- New public API, package version, Alpha manifest, npm publication, or tag.

## Deploy Order

Flattener, TS reference, KERN checker, fixtures, generated payload, and direct
numeric oracle land atomically. They are developer/release tooling only, so
there is no mixed-version runtime window. On failure, revert the R1.2 commit;
production checking and the 4.5 runtime remain unchanged.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Primary tribunal: surface admission may be enough for `else` | Parser accepts orphan, duplicate, and after-`while` forms | Parent identity and structural rejection are required |
| Primary tribunal: flattened rows can inspect preceding siblings today | Preorder rows contain no parent field; descendants are indistinguishable from siblings | Add `stmtParent` before implementing pairing checks |
| Secondary tribunal: flat input likely cannot represent the relation and should use generated tree types | The flattener owns a purpose-built parallel-row schema and already knows each parent during traversal | Add one bounded parent-row column; no KIR or generated public type change |
| Secondary tribunal: safe-int requires a TypeScript host binding | Portable KERN text length, character access, and string ordering already exist and are exercised by a boundary fixture | Keep the predicate KERN-authored and test it directly |
| Primary tribunal: static termination analysis is unnecessary | General proof is unnecessary, but obvious literal-true and empty-body loops must not be accepted as runnable | Add conservative syntactic loop safety plus retain runtime ceiling |
| First review: top-level logical and unary roots are syntactically boolean | `&&`/`||` return operands, and the flat unary summary cannot distinguish `!false` from a bounded negation | Reject logical and unary roots; add byte-compared adversarial fixtures |
| First review: reject every forwarded parameter to close transitive provenance | This rejects the existing assertion sorter and checker self-source; safe recursion also needs cycle handling | Keep the frozen bounded forwarding contract and defer general transitive proof to checker v3 |
| Final review: every comparison-root while is executable | The root operator alone loses operand type shape and accepted `[] == []` although runtime comparison rejects it | Preserve left/right kinds and fail closed on unsupported or incompatible literal shapes |
| Post-fix review: every allowed identifier operand is scalar | Kind-only admission accepted array-bound `xs == xs` | Require numeric induction provenance for dynamic ordered operands and reject nonliteral equality |
| Verified-final review: whole-function scans and member kinds prove runtime availability | Later declarations and unresolved `missing.length` were accepted; literal equality could still be statically true | Scope scans to loop entry/subtree, prove typed receivers, and classify constant-true equality as `literal_true` |
| Proof-final review: every earlier declaration and safe arithmetic update proves progress | Branch-local declarations may not exist at loop entry; nested updates may not execute; subtraction or zero steps may not approach a less-than bound | Require a direct function-body declaration, reject inner shadowing, and conservatively reject zero/wrong-direction mutations without claiming path-sensitive termination |

## Open Questions

None. No ASSUMED or OPEN claim feeds an R1.2 oracle.
