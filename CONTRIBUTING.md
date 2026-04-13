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

## Adding a compile target

Transpilers live in their own package under `packages/`. Each exports a `transpile*` function that takes an IR tree and returns generated code. Register the target in `packages/core/src/targets.ts`.

## Reporting bugs

Use the [bug report template](https://github.com/KERNlang/kern/issues/new?template=bug_report.yml).

## Security

See [SECURITY.md](SECURITY.md). Do not open public issues for security vulnerabilities.

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0](LICENSE).
