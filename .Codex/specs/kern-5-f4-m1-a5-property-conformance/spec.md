# KERN 5 F4A Property-Conformance Closure

**Status:** IMPLEMENTED AND LOCALLY VERIFIED — F4A-LOCAL A5 ONLY
**Date:** 2026-08-22
**Confidence:** 0.98

## Executive Summary

This slice closes the single-document, F4A-local part of F4-A5: exact property
authority binding, required/optional/absent presence, source-ordered duplicate
last-write-wins behavior, the nine frozen schema kinds and nine dispositions,
all three source representations, host/raw exclusion, prototype-colliding
unknown names, and strict decoder ownership. Cross-module `from.as`, default
kind, and re-export resolution move explicitly to M2 F4-A7/C15, where the
complete graph contract can distinguish a correct fixed point from partial
smoke evidence.

The KERN producer already implements the local property behavior. The verified
production defect is in the JavaScript decoder: it accepts a same-width
tampering that changes a duplicate property's effective occurrence from the
last row to the first. The repair must make the decoder bind each occurrence to
the authenticated constitution row and validate the occurrence/presence
relationship without changing the 17-field document `.2` wire shape.

Decision evidence:
`~/.agon/runs/tribunal-1787359910067-zky50u` (4/4 admitted engines; unanimous
round-two recommendation for the local/link split).

## Current State and Root Cause

- **[A5-V1 VERIFIED]** The parent acceptance node still marks F4-A5 PROPOSED
  and bundles local property behavior with link-time normalization.
  Evidence: `.Codex/specs/kern-5-f4-declarations-modules/spec.md:1403-1406`.
- **[A5-V2 VERIFIED]** F4-C5 owns local occurrence identity, catalog ordinal,
  schema kind, required flag, disposition, representation, optional F2B
  segment, and absence-without-default semantics. Evidence:
  `.Codex/specs/kern-5-f4-declarations-modules/spec.md:112-118`.
- **[A5-V3 VERIFIED]** F4-C12 separately owns `from` alias/kind/re-export
  defaults as link-time graph normalization, not schema-property defaulting.
  Evidence: `.Codex/specs/kern-5-f4-declarations-modules/spec.md:144-151`.
- **[A5-V4 VERIFIED]** The authority contains exactly 1,149 property rows, nine
  schema kinds, nine dispositions, 314 required rows, 835 optional rows, and
  one closed enum row. Evidence: `scripts/kir-structural/constitution.json`;
  verified on 2026-08-22 by a Node inventory over `properties`.
- **[A5-V5 VERIFIED]** The host transports every authority coordinate without
  classifying it, and KERN authenticates/builds owned maps before projection.
  Evidence: `scripts/kern-frontend-f4-declarations/worker.mjs:88-117` and
  `examples/kern-frontend/f4-declarations-semantic.kern:110-150`.
- **[A5-V6 VERIFIED]** KERN classifies bare/quoted/expression representations,
  admits through `f4propertyadmission`, emits one 13-field occurrence, retains
  source order, and records the latest ordinal for presence. Evidence:
  `examples/kern-frontend/f4-declarations-semantic.kern:343-407`.
- **[A5-V7 VERIFIED]** KERN emits one presence row for every catalog property
  on each known source row, using `-1` for absence and the latest occurrence
  ordinal otherwise; required `-1` produces the existing missing-property fact.
  Evidence: `examples/kern-frontend/f4-declarations-semantic.kern:438-481`.
- **[A5-V8 VERIFIED]** `f4propertyadmission` has explicit branches for boolean,
  number, identifier, importPath, string, typeAnnotation, expression, rawExpr,
  and rawBlock plus enum filtering and the three frozen host/raw exclusions.
  Evidence: `examples/kern-frontend/f4-expression-evidence.kern:88-148`.
- **[A5-V9 VERIFIED]** Existing tests cover required omission, one unknown
  `constructor`, duplicate name/LWW, quoted/F2B expressions, one rawExpr
  exclusion, C13 facts for all three host/raw exclusions, and partial link
  behavior, but do not close the nine-kind/disposition matrix or decoder
  relationships. Evidence: `document.test.mjs:81-106`,
  `expression-evidence.test.mjs:26-148`, `c13-local-facts.test.mjs:277-291`,
  and `module-set.test.mjs:45-113`.
