import assert from 'node:assert/strict';
import test from 'node:test';

import { listTape } from './decoder.mjs';
import { decodeModuleSet } from './module-set-decoder.mjs';
import { referenceModuleGraph } from './m2-reference-graph.mjs';
import { __test as moduleSetTest } from './module-set-worker.mjs';
import { loadPolicy, runDocument, runModuleSet, validatePolicy } from './worker.mjs';

const frame = (value) => `i${Array.from(value).length}:${value}`;
const tape = (values) => values.map(frame).join('');
const rows = (value, label) => listTape(value, label).map((row, index) => listTape(row, `${label} ${index}`));

function capturedModuleSet(modules) {
  const seen = [];
  const result = moduleSetTest.runModuleSetWithOptions(runDocument, loadPolicy, modules, {
    observe: (event) => seen.push(event),
  });
  const invocation = seen.find(({ stage }) => stage === 'f4b');
  assert.ok(invocation);
  return {
    result,
    context: {
      moduleCount: modules.length,
      moduleIds: modules.map(({ moduleId }) => moduleId),
      mode: 'full',
      resourceKind: '',
      inputSeal: result.receipt.header.inputSeal,
      inputIdentities: result.documents.map(({ receipt }) => ({
        moduleId: receipt.header.moduleId, format: receipt.header.format,
        status: receipt.status, seal: receipt.seal,
      })),
      f4bArguments: invocation.args,
    },
  };
}

function runWithWorkLimit(modules, maxWorkSteps) {
  return moduleSetTest.runModuleSetWithOptions(runDocument, () => {
    const state = loadPolicy();
    const policy = structuredClone(state.policy);
    policy.profileLimits.maxWorkSteps = maxWorkSteps;
    validatePolicy(policy);
    return { ...state, policy };
  }, modules, {});
}

function minimumWorkLimit(modules) {
  let low = 1;
  let high = loadPolicy().policy.profileLimits.maxWorkSteps;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (runWithWorkLimit(modules, middle).receipt.status === 'fatal') low = middle + 1;
    else high = middle;
  }
  return low;
}

const rejectedModule = (moduleId) => ({
  moduleId,
  source: 'page route="/missing-name"\n',
});

const moduleWithUses = (moduleId, targets) => ({
  moduleId,
  source: `${targets.map((target) => `use path="./${target.replace(/\.kern$/u, '')}"`).join('\n')}\nfn name=main export=true\n`,
});

function graphFields(result) {
  return result.fields.slice(2, 7);
}

function comparableGraph(receipt) {
  return {
    rejected: receipt.rejected,
    blocked: receipt.blocked,
    linkFacts: receipt.linkFacts,
    validatedComponents: receipt.validatedComponents.map(({ componentMinimumId, members }) => ({
      componentMinimumId, members,
    })),
    bindings: receipt.bindings,
  };
}

function assertReference(modules) {
  const result = runModuleSet(modules);
  assert.deepEqual(comparableGraph(result.receipt), referenceModuleGraph(modules, result.documents));
  return result;
}

function permutations(values) {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) => permutations(values.filter((_, other) => other !== index))
    .map((tail) => [value, ...tail]));
}

test('M2 format fence advances the canonical graph result to explicit .4', () => {
  const result = runModuleSet([
    { moduleId: 'main.kern', source: 'fn name=main export=true\n' },
  ]);
  assert.equal(result.receipt.header.format, 'kern.frontend.f4-module-set.4');
});

test('M2 canonical graph fields are independent of request order', () => {
  const provider = { moduleId: 'provider.kern', source: 'fn name=x export=true\n' };
  const middle = {
    moduleId: 'middle.kern',
    source: 'use path="./provider"\n  from name=x as=y export=true\nfn name=middle export=true\n',
  };
  const consumer = {
    moduleId: 'consumer.kern',
    source: 'use path="./middle"\n  from name=y\nfn name=consumer export=true\n',
  };
  const forward = runModuleSet([provider, middle, consumer]);
  const reversed = runModuleSet([consumer, middle, provider]);

  assert.deepEqual(graphFields(reversed), graphFields(forward));
  assert.notDeepEqual(
    reversed.receipt.header.inputIdentityTape,
    forward.receipt.header.inputIdentityTape,
    'request-order identity remains an independent commitment',
  );
});

