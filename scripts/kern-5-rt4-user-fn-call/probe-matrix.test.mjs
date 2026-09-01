import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { projectKernModules } from '../../packages/core/dist/frontend-projection.js';
import { ENTRY, HELPER_IDENTITY, HELPER_LABEL, admission, callProgram, moduleSource } from './k0-support.mjs';

const GOLDEN_URL = new URL('./probe-matrix.json', import.meta.url);
const RT2_GOLDEN_URL = new URL('../kern-5-rt2-boolean-if/k0-golden.json', import.meta.url);
const RT3_GOLDEN_URL = new URL('../kern-5-rt3-binary-expression/k0-golden.json', import.meta.url);
const CONTRACTS_URL = new URL('../../packages/core/src/kir-runtime/linked-kir-program/contracts.ts', import.meta.url);

const TEXT_PARAMETERS = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);
const LIST_PARAMETERS = Object.freeze([Object.freeze({ name: 'xs', type: 'boolean[]' })]);

const TEXT_ENTRY = Object.freeze({ helpers: [HELPER_LABEL], parameters: TEXT_PARAMETERS, returns: 'string' });

const HELPER_PAIR = Object.freeze({
  body: Object.freeze(['return value="a && b"']),
  name: 'both',
  parameters: Object.freeze([
    Object.freeze({ name: 'a', type: 'boolean' }),
    Object.freeze({ name: 'b', type: 'boolean' }),
  ]),
  returns: 'boolean',
});

const HELPER_NULLARY = Object.freeze({
  body: Object.freeze(['return value="true"']),
  name: 'yes',
  parameters: Object.freeze([]),
  returns: 'boolean',
});

const HELPER_LIST = Object.freeze({
  body: Object.freeze(['return value="true"']),
  name: 'any',
  parameters: LIST_PARAMETERS,
  returns: 'boolean',
});

const HELPER_PICK = Object.freeze({
  body: Object.freeze(['return value="xs"']),
  name: 'pick',
  parameters: LIST_PARAMETERS,
  returns: 'boolean[]',
});

const HELPER_EXPORTED = Object.freeze({ ...HELPER_IDENTITY, exported: 'true' });

const HELPER_CAPABILITY = Object.freeze({
  body: Object.freeze(['capability namespace=fixture operation=resolve name=reply', 'return value="reply"']),
  name: 'fetch',
  parameters: TEXT_PARAMETERS,
  returns: 'string',
});

const PROBE_SOURCES = Object.freeze({
  'binary-operand': () => callProgram(['return value="helper(flag) && flag"']),
  'callee-capability': () =>
    callProgram(['return value="fetch(t)"'], {
      helpers: [HELPER_CAPABILITY],
      parameters: TEXT_PARAMETERS,
      returns: 'string',
    }),
  'exported-callee': () => callProgram(['return value="helper(flag)"'], { helpers: [HELPER_EXPORTED] }),
  'if-condition': () => callProgram(['if cond="helper(flag)"', '  return value="false"', 'return value="true"']),
  'json-intrinsic-control': () =>
    callProgram(['return value="Json.stringify(t)"'], { helpers: [], parameters: TEXT_PARAMETERS, returns: 'string' }),
  'let-initializer': () => callProgram(['let name=x value="helper(flag)"', 'return value="x"']),
  'list-literal-argument': () =>
    callProgram(['return value="any([flag, flag])"'], { helpers: [HELPER_LIST] }),
  'list-signature': () =>
    callProgram(['return value="pick(xs)"'], {
      helpers: [HELPER_PICK],
      parameters: LIST_PARAMETERS,
      returns: 'boolean[]',
    }),
  'member-callee': () => callProgram(['return value="obj.helper(flag)"']),
  'nested-call': () => callProgram(['return value="helper(helper(flag))"']),
  'non-exported-callee': () => callProgram(['return value="helper(flag)"']),
  'optional-call': () => callProgram(['return value="helper?.(flag)"']),
  'print-value': () => callProgram(['print value="label(t)"', 'return value="t"'], TEXT_ENTRY),
  recursion: () =>
    callProgram(['return value="loop(flag)"'], {
      helpers: [{ ...HELPER_IDENTITY, body: ['return value="loop(flag)"'], name: 'loop' }],
    }),
  'return-value': () => callProgram(['return value="helper(flag)"']),
  'two-arguments': () => callProgram(['return value="both(flag, flag)"'], { helpers: [HELPER_PAIR] }),
  'unknown-callee': () => callProgram(['return value="nope(flag)"'], { helpers: [] }),
  'zero-arguments': () =>
    callProgram(['return value="yes()"'], { helpers: [HELPER_NULLARY], parameters: [] }),
});

