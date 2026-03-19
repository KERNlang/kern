import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Express Transpiler', () => {
  test('express transpiler generates multi-file route and middleware artifacts', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileExpress } = await import('../src/transpiler-express.js');
    const source = readFileSync(resolve(ROOT, 'examples/api-routes.kern'), 'utf-8');
    const result = transpileExpress(parse(source));

    expect(result.code).toContain(`import { verifyToken } from './middleware/auth.js';`);
    expect(result.code).toContain(`import { registerGetApiTracksRoute } from './routes/get-api-tracks.js';`);
    expect(result.code).toContain('app.use(cors());');
    expect(result.code).toContain(`app.use(express.json({ limit: '1mb' }));`);
    expect(result.artifacts).toBeDefined();
    expect(result.artifacts?.some((artifact: any) => artifact.path === 'routes/post-api-tracks-analyze.ts')).toBe(true);
    expect(result.artifacts?.some((artifact: any) => artifact.path === 'middleware/auth.ts')).toBe(true);
  });

  test('express transpiler emits schema guards and ignores frontend nodes', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileExpress } = await import('../src/transpiler-express.js');
    const source = [
      'server name=TestAPI',
      '  button text=IgnoreMe',
      '  route method=post path=/tracks/:id',
      '    schema body="{trackId: string}"',
      '    handler <<<',
      '      res.json({ ok: true });',
      '    >>>',
    ].join('\n');

    const result = transpileExpress(parse(source));
    const routeArtifact = result.artifacts?.find((artifact: any) => artifact.path === 'routes/post-tracks-id.ts');

    expect(routeArtifact?.content).toContain(`assertRequiredFields('params', req.params, ['id']);`);
    expect(routeArtifact?.content).toContain(`assertRequiredFields('body', req.body, ['trackId']);`);
    expect(routeArtifact?.content).not.toContain('IgnoreMe');
    expect(result.code).not.toContain('IgnoreMe');
  });

  describe('Stream/Spawn/Timer', () => {
    test('stream route generates SSE headers and emit helper', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const ast = parse('server name=Test\n  route method=post path=/api/stream\n    stream\n      handler <<<\n        emit({ type: "ping" });\n      >>>');
      const result = transpileExpress(ast);

      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route).toBeDefined();
      expect(route!.content).toContain('text/event-stream');
      expect(route!.content).toContain('flushHeaders');
      expect(route!.content).toContain('const emit =');
      expect(route!.content).toContain('writableEnded');
      expect(route!.content).toContain("JSON.stringify('[DONE]')");
      expect(route!.content).toContain('AbortController');
      expect(route!.content).toContain('await (async');
      expect(route!.content).toContain('keep-alive');
      expect(route!.content).toContain('clearInterval(heartbeat)');
    });

    test('timer route generates timeout with AbortController', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const ast = parse('server name=Test\n  route method=post path=/api/test\n    timer 15\n      handler <<<\n        const r = await doWork();\n        res.json(r);\n      >>>');
      const result = transpileExpress(ast);

      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('15000');
      expect(route!.content).toContain('AbortController');
      expect(route!.content).toContain('clearTimeout');
    });

    test('spawn generates child_process with shell:false', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const ast = parse("server name=Test\n  route method=post path=/api/run\n    stream\n      spawn binary=codex args=['-p','hello']\n        on name=stdout\n          handler <<<\n            emit({ text: chunk.toString() });\n          >>>");
      const result = transpileExpress(ast);

      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain("import { spawn } from 'node:child_process'");
      expect(route!.content).toContain('shell: false');
      expect(route!.content).toContain("spawn('codex'");
      expect(route!.content).toContain('resolveStream');
    });

    test('ai-buddies-api.kern produces valid output', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = readFileSync(resolve(ROOT, 'examples/ai-buddies-api.kern'), 'utf-8');
      const ast = parse(source);
      const result = transpileExpress(ast);

      expect(result.code).toContain('express');
      expect(result.artifacts!.length).toBeGreaterThanOrEqual(2);

      const reviewRoute = result.artifacts!.find((a: any) => a.path.includes('review'));
      if (reviewRoute) {
        expect(reviewRoute.content).toContain('text/event-stream');
      }
    });
  });

  describe('Hardened Defaults', () => {
    test('strict mode emits x-powered-by disable and sanitized error handler', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const ast = parse('server name=Test\n  route method=get path=/health\n    handler <<<\n      res.json({ ok: true });\n    >>>');
      const result = transpileExpress(ast);

      expect(result.code).toContain(`app.disable('x-powered-by')`);
      expect(result.code).toContain(`express.json({ limit: '1mb' })`);
      expect(result.code).toContain(`res.status(404).json({ error: 'Not Found' })`);
      expect(result.code).toContain(`console.error(err)`);
      expect(result.code).toContain(`res.status(500).json({ error: 'Internal Server Error' })`);
      // Must NOT leak error.message
      expect(result.code).not.toContain('error.message');
    });

    test('relaxed mode skips hardened defaults', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const config = resolveConfig({ target: 'express', express: { security: 'relaxed' } });
      const ast = parse('server name=Test\n  route method=get path=/health\n    handler <<<\n      res.json({ ok: true });\n    >>>');
      const result = transpileExpress(ast, config);

      expect(result.code).not.toContain(`app.disable('x-powered-by')`);
      expect(result.code).not.toContain(`{ limit: '1mb' }`);
      expect(result.code).not.toContain('Not Found');
      expect(result.code).toContain('error.message');
    });

    test('strict mode does not duplicate json middleware when IR declares it', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const ast = parse('server name=Test\n  middleware name=json\n  route method=get path=/health\n    handler <<<\n      res.json({ ok: true });\n    >>>');
      const result = transpileExpress(ast);

      // Should have json middleware from IR (with limit), but NOT the auto-added one
      const jsonMatches = result.code.match(/express\.json/g);
      expect(jsonMatches?.length).toBe(1);
    });

    test('helmet opt-in adds import and dependency comment', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const config = resolveConfig({ target: 'express', express: { helmet: true } });
      const ast = parse('server name=Test\n  route method=get path=/health\n    handler <<<\n      res.json({ ok: true });\n    >>>');
      const result = transpileExpress(ast, config);

      expect(result.code).toContain(`import helmet from 'helmet'`);
      expect(result.code).toContain('app.use(helmet())');
      expect(result.code).toContain('// Dependencies: helmet');
    });
  });

  describe('Route v3 — framework-agnostic syntax', () => {
    test('route GET /path parses positional verb and path', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    handler <<<',
        '      res.json([]);',
        '    >>>',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route).toBeDefined();
      expect(route!.content).toContain("app.get('/api/users'");
    });

    test('params generates query param extraction with types and defaults', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    params page:number = 1, limit:number = 20',
        '    handler <<<',
        '      res.json({ page, limit });',
        '    >>>',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('Number(req.query.page)');
      expect(route!.content).toContain('Number(req.query.limit)');
      expect(route!.content).toContain(': 1;');
      expect(route!.content).toContain(': 20;');
    });

    test('auth required adds authRequired middleware', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route POST /api/users',
        '    auth required',
        '    handler <<<',
        '      res.json({ ok: true });',
        '    >>>',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('authRequired');
    });

    test('auth optional adds authOptional middleware', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/public',
        '    auth optional',
        '    handler <<<',
        '      res.json({ ok: true });',
        '    >>>',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('authOptional');
    });

    test('validate adds validation middleware', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route POST /api/users',
        '    validate CreateUserSchema',
        '    handler <<<',
        '      res.json({ ok: true });',
        '    >>>',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('validate(CreateUserSchema)');
    });

    test('error nodes add error contract comments', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    handler <<<',
        '      res.json([]);',
        '    >>>',
        '    error 401 "Unauthorized"',
        '    error 500 "Server error"',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('// 401 — Unauthorized');
      expect(route!.content).toContain('// 500 — Server error');
    });

    test('middleware bare word list resolves each name correctly', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    middleware rateLimit, cors',
        '    handler <<<',
        '      res.json([]);',
        '    >>>',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      // cors should be resolved to cors() with import
      expect(route!.content).toContain('cors()');
      expect(route!.content).toContain("import cors from 'cors'");
      // rateLimit is resolved through custom middleware artifact
      const mwArtifact = result.artifacts!.find((a: any) => a.type === 'middleware');
      expect(mwArtifact).toBeDefined();
    });

    test('query params without defaults coerce safely', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/search',
        '    params q:string, page:number',
        '    handler <<<',
        '      res.json({ q, page });',
        '    >>>',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      // Without default: must check undefined, not blindly coerce
      expect(route!.content).toContain('!== undefined');
      expect(route!.content).toContain(': undefined');
      // Must NOT use String(req.query.q) directly (would produce "undefined")
      expect(route!.content).not.toMatch(/String\(req\.query\.\w+\)/);
    });

    test('full v3 route example compiles end-to-end', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = readFileSync(resolve(ROOT, 'examples/route-v3.kern'), 'utf-8');
      const result = transpileExpress(parse(source));

      expect(result.code).toContain('express');
      expect(result.artifacts!.length).toBeGreaterThanOrEqual(4);

      const getUsersRoute = result.artifacts!.find((a: any) => a.path.includes('get-api-users'));
      expect(getUsersRoute).toBeDefined();
      expect(getUsersRoute!.content).toContain('authRequired');
      expect(getUsersRoute!.content).toContain('validate(UserQuerySchema)');
      expect(getUsersRoute!.content).toContain('Number(req.query.page)');
      expect(getUsersRoute!.content).toContain(': 1;');
      // Bare middleware cors should resolve to cors() with import
      expect(getUsersRoute!.content).toContain('cors()');
      expect(getUsersRoute!.content).toContain("import cors from 'cors'");

      const postUsersRoute = result.artifacts!.find((a: any) => a.path.includes('post-api-users'));
      expect(postUsersRoute).toBeDefined();
      expect(postUsersRoute!.content).toContain('authRequired');
    });

    test('backward compat: old route method=get path=/ still works', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route method=get path=/api/health',
        '    handler <<<',
        '      res.json({ ok: true });',
        '    >>>',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route).toBeDefined();
      expect(route!.content).toContain("app.get('/api/health'");
    });
  });
});
