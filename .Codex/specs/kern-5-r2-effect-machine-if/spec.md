# KERN 5 R2/M3.7 Effect-Machine `if`/`else` Frames

**Status:** DONE
**Date:** 2026-07-13
**Confidence:** 0.99

## Executive Summary

M3.7 expands the private M3.6 effect machine over KERN `if` plus its immediate
sibling `else`. This is the first nested sequence frame in the unified engine:
the condition is evaluated once in the current environment, exactly one child
sequence is selected, and that sequence resumes through the same capability
effect generator and scheduler. Nested unsupported containers fail closed from
inside a claimed `if`; they never jump to a legacy runner after the machine
starts.

Tribunal `tribunal-1783901360004-oq9jqx-kern5-m3-7-next-slice` selected
`if`/`else` before branch, loops, try, linking, value widening, or ABI work.
**VERIFIED**

## Current State / Root Cause

- M3.6 marks `if` as `legacy`, and root eligibility accepts only the seven flat
  machine node types with empty bodies.
  (`packages/core/src/ir/semantics/internal-effect-machine.ts:15-85`)
  **VERIFIED**
- Current sequence runners pair one `if` only with an immediately following
  sibling `else`, skip that sibling as a separate statement, and propagate the
  first non-normal completion.
  (`packages/core/src/ir/semantics/reference-runner.ts:47-71`;
  `async-reference-runner.ts:120-149`) **VERIFIED**
- The synchronous `if` contract evaluates portable truthiness once and runs the
  selected children in the same environment. It currently delegates those
  children to `referenceRunSequence`, which the machine must not call.
  (`packages/core/src/ir/semantics/if.ts:48-135`) **VERIFIED**
- The async mirror contains a separate `asyncIfEffects` path and recursively
  re-enters `asyncReferenceRunSequence`.
  (`packages/core/src/ir/semantics/async-reference-runner.ts:356-374`)
  **VERIFIED**
- M3.6 raw-trace parity and full KERN 5 fitness are green at `1a323d86`.
  (`.Codex/specs/kern-5-r2-effect-machine/spec.md:167-179`) **VERIFIED**

## What Already Works

- `evaluateIfCondition` is the existing semantic authority for the selected
  condition and portable truthiness; no new condition language is needed.
  (`packages/core/src/ir/semantics/if.ts:90-123`) **VERIFIED**
- The M3.6 generator already preserves ordered events, abrupt completion, sync
  versus async-planned capability lanes, and M3.5 scheduler control.
  (`internal-effect-machine.ts:87-168`) **VERIFIED**
- Existing public source runners must retain their async `if` implementation in
  this slice because they call the async mirror directly rather than the
  private envelope adapter. (`packages/core/src/runner.ts:1297-1315`)
  **VERIFIED**

## Contract

> Verified against `1a323d86` on 2026-07-13.

| Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Disposition | `if` changes from `legacy` to `unified`; standalone `else` remains invalid | M3.6 disposition table | DECIDED |
| Pairing | Only an immediate sibling `else` supplied by the sequence frame is authoritative; incoming `props.__pairedElse` is ignored and any standalone `else` fails closed | `reference-runner.ts:50-63`; final review correction | VERIFIED |
| Condition | Evaluate only the current arm through `evaluateIfCondition`; a later else-if condition is evaluated only if its frame is selected | `if.ts:90-123`; forbidden rewrite at `if.ts:146-151` | VERIFIED |
| Environment | Selected body runs in the current `SemanticEnv`; no new lexical child scope | `if.ts:125-134` | VERIFIED |
| Frame | A generator sequence frame owns `{nodes,index,env,out}`; selected children create one nested generator frame via `yield*`; return merges ordered events and propagates completion | M3.6 generator structure | DECIDED |
| Effects | Capabilities in the selected branch yield through the existing M3.6 request; non-selected branches yield nothing | Existing machine capability request | DECIDED |
| Nested unsupported node | Once a root `if` claims the machine, an unsupported node in the selected body throws `InternalEffectMachineError`; there is no internal fallback | Tribunal verdict | DECIDED |
| Unselected unsupported node | It is not executed and cannot emit effects; selection remains condition-dependent as in current runtime | Existing `if` semantics | DECIDED |
| Public status | Production/public async runner, exports, handler ABI, and browser entry remain unchanged | Current containment gate | VERIFIED |

