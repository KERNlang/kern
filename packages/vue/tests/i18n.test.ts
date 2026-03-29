import { parse } from '../../core/src/parser.js';
import { transpileVue } from '../src/transpiler-vue.js';
import { transpileNuxt } from '../src/transpiler-nuxt.js';
import { transpileTailwindVue } from '../src/transpiler-tailwind-vue.js';
import { resolveConfig } from '../../core/src/config.js';

describe('i18n Integration', () => {
  const i18nConfig = resolveConfig({ i18n: { enabled: true } });
  const customConfig = resolveConfig({
    i18n: { enabled: true, hookName: 'useI18n', importPath: '@/i18n' },
  });

  // ── Vue SFC Transpiler ──

  describe('transpileVue', () => {
    test('i18n disabled: raw text, no import', () => {
      const ast = parse('screen name=Test\n  text value=Hello');
      const result = transpileVue(ast);
      expect(result.code).toContain('Hello');
      expect(result.code).not.toContain("t('");
      expect(result.code).not.toContain('useI18n');
    });

    test('i18n enabled: wraps text with t()', () => {
      const ast = parse('screen name=Test\n  text value=Hello');
      const result = transpileVue(ast, i18nConfig);
      expect(result.code).toContain("t('");
      expect(result.code).toContain('Hello');
    });

    test('i18n enabled: imports useI18n and initializes', () => {
      const ast = parse('screen name=Test\n  text value=Hello');
      const result = transpileVue(ast, i18nConfig);
      expect(result.code).toContain("import { useI18n } from 'vue-i18n'");
      expect(result.code).toContain('const { t } = useI18n()');
    });

    test('custom i18n hook and import path', () => {
      const ast = parse('screen name=Test\n  text value=Hello');
      const result = transpileVue(ast, customConfig);
      expect(result.code).toContain("import { useI18n } from '@/i18n'");
    });

    test('expressions are not wrapped with t()', () => {
      const ast = parse('screen name=Test\n  text value={{count}}');
      const result = transpileVue(ast, i18nConfig);
      expect(result.code).toContain('{{ count }}');
      expect(result.code).not.toContain("t('count");
    });
  });

  // ── Nuxt Transpiler ──

  describe('transpileNuxt', () => {
    test('i18n disabled: raw text, no $t', () => {
      const ast = parse('screen name=Test\n  text value=Hello');
      const result = transpileNuxt(ast);
      expect(result.code).toContain('Hello');
      expect(result.code).not.toContain("$t('");
    });

    test('i18n enabled: wraps text with $t()', () => {
      const ast = parse('screen name=Test\n  text value=Hello');
      const result = transpileNuxt(ast, i18nConfig);
      expect(result.code).toContain("$t('");
    });

    test('expressions are not wrapped with $t()', () => {
      const ast = parse('screen name=Test\n  text value={{count}}');
      const result = transpileNuxt(ast, i18nConfig);
      expect(result.code).toContain('{{ count }}');
      expect(result.code).not.toContain("$t('count");
    });
  });

  // ── Tailwind Vue Transpiler ──

  describe('transpileTailwindVue', () => {
    test('i18n disabled: raw text, no import', () => {
      const ast = parse('screen name=Test\n  text value=Hello');
      const result = transpileTailwindVue(ast);
      expect(result.code).toContain('Hello');
      expect(result.code).not.toContain("t('");
      expect(result.code).not.toContain('useI18n');
    });

    test('i18n enabled: wraps text with t()', () => {
      const ast = parse('screen name=Test\n  text value=Hello');
      const result = transpileTailwindVue(ast, i18nConfig);
      expect(result.code).toContain("t('");
    });

    test('i18n enabled: imports from vue-i18n', () => {
      const ast = parse('screen name=Test\n  text value=Hello');
      const result = transpileTailwindVue(ast, i18nConfig);
      expect(result.code).toContain("import { useI18n } from 'vue-i18n'");
      expect(result.code).toContain('const { t } = useI18n()');
    });

    test('button text is also wrapped', () => {
      const ast = parse('screen name=Test\n  button text=Submit');
      const result = transpileTailwindVue(ast, i18nConfig);
      expect(result.code).toContain("t('");
      expect(result.code).toContain('Submit');
    });
  });
});
