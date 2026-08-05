# KERN 5 Phase 1: Internal Module KIR Runtime Binding v1

**Status:** approved implementation contract
**Base:** `f8cf86c55dab9c127e46cf84cd3346ba9b5d3d6f`
**Risk:** high shared semantic-contract composition
**Pre-implementation tribunal:** `tribunal-1785935638457-yz0rqa`
**Authority-transition tribunal:** `tribunal-1785939003486-88ge91`
**Historical-evidence tribunals:** `tribunal-1785941173104-bzm6wk`,
`tribunal-1785941971928-dghvzg`
**Confidence:** 0.97

## Problem

[FACT] Canonical Module KIR bytes are bounded, canonical, graph-validated, and
decoded as `ModuleKirArtifact` with `StructuralKirNode[]` roots.

[FACT] The frozen internal runtime handler entry executes `IRNode[]` plus an
optional `RunnerModuleScope`. Its only current public construction path reparses
KERN source.

[FACT] No current runtime consumer accepts decoded Module KIR bytes. Therefore
the KIR and runtime endpoints are independently closed, but their composition
is not.

[DECISION] This slice creates one internal, default-off, parser-free Module KIR
to runtime-handler binding. It does not promote versioned KIR v1 or alter the
frozen runtime-handler entry type.

## Scope

### Inputs and outputs

[DECISION] The binder accepts only:

- canonical Module KIR bytes;
- an exact `{ moduleId, handlerName }` identity;
- explicit canonical-value limits and the existing runtime-envelope options;
- runtime arguments and a host semantic environment at execution time.

[DECISION] Resolution returns either a linked `InternalRuntimeHandlerEntry`
with an owned `RunnerModuleScope`, or an existing frozen runtime link-failure
envelope. Sync and async execution delegate only to the existing frozen typed
handler entry.

[DECISION] The binder is default-off before byte decoding. Invalid limits,
identity, bytes, graph metadata, entry shape, or helper scope fail before
runtime output, capability calls, or other observable effects.

### Structural inflation

[DECISION] Decoded structural nodes are converted to fresh `IRNode` values.
Property disposition comes from the generated structural constitution:

- included scalar values and canonical import paths become plain IR scalars;
- portable handler types become their canonical KERN annotations;
- structured expression values become deterministic, fully parenthesized KERN
  expression source;
- any unrecognized canonical value or disposition fails closed.

[DECISION] The binder does not consume retained pre-encoding `IRNode` objects,
source text, generated output, or ambient module loaders.

### Linking

[DECISION] Module identities, imports, exports, aliases, kinds, and re-exports
come only from decoded Module KIR metadata. Existing `buildRunnerModuleScopes`
owns final helper/class scope construction.

[DECISION] The selected entry is one exact synchronous, non-streaming `fn`
with exactly one structured `handler lang="kern"` and a portable structured
signature. The selected function is absent from its own handler root scope,
matching the current source-handler isolation rule.

[DECISION] Imported aliases and transitive re-exports must resolve with their
decoded kind and identity intact. A class selected where a function is required,
a missing module or function, duplicate/ambiguous handler, unsupported signature,
or failed scope link rejects before execution.

## Binary acceptance criteria

1. [DECISION] `pnpm test:kern-kir-runtime-binding` is RED at the published base
   because no decoded-byte runtime consumer exists.
2. [DECISION] A canonical one-module artifact links and executes a structured
   handler in sync and async modes with byte-identical normalized envelopes.
3. [DECISION] Two artifacts differing only in encoded expression semantics
   produce different expected results; constant or retained-IR implementations
   fail.
4. [DECISION] Mutating or poisoning source text and pre-encoding IR after byte
   creation cannot change execution.
5. [DECISION] Aliased helper imports and a transitive re-export chain execute
   correctly from decoded metadata alone.
6. [DECISION] Reordered module inputs retain canonical decoded behavior, while
   byte mutation, stale graph metadata, missing exports, kind mismatch, cycles,
   duplicate bindings, unknown fields/tags/kinds, and malformed signatures fail
   before any capability invocation or event.
7. [DECISION] Sync and immediately resolved async execution are byte-identical
   over the admitted binder corpus.
8. [DECISION] Static import closure rejects the source parser, source handler,
   public runner, module loader, source-runner selector, and legacy engines.
   The already-frozen runtime expression parser remains an allowed downstream
   execution dependency.
9. [DECISION] A type-smuggling oracle rejects any `StructuralKirNode` reference
   added to the frozen `InternalRuntimeHandlerEntry` declaration.
