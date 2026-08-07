# M4.162 Mutable Node-Type Registry Snapshot Shadow v1

**Milestone:** M4.162
**Status:** verified; signed publication pending
**Risk:** high, internal shared parser-evidence contract
**Tribunal:** `tribunal-1786051078314-7v4qyz`

## Decision

[D1] M4.162 adds the internal format
`kern.frontend.mutable-node-type-registry-snapshot-shadow.1`.

[D2] The slice composes the complete M4.161 built-in attestation envelope and
attests three mutable membership predicates independently:

- exact membership in `KernRuntime.dynamicNodeTypes`;
- exact membership in `KernRuntime.multilineBlockTypes`;
- exact key membership in `KernRuntime.templateRegistry`.

[D3] The mutable result is `registered` when any mutable predicate is true and
`unresolved` when all three are false. Each category flag remains explicit.
The inherited M4.161 built-in verdict remains separate. M4.162 does not emit or
own `UNKNOWN_NODE_TYPE` and does not turn `unresolved` into a warning.

[D4] Snapshot capture and parser execution are fused in one internal helper.
The helper captures the live registry membership at parse entry and immediately
invokes the existing synchronous parser with the same `KernRuntime` instance.
No portable snapshot token or caller-controlled gap is exposed.

[D5] Each runtime receives a process-local opaque positive instance identifier.
Each fused capture receives the next positive safe-integer parse-call epoch for
that runtime. The pair is evidence identity, not a cross-process identifier or
a claim that every direct collection mutation was intercepted.

[D6] A snapshot is valid for one fused parse only. A later parse always has a
different epoch, including after add-delete restoration to byte-identical
membership. A private process-local binding stores the exact source and runtime
for each returned evidence object. The checker consumes that object once;
structural copies, second consumption, and evidence older than the runtime's
current parse epoch fail closed.

## Grounded execution boundary

[E1] The production parser currently reads mutable admission state only in the
line-admission phase: multiline opener recognition, the unknown-node predicate,
and parser-hint lookup in `packages/core/src/parser-core.ts`.

[E2] That phase is synchronous and invokes no user callback. Optional import,
closure, and native-eligibility callbacks execute only after `parseLines`
returns and therefore cannot interleave with mutable node-type admission.

[E3] The fused guarantee is scoped to this synchronous callback-free admission
phase. A future async parser, callback-capable line handler, or mutable registry
read after callback execution must fail the source-containment gate until a new
contract is reviewed.

[E4] Public mutable collections remain compatible. Existing code may continue
using runtime registration methods or direct `Set`/`Map` writes before the
fused parse begins. M4.162 does not encapsulate or replace the public
collections.

[E5] Capture rejects non-native registry containers, altered collection
prototypes, proxied runtimes/containers/parser hints, shadowed collection
methods, and altered Set/Map/Array iterator operations before evidence escapes.
This prevents user callbacks hidden in a proxy, replaced `has`, iterator,
entries method, or parser-hint getter from invalidating the callback-free
premise.

## Snapshot and duplicate semantics

[S1] Snapshot membership is canonicalized as unique strings in ascending UTF-16
code-unit order. The KERN handler receives bounded lists, not live collections,
callbacks, definitions, or host membership functions.

[S2] The six built-in multiline owners are a stable protocol constant:
`body`, `cleanup`, `doc`, `handler`, `logic`, and `render`. Capture rejects a
runtime missing any default instead of silently synthesizing membership that
the parser did not consume.

[S3] Direct additional `multilineBlockTypes` entries and parser-hint-owned
multiline entries are both represented by the exact effective live multiline
set. M4.162 authenticates membership, not ownership provenance within that set.

[S4] Re-registering an existing evolved type or re-adding a multiline type is
membership-idempotent. Removing an absent member is membership-idempotent.

[S5] Template registration is last-write-wins downstream, but repeated
registration of the same template name is membership-idempotent for M4.162.
Template slots, imports, bodies, and source paths do not affect the parser's
unknown-node predicate and are outside this snapshot format.

[S6] Replacing parser-hint payload while retaining identical effective
multiline membership is outside the M4.162 membership identity. Positional and
bare-word parsing behavior is not claimed. A later parser-state slice must bind
those definitions before claiming broader parser ownership.

[S7] Overlap is legal and fully disclosed. A name may simultaneously be a
built-in, evolved, multiline, and template name. All mutable category flags
must report exact membership even though the final warning predicate remains
deferred.

## Input and inherited authentication

[I1] The public test entry accepts M4.161's bounded source and limit arguments,
plus a positive runtime instance identifier, a positive parse-call epoch, and
three bounded canonical membership lists.

[I2] The native M4.162 handler invokes the native M4.161 handler exactly once.

[I3] Every inherited M4.161 failure and success field is authenticated before
mutable membership evaluation. A forged built-in verdict, catalog identity,
M4.160 admission field, inherited seal, or record order fails atomically.

[I4] Dropped admission stays `dropped`, carries mutable verdict `none`, and
never evaluates registry membership.

[I5] Registry lists reject non-text values at the host boundary, empty names,
duplicates, noncanonical order, unsafe counts, and configured-limit overflow.

[I6] Runtime instance and epoch reject zero, negative, non-integer, unsafe, and
noncanonical representations. They are authenticated in every decision and
seal record.

## Result contract

[R1] Every M4.162 envelope uses fixed-width records after one format field.

[R2] An admitted identifier emits one decision containing the inherited
built-in verdict and index, mutable verdict, the three exact category flags,
runtime instance, parse epoch, registry counts, inherited field count, and
source identity.

[R3] Registry authentication records reproduce every canonical evolved,
multiline, and template name exactly once with category, index, and bounded
padding. The host parser rejects omission, duplication, reordering, category
substitution, or prefix matching.

