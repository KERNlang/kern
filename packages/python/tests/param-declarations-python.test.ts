import { type IRNode, MIXED_PARAMETER_DECLARATION_MESSAGE } from '@kernlang/core';

import { buildPythonParamList } from '../src/codegen-helpers.js';

function fn(props: Record<string, unknown>, children: IRNode[] = []): IRNode {
  return { type: 'fn', props, children };
}

describe('Python parameter declarations', () => {
  test('rejects mixed legacy and structured declarations', () => {
    const node = fn({ name: 'load', params: 'id:string' }, [fnParam({ name: 'name', type: 'string' })]);

    expect(() => buildPythonParamList(node)).toThrow(MIXED_PARAMETER_DECLARATION_MESSAGE);
  });

  test('rejects mixed declarations on non-function callables', () => {
    const method: IRNode = {
      type: 'method',
      props: { name: 'load', params: 'id:string' },
      children: [fnParam({ name: 'name', type: 'string' })],
    };

    expect(() => buildPythonParamList(method)).toThrow(MIXED_PARAMETER_DECLARATION_MESSAGE);
  });

  test('preserves legacy-only and structured-only declarations', () => {
    expect(buildPythonParamList(fn({ name: 'legacy', params: 'userId:string' }))).toBe('user_id: str');
    expect(buildPythonParamList(fn({ name: 'structured' }, [fnParam({ name: 'userId', type: 'string' })]))).toBe(
      'user_id: str',
    );
  });
});

function fnParam(props: Record<string, unknown>): IRNode {
  return { type: 'param', props, children: [] };
}
