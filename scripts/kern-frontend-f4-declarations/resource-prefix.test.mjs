import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { VALID_MODULE_SET } from './fixtures.mjs';
import { listTape } from './decoder.mjs';
import { decodeModuleSet } from './module-set-decoder.mjs';
import { __test as moduleSetTest, runModuleSetWith } from './module-set-worker.mjs';
import { __test, loadPolicy, runDocument, runModuleSet, validatePolicy } from './worker.mjs';

const ABI_NAMES = [
  'moduleIds', 'mode', 'resourceKind', 'f4aModuleIds', 'f4aFormats', 'f4aStatuses', 'f4aSeals',
  'interfaceBlocks', 'maxModules', 'maxSymbols', 'maxBindings', 'maxWorkSteps', 'forceLateFailure',
  'maxModuleIdScalars', 'maxModuleIdSegments', 'maxImportSpecifierScalars',
  'maxImportSpecifierSegments', 'maxEncodedBytes',
];
const ABI_TYPES = [
  'string[]', 'string', 'string', 'string[]', 'string[]', 'string[]', 'string[]', 'string[]',
  'number', 'number', 'number', 'number', 'boolean', 'number', 'number', 'number', 'number', 'number',
];
const FROZEN_MODULE_SET_2_FIELDS = Object.freeze([
  'kern.frontend.f4-module-set.2', 'linked', '', '', '', '', '', '',
  'module-set:linked:0:0:0:0:0:0:0:closed',
]);

function policyWith(overrides = {}) {
  const state = loadPolicy();
  const policy = structuredClone(state.policy);
  Object.assign(policy.profileLimits, overrides);
  return { ...state, policy };
}

function events() {
  const seen = [];
  return { seen, observe: (event) => seen.push(event) };
}

function stages(seen) {
  return seen.map(({ stage }) => stage);
}

function candidate(modules, options = {}, profile = {}) {
  const captured = events();
  let result;
  let error;
  try {
    result = moduleSetTest.runModuleSetWithOptions(
      runDocument, () => policyWith(profile), modules,
      { mode: options.mode ?? 'full', ...options, observe: captured.observe },
    );
  } catch (caught) {
    error = caught;
  }
  return { ...captured, result, error };
}

function actualModuleSet(modules, profile = {}) {
  const captured = events();
  let result;
  let error;
  try {
    result = moduleSetTest.runModuleSetWithOptions(
      runDocument, () => policyWith(profile), modules, { observe: captured.observe },
    );
  } catch (caught) {
    error = caught;
  }
  return { ...captured, result, error };
}

function atomicFatal(receipt, code) {
  assert.equal(receipt.status, 'fatal');
  assert.deepEqual(receipt.rejected, []);
  assert.deepEqual(receipt.blocked, []);
  assert.deepEqual(receipt.modules, []);
  assert.deepEqual(receipt.bindings, []);
  assert.deepEqual(receipt.linkFacts.map(({ code: actual }) => actual), [code]);
}

function f4bArgs(run) {
  const invocation = run.seen.find(({ stage }) => stage === 'f4b');
  assert.ok(invocation, 'one real F4B invocation must be observed');
  return invocation.args;
}

function assertNoReceipt(run) {
  assert.ok(run.error, 'outer ABI/type/runtime rejection must throw without a receipt');
  assert.equal(run.result, undefined);
}

function fullModules() {
  return [
    { moduleId: 'one.kern', source: 'fn name=one export=true\n' },
    { moduleId: 'two.kern', source: 'fn name=two export=true\n' },
  ];
}

function bindingModules() {
  return [
    { moduleId: 'one.kern', source: 'use path="./one"\n  from name=one kind=fn\nfn name=one export=true\n' },
    { moduleId: 'two.kern', source: 'fn name=two export=true\n' },
  ];
}

function oneBased(fields) {
  return Object.fromEntries(fields.map((value, index) => [index + 1, value]));
}

function encodedBytes(fields) {
  return fields.reduce((total, field) => total + Buffer.byteLength(field, 'utf8'), 0);
}

function frame(value) {
  return `i${Array.from(value).length}:${value}`;
}

function tape(values) {
  return values.map(frame).join('');
}

function rows(value) {
  return listTape(value, 'test tape').map((row) => listTape(row, 'test row'));
}

