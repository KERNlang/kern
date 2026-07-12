# KERN 5 R2/M3.1 Internal Transactional Runtime Envelope

## Status

Implementation contract for the first M3 slice. The envelope is internal,
default-off, and does not freeze the runtime, handler, trace, or capability
ABI. **DECIDED**

## Baseline and Decision

- Alpha KIR/evidence/receipt is remotely verified at `7099c95d`. **VERIFIED**
- Sixteen runner constructs plus trace, handler, and capability ABIs remain
  explicitly deferred to M3. **VERIFIED**
- Public `executeKernSource*` wrappers return stdout strings; sync and async
  execution still use separate evaluators. **VERIFIED**
- Agon tribunal `tribunal-1783864102213-mjaw2b-kern5-m3-first-slice`
  completed 3/3 and selected transactional envelope normalization before typed
  arguments or scheduler unification. **VERIFIED**

## Envelope Contract

Format is `kern.runtime.internal.r0`. The exact envelope contains `format`,
`outcome`, `completion`, `result`, `events`, and `diagnostics`. All fields are
always present and canonical JSON encoding ends in one LF. **DECIDED**

- Success completion is `normal | return`; `result` is an explicit slot so
  absent/void and explicit null cannot collapse.
- Failure completion is `error`, result is absent, and events are empty.
- Diagnostics contain stable `category`, `code`, and `phase` only. Host error
  messages are not identity and do not enter envelope bytes.
- Observable events are only `stdout`, `stderr`, and `capability`. Assignment,
  call, iteration, enter, and exit events remain internal trace mechanics.
  **GUARD**

## Portable Value Contract

Values are closed tagged forms: null, boolean, text, safe integer text,
canonical decimal text, list, and code-point-sorted record entries. Undefined
is represented only by an absent slot. Functions, symbols, bigint, negative
zero, NaN/infinity, unsafe integers, exponent-form numbers, RegExp, Date, Map,
Set, class instances, sparse arrays, forbidden record keys, cycles, malformed
Unicode, and configured resource overflow reject. **GUARD**

Limits are required caller configuration: maximum depth, collection length,
string UTF-8 bytes, events, diagnostics, and encoded bytes. **DECIDED**

## Execution and Containment

Sync and async internal entrypoints require `enabled: true`; omission or false
rejects before execution. Both run the current semantic lanes and then pass
through the same normalizer. Existing source executors and public exports are
unchanged. The module is unreachable from runtime/browser/public barrels and
package exports. **GUARD**

Transactional means the new envelope exposes no partial result, diagnostic,
or event after execution failure. It does not claim rollback of a host
capability effect that already occurred inside the current evaluators; that
requires the unified effect scheduler slice. **DECIDED**

## Acceptance

- [x] Success, explicit null, void, stdout, and capability events normalize.
- [x] Sync and immediately-resolved async execution encode byte-identically.
- [x] Failure after stdout or attempted return yields empty events and absent
      result with stable diagnostic identity.
- [x] Hostile values and every configured resource overflow reject or become a
      transactional `non-portable-value` failure without partial output.
- [x] Default-off and internal containment kill public/runtime adoption.
- [x] Existing R1 gates and full KERN 5 fitness wall remain green.
- [x] Final Agon review with exactly `claude,codex,agy` has zero verified
      findings.

## Deferred

Typed handler arguments/results at the source entry boundary, unified effect
scheduler, cancellation, actual effect rollback, stable public ABI, all 16
runner-contract promotions, KIR v1 freeze, and runtime cutover. **DEFERRED**

## Kill Switches

- Any existing public executor changes behavior or return type.
- Any failed envelope contains result or events.
- Any host message becomes diagnostic identity.
- Any unknown/non-portable value falls back or stringifies.
- Any internal envelope becomes publicly exported or default-on.
