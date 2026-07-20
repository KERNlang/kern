# KERN 5 R2 M3.14 Legacy-Free Shared Evaluator Boundary

**Status:** COMPLETE (SCOPED)
**Date:** 2026-07-13
**Confidence:** 0.99

## Executive Summary

M3.14 makes the private effect machine's complete static runtime import closure
independent of both reference runners. The implementation extracts data-only
branch/for/if/while leaves, separates portable scalar domain/core evaluation
from reference-only function and class body execution, and makes the machine
instantiate the core with fail-closed runner extensions. Existing reference
imports and export names remain compatible through facades; the machine gains
no public ABI.

The design was challenged by the full Agon roster in:

- tribunal: `/Users/nicolascukas/.agon/runs/tribunal-1783937983228-zpjc10`;
- implementation refinement:
  `/Users/nicolascukas/.agon/runs/brainstorm-1783938291433-ayl4lq`.

## Current State / Root Cause

- **VERIFIED:** `internal-effect-machine-sequence.ts` imports runtime selection
  helpers from the legacy `branch.ts`, `for.ts`, `if.ts`, and `while.ts`
  contract modules (`packages/core/src/ir/semantics/internal-effect-machine-sequence.ts:2-10,29`).
- **VERIFIED:** each of those four contract modules imports
  `referenceRunSequence`, so a helper-only import also instantiates the legacy
  sync runner (`branch.ts:38`, `for.ts:28`, `if.ts:32`, `while.ts:40`).
- **VERIFIED:** the stable machine also reaches `portable-scalar.ts` through
  `capability.ts`, and that evaluator imports `reference-runner.ts` directly
  (`internal-effect-machine-sequence.ts:3-7`, `capability.ts:22`,
  `portable-scalar.ts:46`).
- **VERIFIED:** `portable-scalar.ts` invokes `referenceRunSequence` only for
  synchronous runner class/member and runner function bodies
  (`portable-scalar.ts:1059-1065,1316-1323`).
- **VERIFIED:** machine eligibility already requires a root environment with
  no runner functions, runner classes, or active `this`
  (`internal-effect-machine-structure.ts:12-18,46-48`). This prevents the
  reference-only body paths for today's eligible corpus, but it does not prove
  architectural independence because the legacy runner is still statically
  instantiated.
- **VERIFIED:** the async evaluator already receives body execution as an
  explicit dependency (`async-portable-scalar.ts:38-40,63-67,209-214,257`).
- **VERIFIED:** `portable-scalar.ts` is 1,823 lines and must shrink; the four
  legacy control modules are 263-367 lines (`wc -l
  packages/core/src/ir/semantics/{branch,for,if,while,portable-scalar}.ts`,
  2026-07-13).
- **VERIFIED:** the current closure walker is TypeScript-AST based, follows
  runtime imports/exports/dynamic imports/requires, and supports mutation reads
  (`scripts/runtime-envelope-import-closure.mjs:9-41,51-76`).
- **VERIFIED:** the stable-machine closure guard currently excludes legacy
  `try.ts` and the async runner but not the sync runner
  (`scripts/check-runtime-envelope.mjs:199-202`).

The root cause is mixed ownership inside shared modules: portable data
selection and pure scalar evaluation live in the same files as legacy sequence
execution. Static import closure therefore overstates what machine-eligible
inputs can execute and leaves future ownership drift mechanically possible.

## What Already Works

- The resumable effect-machine driver, sequence executor, structural analyzer,
  try executor, scheduler unwind, and capability suspension ABI are unchanged.
- Legacy sync and async reference runners remain the parity oracles.
- The environment, trace, completion, capability, iteration-budget, and caught
  error contracts do not change.
- M3.13 already excludes legacy `try.ts` from the stable machine and excludes
  both reference runners from the new try executor closure.
- Public `@kernlang/core` exports continue to resolve through the existing
  `portable-scalar.ts` compatibility facade; no portable-machine evaluator is
  publicly exported.

## Contract (Verified)

> Verified against the cited source files and commands on 2026-07-13.

| Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Machine root environment | No functions, classes, active `this`, or parent scope | `internal-effect-machine-structure.ts:12-18` | VERIFIED |
| Machine control selection | if/branch/for/while helpers are evaluated inside the machine sequence | `internal-effect-machine-sequence.ts:64-105,135-187` | VERIFIED |
| Legacy body execution | Selected branch/loop/if bodies execute with `referenceRunSequence` | `branch.ts:186-197`; `for.ts:133-165`; `if.ts:127-139`; `while.ts:75-105` | VERIFIED |
| Sync scalar runner extension | Function and class bodies execute through `referenceRunSequence` | `portable-scalar.ts:1012-1168,1255-1335` | VERIFIED |
| Async scalar runner extension | Body execution is supplied as `runFunctionBody` | `async-portable-scalar.ts:38-40,257` | VERIFIED |
| Static closure oracle | Runtime-valued TS imports/exports are followed transitively | `runtime-envelope-import-closure.mjs:9-64` | VERIFIED |
| Current scalar clients | 19 source modules import `portable-scalar.js`; all are production semantic modules, not dead test-only clients | `rg -l "from './portable-scalar\\.js'" packages/core/src`, 19 paths on 2026-07-13 | VERIFIED |

## Implementation Options

### Option A — eligibility plus injected legacy callback

Keep the monolithic evaluator, remove its static runner import, and obtain body
execution from the environment. This is smaller, but the machine would still
import a legacy-aware evaluator and ownership would depend on a runtime
convention. It does not meet the construction-level boundary required here.

### Option B — pure evaluator factory plus reference and machine hosts

Split portable domain/value helpers from recursive core evaluation. Break the
array/map/string back-edges by passing the recursive evaluator explicitly.
Instantiate the core once with reference function/class extensions and once
with fail-closed machine extensions. Keep old import names through a facade.
This is the selected option: it removes legacy execution by module
construction without duplicating scalar semantics.

### Option C — build aliases or conditional resolution

Resolve different evaluator modules per build profile. This leaves the source
graph ambiguous and makes IDE, test, and production closure depend on tooling
configuration. It is rejected.

## Selected Module Boundary

| Module | Ownership | May import a reference runner? |
|---|---|---|
| `portable-scalar-domain.ts` | scalar/record/array/decimal tags, predicates, assertions, portable truthiness | No |
| `portable-eval-types.ts` | evaluator and extension-host types/sentinels | No |
| `portable-core-evaluator.ts` | recursive pure evaluator dispatcher and operators | No |
| `portable-record-evaluator.ts` | record/nested-array reads and literal helpers | No |
| `portable-core-evaluator.ts` / `portable-record-evaluator.ts` | machine-safe member/index evaluation | No |
| `portable-decimal-evaluator.ts` | Decimal recognition/evaluation | No |
| `portable-reference-evaluator.ts` | sync runner function/class construction and body execution | Yes, sync only |
| `portable-machine-evaluator.ts` | core instance with fail-closed function/class host | No |
| `portable-scalar.ts` | compatibility facade preserving existing export names | Yes, through reference evaluator |
| `branch-runtime.ts` | branch shape/value/path selection | No |
| `for-runtime.ts` | for shape/range evaluation | No |
| `if-runtime.ts` | portable if condition evaluation | No |
| `while-runtime.ts` | strict while condition and iteration constant | No |

If a proposed module would exceed 500 handwritten lines, split it by the
ownership rows above rather than merging responsibilities.

## Recursive Evaluator Contract

- `portable-array.ts`, `portable-map.ts`, and `portable-string.ts` receive an
  `EvalPortableValue` callback for nested argument/element evaluation and no
  longer import the legacy facade.
- The core evaluator supplies its own recursive function to those helpers.
- The reference host owns every function/class body call and is the only
  portable evaluator module allowed to import `reference-runner.ts`.
- The machine host rejects function/class construction, calls, getters, and
  methods. This is a defense-in-depth invariant; eligibility must reject such
  environments before execution.
- There is no global evaluator registry, mutable singleton, dynamic import,
  build alias, or default callback that can select the reference runner.

## Client Inventory / Migration

The 19 current facade clients are all live semantic modules. They split into:

- reference-only or public semantic clients that retain the compatibility
  facade: `assign.ts`, `async-portable-scalar.ts`, `async-reference-runner.ts`,
  `do.ts`, `expression-v1.ts`, `fmt.ts`, `let.ts`, `portable-error.ts`,
  `portable-regex.ts`, `primitives.ts`, `print.ts`;
- shared collection helpers that migrate to evaluator injection:
  `portable-array.ts`, `portable-map.ts`, `portable-string.ts`;
- machine-reachable clients that import the machine evaluator or extracted
  domain helpers: `capability.ts`, `each-runtime.ts`;
