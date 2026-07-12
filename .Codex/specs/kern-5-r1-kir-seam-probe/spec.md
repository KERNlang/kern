# KERN 5 R1.3 Typed Semantic KIR Seam Probe

**Status:** IMPLEMENTED — LOCAL CLOSURE GREEN; CI WITNESS PENDING
**Date:** 2026-07-11
**Confidence:** 0.91
**Depends on:** R1.2 commit `a81ae0619b07cd9dfc1c0356bd253a0691203ef0`
**Tribunal:** `tribunal-1783799351478-jgrg71`

**Closure evidence:** `pnpm test:kern-ir-probe` passed 20/20 checks and the
complete `pnpm fitness:kern-5` current wall passed on 2026-07-11. Full usable-
roster Agon review was run repeatedly while closing findings; the final focused
Codex closure returned no verified blocker. Linux CI remains the post-push
second-environment witness, so this does not freeze or publish `kir.v1`.

## Executive Summary

R1.3 will not freeze KIR v1. It will build an experimental, strict,
target-neutral semantic-KIR projection and use a hostile corpus to decide
whether that middle seam is concrete enough for R1.4 to freeze. The current
parsed `IRNode` tree remains the source/frontend representation; private runner
link records and traces remain lowering/runtime artifacts.

The probe selects typed semantic KIR only if it can preserve KERN-owned value,
module, diagnostic, location, capability, and ordering meaning in deterministic
bytes without raw TypeScript or host object identity. Failure blocks R1.4 and
forces redesign; it does not relabel the source AST as canonical KIR.

## Current State / Root Cause

KERN has three real or potential seams, but none is presently a versioned
canonical compiler/runtime artifact:

1. The live source tree is `IRNode`, whose open string node type and
   `Record<string, unknown>` props are frontend-oriented rather than a strict
   semantic contract (`packages/core/src/types.ts:27-40`). **VERIFIED**
2. Expression structure exists as `ValueIR`, but it explicitly mirrors TS/JS,
   stores JS `number`, source quote choice, raw TypeScript closure blocks,
   `instanceof`, `typeof`, `void`, `new`, and type assertions
   (`packages/core/src/value-ir.ts:1-77`). **VERIFIED**
3. The executable linker produces private `LinkedModuleRecord` values backed by
   `Map`, shared binding objects, and module-scope references
   (`packages/core/src/runner.ts:167-186,463-565`). **VERIFIED**
4. `ReferenceRunner` still dispatches raw `IRNode` and contracts reparse
   expression-bearing props; the runner does not consume a typed semantic
   artifact (`packages/core/src/ir/semantics/reference-runner.ts:13-64`).
   **VERIFIED**
5. The only public `serializeIR` says it is for debugging/token estimates,
   skips fields, coerces values with `String`, and follows insertion order
   (`packages/core/src/utils.ts:18-54`). **VERIFIED**
6. `validateSchema` is not a pure type boundary: it mutates the source tree by
   inferring union discriminants before validation
   (`packages/core/src/schema.ts:3622-3654`). **VERIFIED**

The root problem is not missing JSON output. It is the lack of one strict,
portable semantic projection between source parsing and target/runtime
lowering.

## What Already Works

- `parseDocumentWithDiagnostics` returns a document root plus structured parse
  diagnostics (`packages/core/src/types.ts:190-209`; `parser.ts:91-119`).
  **VERIFIED**
- Source locations already carry start and optional end line/column
  (`packages/core/src/types.ts:43-48`). **VERIFIED**
- Schema and semantic validators return structured violations, even though
  they do not produce typed KIR (`schema.ts:3622-3640`;
  `semantic-validator.ts:455-468`). **VERIFIED**
- Trace already separates ordered events from completion and distinguishes
  `-0`, `NaN`, `RegExp`, `Map`, and `Set` during structural comparison
  (`ir/semantics/trace.ts:1-90`). **VERIFIED**
- The source parser, validators, runner, compiler commands, target transpilers,
  review tools, MCP server, native tests, and codemods are live `IRNode`
  clients. `rg -l 'parseDocument|serializeIR|IRNode' packages/*/src`, run
  2026-07-11, found core, CLI, check, codemod, evolve, express, go, MCP,
  native, Python, React, review, terminal, test, and Vue clients. **VERIFIED**

