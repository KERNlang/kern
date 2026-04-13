import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Golden Snapshot Tests', () => {
  test('Vue output for dashboard.kern', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileVue } = await import('../src/transpiler-vue.js');
    const source = readFileSync(resolve(ROOT, 'examples/dashboard.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpileVue(ast);
    expect(result.code).toMatchSnapshot();
  });

  test('Vue output for audio-settings.kern', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileVue } = await import('../src/transpiler-vue.js');
    const source = readFileSync(resolve(ROOT, 'examples/audio-settings.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpileVue(ast);
    expect(result.code).toMatchSnapshot();
  });

  test('Nuxt output for nextjs-landing.kern', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileNuxt } = await import('../src/transpiler-nuxt.js');
    const source = readFileSync(resolve(ROOT, 'examples/nextjs-landing.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpileNuxt(ast);
    expect(result.code).toMatchSnapshot();
  });
});
