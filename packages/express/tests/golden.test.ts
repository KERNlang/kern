import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Golden Snapshot Tests', () => {
  test('Express output for api-routes.kern', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileExpress } = await import('../src/transpiler-express.js');
    const source = readFileSync(resolve(ROOT, 'examples/api-routes.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpileExpress(ast);
    expect(result.code).toMatchSnapshot();
    if (result.artifacts) {
      for (const artifact of result.artifacts) {
        expect(artifact.content).toMatchSnapshot(`artifact: ${artifact.path}`);
      }
    }
  });

  test('Express output for ai-buddies-api.kern', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileExpress } = await import('../src/transpiler-express.js');
    const source = readFileSync(resolve(ROOT, 'examples/ai-buddies-api.kern'), 'utf-8');
    const ast = parse(source);
    const result = transpileExpress(ast);
    expect(result.code).toMatchSnapshot();
  });
});
