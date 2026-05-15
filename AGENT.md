# KERN — Agent Instructions

## Repo Rules

- `package.json` `packageManager` is the pnpm source of truth.
- Use Corepack to activate pnpm.
- Never reintroduce `pnpm/action-setup`.
- Never use `cache: 'pnpm'` in `actions/setup-node`.
- Treat `Release Preflight` as mandatory before release.
- Release tags must be lowercase `vX.Y.Z`.
- For Claude code reviews, pin the Claude CLI to `--model claude-opus-4-7`; do not rely on the default `claude` model alias.
- Final code review should use Agon reviewers when available: `claude`, `gemini`, `kimi-for-coding-k2p6`, and `minimax-coding-plan-minimax-m2.7-highspeed`. Invoke Agon through Node 22 when the shell `agon` launcher is on Node 20: `/Users/nicolascukas/.nvm/versions/node/v22.22.0/bin/node /Users/nicolascukas/.nvm/versions/node/v22.22.0/bin/agon review --engines claude,gemini,kimi-for-coding-k2p6,minimax-coding-plan-minimax-m2.7-highspeed commit:<sha>`.
- Do not run Agon with the ambient lower Node runtime. Some dependencies use modern import-attributes syntax that fails under Node 20; use `/Users/nicolascukas/.nvm/versions/node/v22.22.0/bin/node` explicitly for Agon commands unless `node --version` is already Node 22+ in that shell.
- Use Agon `brainstorm`, `forge`, and `tribunal` for large or ambiguous design/implementation work when extra perspectives help. If Agon fails or behaves oddly, preserve the exact command, engine IDs, Node version/path, review target or SHA, and failure output in the final report so the CLI can be improved.

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
