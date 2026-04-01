# Handoff: Integrate MCP Build into KERN Sight MCP

## Context

KERN Sight MCP (`/Users/nicolascukas/KERN/kern-sight-mcp`) is a VS Code extension that scans MCP servers for security vulnerabilities (13 OWASP MCP rules). It currently only **reviews** MCP servers.

We just built `@kernlang/mcp` and `@kernlang/mcp-server` in the kern-lang monorepo (`/Users/nicolascukas/KERN/kern-lang`). These let you **write MCP servers in .kern** and compile them to TypeScript or Python with security guards auto-injected.

The goal: add **Build** capabilities to KERN Sight MCP so users can write .kern → compile to MCP server → auto-review the output — all inside VS Code.

---

## What Exists in kern-lang (the monorepo)

### `@kernlang/mcp` — MCP Transpiler Package
**Location:** `packages/mcp/`
**Main export:** `transpileMCP(root: IRNode, config?: ResolvedKernConfig): TranspileResult`
**Python export:** `transpileMCPPython(root: IRNode, config?: ResolvedKernConfig): TranspileResult`

**What it does:** Takes parsed KERN IR and generates a complete TypeScript (or Python) MCP server using `@modelcontextprotocol/sdk`.

**Generated code includes:**
- `McpServer` + `StdioServerTransport` (or streamable HTTP) setup
- Zod validation auto-generated from `param` definitions
- 6 security guards: `sanitize`, `pathContainment`, `validate`, `auth`, `rateLimit`, `sizeLimit`
- Structured JSON logging on every tool/resource/prompt call
- Error handling with `isError` responses
- `ResourceTemplate` for dynamic URI variables
- Auto-inject `pathContainment` for path-like param names
- `async main()` wrapper with fatal error handler
- Sampling/elicitation helpers when those nodes are present

**Key files:**
- `packages/mcp/src/transpiler-mcp.ts` — TypeScript MCP codegen (~500 lines)
- `packages/mcp/src/transpiler-mcp-python.ts` — Python FastMCP codegen (~250 lines)
- `packages/mcp/src/index.ts` — barrel exports `transpileMCP`, `transpileMCPResult`, `transpileMCPPython`
- `packages/mcp/src/__tests__/transpiler-mcp.test.ts` — 25 tests
- `packages/mcp/src/__tests__/transpiler-mcp-python.test.ts` — 10 tests

**Tests:** 35 total, all passing.

### `@kernlang/mcp-server` — KERN's Own MCP Server
**Location:** `packages/mcp-server/`
**Binary:** `kern-mcp` (runs via `npx @kernlang/mcp-server`)

**9 Tools:**
- `compile` — .kern → any of 12 targets
- `review` — 76+ rules on TypeScript/JavaScript
- `review-kern` — Lint .kern source files
- `review-mcp-server` — 13 OWASP MCP rules on MCP server code
- `parse` — .kern → IR tree
- `decompile` — IR → readable .kern text
- `validate` — Syntax check without compiling
- `list-targets` — 12 targets with descriptions
- `list-nodes` — Node types with props/children, filterable by category

**3 Resources:**
- `kern://spec` — Full spec with node schemas, grammar, style shorthands
- `kern://examples/{category}` — Examples for ui, api, state-machine, mcp, terminal
- `kern://targets` — Target list as JSON

**1 Prompt:**
- `write-kern` — Comprehensive system prompt with grammar, rules, 6 pattern examples, style shorthand reference

**Integration tests:** 7 tests that spawn the server process and send real MCP protocol messages.

### `@kernlang/review-mcp` — MCP Security Scanner
**Location:** `packages/review-mcp/`
**Main export:** `reviewMCPSource(source: string, filePath: string): ReviewFinding[]`
**Also:** `reviewIfMCP(source, filePath)` — returns null if not an MCP server, findings if it is.

**13 rules (OWASP MCP Top 10):**
mcp01-command-injection, mcp02-path-traversal, mcp03-tool-poisoning, mcp04-secrets-exposure, mcp05-unsanitized-response, mcp06-missing-validation, mcp07-missing-auth, mcp08-typosquatting, mcp09-data-injection, mcp10-ssrf, mcp11-secret-leakage, mcp12-rug-pull, mcp13-insufficient-logging

### `@kernlang/core` — Parser
**Key exports for MCP integration:**
- `parse(source: string): IRNode` — parse .kern to IR
- `decompile(root: IRNode): DecompileResult` — IR back to readable .kern
- `resolveConfig(config?: KernConfig): ResolvedKernConfig`
- `VALID_TARGETS`, `KERN_VERSION`, `NODE_TYPES`, `STYLE_SHORTHANDS`, `NODE_SCHEMAS`
- `serializeIR(root: IRNode): string` — IR to text representation

