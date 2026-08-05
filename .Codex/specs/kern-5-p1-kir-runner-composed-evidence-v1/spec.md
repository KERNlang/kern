# KERN 5 Phase 1: KIR Runner Composed Evidence v1

**Status:** approved implementation contract
**Base:** `57812e3545725eed1505ab2abb586ba3c70519cc`
**Risk:** medium internal evidence and authority classification
**Initial promotion tribunal:** `tribunal-1785946925975-f29leh`
**Structural-blocker brainstorm:** `brainstorm-1785947329227-pkrtew`
**Corrected evidence tribunal:** `tribunal-1785947425416-dlu6b5`
**Confidence:** 0.96

## Problem

[FACT] The internal decoded Module KIR binder now proves canonical bytes can be
decoded, linked, inflated, and executed through the frozen runtime handler.

[FACT] `REQUIRED_RUNNER_CONTRACTS` is the live 16-identity runner denominator,
but eligibility still classifies every row as a KIR-to-runtime deferral.

[FACT] A universal 16-row composed-path corpus cannot exist at this base:

- `each.in`, `branch.on`, and `expression-v1.expr` are required properties with
  the `excluded-host-expression` disposition;
- `lambda` is a runner contract but is absent from `NODE_TYPES` and the
  structural constitution.

[FACT] Twelve runner identities have at least one bounded structural envelope
that can be encoded without their optional excluded properties: `assign`,
`capability`, `do`, `fmt`, `for`, `if`, `let`, `print`, `return`, `throw`,
`try`, and `while`.

[DECISION] This slice adds executable composed evidence for those twelve
bounded envelopes and mechanically authenticates the four structural blockers.
It does not claim complete runner semantics, expand the constitution, or
promote public KIR v1.

## Authority model

### Denominator

[DECISION] `REQUIRED_RUNNER_CONTRACTS` remains the sole runner roster authority.
The validator independently extracts that static literal rather than trusting
policy-authored row counts.

[DECISION] The policy classifies every roster identity into exactly one of two
variants:

- `internal-composed-witness`: a normalized tuple containing `id`,
  `witnessId`, `semanticEnvelopeId`, `fixtureId`, `oracleId`, and
  `excludedProperties`;
- `structural-blocker`: `id`, a live-derived `blockerId`, and
  `nextMilestone: P1-constitution-expansion`.

[DECISION] The closed-world summary is derived, never stored:

- total runner contracts: 16;
- bounded composed witnesses: 12;
- authenticated structural blockers: 4;
- unclassified runner contracts: 0.

[DECISION] `unclassified: 0` means only that every roster identity is either a
bounded witness or an explicit blocker. It does not mean runner semantics,
structural coverage, or public readiness is complete.

### Witness binding

[DECISION] A new core fixture module exports
`COMPOSED_RUNNER_WITNESSES` as a top-level static literal with no spreads,
computed properties, dynamic construction, or duplicate identities.

[DECISION] Eligibility independently parses and normalizes the full witness
tuples, hashes their canonical JSON form, and requires the policy catalog digest
and witness rows to match. An ID-only digest is insufficient.

[DECISION] The executable test imports the same static fixture table but uses
separate fixture builders and exact-envelope oracles keyed by `fixtureId` and
`oracleId`. Each tuple is therefore bound to both the authored input and the
assertion that distinguishes its behavior.

[DECISION] The twelve witnessed rows disclose optional excluded properties:

- `capability`: `input:excluded-host-expression`;
- `let`: `expr:excluded-host-expression`, `type:excluded-host-type`;
- `fmt`: `type:excluded-host-type`;
- all other witnessed rows: none.

These disclosures prevent a bounded witness from masquerading as complete
property-level support.

### Structural blockers

[DECISION] Blocker facts are derived from live `NODE_TYPES` and the checked-in
structural constitution:

- `lambda` -> `source-node-absent`;
- `branch` -> `required-excluded-host-expression:on`;
- `each` -> `required-excluded-host-expression:in`;
- `expression-v1` -> `required-excluded-host-expression:expr`.

[DECISION] Policy text cannot invent or retain a blocker after the live source
and constitution stop proving it. Any missing, extra, reordered, duplicated, or
reclassified row fails closed.

## Composed semantic witnesses

[DECISION] Every witness executes this production path:

`encodeModuleKir -> canonical bytes -> decodeModuleKir/link/inflate ->
executeInternalRuntimeKirHandlerSync/Async -> normalized runtime envelope`.

[DECISION] The row-specific semantic envelopes are:

| ID | Discriminating authored behavior | Exact semantic signal |
| --- | --- | --- |
| assign | bind `value=1`, assign `value=7`, return it | integer result `7` |
| capability | call `storage.get`, bind and return result | one exact capability event and text result |
| do | mutate an owned map with `Map.set`, then read it | integer result `7` |
| fmt | format a bound value into `value=7` | exact text result |
| for | accumulate the bounded end-exclusive values `1..<4` | exact integer sum `6` |
| if | select the true branch and return its value | exact selected result |
| let | bind and return a portable scalar | exact bound result |
| print | print one scalar then return it | one exact stdout event plus result |
| return | return a portable scalar directly | exact return completion and result |
| throw | throw one canonical error without a catch | `uncaught-throw`, no result/events |
| try | throw, catch, and return a catch-owned value | exact caught result |
| while | increment until the bounded condition is false | exact integer result |

[DECISION] Sync and immediately resolved async modes must each match the row's
exact semantic envelope and encode byte-identically. A capability witness uses
mode-appropriate sync and async capability providers; no mutation test forces
unrelated execution modes into a shared failure mechanism.

## Existing generic authorities

