# KERN 5 Phase 2 M4.171: successful-line composition shadow v1

**Status:** BUILT; FULL LOCAL WALL AND INDEPENDENT REVIEW GREEN; PUBLICATION PENDING
**Date:** 2026-08-12
**Risk:** high; authenticated frontend composition and a new promoted KERN 5 gate
**Confidence:** 0.99
**Tribunal:** `tribunal-1786404220444-c85nut-m4-171-next-frontend-seam` (4/4 succeeded)
**Publication tribunal:** `tribunal-1786535402074-wwwnmd-m4171-publication-decision` (3/3 succeeded)

## Executive Summary

M4.171 will add the narrowest missing frontend composition boundary after the
M4.170 keyword-handler phase: one bounded, successful, parser-normalized
logical line becomes one complete authenticated `ParsedLine`-shaped record.
The native KERN owner composes the already-promoted M4.153-M4.170 evidence,
binds structural metadata that M4.170 does not expose (`indent`, `rawLength`,
source location, and quoted-property presence), and emits the final type,
properties, styles, pseudo-styles, theme references, and ordered diagnostic
tape. It adds no new keyword, generic-property, style, theme, or diagnostic
semantics.

This is an internal composition oracle, not node or tree construction. It does
not own `parseLines`, decorators, raw multiline blocks, `toNode`, `buildTree`,
AST/KIR, a public parser API, or frontend cutover. `kern-frontend` remains
`not-shipped`.

## Current State / Root Cause

[C1] **VERIFIED:** Bootstrap `ParsedLine` has exactly `indent`, `rawLength`,
`type`, `props`, optional `quotedProps`, `styles`, `pseudoStyles`, `themeRefs`,
and `loc` (`packages/core/src/parser-core.ts:29-42`, read 2026-08-11).

[C2] **VERIFIED:** Successful `parseLine` establishes indentation and retained
content, applies optional `export fn`, records tokenizer diagnostics at adjusted
coordinates, admits the node type, applies hints, one keyword handler, and the
generic property/style/theme loop, then constructs the complete record
(`packages/core/src/parser-core.ts:250-413`, read 2026-08-11).

[C3] **VERIFIED:** M4.170 already authenticates the complete M4.169 decision,
handler-local typed writes and cursors, handler-masked retained stream, M4.168
continuation, seed collisions, runtime identity/epoch, limits, and a terminal
seal (`scripts/check-kern-frontend-keyword-handlers.mjs:198-247,309-426`, read
2026-08-11).

[C4] **VERIFIED:** M4.170 reconstructs final properties, styles,
pseudo-styles, theme refs, quoted properties, and duplicate/unexpected-token
diagnostics, and enforces bootstrap parity for a childless parse result
(`scripts/check-kern-frontend-keyword-handlers.mjs:268-307,408-426` and
`scripts/kern-frontend-keyword-handlers/composition-oracle.mjs:142-192`, read
2026-08-11).

[C5] **VERIFIED:** M4.170 still does not emit a `ParsedLine` record: structural
fields `indent`, `rawLength`, and `loc` are absent; styles, pseudo-styles, and
theme refs are folded into `finalProps`; optional `quotedProps` presence is
normalized to an array; only two diagnostic codes are projected for bootstrap
comparison (`scripts/check-kern-frontend-keyword-handlers.mjs:408-426` and
`scripts/kern-frontend-keyword-handlers/composition-oracle.mjs:142-191`, read
2026-08-11).

[C6] **VERIFIED:** Cross-line orchestration is a separate semantic boundary:
`parseLines` owns comment-line skipping, pending decorators, multiline raw
blocks, quote/expression stitching, and dropped-decorator diagnostics
(`packages/core/src/parser-core.ts:553-704`, read 2026-08-11).

[C7] **VERIFIED:** Node and tree construction are later boundaries: `toNode`
moves styles/themes into `IRNode.props`, and `buildTree` owns indent-stack
parentage plus `INDENT_JUMP` diagnostics (`packages/core/src/parser-core.ts:707-750`,
read 2026-08-11).

[C8] **VERIFIED:** Existing KERN shadows already bind the source-side evidence
needed for M4.171. Indentation records preserve exact indent bytes and physical
coordinates (`scripts/check-kern-frontend-indentation.mjs:97-159`); comment
boundary records preserve retained content and marker payload
(`scripts/check-kern-frontend-comment-boundaries.mjs:92-180`); whitespace trim
records preserve exact code/trivia offsets (`scripts/check-kern-frontend-whitespace-trim.mjs:99-183`).