### `.kern` MCP Syntax (what users write)
```kern
mcp name=ServerName version=1.0
  # transport: stdio (default) or http
  # transport=http port=3000

  tool name=toolName
    description text="What the tool does"
    param name=paramName type=string required=true
    param name=optionalParam type=number default=50
    guard type=sanitize param=paramName
    guard type=pathContainment param=filePath allowlist=/data,/home
    guard type=validate param=count min=1 max=100
    guard type=auth env=API_KEY
    guard type=rateLimit window=60000 requests=100
    guard type=sizeLimit param=data max=1048576
    handler <<<
      // handler code here
      return { content: [{ type: "text", text: "result" }] };
    >>>

  resource name=resourceName uri="scheme://path"
    # or uri="scheme://{templateVar}" for ResourceTemplate
    description text="What the resource provides"
    handler <<<
      return { contents: [{ uri: uri.href, text: "content" }] };
    >>>

  prompt name=promptName
    description text="What the prompt does"
    param name=arg type=string required=true
    handler <<<
      return { messages: [{ role: "user", content: { type: "text", text: `Prompt: ${args.arg}` } }] };
    >>>

  # Advanced: sampling (request LLM completion from client)
  tool name=smartTool
    sampling maxTokens=500
    handler <<<
      const answer = await requestSampling("Summarize this");
      return answer;
    >>>

  # Advanced: elicitation (request structured user input)
  tool name=confirmTool
    elicitation message="Please confirm"
    handler <<<
      const input = await requestInput();
      return input ? "confirmed" : "cancelled";
    >>>
```

### CLI Integration
`kern compile file.kern --target=mcp` works — wired in `packages/cli/src/cli.ts`.
The `compile` subcommand now checks for `--target=` flag and uses the transpiler path.

---

## What Exists in KERN Sight MCP (the VS Code extension)

**Location:** `/Users/nicolascukas/KERN/kern-sight-mcp`
**Files (~2765 lines total):**
- `src/extension.ts` (402 lines) — main activation, commands, diagnostics
- `src/review-panel.ts` (1269 lines) — webview sidebar panel with findings
- `src/code-actions.ts` (414 lines) — quick fixes and code actions
- `src/config-guardian.ts` (254 lines) — MCP config file monitoring
- `src/config.ts` (59 lines) — extension configuration
- `src/mcp-client.ts` (198 lines) — MCP client connection management
- `src/mcp-server.ts` (169 lines) — embedded MCP server for extension
- `package.json` — extension manifest, commands, settings

**Current capabilities:**
- Scan MCP server TS/Python files on save
- Inline diagnostics (errors, warnings)
- Sidebar panel with findings, grouped by severity
- Quick fix code actions (auto-fix suggestions)
- MCP Security Score badge (A-F grade)
- Config Guardian — monitors claude_desktop_config.json for insecure patterns
- SARIF export for CI/CD

---

## What to Build in KERN Sight MCP

### New Commands
1. **"KERN: Compile .kern to MCP Server"** — compile active .kern file to TypeScript MCP server
2. **"KERN: Compile .kern to MCP Server (Python)"** — compile to Python FastMCP
3. **"KERN: Validate .kern"** — parse check without compiling

### New Language Support
4. **`.kern` language registration** — register `kern` language ID in package.json
5. **Basic syntax highlighting** — TextMate grammar for .kern (indent-based, keywords = NODE_TYPES)
6. **Validation on save** — run `parse()` on .kern files, show parse errors as diagnostics

### Build → Review Pipeline
7. **Auto-review compiled output** — when compile produces MCP server code, auto-run `reviewMCPSource()` on it
8. **Split view** — .kern on left, compiled output on right, findings inline on both
9. **Status bar** — "MCP: Build + Review" mode indicator, security score on compiled output

### How to Wire It

The extension bundles `@kernlang/core`, `@kernlang/mcp`, and `@kernlang/review-mcp` as dependencies.

```typescript
// In extension.ts — new compile command
import { parse, resolveConfig } from '@kernlang/core';
import { transpileMCP } from '@kernlang/mcp';
import { transpileMCPPython } from '@kernlang/mcp';
import { reviewMCPSource } from '@kernlang/review-mcp';

vscode.commands.registerCommand('kern-sight-mcp.compileMCP', async () => {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !editor.document.fileName.endsWith('.kern')) return;

  const source = editor.document.getText();
  const ast = parse(source);
  const config = resolveConfig({ target: 'mcp' });
  const result = transpileMCP(ast, config);

  // Show compiled output in a new editor
  const doc = await vscode.workspace.openTextDocument({ content: result.code, language: 'typescript' });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);

  // Auto-review the compiled output
  const findings = reviewMCPSource(result.code, 'compiled-server.ts');
  // ... show findings as diagnostics
});
```

