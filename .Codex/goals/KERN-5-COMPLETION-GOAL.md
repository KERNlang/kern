# KERN 5.0 Completion Goal

**Status:** ACTIVE GOAL DEFINITION
**Verified baseline:** `origin/main` at
`d323fc722f4aa76825cbeb294398eed5fe5561e7`
**Current public version:** `4.5.0`
**Last completed slice:** M4.156 bounded conditional lexical-checkpoint shadow
**Current slice:** M4.157 bounded inline-comment boundary shadow; implementation,
exact-roster review remediation, and final complete fitness wall passed,
publication pending
**Confidence:** 0.99

## Short Start Prompt

Use this short prompt to start a new Codex session:

> Read `.Codex/goals/KERN-5-COMPLETION-GOAL.md` completely and treat it as the
> authoritative goal contract. Create or activate the KERN 5 completion goal,
> then begin executing it immediately from current `origin/main`. Preserve the
> existing stale/dirty checkout and work only in fresh isolated worktrees. Do
> not merely summarize the file and stop. Continue automatically from one
> verified slice to the next until every binary Definition of Done item is
> satisfied. Pause only for a genuine external blocker or immediately before
> an irreversible public registry/tag operation that lacks explicit authority.

## Primary Objective

Take KERN from the current internal-oracle/self-hosting state to a genuine KERN
5.0 implementation and release proof.

KERN 5 means:

- KERN owns its canonical source frontend.
- KERN owns source/KIR compilation.
- KERN owns canonical handler execution through its own semantic
  interpreter/runtime.
- Host code supplies explicit capabilities and transport only.
- Stage 1 equals Stage 2 deterministically from clean packed inputs.
- Normal canonical execution reaches no TypeScript semantic engine and has no
  silent fallback.
- A forced TypeScript oracle remains available and trace-compatible.
- Exact packed artifacts pass clean installation, CLI, runtime, browser,
  Express, FastAPI, application, bootstrap, and integrity checks.
- The support matrix contains no false or future-tense KERN 5 claim.
- The final release uses the exact accepted RC source, with only enumerated
  version-stamp differences.

Do not call the goal achieved because the currently promoted
`pnpm fitness:kern-5` wall passes. That command executes only promoted gates
and deliberately excludes unfinished planned gates.

## Starting-State Safety

The primary local checkout was 41 commits behind `origin/main` on 2026-08-04
and contained three unrelated untracked canonicalizer files. Do not modify,
delete, stage, clean, or absorb them.

Start in an isolated worktree from current remote main:

1. Run `git fetch origin`.
2. Create a fresh worktree and feature branch from `origin/main`.
3. Confirm `HEAD == origin/main` before editing.
4. Audit the actual current release train, support matrix, fitness policy,
   package graph, and latest completed slice before planning new work.

After every landed slice, never reuse its branch. Begin the next slice with:

```sh
git fetch origin
git checkout -b feat/<new-slice> origin/main
```

When using worktrees, create the equivalent fresh worktree from `origin/main`.

## Operating Mode

Continue automatically from slice to slice. Do not wait for human approval
between ordinary implementation slices. Stop only for:

- a genuine missing product decision;
- missing external authority or credentials;
- an irreversible public registry/tag operation requiring final confirmation;
- a technical blocker that remains after root-cause investigation and safe
  alternatives are exhausted.

Do not provide calendar estimates. Report actual evidence, measured durations,
current gates, and remaining gates.

Every non-trivial slice must:

1. Verify the current contract from source.
2. Write a claim-tagged spec under `.Codex/specs/<slice>/spec.md`.
3. Define binary acceptance criteria.
4. Derive discriminating oracle fixtures directly from those criteria.
5. Prove RED-at-base for the intended missing behavior.
6. Red-team the oracle against plausible wrong implementations.
7. Implement the smallest complete ownership boundary.
8. Keep handwritten source files below 500 lines.
9. Put limits, budgets, model names, thresholds, and policy values in
   configuration.
10. Run touched-package tests and the complete currently promoted KERN 5 wall.
11. Run full-roster `agon review`.
12. Fix every source-verified blocker and rerun affected gates.
13. Commit with the mandatory Agon KERN identity and footer.
14. Run `git fetch origin && git rebase origin/main` immediately before push.
15. Push the completed slice once with
    `git push --no-verify origin HEAD:main` and verify the remote SHA.
16. If the rebase changed the base, rerun the affected focused gates before
    pushing.
17. Start the next slice from the new `origin/main`.

Direct pushes for these completed, locally verified slices are explicitly
authorized. Do not open a pull request unless direct push is rejected. Never
use `gh`.

For each Agon invocation, use the full current usable roster. The roster
resolved on 2026-08-05 is:

```text
-e claude,codex,agy
```

Resolve roster drift before later reviews and use all usable non-excluded
engines. Never include `qwen` or `ollama`.

## Mandatory Delivery Sequence

### Phase 1 — Freeze the Alpha contracts

- Turn the existing KIR constitution, reader, codec, module graph, coverage
  closure, evidence, and receipt into a genuinely versioned canonical KIR v1.
- Prove the canonical runtime call chain is non-circular.
- Freeze KIR, handler ABI, capability ABI, diagnostics, UTF-8 locations,
  traces, determinism, limits, and rejection behavior.
- Implement and promote `pnpm test:kern-ir`.
- Do not promote `versioned-kir-v1` from `not-shipped` until the binary oracle
  proves the complete contract.

### Phase 2 — Complete the KERN frontend

M4.153 already owns bounded line tokenization as an internal oracle. Continue
with independently reviewable slices for:

