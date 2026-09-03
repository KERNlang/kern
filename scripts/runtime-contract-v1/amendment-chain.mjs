import { createHash } from 'node:crypto';

export const AMENDMENT_FORMAT = 'kern.runtime.contract.amendment.v1';
export const AMENDMENT_DIRECTORY = 'scripts/runtime-contract-v1/amendments';
export const CHAIN_ANCHOR_FILE = 'chain-anchor.json';
export const CHAIN_ANCHOR_PATH = `${AMENDMENT_DIRECTORY}/${CHAIN_ANCHOR_FILE}`;

export const AMENDMENT_DIGEST_KEYS = Object.freeze({
  constitutionSha256: 'scripts/runtime-contract-v1/constitution.json',
  declarationSchemaSha256: 'scripts/runtime-contract-v1/public-declaration-schema.json',
  goldensSha256: 'scripts/runtime-contract-v1/goldens.json',
  proofInventorySha256: 'scripts/runtime-contract-v1/proof-inventory.json',
});

const DIGEST_KEY_ORDER = Object.freeze(Object.keys(AMENDMENT_DIGEST_KEYS).sort());
const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/gu;

export function fail(message) {
  throw new Error(`runtime contract amendment: ${message}`);
}

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export const equalDigests = (left, right) => DIGEST_KEY_ORDER.every((key) => left[key] === right[key]);

export function validateDigests(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  if (Object.keys(value).sort().join(',') !== DIGEST_KEY_ORDER.join(',')) {
    fail(`${label} must carry exactly the pinned artifact digests`);
  }
  for (const [key, item] of Object.entries(value)) {
    if (!SHA256.test(item)) fail(`${label}.${key} is not a SHA-256 digest`);
  }
}

export function validateAmendmentRecord(record, seen, file) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail(`${file} must be a record`);
  if (record.format !== AMENDMENT_FORMAT) fail(`${file} has the wrong format`);
  if (typeof record.slice !== 'string' || record.slice.length === 0) fail(`${file} carries no slice`);
  if (seen.has(record.slice)) fail(`duplicate amendment slice ${record.slice}`);
  seen.add(record.slice);
  if (record.disposition !== 'additive') fail(`${record.slice} is not an additive amendment`);
  if (!Array.isArray(record.rowsChanged) || record.rowsChanged.length === 0 ||
      record.rowsChanged.some((row) => typeof row !== 'string' || row.length === 0) ||
      new Set(record.rowsChanged).size !== record.rowsChanged.length) {
    fail(`${record.slice} has invalid changed rows`);
  }
  const expected = ['disposition', 'format', 'parentDigests', 'rowsChanged', 'slice'];
  if (record.resultDigests !== undefined) expected.push('resultDigests');
  const actual = Object.keys(record).sort();
  if (actual.join(',') !== expected.sort().join(',')) fail(`${record.slice} carries unexpected fields`);
  validateDigests(record.parentDigests, `${record.slice}.parentDigests`);
  if (record.resultDigests !== undefined) validateDigests(record.resultDigests, `${record.slice}.resultDigests`);
}

export function amendmentFileNames(names) {
  return names.filter((name) => name.endsWith('.json') && name !== CHAIN_ANCHOR_FILE).sort();
}

export function loadAmendmentRecords({ listFiles, readJson }) {
  const seen = new Set();
  return amendmentFileNames(listFiles()).map((name) => {
    const file = `${AMENDMENT_DIRECTORY}/${name}`;
    const record = readJson(file);
    validateAmendmentRecord(record, seen, file);
    return { file, record };
  });
}

export function composeAmendmentChain({ anchor, entries }) {
  validateDigests(anchor, 'chain anchor');
  const results = entries.filter(({ record }) => record.resultDigests !== undefined);
  const roots = entries.filter(({ record }) => !results.some(({ record: other }) =>
    equalDigests(other.resultDigests, record.parentDigests)));
  if (entries.length > 0 && roots.length !== 1) fail('amendment chain must have exactly one genesis edge');
  const consumed = [];
  const pendingRepins = [];
  const rowsChanged = [];
  const states = [anchor];
  const visited = new Set();
  let current = roots[0];
  if (current && !equalDigests(current.record.parentDigests, anchor)) fail('amendment chain is not genesis-anchored');
  while (current) {
    if (visited.has(current.file)) fail('amendment chain cycles');
    visited.add(current.file);
    const { record } = current;
    if (record.resultDigests === undefined) {
      pendingRepins.push(record.slice);
      break;
    }
    for (const row of record.rowsChanged) if (!rowsChanged.includes(row)) rowsChanged.push(row);
    consumed.push(record.slice);
    states.push(record.resultDigests);
    const next = entries.filter(({ record: candidate }) => equalDigests(candidate.parentDigests, record.resultDigests));
    if (next.length > 1) fail(`amendment chain forks after ${record.slice}`);
    current = next[0];
  }
  if (visited.size !== entries.length) fail('amendment chain carries an orphaned edge');
  return { consumed, pendingRepins, rowsChanged, states, terminal: states.at(-1) };
}

