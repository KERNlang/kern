# KERN 5 R2 M4.13 — Member-Expression Canonicalizer Tranche

**Status:** REVIEWED — publication pending
**Date:** 2026-07-20
**Confidence:** 0.98

## Objective

[DECIDED] Implement the M4.12-authorized `member-expression` family in the
KERN-authored canonicalizer without promoting the family or widening the
shared structural KIR, parser, runtime, or public-reader contracts.

## Grounded Evidence

[VERIFIED] Published `origin/main` at
`f4ed88f0ef8a15548e2de257982e2ea79dcb85f2` contains the sealed M4.12 handoff.
Its fourth append-only selection record has SHA-256
`83e045d827f7865bd03003d882baf3fe42d66d998c0daa894a05f534cbf8df2d`
and authorizes `member-expression` from the immutable M4.11 measurement: one
function, one tool, 259 occurrences, and sole witness
`examples/capstone-checker-subset/checker-while.kern#8:isPositiveSafeIntText`.

[VERIFIED] The structural expression catalog defines `member` as the exact
record `{ object, optional, property }`: `object` is a recursive expression,
`optional` is boolean, and `property` is identifier-shaped text. The selected
witness uses non-optional `Text.charAt(raw, 0)` and is otherwise inside the
promoted base.

[VERIFIED] The parser accepts identifier-shaped dot properties except its
globally tokenized literal keywords (`null`, `none`, `undefined`, `true`,
`false`, and `await`). It accepts `new` and `typeof` after a dot. Therefore a
KERN emitter must reject the six unparseable spellings while preserving the
other structural identifiers; the existing root-expression identifier helper
is intentionally too strict for this field.

## Contract and Decisions

[DECIDED] Admit the exact three-field member record only when
`optional=false`, the property is a parser-safe dot identifier, and the object
recursively canonicalizes through the already implemented expression
families. Emit `object.property` without changing stored member order or
property spelling.

[DECIDED] Dependency closure includes promoted null, identifier, boolean,
integer, text, list, binary, and call objects plus recursive non-optional
member objects. Existing binary emission already supplies required grouping;
call, list, literal, identifier, and member sources are postfix-safe in the
portable parser.

[DECIDED] Reject `optional=true`. Optional-chain propagation and grouping
interact across member, index, and call nodes and require a separate semantic
design. Reject unsupported recursive objects, including index expressions,
through the existing empty-source fail-closed path.

[DECIDED] Keep `member-expression` outside the cumulative coverage base and as
the active selected candidate. This slice proves implementation capability
only. A subsequent slice must authenticate and promote this exact family,
remove it from the candidate set, remeasure, and select the next prerequisite.

[REJECTED] A witness-shaped `Text.charAt` special case would not implement the
selected structural family and would be deleted as soon as another member
receiver appears.

[REJECTED] Reusing `validexpressionidentifier` for the property would reject
valid parser forms such as `object.new` and `object.typeof`; using only the
structural regex would emit source the parser cannot consume for literal
keywords and `await`.

## RED and Mutation Contract

[DECIDED] Valid fixtures cover the selected `Text.charAt` shape, direct
properties, recursive member chains, call receivers, binary receivers, every
promoted literal receiver, and parser-valid token and structural-keyword dot
properties. Every fixture must preserve structural KIR,
match exact golden source, and be byte-idempotent on a second pass.

[DECIDED] Hostile mutations cover missing, duplicate, and extra fields;
dangling or unsupported objects; non-boolean and true optional flags;
non-text, malformed, and parser-keyword properties; and optional state nested
inside a recursive member chain. Every mutation rejects the entire input with
no events or partial source.

[DECIDED] The frozen sole M4.11 witness must execute through structural KIR,
KERN-authored canonicalization, KIR equality, and byte idempotence in the
measured witness wall.

## Expected File Surface

- this claim-tagged spec and the durable release-train entry;
- one member-expression valid/hostile fixture module and fixture registration;
- KERN-owned member validation/emission inside `exprsource`;
- ownership, witness, mutation, golden, KIR, and idempotence assertions;
- regenerated authenticated composition and format-5 coverage summary.

## Acceptance Criteria

