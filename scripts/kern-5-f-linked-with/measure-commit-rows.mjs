import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';

import { COMMIT_ROWS_FORMAT, COMMIT_TAGS, GATED_COMMIT_TAG } from './pins.mjs';

const SUITE = 'scripts/kern-5-f-linked-with';
const ROOT = new URL('../../', import.meta.url);

const files = readdirSync(new URL('./', import.meta.url))
  .filter((name) => name.endsWith('.test.mjs') && name !== 'commit-rows.test.mjs')
  .sort();

function childEnvironment() {
  const { NODE_TEST_CONTEXT: _context, ...rest } = process.env;
  return { ...rest, F_COMMIT_ROWS_CHILD: '1' };
}

// Rows that only turn green when the prior slices' own pins are moved, which is F2's whole content.
const F2_ROWS = new Set([
  'slice E reserves only the labels slice F leaves unspent',
  'the prior slice successor lists name the slice-F leaf',
]);

const byFile = new Map();
const green = new Set();
for (const file of files) {
  const child = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', '--test-concurrency=1', `${SUITE}/${file}`],
    { cwd: ROOT, encoding: 'utf8', env: childEnvironment(), maxBuffer: 64 * 1024 * 1024, timeout: 120 * 60 * 1000 },
  );
  const names = [];
  for (const match of child.stdout.matchAll(/^(ok|not ok) \d+ - (.+)$/gmu)) {
    const name = match[2].replace(/\s+#\s+(?:SKIP|TODO)\b.*$/iu, '').trim();
    if (name.startsWith(SUITE) || name.endsWith('.test.mjs')) continue;
    names.push(name);
    if (match[1] === 'ok') green.add(name);
  }
  byFile.set(file, names);
  const red = names.filter((name) => !green.has(name)).length;
  process.stdout.write(`${file}: rows=${names.length} green=${names.length - red} red=${red}\n`);
}

function classify(name) {
  if (F2_ROWS.has(name)) return 'F2';
  if (green.has(name)) return 'F0';
  return 'F1';
}

const rows = Object.fromEntries(COMMIT_TAGS.map((tag) => [tag, []]));
for (const names of byFile.values()) {
  for (const name of names) rows[classify(name)].push(name);
}
for (const tag of COMMIT_TAGS) rows[tag] = [...new Set(rows[tag])].sort();

const counts = Object.fromEntries(COMMIT_TAGS.map((tag) => [tag, rows[tag].length]));
const preceding = COMMIT_TAGS.filter((tag) => tag !== GATED_COMMIT_TAG).reduce((sum, tag) => sum + counts[tag], 0);

const document = {
  format: COMMIT_ROWS_FORMAT,
  abortCriterion: { cut: counts[GATED_COMMIT_TAG] > preceding, gated: counts[GATED_COMMIT_TAG], preceding },
  criteriaCount: 0,
  groups: {},
  rows,
};

const { specCriteria } = await import('./k0-support.mjs');
const { criteria, groups } = specCriteria();
document.criteriaCount = criteria.length;
const GROUP_FILES = {
  'F1 — `with`': [
    'behavior.test.mjs',
    'expansion.test.mjs',
    'fault.test.mjs',
    'metering.test.mjs',
    'python-deferral.test.mjs',
    'type-gate.test.mjs',
  ],
  'F2 — pins': ['compatibility.test.mjs', 'probe-matrix.test.mjs', 'reserved-labels.test.mjs'],
};
for (const group of groups) document.groups[group] = GROUP_FILES[group] ?? [];

writeFileSync(new URL('./commit-rows.json', import.meta.url), `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(counts)} preceding=${preceding} cut=${document.abortCriterion.cut}\n`);
process.stdout.write(`criteria=${document.criteriaCount} groups=${groups.length}\n`);
