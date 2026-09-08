import assert from 'node:assert/strict';
import test from 'node:test';

import {
  D0_CONTRACTS_SPLIT_COMPILED_SUCCESSOR_TRANSITION,
  reconstructD0ContractsSplitCompiledCoreJavaScriptPaths,
  validateD0ContractsSplitHistoricalTransition,
} from './d0-contracts-split-historical-transition.mjs';

test('D.0 contracts split transition has immutable identity', () => {
  assert.equal(validateD0ContractsSplitHistoricalTransition(), true);
  assert.equal(D0_CONTRACTS_SPLIT_COMPILED_SUCCESSOR_TRANSITION.currentInventory.count, 357);
  assert.throws(
    () => validateD0ContractsSplitHistoricalTransition({
      ...D0_CONTRACTS_SPLIT_COMPILED_SUCCESSOR_TRANSITION,
      claim: 'tampered',
    }),
    /immutable identity changed/u,
  );
});

test('D.0 contracts split reconstructor rejects malformed inventories', () => {
  assert.throws(
    () => reconstructD0ContractsSplitCompiledCoreJavaScriptPaths('not-an-array'),
    /coverage dependency rejection/u,
  );
});
