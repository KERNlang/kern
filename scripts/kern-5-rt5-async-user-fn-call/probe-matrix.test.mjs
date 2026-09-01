import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ASYNC_BOOLEAN_HELPER,
  ASYNC_TEXT_HELPER,
  BOOLEAN_FLAG,
  CAPABILITY_LINE,
  RELAY_HELPER,
  SYNC_TEXT_HELPER,
  TEXT_INPUT,
  admission,
  entryFn,
  moduleSource,
} from './k0-support.mjs';

const GOLDEN_URL = new URL('./probe-matrix.json', import.meta.url);

const DEEP_ASYNC_HELPER = Object.freeze({
  body: Object.freeze([CAPABILITY_LINE, 'return value="fetchIt(t)"']),
  name: 'outer',
  parameters: TEXT_INPUT,
  returns: 'string',
});

const TEXT_ENTRY = (body) => moduleSource([ASYNC_TEXT_HELPER, entryFn(body, TEXT_INPUT, 'string')]);

const PROBE_SOURCES = Object.freeze({
  'async-callee-of-async-callee': () =>
    moduleSource([ASYNC_TEXT_HELPER, DEEP_ASYNC_HELPER, entryFn(['return value="outer(t)"'], TEXT_INPUT, 'string')]),
  'binary-operand': () =>
    moduleSource([ASYNC_BOOLEAN_HELPER, entryFn(['return value="fetchFlag(flag) && flag"'], BOOLEAN_FLAG, 'boolean')]),
  'if-condition': () =>
    moduleSource([
      ASYNC_BOOLEAN_HELPER,
      entryFn(['if cond="fetchFlag(flag)"', '  return value="true"', 'return value="false"'], BOOLEAN_FLAG, 'boolean'),
    ]),
  'let-value': () => TEXT_ENTRY(['let name=x value="fetchIt(t)"', 'return value="x"']),
  'list-literal-argument': () =>
    moduleSource([
      ASYNC_BOOLEAN_HELPER,
      { body: ['return value="true"'], name: 'any', parameters: [{ name: 'xs', type: 'boolean[]' }], returns: 'boolean' },
      entryFn(['return value="any([fetchFlag(flag), flag])"'], BOOLEAN_FLAG, 'boolean'),
    ]),
  'nested-argument': () =>
    moduleSource([
      ASYNC_TEXT_HELPER,
      SYNC_TEXT_HELPER,
      entryFn(['return value="echo(fetchIt(t))"'], TEXT_INPUT, 'string'),
    ]),
  'nested-block-let-value': () =>
    TEXT_ENTRY(['if cond="true"', '  let name=x value="fetchIt(t)"', '  return value="x"', 'return value="t"']),
  'print-value': () => TEXT_ENTRY(['print value="fetchIt(t)"', 'return value="t"']),
  'return-value': () => TEXT_ENTRY(['return value="fetchIt(t)"']),
  'sync-callee-control': () =>
    moduleSource([SYNC_TEXT_HELPER, entryFn(['return value="echo(t)"'], TEXT_INPUT, 'string')]),
  'transitive-async-callee': () =>
    moduleSource([ASYNC_TEXT_HELPER, RELAY_HELPER, entryFn(['return value="relay(t)"'], TEXT_INPUT, 'string')]),
});

async function probeMatrix() {
  const positions = {};
  for (const name of Object.keys(PROBE_SOURCES).sort()) {
    const row = await admission(PROBE_SOURCES[name]());
    positions[name] = {
      javascript: row.javascript,
      projection: row.projection,
      python: row.python,
      rt1: row.rt1,
    };
  }
  return { positions };
}

test('the RT-5 probe matrix reproduces the recorded admission table exactly', async () => {
  const observed = await probeMatrix();
  if (process.env.KERN_RT5_WRITE_PROBE_MATRIX === '1') {
    await writeFile(GOLDEN_URL, `${JSON.stringify(observed, null, 2)}\n`);
  }
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  assert.deepEqual(observed, golden, 'the probe matrix drifted from its recorded golden');
});

test('every probed async position projects, so every negative is a link decision', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  for (const [name, row] of Object.entries(golden.positions)) {
    assert.equal(row.projection, 'projected', `${name} must project`);
  }
});

test('RT-1 and both emitted targets never disagree on admission', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  for (const [name, row] of Object.entries(golden.positions)) {
    assert.equal(row.javascript, row.rt1, `${name}: the JavaScript compiler disagreed with RT-1`);
    assert.equal(row.python, row.rt1, `${name}: the Python compiler disagreed with RT-1`);
  }
});

test('the synchronous control is admitted, so the matrix is not a uniformly dead pipeline', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  assert.equal(golden.positions['sync-callee-control'].rt1, 'admitted');
});
