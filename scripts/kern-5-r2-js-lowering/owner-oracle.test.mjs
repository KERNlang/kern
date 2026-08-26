import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  AMBIGUOUS_OWNER_CODE,
  MISSING_OWNER_CODE,
  assertExactlyOneJavaScriptEsmOwner,
  discoverJavaScriptEsmOwners,
} from './owner.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('R2 has exactly one semantic package-owned JavaScript ESM compiler owner', async () => {
  const owner = assertExactlyOneJavaScriptEsmOwner(await discoverJavaScriptEsmOwners(ROOT));
  assert.ok(owner.sourcePath.startsWith(resolve(ROOT, 'packages')));
  assert.ok(owner.builtPath.startsWith(resolve(ROOT, 'packages')));
  assert.equal(existsSync(owner.sourcePath), true);
  assert.equal(existsSync(owner.builtPath), true);
});

test('R2 ownership cardinality errors remain explicit and stable', () => {
  assert.throws(() => assertExactlyOneJavaScriptEsmOwner([]), { code: MISSING_OWNER_CODE });
  assert.throws(
    () => assertExactlyOneJavaScriptEsmOwner([
      { packageName: '@fixture/one', subpaths: ['.'] },
      { packageName: '@fixture/two', subpaths: ['.'] },
    ]),
    { code: AMBIGUOUS_OWNER_CODE },
  );
});
