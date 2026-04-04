/**
 * Spec checker tests — .kern contract vs .ts implementation.
 */

import {
  checkSpec,
  extractImplRoutes,
  extractSpecContracts,
  matchRoutes,
  specViolationsToFindings,
} from '../src/spec-checker.js';

// ── extractSpecContracts ──────────────────────────────────────────────

describe('extractSpecContracts', () => {
  it('extracts route with auth, validate, guard, middleware, error', () => {
    const kern = `server name=API port=3000
  route GET /api/users
    auth required
    validate UserQuerySchema
    middleware rateLimit, cors
    guard name=exists expr={{user}} else=404
    error 401 "Unauthorized"
    error 500 "Server error"
    handler <<<
      const users = await db.query('SELECT * FROM users');
      res.json(users);
    >>>
`;
    const contracts = extractSpecContracts(kern, 'api.kern');
    expect(contracts.length).toBe(1);

    const c = contracts[0];
    expect(c.method).toBe('get');
    expect(c.path).toBe('/api/users');
    expect(c.routeKey).toBe('GET /api/users');
    expect(c.auth?.mode).toBe('required');
    expect(c.validate?.schema).toBe('UserQuerySchema');
    expect(c.middleware.length).toBe(1);
    expect(c.middleware[0].names).toEqual(['rateLimit', 'cors']);
    expect(c.guards.length).toBe(1);
    expect(c.guards[0].name).toBe('exists');
    expect(c.guards[0].elseStatus).toBe(404);
    expect(c.errors.length).toBe(2);
    expect(c.errors[0].status).toBe(401);
    expect(c.errors[0].message).toBe('Unauthorized');
    expect(c.hasHandler).toBe(true);
  });

  it('extracts multiple routes from server', () => {
    const kern = `server name=API port=3000
  route GET /api/users
    handler <<<res.json([])>>>
  route POST /api/users
    auth required
    handler <<<res.json({})>>>
  route DELETE /api/users/:id
    auth required
    middleware requireOwner
    handler <<<res.sendStatus(204)>>>
`;
    const contracts = extractSpecContracts(kern, 'api.kern');
    expect(contracts.length).toBe(3);
    expect(contracts[0].routeKey).toBe('GET /api/users');
    expect(contracts[1].routeKey).toBe('POST /api/users');
    expect(contracts[1].auth?.mode).toBe('required');
    expect(contracts[2].routeKey).toBe('DELETE /api/users/:id');
    expect(contracts[2].middleware[0].names).toEqual(['requireOwner']);
  });

  it('handles v2 route syntax (key=value)', () => {
    const kern = `server name=API port=3000
  route method=post path=/api/tracks
    handler <<<res.json({})>>>
`;
    const contracts = extractSpecContracts(kern, 'api.kern');
    expect(contracts.length).toBe(1);
    expect(contracts[0].method).toBe('post');
    expect(contracts[0].path).toBe('/api/tracks');
  });
});

// ── extractImplRoutes ─────────────────────────────────────────────────

describe('extractImplRoutes', () => {
  it('extracts Express routes with method, path, middleware', () => {
    const ts = `
import express from 'express';
const router = express.Router();

router.get('/api/users', requireAuth, rateLimit, async (req, res) => {
  const users = await db.findAll();
  res.json(users);
});

router.post('/api/users', requireAuth, async (req, res) => {
  const user = await db.create(req.body);
  res.status(201).json(user);
});
`;
    const routes = extractImplRoutes(ts, 'routes.ts');
    expect(routes.length).toBe(2);

    expect(routes[0].method).toBe('get');
    expect(routes[0].path).toBe('/api/users');
    expect(routes[0].middlewareArgs).toContain('requireAuth');
    expect(routes[0].middlewareArgs).toContain('rateLimit');
    expect(routes[0].handlerBody).toContain('db.findAll');

    expect(routes[1].method).toBe('post');
    expect(routes[1].path).toBe('/api/users');
    expect(routes[1].handlerBody).toContain('res.status(201)');
  });

  it('extracts handler body with nested braces', () => {
    const ts = `
router.get('/api/items', async (req, res) => {
  if (req.query.filter) {
    const items = await db.query({ where: { active: true } });
    res.json(items);
  } else {
    res.json([]);
  }
});
`;
    const routes = extractImplRoutes(ts, 'routes.ts');
    expect(routes.length).toBe(1);
    expect(routes[0].handlerBody).toContain('req.query.filter');
    expect(routes[0].handlerBody).toContain('res.json([])');
  });
});

// ── matchRoutes ───────────────────────────────────────────────────────

describe('matchRoutes', () => {
  it('matches exact routeKey', () => {
    const specs = [{ method: 'get', path: '/api/users', routeKey: 'GET /api/users' }] as any[];
    const impls = [{ method: 'get', path: '/api/users', routeKey: 'GET /api/users' }] as any[];

    const result = matchRoutes(specs, impls);
    expect(result.matched.length).toBe(1);
    expect(result.unmatchedSpecs.length).toBe(0);
    expect(result.unmatchedImpls.length).toBe(0);
  });

  it('fuzzy matches param name differences (:id vs :userId)', () => {
    const specs = [{ method: 'get', path: '/api/users/:id', routeKey: 'GET /api/users/:id' }] as any[];
    const impls = [{ method: 'get', path: '/api/users/:userId', routeKey: 'GET /api/users/:userId' }] as any[];

    const result = matchRoutes(specs, impls);
    expect(result.matched.length).toBe(1);
  });

  it('reports unmatched specs and impls', () => {
    const specs = [
      { method: 'get', path: '/api/users', routeKey: 'GET /api/users' },
      { method: 'delete', path: '/api/users/:id', routeKey: 'DELETE /api/users/:id' },
    ] as any[];
    const impls = [
      { method: 'get', path: '/api/users', routeKey: 'GET /api/users' },
      { method: 'get', path: '/api/health', routeKey: 'GET /api/health' },
    ] as any[];

    const result = matchRoutes(specs, impls);
    expect(result.matched.length).toBe(1);
    expect(result.unmatchedSpecs.length).toBe(1);
    expect(result.unmatchedSpecs[0].routeKey).toBe('DELETE /api/users/:id');
    expect(result.unmatchedImpls.length).toBe(1);
    expect(result.unmatchedImpls[0].routeKey).toBe('GET /api/health');
  });
});

