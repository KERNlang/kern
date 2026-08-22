import assert from 'node:assert/strict';
import test from 'node:test';

import { QUARANTINE_MODULE_SET, VALID_MODULE_SET } from './fixtures.mjs';
import { decodeModuleSet } from './module-set-decoder.mjs';
import { runModuleSetWith } from './module-set-worker.mjs';
import { __test, loadPolicy, runDocument, runModuleSet } from './worker.mjs';

function codes(rows) {
  return rows.map((row) => row.code);
}

function assertAtomicModuleSetFatal(result, code) {
  assert.equal(result.moduleSetRuntimeInvocations, 1);
  assert.equal(result.receipt.status, 'fatal');
  assert.deepEqual(codes(result.receipt.linkFacts), [code]);
  assert.deepEqual(result.receipt.rejected, []);
  assert.deepEqual(result.receipt.blocked, []);
  assert.deepEqual(result.receipt.validatedComponents, []);
  assert.deepEqual(result.receipt.bindings, []);
  assert.deepEqual(result.receipt.modules, []);
  assert.deepEqual(result.receipt.header.inputIdentityTape, []);
}

function assertAtomicInvalidRequest(result) {
  assertAtomicModuleSetFatal(result, 'F4_INVALID_REQUEST');
}

function inputIdentityContext(result) {
  return {
    moduleCount: result.documents.length,
    moduleIds: result.documents.map(({ receipt }) => receipt.header.moduleId),
    mode: 'full',
    resourceKind: '',
    inputSeal: result.receipt.header.inputSeal,
    inputIdentities: result.documents.map(({ receipt }) => ({
      moduleId: receipt.header.moduleId,
      format: receipt.header.format,
      status: receipt.status,
      seal: receipt.seal,
    })),
  };
}

test('closed module set resolves aliases, default kind, and reexports in one F4B invocation', () => {
  const result = runModuleSet(VALID_MODULE_SET);
  assert.equal(result.documentRuntimeInvocations, VALID_MODULE_SET.length);
  assert.equal(result.moduleSetRuntimeInvocations, 1);
  assert.equal(result.receipt.status, 'linked');
  assert.deepEqual(result.receipt.rejected, []);
  assert.deepEqual(result.receipt.blocked, []);
  assert.deepEqual(result.receipt.linkFacts, []);
  assert.equal(result.receipt.bindings[0].sourceModuleId, 'lib/symbols.kern');
  assert.equal(result.receipt.bindings[0].imported, 'double');
  assert.equal(result.receipt.bindings[0].local, 'twice');
  assert.equal(result.receipt.bindings[0].kind, 'fn');
  assert.equal(result.receipt.bindings[0].reexport, true);
  assert.match(result.receipt.seal, /^[0-9a-f]{64}$/u);
});

test('from defaults alias to imported name, reexport false, and kind to target export kind', () => {
  const modules = [
    { moduleId: 'lib.kern', source: 'class name=User export=true\n' },
    { moduleId: 'main.kern', source: 'use path="./lib"\n  from name=User\nfn name=main export=true\n' },
  ];
  const { receipt } = runModuleSet(modules);
  assert.equal(receipt.status, 'linked');
  assert.deepEqual(receipt.bindings.map(({ imported, local, kind, reexport }) => ({ imported, local, kind, reexport })), [
    { imported: 'User', local: 'User', kind: 'class', reexport: false },
  ]);
});

