import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Metrics Engine', () => {
  describe('isEscapedStyleKey', () => {
    test('known shorthand "p" → false (maps to padding)', async () => {
      const { isEscapedStyleKey } = await import('../src/metrics.js');
      expect(isEscapedStyleKey('p')).toBe(false);
    });

    test('known full name "backgroundColor" → false', async () => {
      const { isEscapedStyleKey } = await import('../src/metrics.js');
      expect(isEscapedStyleKey('backgroundColor')).toBe(false);
    });

    test('shorthand "br" → borderRadius → false', async () => {
      const { isEscapedStyleKey } = await import('../src/metrics.js');
      expect(isEscapedStyleKey('br')).toBe(false);
    });

    test('unknown "backdrop-filter" → true', async () => {
      const { isEscapedStyleKey } = await import('../src/metrics.js');
      expect(isEscapedStyleKey('backdrop-filter')).toBe(true);
    });

    test('unknown "transition" → true', async () => {
      const { isEscapedStyleKey } = await import('../src/metrics.js');
      expect(isEscapedStyleKey('transition')).toBe(true);
    });

    test('shorthand "ta" → textAlign → false (now mapped)', async () => {
      const { isEscapedStyleKey } = await import('../src/metrics.js');
      expect(isEscapedStyleKey('ta')).toBe(false);
    });

    test('shorthand "shadow" → elevation → false (now mapped)', async () => {
      const { isEscapedStyleKey } = await import('../src/metrics.js');
      expect(isEscapedStyleKey('shadow')).toBe(false);
    });
  });

  describe('collectLanguageMetrics — dashboard.kern', () => {
    test('produces valid metrics', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { collectLanguageMetrics } = await import('../src/metrics.js');
      const source = readFileSync(resolve(ROOT, 'examples/dashboard.kern'), 'utf-8');
      const ast = parse(source);
      const metrics = collectLanguageMetrics(ast);

      expect(metrics.nodeCount).toBeGreaterThan(10);
      expect(metrics.nodeTypes.find((n: any) => n.type === 'screen')?.count).toBe(1);
      expect(metrics.themeRefCount).toBeGreaterThan(0);
      expect(metrics.styleMetrics.escapeRatio).toBe(0);
      expect(metrics.tokenEfficiency).toBeNull();
    });
  });

  describe('collectLanguageMetrics — nextjs-landing.kern', () => {
    test('detects escape hatches', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { collectLanguageMetrics } = await import('../src/metrics.js');
      const source = readFileSync(resolve(ROOT, 'examples/nextjs-landing.kern'), 'utf-8');
      const ast = parse(source);
      const metrics = collectLanguageMetrics(ast);

      expect(metrics.styleMetrics.escapeRatio).toBeGreaterThan(0);
      expect(metrics.styleMetrics.escapedKeys).toContain('transition');
    });
  });

  describe('collectLanguageMetrics — with TranspileResult', () => {
    test('attaches token efficiency', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileTailwind } = await import('../../react/src/transpiler-tailwind.js');
      const { collectLanguageMetrics } = await import('../src/metrics.js');
      const source = readFileSync(resolve(ROOT, 'examples/dashboard.kern'), 'utf-8');
      const ast = parse(source);
      const result = transpileTailwind(ast);
      const metrics = collectLanguageMetrics(ast, result);

      expect(metrics.tokenEfficiency).not.toBeNull();
      expect(metrics.tokenEfficiency!.tokenReduction).toBeGreaterThan(30);
    });
  });

  describe('collectLanguageMetrics — empty tree', () => {
    test('handles minimal input', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { collectLanguageMetrics } = await import('../src/metrics.js');
      const ast = parse('screen name=Empty');
      const metrics = collectLanguageMetrics(ast);

      expect(metrics.nodeCount).toBe(1);
      expect(metrics.styleMetrics.escapeRatio).toBe(0);
      expect(metrics.tokenEfficiency).toBeNull();
    });
  });

  describe('mergeMetrics', () => {
    test('merges metrics from multiple files', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { collectLanguageMetrics, mergeMetrics } = await import('../src/metrics.js');

      const ast1 = parse(readFileSync(resolve(ROOT, 'examples/dashboard.kern'), 'utf-8'));
      const ast2 = parse(readFileSync(resolve(ROOT, 'examples/nextjs-landing.kern'), 'utf-8'));

      const m1 = collectLanguageMetrics(ast1);
      const m2 = collectLanguageMetrics(ast2);
      const merged = mergeMetrics([m1, m2]);

      expect(merged.nodeCount).toBe(m1.nodeCount + m2.nodeCount);
      expect(merged.styleMetrics.totalStyleDecls).toBe(
        m1.styleMetrics.totalStyleDecls + m2.styleMetrics.totalStyleDecls,
      );
      expect(merged.styleMetrics.escapedKeys).toContain('transition');
    });
  });
});
