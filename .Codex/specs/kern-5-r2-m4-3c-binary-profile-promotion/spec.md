# KERN 5 R2 M4.3c — Binary Profile Promotion and Remeasurement

**Status:** SEALED — COMPLETE WALL PASSED

**Parent objective:** advance the M4 canonicalizer toward self-application by
turning the sealed M4.3b binary tranche into cumulative measured-profile input,
then select the next tranche from the resulting evidence.

## Grounded Evidence

[VERIFIED] M4.3b implements recursive, fully parenthesized canonicalization for
the exact 24 catalog-backed binary operators. Fourteen golden/idempotence/KIR
fixtures, all three selected witnesses, three profile-limit fixtures, 119
hostile fixtures, and the complete Node 22 `pnpm fitness:kern-5` wall pass.

[VERIFIED] The active coverage policy is still
`kern.kir-canonicalizer.coverage-policy.1`. Its base is frozen to the M4.1
expression kinds and its candidate families still contain `binary-expression`.
The live M4.3b receipt therefore reports one of 99 functions base-complete and
selects binary again with three complete functions, one tool, 1,002
occurrences, and the three `diag.kern` witnesses.

[VERIFIED] Frozen M4.3a selection provenance is already a separate,
digest-pinned artifact. Its digest is
`35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027`;
it records 98 functions, four tools, seven corpus members, 941 binary
occurrences, and the same three witnesses.

[VERIFIED] `validateCoverageBase` currently rejects any cumulative profile,
while `validateCoverageFamilies` correctly rejects a fact claimed by both the
base and an active candidate family. The active policy cannot advance without
an explicit versioned state transition.

## Tribunal Decision and Plan Delta

[VERIFIED] Adversarial tribunal `tribunal-1784462360975-z5eo4k` completed six of eight
argument turns across Antigravity, Claude, and MiniMax. Codex failed both
dispatch attempts at its stdin boundary; Kimi's synthesis timed out. The
degraded panel is recorded rather than treated as full consensus.

[DECIDED] Ship a standalone promotion-and-remeasurement slice. Do not combine
it with implementation of the newly selected family.

[DECIDED] The initial approach widened an unversioned `base`. The tribunal
improved it: the active cumulative profile must have an explicit stable id and
must carry immutable promotion evidence. The existing M4.3a provenance remains
the historical pre-implementation measurement; the current active profile is
the single capability truth.

[REJECTED] Do not add an `implementedFamilies` scoreboard beside the base. It
would create two capability truths.

[REJECTED] Do not add a timestamped receipt seal or defer base mutation until a
receipt under the new base already exists. A timestamp breaks deterministic
bytes, and requiring a widened-base receipt before widening the base is
circular. Policy/source/provenance digests already provide immutable evidence.

## Scope

[PROPOSED] Introduce coverage-policy format 2 with an exact cumulative base
profile id. The M4.3c profile contains the M4.1 node/property surface plus
`binary` in `expressionKinds` and one exact promotion-evidence row:

```json
{
  "id": "kern.kir-canonicalizer.profile.m4.3c",
  "promotions": [
    {
      "family": "binary-expression",
      "selectionProvenanceDigest": "35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027"
    }
  ]
}
```

[PROPOSED] Remove `binary-expression` from the active candidate-family list.
Keep the frozen family registry unchanged: it is the catalog of known family
definitions, not the list of currently unsupported facts.

[PROPOSED] Bind the exact active base profile into the coverage receipt and
summary, and version those output schemas. Receipt and summary regeneration
must remain canonical and byte-deterministic.

[PROPOSED] Remeasure the same authenticated corpus under the cumulative binary
profile. Record the exact base-complete count, ranking, winner-or-null, score,
and witnesses produced by the existing deterministic selection rule.

[PROPOSED] Stop after evidence regeneration even if a next winner appears. A
non-null winner authorizes a later tribunal/spec/implementation slice; it does
not authorize family implementation inside M4.3c.

## Non-Goals

- No canonicalizer KERN source change.
- No second expression or statement family.
- No corpus expansion or structured-parameter migration.
- No public formatter, frontend, compiler, runtime, handler, or KIR ABI claim.
- No ownership-row promotion beyond the existing internal canonicalizer oracle.
- No change to family ranking weights or tie-breaking.
- No weakening of profile limits, catalog closure, or authenticated facts.

