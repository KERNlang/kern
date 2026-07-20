# KERN 5 R2 M3.31d — Public Runtime-Handler Sibling Helper Link

**Status:** IMPLEMENTED AND VERIFIED
**Date:** 2026-07-17
**Confidence:** 0.99 after implementation, full fitness wall, and clean terminal review
**Parent objective:** close the proven public-handler helper-link prerequisite for M4.1

## Executive Summary

The public typed runtime-handler entry currently parses a complete KERN source
module but extracts only the selected handler body and parameter names. Its
fresh execution environment receives no sibling function scope. A direct body
succeeds, while the same body calling a valid sibling KERN helper fails with
`unsupported-runtime-input` before execution.

M3.31d links the selected public handler to an authenticated, function-only
single-module runner scope built from that same parsed source. The scope is
installed on the per-invocation owned semantic environment before machine
admission. Reachable sibling helpers can then execute through the existing
canonical helper graph, snapshot, cache, recursion, and iteration contracts.

This slice does not add imports, classes, module loading, public ABI fields,
fallback execution, or new helper semantics. It only stops discarding already
valid same-source KERN helper declarations at the public handler boundary.

## Current State and Root Cause

- **VERIFIED:** `linkedEntry` parses the whole source and selects one `fn`, but
  returns only `body`, `parameters`, `identity`, and `signature`; sibling roots
  are discarded. Evidence: `runtime-envelope/source-handler.ts`.
- **VERIFIED:** `handlerEnvironment` creates an owned environment for arguments
  but does not install `runnerFunctions` or `runnerClasses`. Evidence:
  `runtime-envelope/handler-entry.ts`.
- **VERIFIED:** the ordinary source runner already builds an authenticated
  single-module scope whose function bindings retain defining-module identity.
  Evidence: `runner-runtime-scope.ts`.
- **VERIFIED:** the canonical helper graph, preflight, snapshot, cache,
  recursion, loop-budget, and failure containment already operate when an owned
  `runnerFunctions` scope is present.
- **VERIFIED RED:** a public handler that directly returns its list argument
  succeeds; an otherwise identical handler that calls a sibling identity helper
  fails with `unsupported-runtime-input` and no result/events.
- **VERIFIED:** M4.1's KERN-authored canonicalizer needs same-source helpers for
  bounded table validation, quoting, type rendering, and expression recursion.

## Claim Ledger

| Claim | Status | Evidence or oracle |
| --- | --- | --- |
| Public runtime handlers already link sibling helpers | REJECTED | direct/helper differential RED probe |
| Same-source helper declarations may be linked without public ABI change | VERIFIED | private linked-entry scope plus public envelope parity |
| Host JavaScript may execute a helper as fallback | REJECTED | machine-only runtime envelope remains unchanged |
| Imports or module loaders are part of M3.31d | REJECTED | source handler already rejects import roots |
| Classes are part of M3.31d | REJECTED | function-only scope; class roots remain inert/unreachable |
| Unreachable valid helper bodies may affect execution | REJECTED | graph analysis/execution remains reachability-based; module metadata snapshot is broader |
| Duplicate admitted sibling helper names may link ambiguously | REJECTED | deterministic link failure before effects |
| Runtime-handler request/envelope ABI changes | REJECTED | no new public fields, tags, diagnostics, or options |
| M3.31d makes siblings newly targetable by `handlerName` | REJECTED | current linker already selects any matching valid top-level function |
| `makeEnv` clones the installed runner-function map | REJECTED | verified `ownPlainMap` preserves the exact map object |

## Contract