[C9] **VERIFIED:** The support matrix currently stops at
`kern-frontend-keyword-handlers`; successful node construction and the public
frontend remain explicitly absent (`docs/kern-5-support-matrix.md:71-73,402-411`,
read 2026-08-11).

[C10] **VERIFIED:** PR #553 rebased the reviewed M4.170 tree byte-identically
to `origin/main` commit `306712165d6153eede7212d3b84aaff8242d8148`;
`git diff --exit-code 077a9203 30671216` exited 0 on 2026-08-11.

[C11] **VERIFIED:** The post-review `parser-style.ts` containment changes the
compiled `parser-style.js` SHA-256 from
`9e923eb6b9018aa7fb681c5f958c2f0efd574ca10352802c5745eae1b212429b`
to `3a9f95dbee2d1c190f0e431bac1edf73ffd9c598f220bf8a905e9c1232cf0c8f`.
Because that path belongs to the authenticated M4.145 compiled-core inventory,
`pnpm fitness:kern-5` failed 55 of 737 canonicalizer tests at the shared exact
historical digest check while 682 passed. The existing successor mechanism
reconstructs exact pre-change bytes before hashing historical membership
(`scripts/kern-canonicalizer/coverage-dependencies.mjs:95-196`, observed
2026-08-11); the frozen receipt itself must not be rewritten.

[C12] **VERIFIED:** The automatic high-risk review found that promotion updated
the fitness policy and focused package script but left the manually maintained
`test:infra` chain ending at M4.170. Because top-level `pnpm test` and
`test:non-semantics` delegate to `test:infra`, M4.171 was absent from their
frontend gate sequence. A policy-derived regression now requires every current
`test:kern-frontend-*` fitness script to appear in that chain, and M4.171 is
appended after its M4.170 predecessor.

[C13] **VERIFIED:** The fresh authoritative publication wall ran on the final
integrated tree under Node 22.22.0 from 2026-08-12 through 2026-08-13 and
exited 0 with `KERN 5 current fitness wall passed.` The receipt includes the
16/16 focused M4.171 proof, 254 admitted predecessor references across 273
unique executions,
the cumulative M4.153-M4.171 receipt with `successfulLineComposition: 5`, both
738/738 canonicalizer passes, 434/434 cross-target conformance, 109/109 class
conformance, and 233/233 native KERN tests with 100% declared coverage.

[C14] **VERIFIED:** Final automatic high-risk role-lens review
`review-1786552371762-ao1swg-m4171-publication-final` completed all 6/6 usable
reviewers. It found one source-reproduced blocker: M4.170 export-seed
`DUPLICATE_PROP` coordinates already contained the virtual `export ` offset,
while M4.171 shifted them again. A RED regression for
`  export fn export=false` proved bootstrap columns 13-19 versus reconstructed
20-26. M4.171 now authenticates seed-duplicate membership and applies only the
outer indentation shift; the regression is GREEN at 13-19. The same review
found that the fitness drift guard would miss the planned terminal
`test:kern-frontend` gate and did not enforce policy order. A RED future-gate
regression now covers both cases. Targeted independent correctness review
`review-1786556263203-n02nna-m4171-final-review-fixes` completed 1/1 with zero
findings before the authoritative wall above.

## What Already Works

- M4.153-M4.170 already own the admitted single-line lexical and semantic
  phases. M4.171 composes their evidence and must not reimplement them.
- M4.170 already has a full typed-value writer, independent handler oracle,
  fused bootstrap parity, replay/epoch checks, compact failures, and policy
  bounds. These are predecessors, not code to duplicate.
- Bootstrap `parser-core.ts`, keyword handlers, tokenizer, public types, and
  parser exports remain evidence-only and require no edit.
- The cumulative frontend receipt and `fitness:kern-5` promotion machinery
  already provide the regression pattern to extend.

## Contract (Verified)

> Verified against `packages/core/src/parser-core.ts`, the M4.153-M4.170
> checkers/policies, and `docs/kern-5-support-matrix.md` on 2026-08-11.

