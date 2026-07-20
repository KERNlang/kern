# KERN 5 R2/M3.2 Internal Typed Handler Entry

## Status

Implementation contract for the second M3 slice. The entry is internal,
default-off, and does not promote the public runtime/handler ABI. **DECIDED**

## Baseline and Decision

- M3.1 is remotely verified at `30c733aa`. **VERIFIED**
- M3.1 supplies a closed transactional envelope but accepts prebuilt IR and an
  already-populated semantic environment. **VERIFIED**
- Agon tribunal `tribunal-1783872910960-gb74q8-kern5-m3-2-next-slice`
  selected typed internal handler entry before scheduler or runner-contract
  promotion. **VERIFIED**
- The current ReferenceRunner executable argument domain is narrower than the
  envelope value domain: Decimal values and recursively nested records are not
  general runner-portable values. **VERIFIED**

## Entry Contract

An entry contains an ordered, duplicate-free parameter-name list and IR handler
body. A request supplies an exact-arity ordered argument list. Names must be
portable KERN bindings. Argument count is bounded by `maxCollectionLength`.
**DECIDED**

Arguments normalize completely before environment construction or runner
registration. The admitted M3.2 domain is null, boolean, text, safe integer,
nested lists of admitted non-record values, and flat records whose fields are
admitted scalars or lists. Decimal values and nested records reject before
execution until the ReferenceRunner owns those handler semantics. **GUARD**

The entry constructs a fresh root binding map containing only normalized
arguments. Host capabilities and deterministic seed/time may be inherited from
the supplied host environment. Host bindings, function registries, class
registries, and call-frame state never cross the entry boundary. **GUARD**

## Failure and Containment

Invalid names, arity, hostile arrays/values (including Proxy containers),
unsupported admitted-shape combinations, and resource overflow yield a transactional
`invalid-handler-arguments` failure envelope. No handler node, capability,
event, or result executes first. M3.1 execution failures retain their existing
stable identities. **DECIDED**

Proxy reflection traps are host-language admission effects and may run while
the boundary proves that a raw JavaScript container is invalid. They are not
KERN handler or capability effects and are outside this transactional guarantee.
Callers that require side-effect-free hostile-byte admission must decode and
materialize trusted plain data before invoking this internal entry. **GUARD**

Sync and async entrypoints feed the same validated arguments into the existing
M3.1 execution lanes and must encode byte-identically for immediately-resolved
behavior. Existing public source executors and package exports remain
unchanged. **GUARD**

## Acceptance

- [x] Default-off, exact arity, portable names, duplicates, and fresh bindings
      are enforced.
- [x] Null, boolean, text, safe integer, list, flat record, and void/result
      paths round-trip through sync and async entries.
- [x] Decimal, nested record, accessor, symbol, cycle/shared-reference, unsafe
      numeric, and overflow arguments reject before execution.
- [x] Invalid arguments cannot invoke a capability or expose events/result.
- [x] Public containment and the planned `runtime-handler-abi` gate remain.
- [x] Full KERN 5 fitness wall remains green.
- [x] Final Agon review with `claude,codex,agy` has zero verified findings.

## Deferred

Source-level handler identity and linking, Decimal and nested-record handler
arguments, effect scheduling, cancellation, true host-effect rollback, stable
public ABI, KIR v1 freeze, and all 16 runner-contract promotions. **DEFERRED**

## Kill Switches

- Any invalid argument reaches runner registration or capability execution.
- Any host binding becomes visible to the handler.
- Any failed request contains events or a result.
- Any unsupported value is coerced, stringified, or silently dropped.
- Any public executor, barrel, or package export adopts the internal entry.