- **[A5-ROOT VERIFIED]** `decodeOccurrence` validates only row shape, ordinal,
  span, and closed vocabularies; `decodePresence` parses three fields without
  binding them back to occurrences or authority rows. A real duplicate-name
  receipt whose presence row was changed from effective ordinal `2` to `1`
  was accepted by `decodeDocument` on 2026-08-22. Evidence:
  `scripts/kern-frontend-f4-declarations/decoder.mjs:104-143,283-330` and the
  focused same-width mutation probe recorded in this slice's execution log.
- **[A5-BASE VERIFIED]** The defect is pinned to source baseline
  `fc3c8c2ffe3147bc291214ece320b177032491e1`: unchanged public receipts decode,
  while a same-width mutation that changes a duplicate property's effective
  occurrence from its C6-mandated last row to an earlier row is accepted. The
  acceptance oracle must retain both controls so an upstream rejection cannot
  masquerade as a decoder repair.

## What Already Works

The KERN property producer, authority authentication, expression evidence,
host/raw payload erasure, C13 prospective fact admission, A6 detached-local
provenance, path normalization, and module-set linker are not redesign targets.
This slice adds discriminating evidence around them and changes production only
where the decoder RED proves a missing consumer check.

## Contract

> Verified against the sources above on 2026-08-22.

| Field / behavior | Frozen rule | Producer | Consumer | Tag |
| --- | --- | --- | --- | --- |
| Occurrence identity | 13 fields; contiguous ordinal; exact owner kind, property name, catalog ordinal, schema kind, required flag, and disposition | F4A KERN | F4 decoder | VERIFIED |
| Representation | Exactly `bare|quoted|expression`; segment `-1` unless transported expression geometry owns one | F4A KERN | decoder/F2 evidence | VERIFIED |
| Presence | One row per known catalog property on a source row; `-1` means no occurrence; otherwise the exact last occurrence for the same owner/name | F4A KERN | decoder/F5 | VERIFIED |
| Absence/default | Absence has no occurrence and no invented value; F5 alone may select a projection-time default | F4A KERN | F5 | VERIFIED |
| Excluded payload | `excluded-host-expression`, `excluded-host-type`, and `excluded-raw-block` retain occurrence identity/span but value is empty and no expression evidence is emitted | F4A KERN | decoder/F5 | VERIFIED |
| Link normalization | `from.as`, requested-kind/default-kind, and re-export fixed point are F4B graph work | F4A binding intent | F4B | VERIFIED |

### Decoder authority input

The decoder receives the already loaded, hash-checked constitution property
rows as context from the worker. It does not read an alternate authority and
does not invent a smaller catalog. For every occurrence it must require:

1. the catalog ordinal is in range;
2. authority `nodeKind`, `propertyName`, `schemaKind`, `required`, and
   `disposition` equal the receipt row exactly;
3. excluded host/raw dispositions carry an empty value;
4. occurrence spans are nondecreasing in receipt order; and
5. every occurrence key has exactly one presence row whose effective ordinal
   is the last occurrence ordinal for that same owner/name.

Presence keys are unique. A presence `-1` is valid only when no occurrence with
that owner/name exists. The decoder does not claim it can reconstruct the full
per-line authority property set from absent rows alone; KERN authority
authentication remains the producer-side proof of that set.

This is a structural consumer contract, not an independent authentication of
normalized occurrence value bytes. The terminal string seals tape lengths; the
worker-derived receipt SHA changes with any field-byte mutation, but a direct
decoder caller has no external expected SHA to compare. Public `runDocument`
decodes only the fields returned by the one KERN execution. Full external
receipt authentication remains outside this F4A-local slice.

F4-C6 is the authority for last-write-wins. The acceptance oracle varies the
number and position of unrelated preceding occurrences and gives duplicate
rows observably different values. It computes the expected last ordinal from
the decoded unchanged receipt; neither the decoder nor the test may pin a
literal ordinal or special-case one of the nine current schema kinds.

