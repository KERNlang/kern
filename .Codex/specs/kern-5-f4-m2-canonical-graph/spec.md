# KERN 5 F4 M2 Canonical Graph Closure

Status: READY FOR RED — implementation and acceptance pending
Baseline: `origin/main` `8f1d1934f4c951f9cb050a509c965321686c7f96`
Scope: F4-A7 and F4-C15 only

## Objective

Close the canonical F4B module-graph contract without changing F0-F4A source
semantics, the public worker API, or the ten-field outer result shape. F4B must
derive deterministic quarantine, normalized binding, graph-fact, and real
strongly connected component data from authenticated F4A `.2` receipts in one
KERN runtime invocation.

This slice does not promote F4, implement F5, or close F4-A8 through F4-A10.

## Verified baseline

- **[M2-V1 VERIFIED]** F4A already transports binding provenance as the
  eight-field row decoded by `decoder.mjs`: target module, imported name, local
  name, requested kind, re-export flag, logical ordinal, and source start are
  available before F4B transport.
- **[M2-V2 VERIFIED]** `module-set-worker.mjs` currently discards the logical
  ordinal and source start when it constructs the six-field F4B interface row.
- **[M2-V3 VERIFIED]** `f4-module-set-graph.kern` currently emits rejected rows
  in request order, assigns blocked reasons by first discovery, emits one
  content-free `module-cycle` fact for any residual Kahn failure, and emits one
  component row per eligible module rather than one row per SCC.
- **[M2-V4 VERIFIED]** `module-set-decoder.mjs` hard-codes `.3` plus three-field
  fact, two-field singleton-component, and six-field resolved-binding grammars.
  Changing those nested grammars in place would silently redefine `.3`.
- **[M2-V5 VERIFIED]** The module-set result is an internal oracle. Repository
  consumers of `.3` are confined to the F4 worker, decoder, policy, and focused
  tests. F4 is not promoted and F5 is not implemented.
- **[M2-V6 VERIFIED]** Field 8 of the ten-field result deliberately retains the
  full request-order F4A identity tape. Request permutation therefore changes
  field 8 and the outer seal even when the canonical graph partitions are
  identical.

## Contract decisions

### Identity and versioning

- **[M2-C1 DECIDED]** The result format becomes
  `kern.frontend.f4-module-set.4`. The result remains exactly ten strings and
  the private handler remains exactly the existing 18 arguments in the
  existing order and types.
- **[M2-C2 DECIDED]** The policy remains
  `kern.frontend.f4-declarations-policy.4`. Its bytes, SHA identity,
  `moduleSetResultFormat`, and affected composition pins change atomically.
  The policy version does not claim nested result compatibility.
- **[M2-C3 DECIDED]** The `.4` decoder accepts `.4` only and rejects `.2` and
  `.3` by explicit format identity. It never infers a format from nested row
  arity. The resource-prefix result moves to `.4` in the same atomic change.
- **[M2-C4 DECIDED]** No rollout flag is added. There is no promoted or external
  `.3` consumer to migrate, and adding `off|shadow|required` policy would create
  an unsupported operational surface. The last accepted Git baseline is the
  rollback boundary.

### Exact nested rows

- **[M2-C5 DECIDED]** A transported interface binding row is exactly eight
  scalar-framed fields:

  `(moduleId, canonicalTarget, imported, local, requestedKind, reexport, logicalOrdinal, startScalar)`.

  `logicalOrdinal` and `startScalar` use canonical nonnegative decimal spelling.
  They must equal the decoded F4A binding row at that position. Full and
  resource-prefix modes use the same grammar.
- **[M2-C6 DECIDED]** A link-fact row is exactly five fields:

  `(code, detail, moduleId, logicalOrdinal, startScalar)`.

  Binding-owned facts retain the originating binding coordinates. A graph-
  global fact uses logical ordinal `-1`; its source position is the selected
  witness edge start, never an invented zero. Existing fatal facts retain the
  separate atomic fatal result grammar and are not ordinary link-fact rows.
