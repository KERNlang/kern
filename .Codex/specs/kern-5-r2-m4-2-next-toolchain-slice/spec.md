# KERN 5 R2 M4.2 — Measured Canonicalizer Tranche

**Status:** M4.2 SEALED
**Date:** 2026-07-18
**Confidence:** 0.99 after 6/6 brainstorm, two-round tribunal, and deterministic measurement
**Parent objective:** expand the bounded KERN-authored structural KIR
canonicalizer by exactly one catalog-backed syntactic family selected from the
real handwritten self-host corpus

## Decision

[VERIFIED] Full-roster brainstorm
`brainstorm-1784325826674-4rcppx-kern-5-r2-m4-2-next-slice-brains`
split across canonicalizer expansion, bounded frontend, formatter preview, and
WASM-facing formatter. The plurality preferred canonicalizer expansion, but its
winning answer invented an effect/helper semantic-equivalence profile that the
current structural KIR and M4.1 contract do not prove.

[VERIFIED] Two-round synthesis tribunal
`tribunal-1784325961783-mwaqf2-kern-5-r2-m4-2-next-slice-tribun`
rejected every preselected node family and converged at confidence 0.92 on one
mergeable slice: freeze a deterministic coverage/selection gate over the
handwritten self-host corpus, then implement exactly one winning catalog-backed
structural tranche in the same slice.

[PROPOSED] M4.2 therefore contains:

1. one hash-bound handwritten self-host corpus manifest;
2. one deterministic KIR coverage and tranche-selection receipt;
3. RED mutation oracles that prevent corpus, catalog, ranking, or ownership
   drift;
4. exactly one measured syntactic family added to `canonicalizer.kern`;
5. valid, boundary, hostile, exact-KIR, and idempotence proof for that family.

[REJECTED] M4.2 does not build a source frontend, tagged row transport, public
formatter command, semantic-equivalence normalizer, compiler scaffold, WASM
formatter, fixed point, interpreter, or public KIR contract.

## Verified Baseline

- [VERIFIED] M4.1 is a KIR-to-source structural canonicalizer over `fn`, direct
  structured `param`, one `handler lang="kern"`, and direct `return` children.
- [VERIFIED] M4.1 passes 11 valid, 3 profile-limit, and 105 hostile fixtures and
  preserves exact structural KIR bytes plus second-pass canonical source.
- [VERIFIED] The structural catalog is closed and versioned; a tranche may use
  only kinds and properties already represented by current structural KIR.
- [VERIFIED] The broad formatter, frontend, compiler, fixed-point, interpreter,
  versioned public KIR, and packed release ownership rows remain open.
- [VERIFIED] Runtime helper/class commits prove execution behavior, not
  canonical structural equivalence. They cannot justify a formatter tranche.
- [VERIFIED] Handwritten self-host tool modules exist for the assertion engine,
  validator, checker, and canonicalizer. Generated fixture harnesses are
  separately identifiable by checked-in generated-file headers.

## Frozen Corpus Contract

[PROPOSED] The initial handwritten corpus is exactly:

- `examples/capstone-assertion-engine/compare.kern`
- `examples/capstone-assertion-engine/diag.kern`
- `examples/capstone-assertion-engine/sort.kern`
- `examples/selfhost-validator/validator.kern`
- `examples/capstone-checker-subset/checker-while.kern`
- `examples/capstone-checker-subset/checker.kern`
- `examples/kern-canonicalizer/canonicalizer.kern`

[REJECTED] Generated fixture harnesses, generated numeric harnesses, showcase
examples, tests, and the new M4.2 fixtures cannot influence ranking.

[PROPOSED] A checked-in manifest owns membership, source SHA-256, a stable tool
id, and generated/handwritten classification. Unknown fields, duplicate paths,
unsafe paths, missing files, digest drift, or a generated-file marker in a
handwritten member reject before a receipt is produced.

## Coverage Measurement

[PROPOSED] Parse every corpus member with current bootstrap diagnostics, reject
any error, project its current structural KIR, and traverse the decoded KIR in
authored order. For every function root, record:

- all node kinds and property keys encountered;
- the first unsupported ancestor under the M4.1 admitted profile;
- candidate syntactic families required to close that function;
- whether any required property is currently excluded or host-raw;
- source path and function name as the stable witness identity.