## Exact Contract

[PROPOSED] `validateCoveragePolicy` accepts only format 2 and an exact base
record containing `expressionKinds`, `id`, `nodeKinds`, `promotions`, and
`propertyKeys`.

[PROPOSED] `validateCoverageBase` accepts only named, exact cumulative profiles.
For M4.3c it requires the previous M4.1 node/property surface, the sorted M4.1
expression surface plus `binary`, and the exact single promotion row above.
Unknown ids, wrong evidence digests, missing/extra/reordered rows, or a profile
whose facts do not match its id reject.

[PROPOSED] The active candidate list stays sorted, unique, registry-exact, and
coverage-closed over every observed fact not present in the cumulative base.
Any base/candidate overlap rejects.

[PROPOSED] The receipt exposes the exact validated base record. The summary
copies it exactly. Both remain bound to raw coverage-policy bytes,
canonicalized policy data, authenticated implementation dependencies, corpus,
canonicalizer composition, policy, catalog, and frozen selection provenance.

[PROPOSED] The selection algorithm itself is unchanged: each candidate is
measured as cumulative base plus that one candidate; newly complete functions
exclude functions already complete under the cumulative base; ranking remains
complete functions, complete tools, occurrences, then id.

## RED Tests

1. The current format-1 policy and current unversioned base fail the new
   profile contract.
2. M4.3c rejects a missing `binary`, a duplicate/extra promotion, a wrong
   provenance digest, an unknown profile id, and a reordered promotion list.
3. Keeping `binary-expression` active after binary enters the base rejects as a
   duplicate profile claim.
4. Removing another observed family still rejects coverage closure.
5. Receipt and summary expose exactly the validated M4.3c base profile; any
   checked-in summary drift rejects.
6. Frozen M4.3a provenance remains byte/digest exact and is the evidence cited
   by the M4.3c promotion row.
7. Repeated measurement and summary generation are byte-identical.
8. The measured base-complete count and next winner-or-null are pinned only
   after running the new policy against the authenticated corpus.

## File Plan

| Surface | Action | Purpose |
| --- | --- | --- |
| `scripts/kern-canonicalizer/coverage-policy.json` | modify | format-2 cumulative base and active candidates |
| `scripts/kern-canonicalizer/coverage-profile.mjs` | modify | exact named-profile validation |
| `scripts/kern-canonicalizer/coverage-implementation.mjs` | modify without exceeding 500 lines | parse/bind the profile and expose it in receipts |
| `scripts/kern-canonicalizer/coverage-summary.json` | regenerate | exact post-promotion evidence |
| `scripts/kern-canonicalizer/coverage-promotion.test.mjs` | add | isolated RED promotion contract |
| existing coverage/check tests | modify | pin schema and measured outputs |
| release train/spec | modify | durable slice result and review/gate evidence |

## Acceptance Criteria

- [x] RED promotion tests fail for the intended missing format/profile support.
- [x] Policy format 2 and exact M4.3c cumulative base validation pass.
- [x] Binary is absent from active candidates and cannot be claimed twice.
- [x] Frozen M4.3a provenance remains exact and is cited by the active profile.
- [x] Receipt/summary schemas expose the active cumulative profile exactly.
- [x] Post-promotion base-complete count and next winner-or-null are measured and
      pinned without implementing that family.
- [x] All handwritten source files remain below 500 lines.
- [x] `pnpm test:kern-canonicalizer` passes.
- [x] Exact requested Agon review runs with `claude,codex,agy`; any unavailable
      identity is reported as a routing shortfall.
- [x] Complete Node 22 `pnpm fitness:kern-5` passes on the final exact tree.
- [x] Release-train evidence records the exact measurement, review, and wall.

## Stop Conditions

Stop and re-adjudicate if the slice requires changing canonicalizer KERN source,
adding another syntax family, changing ranking semantics, weakening a limit or
closure check, fabricating historical receipt values, introducing a second
capability registry, or promoting a public ABI/ownership claim.

## Confidence