### Package.json Additions
```json
{
  "contributes": {
    "commands": [
      { "command": "kern-sight-mcp.compileMCP", "title": "KERN: Compile .kern to MCP Server" },
      { "command": "kern-sight-mcp.compileMCPPython", "title": "KERN: Compile .kern to MCP Server (Python)" },
      { "command": "kern-sight-mcp.validateKern", "title": "KERN: Validate .kern Syntax" }
    ],
    "languages": [{
      "id": "kern",
      "extensions": [".kern"],
      "aliases": ["KERN", "kern"]
    }],
    "menus": {
      "editor/context": [
        { "command": "kern-sight-mcp.compileMCP", "when": "resourceExtname == .kern" }
      ]
    }
  },
  "dependencies": {
    "@kernlang/core": "^3.0.0",
    "@kernlang/mcp": "^3.0.0",
    "@kernlang/review-mcp": "^3.0.0"
  }
}
```

---

## Key API Signatures

```typescript
// Parse .kern
import { parse } from '@kernlang/core';
const ast: IRNode = parse(kernSource);

// Compile to TypeScript MCP server
import { transpileMCP } from '@kernlang/mcp';
const result: TranspileResult = transpileMCP(ast, resolveConfig({ target: 'mcp' }));
// result.code = complete TypeScript MCP server string
// result.artifacts = additional files (if any)
// result.irTokenCount, result.tsTokenCount = token metrics

// Compile to Python MCP server
import { transpileMCPPython } from '@kernlang/mcp';
const pyResult: TranspileResult = transpileMCPPython(ast);

// Review MCP server code for security
import { reviewMCPSource } from '@kernlang/review-mcp';
const findings: ReviewFinding[] = reviewMCPSource(tsCode, 'server.ts');
// findings[].ruleId, .severity, .message, .primarySpan, .suggestion

// Review .kern source
import { reviewKernSource } from '@kernlang/review';
const report: ReviewReport = reviewKernSource(kernSource);
```

---

## TranspileResult Shape
```typescript
interface TranspileResult {
  code: string;                    // Generated TypeScript/Python code
  sourceMap: SourceMapEntry[];     // .kern line → output line mapping
  irTokenCount: number;            // Input token count
  tsTokenCount: number;            // Output token count
  tokenReduction: number;          // Compression ratio
  diagnostics: TranspileDiagnostic[]; // Node coverage info
  artifacts?: GeneratedArtifact[]; // Additional output files
}
```

---

## Uncommitted Changes in kern-lang

Everything below is built but NOT committed (user explicitly said no commit/push):

1. `packages/mcp/src/transpiler-mcp.ts` — extended with auth, rateLimit, sizeLimit guards + HTTP transport + sampling/elicitation
2. `packages/mcp/src/transpiler-mcp-python.ts` — Python FastMCP transpiler (NEW)
3. `packages/mcp/src/index.ts` — exports transpileMCPPython
4. `packages/mcp/src/__tests__/transpiler-mcp.test.ts` — 25 tests (was 18)
5. `packages/mcp/src/__tests__/transpiler-mcp-python.test.ts` — 10 tests (NEW)
6. `packages/mcp-server/src/index.ts` — enriched with 9 tools, 3 resources, comprehensive prompt
7. `packages/mcp-server/src/__tests__/server.integration.test.ts` — 7 integration tests (NEW)
8. `packages/mcp-server/jest.config.js` — test config (NEW)
9. `packages/cli/src/cli.ts` — fixed `kern compile --target=` to use transpiler path
10. `packages/core/src/spec.ts` — added `sampling`, `elicitation` node types
11. `examples/mcp-server.kern` — example .kern MCP server file (NEW)

**Test counts:** 35 (mcp transpiler) + 10 (python) + 7 (integration) = 52 tests, all passing.
**Full monorepo type-checks clean.**

---

## Naming / Branding Decision Needed

Current: "MCP Security Scanner — OWASP Rules for MCP Servers"
With build: Options:
- "KERN MCP — Build & Secure MCP Servers"
- "MCP Security Scanner + Builder"
- Keep the name, add build as a feature

The user should decide positioning before the extension update.