test('re-export availability is independent of request order', () => {
  const provider = { moduleId: 'b.kern', source: 'fn name=x export=true\n' };
  const reexporter = {
    moduleId: 'a.kern',
    source: 'use path="./b"\n  from name=x export=true\n',
  };
  const consumer = {
    moduleId: 'c.kern',
    source: 'use path="./a"\n  from name=x\nfn name=c export=true\n',
  };
  const normalize = (receipt) => receipt.bindings.map((row) => [
    row.importerModuleId, row.sourceModuleId, row.imported, row.local, row.kind, row.reexport,
  ]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const consumerFirst = runModuleSet([consumer, reexporter, provider]).receipt;
  const providerFirst = runModuleSet([provider, reexporter, consumer]).receipt;

  for (const receipt of [consumerFirst, providerFirst]) {
    assert.equal(receipt.status, 'linked');
    assert.deepEqual(receipt.linkFacts, []);
  }
  assert.deepEqual(normalize(consumerFirst), normalize(providerFirst));
});

test('three-hop re-export availability reaches a consumer before every provider', () => {
  const base = { moduleId: 'base.kern', source: 'fn name=x export=true\n' };
  const middle = { moduleId: 'middle.kern', source: 'use path="./base"\n  from name=x export=true\n' };
  const top = { moduleId: 'top.kern', source: 'use path="./middle"\n  from name=x export=true\n' };
  const consumer = { moduleId: 'consumer.kern', source: 'use path="./top"\n  from name=x\n' };
  const normalize = (receipt) => receipt.bindings.map((row) => [
    row.importerModuleId, row.sourceModuleId, row.imported, row.local, row.kind, row.reexport,
  ]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const consumerFirst = runModuleSet([consumer, top, middle, base]).receipt;
  const providerFirst = runModuleSet([base, middle, top, consumer]).receipt;

  for (const receipt of [consumerFirst, providerFirst]) {
    assert.equal(receipt.status, 'linked');
    assert.deepEqual(receipt.linkFacts, []);
    assert.equal(receipt.bindings.length, 3);
  }
  assert.deepEqual(normalize(consumerFirst), normalize(providerFirst));
});

test('ungrounded or invalid re-exports never seed an export', () => {
  const ungrounded = runModuleSet([
    { moduleId: 'a.kern', source: 'use path="./b"\n  from name=x export=true\n' },
    { moduleId: 'b.kern', source: 'use path="./a"\n  from name=x export=true\n' },
  ]).receipt;
  assert.equal(ungrounded.status, 'rejected');
  assert.ok(codes(ungrounded.linkFacts).includes('missing-export'));

  const provider = { moduleId: 'b.kern', source: 'class name=x export=true\n' };
  for (const source of [
    'use path="./b"\n  from name=x kind=fn export=true\n',
    'fn name=x export=false\nuse path="./b"\n  from name=x as=x export=true\n',
    'use path="./b"\n  from name=x as=y\n  from name=x as=y export=true\n',
  ]) {
    const receipt = runModuleSet([
      provider,
      { moduleId: 'a.kern', source },
      { moduleId: 'c.kern', source: 'use path="./a"\n  from name=x\n' },
    ]).receipt;
    assert.equal(receipt.status, 'rejected');
    assert.ok(codes(receipt.linkFacts).includes('missing-export'));
  }
});

test('missing modules, exports, kind mismatches, duplicate bindings, and cycles use immutable codes', () => {
  const cases = [
    [[{ moduleId: 'a.kern', source: 'use path="./missing"\nfn name=a export=true\n' }], 'missing-module'],
    [[{ moduleId: 'lib.kern', source: 'fn name=x export=true\n' }, { moduleId: 'a.kern', source: 'use path="./lib"\n  from name=y\nfn name=a export=true\n' }], 'missing-export'],
    [[{ moduleId: 'lib.kern', source: 'class name=X export=true\n' }, { moduleId: 'a.kern', source: 'use path="./lib"\n  from name=X kind=fn\nfn name=a export=true\n' }], 'kind-mismatch'],
    [[{ moduleId: 'lib.kern', source: 'fn name=x export=true\n' }, { moduleId: 'a.kern', source: 'use path="./lib"\n  from name=x as=same\n  from name=x as=same\nfn name=a export=true\n' }], 'duplicate-local-binding'],
    [[{ moduleId: 'a.kern', source: 'use path="./b"\nfn name=a export=true\n' }, { moduleId: 'b.kern', source: 'use path="./a"\nfn name=b export=true\n' }], 'module-cycle'],
  ];

  for (const [modules, expected] of cases) {
    const { receipt } = runModuleSet(modules);
    assert.equal(receipt.status, 'rejected', expected);
    assert.ok(codes(receipt.linkFacts).includes(expected), `${expected}: ${codes(receipt.linkFacts).join(',')}`);
    assert.deepEqual(receipt.modules, [], expected);
    assert.deepEqual(receipt.bindings, [], expected);
  }
});

test('R/T/V quarantine blocks transitive importers and validates independent components', () => {
  const { receipt } = runModuleSet(QUARANTINE_MODULE_SET);
  assert.equal(receipt.status, 'rejected');
  assert.deepEqual(receipt.rejected.map((row) => row.moduleId), ['bad.kern']);
  assert.deepEqual(receipt.blocked.map((row) => [row.moduleId, row.rejectedDependency]), [
    ['blocked-transitive.kern', 'bad.kern'],
    ['blocked.kern', 'bad.kern'],
  ]);
  assert.deepEqual(receipt.linkFacts, []);
  assert.ok(receipt.validatedComponents.some((row) => row.moduleIds.length === 1 && row.moduleIds[0] === 'independent.kern'));
  assert.deepEqual(receipt.modules, []);
  assert.deepEqual(receipt.bindings, []);
});

test('module order and receipt identities participate in the terminal seal', () => {
  const forward = runModuleSet(VALID_MODULE_SET).receipt.seal;
  const reversed = runModuleSet([...VALID_MODULE_SET].reverse()).receipt.seal;
  assert.notEqual(forward, reversed);
});

test('F4B C19 oracle: one F4A .1 receipt fails atomically before graph work', () => {
  const result = __test.runModuleSetWithReceiptMutation(
    VALID_MODULE_SET,
    (document, moduleId) => {
      if (moduleId === 'lib/symbols.kern') document.header.format = 'kern.frontend.f4-document.1';
    },
  );
  assertAtomicInvalidRequest(result);
  assert.equal(result.documents.length, VALID_MODULE_SET.length);
});

test('F4B .4 identity tape exposes every F4A receipt seal as enumerable identity data', () => {
  const result = runModuleSet(VALID_MODULE_SET);
  const { receipt } = result;
  assert.deepEqual(receipt.header.inputIdentityTape, result.documents.map(({ receipt: document }) => ({
    moduleId: document.header.moduleId,
    format: document.header.format,
    status: document.status,
    seal: document.seal,
  })));
  for (const identity of receipt.header.inputIdentityTape) {
    assert.deepEqual(Object.keys(identity), ['moduleId', 'format', 'status', 'seal']);
    assert.match(JSON.stringify(identity), /"seal":"[0-9a-f]{64}"/u);
  }
  assert.equal(receipt.header.format, 'kern.frontend.f4-module-set.4');
});

test('F4B .4 treats a valid-shaped external seal as an identity commitment, not authentication', () => {
  const baseline = runModuleSet(QUARANTINE_MODULE_SET).receipt;
  const changed = __test.runModuleSetWithReceiptMutation(
    QUARANTINE_MODULE_SET,
    (document, moduleId) => {
      if (moduleId === 'blocked.kern') document.seal = 'a'.repeat(64);
    },
  ).receipt;
  assert.notEqual(changed.seal, baseline.seal);
  assert.equal(changed.status, 'rejected');
  assert.ok(changed.header.inputIdentityTape.some((row) =>
    row.moduleId === 'blocked.kern' && row.seal === 'a'.repeat(64)));
  assert.equal(changed.header.format, 'kern.frontend.f4-module-set.4');
});

test('F4B rejects malformed F4A seal shapes atomically before graph work', () => {
  for (const seal of ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), `${'a'.repeat(63)}g`]) {
    const result = __test.runModuleSetWithReceiptMutation(
      VALID_MODULE_SET,
      (document, moduleId) => {
        if (moduleId === 'main.kern') document.seal = seal;
      },
    );
    assertAtomicInvalidRequest(result);
  }
});

