# KERN 5 R2/M3.3 Internal Source Handler Link

## Status

Implementation contract for the third M3 slice. Source identity and linking
remain internal and default-off; no public runner, handler, or capability ABI is
promoted. **DECIDED**

## Baseline and Decision

- M3.2 is remotely verified at `9911ae31`. **VERIFIED**
- M3.2 executes a supplied typed handler entry but does not establish which
  source declaration owns that entry. **VERIFIED**
- Agon tribunal `tribunal-1783882531919-g0x67v-kern5-m3-3-next-slice`
  selected bounded source handler identity/linking before an effect scheduler or
  runner-contract promotion. **VERIFIED**
- Current capability dispatch has no internal pre-call interception seam; a
  scheduler now would modify the production runner path and overclaim this
  contained slice. **VERIFIED**

## Identity and Link Contract

An identity is exactly one canonical `sourcePath` and one portable
`handlerName`. The supplied source is one bounded KERN document. Resolution
selects exactly one top-level `fn` whose `name` equals `handlerName`, exactly one
direct child `handler lang="kern"`, and the current runner-portable exact-name
parameter subset. **DECIDED**

The resolver accepts either legacy `params=` syntax or direct `param` children,
never both. Default, optional, variadic, destructured, duplicate, non-portable,
or otherwise unsupported parameter forms reject. Async and stream functions,
foreign/empty/multiple KERN handlers, parse errors, and schema-invalid source
reject before handler execution. **GUARD**

Source and identity strings are bounded by the existing runtime envelope limits.
Default-off validation happens before source parsing. The resolved body and
ordered parameter names feed only the existing M3.2 sync/async typed entry.
**GUARD**

## Failure and Containment

Link failures use closed internal diagnostics with phase `link`:
`handler-entry-not-found`, `handler-entry-ambiguous`,
`handler-entry-unsupported`, and `handler-link-error`. Every link failure has an
error completion, no events, no result, and invokes no handler or capability.
**DECIDED**

The public source executors, package exports, runner capability dispatch, module
loader, and KIR reader remain unchanged. **GUARD**

## Acceptance

- [x] Default-off and bounded source/identity validation happen before parsing.
- [x] One valid source handler links ordered parameters and executes through
      both M3.2 lanes with byte-identical immediately-resolved behavior.
- [x] Missing, duplicate, foreign, multiple-handler, async/stream, malformed,
      schema-invalid, and unsupported-parameter sources fail with stable link
      diagnostics.
- [x] Link failure cannot invoke a capability or expose events/result.
- [x] Public containment and the planned `runtime-handler-abi` gate remain.
- [ ] Full KERN 5 fitness wall remains green.
- [ ] Final Agon review with `claude,codex,agy` has zero verified findings.

## Deferred

Module loading, import/export and re-export resolution, helper/class registry
linking, overloads, Decimal and nested-record arguments, effect scheduling,
cancellation, host-effect rollback, stable public ABI, KIR v1 freeze, and all 16
runner-contract promotions. **DEFERRED**

## Kill Switches

- Any disabled request parses source.
- Any ambiguous or invalid source executes a handler or capability.
- Any link failure contains events or a result.
- Any module, import, export, helper, or class is linked implicitly.
- Any public executor, barrel, package export, or capability dispatcher adopts
  the internal source link.