[FACT] The current binder gate already owns decoded-byte authority, exact
identity selection, generic sync/async parity, graph drift, malformed bytes,
signature rejection, and fail-before-capability behavior.

[FACT] The module-graph gate already owns canonical module ordering and input
reordering normalization. KIR evidence separately owns UTF-8 byte locations.

[DECISION] This slice references those receipt-bound authorities instead of
duplicating their generic cases twelve times. It adds only row-distinguishing
semantic outcomes and coverage-classification mutations.

[DECISION] A focused static oracle requires the composed test to use the
production Module KIR encoder and KIR handler entrypoints. It rejects direct
runtime-envelope execution, source handlers, source runners, compiler or loader
fallback, and legacy/reference engines. The already-frozen downstream
structured-expression evaluator remains the one named execution dependency.

## Binary acceptance criteria

1. [DECISION] `pnpm test:kern-kir-runner-composed-evidence` is RED at the base
   because the command, fixture table, executable oracle, and classification do
   not exist.
2. [DECISION] The static witness inventory is exactly the twelve ordered runner
   identities above and every full normalized tuple matches its policy row and
   catalog digest.
3. [DECISION] Each witness executes only through the production canonical-byte
   binder path and matches its exact sync and async normalized envelope.
4. [DECISION] Deleting a witness, duplicating or reordering an identity,
   changing a witness/fixture/oracle/envelope ID, changing a node kind, or
   weakening an expected envelope fails.
5. [DECISION] The four blockers are reproduced from live source and constitution
   facts. Flipping a disposition, required flag, property name, node presence,
   blocker ID, or next milestone fails.
6. [DECISION] Optional excluded properties for `capability`, `let`, and `fmt`
   are disclosed exactly; removing or inventing a disclosure fails.
7. [DECISION] The validator returns `{16, 12, 4, 0}` only from the classified
   live denominator and rejects policy-authored counters or unknown row fields.
8. [DECISION] The static import boundary rejects any bypass around
   `encodeModuleKir` and the KIR handler, or any source/compiler/legacy fallback.
9. [DECISION] One narrowly named internal gate is current and Alpha-receipt
   bound. Its output says `12/16 bounded composed witnesses; 4 structural
   blockers; ALPHA-NO-GO`.
10. [DECISION] All public/status invariants remain exact: `decision=no-go`,
    `ALPHA-NO-GO`, `kirV1Frozen/publicExport/semanticCutover=false`,
    `public-versioned-kir-runtime-cutover` deferred, `test:kern-ir` absent, and
    `versioned-kir-v1` not shipped.

## Mutation attacks

[DECISION] The oracle must kill these plausible wrong implementations:

- derive the runner denominator from `NODE_TYPES` and silently omit `lambda`;
- hash only witness IDs while fixture or oracle identities drift;
- call the internal runtime envelope directly instead of decoding Module KIR;
- swap a fixture's target node kind while retaining its row label;
- accept a constant success or failure envelope for multiple witnesses;
- infer a blocker from policy text instead of live constitution facts;
- erase optional excluded-property disclosures and claim full row support;
- count missing or duplicate rows as classified;
- promote ALPHA/public/versioned status because twelve bounded envelopes pass.

## Gate, receipt, and documentation changes

[DECISION] Add `test:kern-kir-runner-composed-evidence` to the root package,
fitness policy, fitness contract test, and support matrix as a current internal
oracle immediately after `internal-decoded-module-kir-binding`.

[DECISION] Bind the fixture table, executable test, static closure oracle,
eligibility policy/validator/tests, package command, fitness evidence, and
support matrix into the Alpha receipt. Add the focused command as a required
Alpha oracle. Receipt status remains unchanged.

[DECISION] The support matrix gains a narrowly named internal ownership row. It
does not change `versioned-kir-v1`, `kir-v1`, or any Phase 2 row.

## Explicit non-claims

[DECISION] This slice does not:

- add `lambda` to the structural constitution;
- lower `branch.on`, `each.in`, `each.key`, or `expression-v1.expr`;
- claim full property coverage for any witnessed row;
- freeze or publicly export KIR v1;
- alter the frozen public runtime handler ABI;
- promote `pnpm test:kern-ir`;
- change the product version, publish packages, tag a release, or cut over the
  canonical engine;
- claim frontend, compiler, formatter, or self-hosting ownership.

## Likely files

[HYPOTHESIS] The smallest complete diff adds one static fixture module, one
table-driven core test, and one repository-level static closure oracle. It
updates `eligibility.json`, `validate-eligibility.mjs` and its mutation tests,
the root package command, fitness policy/test, support matrix, and Alpha receipt
policy/generator/tests. No production encoder, decoder, runtime, constitution,
or generated catalog file should change.

## Next unlocked slice

[DECISION] Passing this gate unlocks
`p1-kir-runner-constitution-blockers-v1`: define structured representations for
`branch.on`, `each.in`/`each.key`, and `expression-v1.expr`, plus an explicit
lower-or-constitutionalize decision for node-level `lambda`. Only after those
four facts are removed can a genuine 16-contract composed-path closure gate be
claimed.

## Verification sequence

1. Prove the new package command is absent/RED at the base.
2. Add validator mutation tests and the static fixture contract; keep the
   executable semantic gate RED.
3. Implement the twelve table-driven witnesses and static import-boundary
   oracle.
4. Apply the mixed 12+4 eligibility classification and Alpha receipt binding.
5. Run focused core, eligibility, receipt, fitness-contract, lint, build, and
   full `pnpm fitness:kern-5` gates.
6. Run full-roster Agon review with role lenses and the actual primary engine,
   verify every finding against current files, and fix only proven issues.
7. Commit with mandatory Agon attribution, fetch/rebase, push once to `main`,
   verify the remote SHA, and begin the constitution-blocker slice.
