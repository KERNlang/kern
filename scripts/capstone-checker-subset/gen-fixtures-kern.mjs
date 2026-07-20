#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATA_ARRAYS, flattenKernSource, kernStringLiteral } from './flatten-kern.mjs';
import { FIXTURES, SAFE_INTEGER_TEXT_CASES } from './fixtures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_FILE = resolve(ROOT, 'examples/capstone-checker-subset/main.kern');
const NUMERIC_OUT_FILE = resolve(ROOT, 'examples/capstone-checker-subset/numeric-main.kern');

export function generateCheckerMainKern() {
  const lines = [
    '# GENERATED FILE - do not hand-edit.',
    '# Regenerate with: node scripts/capstone-checker-subset/gen-fixtures-kern.mjs',
    '# Source of truth: scripts/capstone-checker-subset/fixtures.mjs',
    '',
    'use path="./checker"',
    '  from name=checkModule kind=fn as=checkModule',
    '',
    'fn name=main returns=void',
    '  handler lang="kern"',
  ];

  FIXTURES.forEach((fixture, index) => {
    const flat = flattenKernSource(fixture.path, fixture.source());
    lines.push(`    # fixture: ${fixture.id}`);
    for (const [name, type] of DATA_ARRAYS) {
      emitArray(lines, `${name}${index}`, type, flat[name]);
    }
    const args = [
      kernStringLiteral(fixture.path),
      ...DATA_ARRAYS.map(([name]) => `${name}${index}`),
    ].join(', ');
    lines.push(`    let name=out${index} value="checkModule(${args})"`);
    lines.push(`    for name=i${index} from=0 to="out${index}.length"`);
    lines.push(`      print value="out${index}[i${index}]"`);
    lines.push('');
  });

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

export function generateNumericMainKern() {
  const lines = [
    '# GENERATED FILE - do not hand-edit.',
    '# Regenerate with: node scripts/capstone-checker-subset/gen-fixtures-kern.mjs',
    '# Source of truth: SAFE_INTEGER_TEXT_CASES in scripts/capstone-checker-subset/fixtures.mjs',
    '',
    'use path="./checker"',
    '  from name=isSafeIntText kind=fn as=isSafeIntText',
    '',
    'fn name=main returns=void',
    '  handler lang="kern"',
  ];
  SAFE_INTEGER_TEXT_CASES.forEach(([raw], index) => {
    lines.push(`    print value="${kernStringLiteral(`${index}:`)} + String(isSafeIntText(${kernStringLiteral(raw)}))"`);
  });
  return `${lines.join('\n')}\n`;
}

function emitArray(lines, name, type, values) {
  lines.push(`    let name=${name} value="[]"`);
  for (const value of values) {
    if (type === 'number') lines.push(`    do value="${name}.push(${Number(value)})"`);
    else lines.push(`    do value="${name}.push(${kernStringLiteral(value)})"`);
  }
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const generated = generateCheckerMainKern();
  const numericGenerated = generateNumericMainKern();
  if (checkOnly) {
    let onDisk = '';
    try {
      onDisk = readFileSync(OUT_FILE, 'utf8');
    } catch {
      // Missing file is drift.
    }
    if (onDisk !== generated) {
      console.error(`${OUT_FILE} is stale - run: node scripts/capstone-checker-subset/gen-fixtures-kern.mjs`);
      process.exit(1);
    }
    let numericOnDisk = '';
    try {
      numericOnDisk = readFileSync(NUMERIC_OUT_FILE, 'utf8');
    } catch {
      // Missing file is drift.
    }
    if (numericOnDisk !== numericGenerated) {
      console.error(`${NUMERIC_OUT_FILE} is stale - run: node scripts/capstone-checker-subset/gen-fixtures-kern.mjs`);
      process.exit(1);
    }
    console.log('capstone checker generated KERN fixtures are up to date');
    return;
  }
  writeFileSync(OUT_FILE, generated);
  writeFileSync(NUMERIC_OUT_FILE, numericGenerated);
  console.log(`wrote ${OUT_FILE} (${FIXTURES.length} fixtures) and ${NUMERIC_OUT_FILE}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