- multiline source handling;
- comments, trivia, indentation, and source preservation;
- token-stream parsing;
- declarations, properties, expressions, handlers, modules, and imports;
- malformed-input diagnostics;
- stable UTF-8 evidence;
- complete source-to-KIR emission;
- bootstrap-versus-KERN KIR and diagnostic parity;
- mutation tests that kill delegated, constant, partial, or reordered
  implementations.

Promote `pnpm test:kern-frontend` only when KERN and bootstrap frontends produce
byte-identical canonical KIR and diagnostics over the complete admitted valid
and malformed corpus, with no tolerated drift list.

### Phase 3 — Complete the KERN compiler

- Implement KERN-owned KIR-to-target compilation.
- Preserve TypeScript, Python, Express, FastAPI, and browser behavior required
  by the v5 matrix.
- Byte-match the bootstrap compiler on a discriminating corpus.
- Compile KERN's own frontend, compiler, and runtime sources.
- Kill constant-output, delegated-host, stale-artifact, and partial-coverage
  mutations.
- Promote `pnpm test:kern-compiler` only when compiler ownership is real rather
  than adapter ownership.

### Phase 4 — Prove the self-hosting fixed point

From separate clean roots and immutable packed inputs:

- Stage 0 builds Stage 1.
- Stage 1 builds Stage 2.
- Stage 1 and Stage 2 artifacts are byte-identical after only explicitly
  allowed normalization.
- Repeat the proof twice.
- Match behavior, diagnostics, manifests, hashes, and package integrities.
- Prove no stale `dist`, workspace link, previous-stage evidence, or untracked
  file can satisfy the gate.
- Promote `pnpm test:selfhost-fixed-point`.

### Phase 5 — Complete the KERN semantic interpreter

- Make the KERN-authored interpreter consume the frozen KIR and
  handler/capability ABIs.
- Cover every supported v5 construct.
- Converge sync and immediately resolved async execution through one semantic
  engine.
- Require zero divergence in typed results, stdout/events, diagnostics,
  completion, cancellation, effects, and capability requests.
- Ensure unsupported shapes fail before partial output or effects.
- Run native, TypeScript, Python, Express, FastAPI, browser, and whole-app
  matrices.
- Kill parser/compiler/interpreter mutations.
- Promote `pnpm test:kern-interpreter-shadow`.

### Phase 6 — Perform the canonical cutover

Only after frontend, compiler, fixed point, and interpreter shadow are
complete:

- Freeze all public contracts and package boundaries.
- Make the KERN engine canonical for internal packages, then CLI Node, then
  browser.
- Keep the TypeScript oracle behind an explicit configuration selector.
- Run canonical and forced-TS lanes in CI.
- Prove canonical execution never reaches the TypeScript ReferenceRunner or
  compiler.
- Prove unsupported canonical input fails loudly and never silently falls
  back.
- Remove scheduled 4.x compatibility exports only when the release train
  allows it.
- Revalidate the browser graph, budgets, and downstream behavior.

### Phase 7 — Prove the packed RC

Implement and promote `pnpm test:packed-release`.

The exact packed RC must pass:

- clean exact-version installation;
- package exports and binaries;
- CLI check, canonicalize, compile, and run;
- canonical and forced-TS runtime modes;
- browser execution and budgets;
- reference application;
- Express and FastAPI applications;
- fixed-point bootstrap;
- artifact and dependency integrity;
- one clean downstream KERN-product canary;
- two complete `pnpm fitness:kern-5` runs from separate fresh roots;
- terminal full-roster Agon review with no verified blocker.

Produce an immutable RC manifest containing source SHA, toolchain versions,
contract hashes, fixed-point hashes, tarball integrities, and every gate result.

### Phase 8 — Release public KERN 5.0

Public publication is the only step that may pause for explicit confirmation
if authority has not already been granted.

- Final source must equal the accepted RC source.
- Inject `5.0.0` only through the configured release policy.
- Rebuild cleanly and compare against the RC manifest.
- Pack once and verify every tarball.
- Stage and verify exact internal dependencies and registry integrity.
- Promote packages dependency-first and `kern-lang@latest` last.
- Install from `latest` in a clean consumer and rerun representative smoke
  tests.
- Record tag, source SHA, workflow, provenance, package integrities, and
  post-publication evidence.
- Never reuse a failed published version.

## Binary Definition of Done

Mark this goal complete only when every item is true:

- [ ] Versioned KIR v1 is shipped.
- [ ] The KERN frontend is canonical and zero-drift.
- [ ] The KERN compiler is canonical and compiles its own sources.
- [ ] Stage 1 equals Stage 2 twice from clean packed inputs.
- [ ] The KERN interpreter is zero-drift and canonical.
- [ ] Normal execution contains no TypeScript semantic call or silent fallback.
- [ ] Forced TypeScript oracle mode still works.
- [ ] Native, TypeScript, Python, browser, Express, FastAPI, and application
      walls pass.
- [ ] Exact RC tarballs pass packed installation and bootstrap.
- [ ] `pnpm fitness:kern-5` contains and passes every target gate.
- [ ] Full-roster Agon review has no unresolved verified blocker.
- [ ] Documentation and support matrices match proved ownership exactly.
- [ ] Final version is `5.0.0` and final source SHA equals accepted RC source.
- [ ] If public publication is authorized, registry/tag/`latest` and
      clean-consumer verification pass.

## Fable Rule

Do not move unfinished KERN 5 requirements into “Fable” or rename them to make
5.0 appear complete. Fable begins only after the KERN 5 definition above is
satisfied.

## Reporting

After each slice, report concisely:

- landed SHA;
- ownership boundary gained;
- gates and exact counts;
- Agon findings and fixes;
- remaining KERN 5 gates;
- next slice already started from fresh `origin/main`.

Do not stop after reporting. Continue the goal.
