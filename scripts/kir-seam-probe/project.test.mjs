import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseExpression, serializeIR } from '../../packages/core/dist/index.js';
import { encodeCanonical } from './canonical.mjs';
import { cycleModules, equivalentModules, hostileModules } from './fixtures.mjs';
import { projectExpression, projectModules } from './project.mjs';

test('candidate B projects typed modules, aliases, re-exports, capabilities, and hostile values', () => {
  const artifact = projectModules(hostileModules);
  assert.deepEqual(artifact.diagnostics, []);
  const main = artifact.modules.find((module) => module.id === 'main.kern');
  assert.deepEqual(main.imports[0], {
    source: 'lib/math.kern',
    bindings: [{ imported: 'double', local: 'twice', kind: 'fn', reexport: true }],
  });
  assert.deepEqual(main.exports.find((item) => item.name === 'twice'), { name: 'twice', kind: 'fn', source: 'lib/math.kern' });
  const statements = main.nodes[0].children[0].children;
  assert.equal(statements.at(-2).kind, 'capability');
  assert.equal(statements.at(-1).kind, 'print');

  const record = projectExpression(parseExpression('{"__proto__": 1, "constructor": 2, "😀": 3, "\uE000": 4}'));
  const recordEntries = record.value.fields.find((field) => field.key === 'entries').value.value;
  assert.deepEqual(recordEntries.map((entry) => entry.key), ['__proto__', 'constructor', '\uE000', '😀']);
  assert.equal(Object.prototype.polluted, undefined);
});

test('semantic variants and module input order produce identical bytes', () => {
  const expected = encodeCanonical(projectModules(hostileModules));
  assert.equal(encodeCanonical(projectModules(equivalentModules)), expected);
  assert.equal(encodeCanonical(projectModules([...hostileModules].reverse())), expected);
});

test('portable values preserve identity and host-specific expressions reject', () => {
  const cases = [
    ['0', 'integer'],
    ['-0', 'negative-zero'],
    ['9007199254740991', 'integer'],
    ['Decimal.of("1.50")', 'decimal'],
    ['/a+/ig', 'regex'],
    ['[true, null, "é", "😀"]', 'list'],
    ['(x) => x + 1', 'lambda'],
  ];
  for (const [source, kind] of cases) assert.equal(projectExpression(parseExpression(source)).value.kind, kind);
  for (const source of ['9007199254740992', '1.5', 'new Box()', 'typeof value', '(x) => { return x; }']) {
    assert.throws(() => projectExpression(parseExpression(source)));
  }
  assert.throws(() => projectExpression({
    kind: 'lambda',
    params: [{ name: 'x', rest: true }],
    body: { kind: 'ident', name: 'x' },
    parenthesized: true,
  }), /extended lambda parameters/u);
});

test('module linker rejects missing targets, missing exports, duplicates, and cycles deterministically', () => {
  assert.throws(() => projectModules([{ id: 'main.kern', source: 'use path="./missing"\n  from name=x kind=fn\n' }]), /missing import target/u);
  assert.throws(() => projectModules([
    { id: 'main.kern', source: 'use path="./lib"\n  from name=missing kind=fn\n' },
    { id: 'lib.kern', source: 'fn name=present returns=void export=true\n  handler lang="kern"\n' },
  ]), /missing export/u);
  assert.throws(() => projectModules([
    { id: 'main.kern', source: 'use path="./lib"\n  from name=privateHelper kind=fn\n' },
    { id: 'lib.kern', source: 'fn name=privateHelper returns=void\n  handler lang="kern"\n' },
  ]), /missing export privateHelper/u);
  assert.throws(() => projectModules([
    { id: 'main.kern', source: 'use path="./lib"\n  from name=present kind=class\n' },
    { id: 'lib.kern', source: 'fn name=present returns=void export=true\n  handler lang="kern"\n' },
  ]), /expected kind class but found fn/u);
  assert.throws(() => projectModules([hostileModules[0], hostileModules[0]]), /duplicate module id/u);
  assert.throws(() => projectModules(cycleModules), /module cycle: a.kern -> b.kern -> a.kern/u);
  assert.throws(() => projectModules([{ id: 'C:\\tmp\\main.kern', source: '' }]), /drive-qualified/u);
  assert.throws(() => projectModules([{ id: 'C:/tmp/main.kern', source: '' }]), /drive-qualified/u);
  assert.throws(() => projectModules([
    {
      id: 'main.kern',
      source: 'use path="./lib"\n  from name=double kind=fn as=main export=true\nfn name=main returns=void export=true\n  handler lang="kern"\n',
    },
    { id: 'lib.kern', source: hostileModules[0].source },
  ]), /duplicate local import binding main/u);
  assert.throws(() => projectModules([
    {
      id: 'main.kern',
      source: 'use path="./a"\n  from name=a kind=fn as=same\nuse path="./b"\n  from name=b kind=fn as=same\n',
    },
    { id: 'a.kern', source: 'fn name=a returns=void export=true\n  handler lang="kern"\n' },
    { id: 'b.kern', source: 'fn name=b returns=void export=true\n  handler lang="kern"\n' },
  ]), /duplicate local import binding same/u);
  assert.throws(() => projectModules([
    {
      id: 'main.kern',
      source: 'use path="./lib"\n  from name=present kind=fn as=main\nfn name=main returns=void\n  handler lang="kern"\n',
    },
    { id: 'lib.kern', source: 'fn name=present returns=void export=true\n  handler lang="kern"\n' },
  ]), /duplicate local import binding main/u);
});

