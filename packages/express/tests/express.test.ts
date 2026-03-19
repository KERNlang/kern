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

  describe('Portable Backend — respond, derive, guard', () => {
    test('respond 200 json=data generates res.json()', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    respond 200 json=users',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('res.json(users)');
      expect(route!.content).not.toContain('501');
    });

    test('respond 201 json=user generates res.status(201).json()', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route POST /api/users',
        '    respond 201 json=user',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('res.status(201).json(user)');
    });

    test('respond 204 generates res.status(204).send()', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route DELETE /api/users/:id',
        '    respond 204',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('res.status(204).send()');
    });

    test('respond 404 error="Not found" generates error response', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/users/:id',
        '    respond 404 error="Not found"',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain("res.status(404).json({ error: 'Not found' })");
    });

    test('respond redirect="/login" generates res.redirect()', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /login',
        '    respond redirect="/login"',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain("res.redirect('/login')");
    });

    test('respond 200 text=result generates res.send()', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/text',
        '    respond 200 text=result',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('res.send(result)');
    });

    test('derive generates const binding with expression', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    derive users expr={{await db.query("SELECT * FROM users")}}',
        '    respond 200 json=users',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('const users = await db.query("SELECT * FROM users")');
      expect(route!.content).toContain('res.json(users)');
    });

    test('guard generates early-return check', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/users/:id',
        '    derive user expr={{await db.findById(params.id)}}',
        '    guard name=exists expr={{user}} else=404',
        '    respond 200 json=user',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('const user = await db.findById(req.params.id)');
      expect(route!.content).toContain('if (!(user))');
      expect(route!.content).toContain('res.status(404)');
      expect(route!.content).toContain('res.json(user)');
    });

    test('portable request refs: params/body/query/headers rewritten for Express', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route POST /api/users/:id',
        '    derive user expr={{await db.findById(params.id)}}',
        '    derive name expr={{body.firstName + " " + body.lastName}}',
        '    derive token expr={{headers.authorization}}',
        '    respond 200 json=user',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      // params.id → req.params.id
      expect(route!.content).toContain('req.params.id');
      // body.X → req.body.X
      expect(route!.content).toContain('req.body.firstName');
      expect(route!.content).toContain('req.body.lastName');
      // headers.X → req.headers['X']
      expect(route!.content).toContain("req.headers['authorization']");
    });

    test('handler + respond coexist (escape hatch pattern)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route POST /api/tracks/analyze',
        '    auth required',
        '    handler <<<',
        '      const result = await analyzeAudio(req.body.trackId);',
        '    >>>',
        '    respond 200 json=result',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      // handler code comes first
      expect(route!.content).toContain('analyzeAudio(req.body.trackId)');
      // respond comes after
      expect(route!.content).toContain('res.json(result)');
    });

    test('derive + guard + handler + respond execution order', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route POST /api/tracks/:id/analyze',
        '    derive track expr={{await db.tracks.findById(params.id)}}',
        '    guard name=trackExists expr={{track}} else=404',
        '    handler <<<',
        '      const result = await analyzeAudioFFT(track.audioPath);',
        '    >>>',
        '    respond 200 json=result',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;

      // Verify execution order: derive before guard before handler before respond
      const deriveIdx = content.indexOf('const track =');
      const guardIdx = content.indexOf('if (!(track))');
      const handlerIdx = content.indexOf('analyzeAudioFFT');
      const respondIdx = content.indexOf('res.json(result)');

      expect(deriveIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeGreaterThan(deriveIdx);
      expect(handlerIdx).toBeGreaterThan(guardIdx);
      expect(respondIdx).toBeGreaterThan(handlerIdx);
    });

    test('full v3 portable route example compiles end-to-end', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = readFileSync(resolve(ROOT, 'examples/route-v3.kern'), 'utf-8');
      const result = transpileExpress(parse(source));

      // Portable POST route
      const postRoute = result.artifacts!.find((a: any) => a.path.includes('post-api-users'));
      expect(postRoute).toBeDefined();
      expect(postRoute!.content).toContain('const user =');
      expect(postRoute!.content).toContain('res.status(201).json(user)');

      // Portable GET :id route
      const getIdRoute = result.artifacts!.find((a: any) => a.path.includes('get-api-users-id'));
      expect(getIdRoute).toBeDefined();
      expect(getIdRoute!.content).toContain('const user =');
      expect(getIdRoute!.content).toContain('if (!(user))');
      expect(getIdRoute!.content).toContain('res.json(user)');

      // Portable DELETE route
      const deleteRoute = result.artifacts!.find((a: any) => a.path.includes('delete-api-users-id'));
      expect(deleteRoute).toBeDefined();
      expect(deleteRoute!.content).toContain('res.status(204).send()');

      // Legacy handler route still works
      const getUsersRoute = result.artifacts!.find((a: any) => a.path.includes('get-api-users'));
      expect(getUsersRoute).toBeDefined();
      expect(getUsersRoute!.content).toContain("db.query('SELECT * FROM users");
    });
  });

  describe('Portable Control Flow — branch, each, collect', () => {
    test('branch generates if/else if chain on query param', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    params role:string',
        '    derive users expr={{await db.query("SELECT * FROM users")}}',
        '    branch name=filterByRole on=query.role',
        '      path value="admin"',
        '        collect name=filtered from=users where={{item.role === "admin"}}',
        '        respond 200 json=filtered',
        '      path value="user"',
        '        collect name=filtered from=users where={{item.role === "user"}}',
        '        respond 200 json=filtered',
        '    respond 200 json=users',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;

      // Branch generates if/else if
      expect(content).toContain("if (req.query.role === 'admin')");
      expect(content).toContain("else if (req.query.role === 'user')");
      // Collect inside branch
      expect(content).toContain('.filter(item =>');
      // Respond inside branch
      expect(content).toContain('res.json(filtered)');
      // Default respond at the end
      expect(content).toContain('res.json(users)');
    });

    test('collect generates filter/sort/slice chain', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/tracks',
        '    derive tracks expr={{await db.query("SELECT * FROM tracks")}}',
        '    collect name=popular from=tracks where={{item.plays > 1000}} limit=10',
        '    respond 200 json=popular',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;

      expect(content).toContain('const popular = tracks.filter(item => item.plays > 1000).slice(0, 10)');
      expect(content).toContain('res.json(popular)');
    });

    test('each generates for loop with children', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route POST /api/batch',
        '    derive items expr={{body.items}}',
        '    each name=item in=items',
        '      derive result expr={{await processItem(item)}}',
        '    respond 200 json=items',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;

      // items is already derived, so each iterates the variable
      expect(content).toContain('for (const item of items)');
      expect(content).toContain('const result = await processItem(item)');
    });

    test('each with index generates entries() loop', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/list',
        '    derive items expr={{await db.getAll()}}',
        '    each name=item in=items index=i',
        '      derive numbered expr={{Object.assign(item, { index: i })}}',
        '    respond 200 json=items',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));

      expect(route!.content).toContain('for (const [i, item] of (items).entries())');
    });

    test('nested branch + collect compiles bilingual', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const { transpileFastAPI } = await import('../../fastapi/src/transpiler-fastapi.js');
      const source = [
        'server name=Test port=3000',
        '  route GET /api/users',
        '    params role:string',
        '    derive users expr={{await db.query("SELECT * FROM users")}}',
        '    branch name=filter on=query.role',
        '      path value="admin"',
        '        collect name=result from=users where={{item.role === "admin"}}',
        '        respond 200 json=result',
        '      path value="user"',
        '        collect name=result from=users where={{item.role === "user"}}',
        '        respond 200 json=result',
        '    respond 200 json=users',
      ].join('\n');
      const ast = parse(source);
      const expressResult = transpileExpress(ast);
      const fastapiResult = transpileFastAPI(ast);

      const exRoute = expressResult.artifacts!.find((a: any) => a.type === 'route');
      const pyRoute = fastapiResult.artifacts!.find((a: any) => a.type === 'route');

      // Express: if/else if
      expect(exRoute!.content).toContain("if (req.query.role === 'admin')");
      expect(exRoute!.content).toContain("else if (req.query.role === 'user')");

      // FastAPI: if/elif
      expect(pyRoute!.content).toContain('if role == "admin"');
      expect(pyRoute!.content).toContain('elif role == "user"');

      // Both have collect
      expect(exRoute!.content).toContain('.filter(item =>');
      expect(pyRoute!.content).toContain('item for item in');
    });
  });

  describe('Portable Effect — effect + trigger + recover', () => {
    test('effect with retry generates retry loop', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    effect fetchUsers',
        '      trigger db query="SELECT * FROM users"',
        '      recover retry=3 fallback=[]',
        '    respond 200 json=fetchUsers.result',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;

      // Retry loop
      expect(content).toContain('for (let _attempt = 0; _attempt < 3; _attempt++)');
      expect(content).toContain('fetchUsers = SELECT * FROM users');
      expect(content).toContain('break;');
      // Fallback
      expect(content).toContain('let fetchUsers = []');
      // effectName.result → effectName
      expect(content).toContain('res.json(fetchUsers)');
      expect(content).not.toContain('fetchUsers.result');
    });

    test('effect without retry generates try/catch', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/data',
        '    effect loadData',
        '      trigger http url="/api/external"',
        '      recover fallback=null',
        '    guard name=hasData expr={{loadData.result}} else=502',
        '    respond 200 json=loadData.result',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;

      // try/catch without retry loop
      expect(content).toContain('try {');
      expect(content).toContain('loadData = /api/external');
      expect(content).toContain('} catch (_err)');
      expect(content).toContain('let loadData = null');
      // guard references effect result
      expect(content).toContain('if (!(loadData))');
      expect(content).toContain('res.json(loadData)');
    });

    test('effect with expr trigger uses expression', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const source = [
        'server name=Test',
        '  route GET /api/users/:id',
        '    effect fetchUser',
        '      trigger db expr={{await db.users.findById(params.id)}}',
        '      recover retry=2 fallback=null',
        '    guard name=exists expr={{fetchUser.result}} else=404',
        '    respond 200 json=fetchUser.result',
      ].join('\n');
      const result = transpileExpress(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;

      // Expression is rewritten with portable refs
      expect(content).toContain('await db.users.findById(req.params.id)');
      expect(content).toContain('_attempt < 2');
      // .result stripped everywhere
      expect(content).toContain('if (!(fetchUser))');
      expect(content).toContain('res.json(fetchUser)');
    });

    test('effect compiles bilingual (Express + FastAPI)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../src/transpiler-express.js');
      const { transpileFastAPI } = await import('../../fastapi/src/transpiler-fastapi.js');
      const source = [
        'server name=Test port=3000',
        '  route GET /api/users',
        '    effect fetchUsers',
        '      trigger db expr={{await db.query("SELECT * FROM users")}}',
        '      recover retry=3 fallback=[]',
        '    respond 200 json=fetchUsers.result',
      ].join('\n');
      const ast = parse(source);
      const exResult = transpileExpress(ast);
      const pyResult = transpileFastAPI(ast);

      const exRoute = exResult.artifacts!.find((a: any) => a.type === 'route');
      const pyRoute = pyResult.artifacts!.find((a: any) => a.type === 'route');

      // Express: for loop retry
      expect(exRoute!.content).toContain('for (let _attempt = 0; _attempt < 3');
      expect(exRoute!.content).toContain('let fetchUsers = []');
      expect(exRoute!.content).toContain('res.json(fetchUsers)');

      // FastAPI: for loop retry
      expect(pyRoute!.content).toContain('for _attempt in range(3)');
      expect(pyRoute!.content).toContain('fetch_users = []');
      expect(pyRoute!.content).toContain('return fetch_users');
    });
  });
});