function assertProofFields(fields, { kind, modules, prefix, priorSymbols, priorBindings, crossingSymbols, crossingBindings }) {
  assert.equal(fields.length, 10);
  const mapped = oneBased(fields);
  assert.equal(mapped[1], 'kern.frontend.f4-module-set.4');
  assert.equal(mapped[2], 'fatal');
  for (const index of [3, 4, 6, 7, 8]) assert.equal(mapped[index], '', `proof field ${index}`);
  assert.deepEqual(rows(mapped[5]).map(([code]) => code), ['F4_LIMIT']);
  const witnessRows = rows(mapped[9]);
  assert.equal(witnessRows.length, 1);
  assert.deepEqual(witnessRows[0], [
    'resource-prefix', kind, String(modules), String(prefix), String(priorSymbols), String(priorBindings),
    String(crossingSymbols), String(crossingBindings),
  ]);
  assert.equal(mapped[10], `module-set:fatal:${modules}:0:0:1:0:0:0:${Array.from(mapped[9]).length}:${kind}:closed`);
}

test('public ordinary full calls target a sealed .4 result and cannot fork through a private argument shape', () => {
  const result = runModuleSet(VALID_MODULE_SET);
  assert.equal(result.receipt.header.format, 'kern.frontend.f4-module-set.4');
  assert.equal(result.moduleSetRuntimeInvocations, 1);
});

test('RP1 policy pins .4, the 18-slot F4B ABI, result .4, and closed mode vocabulary', () => {
  const { policy } = loadPolicy();
  assert.equal(policy.format, 'kern.frontend.f4-declarations-policy.4');
  assert.equal(policy.moduleSetResultFormat, 'kern.frontend.f4-module-set.4');
  assert.deepEqual(Object.keys(policy.moduleSetPrivateAbi), [
    'arity', 'argumentOrder', 'argumentTypes', 'modes', 'resourceKinds',
  ]);
  assert.equal(policy.moduleSetPrivateAbi.arity, 18);
  assert.deepEqual(policy.moduleSetPrivateAbi.argumentOrder, ABI_NAMES);
  assert.deepEqual(policy.moduleSetPrivateAbi.argumentTypes, ABI_TYPES);
  assert.deepEqual(policy.moduleSetPrivateAbi.modes, ['full', 'resource-prefix']);
  assert.deepEqual(policy.moduleSetPrivateAbi.resourceKinds, ['maxModules', 'maxSymbols', 'maxBindings']);
  assert.doesNotThrow(() => validatePolicy(policy));
});

test('RP1 candidate captures the real 18 argument call and identifies the current ABI RED', () => {
  const run = candidate(VALID_MODULE_SET);
  assert.deepEqual(stages(run.seen), ['f4a', 'f4a', 'f4b']);
  assert.equal(f4bArgs(run).length, 18);
  assert.equal(run.error, undefined, `18-slot F4B must be runtime-admitted: ${run.error?.message ?? ''}`);
});

test('RP2/RP6 maxModules overflow runs zero F4A calls, one real F4B call, and preserves invalid-suffix dominance', () => {
  const overflow = actualModuleSet(fullModules(), { maxModules: 1 });
  assert.deepEqual(stages(overflow.seen), ['f4b']);
  assert.equal(f4bArgs(overflow).length, 18);
  atomicFatal(overflow.result.receipt, 'F4_LIMIT');

  const invalidSuffix = actualModuleSet([
    { moduleId: 'one.kern', source: '' },
    { moduleId: 'not-a-module-id', source: '' },
  ], { maxModules: 1 });
  assert.deepEqual(stages(invalidSuffix.seen), ['f4b']);
  atomicFatal(invalidSuffix.result.receipt, 'F4_INVALID_REQUEST');

  const duplicateSuffix = actualModuleSet([
    { moduleId: 'one.kern', source: '' },
    { moduleId: 'one.kern', source: '' },
  ], { maxModules: 1 });
  assert.deepEqual(stages(duplicateSuffix.seen), ['f4b']);
  atomicFatal(duplicateSuffix.result.receipt, 'F4_INVALID_REQUEST');
});

test('RP8/RP9 derive exact compact proofs from actual maxModules, symbol, binding, and k=M crossings', async (t) => {
  const cases = [
    ['maxModules', fullModules(), { maxModules: 1 }, ['f4b'], {
      kind: 'maxModules', modules: 2, prefix: 0, priorSymbols: 0, priorBindings: 0,
      crossingSymbols: 0, crossingBindings: 0,
    }],
    ['symbols', fullModules(), { maxSymbols: 0 }, ['f4a', 'f4b'], {
      kind: 'maxSymbols', modules: 2, prefix: 1, priorSymbols: 0, priorBindings: 0,
      crossingSymbols: 1, crossingBindings: 0,
    }],
    ['bindings', bindingModules(), { maxBindings: 0 }, ['f4a', 'f4b'], {
      kind: 'maxBindings', modules: 2, prefix: 1, priorSymbols: 0, priorBindings: 0,
      crossingSymbols: 1, crossingBindings: 2,
    }],
    ['k=M symbols', fullModules(), { maxSymbols: 1 }, ['f4a', 'f4a', 'f4b'], {
      kind: 'maxSymbols', modules: 2, prefix: 2, priorSymbols: 1, priorBindings: 0,
      crossingSymbols: 2, crossingBindings: 0,
    }],
  ];
  for (const [label, modules, profile, expectedStages, expectedProof] of cases) {
    await t.test(label, () => {
      const run = actualModuleSet(modules, profile);
      assert.deepEqual(stages(run.seen), expectedStages);
      assert.equal(f4bArgs(run).length, 18);
      assertProofFields(run.result.fields, expectedProof);
      atomicFatal(run.result.receipt, 'F4_LIMIT');
    });
  }
});