test('unknown source properties fail closed and import declaration order canonicalizes', () => {
  assert.throws(() => projectModules([{
    id: 'main.kern',
    source: 'fn name=main returns=void unknown=abc\n  handler lang="kern"\n',
  }]), /property unknown is outside the fn probe schema/u);
  assert.throws(() => projectModules([{
    id: 'main.kern',
    source: 'fn name=main returns=void\n  handler lang="kern" unknown=abc\n',
  }]), /property unknown is outside the handler probe schema/u);

  const dependencies = [
    { id: 'a.kern', source: 'fn name=a returns=void export=true\n  handler lang="kern"\n' },
    { id: 'b.kern', source: 'fn name=b returns=void export=true\n  handler lang="kern"\n' },
  ];
  const first = {
    id: 'main.kern',
    source: 'use path="./a"\n  from name=a kind=fn\nuse path="./b"\n  from name=b kind=fn\nfn name=main returns=void\n  handler lang="kern"\n',
  };
  const second = {
    id: 'main.kern',
    source: 'use path="./b"\n  from name=b kind=fn\nuse path="./a"\n  from name=a kind=fn\nfn name=main returns=void\n  handler lang="kern"\n',
  };
  assert.equal(encodeCanonical(projectModules([first, ...dependencies])), encodeCanonical(projectModules([second, ...dependencies])));
});

test('parser diagnostics and raw host payloads fail before semantic projection', () => {
  assert.throws(() => projectModules([{
    id: 'main.kern',
    source: 'fn name=main returns=void\n  handler lang="kern"\n    return value=value * 2\n',
  }]), /parser diagnostic UNEXPECTED_TOKEN/u);
  assert.throws(() => projectModules([{
    id: 'main.kern',
    source: 'fn name=main returns=void expr="new Box()"\n',
  }]), /rawExpr payload is outside portable semantic KIR/u);
  assert.throws(() => projectModules([{
    id: 'main.kern',
    source: 'fn name=main returns=void\n  handler lang="kern" code="console.log(1)"\n',
  }]), /rawBlock payload is outside portable semantic KIR/u);
  assert.throws(() => projectModules([{
    id: 'main.kern',
    source: 'fn name=main returns=void\n  handler lang="kern"\n    capability namespace=fs operation=readText name=body input="new Box()"\n',
  }]), /new is outside portable semantic KIR/u);
});

test('fresh subprocesses are deterministic across timezone and locale variants', () => {
  const digests = [
    { TZ: 'UTC', LANG: 'C' },
    { TZ: 'Europe/Zurich', LANG: 'en_US.UTF-8' },
    { TZ: 'Pacific/Auckland', LANG: 'C.UTF-8' },
  ].map((variant) => {
    const result = spawnSync(process.execPath, ['scripts/kir-seam-probe/digest-fixture.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, ...variant },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  });
  assert.equal(new Set(digests).size, 1);
  assert.match(digests[0], /^[a-f0-9]{64}$/u);
});

test('candidate A debug serializer and candidate C runner seam are executable rejects', () => {
  const first = { type: 'x', props: { a: 1, b: { nested: true } }, children: [] };
  const second = { type: 'x', props: { b: { nested: true }, a: 1 }, children: [] };
  assert.notEqual(serializeIR(first), serializeIR(second), 'candidate A follows insertion order');
  assert.match(serializeIR(first), /\[object Object\]/u, 'candidate A collapses structured props');

  const runner = readFileSync('packages/core/src/runner.ts', 'utf8');
  assert.match(runner, /interface LinkedModuleRecord/u);
  assert.match(runner, /ReadonlyMap<string, RunnerFunctionBinding>/u);
  assert.match(runner, /IRNode/u);
  assert.doesNotMatch(runner, /export interface LinkedModuleRecord/u);
});
