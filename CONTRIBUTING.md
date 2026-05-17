# Contributing to KERN

Thanks for your interest in contributing to KERN.

## Setup

```bash
git clone https://github.com/KERNlang/kern.git
cd kern
corepack enable
corepack prepare pnpm@10.32.1 --activate
pnpm install
pnpm build
pnpm test
```

**Requirements:** Node.js 22+, pnpm 10+, Python 3.12+ (for FastAPI transpiler tests)

## Development

```bash
pnpm build          # tsc -b (all packages)
pnpm test           # Run all tests
pnpm lint           # Biome lint + format check
pnpm lint:fix       # Auto-fix lint issues
pnpm format         # Format all source files
```

Build uses `tsc -b` from root with project references. Do not use `pnpm -r build`.

## Branch conventions

- `dev` — daily development. Push here.
- `main` — releases only. Merge via PR. CI must pass.

## Release conventions

- Always activate the repo-pinned pnpm via Corepack.
- Run `Release Preflight` from `main` before tagging a release.
- Use plain semver like `3.2.4` for preflight input.
- Publish GitHub Releases with lowercase tags like `v3.2.4`.
- Do not release from `dev` or from a commit that has not already passed CI on `main`.

## Before submitting a PR

```bash
tsc -b && pnpm test && pnpm lint
```

All three must pass. The CI runs these plus `kern review packages/ --recursive`.

## Project structure

KERN is a pnpm monorepo. Key packages:

| Package | Purpose |
|---------|---------|
| `packages/core` | Parser, codegen, types, spec |
| `packages/cli` | CLI commands (compile, review, evolve, dev) |
| `packages/review` | Static analysis engine (130 rules, taint tracking) |
| `packages/review-mcp` | MCP server security scanner |
| `packages/react` | Next.js / React / Tailwind transpilers |
| `packages/vue` | Vue 3 / Nuxt 3 transpilers |
| `packages/express` | Express backend transpiler |
| `packages/fastapi` | FastAPI Python transpiler |

Architecture guide: [docs/architecture.md](docs/architecture.md)

Boundary rules:

- `packages/core` owns shared semantics and should stay at the bottom of the dependency graph.
- Target packages should depend on `packages/core`, not on each other.
- `packages/cli`, `packages/mcp-server`, and `packages/playground` are orchestration surfaces and may aggregate lower packages.
- New review rules belong in `packages/review` unless they are explicitly Python- or MCP-specific.

## Adding a review rule

Review rules live in `packages/review/src/rules/`. Each rule exports a function that receives an AST node and returns findings. See existing rules for the pattern. Add tests in `packages/review/tests/`.

CI runs `pnpm check:rule-coverage`, which fails if a rule ID in the REGISTRY at `packages/review/src/rules/index.ts` has no quoted reference in `packages/review/tests/` or `packages/review-mcp/tests/`. Add a test that asserts your rule fires (any shape — unit test, corpus file, concept test) in the same PR. The legacy backlog in `scripts/rule-coverage-allowlist.json` may only shrink.

### Finding-message voice

Rule messages are what users read in their terminal / IDE / PR comments. Keep voice consistent:

- **Code is the subject, not the developer.** `Mutates props during render`, not `You are mutating props`. The "did you mean 'X'?" suggestion pattern from TypeScript/rustc is fine — it's an established convention.
- **Present tense.** `Catch block swallows exception`, not `…swallowed…` or `…was detected`.
- **Verb-first headline, ≤ 90 chars.** Suggestion field ≤ 200 chars.
- **No trailing period in headlines.**
- **No emoji.** Plain Unicode glyphs (`✓ ✗ → ▲`) are acceptable in CLI scaffolding but not inside the message body — severity is communicated by the `severity:` field.

## Adding a compile target

Transpilers live in their own package under `packages/`. Each exports a `transpile*` function that takes an IR tree and returns generated code. Register the target in `packages/core/src/targets.ts`.

## IR-semantics contracts

KERN's "semantic-spec moat" lives at `packages/core/src/ir/semantics/`. Each node type (`each`, `__trace`, `return`, `throw`, `break`, `continue`) has a `NodeContract` describing preconditions, observable trace effects, completion shapes, and fixtures the differential harness uses to prove TS↔Python parity by construction.

- `pnpm docs:contracts` — print contract summaries as Markdown to stdout (CI publishes the same to the job summary).
- `pnpm docs:contracts:json` — regenerate `generated/contracts/registry.json` (the only committed artifact; never hand-edit — Sight and external tooling consume it).
- `pnpm docs:contracts:check` — fail if `registry.json` drifts from the in-process generator. Wired into `pnpm lint`. Add `--fix` to write the regenerated content.
- `pnpm test:ir-semantics` — run only the harness tests (faster signal than the full suite for local iteration).

When you add or modify a contract:
1. Edit the contract source, add or update fixtures
2. Run `pnpm docs:contracts:check --fix` to regenerate `registry.json`
3. Commit the source change AND the regenerated JSON in the same commit
4. CI's drift check and the jest gate (`ir-semantics-contract-doc-drift.test.ts`) both fail loudly if you forget step 2

### Differential-harness burn-in

The `Differential harness (IR semantics)` CI step is non-blocking until **2026-05-31 (UTC)** — the 14-day soak during which we watch for flake and unexpected divergences before the harness becomes a hard gate. The deadline lives as a literal in `.github/workflows/ci.yml` (search for `BURNIN_UNTIL`) and auto-flips with zero human action on that date. After the flip, harness failures fail the build.

Escape hatch: the `KERN_SEMANTICS_GATE` repo variable. Set to `blocking` to flip early (e.g. 7 days of clean green); set to anything else to delay if the auto-flip arrives during a known-bad stretch. The workflow's `Enforce burn-in expiry` step prevents silent over-runs — once the date passes, you must explicitly opt out via the variable or the build fails.

## Reporting bugs

Use the [bug report template](https://github.com/KERNlang/kern/issues/new?template=bug_report.yml).

## Security

See [SECURITY.md](SECURITY.md). Do not open public issues for security vulnerabilities.

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0](LICENSE).