test('M2 rejected rows sort by canonical module ID', () => {
  const receipt = runModuleSet([
    rejectedModule('z-rejected.kern'),
    rejectedModule('a-rejected.kern'),
  ]).receipt;
  assert.deepEqual(receipt.rejected.map(({ moduleId }) => moduleId), [
    'a-rejected.kern',
    'z-rejected.kern',
  ]);
});

test('M2 blocked rows carry the lexicographically smallest reachable rejected dependency', () => {
  const receipt = runModuleSet([
    rejectedModule('z-rejected.kern'),
    rejectedModule('a-rejected.kern'),
    moduleWithUses('path.kern', ['a-rejected.kern']),
    moduleWithUses('importer.kern', ['z-rejected.kern', 'path.kern']),
  ]).receipt;
  const reasons = new Map(receipt.blocked.map((row) => [row.moduleId, row.rejectedDependency]));

  assert.equal(reasons.get('path.kern'), 'a-rejected.kern');
  assert.equal(reasons.get('importer.kern'), 'a-rejected.kern');
});

test('M2 whole-graph SCC propagation canonicalizes a cyclic blocked component', () => {
  const receipt = runModuleSet([
    rejectedModule('z-rejected.kern'),
    rejectedModule('a-rejected.kern'),
    moduleWithUses('x.kern', ['z-rejected.kern', 'y.kern']),
    moduleWithUses('y.kern', ['a-rejected.kern', 'x.kern']),
  ]).receipt;
  const reasons = new Map(receipt.blocked.map((row) => [row.moduleId, row.rejectedDependency]));

  assert.equal(reasons.get('x.kern'), 'a-rejected.kern');
  assert.equal(reasons.get('y.kern'), 'a-rejected.kern');
  assert.equal(receipt.linkFacts.some(({ code }) => code === 'module-cycle'), false);
});

test('M2 emits real SCC members and one sourced cycle fact per cyclic V component', () => {
  const receipt = runModuleSet([
    moduleWithUses('b.kern', ['a.kern']),
    moduleWithUses('a.kern', ['b.kern']),
    { moduleId: 'c.kern', source: 'fn name=c export=true\n' },
  ]).receipt;

  for (const component of receipt.validatedComponents) {
    assert.equal(typeof component.componentMinimumId, 'string');
    assert.ok(Array.isArray(component.members));
  }
  assert.deepEqual(receipt.validatedComponents.map(({ componentMinimumId, members }) => ({
    componentMinimumId,
    members: members.map(({ moduleId }) => moduleId),
  })), [
    { componentMinimumId: 'a.kern', members: ['a.kern', 'b.kern'] },
    { componentMinimumId: 'c.kern', members: ['c.kern'] },
  ]);
  const cycles = receipt.linkFacts.filter(({ code }) => code === 'module-cycle');
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].moduleId, 'b.kern');
  assert.equal(cycles[0].detail, 'a.kern');
  assert.ok(Number.isSafeInteger(cycles[0].logicalOrdinal));
  assert.ok(Number.isSafeInteger(cycles[0].startScalar));
});

test('M2 duplicate topology edges retain the canonical minimum-position DFS witness', () => {
  const modules = [
    moduleWithUses('a.kern', ['b.kern']),
    moduleWithUses('b.kern', ['a.kern', 'a.kern']),
  ];
  const result = assertReference(modules);
  const bDocument = result.documents.find(({ receipt }) => receipt.header.moduleId === 'b.kern');
  const candidates = bDocument.receipt.bindings.filter(({ targetModuleId }) => targetModuleId === 'a.kern');
  assert.equal(candidates.length, 2);
  const expected = candidates.toSorted((left, right) =>
    left.startScalar - right.startScalar || left.logicalOrdinal - right.logicalOrdinal)[0];
  const cycles = result.receipt.linkFacts.filter(({ code }) => code === 'module-cycle');
  assert.equal(cycles.length, 1);
  assert.deepEqual(
    [cycles[0].moduleId, cycles[0].detail, cycles[0].logicalOrdinal, cycles[0].startScalar],
    ['b.kern', 'a.kern', expected.logicalOrdinal, expected.startScalar],
  );
});

test('M2 self-loops and disjoint cycles emit one canonically ordered sourced fact per SCC', () => {
  const result = assertReference([
    moduleWithUses('self.kern', ['self.kern']),
    moduleWithUses('a.kern', ['b.kern']),
    moduleWithUses('b.kern', ['a.kern']),
    moduleWithUses('x.kern', ['y.kern']),
    moduleWithUses('y.kern', ['x.kern']),
  ]);
  assert.deepEqual(result.receipt.linkFacts.map(({ code, moduleId, detail }) => ({ code, moduleId, detail })), [
    { code: 'module-cycle', moduleId: 'b.kern', detail: 'a.kern' },
    { code: 'module-cycle', moduleId: 'self.kern', detail: 'self.kern' },
    { code: 'module-cycle', moduleId: 'y.kern', detail: 'x.kern' },
  ]);
});