## Implementation Options

### A. Recursive generator sequence frame — selected

Refactor the M3.6 loop into a reusable generator sequence function. It performs
sibling pairing, dispatches `if` internally, and uses `yield*` for the selected
children. This is a real nested resumable frame without creating a second
effect protocol.

### B. Call the existing `if` contract effect — rejected

That effect calls `referenceRunSequence`, reintroducing the exact legacy
fallback M3.7 must eliminate.

### C. Add try/loops/linking first — rejected

Those require unwind, iteration, or module-scope state before the basic nested
sequence frame is proven.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/ir/semantics/internal-effect-machine.ts` | Modify | Add `if` disposition, pairing, selected child frame, and nested fail-close |
| `packages/core/tests/runtime-envelope-effect-machine.test.ts` | Modify | Replace legacy-if witness with raw nested parity/order/fail-close tests |
| `scripts/check-runtime-envelope.mjs` | Modify | Bind unified `if` and prohibit machine imports/calls of legacy sequence runners |
| Fitness policy/support matrix/release train | Modify after proof | Record M3.7 without public promotion |

## Acceptance Criteria

- [x] The disposition table marks exactly `if` as the new unified contract;
      branch, try, loops, functions/classes, and other deferrals remain legacy.
- [x] Root selection claims well-shaped `if`/immediate-`else` sequences for the
      machine; standalone `else` remains a stable failure.
- [x] True and false conditions evaluate once and execute exactly one selected
      body in the current environment.
- [x] Nested `if` and `else > [if, else]` chains preserve nearest-sibling pairing
      and abrupt return/throw propagation.
- [x] Sync and immediately resolved async capabilities inside the selected body
      produce structurally identical raw traces including assign/capability/
      stdout ordering and final completion.
- [x] The non-selected body invokes zero providers/interceptors and emits no
      events.
- [x] An unsupported selected nested node fails closed with no envelope events
      or result and never calls either legacy sequence runner.
- [x] The machine source still imports/calls neither sync nor async legacy
      sequence runner; the public async mirror remains unchanged.
- [x] Existing M3.5 cancellation/timeout/late-settlement tests and all M3.6 flat
      tests pass unchanged.
- [x] Public exports remain unchanged, `runtime-handler-abi` remains planned,
      and `test:runtime-abi` remains absent.
- [x] `pnpm test:kern-runtime-envelope` and `pnpm fitness:kern-5` pass.
- [x] Final Agon review with `claude,codex,agy` has zero verified findings.

## Out of Scope

Branch, try/catch/finally, while/for/each, break/continue, function/class calls,
async-mirror removal, module linking, value widening, raw environment rollback,
provider abort propagation, public ABI promotion, and all M4+ toolchain work
remain deferred.

## Open Questions

None. Existing `if` semantics fully determine this slice.

## Deploy Order

Ship M3.7 as one private default-off machine expansion. There is no public skew
window. Tribunal the next disposition expansion before linking or ABI work.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| `try` should precede `if` to test cancellation unwinding | M3.5 cancellation is terminal envelope control, not a catchable KERN exception | Prove basic nested sequence frames with `if` first; design try unwinding separately |
| The existing `if` contract can be reused directly | Its effect delegates selected children to `referenceRunSequence` | Reuse only current-condition authority; execute child frames inside the machine |
| `validateIfNode` can preflight a paired chain | It recursively evaluates unselected else-if conditions and can reject an arm that runtime selection never reaches | The machine evaluates only the current condition; selected nested frames validate themselves in order |
| A cloned node carrying `props.__pairedElse` can represent pairing | Prebuilt IR may smuggle that internal property without an immediate sibling | Pass the actual immediate sibling as frame-local state and never read pairing authority from input props |

## Completion Evidence

- `pnpm fitness:kern-5` passed after both review fixes on 2026-07-13,
  including 56 focused runtime tests and the complete workspace/release wall.
  **VERIFIED**
- Browser containment remained within budget at 75 modules and 290,674 gzip
  bytes. **VERIFIED**
- Agon review
  `review-1783905777025-nusm78-kern5-m3-7-effect-machine-if-ter` completed
  with all three engines and zero findings in every classification. **VERIFIED**
