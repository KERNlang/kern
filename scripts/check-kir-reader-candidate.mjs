import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

import {
  decodeKirReaderCandidate,
  encodeKirReaderCandidate,
} from '../packages/core/dist/kir-reader-candidate/canonical.js';
import { decodeCanonical, encodeCanonical } from './kir-seam-probe/canonical.mjs';
import { hostileModules } from './kir-seam-probe/fixtures.mjs';
import { projectModules } from './kir-seam-probe/project.mjs';

let checks = 0;
function check(name, run) {
  run();
  checks += 1;
  process.stdout.write(`✓ ${name}\n`);
}

const artifact = projectModules(hostileModules);
const probeBytes = encodeCanonical(artifact);

check('core reader is byte-identical to the selected R1.3 probe', () => {
  assert.equal(encodeKirReaderCandidate(artifact), probeBytes);
  assert.deepEqual(decodeKirReaderCandidate(probeBytes), decodeCanonical(probeBytes));
});

function mustFind(items, predicate, label) {
  const found = items.find(predicate);
  if (found === undefined) throw new Error(`Probe fixture is missing ${label}`);
  return found;
}

const mutations = [
  ['unknown format', (copy) => { copy.format = 'kern.semantic-kir.v1'; }],
  ['extra envelope field', (copy) => { copy.surprise = true; }],
  ['unknown node kind', (copy) => { copy.modules[0].nodes[0].kind = 'class'; }],
  ['unknown value tag', (copy) => { copy.modules[0].nodes[0].properties[0].value.tag = 'host-object'; }],
  ['wrong semantic property tag', (copy) => {
    mustFind(copy.modules[0].nodes[0].properties, (entry) => entry.key === 'export', 'export property').value = { tag: 'text', value: 'true' };
  }],
  ['wrong expression field tag', (copy) => {
    mustFind(requireExpressionKind(copy, 'binary').fields, (entry) => entry.key === 'operator', 'operator field').value = { tag: 'bool', value: true };
  }],
  ['non-function module root', (copy) => { copy.modules[0].nodes[0] = structuredClone(copy.modules[0].nodes[0].children.at(-1)); }],
  ['param after handler', (copy) => { copy.modules[0].nodes[0].children.reverse(); }],
  ['duplicate handler', (copy) => {
    const handler = copy.modules[0].nodes[0].children.find((child) => child.kind === 'handler');
    copy.modules[0].nodes[0].children.push(structuredClone(handler));
  }],
  ['unsafe integer', (copy) => {
    const value = requireTagged(copy, 'decimal');
    value.tag = 'int';
    value.value = '9007199254740992';
  }],
  ['noncanonical decimal', (copy) => { requireTagged(copy, 'decimal').value = '01.0'; }],
  ['invalid regex', (copy) => { requireTagged(copy, 'regex').value.pattern = '['; }],
  ['duplicate semantic key', (copy) => {
    const properties = copy.modules[0].nodes[0].properties;
    properties.push(structuredClone(properties[0]));
  }],
  ['invalid location', (copy) => { copy.modules[0].nodes[0].location.start.line = 0; }],
  ['reversed location', (copy) => {
    copy.modules[0].nodes[0].location.start = { line: 2, column: 1 };
    copy.modules[0].nodes[0].location.end = { line: 1, column: 1 };
  }],
  ['invalid identifier', (copy) => {
    mustFind(copy.modules[0].nodes[0].properties, (entry) => entry.key === 'name', 'name property').value.value = 'not valid';
  }],
  ['missing node property', (copy) => {
    copy.modules[0].nodes[0].properties = copy.modules[0].nodes[0].properties.filter((entry) => entry.key !== 'name');
  }],
  ['missing expression field', (copy) => {
    const binary = requireExpressionKind(copy, 'binary');
    binary.fields = binary.fields.filter((entry) => entry.key !== 'right');
  }],
  ['missing module', (copy) => { copy.modules[1].imports[0].source = 'missing.kern'; }],
  ['missing export', (copy) => { copy.modules[1].imports[0].bindings[0].imported = 'absent'; }],
  ['wrong import kind', (copy) => { copy.modules[1].imports[0].bindings[0].kind = 'class'; }],
  ['wrong re-export kind', (copy) => {
    mustFind(copy.modules[1].exports, (item) => item.name === 'twice', 'twice export').kind = 'class';
  }],
  ['duplicate export', (copy) => { copy.modules[1].exports.push(structuredClone(copy.modules[1].exports[0])); }],
  ['fake local export', (copy) => { copy.modules[0].exports.unshift({ name: 'absent', kind: 'fn', source: null }); }],
  ['detached re-export', (copy) => { copy.modules[1].imports = []; }],
  ['exports out of order', (copy) => { copy.modules[1].exports.reverse(); }],
  ['diagnostics out of order', (copy) => {
    const location = { start: { line: 1, column: 1 }, end: null };
    copy.diagnostics = [
      { module: 'main.kern', code: 'Z_CODE', severity: 'warning', category: 'parser', message: 'z', location },
      { module: 'main.kern', code: 'A_CODE', severity: 'warning', category: 'parser', message: 'a', location },
    ];
  }],
  ['duplicate local binding', (copy) => { copy.modules[1].imports[0].bindings[0].local = 'main'; }],
  ['module cycle', (copy) => {
    copy.modules[0].imports.push({
      source: 'main.kern',
      bindings: [{ imported: 'main', local: 'mainFromRoot', kind: 'fn', reexport: false }],
    });
  }],
  ['drive-qualified module', (copy) => { copy.modules[0].id = 'C:/lib/math.kern'; }],
  ['drive-relative module', (copy) => { copy.modules[0].id = 'C:lib/math.kern'; }],
  ['dangling diagnostic', (copy) => {
    copy.diagnostics = [{
      module: 'missing.kern',
      code: 'E_MISSING',
      severity: 'error',
      category: 'parser',
      message: 'missing',
      location: { start: { line: 1, column: 1 }, end: null },
    }];
  }],
];

