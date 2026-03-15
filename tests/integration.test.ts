import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('End-to-End Integration', () => {
  describe('All targets produce valid output for dashboard.kern', () => {
    let parse: any;
    let ast: any;

    beforeAll(async () => {
      const mod = await import(resolve(ROOT, 'src/parser.ts'));
      parse = mod.parse;
      ast = parse(readFileSync(resolve(ROOT, 'examples/dashboard.kern'), 'utf-8'));
    });

    test('native target', async () => {
      const { transpile } = await import(resolve(ROOT, 'src/transpiler.ts'));
      const result = transpile(ast);
      expect(result.code).toContain('react-native');
      expect(result.tokenReduction).toBeGreaterThan(30);
    });

    test('web target', async () => {
      const { transpileWeb } = await import(resolve(ROOT, 'src/transpiler-web.ts'));
      const result = transpileWeb(ast);
      expect(result.code).toContain('React.CSSProperties');
      expect(result.tokenReduction).toBeGreaterThan(30);
    });

    test('tailwind target', async () => {
      const { transpileTailwind } = await import(resolve(ROOT, 'src/transpiler-tailwind.ts'));
      const result = transpileTailwind(ast);
      expect(result.code).toContain('useTranslation');
      expect(result.tokenReduction).toBeGreaterThan(30);
    });

    test('nextjs target', async () => {
      const { transpileNextjs } = await import(resolve(ROOT, 'src/transpiler-nextjs.ts'));
      const result = transpileNextjs(ast);
      expect(result.code).toContain('export default function');
      expect(result.tokenReduction).toBeGreaterThan(0);
    });
  });

  describe('Express target produces multi-file output', () => {
    test('api-routes.kern generates server + routes + middleware', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileExpress } = await import(resolve(ROOT, 'src/transpiler-express.ts'));
      const source = readFileSync(resolve(ROOT, 'examples/api-routes.kern'), 'utf-8');
      const ast = parse(source);
      const result = transpileExpress(ast);

      expect(result.artifacts).toBeDefined();
      expect(result.artifacts!.length).toBeGreaterThanOrEqual(2);

      const paths = result.artifacts!.map((a: any) => a.path);
      expect(paths.some((p: string) => p.includes('route'))).toBe(true);

      // Verify route content
      const routeArtifact = result.artifacts!.find((a: any) => a.type === 'route');
      expect(routeArtifact).toBeDefined();
      expect(routeArtifact!.content).toContain('/api/tracks');

      // Server code should have express setup
      expect(result.code).toContain('express');
      expect(result.code).toContain('listen');
    });
  });

  describe('Config threading works end-to-end', () => {
    test('custom colors flow through to tailwind output', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileTailwind } = await import(resolve(ROOT, 'src/transpiler-tailwind.ts'));
      const { resolveConfig } = await import(resolve(ROOT, 'src/config.ts'));

      const config = resolveConfig({
        colors: { '#FF0000': 'brand-red', '#00FF00': 'brand-green' },
      });

      const ast = parse('screen name=Test\n  card {bg:#FF0000}\n  text value=Hi {c:#00FF00}');
      const result = transpileTailwind(ast, config);

      expect(result.code).toContain('bg-brand-red');
      expect(result.code).toContain('text-brand-green');
    });

    test('i18n disabled produces clean output without t()', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { transpileTailwind } = await import(resolve(ROOT, 'src/transpiler-tailwind.ts'));
      const { resolveConfig } = await import(resolve(ROOT, 'src/config.ts'));

      const config = resolveConfig({ i18n: { enabled: false } });
      const ast = parse('screen name=Test\n  text value=Hello\n  button text=Click onClick=handleClick');
      const result = transpileTailwind(ast, config);

      expect(result.code).not.toContain('useTranslation');
      expect(result.code).not.toContain("t('");
      expect(result.code).toContain('Hello');
      expect(result.code).toContain('Click');
    });
  });

  describe('Metrics + context export round-trip', () => {
    test('scanKernProject → projectToKern produces valid context', async () => {
      const { scanKernProject, projectToKern } = await import(resolve(ROOT, 'src/context-export.ts'));
      const summary = scanKernProject(ROOT);
      const output = projectToKern(summary);

      // Should include all .kern files
      expect(output).toContain('dashboard.kern');
      expect(output).toContain('nextjs-landing.kern');
      expect(output).toContain('api-routes.kern');

      // Should have metrics
      expect(output).toContain('escapeRatio');
      expect(output).toContain('nodeTypes');

      // Target should be nextjs (default)
      expect(output).toContain('target: "nextjs"');
    });

    test('metrics agree between individual and merged', async () => {
      const { parse } = await import(resolve(ROOT, 'src/parser.ts'));
      const { collectLanguageMetrics, mergeMetrics } = await import(resolve(ROOT, 'src/metrics.ts'));

      const files = ['examples/dashboard.kern', 'examples/nextjs-landing.kern'];
      const metrics = files.map(f => {
        const source = readFileSync(resolve(ROOT, f), 'utf-8');
        return collectLanguageMetrics(parse(source));
      });

      const merged = mergeMetrics(metrics);
      const totalNodes = metrics.reduce((sum, m) => sum + m.nodeCount, 0);

      expect(merged.nodeCount).toBe(totalNodes);
      expect(merged.styleMetrics.totalStyleDecls).toBe(
        metrics.reduce((sum, m) => sum + m.styleMetrics.totalStyleDecls, 0)
      );
    });
  });

  describe('Package index exports', () => {
    test('index.ts re-exports all public API', async () => {
      const kern = await import(resolve(ROOT, 'src/index.ts'));

      // Core
      expect(kern.parse).toBeDefined();
      expect(kern.decompile).toBeDefined();

      // Transpilers
      expect(kern.transpile).toBeDefined();
      expect(kern.transpileWeb).toBeDefined();
      expect(kern.transpileTailwind).toBeDefined();
      expect(kern.transpileNextjs).toBeDefined();
      expect(kern.transpileExpress).toBeDefined();

      // Config
      expect(kern.resolveConfig).toBeDefined();
      expect(kern.VALID_TARGETS).toBeDefined();
      expect(kern.VALID_TARGETS).toContain('express');

      // Metrics
      expect(kern.collectLanguageMetrics).toBeDefined();
      expect(kern.isEscapedStyleKey).toBeDefined();

      // Context export
      expect(kern.scanKernProject).toBeDefined();
      expect(kern.projectToKern).toBeDefined();

      // Spec
      expect(kern.KERN_VERSION).toBe('2.0.0');
      expect(kern.STYLE_SHORTHANDS).toBeDefined();
    });
  });
});
