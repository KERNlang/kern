import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { projectKernModules } from '../../packages/core/dist/frontend-projection.js';
import { OPERATORS, compileJavaScript, compilePython, handlerSource, project } from './k0-support.mjs';

const GOLDEN_URL = new URL('./k0-golden.json', import.meta.url);
const RT2_GOLDEN_URL = new URL('../kern-5-rt2-boolean-if/k0-golden.json', import.meta.url);
const CONTRACTS_URL = new URL('../../packages/core/src/kir-runtime/linked-kir-program/contracts.ts', import.meta.url);

const FLAGS = Object.freeze([
  { name: 'flag', type: 'boolean' },
  { name: 'other', type: 'boolean' },
]);

const OPERAND_FIXTURES = Object.freeze({
  booleanOperands: (operator) => `flag ${operator} other`,
  integerOperands: (operator) => `1 ${operator} 2`,
  mixedOperands: (operator) => `flag ${operator} 1`,
});

const FOR_FIXTURES = Object.freeze({
  bareAttributes: 'for name=i from=0 to=3',
  quotedAttributes: 'for name="i" from="0" to="3"',
});

function linkedExpressionKinds(source) {
  const start = source.indexOf('export type LinkedKernKirExpression =');
  assert.ok(start >= 0, 'contracts.ts must declare LinkedKernKirExpression');
  const end = source.indexOf('\nexport ', start + 1);
  assert.ok(end > start, 'the LinkedKernKirExpression union must be followed by another export');
  const kinds = [...source.slice(start, end).matchAll(/readonly kind: '([a-z-]+)'/gu)].map((match) => match[1]);
  assert.ok(kinds.length > 0, 'the LinkedKernKirExpression union must carry discriminant literals');
  return [...new Set(kinds)].sort();
}

async function admissionCode(expression) {
  const verified = await project(handlerSource('boolean', FLAGS, [`return value="${expression}"`]));
  if (verified === undefined) return 'projection-rejected';
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  const javascriptCode = javascript.outcome === 'failure' ? javascript.code : 'admitted';
  const pythonCode = python.outcome === 'failure' ? python.code : 'admitted';
  assert.equal(javascriptCode, pythonCode, `both targets share one linker; ${expression} diverged`);
  return javascriptCode;
}

async function forDiagnostics(statement) {
  const source = handlerSource('boolean', FLAGS, [statement, '  print value="\"x\""', 'return value="flag"']);
  const result = await projectKernModules({ modules: [{ moduleId: 'route.kern', source }] });
  assert.notEqual(result.status, 'projected', 'F5 must not project a for statement');
  return [...new Set((result.diagnostics ?? []).map((diagnostic) => diagnostic.code))].sort();
}

async function recompute() {
  const expressionAdmission = {};
  for (const operator of [...OPERATORS].sort()) {
    const row = {};
    for (const shape of Object.keys(OPERAND_FIXTURES).sort()) {
      row[shape] = await admissionCode(OPERAND_FIXTURES[shape](operator));
    }
    expressionAdmission[operator] = row;
  }
  const forProjectionStatus = {};
  for (const shape of Object.keys(FOR_FIXTURES).sort()) {
    forProjectionStatus[shape] = await forDiagnostics(FOR_FIXTURES[shape]);
  }
  return {
    expressionAdmission,
    forProjectionStatus,
    linkedExpressionKinds: linkedExpressionKinds(await readFile(CONTRACTS_URL, 'utf8')),
    rt2GoldenSha256: createHash('sha256').update(await readFile(RT2_GOLDEN_URL)).digest('hex'),
  };
}

test('K0 golden pins the closed binary operator admission matrix and the for projection status', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  assert.deepEqual(
    await recompute(),
    golden,
    'K0_KIR_GOLDEN_DRIFT: recomputed binary admission, for projection, or expression union differs from the committed golden',
  );
});

test('K0 golden keeps the RT-2 golden byte-identical', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  const bytes = await readFile(RT2_GOLDEN_URL);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    golden.rt2GoldenSha256,
    'K0_KIR_GOLDEN_DRIFT: RT-3 must extend the K0 golden additively and never flip an RT-2 probe',
  );
});

test('K0 golden admits exactly the closed RT-3 operator set as boolean-producing expressions', async () => {
  const golden = JSON.parse(await readFile(GOLDEN_URL, 'utf8'));
  const admitted = Object.entries(golden.expressionAdmission)
    .filter(([, row]) => Object.values(row).includes('admitted'))
    .map(([operator]) => operator)
    .sort();
  assert.deepEqual(admitted, [...OPERATORS].sort());
  assert.ok(golden.linkedExpressionKinds.includes('binary'));
});