| Field / Behavior | Type | Evidence | Tag |
| --- | --- | --- | --- |
| `indent` | canonical non-negative UTF-16 code-unit count for admitted single-line space indentation | `parser-core.ts:258-262`; tab-indented success is excluded below | VERIFIED |
| `rawLength` | retained post-comment content length before export-prefix removal | `parser-core.ts:260-265,403-405` | VERIFIED |
| `type` | admitted node-type identifier | `parser-core.ts:282-328,403-407` | VERIFIED |
| `props` | exact final typed property record, including hidden handler markers | `parser-core.ts:330-412`; M4.170 checker `272-287,408-426` | VERIFIED |
| `quotedProps` | absent when empty; ordered list when generic quoted values exist | `parser-core.ts:332,384-385,403-412` | VERIFIED |
| `styles` | exact separate style record, including the empty record | `parser-core.ts:333,370-374,403-410` | VERIFIED |
| `pseudoStyles` | exact nested pseudo-style record, including the empty record | `parser-core.ts:334,370-374,403-411` | VERIFIED |
| `themeRefs` | ordered theme-reference list, including the empty list | `parser-core.ts:335,377-381,403-412` | VERIFIED |
| `loc` | exact `line`, `col`, `endLine`, and `endCol`; v1 fixes `lineNum=1` | `parser-core.ts:262-265,403-413` | VERIFIED |
| diagnostic tape | full ordered diagnostics attributable to the one admitted logical line | `parser-core.ts:267-279,316-327,387-400` | VERIFIED |
| predecessor identity | one current runtime snapshot/epoch and complete M4.170 authenticated envelope | `check-kern-frontend-keyword-handlers.mjs:309-426` | VERIFIED |

### Admitted successful-line profile

[A1] **DECIDED:** Input is one LF/CR-free parser-normalized logical line with
space-only indentation. Blank/comment-only input, missing node type, and the
`__error` recovery record are excluded from M4.171 because this slice proves
successful composition only.

[A2] **DECIDED:** `lineNum` is fixed to 1 in v1. Cross-line/document
coordinates belong to the later `parseLines` owner. The envelope nevertheless
binds all four location fields so later composition cannot invent them.

[A3] **DECIDED:** `export fn` is included. The native owner authenticates the
exact retained pre-export content, the removed prefix, `props.export=true`,
the shifted parse column, and the unchanged raw length.

[A4] **DECIDED:** Inline comment/trivia, whitespace trim, indentation,
tokenizer diagnostics, known-node warning, hints, handlers, generic
properties, styles, pseudo-styles, theme refs, quoted properties, duplicate
warnings, and unexpected-token warnings are included only by composing their
already-promoted owners.

[A5] **DECIDED:** The native owner invokes M4.170 exactly once and consumes one
complete current-runtime envelope exactly once. It may compose earlier
structural owners only where M4.170 lacks the structural field; it must not run
a second semantic parse whose agreement could mask a faulty first result.

[A6] **DECIDED:** A success envelope binds the raw logical input, normalized
M4.170 content, exported flag, runtime instance, parse epoch, every structural
field, every predecessor field, the optional-presence bit for `quotedProps`,
policy limits/formats, and one unique terminal seal. Failure is atomic and uses
a closed policy-derived code set.

[A7] **DECIDED:** Digests, HMAC/session keys, monotonic sequence IDs, and frozen
evidence blobs are not runtime substitutes. Authentication follows the current
closed field-envelope pattern; all numeric ceilings come from the versioned
policy and inherited runtime limits.

## Implementation Options

| Option | Confidence | Decision | Reason |
| --- | ---: | --- | --- |
| A. Successful single-logical-line composition | 0.94 | selected | closes the unauthenticated `ParsedLine` metadata boundary without adding syntax or tree semantics |
| B. Full `parseLines` multiline/decorator owner | 0.55 | defer to M4.172 | adds several cross-line state machines and mutates authenticated line records |
| C. `toNode` plus `buildTree` owner | 0.31 | rejected for M4.171 | would claim tree/diagnostic semantics over leaves not yet authenticated as complete records |

The tribunal selected A. Its strongest objection remains valid: a weak
implementation could merely reseal M4.170 and make no semantic progress. The
acceptance criteria therefore require fields M4.170 cannot represent, a
hand-audited all-phases fixture, full diagnostic/presence evidence, and
mutation kills for omitted/displaced structural fields.

## Oracle Design

[O1] **DECIDED:** Fixture expectations are explicit, independently authored
successful-line records. The oracle may use raw input plus the already parsed
predecessor envelopes, but it must not import or invoke `parseLine`,
`parseDocument`, `parseInternal`, `toNode`, `buildTree`, `KEYWORD_HANDLERS`, or
the M4.171 native implementation.

