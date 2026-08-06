# KERN 5 P1 runner-synthetic lambda constitution v1

**Status:** approved implementation contract
**Base:** `1c3e5b183a0041a479f801c15dd51571a10ebe99`
**Risk:** high internal structural-format, evidence-authority, and runtime-composition change
**Planning tribunal:** `tribunal-1785977927205-almbck-kern-5-lambda-plan`

## Problem and authority boundary

[FACT] The native runner catalog contains 16 contracts. Fifteen have exact
composed KIR witnesses. `lambda` is the only remaining row and is mechanically
classified as `source-node-absent`.

[FACT] `IRNode.type=lambda` is a fixture/runtime wrapper. Its contract states
that production emitters receive lowered normal KERN statements instead. It is
not present in `NODE_TYPES`, `NODE_SCHEMAS`, or production codegen.

[FACT] `ValueIR.kind=lambda` is a distinct, already-admitted expression form.
The structural expression codec supports only expression-bodied, untyped
lambdas and rejects typed or block-bodied forms.

[FACT] `NODE_TYPES` controls parser recognition, `KERN_RESERVED`, public type
unions, schema discovery, editor/MCP surfaces, and evolved-node collisions.
Adding the runner wrapper there would create unsupported public source syntax.

[FACT] The KERN 5 release train separately binds all canonical source nodes and
all native runner contracts, and says that this split prevents an internal
shadow schema from becoming a public promise.

[DECISION] Keep `NODE_TYPES`, `NODE_SCHEMAS`, `KERN_RESERVED`, source parsing,
source codegen, and the canonical source census byte-identical to the base.

[DECISION] Add a separately named and version-bound runner-synthetic structural
authority. Its only member is `lambda`; it is not a source node and must never
be reported as one.

[INVARIANT] Source `lambda ...` remains an unknown-node diagnostic and cannot
reach production codegen as newly supported syntax.

## Runner-synthetic constitution

[DECISION] Extend the structural constitution with two exact arrays:

- `runnerSyntheticNodes`;
- `runnerSyntheticProperties`.

[DECISION] Extend constitution counts with
`runnerSyntheticNodes=1` and `runnerSyntheticProperties=1`. Existing source
counts stay exactly `sourceNodes=302` and `properties=1149`.

[DECISION] The exact runner-synthetic node row is:

- `id=lambda`;
- `schemaStatus=bound`;
- `allowedChildren=[]`;
- `allowedParents=[handler]`;
- `disposition=structural-candidate`;
- `reasonId=runner-contract-only`.

[DECISION] The exact runner-synthetic property row is:

- `nodeKind=lambda`;
- `propertyName=expr`;
- `schemaKind=rawExpr`;
- `required=true`;
- `values=null`;
- `disposition=lowered-expression`;
- `reasonId=portable-expression-required`.

[DECISION] The runner-synthetic schema and its property-policy override are
defined separately from source `NODE_SCHEMAS` and source override rows. Duplicate
ids across source and runner-synthetic authorities, unknown override targets,
duplicate overrides, and schema-kind drift fail closed.

[DECISION] The generated runtime structural catalog is the ordered union of all
302 source rows followed by the one runner-synthetic row. The checked-in
constitution retains the two provenances in separate arrays.

[DECISION] No lambda setup children are admitted in this slice. Although the
internal runtime contract accepts constrained `let`/`assign` setup fixtures,
the source schema cannot express their parent-sensitive narrowed profiles.
Admitting no children is the smallest executable subset and avoids a false
portable claim.

[DECISION] Runner-synthetic placement is independently governed: lambda is
admitted only as a direct child of `handler`. This synthetic-only exception
does not mutate `handler.allowedChildren` in the source schema. Root lambda and
lambda below any other parent reject in both writer and reader.

[INVARIANT] A structural lambda with any child, grandchild, unknown property,
missing `expr`, typed lambda, block-bodied lambda, malformed expression, or
unsupported expression form rejects before artifact bytes escape.

## Canonical representation and execution

[DECISION] `lambda.expr` reuses `projectExpressionText`, expression validation,
and expression inflation without a wrapper-specific expression codec.

[DECISION] Canonical lambda node bytes contain one property named `expr`, whose
value is the normal canonical expression record. Inflation restores canonical
expression text and no children.

[DECISION] Structural round-trip proves representation only. The existing
`assertLambdaPreflight` remains the independent executability gate in the
internal runtime path.

[INVARIANT] No public export, parser fallback, source lowering, codegen case,
or TypeScript semantic engine is added.

## Exact composed runner witness

[DECISION] Add one runner tuple in live runner order:

- `id`: `lambda`;
- `witnessId`: `kir-runtime-compose.lambda.v1`;
- `semanticEnvelopeId`: `lambda-stdout-and-seven`;
- `fixtureId`: `lambda-list-map-stdout`;
- `oracleId`: `exact-lambda-stdout-and-result`;
- `excludedProperties`: empty.

[DECISION] The handler body contains the runner-synthetic lambda with expression
`List.map([1,2,3], x => x * 2)`, followed by `return value=7`. Its exact envelope
has one stdout event with text `2,4,6` and integer result `7`.

[DECISION] The causal control changes only the multiplier from `2` to `3`; its
stdout becomes `3,6,9`, so it must differ from the oracle while sync and async
execution remain identical.

