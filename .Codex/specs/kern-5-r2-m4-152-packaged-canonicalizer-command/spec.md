# KERN 5 R2 M4.152 Packaged Canonicalizer Command

**Status:** VERIFIED — READY TO PUBLISH
**Date:** 2026-08-03
**Confidence:** 0.93

## Executive Summary

M4.152 converts the completed bounded KERN-authored canonicalizer from a
repository-only oracle into one opt-in command carried by the published CLI
artifact:

```text
kern canonicalize <file.kern> [--check] [--json]
```

The command parses with the existing TypeScript bootstrap frontend, projects
the decoded structural KIR into the existing twelve-table transport, executes
the authenticated KERN `canonicalize` handler, and emits canonical KERN source.
It is deliberately a canonicalizer preview, not a production formatter: it
does not preserve comments/trivia and it does not create KERN frontend,
compiler, fixed-point, or interpreter ownership.

## Current State / Root Cause

- **VERIFIED:** `origin/main` is `c063801418827b5053811c28ab6745e53bd7e020`.
  M4.151 reports 112/112 base-complete canonicalizer functions, zero legacy
  parameter blockers, and a terminal `complete` prerequisite state. Evidence:
  `scripts/kern-canonicalizer/coverage-current.mjs`,
  `scripts/kern-canonicalizer/coverage-status-m4-151.mjs`, and the M4.151 spec.
- **VERIFIED:** canonicalization behavior is currently reachable only through
  repository scripts. `packages/cli/src/cli.ts` has no `canonicalize` command,
  and `packages/cli/package.json` publishes only `dist`. Evidence inspected on
  2026-08-03.
- **VERIFIED:** `scripts/check-kern-canonicalizer.mjs` already proves exact
  goldens, second-pass idempotence, structural-KIR byte preservation, bounded
  profile failure, and hostile table rejection by executing the KERN handler.
- **VERIFIED:** the executable source is the exact three-member composition at
  `examples/kern-canonicalizer/canonicalizer.composed.kern`; its composition
  record and policy are authenticated by repository-owned validators.
- **VERIFIED:** the fitness policy still marks `kern-formatter` and
  `kern-frontend` `not-shipped`. The existing canonicalizer row is only an
  `internal-oracle`, which remains truthful for this opt-in preview.
- **VERIFIED:** the CLI cannot consume the structural module codec through a
  package export without violating the existing guard that forbids every
  public `kir-structural` export. The CLI build must therefore carry a private
  emitted-codec closure without changing the core package export map.

## Selected Design

The six-engine Agon brainstorm unanimously selected a packaged product
boundary over another evidence-only milestone or starting the frontend before
the canonicalizer is consumable. The winning draft described the dataflow as
KIR-to-KIR; source inspection corrected that point. The actual existing
contract is decoded structural KIR to canonical KERN source.

### Command contract

| Input | Behavior | Exit |
|---|---|---:|
| supported valid `.kern` source | emit canonical source | 0 |
| `--check`, already canonical | emit no source; report canonical in JSON mode | 0 |
| `--check`, canonical output differs | emit no source; report changed in JSON mode | 1 |
| malformed, unsupported, over-profile, asset-integrity, or I/O failure | emit no canonical source; deterministic diagnostic | 2 |

`--json` emits one versioned JSON record with exact fields for outcome,
changed state, canonical source or `null`, canonicalizer digest, and ordered
diagnostics. Non-JSON success writes only canonical source to stdout. Non-JSON
failure writes one diagnostic to stderr. No partial canonical output is emitted
on failure.

### Distribution contract

- `packages/cli` build copies only the verified composite KERN bytes,
  composition metadata, canonicalizer policy, and the exact bounded runtime
  import closure of the already-built structural module codec into
  `dist/kern-canonicalizer/`.
- The build refuses stale composition or policy input before copying.
- The codec closure builder rejects missing modules, bare imports, non-JavaScript
  edges, and every edge escaping `packages/core/dist`; copied paths preserve
  relative import semantics inside CLI dist.
