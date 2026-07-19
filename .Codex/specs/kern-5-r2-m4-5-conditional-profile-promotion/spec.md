# KERN 5 R2 M4.5 — Conditional Profile Promotion and Remeasurement

**Status:** COMPLETE — capability/evidence gate closed; publication pending

**Parent objective:** advance the cumulative KERN-authored canonicalizer only
after the M4.4 conditional implementation and its causal M4.3c selection
evidence are sealed.

## Grounded Evidence

[VERIFIED] M4.4 at `54517adae4ce626f08c8aaf68b9f2f33917dc9d3`
implements recursive `if` / sibling `else` validation and emission without
adding a host dispatch or changing KIR/runtime/public contracts. The exact tree
passes the complete Node 22 `pnpm fitness:kern-5` wall and final review
`review-1784470527261-w0lc8x` reports zero verified findings.

[VERIFIED] The active base remains
`kern.kir-canonicalizer.profile.m4.3c`: binary is promoted, while conditional
remains an active candidate. Live format-4 evidence measures nine corpus
members, 104 functions, four base-complete functions, and still selects
conditional with two functions, one tool, 1,140 occurrences, and witnesses
`pathAppendKey` and `failResult`.

[VERIFIED] The immutable M4.3c pre-implementation selection artifact already
has the intended causal role. Digest
`fe15f0ff4b8b80653ddef7f3b8736f38fa2b34a928d05a32bb9eff4d0f254f2b`
pins commit `736e2d1237b6d154b7abbf5f853103c459627424`, the eight-member/99-function
measurement, and the exact conditional winner before M4.4 changed executable
or corpus bytes.

## Decisions

[DECIDED] M4.5 is promotion and remeasurement only. It changes no KERN
canonicalizer source, family ranking, corpus membership, shared KIR/runtime
contract, public ABI, or ownership claim.

[DECIDED] Reuse the existing M4.3c conditional-selection artifact as the
conditional promotion evidence. Do not create a third provenance file: that
would duplicate an already immutable causal record and introduce another truth.

[DECIDED] The cumulative profile id becomes
`kern.kir-canonicalizer.profile.m4.5`. Its promotions are ordered historical
facts: binary cites the M4.3a digest and conditional cites the M4.3c digest.

[DECIDED] The base adds node kinds `if` and `else` plus property `if.cond`.
Conditional structural admission remains exact: one required condition on
`if`, no properties on `else`, immediate sibling pairing, supported recursive
statement children, terminal direct returns, return-type symmetry, and the
existing expression/profile ceilings.

[DECIDED] Remove `conditional` from active candidates and remeasure before
choosing any next implementation. A non-null result authorizes a later slice;
M4.5 must not implement it.

## RED and Mutation Contract

[PROPOSED] Before changing production profile data, update the promotion test
to require the M4.5 id, both exact evidence rows, the widened conditional base,
and the absence of conditional from active families. It must fail against the
sealed M4.4 policy.

[PROPOSED] Mutations must reject an unknown profile id, missing or reordered
promotion evidence, wrong conditional digest, base/candidate overlap, missing
`if.cond`, property-bearing `else`, orphan/non-adjacent `else`, unsupported
conditional children, nonterminal direct returns, malformed condition
expressions, and profile-limit overflow.

[PROPOSED] Production measurement must authenticate every promotion by matching
both the family id and digest against the loaded immutable provenance records;
it must not assume all promotion rows cite one historical record.

## Expected File Surface

- `coverage-policy.json`: M4.5 cumulative base and active candidates.
- `coverage-profile.mjs`: exact M4.5 base and conditional shape validation.
- `coverage-implementation.mjs`: family-keyed promotion evidence checks.
- promotion, handoff, coverage, and terminal checker tests: exact new state.
- `coverage-summary.json`: deterministic post-promotion measurement.
- this spec and the release train: exact evidence and slice boundary.

## Acceptance

- [x] RED promotion contract fails against the sealed M4.4 policy.
- [x] M4.5 base cites both immutable causal selection records exactly.
- [x] Conditional is base-owned and absent from active candidates.
- [x] Conditional shape/profile mutations fail closed.
- [x] Remeasurement pins six of 104 base-complete functions and selects
      `call-expression`: two functions, one tool, 481 occurrences, with
      witnesses `pathAppendIndex` and `reasonLengthMismatch`.
- [x] No following family is implemented in this slice.
- [x] Focused Node 22 canonicalizer gate passes 61 Node tests, 18 golden/KIR
      fixtures, five measured witnesses, three profile-limit fixtures, and 128
      hostile fixtures.
- [x] Complete Node 22 `pnpm fitness:kern-5` wall passes, including the
      432-fixture cross-target suite, 109 class fixtures, 48 checker-subset
      fixtures, 39 validator verdicts, 40 whole-app fixtures on three legs,
      browser budget, KIR seam/export guards, source-runner convergence, and
      the repeated canonicalizer proof.
- [x] Full usable-roster exact-tree Agon review
      `review-1784472947300-f8nh4e` completed five of six engines with zero
      verified findings; Codex exhausted its account limit. The five
      needs-check claims were disproven against the exact M4.5 profile: the
      two-record provenance set and promotion order are exact and fail closed,
      statement children remain constrained by the shared statement grammar
      and terminal-return rules, empty promoted conditionals are intentional,
      and catalog-derived property keys plus coverage closure detect drift.
- [ ] Signed commit is fetched/rebased before one verified push.

## Stop Conditions

Stop and re-adjudicate if promotion needs a new public/shared contract, a KERN
source change, ranking changes, invented historical values, a second capability
registry, or any weakening of catalog closure, profile limits, deterministic
receipts, causal provenance, or hostile mutation coverage.

Confidence: 0.99. Profile mechanics, causal evidence, focused behavior, the
post-promotion measurement, complete wall, and independent review are verified;
signed publication remains.