- control-flow contracts that retain the facade while their new runtime leaves
  import the machine evaluator: `for.ts`, `if.ts`, `while.ts`;
- `branch.ts`, which has no scalar-facade dependency but moves selection logic
  into `branch-runtime.ts`.

No client is deleted. The legacy facade continues to supply its existing names
and call signatures during the migration.

## Blast Radius

| File/group | Action | Reason |
|---|---|---|
| new portable domain/core/reference/machine modules | add | establish explicit evaluator ownership |
| `portable-scalar.ts` | replace with compatibility facade | preserve imports while removing mixed implementation |
| `portable-array.ts`, `portable-map.ts`, `portable-string.ts` | modify | replace evaluator back-edge with explicit recursion callback |
| portable-scalar client modules | modify imports/signatures as needed | select reference or machine ownership explicitly |
| new `branch/for/if/while-runtime.ts` | add | isolate selection/condition/range logic |
| legacy `branch/for/if/while.ts` | modify/re-export | retain contracts and reference body execution |
| effect-machine sequence/structure | modify imports only | consume runtime-only leaves |
| runtime architecture guard/mutation tests | strengthen | prove direct and transitive quarantine |
| focused evaluator/control tests | add/modify | prove behavior and fail-closed boundary |
| support matrix, fitness policy, release train | update after gates | publish M3.14 evidence |

## Implementation Sequence

1. Add a RED closure assertion that forbids both reference runners, the legacy
   portable facade, and legacy branch/for/if/while modules from the stable
   machine closure. Add mutations for direct and transitive forbidden edges.
2. Extract branch/for/if/while runtime leaves mechanically; keep legacy contract
   behavior and exports through imports/re-exports.
3. Extract scalar domain/types, then make array/map/string nested evaluation
   explicit to break the evaluator cycle.
4. Extract the recursive core and its record/member/decimal leaves. Introduce
   reference and machine hosts without copying dispatcher logic.
5. Convert `portable-scalar.ts` to a facade, migrate all 19 clients, and assert
   that facade exports remain source-compatible.
6. Run focused reference, async, effect-machine, import-closure, and mutation
   tests; then run the full KERN 5 fitness wall.
7. Run terminal Agon review with `claude,codex,agy`, fix every verified or
   needs-check finding, rerun affected gates, and only then close M3.14.

## Acceptance Criteria

- [x] Stable `internal-effect-machine.ts` runtime import closure excludes
  `reference-runner.ts`, `async-reference-runner.ts`, `portable-scalar.ts`,
  `portable-reference-evaluator.ts`, and legacy branch/for/if/while/try/each
  contract modules.
- [x] Import mutation tests fail for direct runner imports, a runtime-leaf to
  legacy-contract edge, and a core-evaluator to legacy-facade edge.
- [x] Branch/for/if/while machine traces, completions, child scopes, and error
  behavior remain byte-equivalent to their pre-extraction acceptance cases.
- [x] Machine scalar evaluation covers literal/unary/binary/conditional,
  member/index, record/array, Decimal, List, Map, and Text shapes already
  admitted by the M3 corpus.
- [x] A nonempty runner-function/class environment is ineligible before machine
  execution, and direct function/class calls against the machine evaluator fail
  closed without loading or invoking a reference runner.
- [x] Existing sync and async reference function/class construction, method,
  getter, recursion, caching, capability, and error behavior remains green.
- [x] The `portable-scalar.ts` compatibility facade preserves every prior
  exported name and source call signature.
- [x] No duplicated scalar dispatcher, dynamic fallback, build alias, or
  conditional import selects a reference evaluator inside the scalar boundary.
  The pre-existing global contract registry remains executable-envelope debt
  and is explicitly assigned to M3.15.
- [x] Every new handwritten source file is below 500 lines and the existing
  1,823-line evaluator shrinks to a facade.
- [x] Focused core/reference/effect-machine tests and
  `pnpm test:kern-runtime-envelope` pass.
- [x] `pnpm fitness:kern-5` passes on the final implementation.
- [x] Terminal `agon review` with `claude,codex,agy` has zero unresolved
  verified or needs-check findings.

## Out of Scope

- Public runtime/handler ABI promotion.
- Executable-envelope isolation from global contract registration and legacy
  fallback; that is the separately guarded M3.15 slice.
- Async reference-runner ownership changes beyond preserving current behavior.
- Adding runner functions/classes to the machine-eligible corpus.
- Removing reference runners or changing their role as parity oracles.
- Changing expression, trace, completion, capability, or iteration semantics.
- M4 public scheduler/handler promotion and later self-hosting stages.

