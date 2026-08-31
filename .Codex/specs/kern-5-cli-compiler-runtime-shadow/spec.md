# KERN 5 CLI Compiler/Runtime Shadow

**Status:** READY TO BUILD
**Date:** 2026-08-27
**Confidence:** 0.93

## Executive Summary

Add an explicit, observation-only `--kir-shadow` mode to `kern compile` and
`kern run`. It accepts real `.kern` source only through packaged F5 projection,
then consumes the package-owned RT-1, JavaScript ESM compiler, and Python
compiler. It reports per-target deterministic artifacts and three-way normalized
execution parity without writing target artifacts, changing normal command
behavior, promoting KIR, or falling back to legacy source semantics.

Production routing belongs only under `packages/cli/src/kir-shadow/`. The
existing `compile.ts` and `run.ts` are already oversized, so they may contain
only flag parsing and narrow delegation.

## Current State / Root Cause

- **VERIFIED:** `kern compile` creates an output directory, writes via
  `transpileAndWrite`, and reserves `--shadow` for TypeScript analysis.
  Evidence: `packages/cli/src/commands/compile.ts:529-571,694-756,841-846`.
- **VERIFIED:** `kern run` reads source and calls `executeKernSource*` from
  `@kernlang/core/runner`; unrecognized flags are rejected.
  Evidence: `packages/cli/src/commands/run.ts:24-42,483-563,575-630`.
- **VERIFIED:** packaged projection accepts `{ modules }`, returns a projection
  result, and uses a non-forgeable verified projection type.
  Evidence: `packages/core/src/frontend-projection/contracts.ts:17-25,49-71`
  and `packages/core/src/frontend-projection.ts:245-350`.
- **VERIFIED:** RT-1, JS ESM, and Python KIR owners are public package exports.
  Evidence: `packages/core/package.json:45-55`;
  `packages/core/src/kir-runtime/contracts.ts:30-95`;
  `packages/core/src/compiler/kir-js-esm/contracts.ts:5-44`; and
  `packages/core/src/compiler/kir-python/contracts.ts:5-44`.

The missing boundary is a CLI adapter, not frontend/compiler/runtime behavior.
Reusing `--shadow` would conflate KIR observation with TypeScript analysis.
Reusing normal `run` would reach source/ReferenceRunner semantics rather than
direct KIR.

## What Already Works

- Packaged F5 projection is the sole producer/authentication boundary.
- RT-1 has a closed request, event, diagnostics, and envelope contract.
- Each target compiler is deterministic, package-owned, and returns an artifact
  plus a digest-bound manifest.
- Default `kern compile` and `kern run` remain authoritative and unchanged.

## Contract (Verified)

> Verified against stacked head `3348b04d` on 2026-08-27.

| Field / Behavior | Type | Evidence | Tag |
| --- | --- | --- | --- |
| Shadow activation | `--kir-shadow` | Existing `--shadow` is TypeScript analysis at `compile.ts:569-570` | DECIDED |
| Entry | required `--kir-shadow-entry <module-id>#<handler>` | all three owners require `{ moduleId, handlerName }`: JS/Python `contracts.ts:10-14`, RT-1 `contracts.ts:30-42` | DECIDED |
| Input IDs | normalized relative POSIX `.kern` IDs | projection input contract `frontend-projection/contracts.ts:17-25` | VERIFIED |
| Projection | `projectKernModules` then `verifyKernProjection` | `frontend-projection.ts:245-350` | VERIFIED |
| Runtime | `executeKernKir(verified, request, options)` | RT-1 contract `kir-runtime/contracts.ts:30-95` | VERIFIED |
| Compilers | `compileKernKirToJavaScriptEsm`, `compileKernKirToPython` | package export map `package.json:49-55` | VERIFIED |
| Compile report | one stdout JSON document, `kern.cli.kir-shadow.v1` | CLI decision; target APIs are side-effect-free | DECIDED |
| Run report | one stdout JSON document; program stdout remains normalized event data | RT-1 events `kir-runtime/contracts.ts:57-95`; CLI decision | DECIDED |
| Capability policy | first slice accepts zero-parameter, capability-free RT-1 handlers only | callbacks are non-serializable `kir-runtime/contracts.ts:45-55` | DECIDED |
| Python host | `KERN_PYTHON`, otherwise `python3`, exact 3.12+ preflight | C-PY-1 records the 3.12 proof floor in `.Codex/specs/kern-5-c-py-1-contract/spec.md` | DECIDED |

### CLI grammar

```text
kern compile <file.kern> --kir-shadow --kir-shadow-entry <module-id>#<handler>
kern run <file.kern> --kir-shadow --kir-shadow-entry <module-id>#<handler>
```

`--kir-shadow` accepts exactly one file. It rejects directory input, imports,
handler parameters, capabilities, `--watch`, `--serve`, `--target`, `--json`,
`--shadow`, `--shadow-real-types`, `--tolerant`, `--async-preview`,
`--capabilities`, all capability/provider/network/filesystem flags, and
`--iteration-budget`. The module-id is the supplied basename and must exactly
match the entry selector. Limits are finite constants in `kir-shadow/limits.ts`;
they are not embedded in the two existing command files.

The report contains normalized relative identity, SHA-256 digests, fixed
contract fields, diagnostic code/phase, and normalized KIR values/events only.
It never reports source, raw artifact bytes, absolute paths, environment values,
provider credentials, or child stderr.

### Compile report and comparison

Compile emits:

