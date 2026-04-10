import type { IRNode } from '@kernlang/core';
import { execSync, spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { transpileMCPPython } from '../transpiler-mcp-python.js';

function node(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children, loc: { line: 1, col: 1, endLine: 1, endCol: 1 } } as IRNode;
}

describe('transpileMCPPython', () => {
  it('should generate FastMCP server with tool', () => {
    const ast = node('mcp', { name: 'TestPy' }, [
      node('tool', { name: 'greet' }, [
        node('description', { text: 'Say hello' }),
        node('param', { name: 'name', type: 'string', required: 'true' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    expect(result.code).toContain('from mcp.server.fastmcp import FastMCP');
    expect(result.code).toContain('mcp = FastMCP(');
    expect(result.code).toContain('@mcp.tool()');
    expect(result.code).toContain('async def greet(name: str)');
    expect(result.code).toContain('"""Say hello"""');
    expect(result.code).toContain('logger.info');
  });

  it('should generate typed parameters', () => {
    const ast = node('mcp', { name: 'TypedPy' }, [
      node('tool', { name: 'calc' }, [
        node('param', { name: 'value', type: 'number', required: 'true' }),
        node('param', { name: 'label', type: 'string', required: 'false' }),
        node('param', { name: 'count', type: 'int', default: '10' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    expect(result.code).toContain('value: float');
    expect(result.code).toContain('label: str | None = None');
    expect(result.code).toContain('count: int = 10');
  });

  it('should use Python True/False for boolean defaults, not JS true/false', () => {
    const ast = node('mcp', { name: 'BoolPy' }, [
      node('tool', { name: 'toggle' }, [
        node('param', { name: 'enabled', type: 'boolean', default: 'true' }),
        node('param', { name: 'verbose', type: 'bool', default: 'false' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    expect(result.code).toContain('enabled: bool = True');
    expect(result.code).toContain('verbose: bool = False');
    expect(result.code).not.toContain('= true');
    expect(result.code).not.toContain('= false');
  });

  it('should auto-infer int when number type has integer default and constraints', () => {
    const ast = node('mcp', { name: 'IntInfer' }, [
      node('tool', { name: 'search' }, [
        node('param', { name: 'limit', type: 'number', default: '10' }),
        node('param', { name: 'offset', type: 'number', default: '0' }),
        node('param', { name: 'ratio', type: 'number', default: '0.5' }),
        node('guard', { type: 'validate', param: 'limit', min: '1', max: '100' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    expect(result.code).toContain('limit: int = 10');
    expect(result.code).toContain('offset: int = 0');
    // ratio has float default, should stay float
    expect(result.code).toContain('ratio: float = 0.5');
  });

  it('should generate sanitize guard with re.sub', () => {
    const ast = node('mcp', { name: 'SanitizePy' }, [
      node('tool', { name: 'search' }, [
        node('param', { name: 'query', type: 'string' }),
        node('guard', { type: 'sanitize', param: 'query' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    expect(result.code).toContain('import re');
    expect(result.code).toContain('re.sub(');
  });

  it('should generate pathContainment guard', () => {
    const ast = node('mcp', { name: 'PathPy' }, [
      node('tool', { name: 'readFile' }, [
        node('param', { name: 'filePath', type: 'string' }),
        node('guard', { type: 'pathContainment', param: 'filePath', allowlist: '/data' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    expect(result.code).toContain('import os');
    expect(result.code).toContain('os.path.realpath');
    expect(result.code).toContain('Path escapes allowed directories');
  });

  it('should generate resource with URI template', () => {
    const ast = node('mcp', { name: 'ResourcePy' }, [
      node('resource', { name: 'getDocs', uri: 'docs://{docId}' }, [
        node('description', { text: 'Fetch documentation' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    expect(result.code).toContain('@mcp.resource(');
    expect(result.code).toContain('docs://{docId}');
    expect(result.code).toContain('docId: str');
  });

  it('should generate prompt', () => {
    const ast = node('mcp', { name: 'PromptPy' }, [
      node('prompt', { name: 'reviewCode' }, [
        node('description', { text: 'Review code' }),
        node('param', { name: 'code', type: 'string', required: 'true' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    expect(result.code).toContain('@mcp.prompt()');
    expect(result.code).toContain('async def reviewCode(code: str)');
  });

  it('should generate stdio entrypoint by default', () => {
    const ast = node('mcp', { name: 'DefaultPy' });
    const result = transpileMCPPython(ast);
    expect(result.code).toContain('mcp.run(transport="stdio")');
  });

  it('should generate HTTP entrypoint when transport=http', () => {
    const ast = node('mcp', { name: 'HttpPy', transport: 'streamable-http' });
    const result = transpileMCPPython(ast);
    expect(result.code).toContain('mcp.run(transport="streamable-http")');
  });

  it('should generate auth guard', () => {
    const ast = node('mcp', { name: 'AuthPy' }, [
      node('tool', { name: 'secret' }, [node('guard', { type: 'auth', env: 'API_KEY' })]),
    ]);

    const result = transpileMCPPython(ast);
    expect(result.code).toContain('os.environ.get');
    expect(result.code).toContain('API_KEY');
  });

  it('should return valid TranspileResult', () => {
    const ast = node('mcp', { name: 'ShapePy' }, [node('tool', { name: 'test' })]);

    const result = transpileMCPPython(ast);
    expect(result).toHaveProperty('code');
    expect(result).toHaveProperty('sourceMap');
    expect(result).toHaveProperty('irTokenCount');
    expect(result).toHaveProperty('tsTokenCount');
    expect(result).toHaveProperty('diagnostics');
    expect(typeof result.code).toBe('string');
  });
});

// ── Review fix regressions ──────────────────────────────────────────────

describe('transpileMCPPython review fixes', () => {
  it('should import McpError and INTERNAL_ERROR for proper error semantics', () => {
    const ast = node('mcp', { name: 'ErrorSemPy' }, [node('tool', { name: 'test' })]);

    const result = transpileMCPPython(ast);
    expect(result.code).toContain('from mcp.shared.exceptions import McpError');
    expect(result.code).toContain('from mcp.types import INTERNAL_ERROR');
    expect(result.code).toContain('raise McpError(INTERNAL_ERROR');
  });

  it('should use structured JSON logging, not flat f-strings', () => {
    const ast = node('mcp', { name: 'LogPy' }, [node('tool', { name: 'search' })]);

    const result = transpileMCPPython(ast);
    expect(result.code).toContain('_JsonFormatter');
    expect(result.code).toContain('extra={"tool":');
    expect(result.code).not.toContain('f"tool:search called"');
  });

  it('should use structured logging for resources', () => {
    const ast = node('mcp', { name: 'ResLogPy' }, [node('resource', { name: 'docs', uri: 'docs://readme' })]);

    const result = transpileMCPPython(ast);
    expect(result.code).toContain('extra={"resource":');
  });
});

// ── Handler lang= support — Python transpiler skips TS handlers ─────────

describe('transpileMCPPython handler lang support', () => {
  it('should skip handler with no lang (TS-only)', () => {
    const ast = node('mcp', { name: 'LangSkipPy' }, [
      node('tool', { name: 'greet' }, [
        node('param', { name: 'name', type: 'string', required: 'true' }),
        node('handler', { code: 'return { content: [{ type: "text", text: "Hello " + args.name }] };' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    // Should NOT contain the TypeScript handler code
    expect(result.code).not.toContain('args.name');
    expect(result.code).not.toContain('content:');
    // Should emit a default stub
    expect(result.code).toContain('return f"greet completed"');
  });

  it('should use handler with lang=python', () => {
    const ast = node('mcp', { name: 'LangPyPy' }, [
      node('tool', { name: 'greet' }, [
        node('param', { name: 'name', type: 'string', required: 'true' }),
        node('handler', { lang: 'python', code: 'return f"Hello {name}"' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    expect(result.code).toContain('return f"Hello {name}"');
  });

  it('should use lang=python handler when both TS and Python handlers exist', () => {
    const ast = node('mcp', { name: 'DualPy' }, [
      node('tool', { name: 'greet' }, [
        node('param', { name: 'name', type: 'string', required: 'true' }),
        node('handler', { code: 'return { content: [{ type: "text", text: "Hello " + args.name }] };' }),
        node('handler', { lang: 'python', code: 'return f"Hello {name}"' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    expect(result.code).toContain('return f"Hello {name}"');
    // Should NOT contain the TypeScript handler
    expect(result.code).not.toContain('args.name');
  });

  it('should emit stub for resource with TS-only handler', () => {
    const ast = node('mcp', { name: 'ResourceLangPy' }, [
      node('resource', { name: 'docs', uri: 'docs://readme' }, [
        node('handler', { code: 'return { contents: [{ uri: uri.href, text: "data" }] };' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    expect(result.code).not.toContain('uri.href');
    expect(result.code).toContain('return f"docs content"');
  });

  it('should emit stub for prompt with TS-only handler', () => {
    const ast = node('mcp', { name: 'PromptLangPy' }, [
      node('prompt', { name: 'review' }, [
        node('param', { name: 'code', type: 'string', required: 'true' }),
        node('handler', {
          code: 'return { messages: [{ role: "user", content: { type: "text", text: args.code } }] };',
        }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    expect(result.code).not.toContain('args.code');
    expect(result.code).toContain('return f"review prompt"');
  });
});

// ── Level 1: Python syntax verification — generated code must parse ─────

describe('transpileMCPPython syntax verification', () => {
  function assertPythonParses(code: string, label: string): void {
    const dir = mkdtempSync(join(tmpdir(), 'kern-py-test-'));
    const pyFile = join(dir, 'server.py');
    try {
      writeFileSync(pyFile, code);
      execSync(`python3 -c "import ast; ast.parse(open('${pyFile}').read())"`, { timeout: 5000, stdio: 'pipe' });
    } catch (e) {
      const msg = e instanceof Error && 'stderr' in e ? (e as { stderr: Buffer }).stderr?.toString() : String(e);
      throw new Error(`Generated Python for "${label}" has syntax errors:\n${msg}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('should generate valid Python for a full server', () => {
    const ast = node('mcp', { name: 'FullPy' }, [
      node('tool', { name: 'search' }, [
        node('description', { text: 'Search' }),
        node('param', { name: 'query', type: 'string', required: 'true' }),
        node('param', { name: 'limit', type: 'int', default: '10' }),
        node('param', { name: 'active', type: 'boolean', default: 'false' }),
      ]),
      node('resource', { name: 'config', uri: 'config://app' }),
      node('prompt', { name: 'review' }, [node('param', { name: 'code', type: 'string', required: 'true' })]),
    ]);

    const result = transpileMCPPython(ast);
    assertPythonParses(result.code, 'full Python server');
  });

  it('should generate valid Python with sanitize guard', () => {
    const ast = node('mcp', { name: 'SanitizePy' }, [
      node('tool', { name: 'search' }, [
        node('param', { name: 'query', type: 'string' }),
        node('guard', { type: 'sanitize', param: 'query' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    assertPythonParses(result.code, 'sanitize guard Python');
  });

  it('should generate valid Python with pathContainment guard', () => {
    const ast = node('mcp', { name: 'PathPy' }, [
      node('tool', { name: 'read' }, [
        node('param', { name: 'filePath', type: 'string' }),
        node('guard', { type: 'pathContainment', param: 'filePath', allowlist: '/data' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    assertPythonParses(result.code, 'pathContainment Python');
  });

  it('should generate valid Python for empty server', () => {
    const ast = node('mcp', { name: 'EmptyPy' });
    const result = transpileMCPPython(ast);
    assertPythonParses(result.code, 'empty Python server');
  });

  it('should generate valid Python with lang=python handler', () => {
    const ast = node('mcp', { name: 'PythonHandlerPy' }, [
      node('tool', { name: 'greet' }, [
        node('param', { name: 'name', type: 'string', required: 'true' }),
        node('handler', { lang: 'python', code: 'return f"Hello {name}"' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    assertPythonParses(result.code, 'Python handler server');
  });

  it('should generate valid Python when TS handler is skipped', () => {
    const ast = node('mcp', { name: 'SkippedHandlerPy' }, [
      node('tool', { name: 'greet' }, [
        node('param', { name: 'name', type: 'string', required: 'true' }),
        node('handler', { code: 'return { content: [{ type: "text", text: "Hello " + args.name }] };' }),
      ]),
      node('resource', { name: 'docs', uri: 'docs://readme' }, [
        node('handler', { code: 'return { contents: [{ uri: uri.href, text: "data" }] };' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    assertPythonParses(result.code, 'skipped TS handler Python');
  });
});

// ── Level 2: Python runtime E2E — generated servers must actually work ──

interface MCPResponse {
  jsonrpc: string;
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/** Write Python code to temp dir, spawn it, send MCP messages, return responses. */
function runPythonMCP(
  code: string,
  messages: object[],
  timeoutMs = 15000,
): Promise<{ responses: MCPResponse[]; stderr: string }> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), 'kern-py-e2e-'));
    const pyFile = join(dir, 'server.py');
    writeFileSync(pyFile, code);

    const cp = spawn('python3', ['-u', pyFile], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    let stderr = '';
    let stdoutBuffer = '';
    const responses: MCPResponse[] = [];
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const requestIds = messages.flatMap((msg) => {
      const id = (msg as { id?: unknown }).id;
      return typeof id === 'number' ? [id] : [];
    });
    const initRequest = messages.find((msg) => (msg as { method?: unknown }).method === 'initialize');
    const initializedNotification = messages.find(
      (msg) => (msg as { method?: unknown }).method === 'notifications/initialized',
    );
    const followupMessages = messages.filter((msg) => msg !== initRequest && msg !== initializedNotification);
    const initId =
      typeof (initRequest as { id?: unknown } | undefined)?.id === 'number'
        ? (initRequest as { id: number }).id
        : undefined;
    let postInitSent = initRequest === undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!cp.killed) cp.kill();
      rmSync(dir, { recursive: true, force: true });
      resolve({ responses, stderr });
    };

    const armTimeout = () => {
      cleanup();
      timer = setTimeout(finish, timeoutMs);
    };

    const maybeFinish = () => {
      if (requestIds.every((id) => responses.some((response) => response.id === id))) {
        finish();
      }
    };

    const sendMessage = (msg: object, callback?: (err?: Error | null) => void) => {
      cp.stdin.write(`${JSON.stringify(msg)}\n`, callback);
    };

    const sendFollowups = () => {
      for (const msg of followupMessages) {
        sendMessage(msg);
      }
      armTimeout();
      maybeFinish();
    };

    const sendPostInit = () => {
      if (postInitSent) return;
      postInitSent = true;
      if (!initializedNotification) {
        sendFollowups();
        return;
      }
      sendMessage(initializedNotification, (err) => {
        if (err || settled) return;
        // Give the Python process time to finish initialization on slow CI runners.
        // 200ms wasn't enough — bumped to 500ms after continued flakiness on GH Actions.
        setTimeout(() => {
          if (!settled) sendFollowups();
        }, 500);
      });
    };

    cp.stdout.on('data', (d: Buffer) => {
      stdoutBuffer += d.toString();
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line) {
          try {
            const response = JSON.parse(line) as MCPResponse;
            responses.push(response);
            if (initId !== undefined && !postInitSent && response.id === initId) {
              sendPostInit();
            }
            maybeFinish();
          } catch {
            // Ignore non-JSON stdout noise from subprocess startup.
          }
        }
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
    });
    cp.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    cp.on('close', () => {
      if (!settled) finish();
    });

    cp.on('error', (err) => {
      if (!settled) {
        cleanup();
        rmSync(dir, { recursive: true, force: true });
      }
      reject(err);
    });

    if (initRequest) {
      sendMessage(initRequest);
      armTimeout();
    } else {
      for (const msg of messages) {
        sendMessage(msg);
      }
      armTimeout();
    }
  });
}

function initMessages(): object[] {
  return [
    {
      jsonrpc: '2.0',
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      id: 1,
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
  ];
}

function rpc(method: string, params: object, id: number): object {
  return { jsonrpc: '2.0', method, params, id };
}

function findResponse(responses: MCPResponse[], id: number, stderr = ''): MCPResponse {
  const r = responses.find((r) => r.id === id);
  if (!r)
    throw new Error(
      `No response for id=${id}. Got: ${JSON.stringify(responses)}${stderr ? `\nstderr: ${stderr.slice(0, 500)}` : ''}`,
    );
  return r;
}

// Check if Python + mcp package are available — skip E2E tests if not
let hasPythonMCP = false;
try {
  execSync('python3 -c "from mcp.server.fastmcp import FastMCP"', { stdio: 'pipe', timeout: 10000 });
  hasPythonMCP = true;
} catch {
  /* python3 or mcp not installed */
}

const describeE2E = hasPythonMCP ? describe : describe.skip;

describeE2E('transpileMCPPython runtime E2E', () => {
  // 1. Basic tool call with Python handler
  it('should handle a tool call at runtime with lang=python handler', async () => {
    const ast = node('mcp', { name: 'GreetPyE2E' }, [
      node('tool', { name: 'greet' }, [
        node('description', { text: 'Say hello' }),
        node('param', { name: 'name', type: 'string', required: 'true' }),
        node('handler', { lang: 'python', code: 'return f"Hello {name}"' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    const { responses } = await runPythonMCP(result.code, [
      ...initMessages(),
      rpc('tools/call', { name: 'greet', arguments: { name: 'World' } }, 2),
    ]);

    const toolResponse = findResponse(responses, 2);
    const content = (toolResponse.result as any).content;
    expect(content[0].text).toBe('Hello World');
  }, 30000);

  // 2. Default handler — tool without Python handler gets stub
  it('should return default stub for tool without Python handler', async () => {
    const ast = node('mcp', { name: 'DefaultPyE2E' }, [
      node('tool', { name: 'action' }, [node('description', { text: 'Do something' })]),
    ]);

    const result = transpileMCPPython(ast);
    const { responses, stderr } = await runPythonMCP(result.code, [
      ...initMessages(),
      rpc('tools/call', { name: 'action', arguments: {} }, 2),
    ]);

    const toolResponse = findResponse(responses, 2, stderr);
    const text = (toolResponse.result as any).content[0].text;
    expect(text).toBe('action completed');
  }, 30000);

  // 3. Tool listing
  it('should list tools in Python server', async () => {
    const ast = node('mcp', { name: 'ListPyE2E' }, [
      node('tool', { name: 'alpha' }, [
        node('description', { text: 'Tool A' }),
        node('param', { name: 'x', type: 'string' }),
      ]),
      node('tool', { name: 'beta' }, [node('description', { text: 'Tool B' })]),
    ]);

    const result = transpileMCPPython(ast);
    const { responses } = await runPythonMCP(result.code, [...initMessages(), rpc('tools/list', {}, 2)]);

    const listResponse = findResponse(responses, 2);
    const tools = (listResponse.result as any).tools;
    const names = tools.map((t: { name: string }) => t.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  }, 30000);

  // 4. Typed parameters — number param works correctly
  it('should handle typed parameters in Python', async () => {
    const ast = node('mcp', { name: 'TypedPyE2E' }, [
      node('tool', { name: 'multiply' }, [
        node('param', { name: 'a', type: 'number', required: 'true' }),
        node('param', { name: 'b', type: 'number', required: 'true' }),
        node('handler', { lang: 'python', code: 'return str(a * b)' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    const { responses } = await runPythonMCP(result.code, [
      ...initMessages(),
      rpc('tools/call', { name: 'multiply', arguments: { a: 7, b: 6 } }, 2),
    ]);

    const toolResponse = findResponse(responses, 2);
    expect((toolResponse.result as any).content[0].text).toBe('42.0');
  }, 30000);

  // 5. Auth guard — rejects without env var
  it('should enforce auth guard in Python', async () => {
    const ast = node('mcp', { name: 'AuthPyE2E' }, [
      node('tool', { name: 'secret' }, [
        node('guard', { type: 'auth', env: 'KERN_PY_E2E_SECRET_DOES_NOT_EXIST' }),
        node('handler', { lang: 'python', code: 'return "secret data"' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    const { responses } = await runPythonMCP(result.code, [
      ...initMessages(),
      rpc('tools/call', { name: 'secret', arguments: {} }, 2),
    ]);

    const toolResponse = findResponse(responses, 2);
    expect((toolResponse.result as any)?.isError).toBe(true);
  }, 30000);

  // 6. Sanitize guard — strips dangerous input
  it('should sanitize input in Python', async () => {
    const ast = node('mcp', { name: 'SanitizePyE2E' }, [
      node('tool', { name: 'echo' }, [
        node('param', { name: 'input', type: 'string', required: 'true' }),
        node('guard', { type: 'sanitize', param: 'input', pattern: '[^\\w./ -]' }),
        node('handler', { lang: 'python', code: 'return str(input)' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    const { responses } = await runPythonMCP(result.code, [
      ...initMessages(),
      rpc('tools/call', { name: 'echo', arguments: { input: '<script>alert(1)</script>' } }, 2),
    ]);

    const toolResponse = findResponse(responses, 2);
    const text = (toolResponse.result as any).content[0].text;
    expect(text).not.toContain('<script>');
  }, 30000);

  // 7. TS handler is skipped — doesn't crash Python
  it('should not crash when TS-only handler is present', async () => {
    const ast = node('mcp', { name: 'SkipTSPyE2E' }, [
      node('tool', { name: 'greet' }, [
        node('param', { name: 'name', type: 'string', required: 'true' }),
        // TS handler — should be skipped by Python transpiler
        node('handler', { code: 'return { content: [{ type: "text", text: "Hello " + args.name }] };' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    const { responses, stderr } = await runPythonMCP(result.code, [
      ...initMessages(),
      rpc('tools/call', { name: 'greet', arguments: { name: 'Test' } }, 2),
    ]);

    const toolResponse = findResponse(responses, 2, stderr);
    // Should get the default stub, not a crash
    expect((toolResponse.result as any).content[0].text).toBe('greet completed');
  }, 30000);

  // 8. PathContainment guard — blocks traversal in Python
  it('should block directory traversal in Python', async () => {
    const ast = node('mcp', { name: 'PathPyE2E' }, [
      node('tool', { name: 'readFile' }, [
        node('param', { name: 'filePath', type: 'string', required: 'true' }),
        node('guard', { type: 'pathContainment', param: 'filePath', allowlist: '/tmp/safe' }),
        node('handler', { lang: 'python', code: 'return f"read: {filePath}"' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    const { responses } = await runPythonMCP(result.code, [
      ...initMessages(),
      rpc('tools/call', { name: 'readFile', arguments: { filePath: '../../../etc/passwd' } }, 2),
    ]);

    const toolResponse = findResponse(responses, 2);
    expect((toolResponse.result as any)?.isError).toBe(true);
  }, 30000);

  // 9. Validate guard — rejects out-of-range in Python
  it('should reject out-of-range values in Python', async () => {
    const ast = node('mcp', { name: 'ValidatePyE2E' }, [
      node('tool', { name: 'setCount' }, [
        node('param', { name: 'count', type: 'number', required: 'true' }),
        node('guard', { type: 'validate', param: 'count', min: '1', max: '100' }),
        node('handler', { lang: 'python', code: 'return f"count={count}"' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    const { responses } = await runPythonMCP(result.code, [
      ...initMessages(),
      rpc('tools/call', { name: 'setCount', arguments: { count: 0 } }, 2),
    ]);

    const toolResponse = findResponse(responses, 2);
    expect((toolResponse.result as any)?.isError).toBe(true);
  }, 30000);

  // 10. SizeLimit guard — rejects oversized input in Python
  it('should reject oversized input in Python', async () => {
    const ast = node('mcp', { name: 'SizePyE2E' }, [
      node('tool', { name: 'upload' }, [
        node('param', { name: 'data', type: 'string', required: 'true' }),
        node('guard', { type: 'sizeLimit', param: 'data', max: '50' }),
        node('handler', { lang: 'python', code: 'return "uploaded"' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    const { responses } = await runPythonMCP(result.code, [
      ...initMessages(),
      rpc('tools/call', { name: 'upload', arguments: { data: 'x'.repeat(200) } }, 2),
    ]);

    const toolResponse = findResponse(responses, 2);
    expect((toolResponse.result as any)?.isError).toBe(true);
  }, 30000);

  // 11. Error handling — Python handler that raises produces error response
  it('should catch Python handler errors gracefully', async () => {
    const ast = node('mcp', { name: 'ErrorPyE2E' }, [
      node('tool', { name: 'crasher' }, [node('handler', { lang: 'python', code: 'raise ValueError("intentional")' })]),
    ]);

    const result = transpileMCPPython(ast);
    const { responses } = await runPythonMCP(result.code, [
      ...initMessages(),
      rpc('tools/call', { name: 'crasher', arguments: {} }, 2),
    ]);

    const toolResponse = findResponse(responses, 2);
    expect((toolResponse.result as any)?.isError).toBe(true);
  }, 30000);

  // 12. Resource handler at runtime
  it('should serve a resource in Python', async () => {
    const ast = node('mcp', { name: 'ResourcePyE2E' }, [
      node('resource', { name: 'readme', uri: 'docs://readme' }, [
        node('description', { text: 'The readme' }),
        node('handler', { lang: 'python', code: 'return "# Welcome to KERN"' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    const { responses } = await runPythonMCP(result.code, [
      ...initMessages(),
      rpc('resources/read', { uri: 'docs://readme' }, 2),
    ]);

    const resourceResponse = findResponse(responses, 2);
    expect(resourceResponse.result).toBeDefined();
    const contents = (resourceResponse.result as any).contents;
    expect(contents[0].text).toContain('Welcome to KERN');
  }, 30000);

  // 13. Prompt handler at runtime
  it('should serve a prompt in Python', async () => {
    const ast = node('mcp', { name: 'PromptPyE2E' }, [
      node('prompt', { name: 'review' }, [
        node('description', { text: 'Review code' }),
        node('param', { name: 'code', type: 'string', required: 'true' }),
        node('handler', { lang: 'python', code: 'return f"Please review: {code}"' }),
      ]),
    ]);

    const result = transpileMCPPython(ast);
    const { responses } = await runPythonMCP(result.code, [
      ...initMessages(),
      rpc('prompts/get', { name: 'review', arguments: { code: 'def f(): pass' } }, 2),
    ]);

    const promptResponse = findResponse(responses, 2);
    expect(promptResponse.result).toBeDefined();
    const messages = (promptResponse.result as any).messages;
    expect(messages[0].content.text).toContain('def f(): pass');
  }, 30000);

  // 14. Resource listing
  it('should list resources in Python', async () => {
    const ast = node('mcp', { name: 'ResourceListPyE2E' }, [
      node('resource', { name: 'config', uri: 'app://config' }, [node('description', { text: 'App config' })]),
      node('resource', { name: 'status', uri: 'app://status' }, [node('description', { text: 'App status' })]),
    ]);

    const result = transpileMCPPython(ast);
    const { responses } = await runPythonMCP(result.code, [...initMessages(), rpc('resources/list', {}, 2)]);

    const listResponse = findResponse(responses, 2);
    const resources = (listResponse.result as any).resources;
    const uris = resources.map((r: { uri: string }) => r.uri);
    expect(uris).toContain('app://config');
    expect(uris).toContain('app://status');
  }, 30000);
});