- The build emits `assets.json`, binding the exact composite, policy, and every
  copied codec-module byte length and SHA-256 digest. Runtime checks those
  assets against that manifest and checks the composite against the
  authenticated composition record.
  Registry/tarball integrity remains the boundary against hostile replacement
  of the complete package.
- The command resolves assets relative to `import.meta.url`; it cannot reach
  repository `scripts/` or `examples/` at runtime.
- Root build generates the closure before the release pack phase; packages
  deliberately declare no lifecycle hooks because the release gate bans them.
  The exact same command works from workspace `dist` and an actual packed CLI
  tarball; the focused gate inspects required tar entries and executes that
  extracted artifact in a fresh process.

### KIR boundary contract

- Do not add any core export. The CLI build privately copies the codec's exact
  emitted runtime closure, while a source-only declaration describes the
  narrow encode/decode contract to the CLI compiler.
- This adds no compiled core file and does not promote `versioned-kir-v1`; its
  proof label remains `ALPHA-NO-GO`, the public export map is unchanged, and
  the structural-codec containment guard must remain green.
- The CLI round-trips parsed roots through encode/decode before flattening, so
  canonicalization consumes the validated structural artifact rather than raw
  parser objects.

## Blast Radius

| Surface | Action |
|---|---|
| this spec | add |
| core package/source | unchanged; copy a private emitted codec closure after core build |
| CLI canonicalizer adapter/assets/command | add |
| CLI registry, help, build script, and focused tests | modify |
| repository asset-copy script | add |
| canonicalizer release gate | include built-command acceptance |
| support matrix/release train | document preview without ownership promotion |
| canonicalizer KERN members, policy limits, runtime ABI | unchanged |

## RED Oracle and Cheat Kills

- **RED-at-base:** spawning `packages/cli/dist/cli.js canonicalize` fails because
  no command or packaged assets exist.
- A shuffled-property fixture must change to its exact golden, killing an
  identity implementation.
- A second pass must be byte-identical and `--check` must distinguish changed
  from canonical input, killing an always-zero check command.
- Malformed input and profile overflow must emit no canonical source and exit
  2, killing partial-output and unbounded implementations.
- Mutating one copied composite byte must fail runtime digest verification,
  killing accidental or partial packaged-asset drift.
- Renaming/removing repository `examples/` after build must not affect the
  command, killing runtime repository discovery.
- The asset builder rejects every private-codec import that is bare or escapes
  the copied core-dist closure; the command resolves all non-package assets
  relative to its own CLI dist location.
- Fitness assertions keep `kern-formatter` and `kern-frontend` `not-shipped`,
  killing a false ownership promotion.

## Acceptance Criteria

- [x] RED command oracle fails at M4.151 for the missing command/assets reason.
- [x] Verified source/policy/composition assets are copied deterministically
      into CLI dist and runtime consistency-checked before execution.
- [x] `kern canonicalize` emits the exact existing shuffled-identifier golden.
- [x] Default, `--check`, and `--json` modes obey the exit/output contract.
- [x] Malformed input, unsupported structural input, and profile overflow fail
      atomically without partial canonical source.
- [x] Built-command output is byte-identical to the repository oracle for the
      complete valid fixture corpus, including second-pass idempotence and KIR
      preservation.
- [x] The built CLI has no runtime dependency on repository scripts/examples.
- [x] `kern-formatter`, `kern-frontend`, compiler, fixed point, interpreter,
      KIR-v1, and package version claims remain unpromoted.
- [x] Focused tests, `pnpm test:kern-canonicalizer`, and
      `pnpm fitness:kern-5` pass on Node 22.
- [x] Full-roster Agon review has no unresolved source-verified blocker.
- [ ] The Agon-signed commit is rebased onto current `origin/main`, pushed once,
      and remote `main` equals the local SHA.

## Out of Scope

- Comment/trivia preservation, in-place writes, multi-file directory mode, or
  calling this a production formatter. Comment syntax is rejected rather than
  silently discarded.
- KERN tokenizer/parser implementation or frontend diagnostic parity.
- Public KIR v1, compiler, fixed point, interpreter cutover, RC, v5.0.0, or
  Fable.
