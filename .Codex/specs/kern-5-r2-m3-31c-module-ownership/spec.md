# KERN 5 R2 M3.31c Module-Owned Helper and Class Identity

**Status:** COMPLETE
**Date:** 2026-07-17
**Confidence:** 0.98
**Parent objective:** close the final `runner-classes-state` follow-up and promote the source runner's class row

## Executive Summary

M3.31c makes the canonical source machine own helper and class execution across
already-valid KERN module imports, additive re-exports, and aliases. A reached
binding must execute against its defining module's private helper/class scope,
not a root-flattened registry. Alias spelling is a lookup name only; function,
class, cache, receiver, recursion, and snapshot identity follow the defining
linker binding.

The implementation will authenticate the complete linker-created module graph,
clone it once per admission while preserving shared binding identity, and switch
every helper/class call frame to the frozen defining-module scope. Preflight and
capability planning will traverse that same module-relative graph. Direct helper
effects remain rejected, public runtime/capability ABIs do not change, and
cross-module inheritance remains unsupported because the compatibility linker
already rejects an imported base before scope wiring.

## Current State and Root Cause

- **VERIFIED:** the runtime linker creates one scope per module, tags own
  declarations with that scope, and wires imports/re-exports to the exact
  defining binding object. It deliberately does not copy imported bindings.
  Evidence: `packages/core/src/runner.ts:444-508`.
- **VERIFIED:** only the root scope is currently marked for machine admission.
  The ownership fact snapshots the root class map but has no authenticated
  module graph or module-relative snapshot. Evidence:
  `runner-machine-scope.ts:27-28,112-133` and `runner.ts:511-519`.
- **VERIFIED:** class admission rejects an alias because it requires map key,
  canonical class name, and defining scope to equal the selected root scope.
  Evidence: `internal-effect-machine-class-graph.ts:129-166`.
- **VERIFIED:** helper admission has the same root/name restriction and scans a
  reached helper body against root functions rather than the helper's defining
  module. Evidence: `internal-effect-machine-helper-graph.ts:241-310`.
- **VERIFIED:** per-run execution stores flat name-keyed class/helper registries
  and a name-keyed resumable set. Evidence:
  `internal-effect-machine-types.ts:52-60` and
  `internal-effect-machine.ts:76-94`.
- **VERIFIED:** helper cache keys, lookup, and child environments use the call
  spelling plus a flattened helper registry. This can collide for equal names
  and cannot resolve a defining module's private symbols. Evidence:
  `internal-effect-machine-helper-runtime.ts:31-40,77-107,149-207`.
- **VERIFIED:** class constructor/member environments likewise reuse the caller's
  functions and a flat class registry. Receiver lookup uses `className` against
  the current environment instead of the receiver's defining module. Evidence:
  `internal-effect-machine-class-activation.ts:83-126` and
  `internal-effect-machine-class-graph.ts:352-436`.
- **VERIFIED:** capability planning explicitly disables machine class ownership
  whenever imports exist, and imported class references conservatively mark all
  members unsupported. Evidence:
  `runner-capability-plan.ts:154-173,485-550`.
- **VERIFIED:** compatibility behavior already covers explicit aliases,
  re-exports, transitive imports, an imported helper's private class, and
  same-named private helper isolation. Evidence:
  `packages/core/tests/runner-source-executor.test.ts:4025-4171,4329-4380,4483-4518`.
- **VERIFIED:** M3.31b2c2 leaves imported/re-exported/cross-module identity as the
  sole M3.31c follow-up. Evidence: `docs/kern-5-release-train.md:758-779` and
  `scripts/source-runner-convergence-manifest.json`.
- **VERIFIED:** cross-module inheritance is not compatibility behavior:
  `collectRunnerClasses` rejects a base absent from the declaring module before
  imports are wired. Evidence: `runner-runtime-scope.ts:186-201`.

## Scope and Claim Ledger

| Claim | Status | Evidence or oracle |
| --- | --- | --- |
| Imports and re-exports preserve the defining binding object | VERIFIED | `runner.ts:460-503` |
| Alias spelling may differ from canonical binding name | VERIFIED | runtime linker plus existing module fixtures |
| Machine admission can trust only linker-created, unchanged scope graphs | VERIFIED requirement | current private root/class ownership boundary |
| One frozen graph can retain alias references and defining-module identity | PROPOSED | RED mutation, alias, and same-name isolation oracles |
| Helper/class frames must execute with the binding's defining scope | VERIFIED requirement | compatibility behavior and current flat-frame root cause |
| Planner must clear unsupported only for runtime-admitted linked paths | VERIFIED requirement | existing planner/runtime disposition contract |
| Cross-module inheritance is part of M3.31c | REJECTED | compatibility collection rejects imported bases |
| Public handler, capability, continuation, or module-loader ABI must change | REJECTED | private runtime convergence only |