test('F4B rejects an empty receipt module-ID positional mismatch atomically before decoder drift', () => {
  let result;
  assert.doesNotThrow(() => {
    result = __test.runModuleSetWithReceiptMutation(
      [{ moduleId: 'empty.kern', source: '' }],
      (document) => { document.header.moduleId = 'other.kern'; },
    );
  });
  assertAtomicInvalidRequest(result);
});

test('public duplicate module IDs return an atomic F4B invalid-request receipt', () => {
  let result;
  assert.doesNotThrow(() => {
    result = runModuleSet([
      { moduleId: 'same.kern', source: '' },
      { moduleId: 'same.kern', source: '' },
    ]);
  });
  assertAtomicInvalidRequest(result);
});

test('module-set decoder rejects every positional input identity mismatch', () => {
  const result = runModuleSet(VALID_MODULE_SET);
  for (const [field, value] of [
    ['moduleId', 'other.kern'],
    ['format', 'kern.frontend.f4-document.1'],
    ['status', 'rejected'],
    ['seal', 'b'.repeat(64)],
  ]) {
    const context = inputIdentityContext(result);
    const index = context.inputIdentities.length - 1;
    assert.ok(index >= 1, 'last identity requires a multi-module set');
    context.inputIdentities[index][field] = value;
    assert.throws(() => decodeModuleSet(result.fields, context), /input identity drift/u, `${field} at ${index}`);
  }
});

test('F4B late failure is private to the test seam', () => {
  const publicResult = runModuleSet(VALID_MODULE_SET, { forceLateFailure: true });
  assert.equal(publicResult.receipt.status, 'linked');
  const privateResult = __test.runModuleSetWithForcedLateFailure(VALID_MODULE_SET);
  assertAtomicModuleSetFatal(privateResult, 'FORCED_LATE_FAILURE');
});

test('lower-level F4B runner cannot expose a force-late-failure option', () => {
  const result = runModuleSetWith(runDocument, loadPolicy, VALID_MODULE_SET, { forceLateFailure: true });
  assert.equal(result.receipt.status, 'linked');
});