test('RP6 rejects a zero-prefix below cap and stops at first complete symbol, binding, and tie crossings', () => {
  const zero = candidate([{ moduleId: 'one.kern', source: '' }], {
    mode: 'resource-prefix', resourceKind: 'maxModules',
    mutateArguments(args) {
      for (const index of [3, 4, 5, 6, 7]) args[index] = [];
    },
  }, { maxModules: 1 });
  assert.equal(zero.error, undefined, `well-typed zero prefix must reach KERN: ${zero.error?.message ?? ''}`);
  atomicFatal(zero.result.receipt, 'F4_INVALID_REQUEST');

  const symbol = actualModuleSet(fullModules(), { maxSymbols: 0 });
  assert.deepEqual(stages(symbol.seen), ['f4a', 'f4b']);
  assert.equal(f4bArgs(symbol)[1], 'resource-prefix');
  assert.equal(f4bArgs(symbol)[2], 'maxSymbols');

  const binding = actualModuleSet(bindingModules(), { maxBindings: 0 });
  assert.deepEqual(stages(binding.seen), ['f4a', 'f4b']);
  assert.equal(f4bArgs(binding)[2], 'maxBindings');

  const tie = actualModuleSet(bindingModules(), { maxSymbols: 0, maxBindings: 0 });
  assert.deepEqual(stages(tie.seen), ['f4a', 'f4b']);
  assert.equal(f4bArgs(tie)[2], 'maxSymbols');
});

test('RP4/RP7 mutates captured real interface blocks and requires KERN invalid-request proofs', async (t) => {
  const cases = [
    ['forged positional identity', (args) => { args[3][0] = 'other.kern'; }],
    ['missing block', (args) => { args[7].pop(); }],
    ['malformed nested block', (args) => { args[7][0] = 'i3:bad'; }],
    ['trailing scalar', (args) => { args[7][0] += 'x'; }],
    ['cross-owner symbol', (args) => { args[7][0] = args[7][0].replace('one.kern', 'two.kern'); }],
    ['nonclassified nonempty', (args) => { args[5][0] = 'rejected'; }],
    ['fatal nonempty', (args) => { args[5][0] = 'fatal'; }],
    ['extra late block', (args) => { args[7].push(args[7][0]); }],
  ];
  for (const [label, mutateArguments] of cases) {
    await t.test(label, () => {
      const run = candidate(fullModules(), { mutateArguments });
      assert.equal(run.error, undefined, `${label} must be a KERN receipt, not an envelope failure`);
      atomicFatal(run.result.receipt, 'F4_INVALID_REQUEST');
    });
  }
});

test('RP4 rejects a noncanonical canonicalTarget and RP7 rejects a later invalid suffix behind a symbol prefix', () => {
  const target = candidate(bindingModules(), {
    mutateArguments(args) {
      const outer = listTape(args[7][0], 'outer');
      const inner = listTape(outer[0], 'inner');
      const bindings = listTape(inner[1], 'bindings');
      const fields = listTape(bindings[0], 'binding');
      fields[1] = '../escape.kern';
      inner[1] = tape([tape(fields)]);
      args[7][0] = tape([tape(inner)]);
    },
  });
  assert.equal(target.error, undefined, `noncanonical target must reach KERN: ${target.error?.message ?? ''}`);
  atomicFatal(target.result.receipt, 'F4_INVALID_REQUEST');

  const suffix = candidate([
    { moduleId: 'one.kern', source: 'fn name=one export=true\n' },
    { moduleId: 'bad', source: '' },
  ], { mode: 'resource-prefix', resourceKind: 'maxSymbols' }, { maxSymbols: 0 });
  assert.equal(suffix.error, undefined, `invalid suffix behind a prefix must reach KERN: ${suffix.error?.message ?? ''}`);
  atomicFatal(suffix.result.receipt, 'F4_INVALID_REQUEST');
});

