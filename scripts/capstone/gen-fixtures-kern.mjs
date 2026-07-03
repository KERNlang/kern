#!/usr/bin/env node
/**
 * Regenerates examples/capstone-assertion-engine/main.kern from the shared
 * fixture corpus (scripts/capstone/fixtures.mjs), mechanically (host-side):
 * flatten each fixture's `a`/`b` JSON value into parent-link rows
 * (scripts/capstone/flatten.mjs), then emit ONE unrolled per-fixture block
 * that builds the five flat arrays via `do <arr>.push(...)` statements (NOT
 * array literals — a negative-number array LITERAL element abstains under
 * the runner's portable-array-literal rule; `.push()` does not have that
 * restriction, see the file header note below) and calls `compareTrees`.
 *
 * Per-fixture blocks are UNROLLED rather than driven by a single generic
 * `for`/`each` loop over a fixture registry — see the header comment this
 * script writes into main.kern for the evidence-backed reason (passing an
 * already-indexed array read, e.g. `roots[f]`, as a function-call argument
 * does not propagate integer-index-provenance to the callee).
 *
 * This is the ONLY host-side logic in the pipeline: mechanical flattening +
 * mechanical .kern source emission. All comparison semantics stay in
 * sort.kern / diag.kern / compare.kern.
 *
 * Usage: node scripts/capstone/gen-fixtures-kern.mjs [--check]
 *   --check: exit 1 if the regenerated content differs from what's on disk
 *            (drift check), without writing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flattenJson, kernStringLiteral } from './flatten.mjs';
import { FIXTURES } from './fixtures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_FILE = join(ROOT, 'examples', 'capstone-assertion-engine', 'main.kern');

function emitArrayBuild(varName, values, toLiteral) {
  const lines = [];
  lines.push(`    let name=${varName} value="[]"`);
  for (const v of values) {
    lines.push(`    do value="${varName}.push(${toLiteral(v)})"`);
  }
  return lines;
}

function numLiteral(n) {
  // Safe for both non-negative and negative safe integers: `do value=".push(-1)"`
  // is a bare unary-minus EXPRESSION (not an array-literal element), which the
  // ReferenceRunner admits (only array-LITERAL `[...]` elements require a
  // canonical non-negative-looking numLit token; `.push(<expr>)` takes any
  // portable scalar expression).
  return String(n);
}

function strLiteral(s) {
  return kernStringLiteral(s);
}

/** Emit the five flat-array `let` + `do.push` blocks for one tree (A or B side). */
function emitTree(suffix, rows) {
  const lines = [];
  lines.push(...emitArrayBuild(`parentIdx${suffix}`, rows.map((r) => r.parentIdx), numLiteral));
  lines.push(...emitArrayBuild(`keyStr${suffix}`, rows.map((r) => r.keyStr), strLiteral));
  lines.push(...emitArrayBuild(`keyIdx${suffix}`, rows.map((r) => r.keyIdx), numLiteral));
  lines.push(...emitArrayBuild(`type${suffix}`, rows.map((r) => r.type), strLiteral));
  lines.push(...emitArrayBuild(`value${suffix}`, rows.map((r) => r.value), strLiteral));
  return lines;
}

function emitFixtureBlock(fixture, index) {
  const rowsA = flattenJson(fixture.a);
  const rowsB = flattenJson(fixture.b);
  const suffix = String(index);
  const lines = [];
  lines.push(`    # fixture: ${fixture.id}`);
  lines.push(...emitTree(`A${suffix}`, rowsA));
  lines.push(...emitTree(`B${suffix}`, rowsB));
  lines.push(
    `    let name=verdict${suffix} value="compareTrees(parentIdxA${suffix}, keyStrA${suffix}, keyIdxA${suffix}, typeA${suffix}, valueA${suffix}, parentIdxB${suffix}, keyStrB${suffix}, keyIdxB${suffix}, typeB${suffix}, valueB${suffix})"`,
  );
  lines.push(`    fmt name=line${suffix} template="${fixture.id}|\${verdict${suffix}}"`);
  lines.push(`    print value="line${suffix}"`);
  lines.push('');
  return lines;
}

export function generateMainKern() {
  const header = [
    '# GENERATED FILE — do not hand-edit.',
    '# Regenerate with: node scripts/capstone/gen-fixtures-kern.mjs',
    '# Source of truth for the embedded fixture data: scripts/capstone/fixtures.mjs',
    '# (flattened mechanically by scripts/capstone/flatten.mjs — see that file\'s',
    '# header for the parent-link row encoding). Every fixture block below is',
    '# UNROLLED (not driven by a generic for/each loop over a fixture registry):',
    '# passing an already-indexed array read (e.g. `roots[f]`) as a function-call',
    '# argument does not propagate the ReferenceRunner\'s integer-index-provenance',
    '# to the callee (confirmed empirically — see compare.kern\'s header note for',
    '# the sibling finding on `assign`), so each fixture keeps its OWN local flat',
    '# arrays with the root always at literal index 0 (inherently provenanced).',
    '',
    'use path="./compare"',
    '  from name=compareTrees kind=fn as=compareTrees',
    '',
    'fn name=main returns=void',
    '  handler lang="kern"',
  ];
  const body = FIXTURES.flatMap((fixture, index) => emitFixtureBlock(fixture, index));
  return `${[...header, ...body].join('\n').replace(/\n+$/, '')}\n`;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const generated = generateMainKern();
  if (checkOnly) {
    let onDisk = '';
    try {
      onDisk = readFileSync(OUT_FILE, 'utf-8');
    } catch {
      // missing file counts as drift
    }
    if (onDisk !== generated) {
      console.error(`${OUT_FILE} is stale — run: node scripts/capstone/gen-fixtures-kern.mjs`);
      process.exit(1);
    }
    console.log('capstone main.kern is up to date');
    return;
  }
  writeFileSync(OUT_FILE, generated);
  console.log(`wrote ${OUT_FILE} (${FIXTURES.length} fixtures)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
