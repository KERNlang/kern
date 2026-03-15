import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('Kern IR Fitness Tests', () => {
  // ── Spec Tests ──────────────────────────────────────────────────────────
  describe('IR Spec', () => {
    test('spec file exists at src/spec.ts or src/spec.json', () => {
      const tsExists = existsSync(resolve(ROOT, 'src/spec.ts'));
      const jsonExists = existsSync(resolve(ROOT, 'src/spec.json'));
      expect(tsExists || jsonExists).toBe(true);
    });

    test('types.ts exports KernEngine interface', () => {
      const types = readFileSync(resolve(ROOT, 'src/types.ts'), 'utf-8');
      expect(types).toContain('export interface KernEngine');
      expect(types).toContain('parse(');
      expect(types).toContain('transpile(');
      expect(types).toContain('decompile(');
    });
  });

  // ── Parser Tests ────────────────────────────────────────────────────────
  describe('Parser', () => {
    test('parser module exists', () => {
      const exists = existsSync(resolve(ROOT, 'src/parser.ts'));
      expect(exists).toBe(true);
    });

    test('parser can parse the dashboard example', async () => {
      const parserMod = await import(resolve(ROOT, 'src/parser.ts'));
      const parse = parserMod.parse || parserMod.default?.parse;
      expect(parse).toBeDefined();

      // Read the dashboard IR example
      const irPath = resolve(ROOT, 'examples/dashboard.ir');
      expect(existsSync(irPath)).toBe(true);

      const irSource = readFileSync(irPath, 'utf-8');
      const ast = parse(irSource);

      expect(ast).toBeDefined();
      expect(ast.type).toBeDefined();
      expect(typeof ast.type).toBe('string');
    });

    test('parser produces nodes with source locations', async () => {
      const parserMod = await import(resolve(ROOT, 'src/parser.ts'));
      const parse = parserMod.parse || parserMod.default?.parse;

      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
      const ast = parse(irSource);

      // At least the root node should have location info
      expect(ast.loc).toBeDefined();
      expect(ast.loc?.line).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Transpiler Tests ──────────────────────────────────────────────────
  describe('Transpiler', () => {
    test('transpiler module exists', () => {
      const exists = existsSync(resolve(ROOT, 'src/transpiler.ts'));
      expect(exists).toBe(true);
    });

    test('transpiler produces valid React Native TypeScript', async () => {
      const parserMod = await import(resolve(ROOT, 'src/parser.ts'));
      const transpilerMod = await import(resolve(ROOT, 'src/transpiler.ts'));

      const parse = parserMod.parse || parserMod.default?.parse;
      const transpile = transpilerMod.transpile || transpilerMod.default?.transpile;

      expect(transpile).toBeDefined();

      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
      const ast = parse(irSource);
      const result = transpile(ast);

      // Must produce code
      expect(result.code).toBeDefined();
      expect(result.code.length).toBeGreaterThan(100);

      // Must contain React Native imports
      expect(result.code).toContain('react-native');
      expect(result.code).toContain('View');
      expect(result.code).toContain('Text');

      // Must contain the dashboard components
      expect(result.code).toContain('FITVT');
    });

    test('transpiler produces source map entries', async () => {
      const parserMod = await import(resolve(ROOT, 'src/parser.ts'));
      const transpilerMod = await import(resolve(ROOT, 'src/transpiler.ts'));

      const parse = parserMod.parse || parserMod.default?.parse;
      const transpile = transpilerMod.transpile || transpilerMod.default?.transpile;

      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
      const ast = parse(irSource);
      const result = transpile(ast);

      expect(result.sourceMap).toBeDefined();
      expect(Array.isArray(result.sourceMap)).toBe(true);
      expect(result.sourceMap.length).toBeGreaterThan(0);
    });

    test('transpiler reports token counts', async () => {
      const parserMod = await import(resolve(ROOT, 'src/parser.ts'));
      const transpilerMod = await import(resolve(ROOT, 'src/transpiler.ts'));

      const parse = parserMod.parse || parserMod.default?.parse;
      const transpile = transpilerMod.transpile || transpilerMod.default?.transpile;

      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
      const ast = parse(irSource);
      const result = transpile(ast);

      expect(result.irTokenCount).toBeGreaterThan(0);
      expect(result.tsTokenCount).toBeGreaterThan(0);
      expect(result.tokenReduction).toBeGreaterThan(0);
    });
  });

  // ── Token Efficiency Tests ────────────────────────────────────────────
  describe('Token Efficiency', () => {
    test('IR achieves at least 30% token reduction vs TypeScript output', async () => {
      const parserMod = await import(resolve(ROOT, 'src/parser.ts'));
      const transpilerMod = await import(resolve(ROOT, 'src/transpiler.ts'));

      const parse = parserMod.parse || parserMod.default?.parse;
      const transpile = transpilerMod.transpile || transpilerMod.default?.transpile;

      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
      const ast = parse(irSource);
      const result = transpile(ast);

      // At least 30% reduction (conservative — target is 40-65%)
      expect(result.tokenReduction).toBeGreaterThanOrEqual(30);
    });
  });

  // ── Decompiler Tests ──────────────────────────────────────────────────
  describe('Decompiler', () => {
    test('decompiler module exists', () => {
      const exists = existsSync(resolve(ROOT, 'src/decompiler.ts'));
      expect(exists).toBe(true);
    });

    test('decompiler produces human-readable output', async () => {
      const parserMod = await import(resolve(ROOT, 'src/parser.ts'));
      const decompilerMod = await import(resolve(ROOT, 'src/decompiler.ts'));

      const parse = parserMod.parse || parserMod.default?.parse;
      const decompile = decompilerMod.decompile || decompilerMod.default?.decompile;

      expect(decompile).toBeDefined();

      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
      const ast = parse(irSource);
      const result = decompile(ast);

      expect(result.code).toBeDefined();
      expect(result.code.length).toBeGreaterThan(50);
      // Should be readable TypeScript-like output
      expect(result.code).toContain('Dashboard');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // EXTENDED TESTS — v1.0 cross-backend coverage
  // ══════════════════════════════════════════════════════════════════════

  describe('Parser — State & Logic', () => {
    test('parses state declarations', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const ast = parse('screen name=Test\n  state name=count initial=0');
      const stateNode = ast.children?.find((c: any) => c.type === 'state');
      expect(stateNode).toBeDefined();
      expect(stateNode?.props?.name).toBe('count');
      expect(stateNode?.props?.initial).toBe('0');
    });

    test('parses logic blocks', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const ast = parse('screen name=Test\n  logic <<<\n    console.log("hi");\n  >>>');
      const logicNode = ast.children?.find((c: any) => c.type === 'logic');
      expect(logicNode).toBeDefined();
      expect(logicNode?.props?.code).toContain('console.log');
    });

    test('parses inline expressions', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const ast = parse('screen name=Test\n  text value={{ count + 1 }}');
      const textNode = ast.children?.find((c: any) => c.type === 'text');
      expect(textNode?.props?.value).toBeDefined();
      expect(typeof textNode?.props?.value).toBe('object');
      expect((textNode?.props?.value as any).__expr).toBe(true);
      expect((textNode?.props?.value as any).code).toContain('count + 1');
    });

    test('parses theme nodes with names', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const ast = parse('screen name=Test\n  theme myTheme {h:8,br:4}');
      const themeNode = ast.children?.find((c: any) => c.type === 'theme');
      expect(themeNode).toBeDefined();
      expect(themeNode?.props?.name).toBe('myTheme');
    });

    test('parses CSS escape hatch (quoted keys)', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const ast = parse('screen name=Test\n  card {"backdrop-filter":"blur(8px)",p:16}');
      const card = ast.children?.find((c: any) => c.type === 'card');
      const styles = card?.props?.styles as Record<string, string>;
      expect(styles).toBeDefined();
      expect(styles['backdrop-filter']).toBe('blur(8px)');
      expect(styles['p']).toBe('16');
    });
  });

  describe('Tailwind Transpiler', () => {
    test('generates useState from state nodes', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileTailwind } = await import(resolve(ROOT, 'src/transpiler-tailwind.ts'));
      const ast = parse('screen name=Test\n  state name=count initial=0\n  text value=Hello');
      const result = transpileTailwind(ast);
      expect(result.code).toContain('useState');
      expect(result.code).toContain('count');
      expect(result.code).toContain('setCount');
    });

    test('generates useEffect from logic blocks', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileTailwind } = await import(resolve(ROOT, 'src/transpiler-tailwind.ts'));
      const ast = parse('screen name=Test\n  logic <<<\n    useEffect(() => {}, []);\n  >>>\n  text value=Hello');
      const result = transpileTailwind(ast);
      expect(result.code).toContain('useEffect');
      expect(result.code).toContain("from 'react'");
    });

    test('renders expressions in JSX', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileTailwind } = await import(resolve(ROOT, 'src/transpiler-tailwind.ts'));
      const ast = parse('screen name=Test\n  text value={{ count + " items" }}');
      const result = transpileTailwind(ast);
      expect(result.code).toContain('{count + " items"}');
    });

    test('generates proper Tailwind rounded classes', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileTailwind } = await import(resolve(ROOT, 'src/transpiler-tailwind.ts'));
      const ast = parse('screen name=Test\n  card {br:8,p:16}');
      const result = transpileTailwind(ast);
      expect(result.code).toContain('rounded-lg');
      expect(result.code).not.toContain('rounded-2');
    });

    test('generates pseudo-style Tailwind variants', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileTailwind } = await import(resolve(ROOT, 'src/transpiler-tailwind.ts'));
      const ast = parse('screen name=Test\n  button text=Click {bg:#007AFF,:press:bg:#005BB5}');
      const result = transpileTailwind(ast);
      expect(result.code).toContain('active:');
    });

    test('renders input with bind and placeholder', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileTailwind } = await import(resolve(ROOT, 'src/transpiler-tailwind.ts'));
      const ast = parse('screen name=Test\n  input bind=query placeholder="Search..."');
      const result = transpileTailwind(ast);
      expect(result.code).toContain('value={query}');
      expect(result.code).toContain('placeholder="Search..."');
      expect(result.code).toContain('onChange');
    });
  });

  describe('Next.js Transpiler', () => {
    test('generates use client directive', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileNextjs } = await import(resolve(ROOT, 'src/transpiler-nextjs.ts'));
      const ast = parse('page name=Test client=true\n  text value=Hello');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("'use client'");
    });

    test('generates metadata export', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileNextjs } = await import(resolve(ROOT, 'src/transpiler-nextjs.ts'));
      const ast = parse('page name=Test\n  metadata title="My Page" description="A page"');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('Metadata');
      expect(result.code).toContain("title: 'My Page'");
    });

    test('uses next/link for navigation', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileNextjs } = await import(resolve(ROOT, 'src/transpiler-nextjs.ts'));
      const ast = parse('page name=Test client=true\n  button text="Go" to=dashboard');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("next/link");
      expect(result.code).toContain('Link');
    });
  });

  describe('Web Transpiler', () => {
    test('generates HTML elements not React Native', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileWeb } = await import(resolve(ROOT, 'src/transpiler-web.ts'));
      const ast = parse('screen name=Test\n  row\n    text value=Hello\n    button text=Click');
      const result = transpileWeb(ast);
      expect(result.code).toContain('<div');
      expect(result.code).toContain('<span');
      expect(result.code).toContain('<button');
      expect(result.code).not.toContain('View');
      expect(result.code).not.toContain('TouchableOpacity');
    });
  });

  describe('Roundtrip', () => {
    test('minify then parse preserves tree structure', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.kern'), 'utf-8');
      const ast1 = parse(irSource);

      // Read the minified version
      const minPath = resolve(ROOT, 'examples/dashboard.min.kern');
      if (existsSync(minPath)) {
        const minSource = readFileSync(minPath, 'utf-8');
        const ast2 = parse(minSource);
        expect(ast2.type).toBe(ast1.type);
        expect(ast2.children?.length).toBeGreaterThan(0);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // CONFIG & VALIDATION TESTS — Phase 1B
  // ══════════════════════════════════════════════════════════════════════

  describe('Config', () => {
    test('resolveConfig returns defaults when no user config', async () => {
      const { resolveConfig } = await import(resolve(ROOT, 'src/config.ts'));
      const config = resolveConfig();
      expect(config.target).toBe('nextjs');
      expect(config.i18n.enabled).toBe(true);
      expect(config.i18n.hookName).toBe('useTranslation');
      expect(config.components.uiLibrary).toBe('@components/ui');
      expect(config.output.outDir).toBe('.');
    });

    test('resolveConfig merges user overrides', async () => {
      const { resolveConfig } = await import(resolve(ROOT, 'src/config.ts'));
      const config = resolveConfig({
        target: 'tailwind',
        i18n: { enabled: false },
        colors: { '#custom': 'brand-500' },
      });
      expect(config.target).toBe('tailwind');
      expect(config.i18n.enabled).toBe(false);
      expect(config.i18n.hookName).toBe('useTranslation'); // default preserved
      expect(config.colors['#custom']).toBe('brand-500');
      expect(config.colors['#18181b']).toBe('zinc-900'); // default preserved
    });

    test('resolveConfig throws on unknown target', async () => {
      const { resolveConfig } = await import(resolve(ROOT, 'src/config.ts'));
      expect(() => resolveConfig({ target: 'invalid-target' as any })).toThrow('Unknown target');
    });

    test('resolveConfig accepts express as a valid target', async () => {
      const { resolveConfig } = await import(resolve(ROOT, 'src/config.ts'));
      const config = resolveConfig({ target: 'express' });
      expect(config.target).toBe('express');
    });

    test('custom colors produce custom Tailwind classes', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileTailwind } = await import(resolve(ROOT, 'src/transpiler-tailwind.ts'));
      const { resolveConfig } = await import(resolve(ROOT, 'src/config.ts'));
      const config = resolveConfig({ colors: { '#custom123': 'brand-500' } });
      const ast = parse('screen name=Test\n  card {bg:#custom123}');
      const result = transpileTailwind(ast, config);
      expect(result.code).toContain('bg-brand-500');
    });

    test('i18n.enabled=false suppresses t() wrapping', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileTailwind } = await import(resolve(ROOT, 'src/transpiler-tailwind.ts'));
      const { resolveConfig } = await import(resolve(ROOT, 'src/config.ts'));
      const config = resolveConfig({ i18n: { enabled: false } });
      const ast = parse('screen name=Test\n  text value=Hello');
      const result = transpileTailwind(ast, config);
      expect(result.code).not.toContain('useTranslation');
      expect(result.code).not.toContain("from 'react-i18next'");
      expect(result.code).not.toContain("t('"); // no t() calls in JSX body
      expect(result.code).toContain('Hello'); // raw string present
    });

    test('custom uiLibrary changes import path', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileTailwind } = await import(resolve(ROOT, 'src/transpiler-tailwind.ts'));
      const { resolveConfig } = await import(resolve(ROOT, 'src/config.ts'));
      const config = resolveConfig({ components: { uiLibrary: '@mylib/design-system' } });
      const ast = parse('screen name=Test\n  section title="Settings" icon=info tooltip="Help"');
      const result = transpileTailwind(ast, config);
      expect(result.code).toContain("from '@mylib/design-system'");
    });

    test('GeneratedArtifact type exists on TranspileResult', async () => {
      const types = readFileSync(resolve(ROOT, 'src/types.ts'), 'utf-8');
      expect(types).toContain('export interface GeneratedArtifact');
      expect(types).toContain("'page' | 'layout' | 'route' | 'middleware' | 'component' | 'config'");
      expect(types).toContain('artifacts?: GeneratedArtifact[]');
    });
  });

  describe('Express Transpiler', () => {
    test('parser supports server, schema, and handler backend nodes', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
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
      expect(schema?.props?.response).toBe('{ok: boolean}');
      expect(handler?.props?.code).toContain('res.json');
    });

    test('express transpiler generates multi-file route and middleware artifacts', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileExpress } = await import(resolve(ROOT, 'src/transpiler-express.ts'));
      const source = readFileSync(resolve(ROOT, 'examples/api-routes.kern'), 'utf-8');

      const result = transpileExpress(parse(source));

      expect(result.code).toContain(`import { verifyToken } from './middleware/auth.js';`);
      expect(result.code).toContain(`import { registerGetApiTracksRoute } from './routes/get-api-tracks.js';`);
      expect(result.code).toContain('app.use(cors());');
      expect(result.code).toContain('app.use(express.json());');
      expect(result.artifacts).toBeDefined();
      expect(result.artifacts?.some((artifact: any) => artifact.path === 'routes/post-api-tracks-analyze.ts')).toBe(true);
      expect(result.artifacts?.some((artifact: any) => artifact.path === 'middleware/auth.ts')).toBe(true);
    });

    test('express transpiler emits schema guards and ignores frontend nodes', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileExpress } = await import(resolve(ROOT, 'src/transpiler-express.ts'));
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
  });
});