function canonical(value) {
  return JSON.stringify(value);
}

function tokensOf(text) {
  return new Set(text.match(IDENTIFIER) ?? []);
}

function elementToken(element) {
  if (typeof element === 'string') return element;
  if (element && typeof element === 'object' && typeof element.id === 'string') return element.id;
  return null;
}

function keyedById(items) {
  if (!items.every((item) => item && typeof item === 'object' && typeof item.id === 'string')) return null;
  const ids = items.map((item) => item.id);
  if (new Set(ids).size !== ids.length) return null;
  return new Map(items.map((item) => [item.id, item]));
}

function lineChanges(parent, child) {
  const before = parent.split('\n');
  const after = child.split('\n');
  const table = Array.from({ length: before.length + 1 }, () => new Array(after.length + 1).fill(0));
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      table[left][right] = before[left] === after[right]
        ? table[left + 1][right + 1] + 1
        : Math.max(table[left + 1][right], table[left][right + 1]);
    }
  }
  const changed = [];
  let left = 0;
  let right = 0;
  while (left < before.length && right < after.length) {
    if (before[left] === after[right]) {
      left += 1;
      right += 1;
    } else if (table[left + 1][right] >= table[left][right + 1]) {
      changed.push(before[left]);
      left += 1;
    } else {
      changed.push(after[right]);
      right += 1;
    }
  }
  changed.push(...before.slice(left), ...after.slice(right));
  return changed;
}

function collectChanges(parent, child, path, changes) {
  if (canonical(parent) === canonical(child)) return;
  if (typeof parent === 'string' && typeof child === 'string') {
    for (const line of lineChanges(parent, child)) {
      changes.push({ kind: 'text', path, tokens: tokensOf(line) });
    }
    return;
  }
  if (Array.isArray(parent) && Array.isArray(child)) {
    if (parent.length === child.length) {
      for (const [index, item] of parent.entries()) collectChanges(item, child[index], `${path}/${index}`, changes);
      return;
    }
    const before = keyedById(parent);
    const after = keyedById(child);
    if (before && after) {
      for (const [id, item] of before) {
        if (!after.has(id)) changes.push({ kind: 'removed', path, tokens: new Set([id]) });
        else collectChanges(item, after.get(id), `${path}/${id}`, changes);
      }
      for (const [id] of after) {
        if (!before.has(id)) changes.push({ kind: 'added', path, tokens: new Set([id]) });
      }
      return;
    }
    const beforeItems = parent.map((item) => canonical(item));
    const afterItems = child.map((item) => canonical(item));
    for (const [index, item] of parent.entries()) {
      if (afterItems.includes(beforeItems[index])) continue;
      const token = elementToken(item);
      changes.push({ kind: 'removed', path, tokens: token === null ? tokensOf(beforeItems[index]) : new Set([token]) });
    }
    for (const [index, item] of child.entries()) {
      if (beforeItems.includes(afterItems[index])) continue;
      const token = elementToken(item);
      changes.push({ kind: 'added', path, tokens: token === null ? tokensOf(afterItems[index]) : new Set([token]) });
    }
    return;
  }
  const objects = (value) => value && typeof value === 'object' && !Array.isArray(value);
  if (objects(parent) && objects(child)) {
    for (const key of Object.keys(parent)) {
      if (!Object.hasOwn(child, key)) changes.push({ kind: 'removed', path, tokens: new Set([key]) });
      else collectChanges(parent[key], child[key], `${path}/${key}`, changes);
    }
    for (const key of Object.keys(child)) {
      if (!Object.hasOwn(parent, key)) changes.push({ kind: 'added', path, tokens: new Set([key]) });
    }
    return;
  }
  const key = path.split('/').at(-1) ?? path;
  changes.push({ kind: 'modified', path, tokens: new Set([key]) });
}

export function amendmentArtifactChanges(parentTexts, childTexts) {
  const changes = [];
  for (const artifact of Object.values(AMENDMENT_DIGEST_KEYS)) {
    const parent = parentTexts[artifact];
    const child = childTexts[artifact];
    if (parent === undefined || child === undefined) fail(`${artifact} bytes are unavailable for the amendment delta`);
    if (parent === child) continue;
    collectChanges(JSON.parse(parent), JSON.parse(child), artifact, changes);
  }
  return changes;
}

export function assertRowsExplainDelta({ rows, parentTexts, childTexts }) {
  const changes = amendmentArtifactChanges(parentTexts, childTexts);
  const terminals = new Map(rows.map((row) => [row, row.split('.').at(-1)]));
  const explained = new Set();
  for (const change of changes) {
    const matched = [...terminals].filter(([, terminal]) => change.tokens.has(terminal));
    if (matched.length === 0) fail(`${change.path} ${change.kind} a change no declared row explains`);
    if (change.kind === 'removed') fail(`${change.path} removes ${[...change.tokens].join(',')}, which is not additive`);
    for (const [row] of matched) explained.add(row);
  }
  for (const row of rows) {
    if (!explained.has(row)) fail(`${row} is declared but no artifact change explains it`);
  }
  return changes;
}