const PROJECTION_NEGATIVES = Object.freeze({
  'capability-input': [
    {
      moduleId: ENTRY.moduleId,
      source: moduleSource([
        HELPER_LABEL,
        {
          body: ['capability namespace=fixture operation=resolve name=reply input="label(t)"', 'return value="reply"'],
          exported: 'true',
          name: ENTRY.handlerName,
          parameters: TEXT_PARAMETERS,
          returns: 'string',
        },
      ]),
    },
  ],
  'integer-signature': [
    {
      moduleId: ENTRY.moduleId,
      source: moduleSource([
        { body: ['return value="n"'], name: 'inc', parameters: [{ name: 'n', type: 'integer' }], returns: 'integer' },
        { body: ['return value="true"'], exported: 'true', name: ENTRY.handlerName, parameters: [], returns: 'boolean' },
      ]),
    },
  ],
});

const CROSS_MODULE = Object.freeze([
  { moduleId: 'lib.kern', source: moduleSource([HELPER_EXPORTED]) },
  {
    moduleId: ENTRY.moduleId,
    source: `use path="./lib"\n  from name=helper\n${moduleSource([
      { body: ['return value="helper(flag)"'], exported: 'true', name: ENTRY.handlerName, parameters: [{ name: 'flag', type: 'boolean' }], returns: 'boolean' },
    ])}`,
  },
]);

function linkedExpressionKinds(source) {
  const start = source.indexOf('export type LinkedKernKirExpression =');
  assert.ok(start >= 0, 'contracts.ts must declare LinkedKernKirExpression');
  const end = source.indexOf('\nexport ', start + 1);
  assert.ok(end > start, 'the LinkedKernKirExpression union must be followed by another export');
  const kinds = [...source.slice(start, end).matchAll(/readonly kind: '([a-z-]+)'/gu)].map((match) => match[1]);
  return [...new Set(kinds)].sort();
}

async function projectionDiagnostics(modules) {
  const result = await projectKernModules({ modules });
  assert.notEqual(result.status, 'projected', 'the projection negative must not project');
  return {
    diagnostics: [...new Set((result.diagnostics ?? []).map((diagnostic) => diagnostic.code))].sort(),
    status: result.status,
  };
}

async function recompute() {
  const positions = {};
  for (const name of Object.keys(PROBE_SOURCES).sort()) {
    const { verified: _unused, ...row } = await admission(PROBE_SOURCES[name]());
    positions[name] = row;
  }
  const { verified: _crossModule, ...crossModule } = await admission(CROSS_MODULE);
  positions['cross-module'] = crossModule;
  const notProjected = {};
  for (const name of Object.keys(PROJECTION_NEGATIVES).sort()) {
    notProjected[name] = await projectionDiagnostics(PROJECTION_NEGATIVES[name]);
  }
  return {
    linkedExpressionKinds: linkedExpressionKinds(await readFile(CONTRACTS_URL, 'utf8')),
    notProjected,
    positions,
    rt2GoldenSha256: createHash('sha256').update(await readFile(RT2_GOLDEN_URL)).digest('hex'),
    rt3GoldenSha256: createHash('sha256').update(await readFile(RT3_GOLDEN_URL)).digest('hex'),
  };
}

test('probe matrix pins every admitted call position through the real F5 pipeline', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  assert.deepEqual(
    await recompute(),
    golden,
    'RT4_PROBE_MATRIX_DRIFT: recomputed call admission differs from the committed probe matrix',
  );
});

test('positive admission is green before any negative counts', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  const admitted = Object.entries(golden.positions)
    .filter(([, row]) => row.rt1 === 'admitted')
    .map(([name]) => name)
    .sort();
  assert.deepEqual(admitted, [
    'binary-operand',
    'callee-capability',
    'exported-callee',
    'if-condition',
    'json-intrinsic-control',
    'let-initializer',
    'list-literal-argument',
    'list-signature',
    'nested-call',
    'non-exported-callee',
    'print-value',
    'return-value',
    'two-arguments',
    'zero-arguments',
  ]);
  for (const name of admitted) {
    const row = golden.positions[name];
    assert.equal(row.javascript, 'admitted', name);
    assert.equal(row.python, 'admitted', name);
  }
});

test('every negative position projects first, so it is a link decision and not a frontend gap', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  const rejected = Object.entries(golden.positions).filter(([, row]) => row.rt1 !== 'admitted');
  assert.deepEqual(
    rejected.map(([name]) => name).sort(),
    ['cross-module', 'member-callee', 'optional-call', 'recursion', 'unknown-callee'],
  );
  for (const [name, row] of rejected) {
    assert.equal(row.projection, 'projected', `${name} must project before the linker rejects it`);
    assert.equal(row.rt1, 'handler-entry-unsupported', name);
    assert.equal(row.javascript, 'handler-entry-unsupported', name);
    assert.equal(row.python, 'handler-entry-unsupported', name);
  }
});

test('the two probed positions F5 never projects are recorded as frontend facts', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  assert.deepEqual(golden.notProjected['capability-input'].diagnostics, ['FRONTEND_EXCLUDED_HOST_EXPRESSION']);
  assert.deepEqual(golden.notProjected['integer-signature'].diagnostics, ['F5_AUTHORITY_DRIFT']);
  assert.ok(golden.linkedExpressionKinds.includes('user-call'));
});