[PROPOSED] Measurement is static and deterministic. It does not execute tools,
infer semantic equivalence, inspect runtime coverage, count generated harnesses,
or rank by source line count.

[VERIFIED] Measurement is deliberately function-root scoped. Module-level
`use`/`from` structure is outside this tranche and cannot be registered as a
candidate family. Every unsupported fact observed inside the 98 function roots
must be claimed exactly once; missing facts and wholly unobserved claims reject.

[PROPOSED] Every observed node kind and property must exist in the current
structural catalog. Missing, excluded, or raw-host payload requirements make a
candidate ineligible rather than silently widening KIR.

## Syntactic Family Rule

[PROPOSED] A family is a checked-in, closed set of catalog node kinds and the
properties those kinds require. Families are selected from actual observed
unsupported ancestors. A family may include a structurally inseparable pair
such as `if` plus its authored `else` sibling, but may not combine unrelated
control-flow, binding, import, class, or effect kinds merely to improve its
score.

[VERIFIED] `coverage-family-registry.json` freezes exact family membership.
Policy families must member-for-member match a registry entry, registry facts are
globally disjoint, and the summary binds the registry SHA-256. A policy edit
cannot merge `if` with `while`, omit an observed fact, or retain an unobserved
family without failing the gate.

[PROPOSED] Candidate eligibility requires:

- every kind/property is present and included in current structural KIR;
- M4.1 can emit the family without changing the KIR codec or public ABI;
- required nested value tags already have lossless generic transport;
- the family is closed over the selected witnessed functions;
- unsupported descendants outside the family remain fail-closed.

## Frozen Selection Rule

[PROPOSED] Freeze the rule before accepting the measurement receipt:

1. reject ineligible or cross-family candidates;
2. rank by number of newly complete handwritten functions;
3. then number of newly complete handwritten tools;
4. then total observed occurrences in the corpus;
5. then stable family id in code-point order.

[PROPOSED] "Newly complete" means the entire function becomes canonicalizable
under M4.1 plus the candidate family. A candidate receives no credit for a
function that still contains any unsupported kind, property, value, or raw-host
payload after the candidate is applied.

[REJECTED] Partial descendant counts, generated fixtures, semantic execution
coverage, hand-selected favorites, or post-result weight changes cannot affect
the winner.

## Evidence-only Fallback

[PROPOSED] Stop implementation and retain only the measurement micro-slice for
fresh design review if:

- no eligible family completes at least one handwritten function;
- corpus membership or handwritten classification is disputed;
- ranking differs across fresh processes, locale, timezone, or input order;
- the winner requires a structural catalog or codec change;
- the winner spans unrelated syntactic families;
- the winner depends on semantic-equivalence reasoning rather than exact KIR;
- support would move semantic parsing or formatting into the host adapter.

## Measured Result

[VERIFIED] The frozen receipt measured 98 functions across seven handwritten
modules and four tools. Exactly one function is already complete under M4.1.

[VERIFIED] Ninety-seven functions are blocked by `fn.params`, the legacy
string-encoded parameter property that R1.5e.1 deliberately classifies as
`excluded-host-type`. One of those functions also contains a `throw.value`
expression outside the current structural expression catalog.

[VERIFIED] Canonical-codec per-function M4.1 profiling additionally exposes 47
functions above the value-row ceiling, 12 above the node-row ceiling, and seven
above the property-row ceiling. Thirteen functions exceed the codec depth
limit and one exceeds its node limit before row scoring. One function contains
six distinct text-character facts rejected by KERN's `quotesource` ceiling,
and sanitized whole-node projection independently confirms the unknown
`throw.value` expression blocker. These facts were hidden by the former early
stop at `fn.params`; they do not change the null winner.

[VERIFIED] Every candidate family receives zero newly complete functions and
zero newly complete tools. The selection winner is therefore `null`; occurrence
counts cannot override the required complete-function score.

[VERIFIED] The closed candidate universe now includes all observed unsupported
facts, including 491 `index` expression occurrences. The former zero-occurrence
`each`, import, and print candidates were removed; exception-flow contains only
the observed `throw` fact.

