#!/usr/bin/env node
/**
 * Generator for packages/core/src/eligibility-taxonomy.generated.ts.
 *
 * Grammar-sovereignty phase 2 (taxonomy AUTHORITY inversion). Reads the
 * human-edited source of truth `packages/core/src/eligibility-taxonomy.json`
 * and emits a committed TypeScript module exporting the taxonomy as a typed
 * `as const` literal:
 *
 *     export const ELIGIBILITY_TAXONOMY = { … } as const satisfies EligibilityTaxonomy;
 *
 * This kills the former runtime `node:fs` read + the dist→src URL rewrite in
 * eligibility-taxonomy.ts: the production loader now imports this const, so the
 * compiled `dist` carries the taxonomy as code (no JSON asset to resolve).
 *
 *   node scripts/generate-eligibility-taxonomy-module.mjs        # rewrite the .ts
 *   node scripts/generate-eligibility-taxonomy-module.mjs --check # fail if stale
 *
 * COMMIT the generated file (repo precedent: core's kern:check generated
 * files in src/generated). The JSON stays the editable source — re-run this to
 * re-stamp the module after editing the JSON (and re-run
 * scripts/build-eligibility-taxonomy.mjs first if the snapshot reason set
 * changed). A sync test in eligibility-taxonomy.test.ts pins the const to the
 * JSON so the two can never drift.
 *
 * The emitted bytes are run through biome (`biome format --stdin-file-path`)
 * so the on-disk module is byte-identical to what repo `pnpm format` produces
 * and `--check` stays green after a format pass — the script does not hand-roll
 * biome's line-wrapping.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const JSON_PATH = join(REPO, 'packages/core/src/eligibility-taxonomy.json');
const MODULE_PATH = join(REPO, 'packages/core/src/eligibility-taxonomy.generated.ts');

/** Quote a string as a valid TS literal via JSON.stringify (which escapes
 *  control characters, line separators, and backslashes correctly — a hand
 *  -rolled escaper missed those; agon review, codex 0.98), then convert to
 *  biome's preferred single quotes when that needs no extra escaping. */
function quote(value) {
  const json = JSON.stringify(value); // double-quoted, fully escaped
  const inner = json.slice(1, -1);
  // Safe to single-quote only when no single quote and no escape sequences
  // would change meaning: \" unescapes to ", ' must gain escaping.
  if (!value.includes("'")) {
    return `'${inner.replace(/\\"/g, '"')}'`;
  }
  return json;
}

/** Emit one taxonomy row as an object literal. Field order is fixed (construct,
 *  verdict, reason?, rationale, when?) so the output is deterministic and
 *  diff-friendly regardless of JSON key order. Indentation/line-wrapping is
 *  normalized by biome afterwards, so this only needs to be valid TS. */
function emitRow(row) {
  const lines = ['{'];
  lines.push(`construct: ${quote(row.construct)},`);
  lines.push(`verdict: ${quote(row.verdict)},`);
  if (row.reason !== undefined) lines.push(`reason: ${quote(row.reason)},`);
  lines.push(`rationale: ${quote(row.rationale)},`);
  if (row.when !== undefined) lines.push(`when: [${row.when.map(quote).join(', ')}],`);
  lines.push('},');
  return lines.join('\n');
}

/** Format raw TS through biome so the committed module is byte-identical to a
 *  repo `pnpm format` pass — `--check` then stays stable. Fails loud (the
 *  generator must never silently write unformatted bytes). */
function biomeFormat(rawSource) {
  const result = spawnSync('npx', ['biome', 'format', `--stdin-file-path=${MODULE_PATH}`], {
    cwd: REPO,
    input: rawSource,
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`biome format failed (status ${result.status}):\n${result.stderr ?? ''}`);
  }
  return result.stdout;
}

function buildModule() {
  const taxonomy = JSON.parse(readFileSync(JSON_PATH, 'utf-8'));
  const header = [
    '/** GENERATED — do not edit by hand.',
    ' *',
    ' *  Source of truth: packages/core/src/eligibility-taxonomy.json (human-edited).',
    ' *  Regenerate with: node scripts/generate-eligibility-taxonomy-module.mjs',
    ' *',
    ' *  Grammar-sovereignty phase 2 (taxonomy AUTHORITY inversion): this typed',
    ' *  `as const` is the PRODUCTION authority source the eligibility classifier',
    ' *  validates its emitted reason strings against — it replaced the former',
    " *  runtime `node:fs` JSON read. A sync test pins this const to the JSON. */",
    '',
    "import type { EligibilityTaxonomy } from './eligibility-taxonomy.js';",
    '',
    'export const ELIGIBILITY_TAXONOMY = {',
    `$schema: ${quote(taxonomy.$schema)},`,
    `description: ${quote(taxonomy.description)},`,
    'rows: [',
  ];
  const body = taxonomy.rows.map(emitRow);
  const footer = ['],', '} as const satisfies EligibilityTaxonomy;', ''];
  const raw = [...header, ...body, ...footer].join('\n');
  return biomeFormat(raw);
}

const serialized = buildModule();

if (process.argv.includes('--check')) {
  let onDisk;
  try {
    onDisk = readFileSync(MODULE_PATH, 'utf-8');
  } catch {
    console.error(`Missing generated module: ${MODULE_PATH}`);
    process.exit(1);
  }
  if (onDisk !== serialized) {
    console.error(
      'eligibility-taxonomy.generated.ts is out of date. Run: node scripts/generate-eligibility-taxonomy-module.mjs',
    );
    process.exit(1);
  }
  const rowCount = JSON.parse(readFileSync(JSON_PATH, 'utf-8')).rows.length;
  console.log(`eligibility-taxonomy.generated.ts is current (${rowCount} rows).`);
  process.exit(0);
}

writeFileSync(MODULE_PATH, serialized);
const rowCount = JSON.parse(readFileSync(JSON_PATH, 'utf-8')).rows.length;
console.log(`Wrote ${rowCount} taxonomy rows → ${MODULE_PATH}`);