[O2] **DECIDED:** Two release-blocking, hand-audited fixtures collectively
exercise every phase without inventing an impossible bootstrap combination.
The combined `route` fixture covers space indentation, a runtime positional
hint, a committing keyword handler, a generic overwrite colliding with a seed,
a quoted generic property, style and pseudo-style writes, ordered theme refs,
an unexpected token, an inline comment, and an astral scalar before at least
one location boundary. A separate `export fn` fixture covers exact prefix
removal, export seeding, parse-column shift, raw length, and source location.
Both expected records are independently authored and checked field-for-field.

[O3] **DECIDED:** A differential-silence guard replays every admitted positive
M4.153-M4.170 fixture through the M4.171 path and proves field-identical output
for the fields in profile. Any predecessor fixture that cannot enter A1 is
listed as an explicit excluded-profile count, not silently skipped.

[O4] **DECIDED:** RED mutations must kill: constant records, M4.170 delegation
without structural binding, omitted/duplicated/reordered predecessor chunks,
swapped same-valued fields, absent-vs-empty `quotedProps`, folded-vs-separate
styles/themes, raw-length drift, parse-column drift, astral UTF-16 drift,
diagnostic omission/reordering, stale epoch/replay, moved/duplicate seals,
hardcoded limits, and bootstrap-only oracle generation.

[O5] **DECIDED:** Bootstrap `parseDocument` evidence is used only as the final
differential comparator. The independent expected record and predecessor
authentication must pass first, so equal bootstrap/native defects cannot
satisfy the gate.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `.Codex/specs/kern-5-p2-frontend-successful-line-composition-v1/spec.md` | add | claim-tagged contract |
| `examples/kern-frontend/successful-line-composition*.kern` | add | native KERN owner/helpers, each under 500 lines |
| `scripts/check-kern-frontend-successful-line-composition.mjs` | add | strict envelope, oracle, bootstrap, and containment checker |
| `scripts/check-kern-frontend-successful-line-composition-regressions.mjs` | add | cumulative M4.153-M4.171 receipt |
| `scripts/kern-frontend-successful-line-composition/*` | add | policy, fixtures, independent oracle, envelope helpers, tests |
| `packages/core/src/parser-style.ts` and containment test | harden | prevent inherited pseudo-style names from writing through the host `Object` constructor before M4.171 native evaluation |
| `scripts/kern-canonicalizer/parser-style-containment-target.mjs` | add | exact fail-closed reconstruction descriptor for historical `parser-style.js` bytes |
| `scripts/kern-canonicalizer/coverage-dependencies.mjs` and integrity test | extend | reconstruct the pre-M4.171 parser-style bytes only for historical M4.145 hashing and kill descriptor drift |
| current canonicalizer coverage successor receipts, if measurement proves drift | regenerate | bind the current secured compiled core and coverage implementation without altering frozen historical receipts |
| `package.json` | update | focused and promoted gate wiring |
| `scripts/kern-5-fitness-policy.json` and matching fitness assertions/fixtures | update | promote only after focused/cumulative gates pass |
| `docs/kern-5-support-matrix.md` | update | exact internal-oracle capability and exclusions |
| `docs/kern-5-release-train.md` | update | close M4.170 publication; add truthful M4.171 receipt |
| `.Codex/goals/KERN-5-COMPLETION-GOAL.md` | update | current baseline/slice handoff |

[B1] **CORRECTED:** No semantic edit to `packages/core/src/parser-core.ts`,
`parser-keywords.ts`, tokenizer/token-stream source, public barrels, public
types, KIR schemas, runtime ABI, package version, or generated code. The
independent post-fix review proved `parser-style.ts` could write through an
inherited `constructor` pseudo-style name before native evaluation; that
already-unsupported selector is ignored before nested writes, with a dedicated
containment regression.

[B2] **DECIDED:** If implementation discovery requires a bootstrap behavior
change, stop this slice and redesign; historical/frozen parser evidence is not
rewritten to fit the oracle.

