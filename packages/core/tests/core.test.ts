import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Kern Core', () => {
  // ── Spec Tests ──────────────────────────────────────────────────────────
  describe('IR Spec', () => {
    test('spec file exists', () => {
      expect(existsSync(resolve(ROOT, 'packages/core/src/spec.ts'))).toBe(true);
    });

    test('types.ts exports KernEngine interface', () => {
      const types = readFileSync(resolve(ROOT, 'packages/core/src/types.ts'), 'utf-8');
      expect(types).toContain('export interface KernEngine');
      expect(types).toContain('parse(');
      expect(types).toContain('transpile(');
      expect(types).toContain('decompile(');
    });
  });

  // ── Parser Tests ────────────────────────────────────────────────────────
  describe('Parser', () => {
    test('parser can parse the dashboard example', async () => {
      const { parse } = await import('../src/parser.js');
      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
      const ast = parse(irSource);
      expect(ast).toBeDefined();
      expect(ast.type).toBeDefined();
      expect(typeof ast.type).toBe('string');
    });

    test('parser produces nodes with source locations', async () => {
      const { parse } = await import('../src/parser.js');
      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
      const ast = parse(irSource);
      expect(ast.loc).toBeDefined();
      expect(ast.loc?.line).toBeGreaterThanOrEqual(1);
    });

    test('parses state declarations', async () => {
      const { parse } = await import('../src/parser.js');
      const ast = parse('screen name=Test\n  state name=count initial=0');
      const stateNode = ast.children?.find((c: any) => c.type === 'state');
      expect(stateNode).toBeDefined();
      expect(stateNode?.props?.name).toBe('count');
      expect(stateNode?.props?.initial).toBe('0');
    });

    test('parses logic blocks', async () => {
      const { parse } = await import('../src/parser.js');
      const ast = parse('screen name=Test\n  logic <<<\n    console.log("hi");\n  >>>');
      const logicNode = ast.children?.find((c: any) => c.type === 'logic');
      expect(logicNode).toBeDefined();
      expect(logicNode?.props?.code).toContain('console.log');
    });

    test('parses inline expressions', async () => {
      const { parse } = await import('../src/parser.js');
      const ast = parse('screen name=Test\n  text value={{ count + 1 }}');
      const textNode = ast.children?.find((c: any) => c.type === 'text');
      expect(textNode?.props?.value).toBeDefined();
      expect(typeof textNode?.props?.value).toBe('object');
      expect((textNode?.props?.value as any).__expr).toBe(true);
      expect((textNode?.props?.value as any).code).toContain('count + 1');
    });

    test('parses theme nodes with names', async () => {
      const { parse } = await import('../src/parser.js');
      const ast = parse('screen name=Test\n  theme myTheme {h:8,br:4}');
      const themeNode = ast.children?.find((c: any) => c.type === 'theme');
      expect(themeNode).toBeDefined();
      expect(themeNode?.props?.name).toBe('myTheme');
    });

    test('parses CSS escape hatch (quoted keys)', async () => {
      const { parse } = await import('../src/parser.js');
      const ast = parse('screen name=Test\n  card {"backdrop-filter":"blur(8px)",p:16}');
      const card = ast.children?.find((c: any) => c.type === 'card');
      const styles = card?.props?.styles as Record<string, string>;
      expect(styles).toBeDefined();
      expect(styles['backdrop-filter']).toBe('blur(8px)');
      expect(styles['p']).toBe('16');
    });

    test('parser supports server, schema, and handler backend nodes', async () => {
      const { parse } = await import('../src/parser.js');
      const source = [
        'server name=TestAPI port=3001',
        '  route method=post path=/tracks',
        '    schema body="{trackId: string}" response="{ok: boolean}"',
        '    handler <<<',
        '      res.json({ ok: true });',
        '    >>>',
      ].join('\n');

      const ast = parse(source);
      const route = ast.children?.find((child: any) => child.type === 'route');
      const schema = route?.children?.find((child: any) => child.type === 'schema');
      const handler = route?.children?.find((child: any) => child.type === 'handler');

      expect(ast.type).toBe('server');
      expect(route?.props?.method).toBe('post');
      expect(schema?.props?.body).toBe('{trackId: string}');
      expect(handler?.props?.code).toContain('res.json');
    });
  });

  // ── Decompiler Tests ──────────────────────────────────────────────────
  describe('Decompiler', () => {
    test('decompiler produces human-readable output', async () => {
      const { parse } = await import('../src/parser.js');
      const { decompile } = await import('../src/decompiler.js');
      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
      const ast = parse(irSource);
      const result = decompile(ast);
      expect(result.code).toBeDefined();
      expect(result.code.length).toBeGreaterThan(50);
      expect(result.code).toContain('Dashboard');
    });
  });

  // ── Config Tests ──────────────────────────────────────────────────────
  describe('Config', () => {
    test('resolveConfig returns defaults when no user config', async () => {
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig();
      expect(config.target).toBe('nextjs');
      expect(config.i18n.enabled).toBe(true);
      expect(config.i18n.hookName).toBe('useTranslation');
      expect(config.components.uiLibrary).toBe('@components/ui');
      expect(config.output.outDir).toBe('.');
    });

    test('resolveConfig merges user overrides', async () => {
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig({
        target: 'tailwind',
        i18n: { enabled: false },
        colors: { '#custom': 'brand-500' },
      });
      expect(config.target).toBe('tailwind');
      expect(config.i18n.enabled).toBe(false);
      expect(config.i18n.hookName).toBe('useTranslation');
      expect(config.colors['#custom']).toBe('brand-500');
      expect(config.colors['#18181b']).toBe('zinc-900');
    });

    test('resolveConfig throws on unknown target', async () => {
      const { resolveConfig } = await import('../src/config.js');
      expect(() => resolveConfig({ target: 'invalid-target' as any })).toThrow('Unknown target');
    });

    test('resolveConfig accepts express as a valid target', async () => {
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig({ target: 'express' });
      expect(config.target).toBe('express');
    });

    test('resolveConfig accepts cli as a valid target', async () => {
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig({ target: 'cli' });
      expect(config.target).toBe('cli');
    });

    test('resolveConfig accepts terminal as a valid target', async () => {
      const { resolveConfig } = await import('../src/config.js');
      const config = resolveConfig({ target: 'terminal' });
      expect(config.target).toBe('terminal');
    });

    test('GeneratedArtifact type exists on TranspileResult', async () => {
      const types = readFileSync(resolve(ROOT, 'packages/core/src/types.ts'), 'utf-8');
      expect(types).toContain('export interface GeneratedArtifact');
      expect(types).toContain("'page' | 'layout' | 'route' | 'middleware' | 'component' | 'config' | 'entry' | 'command' | 'hook' | 'types' | 'barrel' | 'theme' | 'template'");
      expect(types).toContain('artifacts?: GeneratedArtifact[]');
    });
  });

  // ── Escape Function Tests ──────────────────────────────────────────
  describe('Escape Functions', () => {
    test('escapeJsxText escapes HTML/JSX special chars', async () => {
      const { escapeJsxText } = await import('../src/utils.js');
      expect(escapeJsxText('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(escapeJsxText('a & b')).toBe('a &amp; b');
      expect(escapeJsxText('{dangerous}')).toBe('&#123;dangerous&#125;');
      expect(escapeJsxText('safe text')).toBe('safe text');
    });

    test('escapeJsxAttr escapes attribute special chars', async () => {
      const { escapeJsxAttr } = await import('../src/utils.js');
      expect(escapeJsxAttr('" onload="alert(1)"')).toBe('&quot; onload=&quot;alert(1)&quot;');
      expect(escapeJsxAttr('<img>')).toBe('&lt;img&gt;');
      expect(escapeJsxAttr('a & b')).toBe('a &amp; b');
      expect(escapeJsxAttr('safe value')).toBe('safe value');
    });

    test('escapeJsString escapes JS string literal chars', async () => {
      const { escapeJsString } = await import('../src/utils.js');
      expect(escapeJsString("it's")).toBe("it\\'s");
      expect(escapeJsString('back\\slash')).toBe('back\\\\slash');
      expect(escapeJsString('line\nbreak')).toBe('line\\nbreak');
      expect(escapeJsString('safe string')).toBe('safe string');
    });

    test('escapeJsx is backward-compatible alias for escapeJsxText', async () => {
      const { escapeJsx, escapeJsxText } = await import('../src/utils.js');
      const input = '<script>alert("xss")</script>';
      expect(escapeJsx(input)).toBe(escapeJsxText(input));
    });
  });

  // ── Roundtrip Tests ──────────────────────────────────────────────────
  describe('Roundtrip', () => {
    test('minify then parse preserves tree structure', async () => {
      const { parse } = await import('../src/parser.js');
      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.kern'), 'utf-8');
      const ast1 = parse(irSource);

      const minPath = resolve(ROOT, 'examples/dashboard.min.kern');
      if (existsSync(minPath)) {
        const minSource = readFileSync(minPath, 'utf-8');
        const ast2 = parse(minSource);
        expect(ast2.type).toBe(ast1.type);
        expect(ast2.children?.length).toBeGreaterThan(0);
      }
    });
  });

  // ── Route v3 Parser Tests ─────────────────────────────────────────────
  describe('Route v3 Parser', () => {
    test('parses route GET /api/users positional syntax', async () => {
      const { parse } = await import('../src/parser.js');
      const ast = parse('server name=Test\n  route GET /api/users');
      const route = ast.children![0];
      expect(route.type).toBe('route');
      expect(route.props?.method).toBe('get');
      expect(route.props?.path).toBe('/api/users');
    });

    test('parses route POST /api/users case-insensitive', async () => {
      const { parse } = await import('../src/parser.js');
      const ast = parse('server name=Test\n  route post /api/users');
      const route = ast.children![0];
      expect(route.props?.method).toBe('post');
      expect(route.props?.path).toBe('/api/users');
    });

    test('parses params with types and defaults', async () => {
      const { parse } = await import('../src/parser.js');
      const ast = parse('route GET /api/users\n  params page:number = 1, limit:number = 20');
      const params = ast.children![0];
      expect(params.type).toBe('params');
      const items = params.props?.items as Array<{ name: string; type: string; default?: string }>;
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({ name: 'page', type: 'number', default: '1' });
      expect(items[1]).toEqual({ name: 'limit', type: 'number', default: '20' });
    });

    test('parses params without defaults', async () => {
      const { parse } = await import('../src/parser.js');
      const ast = parse('route GET /api/search\n  params q:string');
      const params = ast.children![0];
      const items = params.props?.items as Array<{ name: string; type: string; default?: string }>;
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({ name: 'q', type: 'string' });
    });

    test('parses auth mode', async () => {
      const { parse } = await import('../src/parser.js');
      const ast = parse('route GET /api/users\n  auth required');
      const auth = ast.children![0];
      expect(auth.type).toBe('auth');
      expect(auth.props?.mode).toBe('required');
    });

    test('parses validate schema name', async () => {
      const { parse } = await import('../src/parser.js');
      const ast = parse('route POST /api/users\n  validate CreateUserSchema');
      const validate = ast.children![0];
      expect(validate.type).toBe('validate');
      expect(validate.props?.schema).toBe('CreateUserSchema');
    });

    test('parses error with numeric status and message', async () => {
      const { parse } = await import('../src/parser.js');
      const ast = parse('route GET /api/users\n  error 401 "Unauthorized"');
      const error = ast.children![0];
      expect(error.type).toBe('error');
      expect(error.props?.status).toBe(401);
      expect(error.props?.message).toBe('Unauthorized');
    });

    test('parses middleware bare word list', async () => {
      const { parse } = await import('../src/parser.js');
      const ast = parse('route GET /api/users\n  middleware rateLimit, cors');
      const mw = ast.children![0];
      expect(mw.type).toBe('middleware');
      expect(mw.props?.names).toEqual(['rateLimit', 'cors']);
    });

    test('parses middleware single bare word', async () => {
      const { parse } = await import('../src/parser.js');
      const ast = parse('route GET /api/users\n  middleware rateLimit');
      const mw = ast.children![0];
      expect(mw.type).toBe('middleware');
      expect(mw.props?.name).toBe('rateLimit');
    });

    test('backward compat: route method=get path=/ still parses', async () => {
      const { parse } = await import('../src/parser.js');
      const ast = parse('server name=Test\n  route method=get path=/api/health');
      const route = ast.children![0];
      expect(route.type).toBe('route');
      expect(route.props?.method).toBe('get');
      expect(route.props?.path).toBe('/api/health');
    });

    test('parses full v3 route with all children', async () => {
      const { parse } = await import('../src/parser.js');
      const source = [
        'route GET /api/users',
        '  params page:number = 1, limit:number = 20',
        '  auth required',
        '  validate UserQuerySchema',
        '  middleware rateLimit, cors',
        '  handler <<<',
        '    res.json([]);',
        '  >>>',
        '  error 401 "Unauthorized"',
        '  error 500 "Server error"',
      ].join('\n');
      const ast = parse(source);
      expect(ast.type).toBe('route');
      expect(ast.props?.method).toBe('get');
      expect(ast.props?.path).toBe('/api/users');
      expect(ast.children).toHaveLength(7); // params, auth, validate, middleware, handler, error x2

      const types = ast.children!.map(c => c.type);
      expect(types).toContain('params');
      expect(types).toContain('auth');
      expect(types).toContain('validate');
      expect(types).toContain('middleware');
      expect(types).toContain('handler');
      expect(types).toContain('error');
      expect(types.filter(t => t === 'error')).toHaveLength(2);
    });
  });
});