test('RP5 full overflow is invalid-request rather than a retroactive resource proof', () => {
  const run = candidate(fullModules(), {}, { maxSymbols: 0 });
  assert.equal(run.error, undefined, `full-mode cap verdict must reach KERN: ${run.error?.message ?? ''}`);
  atomicFatal(run.result.receipt, 'F4_INVALID_REQUEST');
});

test('RP8/RP9 expose only the one-based ten-field .4 full and proof shapes from real execution', () => {
  const full = candidate([{ moduleId: 'earth🌍.kern', source: '' }]);
  assert.equal(full.error, undefined, `full .4 receipt must be produced: ${full.error?.message ?? ''}`);
  assert.equal(full.result.fields.length, 10);
  const mapped = oneBased(full.result.fields);
  assert.equal(mapped[1], 'kern.frontend.f4-module-set.4');
  assert.equal(mapped[2], 'linked');
  assert.match(mapped[8], /🌍/u, 'astral scalar must participate in the actual identity tape');
  assert.equal(mapped[9], '');
  assert.match(mapped[10], /^module-set:linked:1:0:0:0:1:0:[0-9]+:0:full:closed$/u);
  assert.deepEqual(decodeModuleSet(full.result.fields, {
    moduleCount: 1, moduleIds: ['earth🌍.kern'], mode: 'full', resourceKind: '', inputSeal: full.result.receipt.header.inputSeal,
    inputIdentities: full.result.documents.map(({ receipt }) => ({
      moduleId: receipt.header.moduleId,
      format: receipt.header.format,
      status: receipt.status,
      seal: receipt.seal,
    })),
  }).header.inputIdentityTape.map(({ moduleId }) => moduleId), ['earth🌍.kern']);
});

test('RP9 fences a frozen nine-field .2 receipt while the public .4 path remains decodable', () => {
  assert.equal(FROZEN_MODULE_SET_2_FIELDS.length, 9, 'legacy .2 fixture must remain genuinely nine-field');
  assert.throws(() => decodeModuleSet(FROZEN_MODULE_SET_2_FIELDS, {
    moduleCount: 0, moduleIds: [], mode: 'full', resourceKind: '', inputSeal: '', inputIdentities: [],
  }), /module-set field shape/u);

  const run = candidate(VALID_MODULE_SET);
  assert.equal(run.error, undefined);
  const current = run.result;
  assert.equal(current.receipt.header.format, 'kern.frontend.f4-module-set.4');
  assert.doesNotThrow(() => decodeModuleSet(current.fields, {
    moduleCount: VALID_MODULE_SET.length,
    moduleIds: VALID_MODULE_SET.map(({ moduleId }) => moduleId), mode: 'full', resourceKind: '',
    inputSeal: current.receipt.header.inputSeal,
    inputIdentities: current.documents.map(({ receipt }) => ({
      moduleId: receipt.header.moduleId,
      format: receipt.header.format,
      status: receipt.status,
      seal: receipt.seal,
    })),
    f4bArguments: f4bArgs(run),
  }));
  assert.ok(current.documents.every(({ receipt }) => receipt.header.format === 'kern.frontend.f4-document.2'));
});

test('RP10 derives exact UTF-8 ten-field boundaries from a real astral full receipt', () => {
  const high = candidate([{ moduleId: 'earth🌍.kern', source: '' }], {}, { maxEncodedBytes: 1_000_000 });
  assert.equal(high.error, undefined, `high-cap full receipt must be available: ${high.error?.message ?? ''}`);
  const bytes = encodedBytes(high.result.fields);
  const exact = candidate([{ moduleId: 'earth🌍.kern', source: '' }], {}, { maxEncodedBytes: bytes });
  assert.equal(exact.error, undefined);
  assert.equal(exact.result.receipt.status, 'linked');
  const oneLess = candidate([{ moduleId: 'earth🌍.kern', source: '' }], {}, { maxEncodedBytes: bytes - 1 });
  assert.equal(oneLess.error, undefined);
  atomicFatal(oneLess.result.receipt, 'F4_LIMIT');
  const fields = oneBased(oneLess.result.fields);
  for (const index of [3, 4, 6, 7, 8, 9]) assert.equal(fields[index], '', `full byte fatal field ${index}`);
  assert.equal(fields[10], 'failure');
});