[FACT] The composed test encodes the body into module KIR, decodes and inflates
it in `kir-handler`, and executes the internal runtime handler directly. It does
not call target fixture lowering.

[DECISION] Preserve the handwritten 500-line ceiling by extracting a cohesive
special-fixture helper from
`kern-kir-runner-composed-fixtures.ts` before adding lambda data. Static witness
metadata remains in the parser-bound top-level literal.

## Eligibility and executable coverage

[DECISION] `validate-runner-composed-evidence` resolves runner admission against
the union of source and runner-synthetic constitution rows. Missing rows are
reported as `structural-node-absent`, not `source-node-absent`.

[DECISION] A composed witness remains forbidden for a runner absent from both
authorities or having a required excluded property. Optional excluded-property
matching stays exact.

[DECISION] Eligibility transitions atomically from 15 witnessed and 1
structurally blocked to 16 witnessed and 0 structurally blocked. Source coverage
remains exactly 302/302 and must not become 303/303.

[DECISION] Bump the coverage-witness ledger to `r1.5i.1`. Preserve its source
arrays and add exact `runnerSyntheticNodes` and `runnerSyntheticProperties`
arrays plus distinct counts. The lambda node and required expression property
receive executable writer/reader witnesses.

[DECISION] Coverage closure reports source and runner-synthetic denominators
separately. The expected total rises from 2,287 to 2,289 executable witnesses.

[DECISION] Coverage closure independently checks the canonical lambda
expression tree rather than treating writer output as its own oracle.

## Version transition and historical evidence

[DECISION] Bump the internal constitution and artifact formats from `r1.5h.1`
to `r1.5i.1`, and bump the coverage-ledger format from `r1.5h.1` to `r1.5i.1`.
The independent handler type-admission format remains unchanged.

[DECISION] The reader rejects `r1.5h.1-alpha` and unknown formats. There is no
dual-version reader or compatibility fallback.

[DECISION] Add exact current-to-pre-lambda reconstruction before every existing
history step:

1. `r1.5i.1 -> r1.5h.1` pre-lambda;
2. `r1.5h.1 -> r1.5g.1` pre-each;
3. `r1.5g.1 -> r1.5f.1` pre-branch;
4. `r1.5f.1 -> r1.5e.1` pre-expression.

[DECISION] Source reconstruction removes only the runner-synthetic constitution
fields/counts and reverts the format, reproducing exact checked-in `h` bytes.

[DECISION] Compiled reconstruction covers the generated runtime catalog and
artifact format constant. No `spec.js` or `schema.js` reconstruction is allowed,
because the source catalogs remain byte-identical.

[DECISION] The reconstruction inventory and expected digests are authenticated
by a new lambda structural target, chained before the existing each target in
coverage catalog and compiled-core history.

[DECISION] Do not rewrite frozen M4.127, M4.141, M4.145, M4.147, or M4.148
receipts. Regenerate only current coverage summaries and live dependency
digests after implementation.

## Red-first and hostile evidence

[ACCEPTANCE] Before implementation, focused tests fail because `lambda` is
absent from the structural catalog, eligibility remains 15/16, and the composed
witness cannot be registered.

[ACCEPTANCE] Constitution tests reject duplicate source/synthetic ids, invented
synthetic rows, unknown or duplicate synthetic overrides, kind drift, reordered
arrays, and forged counts.

[ACCEPTANCE] Structural tests prove exact lambda bytes, byte-stable round-trip,
inflation, predecessor rejection, and rejection of missing/extra/reordered
properties, any child, typed lambdas, block bodies, malformed syntax, and
unsupported host expression shapes.

[ACCEPTANCE] Parser regression proves `lambda` remains unknown source syntax;
catalog regressions prove `NODE_TYPES`, `NODE_SCHEMAS`, and `KERN_RESERVED` did
not gain lambda.

[ACCEPTANCE] Composed evidence proves the exact stdout-plus-result envelope,
causal control, direct wrapper count, and byte-identical sync/async execution.

[ACCEPTANCE] Eligibility mutation tests reject a witness without synthetic
authority, a synthetic row without a witness, changed authority/provenance,
forged witness digest, and a return to source-node conflation.

[ACCEPTANCE] Historical tests reproduce exact `h`, `g`, `f`, and `e` source and
compiled digests and reject byte substitution, omitted reconstruction stages,
invented paths, and membership drift.

## Binary completion gates

[ACCEPTANCE] Focused RED tests become green without changing any public source
catalog or source parser behavior.

[ACCEPTANCE] Constitution generation, structural codec suites, coverage ledger,
coverage closure, eligibility, Alpha receipt, canonicalizer integrity, runtime
envelope, composed runner evidence, lint, typecheck, build, and the complete
promoted `pnpm fitness:kern-5` wall pass.

[ACCEPTANCE] The three frozen M4.147 files remain byte-identical to base.

[ACCEPTANCE] Independent Agon review runs after the local wall with automatic
risk, primary engine `codex`, roles `auto`, and exact roster
`claude,codex,agy`; every verified blocker is fixed before commit.

[ACCEPTANCE] The slice is committed with the required Agon KERN identity,
rebased only if remote main moved, pushed once to `main`, and the remote SHA is
verified.

[NON-GOAL] This slice does not promote public KIR, versioned KIR v1, runtime
cutover, frontend/compiler ownership, Alpha status, RC status, or KERN 5.0.
