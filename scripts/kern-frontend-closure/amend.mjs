import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const AMENDMENTS = fileURLToPath(new URL('./amendments/', import.meta.url));
const LEDGER = 'scripts/kern-frontend-closure/closure-ledger.json';
const PINS = { 'scripts/kern-frontend-f5-projection/policy.json': 'composition' };

const digest = (path) => createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex');
const load = (path) => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));

function fail(detail) {
  throw new Error(`KERN frontend closure amendment: ${detail}`);
}

function checkAmendment(amendment, ledger) {
  if (amendment.format !== 'kern.frontend.closure-amendment.1') fail(`${amendment.id} format`);
  if (amendment.change !== 'additive') fail(`${amendment.id} is not an additive amendment`);
  if (amendment.parentClosureLedgerSha256 !== digest(LEDGER)) fail(`${amendment.id} parent ledger digest`);
  if (amendment.counts.nodes !== ledger.nodeClosure.count) fail(`${amendment.id} node count changed`);
  if (amendment.counts.properties !== ledger.propertyClosure.count) fail(`${amendment.id} property count changed`);
  const tally = new Map();
  for (const row of amendment.rows) {
    if (!(row.disposition in ledger.propertyClosure.dispositions)) fail(`${amendment.id} row ${row.stableKey}`);
    tally.set(row.disposition, (tally.get(row.disposition) ?? 0) + 1);
  }
  for (const [disposition, count] of tally) {
    if (count > ledger.propertyClosure.dispositions[disposition]) fail(`${amendment.id} claims unknown ${disposition} rows`);
  }
  if (new Set(amendment.rows.map((row) => row.stableKey)).size !== amendment.rows.length) fail(`${amendment.id} duplicate rows`);
}

export function plan() {
  const ledger = load(LEDGER);
  const claims = new Map();
  for (const name of readdirSync(AMENDMENTS).filter((entry) => entry.endsWith('.json'))) {
    const amendment = JSON.parse(readFileSync(resolve(AMENDMENTS, name), 'utf8'));
    checkAmendment(amendment, ledger);
    for (const entry of amendment.repin) {
      if (!(entry.pin in PINS)) fail(`${amendment.id} names unsupported pin ${entry.pin}`);
      if (claims.has(entry.path)) fail(`${entry.path} is claimed by more than one amendment`);
      claims.set(entry.path, { ...entry, id: amendment.id });
    }
  }
  const actions = [];
  for (const [pin, section] of Object.entries(PINS)) {
    for (const descriptor of load(pin)[section]) {
      const actual = digest(descriptor.path);
      if (actual === descriptor.sha256) continue;
      const claim = claims.get(descriptor.path);
      if (claim === undefined) fail(`${descriptor.path} drifted with no amendment naming it`);
      if (claim.pin !== pin) fail(`${claim.id} names ${descriptor.path} under a different pin`);
      if (claim.parentDigest !== descriptor.sha256) fail(`${claim.id} parent digest for ${descriptor.path} is stale`);
      actions.push({ actual, id: claim.id, path: descriptor.path, pin, section });
    }
  }
  return actions;
}

function main() {
  const actions = plan();
  if (!process.argv.includes('--write')) {
    console.log(`KERN frontend closure amendment: chain verified, ${actions.length} pending re-pin(s).`);
    return;
  }
  for (const pin of new Set(actions.map((action) => action.pin))) {
    let text = readFileSync(resolve(ROOT, pin), 'utf8');
    for (const action of actions.filter((candidate) => candidate.pin === pin)) {
      const previous = load(pin)[action.section].find(({ path }) => path === action.path).sha256;
      if (text.split(`"${previous}"`).length !== 2) fail(`${action.path} digest is not uniquely replaceable`);
      text = text.replace(`"${previous}"`, `"${action.actual}"`);
    }
    writeFileSync(resolve(ROOT, pin), text);
  }
  console.log(`KERN frontend closure amendment: re-pinned ${actions.length} entr(ies).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
