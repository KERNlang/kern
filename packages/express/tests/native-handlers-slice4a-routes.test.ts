/** Native KERN handler bodies — slice 4a (routes, TS / Express target).
 *
 *  Slice 4a wires `lang=kern` dispatch into Express route codegen, plus the
 *  review-fix layer that handles Express's response semantics (Codex P1+P2,
 *  Gemini #1+#3 from the slice 4a buddy review). Express handlers don't
 *  return values to the framework — they communicate via `res.json(...)`
 *  side effects, and path params live in `req.params.X` rather than as
 *  free locals. The route emitter therefore wraps the native body in an
 *  IIFE, pre-binds path params from `req.params`, captures the body's
 *  return value, and translates that result back into an Express response:
 *    - `undefined`         → no response (user wrote bare `return;`)
 *    - `{ kind: 'err' }`   → 500 with the err.error payload
 *                            (Result.err short-circuit from `?` propagation)
 *    - any other value     → 200 with the value as JSON
 *
 *  Stream/timer/portable routes throw on `lang=kern` until slice 4c lands
 *  proper streaming/timer response translation. */

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
  test('basic handler is wrapped in IIFE and result goes to res.json', () => {
    const route = makeRoute({ method: 'get', path: '/health' }, [
      { type: 'return', props: { value: '{ status: "ok" }' } },
    ]);
    const content = buildArtifactContent(route);
    expect(content).toContain("app.get('/health'");
    // Native body emit produces `return { status: "ok" };` INSIDE the IIFE,
    // and the wrapper translates the result into res.json().
    expect(content).toContain('const __k_result = await (async () => {');
    expect(content).toContain('return { status: "ok" };');
    expect(content).toContain('})();');
    // Result.err discriminator check translates `?` propagation into 500.
    expect(content).toContain("(__k_result as { kind?: unknown }).kind === 'err'");
    expect(content).toContain('res.status(500).json({ error: (__k_result as { error?: unknown }).error });');
    expect(content).toContain('res.json(__k_result);');
  });

  test('path params auto-bind from req.params at top of IIFE', () => {
    // Codex P2: Express path params live in `req.params.X`, not as free
    // locals. The wrapper pre-binds them so KERN bodies can reference
    // them by their KERN name.
    const route = makeRoute({ method: 'get', path: '/who/:userId' }, [
      { type: 'let', props: { name: 'id', value: 'userId' } },
      { type: 'return', props: { value: '{ id: id }' } },
    ]);
    const content = buildArtifactContent(route);
    expect(content).toContain('const userId = req.params.userId;');
    expect(content).toContain('const id = userId;');
    expect(content).toContain('return { id: id };');
  });

  test('multiple path params each get their own binding', () => {
    const route = makeRoute({ method: 'get', path: '/orgs/:orgId/users/:userId' }, [
      { type: 'return', props: { value: '{ org: orgId, user: userId }' } },
    ]);
    const content = buildArtifactContent(route);
    expect(content).toContain('const orgId = req.params.orgId;');
    expect(content).toContain('const userId = req.params.userId;');
  });

  test('optional chain ?. emits via native TS operator (TS has it natively)', () => {
    const route = makeRoute({ method: 'get', path: '/profile/:user' }, [
      { type: 'return', props: { value: '{ name: user?.profile.name }' } },
    ]);
    const content = buildArtifactContent(route);
    expect(content).toContain('return { name: user?.profile.name };');
  });

  test('Number.floor lowers to Math.floor (TS global, no import needed)', () => {
    const route = makeRoute({ method: 'get', path: '/round' }, [
      { type: 'return', props: { value: '{ floor: Number.floor(0.5) }' } },
    ]);
    const content = buildArtifactContent(route);
    expect(content).toContain('return { floor: Math.floor(0.5) };');
  });

  test('empty native body emits 501 fallback (Codex/Gemini/OpenCode)', () => {
    // Pre-fix: empty body emitted nothing inside the try/catch — request
    // hung because next() and res.* were never called.
    const route = makeRoute({ method: 'get', path: '/empty' }, []);
    const content = buildArtifactContent(route);
    expect(content).toContain("res.status(501).json({ error: 'Route handler not implemented' });");
    // No IIFE wrapper for empty bodies (no body to wrap).
    expect(content).not.toContain('const __k_result = await');
  });

  test('handler without lang=kern keeps the legacy raw-body emit path', () => {
    const route: IRNode = {
      type: 'route',
      props: { method: 'get', path: '/legacy' },
      children: [
        {
          type: 'handler',
          props: { code: 'res.json({ raw: true });' },
          children: [],
        },
      ],
    };
    const content = buildArtifactContent(route);
    expect(content).toContain('res.json({ raw: true });');
    // No native wrap on legacy routes.
    expect(content).not.toContain('const __k_result = await');
  });

  test('? propagation: Result.err short-circuits via the IIFE return + 500 translate', () => {
    // The body emitter generates `if (__k_t1.kind === 'err') return __k_t1;`
    // INSIDE the IIFE. Returning the err Result from the IIFE then trips
    // the wrapper's `kind === 'err'` check, which translates to 500.
    const route = makeRoute({ method: 'get', path: '/users/:id' }, [
      { type: 'let', props: { name: 'u', value: 'fetchUser(id)?' } },
      { type: 'return', props: { value: 'u' } },
    ]);
    const content = buildArtifactContent(route);
    expect(content).toContain('const __k_t1 = fetchUser(id);');
    expect(content).toContain("if (__k_t1.kind === 'err') return __k_t1;");
    // The wrapper handles the err-result → 500 translation.
    expect(content).toContain('res.status(500).json({ error: (__k_result as { error?: unknown }).error });');
  });

  // ── Slice 4a review fix — fail loud on unsupported combinations ──

  test('stream + lang=kern throws (slice 4c follow-up)', () => {
    // Stream routes resolve `handlerNode` from inside the `stream` node
    // (see route emitter line ~54), so the lang=kern handler lives there.
    const route: IRNode = {
      type: 'route',
      props: { method: 'get', path: '/stream' },
      children: [
        {
          type: 'stream',
          props: {},
          children: [{ type: 'handler', props: { lang: 'kern' }, children: [] }],
        },
      ],
    };
    expect(() => buildArtifactContent(route)).toThrow(/stream' handler with lang=kern is not yet supported/);
  });

  test('timer + lang=kern throws (slice 4c follow-up)', () => {
    // Timer routes set handlerNode = null in the stream/timer branch so the
    // detection fires off the routeNode-level handler. The throw guard
    // checks both `caps.hasTimer` and `lang=kern` present at any level.
    const route: IRNode = {
      type: 'route',
      props: { method: 'get', path: '/timer' },
      children: [
        {
          type: 'timer',
          props: { ms: 1000 },
          children: [{ type: 'handler', props: { lang: 'kern' }, children: [] }],
        },
      ],
    };
    expect(() => buildArtifactContent(route)).toThrow(/timer' handler with lang=kern is not yet supported/);
  });

  test('portable nodes + lang=kern throws (must choose one path)', () => {
    const route: IRNode = {
      type: 'route',
      props: { method: 'get', path: '/portable' },
      children: [
        { type: 'derive', props: {}, children: [] },
        { type: 'handler', props: { lang: 'kern' }, children: [] },
      ],
    };
    expect(() => buildArtifactContent(route)).toThrow(/BOTH portable nodes .* AND a `lang=kern` handler/);
  });
});