[VERIFIED] Terminal review
`review-1784329031564-2d5ds5-kern-5-r2-m4-2-coverage-terminal`
found two blockers: catalog-projectable properties/children were mistaken for
the exact M4.1 profile, and the candidate universe omitted `index` while
retaining unobserved facts. The implementation now applies an exact M4.1
property/value/child profile before completion credit, freezes family
membership, proves coverage closure, rethrows unexpected projector failures,
pins the null winner and ranking in a fresh locale/timezone process, and names
the checked-in artifact `coverage-summary.json` according to its format.

[VERIFIED] Second terminal review
`review-1784331392841-5cylsf-kern-5-r2-m4-2-coverage-terminal`
found two further blockers: family closure ignored observed property facts, and
a candidate expression could suppress validation of a nested M4.1 expression.
The implementation now freezes exact property membership per family, proves
node/expression/property coverage closure, and recursively validates every
base-kind expression even beneath candidate expressions. It also treats an
empty legacy `fn.params` payload as the structural omission it represents,
rethrows unexpected projector failures, assigns ordinal-stable witness ids,
rechecks exact source bytes immediately before parsing, and binds the complete
per-function facts plus canonicalizer/profile/registry/policy digests into the
summary. RED mutations cover digest drift, missing/generated corpus members,
invented properties, nested-base suppression, and every M4.1 golden function.

[VERIFIED] Third terminal review
`review-1784357710055-jysis6-kern-5-r2-m4-2-coverage-terminal`
found three blockers: the base text-expression mirror omitted KERN
`quotesource` character exclusions, completion ignored the configured
16/30/72 node/property/value row ceilings, and property closure classified
facts by node-kind prefixes rather than an exact property-key domain. The
implementation now applies the exact C0/DEL/C1/line-separator/BOM ceiling,
flattens every projectable function to measured row counts, and freezes every
base catalog property key separately from admitted M4.1 properties. Candidate
handler widening is explicit and requires a candidate direct child; invalid
base-only sequences remain blocked. Exact policy/corpus/implementation digests,
regular-file realpath checks, future-expression visibility, inherited-property
guards, whole-node projection after excluded-property removal, and property
occurrences in ranking resolve the material accompanying findings.

[VERIFIED] The tribunal's evidence-only fallback is active. M4.2 does not alter
`canonicalizer.kern`, add a syntactic family, or promote an ownership row.

[VERIFIED] Fourth terminal review
`review-1784360706127-7sgggx-kern-5-r2-m4-2-coverage-terminal`
found one shared blocker through two independent engines: candidate ownership
validated individual handler child kinds but not their combined sequence, so a
candidate sibling could mask duplicate returns or an orphan/reversed `else`.
Completion now validates the combined base-plus-candidate handler grammar,
requires all completion facts, and fails closed on incomplete row-limit
configuration. RED oracles cover duplicate and non-terminal returns, orphan
`else`, absent facts, and absent limits. Corpus rows now bind their explicit
`handwritten` classification, and the receipt has a deterministic writer.

[VERIFIED] Fifth terminal review
`review-1784363236516-soakf0-kern-5-r2-m4-2-coverage-terminal`
found four blockers: nested candidate containers could still mask invalid
statement sequences, row measurement bypassed the bounded structural codec,
synthetic selection facts were not exact-schema data, and expression-kind
authority was not digest-bound. Completion now validates every candidate
statement container, computes rows only after canonical encode/decode under the
M4.1 limits, validates all 13 per-function fact fields and exact nested rows,
and binds the structural-expression source digest. The writer builds core
before measurement and cannot write before asserting the null fallback. RED
oracles cover nested orphan/duplicate-return sequences, incomplete facts, and
the real codec limit path; an empty registered family also rejects.

[VERIFIED] Sixth terminal review
`review-1784365878717-6kfy1g-kern-5-r2-m4-2-coverage-terminal`
completed through four of six engines before Codex and Kimi reached the
600-second wall. It reported no verified blocker and two needs-checks. The live
catalog concern is disproved because the exact base property list is frozen in
`coverage-policy.json`, validation compares it to the catalog, and the receipt
separately binds both policy and constitution digests. The node-row concern was
real future-drift exposure: codec-derived nodes were calculated and then
overwritten with the source traversal count. A RED oracle now proves the node
ceiling uses the supplied codec count; codec-rejected functions carry explicit
`null` rows, while malformed or missing row records reject.

