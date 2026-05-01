/** Native KERN handler bodies — slice 4b (methods on service/repository, Python target).
 *
 *  Slice 4b wires `lang=kern` dispatch into Python method codegen for
 *  `service` and `repository` (both share the methodBodyLinesPython
 *  helper in packages/fastapi/src/generators/data.ts).
 *
 *  Methods get:
 *    - snake_case symbol map built from the method's `param` children
 *      (or legacy `params="..."` string) — same rule as fn (slice 3a).
 *    - `propagateStyle: 'value'` (default) — methods are app-layer code;
 *      Result.err propagates back to the caller (e.g., a route, which
 *      then translates to HTTPException via slice 4a's review fix).
 *    - Inline-in-function imports for KERN-stdlib lowerings (e.g.
 *      `import math as __k_math` at the top of the method body) —
 *      same convention as slice 3b extended to methods.
 *    - Snake_case collision detection — two params snake-casing to the
 *      same Python name throw at codegen.
 */

import type { IRNode } from '@kernlang/core';
import { generatePythonRepository, generatePythonService } from '../src/generators/data.js';

function makeMethod(props: Record<string, unknown>, handlerChildren: IRNode[]): IRNode {
  return {
    type: 'method',
    props,
    children: [{ type: 'handler', props: { lang: 'kern' }, children: handlerChildren }],
  };
}

describe('slice 4b — Python service methods with lang=kern', () => {
  test('service method emits structured Python body via native dispatch', () => {
    const node: IRNode = {
      type: 'service',
      props: { name: 'UserService' },
      children: [makeMethod({ name: 'getName', returns: 'string' }, [{ type: 'return', props: { value: '"alice"' } }])],
    };
    const code = generatePythonService(node).join('\n');
    expect(code).toContain('class UserService:');
    expect(code).toContain('def get_name(self) -> str:');
    expect(code).toContain('return "alice"');
  });

  test('snake_case symbol map renames camelCase params in body', () => {
    const node: IRNode = {
      type: 'service',
      props: { name: 'OrderService' },
      children: [
        makeMethod({ name: 'lookup', returns: 'Order' }, [{ type: 'return', props: { value: '{ id: orderId }' } }])
          .children
          ? // Build with structured params for snake_casing
            ({
              type: 'method',
              props: { name: 'lookup', returns: 'Order' },
              children: [
                { type: 'param', props: { name: 'orderId', type: 'string' } },
                {
                  type: 'handler',
                  props: { lang: 'kern' },
                  children: [{ type: 'return', props: { value: '{ id: orderId }' } }],
                },
              ],
            } as IRNode)
          : ({} as IRNode),
      ],
    };
    const code = generatePythonService(node).join('\n');
    // Python signature snake-cases orderId → order_id; body must reference
    // the same form (symbol map applied).
    expect(code).toContain('def lookup(self, order_id: str) -> Order:');
    expect(code).toContain('return {"id": order_id}');
  });

  test('Number.floor in service method injects inline import math as __k_math', () => {
    const node: IRNode = {
      type: 'service',
      props: { name: 'NumService' },
      children: [
        makeMethod({ name: 'down', params: 'x:number', returns: 'number' }, [
          { type: 'return', props: { value: 'Number.floor(x)' } },
        ]),
      ],
    };
    const code = generatePythonService(node).join('\n');
    expect(code).toContain('def down(self, x: float) -> float:');
    expect(code).toContain('import math as __k_math');
    expect(code).toContain('return __k_math.floor(x)');
  });

  test('propagate ? in method emits hoisted return (NOT HTTPException, since not a route)', () => {
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
    const code = generatePythonService(node).join('\n');
    expect(code).toContain('__k_t1 = fetchUser(id)');
    expect(code).toContain("if __k_t1.kind == 'err':");
    // Methods use propagateStyle='value' so the err branch returns rather
    // than raising HTTPException. The route caller is responsible for
    // translating Result.err to HTTP — slice 4a's review fix handles that.
    expect(code).toContain('return __k_t1');
    expect(code).not.toContain('raise HTTPException');
    expect(code).toContain('u = __k_t1.value');
  });

  test('snake_case collision (xCount + x_count) throws', () => {
    const node: IRNode = {
      type: 'service',
      props: { name: 'Bad' },
      children: [
        {
          type: 'method',
          props: { name: 'collide' },
          children: [
            { type: 'param', props: { name: 'xCount', type: 'number' } },
            { type: 'param', props: { name: 'x_count', type: 'number' } },
            { type: 'handler', props: { lang: 'kern' }, children: [{ type: 'return', props: { value: 'xCount' } }] },
          ],
        },
      ],
    };
    expect(() => generatePythonService(node)).toThrow(/snake-cases to 'x_count', which collides/);
  });

  test('handler without lang=kern keeps legacy raw body path', () => {
    const node: IRNode = {
      type: 'service',
      props: { name: 'Legacy' },
      children: [
        {
          type: 'method',
          props: { name: 'rawThing' },
          children: [{ type: 'handler', props: { code: 'return 42' }, children: [] }],
        },
      ],
    };
    const code = generatePythonService(node).join('\n');
    expect(code).toContain('return 42');
    expect(code).not.toContain('import math');
  });
});

describe('slice 4b — Python repository methods with lang=kern', () => {
  test('repository method dispatches the same as service method (shared helper)', () => {
    const node: IRNode = {
      type: 'repository',
      props: { name: 'UserRepo', model: 'User' },
      children: [
        makeMethod({ name: 'findById', params: 'id:string', returns: 'User', async: 'true' }, [
          { type: 'return', props: { value: '{ id: id, name: "test" }' } },
        ]),
      ],
    };
    const code = generatePythonRepository(node).join('\n');
    expect(code).toContain('class UserRepo:');
    expect(code).toContain('async def find_by_id(self, id: str) -> User:');
    expect(code).toContain('return {"id": id, "name": "test"}');
  });

  test('repository method with stdlib import injection works', () => {
    const node: IRNode = {
      type: 'repository',
      props: { name: 'StatsRepo' },
      children: [
        makeMethod({ name: 'avg', params: 'total:number,count:number', returns: 'number' }, [
          { type: 'return', props: { value: 'Number.floor(total / count)' } },
        ]),
      ],
    };
    const code = generatePythonRepository(node).join('\n');
    expect(code).toContain('import math as __k_math');
    // Binary arg `total / count` gets paren-wrapped via needsArgParens
    // (slice 2 review fix) before template substitution.
    expect(code).toContain('return __k_math.floor((total / count))');
  });
});