## Contract Table

| Surface | M3.31c contract | Failure rule |
| --- | --- | --- |
| Graph owner | exact root plus every linked module scope and exact map entries | forged, replaced, deleted, or added entries fail before provider dispatch |
| Binding identity | aliases and re-exports point to one frozen defining binding | no canonical-name copy or root flattening |
| Function lookup | resolve call spelling in the active frozen module scope | missing/kind-skewed target remains link/admission failure |
| Function frame | body, nested helpers, and private classes use `fn.module` | caller scope never shadows defining-module private names |
| Class lookup | resolve construction spelling in active scope; instance stores canonical class plus defining scope | alias spelling does not become class identity |
| Class frame | constructor, fields, methods, getters, lineage, and helpers use `cls.module` | receiver/module mismatch fails closed |
| Inheritance | same-defining-module inheritance only | imported base remains existing link error |
| Helper cache | partition by frozen function binding identity plus values/provenance | equal names in separate modules never share results |
| Recursion identity | binding/member identity, not display label alone | equal class/member names across modules do not false-positive |
| Resumability | fixed-point closure over frozen function binding identities | name collisions cannot mark the wrong helper resumable |
| Snapshot | graph maps, bodies, metadata, members, lineage, and aliases freeze before first suspension | later source/map/object mutation cannot affect the run |
| Concurrency | graph, cache, receivers, frames, budget, seed, time, and providers stay per run | overlapping runs cannot share private state |
| Preflight | traverse root sequence, then each reached binding in its defining scope | any reached unsupported path rejects before the first provider |
| Planner | exact imported function/class constructor/member reachability follows defining modules | unreachable member capabilities are not executable; admitted reached paths are not unsupported |
| Compatibility | all out-of-domain shapes keep compatibility selection | no post-provider fallback |

## Selected Design

### 1. Linker-authenticated module graph

Extend the private scope owner from one root marker to one graph marker. The
marker receives the root scope plus every linker-built scope after imports are
wired. It snapshots exact function/class maps, map entries, defining-module
references, and owned binding metadata. Every entry must resolve to a binding
whose defining scope belongs to the graph. Own entries use their canonical
name; imported aliases may use a different local key but must reference an
existing defining binding.

Single-module scope construction uses the same one-scope graph contract. Raw
caller maps and a valid root map mutated after marking remain inadmissible.

### 2. Identity-preserving frozen graph

Admission clones all authenticated scopes in two passes:

1. allocate one empty frozen-view scope per original module;
2. clone each unique function/class binding once, point its `module` at the
   cloned defining scope, then populate every local key with that shared clone.

Bodies, params, returns, fields, constructors, methods, getters, and IR metadata
use existing deep snapshot rules. The result exposes a frozen root scope plus a
private original/snapshot scope index. Alias/re-export keys therefore survive,
while two modules' equal canonical names remain distinct bindings.

The clone owner is always the original binding's `module`, never the scope whose
alias/re-export entry happened to expose it. For A -> B re-export -> C import,
all three local keys reference one clone whose module is A's cloned scope.

### 3. Module-relative execution

Install the frozen graph on `InternalEffectMachineState`. Root execution resolves
against its frozen root. A helper call first resolves the local spelling in the
active scope, then creates its child environment with the resolved binding's
defining `functions` and `classes`. Class construction follows the same rule.
An instance keeps its defining frozen module; later getter/method dispatch uses
that module registry even when the receiver is held by another module.

Cache partitions key first by function binding identity. Resumable closure uses
function binding identities. Class recursion labels gain a private module/binding
token while public diagnostics retain canonical `Class.member` spelling.

### 4. Module-aware graph admission and preflight

Replace root-name worklists with binding-identity worklists carrying the active
module scope. Calls in a helper/class body resolve from the binding's defining
scope. Class composition, scalar-return proof, inheritance, constructor plans,
and selected member preflight receive that scope's frozen registries. The root
sequence is the only root-scope seed; transitive private declarations enter only
through reached bindings.

Unused declarations may exist in an authenticated snapshot, but an unsupported
unused member must not poison an otherwise admitted path. Direct `capability` or
`print` nodes in helper bodies remain outside the pure-helper language; effects
are still owned only through admitted class frames.

### 5. Exact linked-module capability planning

