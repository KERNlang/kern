import assert from 'node:assert/strict';
import test from 'node:test';

import { MIXED_PARAMETER_DECLARATION_MESSAGE } from '../../packages/core/dist/parameter-declarations.js';
import { flattenKernSource } from './flatten-kern.mjs';

test('structured direct parameters produce the same parameter facts as legacy text', () => {
  const legacy = flattenKernSource(
    'legacy.kern',
    'fn name=join params="left:string,right:number" returns=string\n  handler lang=kern\n    return value="left"\n',
  );
  const structured = flattenKernSource(
    'structured.kern',
    [
      'fn name=join returns=string',
      '  param name=left type=string',
      '  param name=right type=number',
      '  handler lang=kern',
      '    return value="left"',
      '',
    ].join('\n'),
  );

  for (const key of ['paramFn', 'paramName', 'paramType', 'paramOrdinal']) {
    assert.deepEqual(structured[key], legacy[key]);
  }
  assert.deepEqual(structured.stmtKind, ['fn', 'return']);
});

test('mixed legacy and structured declarations fail closed in the checker adapter', () => {
  assert.throws(
    () =>
      flattenKernSource(
        'mixed.kern',
        'fn name=join params="left:string" returns=string\n  param name=right type=string\n',
      ),
    { message: MIXED_PARAMETER_DECLARATION_MESSAGE },
  );
});

test('structured parameter features outside the checker fact profile fail closed', () => {
  assert.throws(
    () =>
      flattenKernSource(
        'default.kern',
        'fn name=join returns=string\n  param name=left type=string value="fallback"\n',
      ),
    /checker parameter facts support only `name` and `type`/,
  );
});