[VERIFIED] Exact-tree Codex/Kimi retry
`review-1784368509065-1oh63s-kern-5-r2-m4-2-coverage-terminal`
completed both engines and found four distinct needs-checks. The receipt-backed
node-row count was stale in prose and is corrected from 24 to 12. Corpus
admission now rejects both repository generated-header conventions with BOM or
leading whitespace. Function facts prove each node, expression, and property
kind set is exactly the unique set derived from its occurrence evidence, so
synthetic counts cannot alter ranking. Profile-only rejection also becomes an
explicit `firstUnsupported` fact. Three RED integrity tests cover these paths;
the focused gates and complete Node 22 `pnpm fitness:kern-5` wall pass after the
fixes.

[VERIFIED] Eighth terminal full-roster review
`review-1784370930544-az31je-kern-5-r2-m4-2-coverage-terminal`
completed five of six engines before Codex timed out. The reported digest
duplication is intentional: the canonicalizer is one frozen corpus member, so
its semantic digest must equal that member's byte digest and policy validation
makes them drift together. Malformed parser shapes intentionally reject before
a receipt, `fn.async` is catalog-frozen but outside exact M4.1 admission, and
production always supplies the validated profile-limit record. The remaining
compiled-input concern was valid defense in depth: measurement executed core
`dist` modules while binding only source/constitution evidence. The receipt now
path/length-frames and hashes every emitted core JavaScript module, rejects
symlinked compiled entries, and binds the dependency-hasher source into its
implementation digest. A RED oracle proves the compiled-core binding.

[VERIFIED] Ninth exact-tree Codex review
`review-1784373341918-svmlgh-kern-5-r2-m4-2-coverage-terminal`
found two dependency-authentication blockers and one authored-order integrity
gap. The coverage entry now authenticates the complete emitted core JavaScript
tree before dynamically loading its implementation, verifies the same tree
again after load, and binds every executed local source with path/length
framing. Profile-only `firstUnsupported` evidence now preserves authored
traversal order instead of selecting from the sorted blocker summary. Three RED
oracles cover the corrections; the focused gates pass.

[VERIFIED] Tenth terminal full-roster review
`review-1784378428611-liei4p-kern-5-r2-m4-2-coverage-terminal`
completed all six engines. Its reported dead constitution loader was disproved
at the receipt-construction call site, and the candidate-property concern was
already killed by both per-occurrence and canonical-codec RED oracles. Two
needs-checks were real hardening gaps. Runtime catalog validation now requires
exact constitution, count, node, property, and non-catalog row schemas; rejects
duplicate node/property identities and orphan property rows; and proves the
validated bytes match the executed catalog. Implementation authentication now
discovers, path/length-frames, and hashes every local `.mjs` instead of relying
on a mirrored allowlist. The focused canonicalizer gate and the complete Node
22 `pnpm fitness:kern-5` wall pass after both corrections; the exact retry
remains pending.

[VERIFIED] Eleventh terminal full-roster review
`review-1784380865734-63qlrs-kern-5-r2-m4-2-coverage-terminal`
completed five engines before Codex reached the 600-second transport timeout.
The reported missing modules are present in the staged diff. The emitted
expression projector is authenticated by the complete compiled-core digest;
the source digest separately binds its authority source. JavaScript code-unit
comparison is locale-independent, broad local-module binding is an intentional
fail-safe, and production always supplies policy-validated profile limits. A
clean core rebuild reproduced compiled-core digest
`7b00119bb78af4ed955f7f0f3d636393b9ab6f0685bf11df661d5ab9da132725`,
disproving stale emitted output in this slice. One non-blocking hardening gap
was real: function facts now reject malformed `node.property` identities, with
a RED oracle. The focused canonicalizer gate and the complete post-fix Node 22
`pnpm fitness:kern-5` wall pass; the exact full-roster retry remains pending.

