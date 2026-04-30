/** Native KERN handler bodies — slice 4a (routes, Python target).
 *
 *  Slice 4a wires `lang=kern` dispatch into route codegen. Same pattern as
 *  the slice-1 `fn` wiring, but at routes:
 *    - Path params are emitted camelCase as-is in the FastAPI signature
 *      (no rename), so they pass through KERN bodies unchanged.
 *    - Query params ARE snake-cased in the signature, so each rename feeds
 *      the body symbol map.
 *    - Required imports (e.g. `Number.floor` ⇒ `math`) are added to the
 *      route file's import block as `import math as __k_math` so the
 *      stdlib lowerings resolve correctly without colliding with any user
 *      `math` binding (slice 3 review fix).
 *
 *  Stream and timer routes still use raw `<<<...>>>` handlers in slice 4a;
 *  wiring those is a slice 4 follow-up. */

import type { IRNode } from '@kernlang/core';
import { buildRouteArtifact } from '../src/fastapi-route.js';

function makeRoute(props: Record<string, unknown>, handlerChildren: IRNode[], extraChildren: IRNode[] = []): IRNode {
  return {
    type: 'route',
    props,
    children: [
      ...extraChildren,
      {
        type: 'handler',
        props: { lang: 'kern' },
        children: handlerChildren,
      },
    ],
  };
}

function buildArtifactContent(routeNode: IRNode): string {
  const ref = buildRouteArtifact(routeNode, 0, []);
  return ref.artifact.content;
}

describe('slice 4a — FastAPI route lang=kern dispatch', () => {
  test('basic native handler emits structured Python body (not raw indent)', () => {
    const route = makeRoute({ method: 'get', path: '/health' }, [
      { type: 'return', props: { value: '{ status: "ok" }' } },
    ]);
    const content = buildArtifactContent(route);
    // Native body emit produces a Python dict literal (slice 2d).
    expect(content).toContain('async def get_health():');
    expect(content).toContain('return {"status": "ok"}');
  });

  test('path param passes through camelCase unchanged (no symbol-map rename)', () => {
    // Path params are emitted `${param}: str` in the signature without
    // snake_casing, so the body must reference them in the same form.
    // No symbol-map entry is required.
    const route = makeRoute({ method: 'get', path: '/users/:userId' }, [
      { type: 'return', props: { value: '{ id: userId }' } },
    ]);
    const content = buildArtifactContent(route);
    expect(content).toContain('async def get_users_userid(userId: str):');
    expect(content).toContain('return {"id": userId}');
  });

  test('query param camelCase is renamed to snake_case in body via symbol map', () => {
    // `params items=[{name:"maxResults",type:"number",default:"10"}]` is
    // snake-cased in the FastAPI signature to `max_results: int = 10`. The
    // body's KERN-form `maxResults` must rename to match.
    const route: IRNode = {
      type: 'route',
      props: { method: 'get', path: '/search' },
      children: [
        {
          type: 'params',
          props: { items: [{ name: 'maxResults', type: 'number', default: '10' }] },
        },
        {
          type: 'handler',
          props: { lang: 'kern' },
          children: [{ type: 'return', props: { value: '{ count: maxResults }' } }],
        },
      ],
    };
    const content = buildArtifactContent(route);
    expect(content).toContain('max_results: int = 10');
    // Body references the snake-cased form (rename applied), not the KERN form.
    expect(content).toContain('return {"count": max_results}');
  });

  test('Number.floor in body adds `import math as __k_math` to route imports', () => {
    const route = makeRoute({ method: 'get', path: '/round' }, [
      { type: 'let', props: { name: 'r', value: 'Number.floor(0.5)' } },
      { type: 'return', props: { value: '{ value: r }' } },
    ]);
    const content = buildArtifactContent(route);
    // Slice 3 review fix: aliased import to avoid shadowing user bindings
    // named `math`. The lowering also references the alias.
    expect(content).toContain('import math as __k_math');
    expect(content).toContain('r = __k_math.floor(0.5)');
  });

  test('Number.round JS-parity: `__k_math.floor(x + 0.5)` not banker round', () => {
    const route = makeRoute({ method: 'get', path: '/round/:x' }, [
      { type: 'return', props: { value: '{ rounded: Number.round(x) }' } },
    ]);
    const content = buildArtifactContent(route);
    expect(content).toContain('return {"rounded": __k_math.floor(x + 0.5)}');
  });

  test('optional chain ?. continues across the trailing access (slice 3 review fix)', () => {
    // Codex review fix: `user?.profile.name` short-circuits the entire
    // trailing chain, so this should NOT lower to
    // `(user.profile if user is not None else None).name` — that would
    // raise AttributeError on a None user.
    const route = makeRoute({ method: 'get', path: '/profile/:user' }, [
      { type: 'return', props: { value: '{ name: user?.profile.name }' } },
    ]);
    const content = buildArtifactContent(route);
    expect(content).toContain('return {"name": (user.profile.name if user is not None else None)}');
  });

  test('handler without lang=kern keeps the legacy raw-body emit path', () => {
    // Sanity: existing routes without `lang=kern` opt-in still indent
    // raw handler code verbatim (no symbol map, no native emit).
    const route: IRNode = {
      type: 'route',
      props: { method: 'get', path: '/legacy' },
      children: [
        {
          type: 'handler',
          props: { code: 'return {"raw": True}' }, // no lang=kern
          children: [],
        },
      ],
    };
    const content = buildArtifactContent(route);
    expect(content).toContain('return {"raw": True}');
    expect(content).not.toContain('import math as __k_math');
  });
});
