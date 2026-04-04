# Contributing to KERN

Thanks for your interest in contributing to KERN.

## Setup

```bash
git clone https://github.com/KERNlang/kern.git
cd kern
pnpm install
pnpm build
pnpm test
```

**Requirements:** Node.js 22+, pnpm 9+, Python 3.12+ (for FastAPI transpiler tests)

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
| `packages/review` | Static analysis engine (76 rules, taint tracking) |
| `packages/review-mcp` | MCP server security scanner |
| `packages/react` | Next.js / React / Tailwind transpilers |
| `packages/vue` | Vue 3 / Nuxt 3 transpilers |
| `packages/express` | Express backend transpiler |
| `packages/fastapi` | FastAPI Python transpiler |

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