test('F4 byte authorities use only public Text.utf8Length', () => {
  const moduleOutput = readFileSync(
    new URL('../../examples/kern-frontend/f4-module-set-output.kern', import.meta.url), 'utf8',
  );
  const diagnosticMerge = readFileSync(
    new URL('../../examples/kern-frontend/f4-diagnostic-merge.kern', import.meta.url), 'utf8',
  );
  assert.doesNotMatch(moduleOutput, /f4butf8bytes/u);
  assert.doesNotMatch(diagnosticMerge, /f4diagutf8bytes/u);
  assert.match(moduleOutput, /Text\.utf8Length/u);
  assert.match(diagnosticMerge, /Text\.utf8Length/u);
});

test('RP10 cap 62 reaches real F4B and returns a KERN F4_LIMIT instead of a runtime-envelope preemption', () => {
  const run = candidate([{ moduleId: 'one.kern', source: '' }], {
    mutateArguments(args) { args[17] = 62; },
  });
  assert.equal(f4bArgs(run).length, 18);
  assert.equal(f4bArgs(run)[17], 62);
  assert.equal(run.error, undefined, `KERN must return a receipt at cap 62: ${run.error?.message ?? ''}`);
  atomicFatal(run.result.receipt, 'F4_LIMIT');
});

test('RP10 policy rejects one byte below the actual minimal non-proof fatal floor', () => {
  const high = candidate([{ moduleId: 'earth🌍.kern', source: '' }], {}, { maxEncodedBytes: 1_000_000 });
  assert.equal(high.error, undefined, `real full receipt must be available: ${high.error?.message ?? ''}`);
  const overflow = candidate([{ moduleId: 'earth🌍.kern', source: '' }], {}, {
    maxEncodedBytes: encodedBytes(high.result.fields) - 1,
  });
  assert.equal(overflow.error, undefined, `real non-proof F4_LIMIT must be available: ${overflow.error?.message ?? ''}`);
  atomicFatal(overflow.result.receipt, 'F4_LIMIT');
  const floor = encodedBytes(overflow.result.fields);
  const state = policyWith({ maxEncodedBytes: floor - 1 });
  state.policy.format = 'kern.frontend.f4-declarations-policy.4';
  state.policy.moduleSetResultFormat = 'kern.frontend.f4-module-set.4';
  state.policy.moduleSetPrivateAbi = {
    arity: 18, argumentOrder: ABI_NAMES, argumentTypes: ABI_TYPES,
    modes: ['full', 'resource-prefix'], resourceKinds: ['maxModules', 'maxSymbols', 'maxBindings'],
  };
  assert.throws(() => validatePolicy(state.policy), /encoded|byte|limit/u);
});

test('RP2 charges a manifest-scan debit while deferring its verdict until later invalid or duplicate IDs', () => {
  const invalid = candidate([
    { moduleId: 'one.kern', source: '' }, { moduleId: 'bad', source: '' },
  ], {}, { maxWorkSteps: 1 });
  assert.equal(invalid.error, undefined);
  atomicFatal(invalid.result.receipt, 'F4_INVALID_REQUEST');
  const duplicate = candidate([
    { moduleId: 'one.kern', source: '' }, { moduleId: 'one.kern', source: '' },
  ], {}, { maxWorkSteps: 1 });
  assert.equal(duplicate.error, undefined);
  atomicFatal(duplicate.result.receipt, 'F4_INVALID_REQUEST');
  const valid = candidate(fullModules(), {}, { maxWorkSteps: 1 });
  assert.equal(valid.error, undefined);
  atomicFatal(valid.result.receipt, 'F4_LIMIT');
});

test('RP1/RP3 rejects outer arity/type envelopes without receipts and gives KERN invalid-request for admitted modes', () => {
  for (const mutateArguments of [
    (args) => { args.pop(); },
    (args) => { args.push(0); },
    (args) => { args[0] = 'not-an-array'; },
  ]) {
    const run = candidate(VALID_MODULE_SET, { mutateArguments });
    assertNoReceipt(run);
  }
  for (const [mode, resourceKind] of [['unknown', ''], ['full', 'maxSymbols'], ['resource-prefix', 'unknown']]) {
    const run = candidate(VALID_MODULE_SET, { mode, resourceKind });
    assert.equal(run.error, undefined, `${mode}/${resourceKind} must reach KERN`);
    atomicFatal(run.result.receipt, 'F4_INVALID_REQUEST');
  }
});

test('RP6 producer infrastructure exceptions propagate before any real F4B invocation', () => {
  const captured = events();
  assert.throws(() => moduleSetTest.runModuleSetWithOptions(
    (moduleId) => { throw new Error(`producer ${moduleId}`); }, loadPolicy,
    [{ moduleId: 'one.kern', source: '' }], { observe: captured.observe },
  ), /producer one\.kern/u);
  assert.deepEqual(stages(captured.seen), ['f4a']);
});
