import { transpileMCP } from '../transpiler-mcp.js';
import type { IRNode } from '@kernlang/core';

function node(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children, loc: { line: 1, col: 1, endLine: 1, endCol: 1 } } as IRNode;
}

describe('transpileMCP', () => {
  it('should export a function', () => {
    expect(typeof transpileMCP).toBe('function');
  });

  it('should generate basic MCP server code', () => {
    const ast = node('mcp', { name: 'TestServer', version: '1.0' }, [
      node('tool', { name: 'hello' }, [
        node('description', { text: 'Say hello' }),
        node('param', { name: 'name', type: 'string', required: 'true' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('McpServer');
    expect(result.code).toContain('StdioServerTransport');
    expect(result.code).toContain('"TestServer"');
    expect(result.code).toContain('"1.0"');
    expect(result.code).toContain('z.string()');
    expect(result.code).toContain('"hello"');
    expect(result.code).toContain('logger.info');
    expect(result.code).toContain('server.tool(');
  });

  it('should generate tool with Zod schema for typed params', () => {
    const ast = node('mcp', { name: 'TypedServer' }, [
      node('tool', { name: 'calculate' }, [
        node('param', { name: 'value', type: 'number', required: 'true' }),
        node('param', { name: 'label', type: 'string', required: 'false' }),
        node('param', { name: 'flag', type: 'boolean' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('z.number()');
    expect(result.code).toContain('z.string()');
    expect(result.code).toContain('z.boolean()');
    expect(result.code).toContain('.optional()');
  });

  it('should generate sanitize guard', () => {
    const ast = node('mcp', { name: 'GuardedServer' }, [
      node('tool', { name: 'search' }, [
        node('param', { name: 'query', type: 'string', required: 'true' }),
        node('guard', { type: 'sanitize', param: 'query' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('sanitizeValue');
    expect(result.code).toContain('function sanitizeValue');
  });

  it('should generate pathContainment guard', () => {
    const ast = node('mcp', { name: 'FSServer' }, [
      node('tool', { name: 'readFile' }, [
        node('param', { name: 'filePath', type: 'string', required: 'true' }),
        node('guard', { type: 'pathContainment', param: 'filePath', allowlist: '/data,/home' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('ensurePathContainment');
    expect(result.code).toContain('ALLOWED_PATHS');
    expect(result.code).toContain('import path');
  });

  it('should auto-inject pathContainment for path-like params', () => {
    const ast = node('mcp', { name: 'AutoGuard' }, [
      node('tool', { name: 'readFile' }, [
        node('param', { name: 'filePath', type: 'string', required: 'true' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('ensurePathContainment');
  });

  it('should generate validate guard with min/max/regex', () => {
    const ast = node('mcp', { name: 'ValidatedServer' }, [
      node('tool', { name: 'setCount' }, [
        node('param', { name: 'count', type: 'number', required: 'true' }),
        node('guard', { type: 'validate', param: 'count', min: '1', max: '100' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('.min(1)');
    expect(result.code).toContain('.max(100)');
  });

  it('should generate resource handler', () => {
    const ast = node('mcp', { name: 'ResourceServer' }, [
      node('resource', { name: 'docs', uri: 'docs://readme' }, [
        node('description', { text: 'Project documentation' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('server.resource(');
    expect(result.code).toContain('"docs"');
    expect(result.code).toContain('"docs://readme"');
    expect(result.code).toContain('resource:read');
  });

  it('should generate ResourceTemplate for URI with variables', () => {
    const ast = node('mcp', { name: 'TemplateServer' }, [
      node('resource', { name: 'userProfile', uri: 'user://{userId}/profile' }),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('ResourceTemplate');
    expect(result.code).toContain('user://{userId}/profile');
  });

  it('should generate prompt handler', () => {
    const ast = node('mcp', { name: 'PromptServer' }, [
      node('prompt', { name: 'reviewCode' }, [
        node('description', { text: 'Review code for issues' }),
        node('param', { name: 'code', type: 'string', required: 'true' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('server.prompt(');
    expect(result.code).toContain('"reviewCode"');
    expect(result.code).toContain('prompt:call');
  });

  it('should auto-inject logging and error handling', () => {
    const ast = node('mcp', { name: 'LoggedServer' }, [
      node('tool', { name: 'action' }),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('logger.info');
    expect(result.code).toContain('logger.error');
    expect(result.code).toContain('tool:call');
    expect(result.code).toContain('tool:error');
    expect(result.code).toContain('fmtError');
    expect(result.code).toContain('isError: true');
  });

  it('should wrap server in async main with fatal handler', () => {
    const ast = node('mcp', { name: 'MainServer' });
    const result = transpileMCP(ast);
    expect(result.code).toContain('async function main()');
    expect(result.code).toContain('server:start');
    expect(result.code).toContain('server:fatal');
    expect(result.code).toContain('process.exitCode = 1');
  });

  it('should return valid TranspileResult shape', () => {
    const ast = node('mcp', { name: 'ShapeTest' }, [
      node('tool', { name: 'test' }),
    ]);

    const result = transpileMCP(ast);
    expect(result).toHaveProperty('code');
    expect(result).toHaveProperty('sourceMap');
    expect(result).toHaveProperty('irTokenCount');
    expect(result).toHaveProperty('tsTokenCount');
    expect(result).toHaveProperty('tokenReduction');
    expect(result).toHaveProperty('diagnostics');
    expect(typeof result.code).toBe('string');
    expect(Array.isArray(result.sourceMap)).toBe(true);
  });

  it('should handle handler code blocks', () => {
    const ast = node('mcp', { name: 'HandlerServer' }, [
      node('tool', { name: 'greet' }, [
        node('param', { name: 'name', type: 'string', required: 'true' }),
        node('handler', { code: 'return `Hello, ${params.name}!`;' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('return `Hello, ${params.name}!`;');
  });

  it('should handle mcp node nested inside document', () => {
    const ast = node('document', {}, [
      node('mcp', { name: 'NestedServer', version: '2.0' }, [
        node('tool', { name: 'ping' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('"NestedServer"');
    expect(result.code).toContain('"2.0"');
    expect(result.code).toContain('"ping"');
  });

  it('should emit sanitizeValue for resource params with sanitize guard', () => {
    const ast = node('mcp', { name: 'ResourceGuardServer' }, [
      node('resource', { name: 'search', uri: 'search://results' }, [
        node('param', { name: 'query', type: 'string' }),
        node('guard', { type: 'sanitize', param: 'query' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('function sanitizeValue');
    expect(result.code).toContain('sanitizeValue(');
  });

  it('should emit ensurePathContainment for resource with path-like param', () => {
    const ast = node('mcp', { name: 'ResourcePathServer' }, [
      node('resource', { name: 'file', uri: 'file://{filePath}' }, [
        node('param', { name: 'filePath', type: 'string', required: 'true' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('ensurePathContainment');
    expect(result.code).toContain('import path');
    expect(result.code).toContain('ALLOWED_PATHS');
  });

  it('should wrap prompt handler in try/catch', () => {
    const ast = node('mcp', { name: 'PromptErrorServer' }, [
      node('prompt', { name: 'review' }, [
        node('description', { text: 'Review code' }),
        node('param', { name: 'code', type: 'string', required: 'true' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('prompt:error');
    expect(result.code).toContain('try {');
    expect(result.code).toContain('fmtError(error)');
  });
});
