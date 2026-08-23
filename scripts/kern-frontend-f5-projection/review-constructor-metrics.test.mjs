import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { __test, runProjection } from './worker.mjs';
import { decodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
import { listTape } from '../kern-frontend-f4-declarations/decoder.mjs';
import { runModuleSet } from '../kern-frontend-f4-declarations/worker.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CANONICAL_LIMITS = Object.freeze({
  maxBytes: 16_777_216, maxCollectionLength: 262_144, maxDecimalChars: 128, maxDepth: 256,
  maxFractionDigits: 64, maxIntegerDigits: 512, maxMapEntries: 262_144, maxNodes: 1_048_576,
  maxRecordFields: 262_144, maxStringBytes: 16_777_216,
});

function limited(expression) {
  return __test.runProjectionWithProfileLimits([{
    moduleId: 'scalar-limit.kern',
    source: `fn name=scalarLimit export=true\n  handler lang=kern\n    return value=${JSON.stringify(expression)}\n`,
  }], { maxStringCodePoints: 32 });
}

test('F5-R10 integer, decimal, text, and record-key scalars are constructor-owned', () => {
  const payload = '1'.repeat(50);
  const cases = [payload, `${payload}.1`, `"${'x'.repeat(50)}"`, `{${'k'.repeat(50)}: 1}`];
  for (const [index, expression] of cases.entries()) {
    const result = limited(expression);
    assert.equal(result.receipt.status, 'fatal', `scalar case ${index}`);
    assert.equal(result.receipt.diagnostics[0].code, 'F5_LIMIT', `scalar case ${index}`);
    assert.equal(result.bytes, null, `scalar case ${index}`);
  }
});

test('F5-R11 discard-only host validation errors are not converted into receipts', () => {
  const error = new TypeError('discard validator failure');
  error.name = 'StructuralKirError';
  assert.throws(() => __test.runProjectionWithValidator([
    { moduleId: 'validator.kern', source: 'fn name=valid export=true\n' },
  ], () => { throw error; }), (caught) => caught === error);
});

