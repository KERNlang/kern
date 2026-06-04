import type { IRNode } from '@kernlang/core';
import { emitPureHandlers } from '../src/core/handlers/index.js';

function routeWith(child: IRNode): IRNode {
  return {
    type: 'server',
    props: { name: 'API' },
    children: [
      {
        type: 'route',
        props: { method: 'post', path: '/api/t' },
        children: [
          child,
          {
            type: 'respond',
            props: { status: 200, json: { __expr: true, code: '{ ok: true }' } },
          },
        ],
      },
    ],
  };
}

describe('pure Python handlers: keyed reshape route scope', () => {
  test('rejects each keyed collection reshape node until pure-handler parity lands', () => {
    const cases: Array<{ nodeType: string; props: Record<string, unknown> }> = [
      { nodeType: 'uniqueBy', props: { name: 'distinct', in: 'users', by: 'item.id' } },
      { nodeType: 'groupBy', props: { name: 'by_type', in: 'users', by: 'item.type' } },
      { nodeType: 'partition', props: { pass: 'active', fail: 'inactive', in: 'users', where: 'item.active' } },
      { nodeType: 'indexBy', props: { name: 'by_id', in: 'users', by: 'item.id' } },
      { nodeType: 'countBy', props: { name: 'counts', in: 'users', by: 'item.type' } },
    ];

    for (const { nodeType, props } of cases) {
      const server = routeWith({ type: nodeType, props });
      expect(() => emitPureHandlers(server, new Set(), server)).toThrow(
        new RegExp(`pure Python handlers do not yet support portable route \`${nodeType}\``),
      );
    }
  });
});
