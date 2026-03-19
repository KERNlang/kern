# KERN Monorepo Rules

## Before Every Push

- **ALWAYS run `tsc -b && pnpm test && node packages/cli/dist/cli.js review packages/ --recursive --llm` before `git push`.** No exceptions. If any step fails, fix it before pushing. Never skip this.

## Build

- Build: `tsc -b` from root (NOT `pnpm -r build`). Root tsconfig.json has all project references.
- Playground builds separately: `pnpm --filter @kernlang/playground build`
- Never commit `tsconfig.tsbuildinfo` files — they are gitignored.

## Branching

- `dev` = daily work branch. Push here.
- `main` = release branch. Only merge via PR. CI must pass.
- Never push directly to main.

## Language

- TypeScript monorepo. Always run typecheck after changes.
- ESM throughout (`"type": "module"`).
- `moduleResolution: "bundler"` — package.json exports must include `types` field.