[VERIFIED] Twelfth terminal review combined the four completed engines from
`review-1784383392836-5e943l-kern-5-r2-m4-2-coverage-terminal` with the exact
Codex/Kimi transport retry
`review-1784384016998-14qhb3-kern-5-r2-m4-2-coverage-terminal`. All six usable
engines therefore reviewed the same post-wall diff. The first run reported zero
verified findings. The retry found three real fail-closed gaps: duplicate
function witness ids could inflate completion counts, selection trusted a
synthetic empty blocker list instead of independently checking profile rows,
and `--write` followed an existing summary symlink. All three now have RED
oracles and reject. Measured duplicate occurrence entries remain intentional
frequency evidence, and a clean rebuild already disproved stale compiled output
in this tree. The focused canonicalizer suite passes 47/47 and the complete
post-fix Node 22 `pnpm fitness:kern-5` wall passes after the corrections; the
final terminal review remains pending.

[VERIFIED] Thirteenth terminal full-roster review
`review-1784387000656-w3teuz-kern-5-r2-m4-2-coverage-terminal` completed all six
usable engines. Two Codex findings identified one deeper trust-boundary defect:
the exported re-selection helper accepted mutable or cloned function facts, so
a caller could clear measured blockers or forge occurrence/tool scoring. The
measurement now deeply freezes every fact graph and registers its exact array
in a module-private weak map bound to the digest of the validated policy that
produced it. Re-selection rejects clones, mutations, and policy/tool-manifest
drift before ranking. Synthetic caller-supplied selection tests were removed
because that path is deliberately closed; real-corpus measurement remains the
selection proof. The authenticity RED oracle and focused canonicalizer suite
pass 41/41. The post-fix complete Node 22 `pnpm fitness:kern-5` wall passes;
the final terminal review remains pending.

[VERIFIED] Fourteenth terminal full-roster review
`review-1784389940398-i5qcyc-kern-5-r2-m4-2-coverage-terminal` completed five
structured engine verdicts plus the full unstructured ZAI review. It found two
release-blocking evidence defects and two reachable hardening gaps. Structural
and exact-profile blockers now share function traversal positions, so
`firstUnsupported` selects the actual earliest authored node. Check mode now
requires canonical summary bytes in a regular non-symlink file. Deep freezing
descends through already shallow-frozen containers, and catalog-excluded
candidate properties remain completion blockers without becoming impossible
family claims. All four paths have RED oracles. The structural-only profile
helper intentionally permits omitted row limits, while production measurement
always supplies validated limits; broad local `.mjs` binding intentionally
authenticates both implementation and its executable oracle surface. The
focused canonicalizer suite passes 45/45, and the post-fix complete Node 22
`pnpm fitness:kern-5` wall passes. The final terminal review remains pending.

[VERIFIED] Fifteenth terminal full-roster review
`review-1784392563479-1a9dd8-kern-5-r2-m4-2-coverage-terminal` completed five
engines before Kimi returned a parse failure. It reported zero verified
findings. One needs-check was a real prose precision error: the six distinct
text-character blockers belong to one `quotesource` function, not six
functions. That count is corrected here and in the release train. The
concurrent swap/load/restore claim assumes a malicious local filesystem actor
outside this deterministic CI evidence boundary; ordinary pre-load, load-time,
and post-measurement drift remains hash-checked. Compiled-tree and broad local
`.mjs` binding are intentional fail-safe inputs. Canonicalizer policy bytes are
captured at module load, and `coverage.mjs` authenticates dependencies before
dynamic implementation import. An exact Kimi retry and final terminal review
were therefore required.

[VERIFIED] Final exact-tree terminal full-roster review
`review-1784393191142-xojaa8-kern-5-r2-m4-2-coverage-terminal` completed all six
usable engines with zero verified findings. The remaining needs-checks are
disproved by the current contracts: exact base-property profile blockers run
before completion credit; sparse arrays fail the own-key density check; the
expression universe is deliberately frozen in the digest-bound family
registry; and coverage/canonicalizer policy sources are captured at module
load rather than reread during selection. M4.2 is sealed with an evidence-only
null winner and no production canonicalizer or ownership promotion.

[PROPOSED] The next prerequisite is a separately designed structured-parameter
ownership slice. It must choose between migrating handwritten tool signatures
to direct `param` children and a new non-host-semantic normalization seam. The
existing R1.5e.1 exclusion cannot be silently relaxed inside this evidence
slice.

## Required RED Oracles

- [VERIFIED] Base receipt proves at least one corpus function remains outside
  M4.1 and identifies its first unsupported ancestor.
- [VERIFIED] Anti-invention mutation: adding an unobserved or uncataloged kind
  to a family rejects.