```json
{
  "command": "compile",
  "format": "kern.cli.kir-shadow.v1",
  "outcome": "match",
  "report": {
    "entry": { "handlerName": "main", "moduleId": "main.kern" },
    "projection": { "artifactSha256": "<sha256>", "status": "projected" },
    "targets": {
      "javascriptEsm": { "artifact": { "sha256": "<sha256>" }, "deterministic": true, "manifest": { "sha256": "<sha256>", "value": {} }, "outcome": "success" },
      "python": { "artifact": { "sha256": "<sha256>" }, "deterministic": true, "manifest": { "sha256": "<sha256>", "value": {} }, "outcome": "success" }
    }
  }
}
```

Each target compiles twice from the same verified projection/request. Artifact
and manifest bytes must match per target; JS and Python artifacts are never
cross-byte-compared. The parsed manifests must have the exact existing 12 keys
and bind artifact, entry, compiler/runtime/target format, linked-program digest,
projection digest, and kernel digest. No target, manifest, report, or cache file
is written by shadow mode.

### Run report and comparison

Run returns the same outer envelope with `entry`, `projection`, and
`executions.rt1`, `executions.javascriptEsm`, and `executions.python`. It
executes RT-1 in-process, JS in an isolated Node child, and Python in an
isolated 3.12+ child using a versioned one-request/one-response
`kern.cli.kir-shadow.python.1` JSON framing. The children receive no repository
or package path, no provider, network, or filesystem capability, and a cleared
deterministic locale.

The adapter compares exact normalized `{ completion, diagnostics, events,
format, outcome, result }`, omitting request ID and host error text. All three
must deep-equal for `outcome: "match"`; shadow mode never replays program
stdout as CLI output.

## Failure and Unsupported-Subset Behavior

- Bad flags, duplicate flags, bad entry syntax, a directory, import, parameter,
  capability, or unadmitted handler exit `2`, write one bounded stderr message,
  and write no stdout.
- Projection rejection/fatal, compiler failure, malformed manifest, per-target
  nondeterminism, missing/old Python, malformed child response, child timeout,
  nonzero child exit, normalized mismatch, or unsupported RT-1 semantics exit
  `2` with one report-shaped stdout document and stable `unavailable` or
  `mismatch` outcome. They never invoke legacy compile/run or replay partial
  output.
- Unexpected adapter defects exit `1` with a bounded generic error and no
  source/artifact/host-private data.
- A missing Python host is not permission to skip Python, accept two legs, or
  invoke the legacy Python transpiler.

## Implementation Options

### A. Focused owner and thin command delegates (selected)

Add `packages/cli/src/kir-shadow/{owner,limits,projection-input,compile-report,
run-report}.ts` and narrowly delegate from compile/run. Add isolated child
drivers only as required. Every handwritten file remains below 500 lines.

**Confidence:** 0.93. This shares projection, limits, normalization, and
no-fallback policy while retaining existing routes untouched.

### B. Put routing directly in `compile.ts` and `run.ts`

Rejected: both files are oversized and independent implementations would drift.

**Confidence:** 0.99.

### C. Reuse current `--shadow` or normal source run

Rejected: those routes are TypeScript analysis and source execution.

**Confidence:** 0.99.

## Blast Radius

| File / area | Action | Reason |
| --- | --- | --- |
| `packages/cli/src/commands/compile.ts` | narrow edit | flag validation and delegation only |
| `packages/cli/src/commands/run.ts`, `run-options.ts` | narrow edit | flag validation and delegation only |
| `packages/cli/src/kir-shadow/*.ts` | add | bounded projection, compile, runtime, normalization, child ownership |
| `scripts/kern-5-cli-compiler-runtime-shadow/*.test.mjs` | add now | RED owner and black-box contract oracle |
| Core KIR owners | no change | consume their existing package APIs |

## Acceptance Criteria

- [ ] A real `.kern` fixture reaches packaged projection and verified KIR; no
  legacy parser/transpiler result can substitute for it.
- [ ] Compile twice-compiles both target owners and reports exact deterministic
  per-target artifact/manifest identities without writing output.
- [ ] Run compares direct RT-1, isolated JS, and isolated Python normalized
  envelopes/events/errors, without stdout replay.
- [ ] All shadow failures are bounded and atomic, with no legacy fallback.
- [ ] Default compile/run behavior and existing `--shadow` remain unchanged.
- [ ] The owner guard proves exactly one focused owner and rejects
  `executeKernSource`, ReferenceRunner, legacy transpilation, parser, and
  `@kernlang/core/runner` reachability.
- [ ] All new handwritten source modules are below 500 lines.

## Out of Scope

Default KIR routing, canonical promotion, release-gate promotion, commits,
pushes, rebases, deployment, imports/modules, capability bridge, parameter
marshalling, source-to-target compilation, KIR schema changes, and a reusable
public Python protocol.

## Open Questions

None blocking. The one-file, zero-argument, capability-free boundary is an
explicit first admission profile, not a claim that the package owners lack
broader APIs.

## Deploy Order

1. F5, RT-1, JS lowering, and Python lowering remain unchanged prerequisites.
2. Add the CLI shadow owner/report/gate without changing default consumers.
3. A later shadow slice may widen admission; only canonical cutover may alter
   default routing.

## Corrections Log

| Original Claim | Reality | Impact |
| --- | --- | --- |
| Existing `--shadow` could host this. | It is TypeScript semantic analysis coupled to legacy compilation. | Reserve `--kir-shadow`. |
| C-PY-1 supplied a CLI protocol. | It deliberately deferred stdio framing to a later CLI shadow. | This slice owns a bounded child framing. |
| Run could inherit normal capability flags. | RT-1 needs a non-serializable host callback. | Capability-free admission only. |
| JS and Python artifacts can be byte-compared. | Target formats differ. | Compare determinism per target and execution envelopes. |
