import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('React Transpilers', () => {
  describe('Tailwind Transpiler', () => {
    test('generates useState from state nodes', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileTailwind } = await import('../src/transpiler-tailwind.js');
      const ast = parse('screen name=Test\n  state name=count initial=0\n  text value=Hello');
      const result = transpileTailwind(ast);
      expect(result.code).toContain('useState');
      expect(result.code).toContain('count');
      expect(result.code).toContain('setCount');
    });

    test('generates useEffect from logic blocks', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileTailwind } = await import('../src/transpiler-tailwind.js');
      const ast = parse('screen name=Test\n  logic <<<\n    useEffect(() => {}, []);\n  >>>\n  text value=Hello');
      const result = transpileTailwind(ast);
      expect(result.code).toContain('useEffect');
      expect(result.code).toContain("from 'react'");
    });

    test('renders expressions in JSX', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileTailwind } = await import('../src/transpiler-tailwind.js');
      const ast = parse('screen name=Test\n  text value={{ count + " items" }}');
      const result = transpileTailwind(ast);
      expect(result.code).toContain('{count + " items"}');
    });

    test('generates proper Tailwind rounded classes', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileTailwind } = await import('../src/transpiler-tailwind.js');
      const ast = parse('screen name=Test\n  card {br:8,p:16}');
      const result = transpileTailwind(ast);
      expect(result.code).toContain('rounded-lg');
      expect(result.code).not.toContain('rounded-2');
    });

    test('generates pseudo-style Tailwind variants', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileTailwind } = await import('../src/transpiler-tailwind.js');
      const ast = parse('screen name=Test\n  button text=Click {bg:#007AFF,:press:bg:#005BB5}');
      const result = transpileTailwind(ast);
      expect(result.code).toContain('active:');
    });

    test('renders input with bind and placeholder', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileTailwind } = await import('../src/transpiler-tailwind.js');
      const ast = parse('screen name=Test\n  input bind=query placeholder="Search..."');
      const result = transpileTailwind(ast);
      expect(result.code).toContain('value={query}');
      expect(result.code).toContain('placeholder="Search..."');
      expect(result.code).toContain('onChange');
    });

    test('custom colors produce custom Tailwind classes', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileTailwind } = await import('../src/transpiler-tailwind.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const config = resolveConfig({ colors: { '#custom123': 'brand-500' } });
      const ast = parse('screen name=Test\n  card {bg:#custom123}');
      const result = transpileTailwind(ast, config);
      expect(result.code).toContain('bg-brand-500');
    });

    test('i18n.enabled=false suppresses t() wrapping', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileTailwind } = await import('../src/transpiler-tailwind.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const config = resolveConfig({ i18n: { enabled: false } });
      const ast = parse('screen name=Test\n  text value=Hello');
      const result = transpileTailwind(ast, config);
      expect(result.code).not.toContain('useTranslation');
      expect(result.code).not.toContain("from 'react-i18next'");
      expect(result.code).not.toContain("t('");
      expect(result.code).toContain('Hello');
    });

    test('custom uiLibrary changes import path', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileTailwind } = await import('../src/transpiler-tailwind.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const config = resolveConfig({ components: { uiLibrary: '@mylib/design-system' } });
      const ast = parse('screen name=Test\n  section title="Settings" icon=info tooltip="Help"');
      const result = transpileTailwind(ast, config);
      expect(result.code).toContain("from '@mylib/design-system'");
    });
  });

  describe('Next.js Transpiler', () => {
    test('generates use client directive', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileNextjs } = await import('../src/transpiler-nextjs.js');
      const ast = parse('page name=Test client=true\n  text value=Hello');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("'use client'");
    });

    test('generates metadata export', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileNextjs } = await import('../src/transpiler-nextjs.js');
      const ast = parse('page name=Test\n  metadata title="My Page" description="A page"');
      const result = transpileNextjs(ast);
      expect(result.code).toContain('Metadata');
      expect(result.code).toContain("title: 'My Page'");
    });

    test('uses next/link for navigation', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileNextjs } = await import('../src/transpiler-nextjs.js');
      const ast = parse('page name=Test client=true\n  button text="Go" to=dashboard');
      const result = transpileNextjs(ast);
      expect(result.code).toContain("next/link");
      expect(result.code).toContain('Link');
    });
  });

  describe('Web Transpiler', () => {
    test('generates HTML elements not React Native', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileWeb } = await import('../src/transpiler-web.js');
      const ast = parse('screen name=Test\n  row\n    text value=Hello\n    button text=Click');
      const result = transpileWeb(ast);
      expect(result.code).toContain('<div');
      expect(result.code).toContain('<span');
      expect(result.code).toContain('<button');
      expect(result.code).not.toContain('View');
      expect(result.code).not.toContain('TouchableOpacity');
    });
  });
});