[B3] **CORRECTED:** The containment must remain in `parser-style.ts`; relocating
it to a bootstrap/load-order wrapper would not protect direct parser callers.
Historical M4.145 authentication instead receives one exact reconstruction
stage that maps the current secured compiled bytes back to the archived
pre-M4.171 bytes before hashing. The stage must require the current text exactly
once, reproduce the archived file digest, preserve the pinned aggregate M4.145
and pre-M4.135 digests, and fail on current or historical byte drift. Only
current successor receipts whose live inputs changed may be regenerated.

## Acceptance Criteria

- [x] RED-at-base fails on a semantic field missing from M4.170 (at minimum
      `indent`, `rawLength`, or exact `loc`), not because a future command or
      file is absent.
- [x] Every admitted success fixture yields the exact complete record in the
      Contract table, including empty records/lists and optional field presence.
- [x] The hand-audited combined fixture in O2 passes and each independent field
      mutation causes a fail-closed mismatch.
- [x] One M4.170 invocation/consumption, one current runtime/epoch, complete
      predecessor authentication, and one terminal seal are structurally
      enforced and mutation-killed.
- [x] Full diagnostics are ordered and exact; omission, reordering, code/detail,
      coordinate, severity, suggestion, and source-span mutations fail closed.
- [x] UTF-16 astral coordinates, export-prefix column shift, inline-comment raw
      length, style/pseudo-style separation, theme order, and quoted-property
      absent-vs-present behavior match bootstrap exactly.
- [x] Generic properties named `styles`, `pseudoStyles`, and `themeRefs` remain
      in `ParsedLine.props` even when same-line structural style/theme syntax
      overwrites those names only in the final IR-node projection.
- [x] Exact-at-limit succeeds and first-over-limit fails for every new
      policy-owned field/byte/record bound; no changeable limit is hardcoded.
- [x] Replay, stale epoch, same-valued field swaps, forged predecessor fields,
      post-seal data, duplicate/moved seals, delegation, and constant-output
      mutants fail closed.
- [x] Differential-silence replay covers every admitted predecessor positive
      fixture and reports explicit admitted/excluded counts for M4.153-M4.170.
- [x] Source validation proves all handlers are native KERN, no forbidden
      parser/oracle/bootstrap delegation exists, and every handwritten source
      file is below 500 lines.
- [x] A RED provenance regression fails before the M4.171 reconstruction exists;
      after the fix it proves exact archived `parser-style.js` bytes, rejects
      descriptor/current-source drift, and restores pinned M4.145 and pre-M4.135
      aggregate digests without changing any frozen historical receipt.
- [x] `pnpm test:kern-frontend-successful-line-composition` passes.
- [x] `test:infra` executes every current frontend fitness gate, including
      M4.171 after M4.170, with a policy-derived drift regression.
- [x] The cumulative M4.153-M4.171 frontend receipt, touched core build/tests,
      `pnpm test:kern-5-fitness`, `pnpm fitness:kern-5`, lint/typecheck, and
      `git diff --check` pass on Node 22.22.
- [x] Automatic high-risk role-lens review ran with the full usable roster
      roster via `agon review <target> --risk auto --primary-engine codex --roles auto`;
      every finding is source-verified and genuine blockers get RED regressions.
- [ ] The granular Agon-signed KERN commits are pushed once directly to
      `origin/main` under the user's explicit authorization, and the remote SHA
      is verified before the next slice starts.
- [x] Support matrix adds
      `kern-frontend-successful-line-composition: internal-oracle`; public
      `kern-frontend` remains `not-shipped`.

## Out of Scope

- Blank/comment-only lines, missing-type `__error` records, and partial
  compilation recovery.
- Tabs and `INVALID_INDENT` in v1; space indentation is the admitted success
  profile.
- Cross-line `lineNum`, physical-line collection, quote/expression stitching,
  decorators, raw multiline blocks, and dropped-decorator diagnostics.
- `toNode`, `buildTree`, `INDENT_JUMP`, children, AST/KIR emission, schema or
  semantic validators, canonicalization passes, public parser APIs, and cutover.
- New parser syntax or supported pseudo-selector behavior beyond rejecting the
  already-unsupported inherited `constructor` name, and any M4.153-M4.170
  contract rewrite.

## Deploy Order

1. Land the native/checker/spec/docs gate as an internal oracle while the
   TypeScript bootstrap parser remains authoritative.
2. Promote the focused command into current fitness only after the full local
   wall and independent review pass.
3. During version skew, old artifacts retain the unsupported inherited
   `constructor` write-through; new artifacts ignore that selector before any
   nested write. All supported parser/style behavior remains byte-for-byte
   covered by the existing differential corpus.
