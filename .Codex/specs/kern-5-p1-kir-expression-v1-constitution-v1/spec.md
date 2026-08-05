# KERN 5 Phase 1: expression-v1 Structural Constitution v1

**Status:** approved implementation contract
**Base:** `c0770467a82bbc969c9b7562aa45644915a8d145`
**Risk:** high internal shared-format and evidence-policy change
**Planning tribunal:** `tribunal-1785952756526-8oflkr`
**Confidence:** 0.94

## Problem

[FACT] The composed runner denominator contains sixteen identities. Current
main proves twelve through encoded Module KIR and classifies four as structural
blockers.

[FACT] `expression-v1` already exists in `NODE_TYPES`, `NODE_SCHEMAS`, the
structural constitution, and the internal sync/async effect machine. Its
required `expr` property is schema kind `rawExpr`, which the global constitution
policy maps to `excluded-host-expression`.

[FACT] The structural writer, reader, runtime inflater, and bounded expression
validator already share a closed `lowered-expression` representation. The
blocker is property admission, not a missing expression value codec.

[DECISION] This slice promotes exactly `(expression-v1, expr)` to that existing
closed representation. It must not promote any other `rawExpr` property and
must not introduce a second expression schema.

## Tribunal decision

[DECISION] Implement one existing-node blocker before `branch`, `each`, or
node-level `lambda`.

[DECISION] Do not bundle `branch.on` or `each.in`. Although those properties use
the same serialization machinery, their executable contracts are different:
branch selection and path bodies, collection iteration and scope, and
expression-v1 binding evaluation require separate causal witnesses.

[DECISION] Do not add structural node-level `lambda` in this slice. That work
must separately resolve source spelling, node schema, children, environment
capture, and the distinction from the already admitted lambda expression kind.

## Property-scoped authority

[DECISION] The constitution generator owns one closed override table keyed by
the exact pair `expression-v1.expr`.

[DECISION] The override maps schema kind `rawExpr` to disposition
`lowered-expression` and reason `portable-expression-required`.

[DECISION] The global `rawExpr` policy remains
`excluded-host-expression / opaque-host-expression-forbidden`.

[DECISION] Constitution tests must prove all of the following:

- `expression-v1.expr` is the only `rawExpr` row admitted by the new override;
- `branch.on` remains `excluded-host-expression` and required;
- `each.in` remains `excluded-host-expression` and required;
- an invented override pair, duplicate pair, schema-kind mismatch, or global
  `rawExpr` promotion fails closed;
- `expression-v1.type` remains optional `excluded-host-type`.

[DECISION] The override is stable internal protocol policy, not operational
routing policy, and may therefore be a literal closed table with mutation
tests.

## Structural format transition

[DECISION] Property admission changes which artifacts the structural writer and
reader accept. Bump the internal constitution format from
`kern.kir.structural.r1.5e.1` to `kern.kir.structural.r1.5f.1` and the artifact
format from `kern.kir.structural.r1.5e.1-alpha` to
`kern.kir.structural.r1.5f.1-alpha`.

[DECISION] The handler type-admission contract is unchanged. Its independent
`kern.type-admission.r1.5e.1-handler` identifier remains stable unless a current
test proves the artifact format mechanically requires a lockstep bump.

[DECISION] The reader rejects predecessor and unknown artifact versions before
returning an artifact. There is no compatibility fallback or dual-version
reader.

[DECISION] Regenerate `constitution.json` and `catalog.generated.ts` only
through the repository generator. Generated files may exceed the handwritten
500-line rule.

## Expression representation

[FACT] The existing projector admits the closed kinds `identifier`, `null`,
`boolean`, `integer`, `decimal`, `text`, `list`, `record`, `member`, `index`,
`call`, expression `lambda`, `binary`, `unary`, and `conditional`.

[DECISION] Reuse that exact set. This slice does not expand expression kinds,
operators, calls, constructors, templates, regexes, spread, await, casts, or
host objects.

[DECISION] The primary witness source is `1 + 6`. Its canonical value is an
exact binary-expression record and its inflated source must preserve operator
precedence and evaluate to integer `7`.

