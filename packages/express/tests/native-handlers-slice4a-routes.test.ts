/** Native KERN handler bodies — slice 4a (routes, TS / Express target).
 *
 *  Slice 4a wires `lang=kern` dispatch into Express route codegen. Same
 *  pattern as the slice-1 `fn` wiring. Express keeps identifiers in their
 *  KERN form end-to-end (no snake_casing), so no symbol map is needed,
 *  and TS's KERN-stdlib lowerings don't currently demand any imports —
 *  the route's import block stays untouched. */

import type { IRNode } from '@kernlang/core';
import { buildRouteArtifact } from '../src/express-route.js';

function makeRoute(props: Record<string, unknown>, handlerChildren: IRNode[]): IRNode {
  return {
    type: 'route',
    props,
    children: [
      {
        type: 'handler',
        props: { lang: 'kern' },
        children: handlerChildren,
      },
    ],
  };
}

function buildArtifactContent(routeNode: IRNode): string {
  const ref = buildRouteArtifact(routeNode, 0, new Map(), [], 'strict');
  return ref.artifact.content;
}

describe('slice 4a — Express route lang=kern dispatch', () => {
  test('basic native handler emits structured TypeScript body (not raw indent)', () => {
    const route = makeRoute({ method: 'get', path: '/health' }, [
      { type: 'return', props: { value: '{ status: "ok" }' } },
    ]);
    const content = buildArtifactContent(route);
    // Native body emit produces a TS object literal (slice 2d).
    expect(content).toContain("app.get('/health'");
    expect(content).toContain('return { status: "ok" };');
  });

  test('let + return statements emit as TS const + return', () => {
    const route = makeRoute({ method: 'get', path: '/who/:userId' }, [
      { type: 'let', props: { name: 'id', value: 'userId' } },
      { type: 'return', props: { value: '{ id: id }' } },
    ]);
    const content = buildArtifactContent(route);
    expect(content).toContain('const id = userId;');
    expect(content).toContain('return { id: id };');
  });

  test('optional chain ?. emits via native TS operator (not Python lowering)', () => {
    const route = makeRoute({ method: 'get', path: '/profile/:user' }, [
      { type: 'return', props: { value: '{ name: user?.profile.name }' } },
    ]);
    const content = buildArtifactContent(route);
    // TS has native ?., so the trailing chain stays as `?.profile.name`.
    expect(content).toContain('return { name: user?.profile.name };');
  });

  test('Number.floor lowers to Math.floor (TS global, no import needed)', () => {
    const route = makeRoute({ method: 'get', path: '/round' }, [
      { type: 'return', props: { value: '{ floor: Number.floor(0.5) }' } },
    ]);
    const content = buildArtifactContent(route);
    expect(content).toContain('return { floor: Math.floor(0.5) };');
    // Express route imports stay untouched — no import math equivalent on TS.
    expect(content).not.toContain('import { floor }');
  });

  test('handler without lang=kern keeps the legacy raw-body emit path', () => {
    // Sanity: non-opt-in routes still indent raw handler code verbatim.
    const route: IRNode = {
      type: 'route',
      props: { method: 'get', path: '/legacy' },
      children: [
        {
          type: 'handler',
          props: { code: 'res.json({ raw: true });' }, // no lang=kern
          children: [],
        },
      ],
    };
    const content = buildArtifactContent(route);
    expect(content).toContain('res.json({ raw: true });');
  });
});
