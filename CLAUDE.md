# KERN — Claude Instructions

## Core Operating Rules

- Treat `package.json` `packageManager` as the source of truth for the pnpm version.
- Activate pnpm with Corepack, not `pnpm/action-setup`.
- Do not add `cache: 'pnpm'` to `actions/setup-node`.
- **Never push to `main` locally.** Releases happen via GitHub merge (PR merged into `main` through the GitHub UI). Claude does not run `git push origin main`, `git checkout main && git merge`, or any local main-mutating flow.
- Release Preflight + tagging is run from `main` *after* the merge has landed on GitHub — and the user drives that step, not Claude, unless explicitly asked.
- Use plain semver like `3.2.4` for preflight input.
- Publish GitHub Releases with lowercase tags like `v3.2.4`.
- **Whenever you edit any `package.json` `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies` / `peerDependenciesMeta` field — regenerate `pnpm-lock.yaml` in the SAME commit.** CI runs `pnpm install --frozen-lockfile`; a mismatched lockfile breaks every workflow on the branch with `ERR_PNPM_OUTDATED_LOCKFILE`. Use `pnpm install --ignore-scripts --no-frozen-lockfile` if the local tree-sitter native build is broken — `--ignore-scripts` skips postinstalls so the lockfile gets written even when a postinstall would otherwise crash. Always `git add pnpm-lock.yaml` alongside the `package.json` change. Never push a `package.json` dep change without the matching lockfile update.
- **Always run `pnpm lint` locally before pushing source changes.** Biome's format errors are blocking in CI (the lint job fails the run), so the only safe path is to catch them locally first. `scripts/install-git-hooks.mjs` installs a `pre-push` hook that runs `pnpm lint` automatically — the hook auto-installs via the `prepare` lifecycle on every `pnpm install`, so you don't need to remember. Bypass only with `git push --no-verify` when you truly need to (e.g. mid-rebase, throwaway branch).

## Pnpm Activation

Read the exact pnpm version from `package.json`, then activate that version:

```bash
corepack enable
corepack prepare pnpm@<version-from-packageManager> --activate
```

Current workflows and docs are expected to follow that same version.

## Safe Pnpm Upgrade Flow

When upgrading pnpm:

1. Update `package.json` `packageManager`.
2. Update any matching Corepack activation references in:
   - `.github/workflows/ci.yml`
   - `.github/workflows/release-pipeline.yml`
   - `README.md`
   - `CONTRIBUTING.md`
3. Regenerate the lockfile with the new pnpm:
   ```bash
   pnpm install --no-frozen-lockfile
   ```
4. Validate:
   ```bash
   npm run check:repo
   pnpm build
   pnpm test
   ```
5. Open a PR. Merge to `main` happens via the GitHub UI, not by Claude.
6. After the merge lands on `main`, the user runs `Release Preflight`.
7. Only then publish the GitHub Release.

## Architecture

See [docs/architecture.md](docs/architecture.md) for package roles and dependency boundaries.