10. [DECISION] The new gate is current and receipt-bound as an internal oracle;
    the existing `kir-v1` gate and ownership row remain planned/not-shipped.

## Mutation attacks

[DECISION] The oracle must kill these plausible wrong implementations:

- return a constant envelope without decoding bytes;
- cache or execute the pre-encoding IR fixture;
- reparse KERN source or call the existing source-handler path;
- drop helper scope, import aliases, or transitive re-export identity;
- bind an ambient `RunnerModuleScope` rather than the decoded graph;
- accept a class export when a function identity was requested;
- execute before full decode/link/preflight completion;
- widen `InternalRuntimeHandlerEntry.body` to a structural-node union;
- add silent fallback to the source runner or legacy runtime;
- flip KIR v1/public/cutover claims because the narrow corpus passes.

## Gate and receipt changes

[DECISION] Add one focused command, `test:kern-kir-runtime-binding`, composed of
the core behavioral tests and a repository-level import/claim-closure oracle.
Promote that command as the narrowly named current
`internal-decoded-module-kir-binding` oracle in the KERN 5 fitness policy and
support matrix. The distinct `public-versioned-kir-runtime-cutover` contract
remains deferred, and every runner-coverage row retains its existing deferred
disposition.

[DECISION] Bind the binder implementation, behavioral oracle, closure oracle,
fitness policy, package command, and support-matrix evidence into the Alpha
receipt denominator. The receipt continues to distinguish byte binding from
oracle execution.

## Canonicalizer historical evidence

[FACT] The canonicalizer current-state receipt intentionally authenticates all
compiled core JavaScript. The two new emitted binder modules advance that live
identity from the frozen historical 305-file digest to a 307-file digest.

[DECISION] Current canonicalizer summaries bind the complete 307-file compiled
tree. Frozen milestone receipts remain immutable and reconstruct their exact
historical membership through an authenticated successor-inventory identity:
the current inventory count and path digest must match exactly before the two
post-M4.145 binder modules can be removed.

[DECISION] Historical reconstruction has two explicit byte epochs: M4.145-era
membership with then-current expression bytes, and pre-M4.135 membership with
the existing historical expression-byte reconstruction. Any added, missing,
duplicate, non-normalized, traversing, symlinked, or lookalike path fails
closed rather than silently changing history.

[DECISION] Historical M4.141 and M4.150 frontier builders explicitly assign the
reconstructed compiled-core identity to both coverage and prerequisite data,
matching the canonicalizer, composition, policy, and implementation identities
they already normalize. M4.143 and M4.148 first authenticate the live receipt,
then compare semantic history through the reconstructed identity. Historical
milestone receipts are not regenerated.

## Explicit non-claims

[DECISION] This slice must leave all of the following false or unchanged:

- `kirV1Frozen`;
- `publicReaderExport` / public KIR reader export;
- `runtimeCutover` and `semanticCutover`;
- `semanticSelfHosting`;
- `versioned-kir-v1` shipped status;
- `pnpm test:kern-ir` promotion;
- universal runner-contract coverage;
- complete KIR semantic determinism beyond the admitted binder corpus.

[FACT] The structural and module formats retain their current alpha names and
`ALPHA-NO-GO` proof labels in this slice.

[DECISION] The exact internal binder path is the sole runtime-envelope consumer
admitted by the structural KIR containment wall. Direct canonical-value
consumers remain limited to structural/evidence codecs; runtime consumption is
transitive through the structural Module KIR decoder.

[DECISION] Rejected as disproportionate or unsound for this boundary: TypeScript
project-reference restructuring, an environment-variable reachability gate,
and a second adapter limits type that could drift from `ModuleKirCodecOptions`.

## Likely files

[HYPOTHESIS] The smallest complete diff will add isolated modules below
`packages/core/src/kir-structural/` and `packages/core/src/runtime-envelope/`,
focused core and repository tests, one focused package command, the matching
fitness/support rows, and Alpha receipt bindings. Existing source-handler and
handler-entry implementation files should remain byte-identical.

## Verification sequence

1. Add a compiling but behaviorally failing binder seam and prove RED.
2. Implement expression/property inflation and exact graph linking.
3. Run the focused core and closure gates plus build/typecheck.
4. Red-team every listed mutation and prove pre-effect failure.
5. Run `pnpm fitness:kern-5`.
6. Run full-roster Agon review with `--risk auto --roles auto` and the actual
   primary engine identity, verify every finding against current files, fix real
   blockers, and rerun affected gates.
7. Commit with the mandatory Agon identity/footer, fetch/rebase if safe, push
   once to `main`, and verify the remote SHA.
