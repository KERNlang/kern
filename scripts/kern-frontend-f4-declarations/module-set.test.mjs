import assert from 'node:assert/strict';
import test from 'node:test';

import { QUARANTINE_MODULE_SET, VALID_MODULE_SET } from './fixtures.mjs';
import { runModuleSet } from './worker.mjs';

function codes(rows) {
  return rows.map((row) => row.code);
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
