#!/usr/bin/env node
/**
 * IR-semantics doc generator CLI — PR-5a.
 *
 * Loads the built `@kernlang/core` artifact, registers all contracts via
 * `registerAllContracts()`, and emits a serialised snapshot.
 *
 * Usage:
 *   node scripts/generate-ir-semantics-docs.mjs --format=markdown --out=-
 *   node scripts/generate-ir-semantics-docs.mjs --format=json --out=generated/contracts/registry.json
 *
 * Flags:
 *   --format=markdown|json   (required)
 *   --out=-|<path>           - means stdout; otherwise a relative-to-repo path
 *
 * Pre-condition: `pnpm build` must have run so `packages/core/dist/` is
 * current. CI runs build before this script via the existing pipeline.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = { format: null, out: null };
  for (const arg of argv) {
    if (arg.startsWith('--format=')) out.format = arg.slice('--format='.length);
    else if (arg.startsWith('--out=')) out.out = arg.slice('--out='.length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (out.format !== 'markdown' && out.format !== 'json') {
    throw new Error(`--format must be 'markdown' or 'json', got: ${out.format ?? '<missing>'}`);
  }
  if (!out.out) throw new Error('--out is required (use "-" for stdout)');
  return out;
}

async function loadCore() {
  // PR-5 buddy-review fix (codex + gemini): use `pathToFileURL` so absolute
  // paths with backslashes / drive letters (Windows) or URL-significant
  // characters (`#`, `?`, spaces) are encoded correctly. Hand-rolled
  // `file://${path}` concatenation passes the path as the URL host on Windows.
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

async function main() {
  const { format, out } = parseArgs(process.argv.slice(2));
  const core = await loadCore();
  const { CONTRACT_REGISTRY, registerAllContracts, serializeJson, serializeMarkdown } = core;
  CONTRACT_REGISTRY.clear();
  registerAllContracts();
  const text = format === 'json' ? serializeJson(CONTRACT_REGISTRY) : serializeMarkdown(CONTRACT_REGISTRY);
  if (out === '-') {
    process.stdout.write(text);
    return;
  }
  const absOut = path.isAbsolute(out) ? out : path.join(REPO_ROOT, out);
  mkdirSync(path.dirname(absOut), { recursive: true });
  writeFileSync(absOut, text);
}

main().catch((err) => {
  console.error(`[generate-ir-semantics-docs] ${err.message}`);
  process.exit(1);
});
