import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Native Transpiler', () => {
  test('transpiler produces valid React Native TypeScript', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpile } = await import('../src/transpiler.js');
    const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
    const ast = parse(irSource);
    const result = transpile(ast);

    expect(result.code).toBeDefined();
    expect(result.code.length).toBeGreaterThan(100);
    expect(result.code).toContain('react-native');
    expect(result.code).toContain('View');
    expect(result.code).toContain('Text');
    expect(result.code).toContain('FITVT');
  });

  test('transpiler produces source map entries', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpile } = await import('../src/transpiler.js');
    const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
    const ast = parse(irSource);
    const result = transpile(ast);

    expect(result.sourceMap).toBeDefined();
    expect(Array.isArray(result.sourceMap)).toBe(true);
    expect(result.sourceMap.length).toBeGreaterThan(0);
  });

  test('transpiler reports token counts', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpile } = await import('../src/transpiler.js');
    const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
    const ast = parse(irSource);
    const result = transpile(ast);

    expect(result.irTokenCount).toBeGreaterThan(0);
    expect(result.tsTokenCount).toBeGreaterThan(0);
    expect(result.tokenReduction).toBeGreaterThan(0);
  });

  test('IR achieves at least 30% token reduction vs TypeScript output', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpile } = await import('../src/transpiler.js');
    const irSource = readFileSync(resolve(ROOT, 'examples/dashboard.ir'), 'utf-8');
    const ast = parse(irSource);
    const result = transpile(ast);
    expect(result.tokenReduction).toBeGreaterThanOrEqual(30);
  });
});
