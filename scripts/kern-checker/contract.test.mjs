import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KERN_CHECKER_FACTS_FORMAT,
  checkerFactsFromFlatModule,
  validateKernCheckerFacts,
} from './contract.mjs';
import { emptyFlatModule, flattenKernSource } from '../capstone-checker-subset/flatten-kern.mjs';
import { loadKernCheckerPolicy } from './policy.mjs';
import { KERN_CHECKER_TABLES } from '../../packages/cli/dist/kern-checker-contract.js';

const ARGUMENT_TABLES = KERN_CHECKER_TABLES.slice(41, 53).map(([name]) => name);

function validFacts() {
  const flat = emptyFlatModule('valid.kern');
  flat.stmtKind.push('fn');
  flat.stmtFn.push('main');
  flat.stmtParent.push(-1);
  flat.stmtLine.push(1);
  flat.stmtCol.push(1);
  flat.stmtName.push('main');
  for (const name of [
    'stmtTarget',
    'stmtValue',
    'stmtTemplate',
    'stmtExprKind',
    'stmtExprName',
    'stmtExprLeftKind',
    'stmtExprLeftName',
    'stmtExprLeftNum',
    'stmtExprLeftMemberObject',
    'stmtExprLeftMemberProp',
    'stmtExprRightKind',
    'stmtExprRightName',
    'stmtExprRightNum',
    'stmtExprRightMemberObject',
    'stmtExprRightMemberProp',
    'stmtExprNum',
    'stmtExprCall',
    'stmtExprMemberObject',
    'stmtExprMemberProp',
  ]) flat[name].push('');
  flat.stmtExprArgCount.push(0);
  return checkerFactsFromFlatModule(flat);
}

test('wraps the existing parallel tables without renaming fields', () => {
  const facts = validFacts();
  assert.equal(KERN_CHECKER_FACTS_FORMAT, 'kern.checker.facts.2');
  assert.equal(facts.format, KERN_CHECKER_FACTS_FORMAT);
  assert.equal(facts.path, 'valid.kern');
  assert.deepEqual(validateKernCheckerFacts(facts), facts);
});

test('unknown input versions fail closed', () => {
  const facts = validFacts();
  assert.throws(
    () => validateKernCheckerFacts({ ...facts, format: 'kern.checker.facts.future' }),
    /format is unsupported/,
  );
  assert.throws(
    () => validateKernCheckerFacts({ ...facts, format: 'kern.checker.facts.1' }),
    /format is unsupported/,
  );
});

test('call counts authenticate canonical contiguous argument rows', () => {
  const facts = checkerFactsFromFlatModule(flattenKernSource('call.kern', `fn name=main returns=number
  handler lang="kern"
    return value="String(1, 2)"
`));
  assert.deepEqual(facts.tables.argOrdinal, [0, 1]);
  facts.tables.argOrdinal[1] = 0;
  assert.throws(() => validateKernCheckerFacts(facts), /canonical argument rows/);
});

test('understated, overstated, missing, extra, reordered, and foreign argument rows fail closed', () => {
  const original = checkerFactsFromFlatModule(flattenKernSource('call.kern', `fn name=main returns=number
  handler lang="kern"
    return value="String(1, 2)"
`));
  const mutations = [
    (facts) => { facts.tables.callArgCount[0] = 1; },
    (facts) => { facts.tables.callArgCount[0] = 3; },
    (facts) => { for (const name of ARGUMENT_TABLES) facts.tables[name].pop(); },
    (facts) => {
      for (const name of ARGUMENT_TABLES) facts.tables[name].push(facts.tables[name].at(-1));
      facts.tables.argOrdinal[2] = 2;
    },
    (facts) => { facts.tables.argOrdinal.reverse(); },
    (facts) => { facts.tables.argCall[1] = 1; },
  ];
  for (const mutate of mutations) {
    const facts = structuredClone(original);
    mutate(facts);
    assert.throws(() => validateKernCheckerFacts(facts), /canonical argument rows/);
  }
});

test('duplicate function names retain declaration-specific parameter owners', () => {
  const facts = checkerFactsFromFlatModule(flattenKernSource('duplicate.kern', `fn name=f returns=number
  param name=a type=number
  handler lang="kern"
    return value="a"

fn name=f returns=number
  param name=b type=number
  handler lang="kern"
    return value="b"
`));
  assert.deepEqual(facts.tables.paramOwnerStmt, [0, 2]);
  assert.deepEqual(validateKernCheckerFacts(facts), facts);
  facts.tables.paramOwnerStmt[1] = 0;
  assert.throws(() => validateKernCheckerFacts(facts), /canonical parameter rows/);
});

test('parameter owner, function identity, and ordinal drift fail closed', () => {
  const source = `fn name=f returns=number
  param name=a type=number
  param name=b type=number
  handler lang="kern"
    return value="a"
`;
  const original = checkerFactsFromFlatModule(flattenKernSource('parameters.kern', source));
  for (const mutate of [
    (facts) => { facts.tables.paramOwnerStmt[0] = 1; },
    (facts) => { facts.tables.paramFn[0] = 'other'; },
    (facts) => { facts.tables.paramOrdinal[1] = 2; },
  ]) {
    const facts = structuredClone(original);
    mutate(facts);
    assert.throws(() => validateKernCheckerFacts(facts), /canonical parameter rows/);
  }
});

test('negative expression counts fail before checker semantics', () => {
  const facts = validFacts();
  facts.tables.stmtExprArgCount[0] = -1;
  assert.throws(() => validateKernCheckerFacts(facts), /stmtExprArgCount\[0\] must be non-negative/);
});

test('aggregate UTF-8 input bytes are rejected during validation', () => {
  const facts = validFacts();
  facts.tables.stmtName[0] = 'é'.repeat(80);
  const policy = loadKernCheckerPolicy();
  policy.profileLimits.maxInputBytes = 128;
  assert.throws(() => validateKernCheckerFacts(facts, policy), /maxInputBytes/);
});

test('statement table drift fails before checker semantics', () => {
  const facts = validFacts();
  facts.tables.stmtLine = [];
  assert.throws(() => validateKernCheckerFacts(facts), /statement table lengths must match/);
});

test('invalid parent references fail before checker semantics', () => {
  const facts = validFacts();
  facts.tables.stmtParent[0] = 0;
  assert.throws(() => validateKernCheckerFacts(facts), /stmtParent\[0\] must reference an earlier statement/);
});

test('accessor-backed facts fail before serialization or runtime', () => {
  const facts = validFacts();
  Object.defineProperty(facts, 'format', { enumerable: true, get() { throw new Error('getter executed'); } });
  assert.throws(() => validateKernCheckerFacts(facts), /inspectable data fields/);
});

test('sparse and exotic tables fail closed', () => {
  const sparse = validFacts();
  sparse.tables.stmtKind.length = 2;
  assert.throws(() => validateKernCheckerFacts(sparse), /stmtKind must be dense/);
  const exotic = validFacts();
  exotic.tables.stmtKind = Object.setPrototypeOf([...exotic.tables.stmtKind], null);
  assert.throws(() => validateKernCheckerFacts(exotic), /stmtKind must be a plain array/);
});
