#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIXTURES } from './fixtures.mjs';
import { flattenFixture, kernStringLiteral } from './flatten.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_FILE = join(ROOT, 'examples', 'selfhost-validator', 'main.kern');

const ARRAY_KEYS = [
  'moduleId',
  'moduleRoot',
  'moduleStatus',
  'fnModule',
  'fnName',
  'fnReturns',
  'fnAsync',
  'fnStream',
  'fnHandlers',
  'fnParams',
  'fnExport',
  'paramFn',
  'paramName',
  'paramHasChildren',
  'paramHasValue',
  'paramHasDefault',
  'paramOptional',
  'paramVariadic',
  'classModule',
  'className',
  'classExtends',
  'classExport',
  'fieldClass',
  'fieldName',
  'memberClass',
  'memberKind',
  'memberName',
  'memberAsync',
  'memberStream',
  'memberStatic',
  'memberHandlers',
  'useModule',
  'usePath',
  'useTarget',
  'useCandidate',
  'fromUse',
  'fromName',
  'fromAs',
  'fromKind',
  'fromExport',
];

function literal(value) {
  if (typeof value === 'number') return String(value);
  return kernStringLiteral(String(value));
}

function emitArray(varName, values) {
  const lines = [`    let name=${varName} value="[]"`];
  for (const value of values) {
    lines.push(`    do value="${varName}.push(${literal(value)})"`);
  }
  return lines;
}

function emitFixtureBlock(fixture, index) {
  const rows = flattenFixture(fixture);
  const suffix = String(index);
  const lines = [`    # fixture: ${fixture.id} — ${fixture.why}`];
  for (const key of ARRAY_KEYS) {
    lines.push(...emitArray(`${key}${suffix}`, rows[key]));
  }
  const args = [
    String(rows.schemaVersion),
    ...ARRAY_KEYS.map((key) => `${key}${suffix}`),
  ].join(', ');
  lines.push(`    let name=results${suffix} value="validate(${args})"`);
  lines.push(`    for name=resultIndex${suffix} from=0 to="results${suffix}.length"`);
  lines.push(`      let name=verdict${suffix} value="results${suffix}[resultIndex${suffix}]"`);
  lines.push(`      fmt name=line${suffix} template="${fixture.id}|\${verdict${suffix}}"`);
  lines.push(`      print value="line${suffix}"`);
  lines.push('');
  return lines;
}

export function generateMainKern() {
  const header = [
    '# GENERATED FILE — do not hand-edit.',
    '# Regenerate with: node scripts/selfhost-validator/gen-fixtures-kern.mjs',
    '# Source of truth: scripts/selfhost-validator/fixtures.mjs.',
    '# The host side only parses sources, records raw rows, normalizes realpaths',
    '# to "/", and unrolls fixture arrays. All validator decisions happen in',
    '# examples/selfhost-validator/validator.kern.',
    '',
    'use path="./validator"',
    '  from name=validate kind=fn as=validate',
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
      console.error(`${OUT_FILE} is stale — run: node scripts/selfhost-validator/gen-fixtures-kern.mjs`);
      process.exit(1);
    }
    console.log('selfhost validator main.kern is up to date');
    return;
  }
  writeFileSync(OUT_FILE, generated);
  console.log(`wrote ${OUT_FILE} (${FIXTURES.length} fixtures)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