R1.3 does not replace these paths. The probe is additive and release-blocking;
R1.4 will define reader migration before any writer becomes canonical.

## Contract Discovery and Client Census

> Verified against the cited source and commands on 2026-07-11.

| Boundary / client | Current input | Live behavior | R1.3 effect | Tag |
|---|---|---|---|---|
| Parser/frontend | source -> `ParseResult` | Produces loose `IRNode` plus diagnostics | Experimental adapter only | VERIFIED |
| Schema/semantic validators | `IRNode` | Return violations; schema may normalize in place | Probe reads results, never treats validation as KIR | VERIFIED |
| CLI check/compile/run | `IRNode` | Separate validation, target generation, and runner linking paths | No default change | VERIFIED |
| Target transpilers | `IRNode`; `serializeIR` for metrics/debug | Express, Go, MCP, native, Python, React, terminal, Vue emit independently | No target migration | VERIFIED |
| Review/check/codemod/evolve | `IRNode` and reparsed `ValueIR` | Analyze source representation directly | No migration | VERIFIED |
| Runner linker | private maps and bindings | Resolves executable module identity and runtime scopes | Used only as C evidence | VERIFIED |
| ReferenceRunner | `IRNode` plus `SemanticEnv` | Executes registered contracts and emits `Trace` | No execution cutover | VERIFIED |
| Future formatter/frontend/compiler/interpreter | no shared artifact | Planned consumers of versioned KIR | B must serve semantic consumers; lossless trivia remains separate | VERIFIED gap |

No dead canonical-KIR reader or writer exists. Searches for `test:kern-ir`, a
KIR schema version, and a public KIR deserializer returned no implementation on
2026-07-11; the command exists only as a planned policy row. **VERIFIED**

## Probe Contract

The experimental envelope is explicitly not `kir.v1`. Its identifier must
contain `probe` so no consumer can mistake it for the frozen R1.4 contract.

| Field / behavior | Probe requirement | Evidence basis | Tag |
|---|---|---|---|
| Envelope | Exact format id, modules array, diagnostics array; unknown/missing format rejects | R1 release unknown-version exit | VERIFIED design decision |
| Module granularity | Each module has a canonical POSIX id and independent node tree; bundle modules sort by id | incremental and cross-OS tribunal risk | VERIFIED design decision |
| Nodes | Closed probe node-kind set; ordered children; properties are sorted entry arrays, never untrusted dictionaries | hostile-key and schema risks | VERIFIED design decision |
| Values | Tagged null/bool/text/safe-int/negative-zero/decimal/regex/list/record/expression forms | M2 oracle hostile corpus | VERIFIED design decision |
| Integers | Canonical safe base-10 text; unsafe integers reject rather than round through JS `number` | checker v2 integer contract and M2 oracle | VERIFIED design decision |
| Decimal | Exact source coefficient/scale text; no JS numeric conversion | three-leg Decimal contract | VERIFIED design decision |
| Strings | Preserve exact Unicode scalar sequence; do not locale-sort or NFC-normalize | KERN text semantics and combining-sequence oracle | VERIFIED design decision |
| Records/maps | Hostile keys round-trip as explicit entries; semantic record keys sort by Unicode code point, ordered collections retain order | determinism and hostile-key oracle | VERIFIED design decision |
| Regex | Pattern plus canonical flag order; unsupported portable forms reject | portable-regex contract | VERIFIED design decision |
| Expressions | Normalize a portable subset into KERN-owned tags; discard quote and redundant parenthesis trivia; raw block closures reject | tribunal JS-leak kill switch | VERIFIED design decision |
| Locations | Full start/end line/column when available; absent ends remain explicitly absent | diagnostics/source-map consumers | VERIFIED design decision |
| Diagnostics | Stable code, severity, category, location; deterministic order; messages remain evidence but not identity | existing `ParseDiagnostic` shape | VERIFIED design decision |
| Modules | Explicit imports, aliases, exports, canonical target ids; missing exports and cycles reject deterministically | runner linker behavior | VERIFIED design decision |
| Capabilities/effects | Capability operation remains an ordered semantic node; runtime request/result and `Trace` are separate R1.4 ABI contracts | tribunal coupling resolution | VERIFIED design decision |
| Canonical bytes | UTF-8 canonical JSON with recursive code-point key ordering, arrays preserving declared semantic order, one terminal newline | M2 byte oracle | VERIFIED design decision |

