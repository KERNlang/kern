import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Golden Snapshot Tests', () => {
  test('Tailwind output for dashboard.kern', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileTailwind } = await import('../src/transpiler-tailwind.js');
    const source = readFileSync(resolve(ROOT, 'examples/dashboard.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpileTailwind(ast);
    expect(result.code).toMatchSnapshot();
  });

  test('Next.js output for nextjs-landing.kern', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileNextjs } = await import('../src/transpiler-nextjs.js');
    const source = readFileSync(resolve(ROOT, 'examples/nextjs-landing.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpileNextjs(ast);
    expect(result.code).toMatchSnapshot();
  });
});