[DECISION] Add a new focused core test file because
`packages/core/tests/kir-structural.test.ts` is already 490 lines. The new file
must remain under 500 lines and is selected by the existing
`--testPathPatterns=kir-structural` gate.

[DECISION] Focused codec tests prove:

- canonical writer/reader bytes for an `expression-v1` node;
- exact canonical binary-expression record shape;
- runtime inflation back to the expected expression source;
- missing, empty, malformed, unknown-kind, and decorated expression records
  reject with stable error codes;
- populated optional `type` remains rejected;
- the predecessor artifact format rejects deterministically;
- a retained `branch.on` and `each.in` payload still rejects.

## Executable runner witness

[DECISION] Add one static composed witness tuple in live runner order:

- `id`: `expression-v1`;
- `witnessId`: `kir-runtime-compose.expression-v1.v1`;
- `semanticEnvelopeId`: `binary-seven`;
- `fixtureId`: `expression-v1-binary-seven`;
- `oracleId`: `exact-expression-v1-result`;
- `excludedProperties`: `type:excluded-host-type`.

[DECISION] Its authored body executes `expression-v1 name=answer expr="1 + 6"`
and returns `answer`. Its independent exact oracle is a successful integer
result `7` with no diagnostics or events.

[DECISION] Its causal control changes only the operative expression to `1 + 7`
and must not equal the authoritative envelope.

[DECISION] The existing static evidence boundary remains authoritative: the
full witness table is registered directly, exact oracle lookup is bound, Module
KIR bytes flow through both production internal handlers, results reach exact
assertions, runtime imports are closed, and shadowing/reassignment/dynamic
loader bypasses reject.

## Coverage ledger and eligibility

[DECISION] Bump the coverage-ledger format from
`kern.kir.coverage-witness-ledger.r1.5e.1` to
`kern.kir.coverage-witness-ledger.r1.5f.1` because it binds the new constitution
format and changed expression-v1 property/node evidence.

[DECISION] The `expression-v1.expr` property ledger row becomes:

- disposition `lowered-expression`;
- reason `portable-expression-required`;
- fixture `1 + 6`;
- one unique populated-accept witness ID.

[DECISION] The expression-v1 node ledger row and mirrored source-coverage row
become `lowered-semantic`, with a unique accept witness ID. The property and
node ordering remain unchanged.

[DECISION] Coverage closure must independently compare the exact canonical
binary-expression record rather than trusting a writer result as its own
oracle.

[DECISION] Eligibility must transition atomically from `{16,12,4,0}` to
`{16,13,3,0}`. Remaining blockers are exactly:

- `branch`: `required-on:excluded-host-expression`;
- `each`: `required-in:excluded-host-expression`;
- `lambda`: `source-node-absent`.

[DECISION] Deleting or retaining the expression-v1 blocker, widening branch or
each, changing the optional-type disclosure, changing any witness tuple, or
editing counters without live evidence fails closed.

## Receipt and fitness authority

[FACT] The existing structural-constitution, structural-codec,
coverage-closure, runner-composed-evidence, and eligibility commands are
already current fitness and Alpha receipt oracles.

[DECISION] Do not add a redundant root command. Extend the existing gates and
bind the new focused core test file into the Alpha receipt authority set.

[DECISION] Update every exact receipt binding or digest affected by the
constitution, generated catalog, formats, coverage ledger, eligibility policy,
fixture table, and tests. The receipt still reports Alpha and keeps public
status false.

[DECISION] Support-matrix wording may narrow the remaining blocker count but
must not promote `versioned-kir-v1`, `kir-v1`, `test:kern-ir`, runtime cutover,
or any public export.

## Binary acceptance criteria

1. [DECISION] Before implementation, the new contract is RED: current
   constitution classifies `expression-v1.expr` as excluded and eligibility
   reports 12 witnessed / 4 blocked.
2. [DECISION] Exactly one property-scoped override exists and the global
   `rawExpr` policy is unchanged.
3. [DECISION] Checked-in constitution and generated runtime catalog reproduce
   byte-identically with the new internal format.