test('M2 cycle witness is a true DFS back edge rather than a smaller internal chord', () => {
  const result = assertReference([
    moduleWithUses('a.kern', ['b.kern', 'c.kern']),
    moduleWithUses('b.kern', ['c.kern']),
    moduleWithUses('c.kern', ['a.kern']),
  ]);
  const cycles = result.receipt.linkFacts.filter(({ code }) => code === 'module-cycle');
  assert.equal(cycles.length, 1);
  assert.deepEqual([cycles[0].moduleId, cycles[0].detail], ['c.kern', 'a.kern']);
});

test('M2 resolved bindings retain authenticated source positions', () => {
  const receipt = runModuleSet([
    {
      moduleId: 'provider.kern',
      source: 'fn name=x export=true\nfn name=y export=true\n',
    },
    {
      moduleId: 'main.kern',
      source: 'use path="./provider"\n  from name=x\n  from name=y\nfn name=main export=true\n',
    },
  ]).receipt;

  assert.equal(receipt.status, 'linked');
  assert.equal(receipt.bindings.length, 2);
  assert.ok(receipt.bindings.every(({ logicalOrdinal, startScalar }) =>
    Number.isSafeInteger(logicalOrdinal) && Number.isSafeInteger(startScalar)));
  assert.notEqual(receipt.bindings[0].logicalOrdinal, receipt.bindings[1].logicalOrdinal);
  assert.ok(receipt.bindings[0].startScalar < receipt.bindings[1].startScalar);
});

test('M2 decoder rejects binding and fact positions outside the authenticated interface transport', () => {
  const bindingModules = [
    { moduleId: 'provider.kern', source: 'fn name=x export=true\n' },
    { moduleId: 'consumer.kern', source: 'use path="./provider"\n  from name=x\n' },
  ];
  const binding = capturedModuleSet(bindingModules);
  const bindingFields = [...binding.result.fields];
  const bindingRows = rows(bindingFields[6], 'binding');
  bindingRows[0][7] = String(Number(bindingRows[0][7]) + 1);
  bindingFields[6] = tape(bindingRows.map(tape));
  assert.throws(() => decodeModuleSet(bindingFields, binding.context), /binding position/u);

  const cycleModules = [moduleWithUses('b.kern', ['a.kern']), moduleWithUses('a.kern', ['b.kern'])];
  const cycle = capturedModuleSet(cycleModules);
  const factFields = [...cycle.result.fields];
  const factRows = rows(factFields[4], 'fact');
  factRows[0][3] = String(Number(factRows[0][3]) + 1);
  factFields[4] = tape(factRows.map(tape));
  assert.throws(() => decodeModuleSet(factFields, cycle.context), /fact position/u);
});

test('M2 decoder keeps fatal vocabulary separate and rejects duplicate canonical partitions', () => {
  const fatalFields = [
    'kern.frontend.f4-module-set.4', 'fatal', '', '', tape([tape(['missing-module', '', ''])]),
    '', '', '', '', 'failure',
  ];
  assert.throws(() => decodeModuleSet(fatalFields, {}), /link fact code/u);

  const rejected = capturedModuleSet([
    rejectedModule('a-rejected.kern'),
    { moduleId: 'visible.kern', source: 'fn name=visible export=true\n' },
  ]);
  const rejectedFields = [...rejected.result.fields];
  const rejectedRows = listTape(rejectedFields[2], 'rejected');
  rejectedFields[2] = tape([rejectedRows[0], rejectedRows[0]]);
  rejectedFields[9] = rejectedFields[9].replace('module-set:rejected:2:1:', 'module-set:rejected:2:2:');
  assert.throws(() => decodeModuleSet(rejectedFields, rejected.context), /rejected order/u);

  const blocked = capturedModuleSet([
    rejectedModule('a-rejected.kern'),
    moduleWithUses('blocked.kern', ['a-rejected.kern']),
  ]);
  const blockedFields = [...blocked.result.fields];
  const blockedRows = listTape(blockedFields[3], 'blocked');
  blockedFields[3] = tape([blockedRows[0], blockedRows[0]]);
  blockedFields[9] = blockedFields[9].replace('module-set:rejected:2:1:1:', 'module-set:rejected:2:1:2:');
  assert.throws(() => decodeModuleSet(blockedFields, blocked.context), /blocked order/u);
});