- [VERIFIED] Corpus mutation: add/remove/reorder a member or alter a digest and
  the bound receipt rejects.
- [VERIFIED] Generated contamination: a generated-file member cannot receive
  handwritten function/tool credit.
- [VERIFIED] Hostile-ancestor credit: a family receives zero completion credit
  when any unsupported descendant remains.
- [VERIFIED] Tie stability: source order, filesystem order, locale, timezone,
  and fresh process do not alter the winner or receipt bytes.
- [VERIFIED] Catalog drift: changed kind/property disposition invalidates the
  receipt before canonicalization.
- [VERIFIED] Family-boundary mutation: merging unrelated families rejects.
- [VERIFIED] Text-profile mutation: C0 except tab/newline/carriage return,
  DEL/C1, line separators, and BOM cannot receive completion credit.
- [VERIFIED] Row-profile mutation: every configured node/property/value row
  ceiling participates in completion credit.
- [VERIFIED] Corpus filesystem mutation: symlinks and non-regular members
  reject even when their target remains inside the repository.
- [VERIFIED] M4.1 regression: all existing valid goldens, hostile categories,
  profile ceilings, exact KIR bytes, and idempotence remain byte-identical.
- [REJECTED] Winning-family RED: at least one measured newly complete function
  fails before implementation for the intended unsupported kind.
- [PROPOSED] Unsupported sibling/descendant fixtures still fail before any
  source result, stdout, event, or partial KIR escapes.

## Implementation Contract After Measurement

[PROPOSED] Update this spec with the exact winning family, witnesses, score,
properties, value shapes, exclusions, and confidence before production code is
written.

[PROPOSED] Add only the winning family to the KERN canonicalizer. Semantic
spelling, property order, indentation, quoting, child order, and complete-result
construction remain KERN-owned. The generic host adapter remains unaware of
node kinds and formatting rules.

[PROPOSED] Every new threshold is config-owned. Every hand-written source file
stays below 500 lines; `canonicalizer.kern` must split helpers before expansion
because M4.1 already occupies 438 lines.

## Gate and Ownership Result

[PROPOSED] Extend `pnpm test:kern-canonicalizer` with the frozen coverage
receipt, selection mutations, and the winning tranche corpus. Keep one current
`kern-kir-canonicalizer` gate and one
`kern-kir-canonicalizer-profile: internal-oracle` ownership row.

[REJECTED] Do not add or promote broad formatter/frontend/compiler/fixed-point/
interpreter rows. Documentation must say "structural KIR emission over measured
profile tranches; unsupported catalog kinds fail closed."

## Following Order

[PROPOSED] After M4.2:

1. M4.3+ remeasure and add the next winning tranche under the frozen rule;
2. prove canonicalizer self-application once the measured profile covers its
   own handwritten module graph;
3. expose an explicitly narrow formatter preview only after its complete
   admitted corpus is measured;
4. design the bounded KERN frontend transport against the then-current codec;
5. investigate compiler bootstrap, then fixed point and interpreter shadow;
6. keep WASM as an independent product lane.

## Implementation Hold

[VERIFIED] Production canonicalizer expansion remains on hold because the
deterministic receipt selected no tranche. The evidence gate is implemented and
release-blocking; the next prerequisite requires its own spec and tribunal.

## Acceptance Criteria

- [x] Corpus membership, source digests, tool ids, and handwritten status are
      checked in and fail closed on drift.
- [x] Every family kind is catalog-backed, sorted, unique, and disjoint from the
      base and other families.
- [x] The family registry is digest-bound and exactly coverage-closed over all
      observed non-base node, expression, and property facts.
- [x] Completion credit enforces the exact M4.1 property, value, and child
      profile rather than the broader structural catalog.
- [x] Measurement is deterministic and binds the structural constitution.
- [x] Hostile unsupported facts prevent completion credit.
- [x] The checked-in receipt records 1/98 base-complete functions, 97 legacy
      parameter blockers, all row/text/structural blockers, and a null winner.
- [x] `pnpm test:kern-canonicalizer` includes the measurement tests and exact
      checked-in summary check.
- [x] Local focused gates pass after the thirteenth review correction.
- [x] The full KERN 5 wall passes after the fourteenth review correction.
- [x] Terminal full-roster Agon review has no unresolved material finding.