- **[M2-C7 DECIDED]** A resolved-binding row is exactly eight fields:

  `(sourceModuleId, imported, local, effectiveKind, reexport, importerModuleId, logicalOrdinal, startScalar)`.

  These positions make the emitted canonical order independently checkable.
- **[M2-C8 DECIDED]** A component row is exactly
  `(componentMinimumId, memberIdentityTape)`. The member tape is nonempty and
  contains sorted two-field rows `(moduleId, receiptSeal)`. The minimum is the
  first member ID. Member IDs are unique across component rows, and component
  rows cover exactly `V`.
- **[M2-C9 DECIDED]** Rejected, blocked, and input-identity nested rows keep
  their current arities. Field 8 remains the complete request-order identity
  tape. Canonical graph fields 3 through 7 are independent of request order;
  the full ten-field receipt and seal are not.

### Whole-graph partition and SCC algorithm

- **[M2-C10 DECIDED]** Module IDs are the exact canonical IDs already admitted
  by the path contract. M2 performs no Unicode normalization and invents no
  second module identity relation.
- **[M2-C11 DECIDED]** KERN builds deduplicated forward and reverse topology
  edges from authenticated binding intents. Duplicate binding rows remain
  independently validated and may emit binding facts, but duplicate topology
  edges do not multiply graph work.
- **[M2-C12 DECIDED]** KERN runs iterative Kosaraju over `All` before the
  `R/T/V` partition. Recursion, a corpus-derived SCC-size bound, and a V-only
  SCC pass are forbidden. Members within each SCC and SCCs by minimum member ID
  have one canonical order.
- **[M2-C13 DECIDED]** KERN constructs the condensation DAG. For every component
  it computes the lexicographically smallest directly rejected member or
  reachable rejected dependency by reverse-topological propagation. Then:

  - `R` is every F4A-rejected module;
  - `T` is every non-`R` module whose component reaches an `R` component;
  - `V = All \\ (R union T)`; and
  - every `T` row carries the propagated smallest rejected module ID.

  A cyclic blocked subgraph is handled by its whole-graph SCC and cannot depend
  on queue or request order.
- **[M2-C14 DECIDED]** Components emitted in field 6 are the SCCs induced by
  `V`, including singleton acyclic components. Components containing an `R`
  member have no `V` member: every other member in that SCC is in `T`.
- **[M2-C15 DECIDED]** Graph traversal work is `O(M + E)` after map/adjacency
  construction. Canonical emission may use a charged bottom-up stable merge
  order with `O(O log O)` comparisons/copies over output rows. Repeated global
  minimum scans, per-rejected-root rescans, and per-module reachability scans
  are forbidden.

### Link resolution, cycles, and order

- **[M2-C16 DECIDED]** Re-export resolution remains module-local. SCC membership
  never merges namespaces. A monotone work queue reaches the fixed point only
  from valid declared exports or previously grounded re-exports. Ungrounded,
  conflicting, wrong-kind, or duplicate-local re-exports never seed exports.
- **[M2-C17 DECIDED]** One `module-cycle` fact is emitted for each cyclic SCC in
  `V`: an SCC with more than one member, or a singleton with a self-edge. KERN
  performs deterministic DFS from `componentMinimumId` over canonically ordered
  adjacency and selects the lexicographically smallest true DFS back-edge.
  The fact uses the edge importer as `moduleId`, target as `detail`, and the
  edge binding's logical ordinal and start scalar. A chord that does not close
  the DFS cycle is not a valid witness.
- **[M2-C18 DECIDED]** Ordinary link facts are ordered by:

  `(componentMinimumId, moduleId, startScalar, ruleRank, code, detail, logicalOrdinal)`.

  The closed rule ranks are policy-authenticated stable protocol constants:
  `missing-module=0`, `missing-export=1`, `kind-mismatch=2`,
  `duplicate-local-binding=3`, `duplicate-export=4`, `module-cycle=5`.