- Any canonicalizer source change, new syntax family, or resource-limit widening.

## Correction Log

- The initial design proposed an `internal/kir-structural` core export. The
  full KERN 5 wall correctly rejected it because every export-map entry is a
  public KIR promotion regardless of its name. M4.152 instead copies the exact
  emitted runtime closure privately into CLI dist and leaves core unchanged.
- Review removed hardcoded canonicalizer metadata from the command test,
  isolated the tamper test from live CLI dist, omitted source from
  `--check --json`, added clean `.kern` admission, replaced the handwritten
  codec declaration with an exact re-export, and narrowed the runtime digest
  claim to partial drift.
- Final review moved implicit asset loading inside the library function's
  failure boundary, so direct callers receive the same deterministic failure
  report as the CLI when packaged assets are invalid.
- Adversarial distribution review found that root `pnpm build` did not generate
  the gitignored CLI closure. Root build now invokes the deterministic asset
  builder, and the focused gate builds, inspects, extracts, and executes the
  actual `pnpm pack` artifact.
- Boundary review added policy digest binding, policy-tamper rejection, a
  policy-owned source byte ceiling before parsing, fatal UTF-8 decoding,
  filename-independent structural module identity, and explicit symbolic-link
  rejection while preserving the regular-file contract.
- Final release review removed the temporarily proposed `prepack` hook because
  repository artifact policy bans package lifecycle scripts. It also bounded
  bootstrap parser diagnostics by the policy-owned runtime limit and made
  symlink rejection atomic with `O_NOFOLLOW` plus descriptor identity checks.
- Follow-up hardening rejects non-preservable comment syntax, binds every copied
  private codec module into the asset manifest, and keeps atomic path identity
  verification portable when `O_NOFOLLOW` is unavailable.

## Local Verification

- `pnpm test:kern-canonicalizer`: 732/732 authenticated tests, 58 golden/KIR
  fixtures, eight measured witnesses, three bounded profile rejections, 250
  hostile fixtures, 58 packaged-dist fixed points, asset tamper rejection, and
  terminal 112/112 coverage passed.
- `pnpm --filter @kernlang/cli test`: complete CLI suite passed, including the
  thirteen command-contract tests.
- `node scripts/check-kern-canonicalizer-cli.mjs`: tarball inspection found the
  exact manifest, composite, composition record,
  policy, and codec entrypoint; the extracted tarball canonicalized the known
  supported fixture successfully.
- `pnpm fitness:kern-5`: complete repository, lint, build, workspace,
  infrastructure, cross-target, native, runner, browser, KIR, ownership,
  runtime-containment, canonicalizer, and diff-hygiene wall passed on Node 22.

## Review Evidence

- Agon full-roster review `review-1785761957099-hdorsu`: five of six engines
  returned; Codex timed out. Synthesis reported zero verified blockers and one
  needs-check finding. Source verification confirmed the direct-library asset
  loading failure boundary issue; the implementation and regression above
  resolve it before the final review rerun.
- Agon full-roster review `review-1785763484905-rztzk1`: six of six engines
  returned. Its source-verified root-build blocker and input/package boundary
  findings produced the corrections above; the final corrected diff remains
  subject to one post-gate full-roster review.
- Agon full-roster review `review-1785765246192-jlo9hk`: six of six engines
  returned. Source verification confirmed the banned-lifecycle release blocker
  and bounded-output/symlink issues; the corrections above resolve them. The
  codec declaration path claim was disproved by direct path resolution and
  repeated clean TypeScript builds.
- Agon full-roster review `review-1785765868634-lrbyas`: five engines returned
  and Codex timed out. Its three synthesized blockers were disproved by the
  existing core export map, repeated root TypeScript builds, and execution of
  the extracted tarball. Source verification did confirm comment-loss,
  cross-platform path-opening, and private-codec drift risks; the final
  hardening and regressions above resolve all three.

## Next Slice

M4.153 begins the KERN frontend shadow at the tokenizer/diagnostic boundary and
uses the packaged canonicalizer command as a consumer-facing oracle. It must
not reopen the completed M4.151 parameter frontier.