| Surface | M3.31d contract | Failure rule |
| --- | --- | --- |
| Source authority | selected handler and helpers come from one parsed request source | no external file/module resolution |
| Helper set | valid top-level synchronous `fn` declarations with one KERN handler and non-void declared return | invalid declarations are not callable |
| Scope | fresh authenticated function-only root scope per public invocation | no class registry is installed |
| Reachability | only helpers transitively called from the selected handler are analyzed/executed; valid installed module metadata may be snapshotted as a whole | unreachable bodies do not run or add effects |
| Identity | helper lookup and recursion use linker binding identity; `env.runnerFunctions === scope.functions` | copied or caller-forged maps are forbidden |
| Arguments/results | existing portable scalar/list/record rules | no ABI broadening |
| Effects | existing helper graph contract; direct helper capabilities/print remain rejected | no host fallback or partial events |
| Loops/recursion | existing bounded iteration and helper recursion contracts | existing deterministic rejection applies |
| Snapshot | parsed helper bodies and the installed valid function scope freeze before execution | request/source mutation cannot affect an admitted run |
| Isolation | scope, bindings, cache, stack, arrays, scheduler, and capabilities are per invocation | overlapping calls share no mutable helper state |
| Sync/async | immediately resolved behavior and envelopes stay byte-identical | divergence fails the gate |
| Diagnostics | existing link/execution diagnostic taxonomy only | no new public diagnostic code |

## Selected Design

### 1. Function-only scope constructor

Add a focused internal constructor beside `buildSingleModuleRunnerRootScope`.
It collects valid runner functions from the parsed document, removes the
selected public entry from the helper set, allocates one `RunnerModuleScope`
with an empty class map, clones each remaining binding with `module: scope`, and
marks that scope for machine ownership. Existing source-runner construction
continues to include classes and is unchanged.

The constructor deliberately excludes classes rather than building the broad
source-runner scope and hoping class paths stay unreachable. This makes the
M3.31d boundary explicit and prevents accidental public class promotion.
Before allocation it scans top-level class names and rejects a callable-name
collision with an admitted sibling function without installing the class.

### 2. Private linked-entry scope

Extend the internal linked handler entry—not the public request—with the fresh
function scope. `linkedEntry` creates it from the same parse result after the
selected handler/signature checks. Imports remain link-rejected exactly as now.

Duplicate admitted helper bindings fail link deterministically. Malformed or
unsupported function declarations remain absent from the callable scope as in
the existing runner collector and cannot shadow an admitted binding; both source
orderings are regression-tested. The selected public entry never appears in the
helper scope, including when its name is not legacy `main`, so M3.31d does not
introduce selected-entry self-recursion or let a sibling call back into the
external entry. Sibling helper self/mutual recursion remains governed by the
existing bounded helper contract.

Public `handlerName` dispatch is unchanged: before M3.31d, any valid top-level
function can already be selected directly as the request entry. The new scope
does not add an entry namespace or make previously non-selectable declarations
selectable; it only changes what a selected entry may call.

### 3. Owned invocation environment

`handlerEnvironment` receives the internal entry and passes the scope's exact
function/class maps to `makeEnv`. `ownPlainMap` is verified to return that exact
map object; the implementation must not clone, spread, or reconstruct it after
`markRunnerMachineRootScope`. Argument bindings are then installed using the
existing ownership helpers. The environment keeps its own call cache and call
stack. Machine admission authenticates and snapshots the linked scope before
any effect. No admission predicate or ownership check is relaxed.

Manual/internal handler entries without a linked scope keep current behavior.
There is no global registry and no reuse across requests.

## Alternatives

### A. Inline M4.1 into one enormous handler

Rejected. It evades the proven handler-language ownership gap, removes reusable
KERN functions, and makes the canonicalizer harder to audit without fixing the
runtime contract KERN 5 actually needs.

### B. Execute helpers through the compatibility/reference runner

Rejected. The public runtime envelope is machine-only and must not acquire a
silent host fallback.

### C. Install the full class/function source-runner scope

Rejected for this slice. It would implicitly promote public class construction
and class effects without a dedicated contract or RED corpus.

### D. Reparse or dynamically look up a helper on every call

Rejected. It loses one-shot link identity, snapshot guarantees, and bounded
graph preflight.