for (const [name, mutate] of mutations) {
  check(`core and probe both reject ${name}`, () => {
    const copy = structuredClone(artifact);
    mutate(copy);
    assert.throws(() => encodeCanonical(copy));
    assert.throws(() => encodeKirReaderCandidate(copy));
  });
}

check('reader rejects malformed and noncanonical bytes', () => {
  assert.throws(() => decodeKirReaderCandidate(JSON.stringify(artifact)), /terminal newline/u);
  assert.throws(() => decodeKirReaderCandidate(` ${probeBytes}`), /not canonical/u);
  assert.throws(() => decodeKirReaderCandidate('{]\n'), /invalid canonical JSON/u);
});

check('locale and timezone do not alter canonical bytes', () => {
  const digest = (env) => execFileSync(process.execPath, ['./scripts/kir-reader-candidate-digest.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(digest({ TZ: 'UTC', LANG: 'C' }), digest({ TZ: 'Pacific/Auckland', LANG: 'tr_TR.UTF-8' }));
});

check('candidate remains internal and dependency-isolated', () => {
  const packageJson = JSON.parse(readFileSync('packages/core/package.json', 'utf8'));
  assert.ok(packageJson.exports && typeof packageJson.exports === 'object', 'core package must declare exports');
  assert.equal(Object.keys(packageJson.exports).some((key) => key.includes('kir')), false);
  assert.doesNotMatch(JSON.stringify(packageJson.exports), /kir-reader-candidate/u);
  for (const barrel of ['packages/core/src/index.ts', 'packages/core/src/runner.ts', 'packages/core/src/runner-browser.ts']) {
    assert.doesNotMatch(readFileSync(barrel, 'utf8'), /kir-reader-candidate/u);
  }
  const files = readdirSync('packages/core/src/kir-reader-candidate', { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => entry.name);
  for (const file of files) {
    const source = readFileSync(`packages/core/src/kir-reader-candidate/${file}`, 'utf8');
    for (const match of source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/gu)) {
      assert.match(match[1], /^\.\//u, `${file} imports only candidate-local modules`);
    }
    assert.doesNotMatch(source, /from\s+['"](?:node:|typescript)/u);
  }
});

process.stdout.write(`KIR reader candidate: ${checks}/${checks} checks passed.\n`);

function findTagged(value, tag) {
  if (value !== null && typeof value === 'object') {
    if (value.tag === tag) return value;
    for (const child of Object.values(value)) {
      const found = findTagged(child, tag);
      if (found) return found;
    }
  }
  return undefined;
}

function requireTagged(value, tag) {
  const found = findTagged(value, tag);
  if (found === undefined) throw new Error(`missing tagged value ${tag}`);
  return found;
}

function findExpressionKind(value, kind) {
  if (value !== null && typeof value === 'object') {
    if (value.tag === 'expression' && value.value?.kind === kind) return value.value;
    for (const child of Object.values(value)) {
      const found = findExpressionKind(child, kind);
      if (found) return found;
    }
  }
  return undefined;
}

function requireExpressionKind(value, kind) {
  const found = findExpressionKind(value, kind);
  if (found === undefined) throw new Error(`missing expression kind ${kind}`);
  return found;
}
