# KERN 5 F4 M3 A9 Scale Closure

**Status:** READY TO BUILD — ACCEPTANCE EVIDENCE PENDING

**Baseline:** `da16bbacd93c378a655ca5dde5716ba2c6fc9fc3`

**Scope:** F4-A9 only. F4-A10 and whole-F4 promotion remain open.

## Objective

Close F4-A9 with policy-authenticated, executable 1x/2x/4x/8x scale
families for declarations, properties, attachments, decorators, and module
sets. The evidence must distinguish deterministic protocol growth from
host-sensitive resource observations, execute every document through one real
F4A root invocation, and execute each module set through one real F4B root
invocation.

This slice does not change F0-F3, the F4 document or module-set formats, the
109-argument F4A ABI, the 18-argument F4B ABI, semantic projection, receipt
ordering, or public APIs.

## Current Evidence

- F1, F2B, and F3 already authenticate scaling walls in their own policies and
  exercise adjacent 1x/2x/4x/8x families.
- F4 policy `.4` currently authenticates semantic, runtime, and scheduler
  ceilings but has no F4-specific scaling-wall section.
- `runDocument` returns the exact F4A invocation count and the sealed document
  `workSteps` total.
- `runModuleSet` returns every document, the aggregate F4A invocation count,
  and the F4B invocation count. F4B enforces its own work cap but does not
  expose an internal work total in the `.4` receipt.
- A baseline probe at counts 1/2/4/8 produced classified declaration,
  attachment, and decorator documents; rejected-but-well-formed property
  documents; and linked module sets. The largest observed document envelope
  was 5,357 bytes, the largest document work total was 16,852, and the
  eight-module set used eight F4A invocations plus one F4B invocation.

The probe numbers guide generous walls; they are not acceptance evidence.

## Decided Contract

### Families

- **[A9-C1 DECIDED]** `densityCounts` is exactly `[1, 2, 4, 8]`. It is
  strictly doubling, contains safe positive integers, and is authenticated by
  `policy.json`.
- **[A9-C2 DECIDED]** Declaration density is `N` top-level exported `fn`
  declarations with unique names.
- **[A9-C3 DECIDED]** Property density is `N` top-level `state` declarations,
  each with unique `name` and quoted `value`. The frozen current authority
  rejects this form while retaining one declaration and one property
  occurrence per row; that status is part of the scale fixture, not a reason to
  substitute a different form.
- **[A9-C4 DECIDED]** Attachment density is one `module`, one child `list`, and
  `N` valid `item` children. The exact attachment count is `N + 1`.
- **[A9-C5 DECIDED]** Decorator density is `N` plain `@trace` plus `fn` pairs.
  The exact decorator count is `N`, and every row is attached.
- **[A9-C6 DECIDED]** Module density is `N` canonical modules, each containing
  one uniquely named exported `fn`. The set is linked and contains exactly
  `N` modules.

### Measurement boundary

- **[A9-C7 DECIDED]** Every `(family, density)` measurement runs in a fresh
  Node process after module import. The measured operation begins immediately
  before `runDocument` or `runModuleSet`; import/startup time is excluded. No
  warmup invocation, mutable counter reset, or cross-measurement receipt cache
  is permitted.
- **[A9-C8 DECIDED]** The time metric is process CPU milliseconds, computed as
  the delta of user plus system CPU from `process.cpuUsage`. Wall-clock time is
  recorded for diagnosis but is not an adjacent acceptance oracle because the
  full repository test command executes test files concurrently. Every KERN
  invocation remains independently bounded by the authenticated scheduler
  timeout. The measured API is synchronous and the source guard rejects a
  worker-thread or asynchronous substitute; `process.cpuUsage` is the
  process-wide CPU total, not a per-thread attribution.
- **[A9-C9 DECIDED]** Peak RSS is the isolated child process
  `process.resourceUsage().maxRSS * 1024`. It includes the imported runtime and
  composition baseline by design. RSS assertions are upper adjacent and
  absolute walls only: no monotonic lower bound, baseline subtraction, heap
  delta, or claim of exact workload-local allocation is made.
- **[A9-C10 DECIDED]** Envelope bytes are the UTF-8 byte length of the JSON
  serialization of the returned field array. Document work is the sealed F4A
  `receipt.workSteps`. Module-family work is the sum of the sealed work totals
  from the `N` returned F4A documents; F4B additionally must complete under its
  authenticated work cap and return a linked receipt. F4B `.4` does not expose
  its internal work total, so this slice neither invents nor derives one from
  CPU time. Serializing such a total would require a separately authorized
  module-set format change and is outside F4-A9.

### Authenticated walls

- **[A9-C11 DECIDED]** F4 policy `.4` gains one exact-key `scalingWalls`
  object. This changes the authenticated policy bytes and cache identity but
  does not change policy format `.4`, document `.2`, module-set `.4`, either
  private ABI, or any production KERN source.
- **[A9-C12 DECIDED]** The initial policy values are:

  | Key | Value |
  |---|---:|
  | `densityCounts` | `[1, 2, 4, 8]` |
  | `maxAdjacentCpuTimeRatio` | `4` |
  | `cpuTimeSlackMs` | `5_000` |
  | `maxCpuTimeMs` | `30_000` |
  | `maxAdjacentRssRatio` | `2` |
  | `rssSlackBytes` | `268_435_456` |
  | `maxPeakRssBytes` | `1_073_741_824` |
  | `maxAdjacentEnvelopeRatio` | `3` |
  | `maxEnvelopeBytes` | `1_048_576` |
  | `maxAdjacentWorkRatio` | `4` |
  | `maxDocumentWorkSteps` | `1_000_000` |
  | `maxModuleDocumentWorkSteps` | `1_000_000` |

