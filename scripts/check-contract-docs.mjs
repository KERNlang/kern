#!/usr/bin/env node
/**
 * Contract-doc drift check — PR-5a.
 *
 * Regenerates `generated/contracts/registry.json` and exits non-zero if the
 * regenerated content differs from what's committed. Mirrors the
 * `check-rule-coverage.mjs` shape so contributors recognise the failure
 * mode (run a local fix command, re-commit).
 *
 * Usage:
 *   node scripts/check-contract-docs.mjs        # fail on drift
 *   node scripts/check-contract-docs.mjs --fix  # write current registry, exit 0
 *
 * Wired into `pnpm lint` adjacent to `check:rule-coverage` so the gate fires
 * BEFORE jest in CI (cheaper signal earlier in the pipeline).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_PATH = path.join(REPO_ROOT, 'generated/contracts/registry.json');

async function loadCore() {
  // PR-5 buddy-review fix (codex + gemini): pathToFileURL for cross-platform
  // safety; raw concatenation breaks on Windows.
  const url = pathToFileURL(path.join(REPO_ROOT, 'packages/core/dist/index.js'));
  try {
    return await import(url.href);
  } catch (err) {
    throw new Error(
      `Failed to load @kernlang/core from packages/core/dist/index.js. ` +
        `Run \`pnpm build\` first. Underlying: ${err.message}`,
    );
  }
}

async function regenerate() {
  const core = await loadCore();
  const { CONTRACT_REGISTRY, registerAllContracts, serializeJson } = core;
  CONTRACT_REGISTRY.clear();
  registerAllContracts();
  return serializeJson(CONTRACT_REGISTRY);
}

async function main() {
  const fix = process.argv.includes('--fix');
  const fresh = await regenerate();

  if (fix) {
    // PR-5 buddy-review fix (codex + gemini): ensure parent dir exists so
    // `--fix` on a fresh clone (or after `rm -rf generated/`) doesn't ENOENT.
    mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
    writeFileSync(REGISTRY_PATH, fresh);
    console.log(`[check-contract-docs] wrote ${path.relative(REPO_ROOT, REGISTRY_PATH)}`);
    return;
  }

  if (!existsSync(REGISTRY_PATH)) {
    console.error(
      `[check-contract-docs] ${path.relative(REPO_ROOT, REGISTRY_PATH)} is missing. ` +
        `Run \`pnpm docs:contracts:check --fix\` to regenerate.`,
    );
    process.exit(1);
  }

  const onDisk = readFileSync(REGISTRY_PATH, 'utf-8');
  if (onDisk !== fresh) {
    console.error(
      `[check-contract-docs] ${path.relative(REPO_ROOT, REGISTRY_PATH)} is out of date.\n` +
        `Run \`pnpm docs:contracts:check --fix\` to regenerate, then commit the result.`,
    );
    process.exit(1);
  }

  console.log(`[check-contract-docs] registry.json is up to date`);
}

main().catch((err) => {
  console.error(`[check-contract-docs] ${err.message}`);
  process.exit(1);
});
