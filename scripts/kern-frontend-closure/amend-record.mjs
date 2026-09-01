export const PINS = { 'scripts/kern-frontend-f5-projection/policy.json': 'composition' };

const HEX = /^[a-f0-9]{64}$/u;

export function fail(detail) {
  throw new Error(`KERN frontend closure amendment: ${detail}`);
}

export function checkStructure(record, ledger, seen) {
  const { id } = record;
  if (typeof id !== 'string' || id.length === 0) fail('an amendment carries no id');
  if (seen.has(id)) fail(`duplicate amendment id ${id}`);
  seen.add(id);
  if (record.format !== 'kern.frontend.closure-amendment.1') fail(`${id} format`);
  if (record.change !== 'additive') fail(`${id} is not an additive amendment`);
  if (!Array.isArray(record.rows) || record.rows.length === 0) fail(`${id} declares no rows`);
  const keys = new Set();
  for (const { disposition, stableKey } of record.rows) {
    if (!Object.hasOwn(ledger.propertyClosure.dispositions, disposition)) fail(`${id} row ${stableKey}`);
    if (keys.has(stableKey)) fail(`${id} duplicate row ${stableKey}`);
    keys.add(stableKey);
  }
  if (!Array.isArray(record.addedSpellings) || record.addedSpellings.length === 0) fail(`${id} adds no spelling`);
  for (const { kirKind, source } of record.addedSpellings) {
    if (typeof source !== 'string' || typeof kirKind !== 'string') fail(`${id} spelling shape`);
  }
  if (!Array.isArray(record.repin) || record.repin.length === 0) fail(`${id} names no pin`);
  for (const { parentDigest, pin, resultDigest } of record.repin) {
    if (!Object.hasOwn(PINS, pin)) fail(`${id} names unsupported pin ${pin}`);
    if (!HEX.test(parentDigest)) fail(`${id} parent digest shape`);
    if (resultDigest !== undefined && !HEX.test(resultDigest)) fail(`${id} result digest shape`);
  }
}

export function checkLedger(record, ledger, ledgerDigest) {
  const { id } = record;
  if (record.parentClosureLedgerSha256 !== ledgerDigest) fail(`${id} parent ledger digest`);
  if (record.counts?.nodes !== ledger.nodeClosure.count) fail(`${id} node count changed`);
  if (record.counts?.properties !== ledger.propertyClosure.count) fail(`${id} property count changed`);
  const tally = new Map();
  for (const { disposition } of record.rows) tally.set(disposition, (tally.get(disposition) ?? 0) + 1);
  for (const [disposition, count] of tally) {
    if (count > ledger.propertyClosure.dispositions[disposition]) fail(`${id} claims unknown ${disposition} rows`);
  }
}