4. Do not consume the M4.171 envelope from production or public packages.

## Open Questions

None. Every acceptance fixture derives only from VERIFIED source behavior or
the DECIDED tribunal contract. Discovery that contradicts a claim requires a
Corrections Log entry and a confidence re-score before implementation.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| Next slice was provisionally named `frontend-node-construction` | Tribunal showed M4.171 neither produces `IRNode` nor owns a tree | Branch/spec renamed to `successful-line-composition`; node/tree claims prohibited |
| A larger multiline owner might be the most direct next step | `parseLines` adds decorators, raw blocks, stitching, and new diagnostics over unauthenticated complete-line leaves | Multiline ownership deferred to M4.172 |
| M4.171 could use cryptographic or sequence authentication | Current frontend contracts use explicit bounded field envelopes and runtime epoch identity | HMAC/session keys, sequence IDs, and frozen digests explicitly rejected |
| M4.170 was assumed to lack final semantic composition | Current checker already reconstructs final props/styles/themes/quoted fields and partial diagnostics | M4.171 must prove missing structural/presence/full-diagnostic fields or remain RED/NO-GO |
| One combined fixture could include `export fn`, a committing handler, and residual styles/themes | Bootstrap recognizes `export` only for `fn`, while the `fn` handler consumes its remaining signature/property stream and does not leave style/theme tokens for the generic continuation | O2 uses a combined route fixture plus a separate exported-fn fixture; aggregate coverage is unchanged and both are hand-audited |
| The compact failure policy could expose six branches, including empty input and invalid configured limits | Host preconditions and policy validation reject those states before native execution, so those two branches were unreachable | The closed native failure set contains the four executable codes, and every branch has a direct authenticated regression |
| Envelope byte-bound testing could derive the bound from one runtime snapshot and execute with another | Runtime instance width can change as tests advance the snapshot epoch, producing a false first-over-bound result | Bound derivation and execution use the same captured runtime snapshot and exact at-limit/first-over-limit regressions |
| O3 could report predecessor failures dynamically as generic exclusions | A dynamic exclusion count would allow new regression failures to pass silently | O3 now has an exact 33-entry ref-to-failure-code table; 343 references resolve to 254 admissions, 44 source-profile exclusions, 12 boundary exclusions, and 33 exact predecessor exclusions across 273 unique executions |
| Four hand-authored records covered all structural shifts | Export-path diagnostics were not independently exercised after the `export fn` column shift | A fifth hand-authored exported-fn diagnostic fixture binds shifted unclosed-string and unexpected-token coordinates |
| Bootstrap parser source would remain evidence-only | Post-fix security review reproduced `screen {:constructor:agonPollutedM4171:yes}` mutating the host `Object` constructor before the native path ran | `parser-style.ts` now ignores the inherited `constructor` pseudo-selector before any nested write, matching the existing M4.167 invisible-state contract; core and M4.171 containment regressions prove no host mutation and the original replay profile remains closed |
| The parser-style containment could land without canonicalizer provenance work because the focused frontend gates passed | The compiled file belongs to authenticated M4.145 membership; the full wall failed 55/737 tests at one frozen digest invariant | M4.171 now includes an exact historical reconstruction descriptor and blocks until pinned historical digests plus current successor receipts and full fitness are green |
| Promoting the focused gate in the KERN 5 fitness policy also made ordinary `pnpm test` execute it | Ordinary tests use a separate manually maintained `test:infra` chain, which still ended at M4.170 | The chain now includes M4.171, and a policy-derived regression prevents future current frontend gates from drifting out of `test:infra` |
| Bootstrap parity could discard all three `__firstClass*` properties because they are internal metadata | Production removes `__firstClassSyntax` only from `fn` nodes and import metadata only from recognized first-class imports; evolved custom nodes retain same-named generic properties | The checker projection now mirrors the production type/marker conditions, and a RED-then-GREEN regression binds all three names on an evolved custom node |
| The successful-line projection could always delete `styles`, `pseudoStyles`, and `themeRefs` from `child.finalProps` because those names represented structural fields | `parseLine` also admits those names as ordinary generic properties in `ParsedLine.props`; only `toNode` overlays them when corresponding structural syntax is non-empty | The checker reconstructs props from authenticated export, hint, keyword, and generic-property writes, keeps structural fields separate, and a collision regression proves both representations simultaneously |