4. [DECISION] The focused writer/reader tests prove exact binary-expression
   bytes, inflation, mutation rejection, retained blockers, and predecessor
   rejection.
5. [DECISION] Coverage closure authenticates the changed node/property rows and
   all 302 nodes / 1149 properties remain classified.
6. [DECISION] The composed evidence gate executes thirteen witnesses in both
   sync and async modes, including a causal expression-v1 control.
7. [DECISION] Eligibility returns `{16,13,3,0}` and derives all three remaining
   blockers from live source/constitution facts.
8. [DECISION] Alpha receipt tests bind every changed authority and require the
   existing exact oracles.
9. [DECISION] Lint, build, focused gates, the full `fitness:kern-5` wall, and
   diff hygiene pass.
10. [DECISION] Full-roster Agon review uses `claude,codex,agy`, automatic risk,
    `primary-engine=codex`, and role lenses; every finding is verified against
    current files before shipping.
11. [DECISION] The final commit uses mandatory Agon authorship/footer, fetches
    current main, pushes once, verifies remote SHA, and immediately begins the
    next runner blocker slice.

## Mutation attacks

[DECISION] Tests must kill at least these wrong implementations:

- globally map every `rawExpr` to `lowered-expression`;
- promote `branch.on` or `each.in` incidentally;
- add a second expression version or fallback reader;
- retain the old artifact version while accepting the wider domain;
- accept a raw string instead of the canonical expression record;
- accept unknown or decorated expression fields;
- populate the still-excluded `expression-v1.type`;
- register a witness label without executing the expression-v1 node;
- use the composed handler result as its own expected oracle;
- leave expression-v1 classified as a structural blocker after admission;
- remove a remaining blocker or claim 16/16 closure;
- promote any public KIR/version/cutover claim.

## Likely file surfaces

[HYPOTHESIS] Handwritten changes should remain bounded to:

- `scripts/kir-structural/constitution.mjs` and its test;
- `packages/core/src/kir-structural/types.ts`;
- one new focused structural expression-v1 test;
- composed witness fixtures and eligibility tests/validator constants;
- coverage ledger validator/checker/tests and targeted ledger rows;
- Alpha receipt bindings/tests and narrowly affected documentation.

[HYPOTHESIS] Mechanical outputs are
`scripts/kir-structural/constitution.json` and
`packages/core/src/kir-structural/catalog.generated.ts`.

[DECISION] Do not edit production runtime-machine or expression-codec logic
unless the focused RED test proves a missing behavior. Existing codec/runtime
reuse is a load-bearing scope constraint.

## Explicit non-claims

[DECISION] This slice does not:

- promote `branch.on`, `each.in`, or node-level `lambda`;
- expand the closed structural expression-kind or operator catalogs;
- support `expression-v1.type`;
- change the frozen public runtime handler ABI;
- freeze or publicly export KIR v1;
- enable `test:kern-ir`, semantic cutover, or public reader export;
- change package versions, publish artifacts, tag a release, or deploy;
- claim complete runner, compiler, formatter, frontend, or self-hosting
  ownership.

## Next unlocked slice

[DECISION] After the exact 13/3 transition ships, plan `branch.on` as the next
single existing-node property admission using the same property-scoped
mechanism and a branch-selection causal witness. `each.in` follows with
collection/scope proofs. Node-level `lambda` remains a separate architecture
spec.

## Verification sequence

1. Record the current 12/4 result and excluded expression-v1 property as RED
   evidence for this contract.
2. Add constitution and focused codec tests that demand the one-pair override,
   retained blockers, exact new formats, and canonical binary record.
3. Implement the override and regenerate constitution/catalog mechanically.
4. Transition coverage ledger/source coverage and digests to the exact new
   formats and rows.
5. Add the expression-v1 composed witness, independent oracle, causal control,
   and eligibility 13/3 mutations.
6. Run focused gates, lint/build, Alpha receipt, and full KERN 5 fitness wall.
7. Run all-engine Agon review, verify/fix blockers, commit, fetch, push once,
   verify remote main, and begin the branch slice.
