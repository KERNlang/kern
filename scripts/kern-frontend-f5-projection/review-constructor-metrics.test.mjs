import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { __test, runProjection } from './worker.mjs';
import { listTape } from '../kern-frontend-f4-declarations/decoder.mjs';
import { runModuleSet } from '../kern-frontend-f4-declarations/worker.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

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
  assert.equal(longPrefix - earlyDifference, 21, 'seven extra probes in each of three comparisons');
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