### Formatter and trivia resolution

Semantic KIR is the one compiler/runtime boundary. It retains complete spans
but excludes comments, exact quote choice, redundant parentheses, and other
trivia. The M4 no-comment product is therefore a canonicalizer over semantic
KIR. A later source-preserving formatter may add a lossless syntax/trivia layer
that projects to the same KIR; that layer is not co-canonical semantic KIR.
This resolves the tribunal's split-brain concern without forcing compiler bytes
to preserve non-semantic source choices. **VERIFIED design decision**

## Implementation Options

### A — normalized source AST

Pros: already produced and consumed everywhere. Cons: open props and node
kinds, mutable validation, raw expressions, syntax trivia, and no strict
canonical reader. A new serializer could improve bytes but would not turn the
frontend tree into a typed semantic contract.

**Verdict:** reject as canonical KIR; retain as frontend/source representation.
Confidence: 0.98.

### B — typed semantic KIR projection

Pros: creates the correct target-neutral boundary for checker, canonicalizer,
compiler, and interpreter; supports strict versioning and deterministic bytes.
Cons: no integrated artifact exists today, so the probe must prove it rather
than freeze current `ValueIR`.

**Verdict:** recommended only if every probe criterion passes. Confidence:
0.91 after tribunal.

### C — lowered executable KIR

Pros: close to current runtime needs. Cons: private maps, shared host object
identity, runtime scopes, incomplete target coverage, and expression-text
reparsing make it a TypeScript runner lowering rather than common KIR.

**Verdict:** reject as canonical KIR; retain as a future lowering contract.
Confidence: 0.98.

## Implementation Plan

1. Add an experimental semantic-KIR probe model and strict canonical encoder
   under `scripts/kir-seam-probe/`; import built parser APIs but change no core
   production exports.
2. Build a bounded source-to-probe adapter for the hostile corpus. Fail closed
   on unsupported node/value/closure shapes; never delegate semantic meaning to
   `serializeIR` or runner-private bindings.
3. Add A/B/C discriminators, hostile fixtures, subprocess determinism tests,
   unknown-version/extra-field reader tests, and subtly wrong serializer
   mutations.
4. Promote only `test:kern-ir-probe` into the current fitness policy. Keep
   `test:kern-ir` and `versioned-kir-v1` planned/not-shipped until R1.4.
5. Record the selected seam, exclusions, tribunal disposition, and gate output
   in the release train/support matrix. No core reader/writer or default changes.

## Blast Radius

| File | Action | Reason |
|---|---|---|
| `scripts/kir-seam-probe/model.mjs` | add | Closed experimental envelope/value/node validation |
| `scripts/kir-seam-probe/canonical.mjs` | add | Strict deterministic bytes and reader |
| `scripts/kir-seam-probe/project.mjs` | add | Source/modules/diagnostics to semantic probe projection |
| `scripts/kir-seam-probe/fixtures.mjs` | add | Hostile corpus and syntactic variants |
| `scripts/kir-seam-probe/*.test.mjs` | add | Discriminators, mutation kills, deterministic subprocesses |
| `scripts/check-kir-seam-probe.mjs` | add | One command and concise evidence summary |
| `package.json` | modify | Add `test:kern-ir-probe`, not `test:kern-ir` |
| fitness policy/test and support matrix | modify | Make probe current while KIR v1 remains planned |
| release train | modify | Close R1.3 only after binary gate passes |

No handwritten source file may exceed 500 lines. Generated corpus output, if
needed, is separated and drift-checked.

## Acceptance Criteria

- [ ] RED at base: `pnpm test:kern-ir-probe` is absent before the slice and the
      current debug serializer fails insertion-order, hostile-value, and
      semantic-collision discriminators for the intended reasons.
- [ ] Candidate A is rejected by executable evidence: debug serialization is
      lossy/order-dependent and source `IRNode` carries open/raw syntax meaning.
