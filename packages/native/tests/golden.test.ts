import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Golden Snapshot Tests', () => {
  test('React Native output for dashboard.kern', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpile } = await import('../src/transpiler.js');
    const source = readFileSync(resolve(ROOT, 'examples/dashboard.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpile(ast);
    expect(result.code).toMatchSnapshot();
  });

  test('React Native output for audio-settings.kern', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpile } = await import('../src/transpiler.js');
    const source = readFileSync(resolve(ROOT, 'examples/audio-settings.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpile(ast);
    expect(result.code).toMatchSnapshot();
  });
});