Confidence: 0.98. The cumulative transition, exact measured winner, full wall,
and terminal usable-roster review are complete. The next slice must still
adjudicate the measured `conditional` family before implementation.

## Implemented Measurement

[VERIFIED] The RED policy/profile tests first failed against format 1 and the
unversioned M4.1 base. A separate malformed-binary RED test then proved that
recognizing the promoted kind was insufficient until exact structural shape
and operator validation entered the cumulative profile.

[VERIFIED] Coverage policy format 2 now names
`kern.kir-canonicalizer.profile.m4.3c`, cites the frozen M4.3a provenance
digest, includes `binary` in the cumulative expression kinds, and removes
`binary-expression` from active candidates. Measurement independently compares
the promotion row with the authenticated provenance record before inspecting
the corpus.

[VERIFIED] Receipt format 3 and summary format 3 expose the exact validated
base. The cumulative profile validates binary records through the authoritative
structural-expression validator, including exact `left`/`op`/`right` shape and
the 24-operator set.

[VERIFIED] Remeasurement reports four of 99 functions base-complete. The next
winner is `conditional`: two newly complete functions, one tool, 1,115
occurrences, and witnesses `diag.kern#0:pathAppendKey` and
`diag.kern#3:failResult`. `call-expression` also completes two functions in one
tool but ranks second with 454 occurrences. No second family is implemented.

[VERIFIED] The focused gate passes core and CLI builds, composition and semantic
checks, 56 Node tests, the host canonicalizer suite, and the authenticated
coverage checker. Authored implementation modules remain below 500 lines;
`coverage-implementation.mjs` is 497 lines.

Confidence: 0.98. The profile transition and measured selection are exact; the
terminal independent review and complete KERN 5 wall are now closed.

## Terminal Review Results

[VERIFIED] Exact staged-slice role review
`review-1784463482337-0745ow-kern-5-r2-m4-3c-terminal-exact` covered all nine
M4.3c files against `HEAD`. Claude and Antigravity completed; Codex retried and
failed on its account limit, leaving an explicit 2/3 routing shortfall.

[VERIFIED] Claude found one blocking receipt drift: after the initial receipt
write, the new authenticated summary module lost one trailing blank line during
diff-hygiene cleanup. That byte change correctly invalidated the implementation
digest. The summary was regenerated from the final module bytes, staged, and
the complete focused gate passed again with 56 tests.

[VERIFIED] Antigravity raised one future-facing important concern: the evidence
loop cannot authenticate multiple cumulative promotion rows against the single
M4.3a provenance record. Format 2 deliberately rejects every extra promotion
row and therefore cannot reach that state. A later cumulative profile must bump
the profile/policy contract and introduce separately authenticated provenance
for each newly promoted tranche; it must not append rows under format 2.

[VERIFIED] Targeted post-fix exact-roster review
`review-1784463782524-6v723f-kern-5-r2-m4-3c-post-fix-exact` completed Claude
and Antigravity with no verified actionable finding; Codex again exhausted its
account limit. Claude reran the checker and adversarial probes and returned
clean. Antigravity repeated the documented future multi-promotion constraint
and suggested catching `CanonicalValueDecodeError` around
`validateExpressionValue`; the latter is disproved because that validator does
not invoke the canonical decoder and emits `StructuralKirError` for expression
validation failures.

[VERIFIED] The final slice-only full-usable-roster review
`review-1784464773863-hra3ka-kern-5-r2-m4-3c-terminal-full-ro` completed five
of six engines with zero verified material findings; Codex alone exhausted its
account limit. Claude and Antigravity returned clean. MiniMax's ranking-loop
allocation note is non-blocking and predates this data-contract slice. Kimi
correctly records that `coverage-implementation.mjs` is 497 lines, so the next
promotion/capability slice must extract selection logic before expanding that
module. Z.AI's digest concern is disproved by the recursive local `.mjs`
implementation digest.

[VERIFIED] The final exact staged tree passes the complete Node 22
`pnpm fitness:kern-5` wall, including repository consistency, lint, build,
workspace tests, all infrastructure gates, conformance, runner and application
behavior, runtime ownership/ABI checks, diff hygiene, and the final 56-test
canonicalizer gate.