- [ ] Candidate C is rejected by executable/source evidence: its private
      linker form requires maps/shared bindings and is not a strict portable
      artifact.
- [ ] Candidate B produces one concrete closed probe envelope and strict reader;
      it does not reuse `ValueIR` or `IRNode` as the wire schema.
- [ ] Whitespace, quote, redundant-parenthesis, property insertion order,
      module input order, locale, and timezone variants produce identical bytes
      when semantic meaning is identical.
- [ ] Empty/dotted/bracket/Unicode/`__proto__`/`constructor` keys round-trip
      without pollution or collision.
- [ ] Safe integer boundaries, exact Decimal scale, `0` versus `-0`, BMP/non-BMP
      and combining text, regex pattern/flags, lists, records, and maps retain
      their specified identity; unsafe integer, NaN, and Infinity reject.
- [ ] Expression closures are structured; raw block closures and TS-only raw
      semantic payloads reject.
- [ ] Multi-file import, alias, re-export, missing-export, and cycle cases have
      stable bytes or stable fail-closed diagnostics.
- [ ] Capability nodes retain source order. Runtime results and traces are not
      smuggled into semantic KIR.
- [ ] Missing/unknown format, unknown node/value tags, extra fields, malformed
      spans, duplicate module ids/keys, and noncanonical input bytes reject
      before any callback, stdout, file write, or partial decoded value.
- [ ] Wrong serializers that use insertion order, native number conversion,
      Unicode normalization, dropped locations, ignored unknown fields, or
      sorted semantic child order are killed by named tests.
- [ ] Repeated fresh subprocesses under at least `TZ=UTC`/`Europe/Zurich` and
      `LANG=C`/UTF-8 locale produce the same digest locally; Linux CI runs the
      same gate after push.
- [ ] `pnpm test:kern-ir-probe`, contract tests, touched gates, full current
      `pnpm fitness:kern-5`, and full-roster Agon review pass.
- [ ] `kir-v1` remains planned and `versioned-kir-v1` remains not-shipped.

## Out of Scope

- Freezing or publishing `kir.v1`.
- Adding a core KIR reader/writer or migrating any production client.
- Refactoring ReferenceRunner to consume KIR.
- Freezing handler, capability provider, runtime value, or trace ABI.
- Comment/trivia preservation or a lossless formatter tree.
- Full language-node coverage, compiler lowering, interpreter, fixed point, or
  emitted target changes.
- Claiming Linux/macOS equality before CI supplies the second-OS witness.

## Deploy Order

1. Land the probe command, corpus, policy row, and selection evidence together.
2. Existing 4.5 parser/runner/compiler/transpilers remain primary during all
   version skew; the probe has no production reader or writer.
3. R1.4 adds strict readers before any writer emits frozen KIR v1.
4. Unknown experimental/frozen formats always fail closed; no fallback parser
   treats them as source AST or runner lowering.

Rollback is deletion/disablement of the probe gate. No runtime behavior or
public artifact changes in R1.3.

## Open Questions

None feeds the R1.3 oracle. Exact frozen field names, complete node coverage,
runtime/capability ABI boundaries, and reader migration are R1.4 decisions;
the probe records evidence for them without declaring them public contract.

## Corrections Log

| Original claim | Verified reality | Impact |
|---|---|---|
| Existing `IRNode` could be canonicalized directly | It is open, mutable during validation, raw-expression-bearing, and served by a debug-only serializer | Keep it as frontend AST, not KIR |
| Current `ValueIR` is typed semantic KIR | It mirrors TS/JS and includes raw TS closure blocks and JS numeric representation | Build a KERN-owned probe schema; do not freeze `ValueIR` |
| Runner-linked form is executable KIR | It is private, Map/reference-backed, runner-specific, and still executes raw `IRNode` | Treat it as lowering evidence only |
| R1.3 can select B by architecture alone | Tribunal proved B is a phantom seam until a concrete artifact passes hostile probes | Selection is conditional on executable evidence |
| Semantic KIR must also preserve formatter trivia | Compiler determinism and source fidelity need explicit layers | KIR retains spans; lossless trivia remains a separate future source layer |