test('M2 independent reference recomputes partitions, SCCs, witnesses, facts, and bindings', () => {
  assertReference([
    rejectedModule('z-rejected.kern'),
    rejectedModule('a-rejected.kern'),
    moduleWithUses('x.kern', ['z-rejected.kern', 'y.kern']),
    moduleWithUses('y.kern', ['a-rejected.kern', 'x.kern']),
  ]);
  assertReference([
    moduleWithUses('b.kern', ['a.kern']),
    moduleWithUses('a.kern', ['b.kern']),
    { moduleId: 'c.kern', source: 'fn name=c export=true\n' },
  ]);
});

test('M2 independent reference recomputes every ordinary binding fact family', () => {
  const fixtures = [
    [{ moduleId: 'main.kern', source: 'use path="./missing"\nfn name=main export=true\n' }],
    [
      { moduleId: 'lib.kern', source: 'fn name=present export=true\n' },
      { moduleId: 'main.kern', source: 'use path="./lib"\n  from name=absent\n' },
    ],
    [
      { moduleId: 'lib.kern', source: 'fn name=x export=true\n' },
      { moduleId: 'main.kern', source: 'use path="./lib"\n  from name=x kind=class\n' },
    ],
    [
      { moduleId: 'lib.kern', source: 'fn name=x export=true\n' },
      { moduleId: 'main.kern', source: 'use path="./lib"\n  from name=x as=same\n  from name=x as=same\n' },
    ],
  ];
  for (const modules of fixtures) assertReference(modules);
});

test('M2 independent reference matches twenty re-export request permutations', () => {
  const modules = [
    { moduleId: 'base.kern', source: 'fn name=x export=true\n' },
    { moduleId: 'middle.kern', source: 'use path="./base"\n  from name=x export=true\n' },
    { moduleId: 'top.kern', source: 'use path="./middle"\n  from name=x export=true\n' },
    { moduleId: 'consumer.kern', source: 'use path="./top"\n  from name=x\n' },
  ];
  for (const permutation of permutations(modules).slice(0, 20)) assertReference(permutation);
});

test('M2 work limits cover canonical sort, SCC, quarantine, re-export, and output folds exactly', () => {
  const families = [
    [
      { moduleId: 'base.kern', source: 'fn name=x export=true\n' },
      { moduleId: 'middle.kern', source: 'use path="./base"\n  from name=x export=true\n' },
      { moduleId: 'consumer.kern', source: 'use path="./middle"\n  from name=x\n' },
    ],
    [moduleWithUses('b.kern', ['a.kern']), moduleWithUses('a.kern', ['b.kern'])],
    [rejectedModule('bad.kern'), moduleWithUses('blocked.kern', ['bad.kern'])],
  ];
  const minima = families.map(minimumWorkLimit);
  for (let index = 0; index < families.length; index += 1) {
    assert.notEqual(runWithWorkLimit(families[index], minima[index]).receipt.status, 'fatal');
    assert.deepEqual(runWithWorkLimit(families[index], minima[index] - 1).receipt.linkFacts.map(({ code }) => code), [
      'F4_LIMIT',
    ]);
  }
  assert.ok(minima[0] > 1 && minima[1] > 1 && minima[2] > 1);
});

test('M2 bounded chain and cycle families have monotone charged work', () => {
  const chain = (count) => Array.from({ length: count }, (_, index) => ({
    moduleId: `chain-${index}.kern`,
    source: index + 1 < count
      ? `use path="./chain-${index + 1}"\nfn name=n${index} export=true\n`
      : `fn name=n${index} export=true\n`,
  }));
  const cycle = (count) => Array.from({ length: count }, (_, index) => ({
    moduleId: `cycle-${index}.kern`,
    source: `use path="./cycle-${(index + 1) % count}"\nfn name=n${index} export=true\n`,
  }));
  const chainWork = [2, 3, 4].map((count) => minimumWorkLimit(chain(count)));
  const cycleWork = [2, 3, 4].map((count) => minimumWorkLimit(cycle(count)));
  assert.ok(chainWork[0] < chainWork[1] && chainWork[1] < chainWork[2]);
  assert.ok(cycleWork[0] < cycleWork[1] && cycleWork[1] < cycleWork[2]);
});