[R4] The terminal seal binds the complete decision identity, registry counts,
runtime instance, parse epoch, inherited M4.161/M4.160/M4.159 formats, source
lengths, and inherited field count.

[R5] The independent oracle consumes only captured plain snapshot evidence and
the M4.161 oracle. It does not call `isKnownNodeType`, the production parser
predicate, live registry `has`, or the native KERN implementation.

## Parser-execution binding

[P1] The internal host helper assigns instance and epoch, captures membership,
then calls the existing parser in the same synchronous stack without yielding
or invoking caller code between capture and `parseLines` entry.

[P2] The helper returns the captured evidence together with parser diagnostics.
The checker compares the native mutable flags with the bootstrap warning
predicate for the same admitted identifier and the same runtime/epoch.

[P3] Parser parity is evidence only. The production parser continues to own its
existing warning and AST behavior. M4.162 does not route parser decisions
through native KERN and does not change public parse results.

[P4] Snapshot evidence from another runtime, an earlier epoch, or another
source cannot be substituted. Cross-runtime registries with identical content
still carry different instance identities. The source is recovered only from
the private fused-evidence binding rather than accepted as a separate checker
argument.

## Resource contract

[B1] M4.161's token, diagnostic, catalog, lexical-depth, and stream-record
limits remain unchanged.

[B2] Policy separately bounds evolved, multiline, and template membership
counts, each name's Unicode scalar and UTF-8 byte lengths, total registry
records, output bytes, and native loop iterations.

[B3] Native KERN validates each membership category in one bounded scan,
including all six default multiline owners. For an admitted identifier, each
category receives at most one additional bounded exact-membership scan. The
implementation never rescans the inherited token stream or built-in catalog
for every mutable registry entry.

[B4] Maximum admitted source plus maximum registry membership completes within
the deterministic Node 22.22 runtime budget.

## Required tests

[T1] Empty registries, each single category, every overlap combination, and
absent names match the independent oracle and bootstrap parser warning result.

[T2] Separate runtimes with equal membership receive different instance IDs;
successive parses on one runtime receive strictly increasing epochs.

[T3] Register, unregister, clear, direct Set/Map writes, add-delete restoration,
and duplicate registration all produce the specified next-parse evidence.

[T4] All six default multiline types are authenticated. Register/unregister and
clear cycles cannot silently remove default ownership from accepted evidence.

[T5] Same-name template replacement and non-multiline parser-hint replacement
leave membership semantics unchanged; adding or removing effective multiline
membership changes the next snapshot.

[T6] Collection prototype/method tampering, unsafe identity/epoch values,
proxy traps, parser-used iterator tampering, unsafe identity/epoch values,
noncanonical or oversized lists/names, stale/replayed/structurally copied
evidence, category swaps, inherited failure padding, inherited verdict/index
forgeries, and seal mutations fail closed.

[T7] Source containment proves the fused wrapper has no await/yield/timer,
callback, or dynamic loader between capture and parse, and proves parser mutable
admission reads remain confined before optional callbacks.

[T8] Focused verification includes direct tests, maximum-bound execution, the
complete M4.153-M4.162 frontend regression wall, `git diff --check`, and the
complete Node 22.22 KERN 5 fitness wall.

## Claims and exclusions

[C1] This slice may claim only:
`kern-frontend-mutable-node-type-registry-snapshot-shadow: internal-oracle`.

[X1] M4.162 does not claim final known-node classification,
`UNKNOWN_NODE_TYPE` ownership, parser-hint definition ownership, template
expansion ownership, props, styles, themes, indentation/document coordinates,
successful parsed nodes, AST, KIR, a public frontend API, or frontend cutover.

[X2] M4.163 may combine the independently authenticated immutable built-in and
mutable snapshot predicates into the exact bootstrap warning predicate. Until
then both `unresolved` states remain nonterminal.

## Review and publication

[V1] Run focused tests and the complete current fitness wall before review.

[V2] Run automatic high-risk exact-roster review with primary engine `codex`
and `--roles auto`; this slice adds a shared parser-evidence contract and spans
correctness, compatibility, resource bounds, and security.

[V3] Verify every finding against current source, fix genuine blockers, and use
targeted independent confirmation for risky review-driven fixes.

[V4] Publish one Agon-signed commit only after the final wall and review are
clean.

## Review delta

[V5] Initial high-risk role-lens review
`review-1786059566771-8wgz7s-m4162-mutable-registry-snapshot` completed all six
requested adapters and identified three verified blockers: separable/replayable
snapshot evidence, proxy/iterator reentrancy between capture and admission, and
partial M4.161 failure authentication. It also identified missing capture/name
bounds, missing inherited verdict/index comparison, an invalid epoch mutant,
and absent end-to-end failure coverage.

[V6] The implementation now uses private one-time source/runtime bindings with
current-epoch checks; rejects proxied runtimes, registry containers, and parser
hints; pins parser-used collection/iterator operations; drains bounded native
collections through captured intrinsics; applies configured count/scalar/byte
limits before sorting; authenticates every inherited failure field and the
decision-level built-in verdict/index; and executes native unsafe, oversized,
replay, failure, and mutation regressions end to end.

[V7] The review also exposed that the original six-call multiline-default
condition effectively authenticated only `body` in the native evaluator. The
corrected handler counts all six defaults during its single multiline
validation scan, and a missing-default end-to-end regression now covers the
complete failure boundary.

[V8] The final Node 22.22 fitness wall passed end to end, including both
737/737 canonicalizer executions, 13/13 core snapshot tests, both 12/12 native
snapshot executions, and both 8-case mutable-registry differential receipts.
Targeted independent security confirmation
`review-1786067792632-9vo4o8-m4162-security-fix-confirmation` completed 1/1
with zero findings.