- **[M2-C19 DECIDED]** Resolved bindings are ordered by:

  `(importerModuleId, startScalar, logicalOrdinal, sourceModuleId, imported, local, effectiveKind, reexport)`.

  Rejected or blocked modules produce no resolved binding row. As in the
  existing contract, any ordinary link fact makes the whole set rejected and
  the public bindings tape empty.
- **[M2-C20 DECIDED]** Rejected rows are sorted by module ID. Blocked rows are
  sorted by module ID. Component members are sorted by module ID and component
  rows by component minimum ID. No traversal order is observable in fields 3
  through 7.

### Decoder and validation boundary

- **[M2-C21 DECIDED]** The production decoder performs bounded structural
  validation: exact arities and decimal spellings; canonical row order;
  `R/T/V` disjointness and coverage against input identities; blocked reasons
  belonging to `R`; component minima, member uniqueness, coverage, and receipt
  seals; binding/fact module and position bounds; and exact terminal counts.
- **[M2-C22 DECIDED]** The decoder does not rerun Kosaraju or reachability and
  does not claim to prove strong connectivity. An independent test reference
  verifier recomputes SCCs, quarantine minima, cycle witnesses, bindings, and
  canonical comparators from the same public module set. This keeps production
  decode accounting honest while still making graph fraud mutation-testable.
- **[M2-C23 DECIDED]** The module-set seal remains SHA-256 over the exact ten
  fields. `maxEncodedBytes` includes all new nested framing and `.4` bytes.
  `maxWorkSteps` includes transport validation, deduplicated graph work,
  re-export fixed-point work, SCC work, canonical ordering, and output work.

## Precedence and atomicity

- **[M2-P1 DECIDED]** Existing outer runtime/ABI failure and F4B precedence
  remain: request shape and canonical manifest; request limits; transported F4A
  identity/interface validation; R/T partition; V graph phase; aggregate
  limits; seal; forced late failure.
- **[M2-P2 DECIDED]** A malformed eight-field interface row is atomic
  `F4_INVALID_REQUEST`. It cannot be reinterpreted as `.3` or repaired by the
  host.
- **[M2-P3 DECIDED]** A target in `R` or `T` never emits `missing-module`,
  `missing-export`, or `kind-mismatch`. Independent V components are still
  fully checked and represented even when another V component has facts.
- **[M2-P4 DECIDED]** Any fatal returns the existing atomic fatal partitions.
  Any ordinary rejected result exposes no modules or bindings. A linked result
  requires empty `R`, `T`, and link facts.

## Discriminating RED matrix

- **[M2-A1 DECIDED]** Permuting the same module request and binding discovery
  order preserves fields 3 through 7 byte-for-byte. Field 8 and the whole seal
  remain request-order commitments and are asserted separately.
- **[M2-A2 DECIDED]** Requesting rejected modules in `z,a` order emits `R` as
  `a,z`.
- **[M2-A3 DECIDED]** An importer that reaches `z` in one hop and rejected `a`
  through a longer path is blocked by `a`.
- **[M2-A4 DECIDED]** A cyclic `x <-> y` blocked component whose members reach
  different rejected modules assigns both members the same smallest rejected
  dependency.
- **[M2-A5 DECIDED]** `a <-> b` plus independent `c` emits exact component rows
  `{a,b}` and `{c}`. A self-loop and two disjoint cycles emit one sourced cycle
  fact per cyclic SCC in canonical order.
- **[M2-A6 DECIDED]** A three-node SCC with a chord proves the selected witness
  is a true DFS back-edge rather than the lexicographically smallest arbitrary
  internal edge.
- **[M2-A7 DECIDED]** Two binding rows at distinct source positions retain
  distinct ordinal/start fields and sort canonically. Mutating either emitted
  coordinate or its transport coordinate rejects.
- **[M2-A8 DECIDED]** Multi-hop re-exports resolve to a fixed point under at
  least twenty request permutations. Ungrounded cycles, wrong kinds, local
  collisions, and duplicate exports remain rejected and never seed exports.
