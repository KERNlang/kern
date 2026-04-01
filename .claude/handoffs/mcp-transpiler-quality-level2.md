# Handoff: MCP Transpiler Quality — Level 2 & 3

## Current State (Level 1 — 6.5/10)

The transpiler now has compile verification: every generated TypeScript file is checked with `tsc --noEmit` and every generated Python file with `python3 ast.parse()`. 48 tests pass including 5 TS compile checks and 4 Python syntax checks.

Bugs fixed in this session: 7 total (3 from GPT-5.4 Pro review + 4 from deep Opus review).

## What's Needed for Level 2 (8/10): Runtime E2E Tests

**Goal:** Generate an MCP server from .kern, actually RUN it, send MCP messages, verify responses.

### Test Pattern

```typescript
it('should actually handle a tool call at runtime', async () => {
  // 1. Generate server from .kern
  const ast = parse(`
    mcp name=Test
      tool name=greet
        param name=who type=string required=true
        handler <<<
          return { content: [{ type: "text", text: "Hello " + args.who }] };
        >>>
  `);
  const result = transpileMCP(ast);

  // 2. Write to temp file and run it
  writeFileSync(join(dir, 'server.ts'), result.code);
  // Compile with tsx/ts-node or bundle
  const cp = spawn('npx', ['tsx', join(dir, 'server.ts')]);

  // 3. Send MCP initialize + tool call
  cp.stdin.write(JSON.stringify({
    jsonrpc: '2.0', method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    id: 1
  }) + '\n');
  cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  cp.stdin.write(JSON.stringify({
    jsonrpc: '2.0', method: 'tools/call',
    params: { name: 'greet', arguments: { who: 'World' } },
    id: 2
  }) + '\n');

  // 4. Verify response
  const response = await readResponse(cp, 2);
  expect(response.result.content[0].text).toBe('Hello World');
  cp.kill();
});
```

### Runtime Tests to Write

1. **Basic tool call** — greet tool returns correct response
2. **Sanitize guard works** — send `<script>alert(1)</script>`, verify it's stripped
3. **PathContainment guard works** — send `/etc/passwd`, verify it throws
4. **Validate guard works** — send count=0 with min=1, verify it rejects
5. **Auth guard works** — no env var set, verify it throws PermissionError
6. **RateLimit guard works** — send 11 requests with limit=10, verify 11th throws
7. **SizeLimit guard works** — send 2MB string with 1MB limit, verify it throws
8. **Resource works** — static URI resource returns content
9. **ResourceTemplate works** — dynamic URI resource receives variables
10. **Prompt works** — prompt returns messages array

### Dependencies Needed

- `tsx` or `ts-node` for running generated TypeScript without pre-compilation
- Or: compile the generated code with `tsc` first, then run the JS output
- `@modelcontextprotocol/sdk` must be available to the generated server at runtime

### Infrastructure

The integration test pattern from `packages/mcp-server/src/__tests__/server.integration.test.ts` already works — it spawns a process and sends MCP messages. Adapt that pattern but spawn the GENERATED server instead of the hand-written one.

---

## What's Needed for Level 3 (9/10): Python Handler Problem

### The Problem

`.kern` handler blocks contain TypeScript code:
```kern
tool name=greet
  handler <<<
    return { content: [{ type: "text", text: "Hello " + args.who }] };
  >>>
```

The Python transpiler pastes this TypeScript verbatim into Python:
```python
@mcp.tool()
async def greet(who: str) -> str:
    return { content: [{ type: "text", text: "Hello " + args.who }] };  # NOT PYTHON
```

This crashes at runtime. Every .kern with handler code generates broken Python.

### Options

**(A) Python-only handler blocks** — new syntax:
```kern
tool name=greet
  handler lang=python <<<
    return f"Hello {who}"
  >>>
```
Cleanest. Requires parser change to support `lang=` prop on handler.

**(B) Dual handlers** — both languages in one .kern:
```kern
tool name=greet
  handler <<<
    return { content: [{ type: "text", text: "Hello " + args.who }] };
  >>>
  handler lang=python <<<
    return f"Hello {who}"
  >>>
```
More verbose but supports both targets from one file.

**(C) Declarative-only Python** — no handler blocks for Python target. Tools without handlers get a default implementation. Tools with handlers only compile to TypeScript.

**(D) Auto-transpile simple patterns** — detect simple TypeScript like `return "string"` and convert to Python. Fragile, not recommended.

**Recommendation:** Option A is the right move. It's the simplest change (parser already supports props on handler, just add `lang=`), and it's honest — if you want Python output, write Python handler code.

### Implementation for Option A

1. In `transpiler-mcp-python.ts`, skip handler nodes where `lang` prop is set and not `python`
2. Only emit handler code where `lang === 'python'` or `lang` is undefined (for backward compat, treat no-lang handlers as TypeScript-only)
3. For tools with no Python handler, emit a stub: `return f"{name} completed"`
4. Document the `lang=python` syntax in examples and in the `write-kern` MCP prompt

---

## Files Changed (Uncommitted)

All changes are in `packages/mcp/` and `packages/mcp-server/`:

- `packages/mcp/src/transpiler-mcp.ts` — bug fixes (args binding, boolean defaults, IIFE removal, resource/prompt args, prompt guards)
- `packages/mcp/src/transpiler-mcp-python.ts` — path traversal fix, import detection fix
- `packages/mcp/src/__tests__/transpiler-mcp.test.ts` — 29 tests (was 18), including 4 regression + 5 compile checks
- `packages/mcp/src/__tests__/transpiler-mcp-python.test.ts` — 14 tests (was 10), including 4 syntax checks
- Plus all the earlier feature additions (guards, HTTP transport, sampling, etc.)

Total: 48 tests passing, all compile-verified.
