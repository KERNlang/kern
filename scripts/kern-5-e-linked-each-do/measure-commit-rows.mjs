import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';

import { COMMIT_TAGS, GATED_COMMIT_TAG } from './pins.mjs';

const SUITE = 'scripts/kern-5-e-linked-each-do';
const ROOT = new URL('../../', import.meta.url);

const files = readdirSync(new URL('./', import.meta.url))
  .filter((name) => name.endsWith('.test.mjs') && name !== 'commit-rows.test.mjs')
  .sort();

function childEnvironment() {
  const { NODE_TEST_CONTEXT: _context, ...rest } = process.env;
  return { ...rest, E_COMMIT_ROWS_CHILD: '1' };
}

const byFile = new Map();
const GREEN_AT_BASE = new Set();
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
    if (match[1] === 'ok') GREEN_AT_BASE.add(name);
  }
  byFile.set(file, names);
  process.stdout.write(`${file}: ${names.length}\n`);
}

// Which commit turns each row green. A row that needs both new kinds belongs to the later commit.
const E1_ONLY = /(^|\b)do-(bare|sync-call|async-call|text-call|in-for|in-try|in-while|literal|identifier|binary|unary|member|member-call|list-literal|record-literal|json-parse|json-stringify|void-call|async-in-argument)\b/u;
const E3_ROWS = new Set([
  'the prior-slice STILL_OUTSIDE lists drop each and keep set',
  'the parity-ledger exhaustiveness table names all fourteen statement kinds',
  'rt10 amends neg-each to a positive and appends a new refusal row',
  'the ledger carries a do row and an each row, sorted, since kern-5-e',
  'every ledger row names a spec that exists, and the two new rows name this spec',
]);
function classify(file, name, green) {
  if (E3_ROWS.has(name)) return 'E3';
  if (green) return 'E0';
  if (name.includes('each')) return 'E2';
  if (E1_ONLY.test(name)) return 'E1';
  if (/\bdo\b/u.test(name)) return 'E1';
  return 'E2';
}

const rows = Object.fromEntries(COMMIT_TAGS.map((tag) => [tag, []]));
for (const [file, names] of byFile) {
  for (const name of names) rows[classify(file, name, GREEN_AT_BASE.has(name))].push(name);
}
for (const tag of COMMIT_TAGS) rows[tag] = [...new Set(rows[tag])].sort();

const counts = Object.fromEntries(COMMIT_TAGS.map((tag) => [tag, rows[tag].length]));
const preceding = COMMIT_TAGS.filter((tag) => tag !== GATED_COMMIT_TAG).reduce((sum, tag) => sum + counts[tag], 0);

const document = {
  format: 'kern.oracle.e-linked-each-do.commit-rows.v1',
  abortCriterion: {
    cut: counts[GATED_COMMIT_TAG] > preceding,
    gated: counts[GATED_COMMIT_TAG],
    preceding,
  },
  criteriaCount: 0,
  groups: {},
  rows,
};

const { specCriteria } = await import('./k0-support.mjs');
const { criteria, groups } = specCriteria();
document.criteriaCount = criteria.length;
const GROUP_FILES = {
  'E.0 — extraction (GREEN guards)': ['byte-identity.test.mjs', 'extraction.test.mjs', 'probe-matrix.test.mjs'],
  'E1 — `do`': ['behavior.test.mjs', 'metering.test.mjs', 'type-gate.test.mjs'],
  'E2 — `each`': ['behavior.test.mjs', 'metering.test.mjs', 'type-gate.test.mjs', 'walker-coverage.test.mjs'],
  'E3 — pins and ledger': ['compatibility.test.mjs', 'python-deferral.test.mjs', 'reserved-labels.test.mjs'],
};
for (const group of groups) document.groups[group] = GROUP_FILES[group] ?? [];

writeFileSync(new URL('./commit-rows.json', import.meta.url), `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(counts)} preceding=${preceding} cut=${document.abortCriterion.cut}\n`);
process.stdout.write(`criteria=${document.criteriaCount} groups=${groups.length}\n`);