- [x] Fresh branch starts from exact published `origin/main`.
- [x] Exact structural schema, parser boundary, witness, and prior call tranche
      are grounded in current source.
- [x] RED fails against sealed M4.12 because `exprsource` cannot emit member.
- [x] Exact recursive non-optional member validation and emission are
      KERN-owned.
- [x] Optional members, index dependencies, malformed shapes, and unsafe
      property spellings remain fail-closed.
- [x] Valid/hostile fixtures and the frozen M4.11 witness pass KIR equality and
      byte idempotence.
- [x] Member remains unpromoted and the four-record provenance chain remains
      byte-identical with its pointer still resolving to member.
- [x] Repository-owned composition and format-5 summary are regenerated and
      authenticated.
- [x] Focused Node 22 gates and complete `pnpm fitness:kern-5` pass.
- [x] Full usable-roster `agon review` has no unresolved material finding.
- [ ] Signed commit is fetched/rebased before one `--no-verify` push.

## Measured Implementation Evidence

[VERIFIED] Repository-owned composition authenticates the 33,571-byte
canonicalizer composite at SHA-256
`b22b359416deb5da970a2826738eb392d37d29807d48aefe946d8f8aafcffc0a`.
The KERN-owned member source hashes to
`3f33bd5d9ea6ecafc323035b5bce303b133d502f8b5c3fca4c8076da238c369a`,
and the regenerated format-5 coverage summary hashes to
`1caa9245ea16dd60e572cef3812070552645b041e2fe1805d606872fede7ac0b`.

[VERIFIED] The focused Node 22 gate passes all 69 structural and
authentication tests, 27 golden/idempotence/KIR fixtures, eight measured
witnesses, three profile-limit fixtures, and 156 hostile mutations. Coverage
remains 20/104 base-complete with 81 `fn.params` blockers; member remains the
unpromoted selected family at one function, one tool, and 259 occurrences.

[VERIFIED] The complete Node 22 `pnpm fitness:kern-5` wall passes repository
consistency, lint, production build, every workspace and infrastructure suite,
432 cross-target fixtures, 109 class fixtures, 233 native assertions at 100%
coverage, 48 checker fixtures plus 36 hostile rejections, 39 validator
verdicts, 40 whole-app fixtures across three legs, browser budget, and every
KIR/runtime/ownership/convergence guard. Its terminal canonicalizer rerun
reproduced the pre-review 26/8/3/152 corpus and authenticated 20/104 coverage
state. Review-driven test hardening then passed the focused 27/8/3/156 wall
without changing KERN production or composition bytes.

[VERIFIED] High-risk role-lens review
`review-1784588210665-n8hgn4-kern-5-r2-m4-13-terminal-boundar` completed all
six usable engines with zero verified findings, five needs-check findings,
zero speculative findings, and five nits. The escaped helper-ownership guard,
per-source witness parse cache, and review receipt are fixed. Literal/token
receiver and all-keyword hostile coverage are strengthened. Fixture-family
metadata and cross-family helper extraction were rejected as prior-tranche
scope expansion, while the duplicated KERN/parser oracle remains intentional
for self-hosted fail-closed independence. No material finding remains.
Supplemental review
`review-1784589125374-ngt1a2-kern-5-r2-m4-13-post-review-fixe` completed
2/2 independent engines with zero verified findings, one needs-check item,
zero speculative findings, and five nits. Direct flattened-KIR inspection
proved `memberFieldsIds()[0]` is the inner `service.client` member, so the
recursive optional mutation already targets the intended path. Parser-backed
fixtures prove the questioned integer and keyword-shaped forms. No additional
change is required.

## Stop Conditions

- Correct emission requires changing the parser, structural schema, runtime
  ABI, canonical value format, public exports, or optional-chain semantics.
- The selected witness depends on an unpromoted family other than member.
- Any valid fixture changes structural KIR after canonicalization.
- Live provenance history or base promotion state changes in this slice.
- Any focused, full-wall, or terminal-review gate fails unresolved.

## Out of Scope

- Promoting member expressions or selecting the next family.
- Optional member/call/index chains or index-expression support.
- Another structured-parameter migration.
- KIR v1 freeze, public reader export, runtime cutover, or semantic
  self-hosting claims.