- **[M2-A9 DECIDED]** Duplicate topology edges do not change SCCs or quarantine
  and do not multiply graph-work debits; duplicate binding semantics remain
  independently visible.
- **[M2-A10 DECIDED]** `.3` with widened rows, `.4` with old row arities, forged
  component membership/minimum/seal, forged T reason, decreasing fact/binding
  order, and stale terminal counts all reject at the decoder or trusted
  transport boundary.
- **[M2-A11 DECIDED]** A reference oracle independently recomputes whole-graph
  SCC membership, R/T/V, minimum rejected reasons, cycle witnesses, normalized
  bindings, and fields 3 through 7 from every canonical fixture.
- **[M2-A12 DECIDED]** Exact and cap-minus-one work/byte tests cover SCC,
  quarantine, re-export, canonical sort, and widened output framing. A bounded
  chain and cycle family establishes monotone work rather than wall-clock
  acceptance; M3 owns absolute time/RSS scale walls.
- **[M2-A13 DECIDED]** Public `runModuleSet` remains arity one and offers no
  mode, format, sort, component, or graph override. Test mutations remain under
  the private `__test` namespace and still execute one real root F4B handler.
- **[M2-A14 DECIDED]** Focused M2 tests, adjacent resource-prefix/path/module-set
  tests, the full F4 declaration wall, lint, repo consistency, exact policy
  pin validation, deterministic authority regeneration, and KERN 5 fitness all
  pass before commit. Automatic-risk Agon review has no unresolved verified
  blocker.

## Implementation boundary

Expected touched concerns, split so every handwritten file remains below 500
lines:

1. one new KERN canonical row-order helper;
2. one new KERN iterative SCC/condensation helper;
3. one new KERN quarantine/component projection helper;
4. bounded changes to the current graph/main/output KERN sources;
5. F4B transport, decoder, policy validation, and policy pins;
6. one source-backed reference verifier and focused M2 oracle; and
7. parent F4 spec plus KERN 5 goal truth/status only after green review.

No F0-F4A receipt field, public API, schema authority, generated authority,
F5/KIR file, release policy, support matrix, or terminal fitness gate may change
without a separately traced defect and explicit scope amendment.

## Kill switches

Stop and redesign if any implementation requires:

1. host-side graph resolution, sorting, SCC construction, or receipt repair;
2. recursion or a fixed maximum SCC size;
3. a V-only SCC pass before quarantine propagation;
4. changing `.3` nested grammar without a `.4` identity;
5. making the full receipt seal permutation-invariant by deleting or sorting
   the request-order identity commitment;
6. merging export namespaces across SCC members;
7. selecting a cycle chord that is not a true DFS back-edge;
8. repeated global minimum, per-root reachability, or per-module graph scans;
9. exposing a binding or artifact from `R`, `T`, or an ordinary failed set; or
10. weakening F4A, path, resource-prefix, or fatal atomicity contracts.

## Agon tribunal corrections

Tribunal run: `/Users/nicolascukas/.agon/runs/tribunal-1787387230513-6vkloy`
with seven of eight planned round responses; Kimi round two timed out and was
dropped by the orchestrator.

- The initial in-place `.3` enrichment was rejected; `.4` is required because
  nested arities are decoder-visible contract.
- The initial V-only SCC sequencing was rejected; whole-graph SCCs must precede
  quarantine minimum propagation.
- The initial minimum-internal-edge cycle witness was rejected; a chord is not
  necessarily cycle-closing, so the witness must be a deterministic true DFS
  back-edge.
- The tribunal's whole-seal permutation requirement was narrowed because it
  conflicts with the existing request-order identity commitment. Canonical
  graph fields, not field 8 or the outer seal, are permutation-invariant.
- The tribunal's rollout flag was rejected because no promoted/external `.3`
  consumer exists. Explicit `.4` identity plus the Git rollback boundary is the
  smaller truthful internal-oracle migration.