test('F5-R8/R9 source wall requires scalar frames and rejects post-hoc authorities', () => {
  const kernDirectory = resolve(ROOT, 'examples/kern-frontend');
  const kern = readdirSync(kernDirectory).filter((name) => /^f5-.*\.kern$/u.test(name))
    .map((name) => readFileSync(resolve(kernDirectory, name), 'utf8')).join('\n');
  const host = ['worker.mjs', 'decoder.mjs'].map((name) =>
    readFileSync(resolve(ROOT, 'scripts/kern-frontend-f5-projection', name), 'utf8')).join('\n');
  assert.match(kern, /\\u001f/u);
  assert.match(kern, /f5resultgate\(/u);
  assert.match(kern, /f5resultcommit\(/u);
  assert.doesNotMatch(`${kern}\n${host}`, /f5measureinstructions|measureInstructionStream/u);
  assert.doesNotMatch(host, /error\?\.name !== 'StructuralKirError'|instanceof StructuralKirError/u);
  assert.doesNotMatch(kern, /requiredNodes|requiredCollection|requiredString/u);
});

function duplicateLateRecordKey(modules) {
  const f4 = structuredClone(runModuleSet(modules));
  const rows = listTape(f4.documents[0].fields[14], 'expression evidence');
  const evidence = listTape(rows[0], 'expression evidence row');
  const receipt = listTape(evidence[8], 'F2 receipt');
  receipt[7] = receipt[7].replace('i1:zi1:a', 'i1:ai1:a');
  evidence[8] = receipt.map((value) => `i${Array.from(value).length}:${value}`).join('');
  rows[0] = evidence.map((value) => `i${Array.from(value).length}:${value}`).join('');
  f4.documents[0].fields[14] = rows.map((value) => `i${Array.from(value).length}:${value}`).join('');
  const fields = f4.documents[0].fields;
  const terminal = fields[16].split(':');
  fields[16] = `document:${fields[1]}:${Array.from(fields[4]).length}:${Array.from(fields[5]).length}:${Array.from(fields[6]).length}:${Array.from(fields[7]).length}:${Array.from(fields[8]).length}:${Array.from(fields[9]).length}:${Array.from(fields[10]).length}:${Array.from(fields[11]).length}:${Array.from(fields[12]).length}:${Array.from(fields[13]).length}:${Array.from(fields[14]).length}:${terminal.slice(13, 19).join(':')}:closed`;
  return f4;
}

test('F5-R11 later record drift beats an earlier child limit and charges the parent scan', () => {
  const modules = [{
    moduleId: 'precedence.kern',
    source: 'fn name=main export=true\n  handler lang=kern\n    return value="{z: 1, a: 2}"\n',
  }];
  const result = __test.runProjectionWithF4RunnerAndProfileLimits(
    modules, duplicateLateRecordKey, { maxStringCodePoints: 1 });
  assert.equal(result.receipt.status, 'fatal');
  assert.equal(result.receipt.diagnostics[0].code, 'F5_F4_DRIFT');
  assert.ok(result.receipt.workSteps > 1, 'failure includes child and parent scanning work');
});

test('F5-R10 source proves validate and numeric gate dominate composite materialization', () => {
  const source = readFileSync(resolve(ROOT, 'examples/kern-frontend/f5-composite-instructions.kern'), 'utf8');
  for (const name of ['f5list', 'f5record']) {
    const start = source.indexOf(`fn name=${name} `);
    const end = source.indexOf('\nfn name=', start + 1);
    const body = source.slice(start, end < 0 ? source.length : end);
    const gate = body.indexOf('f5resultgate(');
    assert.ok(gate > 0, `${name} has a numeric dry-run gate`);
    for (const materializer of ['parts.push', 'f5join(', 'f5resultcommit(']) {
      assert.ok(body.indexOf(materializer) > gate, `${name} gates before ${materializer}`);
    }
  }
  const frame = readFileSync(resolve(ROOT, 'examples/kern-frontend/f5-result-frame.kern'), 'utf8');
  assert.doesNotMatch(frame, /f5resultbody|assign target=frame/u);
});

test('F5-R12 module ordering work is deterministic and charged for every ordering operation', () => {
  const source = 'fn name=unit export=true\n';
  const ids = ['aa.kern', 'ab.kern', 'ac.kern', 'ad.kern'];
  const work = (order) => __test.runProjectionWithProfileLimits(
    order.map((moduleId) => ({ moduleId, source })), {}).receipt.workSteps;
  const sorted = work(ids);
  const reverse = work([...ids].reverse());
  const rotated = work([...ids.slice(1), ids[0]]);
  assert.ok(sorted > 0);
  assert.equal(reverse - sorted, 6, 'reverse has six exact extra comparison/move charges');
  assert.equal(rotated - sorted, 1, 'rotation has one exact extra move charge');
  assert.equal(work(ids), sorted, 'the same operations have an exact deterministic charge');
});

test('F5-R12 record sort charges exact reverse, rotation, and equal-prefix deltas', () => {
  const work = (record) => runProjection([{
    moduleId: 'record-work.kern',
    source: `fn name=unit export=true\n  handler lang=kern\n    return value=${JSON.stringify(record)}\n`,
  }]).receipt.workSteps;
  const sorted = work('{a: 1, b: 2, c: 3}');
  assert.equal(work('{c: 3, b: 2, a: 1}') - sorted, 3);
  assert.equal(work('{b: 2, c: 3, a: 1}') - sorted, 1);
  const longPrefix = work('{aaaaaaaa: 1, aaaaaaab: 2, aaaaaaac: 3}');
  const earlyDifference = work('{aaaaaaaa: 1, baaaaaaa: 2, caaaaaaa: 3}');
  assert.equal(longPrefix - earlyDifference, 49,
    'sort selection, duplicate validation, and f5record order validation charge exact probes');
});

test('Amendment-2 record-order work admits exact and rejects one-under', () => {
  const modules = [{
    moduleId: 'record-order-limit.kern',
    source: 'fn name=unit export=true\n  handler lang=kern\n    return value="{aaaaaaaa: 1, aaaaaaab: 2, aaaaaaac: 3}"\n',
  }];
  const baseline = runProjection(modules);
  const exact = __test.runProjectionWithProfileLimits(
    modules, { maxWorkSteps: baseline.receipt.workSteps });
  const under = __test.runProjectionWithProfileLimits(
    modules, { maxWorkSteps: baseline.receipt.workSteps - 1 });
  assert.equal(exact.receipt.status, 'projected');
  assert.equal(under.receipt.status, 'fatal');
  assert.equal(under.receipt.diagnostics[0].code, 'F5_LIMIT');
});

test('F5-R12 every added F4 row and binding increases owning root work', () => {
  const plain = __test.runProjectionWithProfileLimits([
    { moduleId: 'lib.kern', source: 'fn name=a export=true\n' },
    { moduleId: 'main.kern', source: 'fn name=main export=true\n' },
  ], {}).receipt.workSteps;
  const linked = __test.runProjectionWithProfileLimits([
    { moduleId: 'lib.kern', source: 'fn name=a export=true\n' },
    { moduleId: 'main.kern', source: 'use path="./lib"\n  from name=a kind=fn\nfn name=main export=true\n' },
  ], {}).receipt.workSteps;
  assert.ok(linked > plain, `binding/row work must increase root work: ${plain} -> ${linked}`);
});

test('Amendment-2 reports validation work when maxModules rejects', () => {
  const result = __test.runProjectionWithProfileLimits([
    { moduleId: 'a.kern', source: 'fn name=a export=true\n' },
    { moduleId: 'b.kern', source: 'fn name=b export=true\n' },
  ], { maxModules: 1 });
  assert.equal(result.receipt.status, 'fatal');
  assert.equal(result.receipt.diagnostics[0].code, 'F5_LIMIT');
  assert.ok(result.receipt.workSteps > 0, `validation work must be positive: ${result.receipt.workSteps}`);
});

test('Amendment-2 charges zero-record expression tapes once and keeps sibling sort deltas local', () => {
  const zeroRecord = runProjection([{
    moduleId: 'zero-record.kern',
    source: 'fn name=zero export=true\n  handler lang=kern\n    return value="1 + 2"\n',
  }]).receipt.workSteps;
  assert.ok(zeroRecord > 0);

  const work = (expression) => runProjection([{
    moduleId: 'siblings.kern',
    source: `fn name=s export=true\n  handler lang=kern\n    return value=${JSON.stringify(expression)}\n`,
  }]).receipt.workSteps;
  const sorted = work('[{a: 1, b: 2}, {c: 3, d: 4}]');
  assert.equal(work('[{b: 2, a: 1}, {c: 3, d: 4}]') - sorted, 1);
  assert.equal(work('[{a: 1, b: 2}, {d: 4, c: 3}]') - sorted, 1,
    'the second record must not inherit the first sibling sort accumulator');
});

test('Amendment-2 framed sorting preserves a U+001F record key byte-for-byte', () => {
  const expression = '{"a\\u001fb": 1, a: 2}';
  const result = runProjection([{
    moduleId: 'framed-key.kern',
    source: `fn name=s export=true\n  handler lang=kern\n    return value=${JSON.stringify(expression)}\n`,
  }]);
  assert.equal(result.receipt.status, 'projected');
  const artifact = decodeModuleKir(result.bytes, CANONICAL_LIMITS);
  const record = artifact.modules[0].roots[0].children[0].children[0].properties[0].value;
  const fields = record.value.find(({ key }) => key === 'fields')?.value;
  const entries = fields?.value.find(({ key }) => key === 'entries')?.value;
  assert.deepEqual(entries?.value.map(({ key }) => key), ['a', 'a\u001fb']);
});

test('Amendment-2 source wall has one charged framed sorter and no result rewrap', () => {
  const directory = resolve(ROOT, 'examples/kern-frontend');
  const files = readdirSync(directory).filter((name) => /^f5-.*\.kern$/u.test(name));
  const source = files.map((name) => readFileSync(resolve(directory, name), 'utf8')).join('\n');
  assert.ok(files.includes('f5-charged-sort.kern'));
  assert.match(source, /fn name=f5chargedsort /u);
  assert.doesNotMatch(source, /f5sortwork|f5sortproperties|f5resultaddwork/u);
  assert.doesNotMatch(source, /selectedKey\s*\+\s*\\?"\\u001f/u);
  const sorter = readFileSync(resolve(directory, 'f5-charged-sort.kern'), 'utf8');
  assert.match(sorter, /param name=entryFrames type="string\[\]"/u);
  assert.doesNotMatch(sorter, /param name=(?:keys|values)/u,
    'the sorter does not accept parallel payload arrays');
  assert.doesNotMatch(sorter, /(?:ordered|sortedEntries)\.push\([^)]*(?:Entry|Frame)/u,
    'the sorter retains no second ordered full-payload array');
  assert.doesNotMatch(sorter, /usedOrdinal|for name=usedIndex/u,
    'membership is not a nested ordinal scan');
  assert.match(sorter, /Map\.has\([^\n]+\)[\s\S]*Map\.get\(/u,
    'position-to-ordinal lookup has guarded Map provenance');
  assert.match(sorter, /f5scalarcomparework\([^\n]+\)[\s\S]*return value="\[\\"2\\", String\(work\)\]"/u,
    'duplicate drift retains the equality comparison and all prior sort work');
});

test('Amendment-2 ordinal composition has no hidden ordered payload arrays or helper rewraps', () => {
  const directory = resolve(ROOT, 'examples/kern-frontend');
  const files = readdirSync(directory).filter((name) => /^f5-.*\.kern$/u.test(name));
  const source = files.map((name) => readFileSync(resolve(directory, name), 'utf8')).join('\n');
  assert.ok(files.includes('f5-ordinal-composites.kern'));
  assert.match(source, /fn name=f5recordordinals /u);
  assert.match(source, /fn name=f5listordinals /u);
  assert.doesNotMatch(source,
    /(?:sorted|ordered)(?:Property|Export|Binding|Source|Module|Entry)*(?:Keys|Values|Entries)\s+value="\[\]"/u,
    'the full composition retains no caller/helper ordered payload arrays');
  assert.doesNotMatch(source,
    /(?:sorted|ordered)(?:Property|Export|Binding|Source|Module|Entry)*(?:Keys|Values|Entries)\.push/u,
    'helpers cannot hide a sorted payload rewrap');
  assert.doesNotMatch(source, /let name=modules value="\[\]"/u,
    'module projection retains final entry frames plus scalar ordinals, not a sorted module payload array');
  const ordinalSource = readFileSync(resolve(directory, 'f5-ordinal-composites.kern'), 'utf8');
  const ordinalRecord = ordinalSource.slice(ordinalSource.indexOf('fn name=f5recordordinals '),
    ordinalSource.indexOf('\nfn name=f5listordinals '));
  assert.doesNotMatch(ordinalRecord, /let name=(?:keys|values|entries) value="\[\]"/u,
    'ordinal record construction never reconstructs a full payload array');
  assert.doesNotMatch(ordinalSource, /let name=parts value="\[\]"/u,
    'ordinal constructors retain only logarithmic balanced-fold buckets');
});

test('Amendment-2 sorter charges every row codec operation without hidden decodes', () => {
  const directory = resolve(ROOT, 'examples/kern-frontend');
  const files = readdirSync(directory).filter((name) => /^f5-.*\.kern$/u.test(name));
  const source = files.map((name) => readFileSync(resolve(directory, name), 'utf8')).join('\n');
  const sorter = readFileSync(resolve(directory, 'f5-charged-sort.kern'), 'utf8');
  const rowReads = sorter.match(/f5rowread\(/gu)?.length ?? 0;
  const codecCharges = sorter.match(/f5rowcodecwork\(/gu)?.length ?? 0;
  assert.equal(codecCharges, rowReads,
    'every actual sorter row decode has a colocated codec scan/copy charge');
  const codec = source.slice(source.indexOf('fn name=f5rowcodecwork '),
    source.indexOf('\nfn name=', source.indexOf('fn name=f5rowcodecwork ') + 1));
  assert.doesNotMatch(codec, /f5rowread\(/u,
    'the codec charge helper cannot hide an additional uncharged decode');
});

test('Amendment-2 duplicate drift carries charged sorter work into the public receipt', () => {
  const modules = [{
    moduleId: 'duplicate-work.kern',
    source: 'fn name=main export=true\n  handler lang=kern\n    return value="{z: 1, a: 2}"\n',
  }];
  const result = __test.runProjectionWithF4Runner(modules, duplicateLateRecordKey);
  assert.equal(result.receipt.status, 'fatal');
  assert.equal(result.receipt.diagnostics[0].code, 'F5_F4_DRIFT');
  assert.ok(result.receipt.workSteps > 500,
    `duplicate discovery work must reach the public receipt: ${result.receipt.workSteps}`);
});

test('Amendment-2 duplicate drift has exact work at its cap and one-under', () => {
  const modules = [{
    moduleId: 'duplicate-work.kern',
    source: 'fn name=main export=true\n  handler lang=kern\n    return value="{z: 1, a: 2}"\n',
  }];
  const result = __test.runProjectionWithF4Runner(modules, duplicateLateRecordKey);
  assert.equal(result.receipt.workSteps, 14467,
    'duplicate discovery includes completed siblings, child construction, entry encoding, codec, comparison, and move work');
  const exact = __test.runProjectionWithF4RunnerAndProfileLimits(
    modules, duplicateLateRecordKey, { maxWorkSteps: result.receipt.workSteps });
  const under = __test.runProjectionWithF4RunnerAndProfileLimits(
    modules, duplicateLateRecordKey, { maxWorkSteps: result.receipt.workSteps - 1 });
  assert.equal(exact.receipt.diagnostics[0].code, 'F5_F4_DRIFT');
  assert.equal(under.receipt.diagnostics[0].code, 'F5_F4_DRIFT');
  assert.equal(exact.receipt.workSteps, result.receipt.workSteps);
  assert.equal(under.receipt.workSteps, result.receipt.workSteps,
    'drift precedence preserves the exact failure ledger at one-under');
});

test('Amendment-2 prices exact composite copies before gates and pins frame overhead', () => {
  const composite = readFileSync(resolve(ROOT, 'examples/kern-frontend/f5-composite-instructions.kern'), 'utf8');
  for (const name of ['f5list', 'f5record']) {
    const start = composite.indexOf(`fn name=${name} `);
    const end = composite.indexOf('\nfn name=', start + 1);
    const body = composite.slice(start, end < 0 ? composite.length : end);
    const gate = body.indexOf('f5resultgate(');
    assert.ok(body.indexOf('materializationWork') > 0);
    assert.ok(body.indexOf('materializationWork') < gate, `${name} copy work precedes its gate`);
    assert.match(body, /Text\.length\(materializationFrame\) \+ 1/u);
    assert.match(body, /f5uint\(materializationChild\[2\]\)/u);
    assert.doesNotMatch(body, /work \+ instructionScalars/u,
      `${name} uses the prospective composite formula without AGY's extra instructionScalars`);
  }
  const frame = readFileSync(resolve(ROOT, 'examples/kern-frontend/f5-result-frame.kern'), 'utf8');
  assert.match(frame, /fn name=f5resultframeoverhead /u);
  assert.doesNotMatch(frame, /let name=fixedScalars value="11 \+/u);
  const overheadStart = frame.indexOf('fn name=f5resultframeoverhead ');
  const gateStart = frame.indexOf('\nfn name=f5resultgate ', overheadStart);
  const overhead = frame.slice(overheadStart, gateStart);
  const commitStart = frame.indexOf('fn name=f5resultcommit ');
  const readStart = frame.indexOf('\nfn name=f5resultread ', commitStart);
  const commit = frame.slice(commitStart, readStart);
  assert.equal(overhead.match(/\\u001f/gu)?.length, commit.match(/\\u001f/gu)?.length);
  assert.equal(overhead.match(/\\u001e/gu)?.length, commit.match(/\\u001e/gu)?.length);
  assert.equal(overhead.match(/#/gu)?.length, commit.match(/#/gu)?.length);
});

test('Amendment-2 source wall fails closed on unknown statuses and malformed bindings', () => {
  const composite = readFileSync(resolve(ROOT, 'examples/kern-frontend/f5-composite-instructions.kern'), 'utf8');
  assert.match(composite, /child\[0\] != \\"0\\"/u);
  const modules = readFileSync(resolve(ROOT, 'examples/kern-frontend/f5-module-projection.kern'), 'utf8');
  assert.match(modules, /bindingShape\.length != 8/u);
});
