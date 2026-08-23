import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { compareCodePoints } from '../../packages/core/dist/canonical-value/validate.js';
import { decodeModuleKir, encodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
import { parseDocumentStrict } from '../../packages/core/dist/parser.js';
import { listTape } from '../kern-frontend-f4-declarations/decoder.mjs';
import { runModuleSet } from '../kern-frontend-f4-declarations/worker.mjs';
import { decodeInstructionStream } from './decoder.mjs';
import { __test, runProjection } from './worker.mjs';

const LIMITS = Object.freeze({
  maxBytes: 16_777_216, maxCollectionLength: 262_144, maxDecimalChars: 128, maxDepth: 256,
  maxFractionDigits: 64, maxIntegerDigits: 512, maxMapEntries: 262_144, maxNodes: 1_048_576,
  maxRecordFields: 262_144, maxStringBytes: 16_777_216,
});
const INSTRUCTION_LIMITS = Object.freeze({
  maxCollectionLength: 8, maxDepth: 8, maxNodes: 32, maxStringCodePoints: 32,
});
const item = (value) => `i${Array.from(value).length}:${value}`;
const tape = (values) => values.map(item).join('');

function oneProperty(source) {
  return [{ moduleId: 'case.kern', source }];
}

function fatalCode(modules, code) {
  const result = runProjection(modules);
  assert.equal(result.receipt.status, 'fatal');
  assert.equal(result.receipt.diagnostics[0].code, code);
  assert.equal(result.bytes, null);
}

const authorityDrift = (modules) => fatalCode(modules, 'F5_AUTHORITY_DRIFT');

function resealDocument(fields) {
  const terminal = fields[16].split(':');
  assert.equal(terminal.length, 20);
  fields[16] = `document:${fields[1]}:${Array.from(fields[4]).length}:${Array.from(fields[5]).length}:${Array.from(fields[6]).length}:${Array.from(fields[7]).length}:${Array.from(fields[8]).length}:${Array.from(fields[9]).length}:${Array.from(fields[10]).length}:${Array.from(fields[11]).length}:${Array.from(fields[12]).length}:${Array.from(fields[13]).length}:${Array.from(fields[14]).length}:${terminal.slice(13, 19).join(':')}:closed`;
}

function duplicateRecordKeyRunner(modules) {
  const f4 = structuredClone(runModuleSet(modules));
  const evidenceRows = listTape(f4.documents[0].fields[14], 'expression evidence');
  const evidence = listTape(evidenceRows[0], 'expression evidence row');
  const receipt = listTape(evidence[8], 'F2 receipt');
  const occurrences = receipt[7].match(/i1:[az]/gu) ?? [];
  assert.deepEqual(occurrences, ['i1:z', 'i1:a']);
  receipt[7] = receipt[7].replace('i1:zi1:a', 'i1:ai1:a');
  evidence[8] = tape(receipt);
  evidenceRows[0] = tape(evidence);
  f4.documents[0].fields[14] = tape(evidenceRows);
  resealDocument(f4.documents[0].fields);
  return f4;
}

test('F5-R7 JS record decoding uses the pinned BMP/astral/prefix scalar comparator', () => {
  const keys = ['a', 'a\u{10000}', '\uE000', '\u{10000}', '\u{1F600}'];
  assert.deepEqual([...keys].sort(compareCodePoints), keys);
  const tape = `R${keys.length}{${keys.map((key) => `K${[...key].length}:${key}N`).join('')}}`;
  assert.deepEqual(decodeInstructionStream(tape, INSTRUCTION_LIMITS).value.map(({ key }) => key), keys);
  const reversed = `R2{K1:\u{10000}NK1:\uE000N}`;
  assert.throws(() => decodeInstructionStream(reversed, INSTRUCTION_LIMITS), /record order/u);
});

test('F5-R7 expression records sort unique scalar keys and reject duplicate-key evidence', () => {
  const modules = oneProperty('fn name=main export=true\n  handler lang=kern\n    return value="{z: 1, a: 2}"\n');
  const result = runProjection(modules);
  assert.equal(result.receipt.status, 'projected');
  const artifact = decodeModuleKir(result.bytes, LIMITS);
  const expression = artifact.modules[0].roots[0].children[0].children[0].properties[0].value;
  const fields = expression.value.find(({ key }) => key === 'fields')?.value;
  const entries = fields?.value.find(({ key }) => key === 'entries')?.value;
  assert.deepEqual(entries?.value.map(({ key }) => key), ['a', 'z']);

  const duplicate = __test.runProjectionWithF4Runner(modules, duplicateRecordKeyRunner);
  assert.equal(duplicate.receipt.status, 'fatal');
  assert.equal(duplicate.receipt.diagnostics[0].code, 'F5_F4_DRIFT');
  assert.equal(duplicate.bytes, null);
});

test('F5-R7 handler position admits return void only and rejects nonportable parameters', () => {
  const valid = oneProperty('fn name=main returns=void export=true\n');
  const expected = encodeModuleKir([{ id: 'case.kern', roots: parseDocumentStrict(valid[0].source).children ?? [] }], LIMITS);
  assert.deepEqual(Buffer.from(runProjection(valid).bytes), Buffer.from(expected));
  for (const type of ['void', 'unknown', 'json', 'void[]', 'unknown[]', 'string[][]']) {
    authorityDrift(oneProperty(`fn name=main export=true\n  param name=value type=${type}\n`));
  }
});

test('F5-R7 branch and each lowerings accept only exact pinned canonical forms', () => {
  const validSources = [
    'fn name=main returns=void export=true\n  handler lang=kern\n    branch name=x on=value\n      path value=answer\n',
    'fn name=main returns=void export=true\n  handler lang=kern\n    branch name=x on=value\n      path value=42\n',
    'fn name=main returns=void export=true\n  handler lang=kern\n    branch name=x on=value\n      path value="hello world"\n',
    'fn name=main returns=void export=true\n  handler lang=kern\n    each name=item in=items\n',
    'fn name=main returns=void export=true\n  handler lang=kern\n    each name=item in=state.items\n',
  ];
  for (const source of validSources) {
    const modules = oneProperty(source);
    const expected = encodeModuleKir([{ id: 'case.kern', roots: parseDocumentStrict(source).children ?? [] }], LIMITS);
    assert.deepEqual(Buffer.from(runProjection(modules).bytes), Buffer.from(expected), source);
  }
  for (const source of [
    'fn name=main returns=void export=true\n  handler lang=kern\n    branch name=x on=value\n      path value=a+b\n',
    'fn name=main returns=void export=true\n  handler lang=kern\n    branch name=x on=value\n      path value=-0.0\n',
    'fn name=main returns=void export=true\n  handler lang=kern\n    each name=item in=items?.values\n',
    'fn name=main returns=void export=true\n  handler lang=kern\n    each name=item in=state[items]\n',
  ]) authorityDrift(oneProperty(source));
});

function growingStringWriter(source) {
  const stringBindings = new Set([...source.matchAll(/let name=([A-Za-z][A-Za-z0-9]*) value="\\"/gu)]
    .map((match) => match[1]));
  return [...source.matchAll(/assign\s+target=([A-Za-z][A-Za-z0-9]*)\s+value="\1\s*\+/gu)]
    .find((match) => stringBindings.has(match[1]));
}

test('F5-R7 source guard bans every unbounded growing-prefix writer', () => {
  const paths = JSON.parse(readFileSync(new URL('./policy.json', import.meta.url), 'utf8'))
    .composition.map(({ path }) => new URL(`../../${path}`, import.meta.url));
  for (const path of paths) assert.equal(growingStringWriter(readFileSync(path, 'utf8')), undefined, path.pathname);
  assert.ok(growingStringWriter('let name=out value="\\"\\""\nassign target=out value="out + part"'));
});
