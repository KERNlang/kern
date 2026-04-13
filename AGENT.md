# KERN — Agent Instructions

## Repo Rules

- `package.json` `packageManager` is the pnpm source of truth.
- Use Corepack to activate pnpm.
- Never reintroduce `pnpm/action-setup`.
- Never use `cache: 'pnpm'` in `actions/setup-node`.
- Treat `Release Preflight` as mandatory before release.
- Release tags must be lowercase `vX.Y.Z`.

## If You Need To Update pnpm

1. Change `package.json` `packageManager`.
2. Update the matching Corepack version in CI and release workflows plus repo docs.
3. Run:
   ```bash
   corepack enable
   corepack prepare pnpm@<version-from-packageManager> --activate
   pnpm install --no-frozen-lockfile
   npm run check:repo
   pnpm build
   pnpm test
   ```
4. Push to `main`, wait for green CI, run `Release Preflight`, then release.

## Architecture

See [docs/architecture.md](docs/architecture.md).