- **[A9-C13 DECIDED]** For each adjacent pair, current CPU time, RSS, envelope
  bytes, and work must be no greater than `previous * ratio + metric slack`.
  CPU and RSS use their explicit slacks; envelope and work use zero slack.
- **[A9-C14 DECIDED]** Every measurement also satisfies its absolute CPU, RSS,
  envelope, and work wall. The policy validator requires safe positive integer
  wall values, exact keys in any property order, exact doubling counts, and
  walls no greater than the already authenticated runtime/profile ceilings
  where a corresponding ceiling exists.
- **[A9-C15 DECIDED]** Changeable wall values exist only in policy, never in the
  measurement worker or assertion test. Stable family names, fixture grammar,
  result identities, and the literal 1x/2x/4x/8x relationship are protocol test
  constants.

### Invocation and atomicity

- **[A9-C16 DECIDED]** Each document measurement has
  `runtimeInvocations === 1`. A module-set measurement has
  `documentRuntimeInvocations === N` and `moduleSetRuntimeInvocations === 1`.
- **[A9-C17 DECIDED]** The measurement child emits one strict JSON object and no
  semantic result can be supplied by a fixture, mock, cached receipt, or
  host-side classifier.
- **[A9-C18 DECIDED]** A child crash, timeout, malformed report, non-finite
  metric, wrong result status/count, or invocation mismatch fails closed.

## Acceptance Matrix

1. **[A9-A1]** Policy validation accepts the exact scaling object and the same
   keys in reverse order.
2. **[A9-A2]** Removing or adding any scaling key rejects before execution.
3. **[A9-A3]** Non-doubling, non-positive, non-integer, unsafe, or wrong-length
   density counts reject.
4. **[A9-A4]** Non-positive/unsafe walls and walls exceeding corresponding
   profile/runtime limits reject.
5. **[A9-A5]** Declaration 1x/2x/4x/8x runs have exact classified status,
   declaration count, one F4A invocation, and pass all adjacent/absolute walls.
6. **[A9-A6]** Property runs have exact rejected status, declaration/property
   counts, one F4A invocation, and pass all walls.
7. **[A9-A7]** Attachment runs have exact classified status, declaration and
   attachment counts, one F4A invocation, and pass all walls.
8. **[A9-A8]** Decorator runs have exact classified status, decorator count,
   attached dispositions, one F4A invocation, and pass all walls.
9. **[A9-A9]** Module runs have exact linked status/module count, `N` F4A
   invocations, one F4B invocation, and pass all walls.
10. **[A9-A10]** The same deterministic wall evaluator consumes both actual
    child reports and in-memory controls. It accepts a compliant 1x/2x/4x/8x
    report and rejects independently mutated adjacent CPU, RSS, envelope, and
    work values plus each absolute crossing. A source canary fails if actual
    reports bypass that evaluator.
11. **[A9-A11]** Source guards prove the worker measures a real public
    `runDocument`/`runModuleSet`, uses `process.cpuUsage`,
    `process.resourceUsage().maxRSS`, returned field bytes, returned sealed
    work, and exact invocation counters.
12. **[A9-A12]** Public API arities, policy `.4`, document `.2`, module-set
    `.4`, ABI 109/18, policy composition inventory, and generated authority are
    unchanged except for the authenticated `scalingWalls` policy bytes.
13. **[A9-A13]** Policy tests prove `scalingWalls` is neither ignored nor parsed
    as source syntax: removing the exact key, adding an unknown key, or changing
    a wall fails `validatePolicy` before any measured execution.

## Implementation Boundary

Expected paths:

- `scripts/kern-frontend-f4-declarations/policy.json`
- `scripts/kern-frontend-f4-declarations/policy-validation.mjs`
- `scripts/kern-frontend-f4-declarations/a9-scale-worker.mjs` (new)
- `scripts/kern-frontend-f4-declarations/a9-scale-closure.test.mjs` (new)
- this satellite spec, parent F4 status, and KERN-5 goal truth after gates

Production KERN, decoders, workers, prerequisite policies, generated authority,
fitness policy, and terminal-gate ledgers are out of scope unless a separately
traced defect is exposed.

## Kill Conditions

Stop and redesign if the slice needs semantic production changes, a format or
ABI bump, a host semantic projection, more than one F4A invocation per measured
document, more than one F4B invocation per measured set, hardcoded operational
walls outside policy, shared-process RSS comparisons, receipt reuse across
measurements, or a policy wall that exceeds its authenticated parent ceiling.

## Gate

1. RED policy/oracle tests, then focused A9.
2. Node syntax checks and `git diff --check`.
3. Lint and repository consistency.
4. Exact authority/prerequisite/composition path-order-SHA validation and
   deterministic authority regeneration.
5. Focused policy-validation/resource-limit regression, runtime ABI tests, and
   KERN-5 fitness policy checks for second-order schema fallout.
6. Complete F4 declarations wall once.
7. Independent automatic-risk Agon review with the actual implementer identity;
   fix verified blockers and rerun targeted regressions.
8. Update parent F4 spec and goal truth without promoting F4 or terminal gates.