## Implementation Options

### Option B — recommended and decided

Close F4A-local A5 now, fix the decoder relationship gap, and move link-time
normalization to M2 F4-A7/C15 in the same documentation change. This keeps one
owner per contract and gives M1 a binary, discriminating local property gate.

### Option A — rejected

Closing the original bundled A5 sentence would treat current F4B smoke tests as
proof of the not-yet-accepted canonical graph/fixed-point contract. That would
make A5 green without proving M2.

### Option C — rejected for ordering

Doing A3 first would evaluate the remaining semantic source-form corpus against
an incomplete property oracle. A5 supplies the receipt contract A3 should reuse.

## Acceptance Matrix

- **[A5-A1] Authority coverage.** The oracle proves the exact nine schema kinds,
  nine dispositions, required/optional counts, and sole enum row from the real
  constitution; no hand-copied substitute catalog is accepted.
- **[A5-A2] Presence/absence.** A valid optional absence has no occurrence and
  presence `-1`; explicit invalid empty input has an occurrence, non-`-1`
  presence, existing invalid fact/diagnostic, and no invented value.
- **[A5-A3] Required behavior.** Valid required values classify; omission emits
  the frozen missing-property fact and owner-line `UNEXPECTED_TOKEN` without a
  consumable interface.
- **[A5-A4] Duplicate/LWW.** Both occurrences remain in source order with exact
  spans; presence points to the later ordinal; one `DUPLICATE_PROP` warning is
  located at the later property. The oracle repeats this with unrelated
  occurrence prefixes and distinct duplicate values, derives the correct
  ordinal from the unchanged receipt, and rejects every earlier same-key
  ordinal mutation.
- **[A5-A5] Prototype collision.** `constructor`, `__proto__`, `prototype`,
  `toString`, `hasOwnProperty`, and `valueOf` each remain an ordered
  unknown-property fact and never become an occurrence or presence key.
- **[A5-A6] Representations/evidence.** Bare, astral quoted, quoted local-F2,
  and brace F2B inputs retain exact representation, span, segment, occurrence,
  and evidence ownership. F2B is not reparsed locally.
- **[A5-A7] Schema kinds.** Public-path fixtures exercise valid and invalid
  boolean, number, identifier, importPath, string, typeAnnotation, expression,
  rawExpr, and rawBlock behavior. The sole enum admits its first and last value
  and rejects an out-of-set value.
- **[A5-A8] Dispositions.** The matrix observes all nine authority dispositions,
  including branch-path, each-collection, import-path, expression, and type
  lowering plus all three host/raw exclusions.
- **[A5-A9] Exclusion ownership.** Frozen rawBlock/rawExpr/host-type fixtures
  retain exact owner, property, schema, representation, segment, spans,
  presence, fact, and diagnostic while exposing empty value and no expression
  evidence.
- **[A5-A10] Decoder RED.** Equal-width mutations of occurrence authority
  coordinates, occurrence order, stale LWW presence, duplicate presence, and
  excluded payload are rejected before a decoded receipt is returned. Positive
  controls decode unchanged classified and rejected receipts through the same
  worker-supplied context used by `runDocument`. The RED is pinned to
  `fc3c8c2ffe3147bc291214ece320b177032491e1`: unchanged controls must already
  pass and named mutations must be accepted for the missing relationship check,
  rather than fail for an upstream or harness error.
- **[A5-A11] Mutation strength.** Named source canaries kill required inversion,
  missing optional rows, first-write-wins, occurrence dedup, prototype-bearing
  object lookup, representation collapse, enum bypass, F2B reparse, exclusion
  payload leakage, and decoder relationship removal. Aggregate mutation
  percentages are advisory; every named mutant must die.
- **[A5-A11a] Generality guard.** Source inspection requires catalog-driven
  authority lookup by occurrence catalog ordinal and computed last-occurrence
  tracking. Named canaries remove the authority comparison, replace the
  computed last ordinal with a fixture literal, and change last-write-wins to
  first-write-wins; each must fail independently.
