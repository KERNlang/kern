# KERN 5 R2 M3.8 Private Effect-Machine Branch Frames

**Status:** DONE
**Date:** 2026-07-13
**Confidence:** 0.97

## Executive Summary

Move `branch` from the legacy disposition into the private internal effect
machine. Reuse the existing branch validator and selector, execute exactly the
selected `path` body through the shared resumable machine in `childEnv(env)`,
and preserve raw sync/async trace parity without changing the public async
runner or package API.

The full-roster adversarial tribunal selected this slice over loops, unwind, and
callable linking: `/Users/nicolascukas/.agon/runs/tribunal-1783906090475-7lqul7-kern5-m3-8-next-slice`.

## Current State / Root Cause

- **VERIFIED:** `branch` is the remaining legacy selection frame while `if` is
  already unified (`packages/core/src/ir/semantics/internal-effect-machine.ts:20`).
- **VERIFIED:** root eligibility rejects every body-bearing node except paired
  `if`/`else`, so a root branch cannot currently select the machine
  (`packages/core/src/ir/semantics/internal-effect-machine.ts:90`).
- **VERIFIED:** the canonical validator and first-match/default selector already
  exist and are exported (`packages/core/src/ir/semantics/branch.ts:123`,
  `packages/core/src/ir/semantics/branch.ts:150`).
- **VERIFIED:** legacy branch execution opens a child lexical environment for
  the selected path (`packages/core/src/ir/semantics/branch.ts:163`).
- **VERIFIED:** the shared machine recursively executes selected `if` bodies
  without calling a legacy runner (`packages/core/src/ir/semantics/internal-effect-machine.ts:125`).

## What Already Works

Branch expression validation, strict string/number matching, source-order
first-match selection, default selection, and lexical write-through behavior
already have one semantic owner in `branch.ts`. Capability preparation,
sync/async dispatch, trace accumulation, and failure normalization already have
one machine implementation. This slice composes those owners; it does not
reimplement either contract.

## Contract (Verified)

> Verified against the cited sources on 2026-07-13.

| Behavior | Contract | Evidence | Tag |
|---|---|---|---|
| Validation | non-empty `on`, valid paths, at most one default | `branch.ts:123` | VERIFIED |
| Selection | strict same-type first match, otherwise default | `branch.ts:150` | VERIFIED |
| Scope | selected path executes in `childEnv(env)` | `branch.ts:163` | VERIFIED |
| Child binding | `let` binds locally | `index.ts:171` | VERIFIED |
| Outer mutation | reads and assignment walk through to parent | `index.ts:171` | VERIFIED |
| Machine effects | sync/async drivers resume one shared generator | `internal-effect-machine.ts:187` | VERIFIED |
| Public containment | runtime envelope remains unexported | `scripts/check-runtime-envelope.mjs:70` | VERIFIED |

## Implementation Plan

1. Change the closed disposition to `branch: 'unified'` and admit root branch
   frames regardless of their body-bearing shape so malformed frames fail in
   the claimed machine instead of falling back.
2. Add a dedicated branch generator that runs `branchPreconditions`, calls
   `selectBranchPath` once, and recursively runs only the selected children in
   `childEnv(env)`.
3. Before external effects dispatch, require the complete claimed machine tree
   to be structurally closed over unified node types and portable branch/if
   shapes. This bytecode-style verification does not evaluate conditions or
   path values and never guesses capability results; runtime selection and pure
   dataflow still occur exactly once in the real generator.
4. Bind the ownership claim into containment, fitness policy, support matrix,
   and release-train evidence.

Alternatives are not equivalent incremental options: loops add repetition and
control transfer; `try` adds unwind/finally ordering; callable linking violates
the current bounded-root eligibility contract. They remain later slices.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `packages/core/src/ir/semantics/internal-effect-machine.ts` | modify | claim and execute branch frames |
| `packages/core/tests/runtime-envelope-effect-machine.test.ts` | modify | discriminating branch fixtures |
| `scripts/check-runtime-envelope.mjs` | modify | containment and deferral witnesses |
| `scripts/kern-5-fitness-policy.json` | modify | ownership oracle |
| `docs/kern-5-support-matrix.md` | modify | current support evidence |
| `docs/kern-5-release-train.md` | modify | milestone receipt |

## Acceptance Criteria

- [x] The disposition and root engine selector claim `branch`; loops and `try`
  remain legacy.
- [x] First matching path wins, default runs only when no value path matches,
  and no path falls through.
- [x] A selected path-local `let` does not leak into the parent environment.
- [x] A selected path assignment to an outer binding writes through.
- [x] Root, `if` to branch, branch to `if`, and branch to branch nesting all run
  through the private machine.
- [x] A selected capability produces byte-identical raw sync/async traces.
- [x] Unselected paths produce no capability calls or trace events; their static
  structure must still belong to the closed machine corpus.
- [x] A selected unsupported node fails closed with no nested legacy fallback
  or provider dispatch; malformed branch shapes fail closed.
- [x] The public async reference runner and package exports are unchanged.
- [x] `pnpm fitness:kern-5` and a terminal full-roster `agon review` pass.

## Completion Evidence

- `pnpm test:kern-runtime-envelope`: 64 tests and containment passed.
- `pnpm fitness:kern-5`: full aggregate wall passed on 2026-07-13;
  browser budget remained 75 modules and 290,786 gzip bytes on exact commit
  `64a5b6d7`.
- Initial full-roster review:
  `/Users/nicolascukas/.agon/runs/review-1783907739191-hjqq5y-kern5-m3-8-effect-machine-branch`
  completed 3/3 with zero verified findings. Its sole needs-check claim that
  `.Codex/specs` must not be committed was disproven by the tracked spec history.
- Exact-commit terminal review:
  `/Users/nicolascukas/.agon/runs/review-1783914511885-qzvau1-kern5-m3-8-exact-commit-final`
  completed 3/3 with zero verified code findings. Its one verified metadata
  finding—the still-open release-train checkbox—is closed by this receipt.

## Out of Scope

Loops, `break`/`continue`, `try`/`catch`/`finally`, callable linking, value
symmetry expansion, public ABI promotion, async-reference-runner removal, and
transactional rollback of already-dispatched external effects.

## Open Questions

None. All acceptance criteria rest on verified current contracts.

## Deploy Order

Ship implementation, tests, and internal-oracle metadata in one commit. The
runtime envelope remains private and default-off, so there is no public version
skew window. Rollback is the commit revert; specifically changing the closed
disposition back to `legacy` restores legacy selection.

## Corrections Log

| Original Claim | Reality | Impact |
|---|---|---|
| The first implementation used encounter-order validation because a later selector can depend on a capability result. | Terminal review reproduced a capability dispatch before a later static unsupported node. | Selected branch and if subtrees are structurally preflighted before provider dispatch. |
| The first preflight simulated pure operations with a fake capability result. | Review reproduced valid capability-to-format dataflow rejected by the sentinel. | Preflight is now value-independent; dynamic values are consumed only by the real resumable execution. |
| Selection-sensitive structural preflight differed between root and nested branches. | A prior capability can make later selection unknowable without dispatch, so selective verification cannot guarantee pre-effect failure. | The complete claimed tree is structurally verified before any provider call; only selected arms are semantically evaluated or executed. |
| A review suggested `.Codex/specs` files are forbidden from version control. | `git ls-files '.Codex/specs/**'` shows the existing release-train specs, including the immediately preceding effect-machine milestones. | The spec remains part of the milestone commit. |