// ── checkSpec (integration) ───────────────────────────────────────────

describe('checkSpec', () => {
  it('reports auth-missing when .kern declares auth but .ts has none', () => {
    const kern = `server name=API port=3000
  route GET /api/users
    auth required
    handler <<<res.json([])>>>
`;
    const ts = `
router.get('/api/users', async (req, res) => {
  const users = await db.findAll();
  res.json(users);
});
`;
    const result = checkSpec(kern, 'api.kern', ts, 'routes.ts');
    const authViolation = result.violations.find((v) => v.kind === 'spec-auth-missing');
    expect(authViolation).toBeDefined();
    expect(authViolation!.detail).toContain('auth required');
  });

  it('does NOT report auth-missing when requireAuth middleware is present', () => {
    const kern = `server name=API port=3000
  route GET /api/users
    auth required
    handler <<<res.json([])>>>
`;
    const ts = `
router.get('/api/users', requireAuth, async (req, res) => {
  const users = await db.findAll();
  res.json(users);
});
`;
    const result = checkSpec(kern, 'api.kern', ts, 'routes.ts');
    const authViolation = result.violations.find((v) => v.kind === 'spec-auth-missing');
    expect(authViolation).toBeUndefined();
  });

  it('reports validate-missing when .kern declares validate but handler has no .parse()', () => {
    const kern = `server name=API port=3000
  route POST /api/users
    validate CreateUserSchema
    handler <<<
      const user = req.body;
      res.json(user);
    >>>
`;
    const ts = `
router.post('/api/users', async (req, res) => {
  const user = req.body;
  res.json(user);
});
`;
    const result = checkSpec(kern, 'api.kern', ts, 'routes.ts');
    const validateViolation = result.violations.find((v) => v.kind === 'spec-validate-missing');
    expect(validateViolation).toBeDefined();
  });

  it('does NOT report validate-missing when .safeParse() is used', () => {
    const kern = `server name=API port=3000
  route POST /api/users
    validate CreateUserSchema
    handler <<<res.json({})>>>
`;
    const ts = `
router.post('/api/users', async (req, res) => {
  const data = CreateUserSchema.safeParse(req.body);
  res.json(data);
});
`;
    const result = checkSpec(kern, 'api.kern', ts, 'routes.ts');
    const validateViolation = result.violations.find((v) => v.kind === 'spec-validate-missing');
    expect(validateViolation).toBeUndefined();
  });

  it('reports spec-unimplemented for .kern routes with no .ts match', () => {
    const kern = `server name=API port=3000
  route DELETE /api/users/:id
    auth required
    handler <<<res.sendStatus(204)>>>
`;
    const ts = `
router.get('/api/users', async (req, res) => {
  res.json([]);
});
`;
    const result = checkSpec(kern, 'api.kern', ts, 'routes.ts');
    const unimpl = result.violations.find((v) => v.kind === 'spec-unimplemented');
    expect(unimpl).toBeDefined();
    expect(unimpl!.detail).toContain('DELETE /api/users/:id');
  });

  it('reports spec-undeclared for .ts routes not in .kern', () => {
    const kern = `server name=API port=3000
  route GET /api/users
    handler <<<res.json([])>>>
`;
    const ts = `
router.get('/api/users', async (req, res) => { res.json([]); });
router.get('/api/health', async (req, res) => { res.json({ ok: true }); });
`;
    const result = checkSpec(kern, 'api.kern', ts, 'routes.ts');
    const undeclared = result.violations.find((v) => v.kind === 'spec-undeclared');
    expect(undeclared).toBeDefined();
    expect(undeclared!.detail).toContain('/api/health');
  });

  it('all contracts satisfied → zero violations', () => {
    const kern = `server name=API port=3000
  route GET /api/users
    auth required
    validate UserSchema
    handler <<<res.json([])>>>
`;
    const ts = `
router.get('/api/users', requireAuth, async (req, res) => {
  const data = UserSchema.safeParse(req.query);
  res.json([]);
});
`;
    const result = checkSpec(kern, 'api.kern', ts, 'routes.ts');
    expect(result.violations.length).toBe(0);
    expect(result.matched.length).toBe(1);
  });
});

// ── specViolationsToFindings ──────────────────────────────────────────

describe('specViolationsToFindings', () => {
  it('converts violations to ReviewFinding with correct severity', () => {
    const result = checkSpec(
      `server name=API port=3000\n  route GET /api/secret\n    auth required\n    handler <<<res.json([])>>>`,
      'api.kern',
      `router.get('/api/secret', async (req, res) => { res.json([]); });`,
      'routes.ts',
    );

    const findings = specViolationsToFindings(result);
    expect(findings.length).toBeGreaterThanOrEqual(1);

    const authFinding = findings.find((f) => f.ruleId === 'spec-auth-missing');
    expect(authFinding).toBeDefined();
    expect(authFinding!.severity).toBe('error');
    expect(authFinding!.primarySpan.file).toBe('api.kern');
  });
});
