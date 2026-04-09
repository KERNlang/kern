import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('Golden Snapshot Tests', () => {
  test('MCP TypeScript output for mcp-server.kern', async () => {
    const { parse } = await import('../../../core/src/parser.js');
    const { transpileMCP } = await import('../transpiler-mcp.js');
    const { resolveConfig } = await import('../../../core/src/config.js');
    const source = readFileSync(resolve(ROOT, 'examples/mcp-server.kern'), 'utf-8');
    const ast = parse(source);
    const cfg = resolveConfig({ target: 'mcp' });
    const result = transpileMCP(ast, cfg);
    expect(result.code).toMatchSnapshot();
  });

  test('MCP TypeScript output for mcp-api-gateway.kern', async () => {
    const { parse } = await import('../../../core/src/parser.js');
    const { transpileMCP } = await import('../transpiler-mcp.js');
    const { resolveConfig } = await import('../../../core/src/config.js');
    const source = readFileSync(resolve(ROOT, 'examples/mcp-api-gateway.kern'), 'utf-8');
    const ast = parse(source);
    const cfg = resolveConfig({ target: 'mcp' });
    const result = transpileMCP(ast, cfg);
    expect(result.code).toMatchSnapshot();
  });

  test('MCP TypeScript output for mcp-database.kern', async () => {
    const { parse } = await import('../../../core/src/parser.js');
    const { transpileMCP } = await import('../transpiler-mcp.js');
    const { resolveConfig } = await import('../../../core/src/config.js');
    const source = readFileSync(resolve(ROOT, 'examples/mcp-database.kern'), 'utf-8');
    const ast = parse(source);
    const cfg = resolveConfig({ target: 'mcp' });
    const result = transpileMCP(ast, cfg);
    expect(result.code).toMatchSnapshot();
  });
});
