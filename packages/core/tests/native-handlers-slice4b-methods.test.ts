/** Native KERN handler bodies — slice 4b (methods on class/service, TS target).
 *
 *  Slice 4b wires `lang=kern` dispatch into method codegen. Methods on
 *  both `class` and `service` go through `emitClassBody` in
 *  packages/core/src/codegen/type-system.ts, so a single dispatch in
 *  `methodBodyCode` lights up both surfaces. Same pattern as `fn`
 *  (slice 1) — emit through `emitNativeKernBodyTS` when the method's
 *  handler opts in via `lang=kern`. */

import { generateClass, generateService } from '../src/codegen/type-system.js';
import type { IRNode } from '../src/types.js';

function makeMethod(props: Record<string, unknown>, handlerChildren: IRNode[]): IRNode {
  return {
    type: 'method',
    props,
    children: [{ type: 'handler', props: { lang: 'kern' }, children: handlerChildren }],
  };
}

describe('slice 4b — TS class methods with lang=kern', () => {
  test('class method emits structured TS body via native dispatch', () => {
    const node: IRNode = {
      type: 'class',
      props: { name: 'UserStore' },
      children: [makeMethod({ name: 'getName', returns: 'string' }, [{ type: 'return', props: { value: '"alice"' } }])],
    };
    const code = generateClass(node).join('\n');
    expect(code).toContain('class UserStore');
    expect(code).toContain('getName(): string {');
    // Native body: `return "alice";` (with TS string quoting).
    expect(code).toContain('return "alice";');
  });

  test('class method with let + return emits structured statements', () => {
    const node: IRNode = {
      type: 'class',
      props: { name: 'Calc' },
      children: [
        makeMethod({ name: 'double', params: 'x:number', returns: 'number' }, [
          { type: 'let', props: { name: 'r', value: 'x * 2' } },
          { type: 'return', props: { value: 'r' } },
        ]),
      ],
    };
    const code = generateClass(node).join('\n');
    expect(code).toContain('const r = x * 2;');
    expect(code).toContain('return r;');
  });

  test('class method with optional chain emits native ?. operator', () => {
    const node: IRNode = {
      type: 'class',
      props: { name: 'Wrap' },
      children: [makeMethod({ name: 'pick' }, [{ type: 'return', props: { value: 'this?.field' } }])],
    };
    const code = generateClass(node).join('\n');
    expect(code).toContain('return this?.field;');
  });

  test('class method without lang=kern keeps the legacy raw body path', () => {
    const node: IRNode = {
      type: 'class',
      props: { name: 'Legacy' },
      children: [
        {
          type: 'method',
          props: { name: 'getThing' },
          children: [{ type: 'handler', props: { code: 'return 42;' }, children: [] }],
        },
      ],
    };
    const code = generateClass(node).join('\n');
    expect(code).toContain('return 42;');
  });
});

describe('slice 4b — TS service methods with lang=kern', () => {
  test('service method dispatches the same as class method (shared emitClassBody)', () => {
    const node: IRNode = {
      type: 'service',
      props: { name: 'UserService' },
      children: [
        makeMethod({ name: 'fetchById', params: 'id:string', returns: 'User' }, [
          { type: 'return', props: { value: '{ id: id }' } },
        ]),
      ],
    };
    const code = generateService(node).join('\n');
    expect(code).toContain('class UserService');
    expect(code).toContain('fetchById(id: string): User {');
    expect(code).toContain('return { id: id };');
  });

  test('service method with KERN-stdlib lowering (Number.floor → Math.floor)', () => {
    const node: IRNode = {
      type: 'service',
      props: { name: 'Math' },
      children: [
        makeMethod({ name: 'down', params: 'x:number', returns: 'number' }, [
          { type: 'return', props: { value: 'Number.floor(x)' } },
        ]),
      ],
    };
    const code = generateService(node).join('\n');
    expect(code).toContain('return Math.floor(x);');
  });

  test('service method with propagate ? emits hoisted err return (slice 1 semantics)', () => {
    // Methods/services use propagateStyle: 'value' (default), so `?` lowers
    // to the hoisted `if (kind === 'err') return tmp;` pattern. The caller
    // (typically a route) handles HTTP translation.
    const node: IRNode = {
      type: 'service',
      props: { name: 'Loader' },
      children: [
        makeMethod({ name: 'load', params: 'id:string', returns: 'Result<User, Error>', async: 'true' }, [
          { type: 'let', props: { name: 'u', value: 'fetchUser(id)?' } },
          { type: 'return', props: { value: 'u' } },
        ]),
      ],
    };
    const code = generateService(node).join('\n');
    expect(code).toContain('const __k_t1 = fetchUser(id);');
    expect(code).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    expect(code).toContain('const u = __k_t1.value;');
  });
});
