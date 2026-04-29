import type { IRNode } from '@kernlang/core';
import { execSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { transpileMCP } from '../transpiler-mcp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dirname, '../../../../');
const MCP_SERVER_MODULES = resolve(MONOREPO_ROOT, 'packages/mcp-server/node_modules');
const TSC_BIN = resolve(MONOREPO_ROOT, 'node_modules/typescript/bin/tsc');

function node(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children, loc: { line: 1, col: 1, endLine: 1, endCol: 1 } } as IRNode;
}

/** Verify generated TypeScript compiles against real SDK types (not stubs). */
function assertCompiles(code: string, label: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'kern-mcp-test-'));
  try {
    writeFileSync(join(dir, 'server.ts'), code);

    // Symlink real node_modules so tsc resolves actual SDK types
    const nmTarget = join(dir, 'node_modules');
    if (!existsSync(nmTarget)) {
      symlinkSync(MCP_SERVER_MODULES, nmTarget, 'dir');
    }

    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ES2022',
          moduleResolution: 'bundler',
          strict: false,
          noEmit: true,
          skipLibCheck: true,
          esModuleInterop: true,
          typeRoots: [resolve(MONOREPO_ROOT, 'node_modules/@types')],
          types: ['node'],
        },
        files: ['server.ts'],
      }),
    );
    const result = execSync(`node "${TSC_BIN}" --noEmit -p tsconfig.json 2>&1 || true`, {
      cwd: dir,
      timeout: 15000,
      encoding: 'utf-8',
    });
    if (result.includes('error TS')) {
      throw new Error(`tsc errors:\n${result}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('tsc errors:')) {
      throw new Error(
        `Generated code for "${label}" does not compile:\n${e.message}\n\nCode:\n${code.split('\n').slice(0, 20).join('\n')}...`,
      );
    }
    throw new Error(
      `Generated code for "${label}" — compile check failed:\n${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

  it('should emit helper imports and declarations before tool registrations', () => {
    const ast = node('mcp', { name: 'HelperServer' }, [
      node('import', { from: 'node:fs', names: 'readFileSync' }),
      node('const', { name: 'DEFAULT_GREETING', value: '"hello"' }),
      node('fn', { name: 'formatGreeting', params: 'name:string', returns: 'string' }, [
        node('handler', { code: 'return `${DEFAULT_GREETING}, ${name}`;' }),
      ]),
      node('tool', { name: 'greet' }, [
        node('param', { name: 'name', type: 'string', required: 'true' }),
        node('handler', { code: 'return { content: [{ type: "text", text: formatGreeting(args.name) }] };' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain("import { readFileSync } from 'node:fs';");
    expect(result.code).toContain('const DEFAULT_GREETING = "hello";');
    expect(result.code).toContain('function formatGreeting(name: string): string {');
    expect(result.code).toContain('return `${DEFAULT_GREETING}, ${name}`;');
    expect(result.code.indexOf('function formatGreeting')).toBeLessThan(result.code.indexOf('server.tool('));
    assertCompiles(result.code, 'helper core nodes');
  });

  it('should auto-inject path guards when helper functions perform file io', () => {
    const ast = node('mcp', { name: 'HelperEffectsServer' }, [
      node('import', { from: 'node:fs', names: 'readFileSync' }),
      node('fn', { name: 'readHelper', params: 'filePath:string', returns: 'string' }, [
        node('handler', { code: 'return readFileSync(filePath, "utf8");' }),
      ]),
      node('tool', { name: 'readFile' }, [
        node('param', { name: 'filePath', type: 'string', required: 'true' }),
        node('handler', { code: 'return { content: [{ type: "text", text: readHelper(args.filePath) }] };' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('ensurePathContainment');
    expect(result.code).toContain('params["filePath"] = ensurePathContainment');
    assertCompiles(result.code, 'helper effect guards');
  });

  it('should suppress helper bindings that collide with generated MCP identifiers', () => {
    const ast = node('mcp', { name: 'CollisionServer' }, [
      node('import', { from: 'node:path', default: 'path' }),
      node('tool', { name: 'noop' }, [
        node('handler', { code: 'return { content: [{ type: "text", text: "ok" }] };' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect((result.diagnostics || []).some((d) => d.reason === 'helper-binding-conflict')).toBe(true);
    expect(result.code).not.toContain("import path from 'node:path';");
  });

  it('should suppress helper bindings that collide with generated tool schema identifiers', () => {
    const ast = node('mcp', { name: 'SchemaCollisionServer' }, [
      node('const', { name: 'readfileSchema', value: '"bad"' }),
      node('tool', { name: 'readFile' }, [node('param', { name: 'filePath', type: 'string', required: 'true' })]),
    ]);

    const result = transpileMCP(ast);
    expect((result.diagnostics || []).some((d) => d.reason === 'helper-binding-conflict')).toBe(true);
    expect(result.code).not.toContain('const readfileSchema = "bad";');
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
      node('tool', { name: 'readFile' }, [node('param', { name: 'filePath', type: 'string', required: 'true' })]),
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
    const ast = node('mcp', { name: 'LoggedServer' }, [node('tool', { name: 'action' })]);

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
    const ast = node('mcp', { name: 'ShapeTest' }, [node('tool', { name: 'test' })]);

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

  // ── Regression tests for GPT-5.4 Pro review bugs ──────────────────────

  it('should make args available to handler code (Bug 1+2 regression)', () => {
    const ast = node('mcp', { name: 'ArgsServer' }, [
      node('tool', { name: 'greet' }, [
        node('param', { name: 'name', type: 'string', required: 'true' }),
        node('handler', { code: 'return `Hello, ${args.name}!`;' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('const args');
    expect(result.code).toContain('return `Hello, ${args.name}!`;');
  });

  it('should flow sanitized params into args (Bug 2 regression)', () => {
    const ast = node('mcp', { name: 'SanitizeFlowServer' }, [
      node('tool', { name: 'search' }, [
        node('param', { name: 'query', type: 'string', required: 'true' }),
        node('guard', { type: 'sanitize', param: 'query' }),
        node('handler', { code: 'return args.query;' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('sanitizeValue(');
    expect(result.code).toContain('const args = params');
  });

  it('should emit boolean default as literal not string (Bug 3 regression)', () => {
    const ast = node('mcp', { name: 'BoolDefaultServer' }, [
      node('tool', { name: 'toggle' }, [node('param', { name: 'enabled', type: 'boolean', default: 'false' })]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('.default(false)');
    expect(result.code).not.toContain('.default("false")');
  });

  // ─── Slice 3c P2 follow-up: param.value (canonical) is consumed ────────

  it('reads param.value (slice 3c canonical) for Zod default — numeric', () => {
    // Pre-migration this would have emitted no `.default()` because the
    // transpiler only read `param.default`. Now `value` is the canonical
    // entry point and `default` is the legacy fallback.
    const ast = node('mcp', { name: 'RetryServer' }, [
      node('tool', { name: 'retry' }, [node('param', { name: 'attempts', type: 'number', value: '3' })]),
    ]);
    const result = transpileMCP(ast);
    expect(result.code).toContain('.default(3)');
  });

  it('reads param.value for Zod default — boolean', () => {
    const ast = node('mcp', { name: 'BoolValueServer' }, [
      node('tool', { name: 'toggle' }, [node('param', { name: 'enabled', type: 'boolean', value: 'false' })]),
    ]);
    const result = transpileMCP(ast);
    expect(result.code).toContain('.default(false)');
  });

  it('value= wins over default= when both are set', () => {
    const ast = node('mcp', { name: 'BothServer' }, [
      node('tool', { name: 'retry' }, [node('param', { name: 'attempts', type: 'number', value: '7', default: '3' })]),
    ]);
    const result = transpileMCP(ast);
    expect(result.code).toContain('.default(7)');
    expect(result.code).not.toContain('.default(3)');
  });

  it('ExprObject value={{...}} surfaces as raw expression in Zod default', () => {
    const ast = node('mcp', { name: 'ExprServer' }, [
      node('tool', { name: 'stamp' }, [
        node('param', { name: 'ts', type: 'number', value: { __expr: true, code: 'Date.now()' } }),
      ]),
    ]);
    const result = transpileMCP(ast);
    // ExprObject `.code` is emitted verbatim. Numeric `.default()` runs the
    // numeric coerce branch — `Number('Date.now()')` is NaN so it falls back
    // to `0`. That's expected: ExprObject defaults need a literal-shaped
    // value to round-trip cleanly through Zod's numeric default.
    expect(result.code).toContain('.default(0)');
  });

  it('quoted-string value emits as JSON-stringified default', () => {
    const ast = {
      type: 'mcp',
      props: { name: 'StringValueServer' },
      children: [
        {
          type: 'tool',
          props: { name: 'greet' },
          children: [
            {
              type: 'param',
              props: { name: 'salutation', type: 'string', value: 'hi' },
              __quotedProps: ['value'],
              children: [],
            },
          ],
        },
      ],
    };
    const result = transpileMCP(ast as Parameters<typeof transpileMCP>[0]);
    expect(result.code).toContain('.default("hi")');
  });

  it('should wrap handler with return in IIFE for correct try/catch behavior', () => {
    const ast = node('mcp', { name: 'IIFEServer' }, [
      node('tool', { name: 'action' }, [
        node('param', { name: 'input', type: 'string' }),
        node('handler', { code: 'return "done";' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('await (async () =>');
  });

  it('should handle mcp node nested inside document', () => {
    const ast = node('document', {}, [
      node('mcp', { name: 'NestedServer', version: '2.0' }, [node('tool', { name: 'ping' })]),
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

  it('should generate auth guard with checkAuth helper', () => {
    const ast = node('mcp', { name: 'AuthServer' }, [
      node('tool', { name: 'secret' }, [node('guard', { type: 'auth', env: 'API_KEY' })]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('checkAuth');
    expect(result.code).toContain('"API_KEY"');
    expect(result.code).toContain('process.env[envVar]');
  });

  it('should generate rateLimit guard with store', () => {
    const ast = node('mcp', { name: 'RateLimitServer' }, [
      node('tool', { name: 'expensive' }, [node('guard', { type: 'rateLimit', window: '60000', requests: '10' })]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('checkRateLimit');
    expect(result.code).toContain('_rateLimitStore');
    expect(result.code).toContain('60000');
    expect(result.code).toContain('10');
  });

  it('should generate sizeLimit guard with Buffer.byteLength check', () => {
    const ast = node('mcp', { name: 'SizeLimitServer' }, [
      node('tool', { name: 'upload' }, [
        node('param', { name: 'data', type: 'string', required: 'true' }),
        node('guard', { type: 'sizeLimit', param: 'data', max: '524288' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('Buffer.byteLength');
    expect(result.code).toContain('524288');
    expect(result.code).toContain('exceeds size limit');
  });

  it('should generate HTTP transport when transport=http', () => {
    const ast = node('mcp', { name: 'HttpServer', transport: 'http', port: '8080' });

    const result = transpileMCP(ast);
    expect(result.code).not.toContain('StdioServerTransport');
    expect(result.code).toContain('express');
    expect(result.code).toContain('/mcp');
    expect(result.code).toContain('StreamableHTTPServerTransport');
    expect(result.code).toContain('8080');
  });

  it('should use stdio transport by default', () => {
    const ast = node('mcp', { name: 'StdioServer' });

    const result = transpileMCP(ast);
    expect(result.code).toContain('StdioServerTransport');
    expect(result.code).not.toContain('express');
  });

  it('should inject requestSampling helper when sampling child is present', () => {
    const ast = node('mcp', { name: 'SamplingServer' }, [
      node('tool', { name: 'summarize' }, [
        node('param', { name: 'text', type: 'string', required: 'true' }),
        node('sampling', { maxTokens: '200' }),
        node('handler', {
          code: 'const summary = await requestSampling(`Summarize: ${params.text}`);\nreturn summary;',
        }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('async function requestSampling');
    expect(result.code).toContain('createMessage');
    expect(result.code).toContain('maxTokens: 200');
    expect(result.code).toContain(', extra');
  });

  it('should inject requestInput helper when elicitation child is present', () => {
    const ast = node('mcp', { name: 'ElicitServer' }, [
      node('tool', { name: 'confirm' }, [
        node('elicitation', { message: 'Please confirm action' }),
        node('handler', { code: 'const input = await requestInput();\nreturn input ? "confirmed" : "cancelled";' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('async function requestInput');
    expect(result.code).toContain('server.server.elicitInput');
    expect(result.code).toContain('mode: "form"');
    expect(result.code).toContain('Please confirm action');
    expect(result.code).toContain(', extra');
  });

  // ── Edge case: sampling uses server.server.createMessage (SDK v1.x) ──
  it('should reference server.server.createMessage for sampling (SDK v1.x pattern)', () => {
    const ast = node('mcp', { name: 'SamplingFixServer' }, [
      node('tool', { name: 'smart' }, [
        node('sampling', { maxTokens: '300' }),
        node('handler', { code: 'const x = await requestSampling("test");\nreturn x;' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('server.server.createMessage');
    expect(result.code).toContain('maxTokens: 300');
  });
});

// ── Edge cases: reserved words, special chars, graceful degradation ────

describe('transpileMCP edge cases', () => {
  it('should handle params named with JS reserved words', () => {
    const ast = node('mcp', { name: 'ReservedServer' }, [
      node('tool', { name: 'classify' }, [
        node('param', { name: 'class', type: 'string', required: 'true' }),
        node('param', { name: 'return', type: 'string' }),
        node('param', { name: 'delete', type: 'boolean' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    // Must use quoted keys, not bare identifiers
    expect(result.code).toContain('"class": z.string()');
    expect(result.code).toContain('"return": z.string()');
    expect(result.code).toContain('"delete": z.boolean()');
  });

  it('should handle tool names with hyphens', () => {
    const ast = node('mcp', { name: 'HyphenServer' }, [
      node('tool', { name: 'my-tool-name' }, [node('param', { name: 'input', type: 'string' })]),
    ]);

    const result = transpileMCP(ast);
    // Schema var must be valid JS identifier
    expect(result.code).toContain('myToolNameSchema');
    // Registration must use original name
    expect(result.code).toContain('"my-tool-name"');
  });

  it('should handle IR with no mcp node', () => {
    const ast = node('document', {}, [node('text', { value: 'hello' })]);
    const result = transpileMCP(ast);
    // Should still generate a valid (empty) MCP server
    expect(result.code).toContain('McpServer');
    expect(result.code).toContain('KernMCPServer');
  });

  it('should handle tool with empty handler code', () => {
    const ast = node('mcp', { name: 'EmptyHandlerServer' }, [
      node('tool', { name: 'test' }, [node('handler', { code: '' })]),
    ]);

    const result = transpileMCP(ast);
    // Empty handler should produce default response
    expect(result.code).toContain('test completed');
  });

  it('should default param type to string when not specified', () => {
    const ast = node('mcp', { name: 'NoTypeServer' }, [node('tool', { name: 'test' }, [node('param', { name: 'x' })])]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('z.string()');
  });

  it('should use guard-specific allowlist, not just global ALLOWED_PATHS', () => {
    const ast = node('mcp', { name: 'PerGuardServer' }, [
      node('tool', { name: 'readFile' }, [
        node('param', { name: 'filePath', type: 'string', required: 'true' }),
        node('guard', { type: 'pathContainment', param: 'filePath', allowlist: '/data,/home' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    // Must use the guard's specific allowlist, not the global default
    expect(result.code).toContain('"/data"');
    expect(result.code).toContain('"/home"');
  });

  it('should not emit dead normalizeToolResult helper', () => {
    const ast = node('mcp', { name: 'CleanServer' }, [node('tool', { name: 'test' })]);

    const result = transpileMCP(ast);
    expect(result.code).not.toContain('normalizeToolResult');
  });
});

// ── Review fix regressions ─────────────────────────────────────────────

describe('transpileMCP review fix regressions', () => {
  it('should skip invalid regex patterns in sanitize guard (ReDoS prevention)', () => {
    const ast = node('mcp', { name: 'ReDoSServer' }, [
      node('tool', { name: 'test' }, [
        node('param', { name: 'input', type: 'string' }),
        node('guard', { type: 'sanitize', param: 'input', pattern: '([invalid' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    // Invalid regex should be silently skipped — no sanitizeValue CALL for this param
    // (the helper function may still be declared but never invoked)
    expect(result.code).not.toContain('sanitizeValue(params');
  });

  it('should wrap generated sanitizeValue in try/catch', () => {
    const ast = node('mcp', { name: 'SafeSanitize' }, [
      node('tool', { name: 'test' }, [
        node('param', { name: 'input', type: 'string' }),
        node('guard', { type: 'sanitize', param: 'input' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('try { return value.replace');
    expect(result.code).toContain('catch { return value; }');
  });

  it('should skip NaN min/max in validate guard', () => {
    const ast = node('mcp', { name: 'NaNServer' }, [
      node('tool', { name: 'test' }, [
        node('param', { name: 'count', type: 'number' }),
        node('guard', { type: 'validate', param: 'count', min: 'abc', max: 'xyz' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).not.toContain('.min(NaN)');
    expect(result.code).not.toContain('.max(NaN)');
  });

  it('should not leak validate max into sizeLimit maxBytes', () => {
    const ast = node('mcp', { name: 'NoLeakServer' }, [
      node('tool', { name: 'test' }, [
        node('param', { name: 'data', type: 'string' }),
        node('guard', { type: 'validate', param: 'data', max: '100' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    // validate max=100 should NOT create a sizeLimit check
    expect(result.code).not.toContain('exceeds size limit');
    expect(result.code).toContain('.max(100)');
  });

  it('should create HTTP transport once, not per request', () => {
    const ast = node('mcp', { name: 'HttpFixServer', transport: 'http', port: '3000' });
    const result = transpileMCP(ast);

    // Transport creation must be OUTSIDE the request handler
    const lines = result.code.split('\n');
    const transportLine = lines.findIndex((l) => l.includes('new StreamableHTTPServerTransport'));
    const postLine = lines.findIndex((l) => l.includes('app.post'));
    expect(transportLine).toBeLessThan(postLine);

    // server.connect must be OUTSIDE the request handler
    const connectLine = lines.findIndex((l) => l.includes('server.connect'));
    expect(connectLine).toBeLessThan(postLine);
  });

  it('should fallback to 0 for NaN numeric default value', () => {
    const ast = node('mcp', { name: 'DefaultNaN' }, [
      node('tool', { name: 'test' }, [node('param', { name: 'count', type: 'number', default: 'notanumber' })]),
    ]);

    const result = transpileMCP(ast);
    expect(result.code).toContain('.default(0)');
    expect(result.code).not.toContain('.default(notanumber)');
  });

  it('should use _express variable for express.json() middleware', () => {
    const ast = node('mcp', { name: 'ExpressJson', transport: 'http', port: '8080' });
    const result = transpileMCP(ast);
    expect(result.code).toContain('const _express =');
    expect(result.code).toContain('_express()');
    expect(result.code).toContain('_express.json()');
    // Must NOT double-import express
    const expressImports = result.code.split('import("express")').length - 1;
    expect(expressImports).toBe(1);
  });
});

// ── Level 1: Compile verification — generated code must pass tsc ────────

describe('transpileMCP compile verification', () => {
  it('should generate valid TypeScript for a full MCP server', () => {
    const ast = node('mcp', { name: 'FullServer', version: '1.0' }, [
      node('tool', { name: 'search' }, [
        node('description', { text: 'Search items' }),
        node('param', { name: 'query', type: 'string', required: 'true' }),
        node('param', { name: 'limit', type: 'number', default: '10' }),
        node('param', { name: 'active', type: 'boolean', default: 'false' }),
        node('guard', { type: 'sanitize', param: 'query' }),
        node('guard', { type: 'validate', param: 'limit', min: '1', max: '100' }),
      ]),
      node('resource', { name: 'config', uri: 'config://app' }),
      node('prompt', { name: 'review' }, [node('param', { name: 'code', type: 'string', required: 'true' })]),
    ]);

    const result = transpileMCP(ast);
    assertCompiles(result.code, 'full MCP server');
  });

  it('should generate valid TypeScript with pathContainment guard', () => {
    const ast = node('mcp', { name: 'FSServer' }, [
      node('tool', { name: 'read' }, [
        node('param', { name: 'filePath', type: 'string', required: 'true' }),
        node('guard', { type: 'pathContainment', param: 'filePath', allowlist: '/data' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    assertCompiles(result.code, 'pathContainment server');
  });

  it('should generate valid TypeScript with ResourceTemplate', () => {
    const ast = node('mcp', { name: 'TemplateServer' }, [
      node('resource', { name: 'doc', uri: 'docs://{docId}' }, [node('description', { text: 'Get doc by ID' })]),
    ]);

    const result = transpileMCP(ast);
    assertCompiles(result.code, 'ResourceTemplate server');
  });

  it('should generate valid TypeScript with auth + rateLimit guards', () => {
    const ast = node('mcp', { name: 'GuardedServer' }, [
      node('tool', { name: 'admin' }, [
        node('guard', { type: 'auth', env: 'ADMIN_KEY' }),
        node('guard', { type: 'rateLimit', window: '60000', requests: '10' }),
        node('param', { name: 'action', type: 'string', required: 'true' }),
      ]),
    ]);

    const result = transpileMCP(ast);
    assertCompiles(result.code, 'auth+rateLimit server');
  });

  it('should generate valid TypeScript for empty server', () => {
    const ast = node('mcp', { name: 'EmptyServer', version: '0.1' });
    const result = transpileMCP(ast);
    assertCompiles(result.code, 'empty server');
  });
});