### E. Copy the marked function map into the handler environment

Rejected. Machine ownership is keyed by exact scope/map identity. The marked
scope map is installed unchanged; a paired negative test proves a raw or copied
caller map still fails admission.

## Blast Radius

| Path | Action | Purpose |
| --- | --- | --- |
| `runner-runtime-scope.ts` | add focused function-only scope builder | reuse canonical binding/link ownership |
| `runtime-envelope/source-handler.ts` | modify private linked entry | retain same-source helper scope |
| `runtime-envelope/handler-entry.ts` | modify private environment construction | install per-run scope before admission |
| `runtime-handler-public-api.test.ts` | add RED/GREEN public contract cases | direct/helper, containment, parity, isolation |
| focused source-handler tests | extend if needed | duplicate/unreachable/class/import boundary |
| release train/spec | update after proof | record prerequisite without closing M4/R2 |

No public type export, request/envelope shape, package export, capability API, or
diagnostic code changes.

## Acceptance Criteria

- [x] Full-roster Agon tribunal completed 3/3 as
      `tribunal-1784290979470-yi1m9d-kern-5-r2-m3-31d-prebuild`; its real
      ownership/link-contract risks are incorporated. Two claims were rejected
      against current code: `makeEnv` preserves map identity, and sibling direct
      selection already exists.
- [x] RED proves direct public execution succeeds while a sibling helper call
      fails `unsupported-runtime-input` on the current branch.
- [x] A public handler calls one and multiple transitive same-source helpers in
      authored argument order with correct scalar/list results.
- [x] Helper loops, self-recursion, and mutual recursion retain existing
      iteration/recursion bounds; the selected public entry is not self-callable
      through the helper scope and wrong arity rejects.
- [x] Direct helper capability/print/unsupported shape rejects before effects;
      no compatibility/reference path executes.
- [x] Unreachable valid effectful helper bodies do not execute, reject, or emit
      events; malformed declarations remain non-callable and non-shadowing.
- [x] Duplicate admitted helper names fail during link before effects in either
      source order; malformed+valid same-name declarations follow the existing
      collector contract deterministically.
- [x] Class/function callable-name collision rejects, class construction stays
      unsupported, and imports remain link-rejected.
- [x] The exact marked function map reaches the environment unchanged; a copied
      or raw caller-provided map still fails machine admission.
- [x] Sync and immediately resolved async envelopes are byte-identical for
      scalar, transitive, rejected-side-effect, recursion, and loop-limit cases.
- [x] Overlapping invocations isolate helper scope, arrays, cache, stack,
      scheduler, capabilities, and results; full installed metadata snapshot
      cannot be mutated across invocations.
- [x] Public request/envelope shapes, diagnostics, package declarations, and
      existing direct `handlerName` target selection remain unchanged.
- [x] Existing public runtime-handler ABI tests pass unchanged.
- [x] Focused runtime/source-runner gates and full `pnpm fitness:kern-5` pass.
- [x] Terminal `agon review -e claude,codex,agy` has no unresolved material
      finding before commit:
      `review-1784294556508-m2mp6g-kern-5-r2-m3-31d-terminal-v2` completed 3/3
      with zero findings.

## Confidence Dependencies

- **0.99:** root cause—the linked entry and environment visibly discard sibling
  functions, and the direct/helper differential reproduces it.
- **0.99:** exact ownership path—`ownPlainMap` preserves the marked map identity;
  paired positive/negative admission tests prevent a trust relaxation.
- **0.97:** reuse of the canonical scope/helper graph is correct—depends on
  function-only construction retaining current ownership markers and identity.
- **0.96:** no accidental behavior broadening—depends on selected-entry removal,
  explicit empty class scope, collision/import, and unreachable-body tests.
- **Overall: 0.99** after tribunal amendments, source verification, the full
  fitness wall, and a clean terminal review.
