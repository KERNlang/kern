import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Golden Snapshot Tests', () => {
  test('FastAPI output for api-routes.kern', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
    const source = readFileSync(resolve(ROOT, 'examples/api-routes.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpileFastAPI(ast);
    expect(result.code).toMatchSnapshot();
  });

  test('FastAPI output for ai-buddies-api.kern', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
    const source = readFileSync(resolve(ROOT, 'examples/ai-buddies-api.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpileFastAPI(ast);
    expect(result.code).toMatchSnapshot();
  });
});
