/**
 * Output determinism test — compiling the same .kern source multiple times
 * must produce byte-identical output. Non-determinism (object key ordering,
 * import order, random IDs) breaks trust for enterprise adoption.
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Output Determinism', () => {
  const ITERATIONS = 5;

  async function compileN(source: string, target: string, n: number): Promise<string[]> {
    const { parse } = await import('../src/parser.js');
    const { resolveConfig } = await import('../src/config.js');

    // Dynamically import the target transpiler
    let transpile: (ast: any, cfg: any) => any;

    if (target === 'express') {
      const mod = await import('../../express/src/transpiler-express.js');
      transpile = mod.transpileExpress;
    } else if (target === 'mcp') {
      const mod = await import('../../mcp/src/transpiler-mcp.js');
      transpile = mod.transpileMCP;
    } else {
      const mod = await import('../../react/src/transpiler-nextjs.js');
      transpile = mod.transpileNextjs;
    }

    const ast = parse(source);
    const cfg = resolveConfig({ target: target as any });
    const results: string[] = [];

    for (let i = 0; i < n; i++) {
      const result = transpile(ast, cfg);
      results.push(result.code);
    }

    return results;
  }

  test('Express output is deterministic', async () => {
    const source = readFileSync(resolve(ROOT, 'examples/api-routes.kern'), 'utf-8');
    const results = await compileN(source, 'express', ITERATIONS);
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(results[0]);
    }
  });

  test('MCP output is deterministic', async () => {
    const source = readFileSync(resolve(ROOT, 'examples/mcp-server.kern'), 'utf-8');
    const results = await compileN(source, 'mcp', ITERATIONS);
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(results[0]);
    }
  });

  test('Next.js output is deterministic', async () => {
    const source = readFileSync(resolve(ROOT, 'examples/dashboard.kern'), 'utf-8');
    const results = await compileN(source, 'nextjs', ITERATIONS);
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(results[0]);
    }
  });
});