Replace the single `ownsClassFrames` root boolean with linked-graph admission.
The planner builds the same linked runtime scopes from its already-parsed module
graph, then asks source-machine admission for the selected root handler.

Reachability work items carry defining module plus function/class/member
identity. Imported function calls jump to their defining handler. Imported class
construction queues only its constructor lineage; receiver tracking queues only
the selected getter/method and continues that member body in the defining
module. Re-export and alias resolution reuse the existing capability-module
scope map. A reached handler is `unsupported` unless the complete linked graph is
runtime-admitted; planner-only suppression is forbidden.

This planner continues to classify requirements and compare them with the
existing host-provided capability options. KERN modules do not register
providers during module initialization, so M3.31c neither introduces a provider
dependency graph nor changes ambient/native provider readiness.

The already oversized `runner-capability-plan.ts` receives no new traversal
bulk. Module-aware handler traversal is extracted to a focused source file under
500 lines.

### 6. Final convergence promotion

Add a dedicated module-ownership convergence owner and mutations for graph
authentication, alias identity, defining-scope switching, binding-keyed cache,
receiver module dispatch, snapshot depth, preflight timing, and planner
disposition. Promote `runner-classes-state` from `legacy` to owned/current,
remove the M3.31c follow-up, and record the release receipt. Reference and
fallback engines must not be invoked for the admitted corpus.

## Alternatives Considered

### A. Relax root name/module guards

Rejected. It admits aliases but still flattens nested private symbols, collides
equal names, and loses receiver identity after suspension.

### B. Copy imported bindings into the root registry under aliases

Rejected. Copies make one definition acquire multiple identities, break private
module resolution, and make mutation/cache behavior order-dependent.

### C. Use module path strings as runtime identity

Rejected. Paths are loader metadata, invite hardcoded/public coupling, and are
unnecessary because linker-owned scope/binding objects already provide private
identity.

### D. Snapshot every loaded module but preflight every declaration

Rejected. Authentication may cover the complete linked graph, but behavioral
admission must remain reachability-based so unused unsupported members do not
become false blockers.

## Blast Radius

| Area | Action | Reason |
| --- | --- | --- |
| `runner-machine-scope.ts` plus focused snapshot module | modify/add | authenticate and clone complete module graphs |
| `runner-runtime-scope.ts`, `runner.ts` | modify | mark all scopes and share linked-scope construction |
| class/helper graph and preflight modules | modify/extract | binding-identity, defining-scope traversal |
| helper runtime/types/state | modify | scope-relative lookup, binding cache/resumability identity |
| class graph/frame/activation | modify | alias construction and receiver-defining-module dispatch |
| planner admission and linked handler traversal | modify/extract | exact runtime-owned cross-module disposition |
| focused runtime/planner tests | add | RED/GREEN identity, suspension, containment, precision |
| convergence scripts/manifest/release train | modify | final row promotion and mutation binding |

No new handwritten source file may exceed 500 lines; already oversized files
must shrink or receive only small wiring changes.

## Acceptance Criteria

- [x] RED-at-base proves an imported helper alias and imported class alias select
      compatibility (or fail machine-only) before M3.31c.
- [x] Sync and async public runners execute imported and re-exported aliases on
      the source machine with zero reference/fallback invocations.
- [x] An imported helper resolves its defining module's private same-named helper
      and private class, not root declarations with equal names.
- [x] A root-held imported class receiver dispatches constructor, method, getter,
      virtual/super work, and nested helper calls in its defining module.
- [x] Two modules with equal helper/class/member names keep distinct cache,
      resumability, receiver, and recursion identity.
- [x] A transitive additive re-export retains the original defining binding and
      module-private resolution.
- [x] A reached imported class effect suspends/resumes exactly once; provider and
      trace order match compatibility with no replay.
- [x] A reached unsupported private path rejects before an earlier root provider;
      an unreachable unsupported member does not poison admission.
- [x] Mutation after selection cannot replace graph maps, aliases, function/class
      metadata, bodies, members, lineage, or defining-module identity.
- [x] Overlapping runs isolate snapshots, caches, receivers, continuations,
      providers, budget, seed, and time.
- [x] Forged scopes, foreign bindings, map mutation, alias replacement, and
      receiver/module skew fail before provider/accessor execution.
- [x] Planner reports only reached imported capabilities executable, clears
      unsupported only for the admitted graph, and preserves missing-provider and
      async-boundary reporting.
- [x] Import cycles, missing exports, kind mismatch, alias conflict, direct helper
      effects, and cross-module inheritance retain current failures.
- [x] Convergence mutations bind every identity boundary; `runner-classes-state`
      is current with no remaining M3.31c follow-up.