- **[A5-A12] Identity/isolation.** Public `runDocument(moduleId, source)` remains
  two arguments; F4A document format remains `.2`, policy remains `.4`, runtime
  ABI remains 109, diagnostic/fact vocabularies do not change, and one source
  document causes exactly one external F4 invocation.

## Blast Radius

| File | Action | Reason |
| --- | --- | --- |
| `.Codex/specs/kern-5-f4-m1-a5-property-conformance/spec.md` | add | Claim-tagged slice contract |
| `scripts/kern-frontend-f4-declarations/a5-property-conformance.test.mjs` | add | Binary public-path and decoder oracle |
| `scripts/kern-frontend-f4-declarations/decoder.mjs` | modify only for proven RED | Authority/presence consumer validation |
| `scripts/kern-frontend-f4-declarations/worker.mjs` | modify only for proven RED | Pass already authenticated property authority to decoder |
| Existing direct decoder tests | update only if decoder context becomes mandatory | Preserve positive/negative decoder coverage |
| `.Codex/specs/kern-5-f4-declarations-modules/spec.md` | amend | Mark local A5 closed and transfer link clause to A7/C15 |
| `.Codex/goals/KERN-5-COMPLETION-GOAL.md` | amend after gates/review | Record bounded evidence without promoting F4 |

No `kern-5-fitness-policy.json` A5 node exists at this revision, so this slice
does not invent or flip one.

## Production Threshold and Kill Switches

- The target is no KERN, policy, generated-authority, F0-F3, F4B, public API,
  diagnostic, fact, format, or ABI change.
- A production change is allowed only for a public-path or direct-decoder RED
  that fails for the contract reason, with root cause traced first.
- Stop and reopen the contract if a fix requires changing the constitution,
  policy `.4`, document `.2`, ABI 109, F4B graph semantics, F2/F2B/F3 formats,
  or frozen diagnostic/fact vocabularies.
- Keep evidence, production repair, and final truth/docs as separate commits so
  any layer is independently revertible.

## Out of Scope

- F4-A3's full semantic 26-form corpus and M3 scale/adversarial expansion.
- Cross-module alias/default-kind/re-export fixed point, cycles, component
  ordering, and canonical graph rows (M2 F4-A7/C15).
- F5 KIR field order or projection-time defaults.
- F4 promotion, terminal frontend promotion, public release, tag, or publish.

## Deploy Order and Skew

Test oracle and strict decoder/worker context ship atomically. There is no
supported skew: a new decoder against an old but valid document `.2` receipt
continues to decode because the authority is unchanged; stale authority
coordinates, occurrence order, presence relationships, or excluded payloads
that previously slipped through now fail closed. No external wire version
changes.

## Local Verification

- RED at `fc3c8c2ffe3147bc291214ece320b177032491e1`: `6/12` passed; the six
  decoder relationship/source guards failed semantically because mutations
  were accepted.
- Focused A5 after repair: `12/12` passed.
- Adjacent A5/decoder/resource wall: `145/145` passed; direct A11 decoder
  aggregate mutation: `1/1` passed.
- Complete F4 declarations wall: `405/405` passed.
- Lint, repository consistency, exact `35/35` descriptor pins, deterministic
  authority regeneration, and diff checks passed.
- Automatic-risk independent Agon review completed `2/2` with no blocker. Its
  value-byte observation produced the explicit structural-authentication
  boundary above; repository-wide caller search found no omitted direct
  `decodeDocument` context.

## Corrections Log

| Original claim | Verified reality | Impact |
| --- | --- | --- |
| A5 must include `from.as`/reexport because its old sentence names them. | F4-C12 and M2 assign those semantics to graph ownership. | Amend A5/A7 atomically rather than weakly closing graph work. |
| The fitness policy has an A5 node to flip. | Repository search on 2026-08-22 found no F4-A5 fitness node; only the root F4 test script exists. | No fitness-policy change. |
| Existing F4B evidence lacks multi-hop re-export coverage. | `module-set.test.mjs:73-113` already has request-order and three-hop smoke tests. | Preserve them as adjacency evidence; do not claim they close C15. |
| A5 could remain evidence-only. | The decoder accepts a stale same-width effective occurrence ordinal. | Add a narrow decoder/worker production repair after RED-at-base. |
