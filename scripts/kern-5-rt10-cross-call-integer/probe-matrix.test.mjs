import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  POSITIONS,
  SHAPE_POSITIONS,
  SIGNATURE_POSITIONS,
  f5Row,
  signatureShapes,
  statementShapes,
} from './k0-support.mjs';

const MATRIX_URL = new URL('./probe-matrix.json', import.meta.url);

async function recompute() {
  const positions = {};
  for (const name of Object.keys(POSITIONS).sort()) {
    positions[name] = f5Row(POSITIONS[name]());
  }
  const signatures = {};
  for (const name of [...SIGNATURE_POSITIONS].sort()) {
    signatures[name] = signatureShapes(POSITIONS[name]());
  }
  const shapes = {};
  for (const name of [...SHAPE_POSITIONS].sort()) {
    shapes[name] = statementShapes(POSITIONS[name]());
  }
  return { positions, shapes, signatures };
}

async function matrix() {
  const raw = await readFile(MATRIX_URL, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(`${JSON.stringify(parsed, null, 2)}\n`, raw, 'the probe matrix must stay canonically serialized');
  return parsed;
}

test('the RT-10-X probe matrix reproduces the committed F5 facts exactly', async () => {
  assert.deepEqual(
    await recompute(),
    await matrix(),
    'RT10X_PROBE_DRIFT: F5 no longer projects what the integer cross-call contract was built on',
  );
});

test('every fixture the linker is asked to decide on projects first, so no negative is a frontend gap', async () => {
  const committed = await matrix();
  const names = Object.keys(committed.positions);
  assert.ok(names.length > 0, 'the matrix must carry positions');
  for (const name of names) {
    assert.equal(committed.positions[name].status, 'projected', name);
    assert.deepEqual(committed.positions[name].diagnostics, [], name);
  }
});

test('both RT-8 spellings project one integer type record in parameter and in return position', async () => {
  const committed = await matrix();
  const integerSpelling = committed.signatures['int-both'];
  const numberSpelling = committed.signatures['number-spelling'];
  assert.deepEqual(integerSpelling[0], {
    name: 'idp',
    parameters: [{ name: 'a', type: { kind: 'integer' } }],
    returns: { kind: 'integer' },
  });
  assert.deepEqual(
    numberSpelling,
    integerSpelling,
    'RT10X_ALIAS_DRIFT: the number spelling must project byte-identically to the integer spelling',
  );
  assert.deepEqual(committed.signatures['int-mixed-signature'][0].parameters, [
    { name: 'a', type: { kind: 'integer' } },
    { name: 'flag', type: { kind: 'boolean' } },
  ]);
});

test('an integer list signature projects as a list type record carrying an integer element', async () => {
  const committed = await matrix();
  assert.deepEqual(committed.signatures['refuse-int-list-param'][0], {
    name: 'suml',
    parameters: [{ name: 'xs', type: { element: 'integer', kind: 'list' } }],
    returns: { kind: 'boolean' },
  });
  assert.deepEqual(committed.signatures['refuse-int-list-return'][0].returns, {
    element: 'integer',
    kind: 'list',
  });
});

test('the accumulator reaches the linker as an assign whose value is a binary over a call', async () => {
  const committed = await matrix();
  assert.deepEqual(committed.shapes['int-accumulator'][1], {
    kind: 'assign',
    properties: {
      target: { kind: 'identifier', name: 'n' },
      value: {
        kind: 'binary',
        left: { kind: 'identifier', name: 'n' },
        op: '+',
        right: { args: [{ kind: 'integer', value: '7' }], callee: { kind: 'identifier', name: 'idp' }, kind: 'call', optional: false },
      },
    },
  });
});

test('arithmetic over a call result projects with the call in the named operand position', async () => {
  const committed = await matrix();
  const left = committed.shapes['int-arith-on-result'][0].properties.value;
  assert.equal(left.op, '+');
  assert.equal(left.left.kind, 'call');
  assert.equal(left.right.value, '1');
  const right = committed.shapes['int-result-as-operand'][0].properties.value;
  assert.equal(right.op, '+');
  assert.equal(right.left.value, '1');
  assert.equal(right.right.kind, 'call');
  const unary = committed.shapes['int-unary-on-result'][0].properties.value;
  assert.equal(unary.kind, 'unary');
  assert.equal(unary.op, '-');
  assert.equal(unary.argument.kind, 'call');
});

test('a call projects in argument position, in assign-value position and nested in another call', async () => {
  const committed = await matrix();
  const argument = committed.shapes['int-arith-argument'][0].properties.value;
  assert.equal(argument.kind, 'call');
  assert.equal(argument.args[0].kind, 'binary');
  assert.equal(committed.shapes['int-assign-value'][1].kind, 'assign');
  assert.equal(committed.shapes['int-assign-value'][1].properties.value.kind, 'call');
  const nested = committed.shapes['int-nested-call'][0].properties.value;
  assert.equal(nested.kind, 'call');
  assert.equal(nested.args[0].kind, 'call');
});