## Deploy Order

This is one package-internal source change and ships atomically in one branch
push after the full local wall. There is no supported mixed-version internal
module graph. Public exports retain their names throughout, so downstream
package skew sees no intentional API change.

## Open Questions

None. Any extraction-time discovery that changes evaluator behavior or requires
a public signature change reopens the spec and requires another tribunal before
implementation continues.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| Extracting only branch/for/if/while leaves closes M3.14. | `capability.ts` reaches `portable-scalar.ts`, which imports and invokes the sync reference runner. | The scalar evaluator boundary is mandatory. |
| A sync callback inside the existing evaluator is the smallest honest fix. | It removes a static edge but leaves machine code importing a legacy-aware 1,823-line evaluator and relies on runtime discipline. | Use a construction-level core/reference/machine split. |
| The scalar core can be moved as one file. | Array/map/string helpers import the evaluator back, and a monolithic core would violate the 500-line rule. | Break recursive edges explicitly and split core responsibilities. |
| The planned `portable-member-index.ts` module is required. | Member/index ownership fits below the line limit inside `portable-core-evaluator.ts` and `portable-record-evaluator.ts`. | Keep the smaller acyclic module graph and correct the module inventory. |
| A static machine closure proves the executable envelope is legacy-free. | `execute.ts` still registers global contracts and `internal-engine.ts` still owns legacy fallback; runtime registry state can dispatch reference-owned leaves. | Close M3.14 only as the stable machine/evaluator import boundary and require a distinct M3.15 executable-envelope isolation oracle. |
| TypeScript import parsing covered every runtime edge. | `import x = require('./x.js')` was initially missed and inline type-only exports were over-counted. | Extend the AST walker and mutation suite before accepting the closure proof. |
| A Decimal value-producing call must be returned by the scalar machine evaluator. | Decimal objects are intentionally outside `PortableScalar`; comparator calls evaluate nested Decimal producer trees and return a scalar. | Add explicit nested-producer, top-level rejection, zero-divisor, and canonical string-coercion regressions. |
| `test:kern-runtime-envelope` exercised the new machine evaluator. | Its path filter selected only `runtime-envelope` tests and omitted `portable-machine-evaluator.test.ts`. | Bind both suites into the named fitness-policy command. |
| Ignoring unknown bare imports was safe because the production graph had no aliases. | An arbitrary build alias could hide a forbidden source edge, and treating peer dependencies as external would also exempt `typescript`. | Fail closed on every undeclared bare import; exempt only runtime dependencies and mutation-test aliases plus peer dependencies. |
| The static Decimal pow probe made every accepted base non-negative. | Computed and bound negative bases bypassed the literal-only probe, while decimal.js reports computed signed zero as negative too. | Add the same nonzero-negative runtime guard to machine, TS, and Python helpers with one target-neutral diagnostic and signed-zero regressions. |

## Completion Evidence

- Terminal implementation: commit `d6634f1d` closes the private stable-machine
  and portable-machine static runtime import boundary. This is not an
  executable-envelope or public-ABI cutover.
- Implementation wall: `pnpm fitness:kern-5` passed on the final M3.14
  implementation tree on 2026-07-13, including workspace tests,
  cross-target/app conformance, native KERN tests, browser budget, KIR proofs,
  and `test:kern-runtime-envelope`.
- Descendant regression wall: `pnpm fitness:kern-5` passed again on the M3.15
  descendant worktree on 2026-07-14. This proves no regression but is not an
  isolated clean-checkout fitness run of `d6634f1d`.
- Review remediation: `review-1783951516688-cbxqcr-m3-14-terminal-fixes`
  identified the peer-dependency exemption and imprecise Decimal assertion;
  both were fixed and the affected gates rerun.
- Terminal review: full roster `claude,codex,agy` completed 3/3 with zero
  verified or needs-check findings at
  `/Users/nicolascukas/.agon/runs/review-1783984093881-cj5xgv-m3-14-terminal-review`.
  Its sole nit is future-proofing for control characters absent from every
  current Decimal diagnostic and is nonblocking.
- Completion tribunal: full roster `claude,codex,agy` approved this scoped
  completion and the evidence-attribution caveat at
  `/Users/nicolascukas/.agon/runs/tribunal-1783984246816-s1ysxv-m3-14-completion-adjudication`.