- [x] Focused gates, typecheck, lint, full `pnpm fitness:kern-5`, and terminal
      `agon review -e claude,codex,agy` pass with all verified blockers fixed.

## RED Oracle Matrix

1. `main -> imported bar as remoteBar -> private foo`, with a root `foo` of the
   same name; output must come from the imported module.
2. `main -> re-exported helper alias -> private class -> effectful getter`; one
   async provider call and one result after resume.
3. `main -> new ImportedBox as Alias -> method/getter`, while root also declares
   `Box`; receiver dispatch must use imported identity.
4. Root class method calls imported helper; imported helper uses a same-named
   private class/member. No false recursion diagnostic.
5. Two imported helpers named `compute` through different aliases receive equal
   arguments but produce module-specific cached results.
6. Two-level additive re-export preserves the base module's private helper and
   class identity.
7. A provider fires before external metadata mutation; resumed execution uses
   the pre-suspension module graph.
8. Two overlapping async runs mutate different exposed metadata and receive
   different provider results without cross-run leakage.
9. A reached malformed/unsupported imported member fails before an earlier root
   provider; the same member when unreachable does not affect execution.
10. Planner sees one selected imported method capability but not another unused
    method's capability; machine/reference dispositions agree.
11. Forged module scopes and post-mark alias/map replacement reject without
    calling a provider or getter.
12. Existing link-error parity and direct-helper-effect rejection remain green.

## Out of Scope

- Cross-module inheritance or changing class collection/link semantics.
- Class instances crossing helper parameters, helper results, or external
  bindings.
- Direct helper `capability`/`print`, setters, statics, streams, or explicit async
  KERN member syntax.
- New public module tokens, continuation/frame APIs, handler ABI, capability ABI,
  or module-loader ABI.
- Transactional rollback of already-observed external effects.

## Open Questions

None.

## Adversarial Record

`nero-1784271256785-sab58w` challenged re-export parenting, cyclic module
initialization, JavaScript live bindings, prototype/`instanceof` identity, and
ambient capability providers. The re-export challenge strengthened the explicit
rule that a clone is owned only by the original binding's defining module and is
created once for the whole run.

The other scenarios are outside the actual KERN contract: module exports are
functions/classes rather than mutable JavaScript namespace bindings; KERN
modules do not execute provider-registration initialization; runner class
instances are private records with no JavaScript prototype/`instanceof` ABI and
cannot cross helper/external boundaries; and capability planning reports host
provider readiness rather than granting capabilities from user-module imports.
No implementation scope was widened for those assumptions.

## Terminal Verification Record

The final Node 22 `pnpm fitness:kern-5` wall passed after every review fix:
432/432 cross-target fixtures, 109/109 class fixtures, 233 native cases,
48/48 checker fixtures, 39/39 validator verdicts, and 40 application fixtures
on three legs plus whole-app boot. The required browser wall passed at 153
modules / 1,534,548 raw / 328,497 gzip bytes / 75 ms cold / 108 ms browser,
and all 68 convergence mutations were killed.

The review sequence was substantive rather than ceremonial. The first panels
added exact oracles for caller-independent field initialization and binding-keyed
resumability (`review-1784274854035-iz1wpn`,
`review-1784275324468-ctztgz`). The next full-roster review found a real
imported-helper -> private-class -> private-helper reachability gap; a RED
iteration-budget oracle reproduced it, the class composition graph now returns
the exact reached helper bindings, and convergence binds both the owner and
oracle (`review-1784277601118-gduk7h`).

The terminal full-roster review completed on the final diff
(`review-1784279863324-vvtril`). Its remaining Agy blockers were disproved
against current source: resumable frames already execute `call.fn`; scanning
every non-root class would violate the accepted exact-reachability contract and
is superseded by imported-alias and helper-class binding traversal; constructor
stack labels are not compared for recursion identity, while method/getter
frames use `classFrameIdentity`. Codex reported no findings, and Claude's only
important item was explicitly low-confidence defense-in-depth rather than a
current executable defect.

## Deploy Order

Build and verify the complete slice locally with granular signed commits and one
remote push. Immediately before publication, fetch and rebase. If M3.31b2c2 is
then present on `origin/main`, move the validated M3.31c commits to a fresh
`feat/kern-5-r2-m3-31c-module-ownership` branch created from `origin/main`; never
push the merged M3.31b2c2 branch again. If it is still absent, stack M3.31c on the
existing branch and push that same branch once, exactly as instructed.

No source release is declared until the full local wall, convergence mutations,
and terminal full-roster review pass.
