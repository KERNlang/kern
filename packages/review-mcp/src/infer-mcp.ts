/**
 * MCP-aware KERN IR inferrer — translates MCP server code to KERN IR nodes.
 *
 * Maps MCP server constructs to KERN's security-semantic IR:
 *   server.tool()  →  action node with trigger, effect, guard children
 *   Tool params    →  input [trust: low] (always untrusted — comes from LLM)
 *   exec/spawn     →  effect { kind: 'shell-exec' }
 *   readFile/open   →  effect { kind: 'fs' }
 *   fetch/axios     →  effect { kind: 'network' }
 *   db.query        →  effect { kind: 'db' }
 *   .parse/.validate →  guard { kind: 'validation' }
 *   path.resolve+startsWith →  guard { kind: 'path-containment' }
 *   auth/jwt        →  guard { kind: 'auth' }
 *
 * The ground-layer rule `unguardedEffect` fires when an action has
 * effect children without preceding guard children — structurally
 * detecting vulnerabilities through KERN's language semantics.
 */

import { SyntaxKind, Project } from 'ts-morph';
import type { IRNode } from '@kernlang/core';

// ── Effect patterns ──────────────────────────────────────────────────

const SHELL_EXEC_PATTERN = /\b(exec|execSync|execFile|execFileSync|spawn|spawnSync|child_process)\b/;
const EVAL_PATTERN = /\beval\s*\(/;
const FS_PATTERN = /\b(readFile|readFileSync|writeFile|writeFileSync|readdir|readdirSync|unlink|unlinkSync|mkdir|mkdirSync|createReadStream|createWriteStream|copyFile|copyFileSync|rename|renameSync|rm|rmSync)\b/;
const NETWORK_PATTERN = /\b(fetch|axios\.\w+|got\.\w+|http\.request|https\.request)\b/;
const DB_PATTERN = /\b(db\.query|findOne|findMany|findById|collection\.find|\.findUnique|\.findFirst|cursor\.execute|\.fetchall|\.fetchone)\b/;

// ── Guard patterns ───────────────────────────────────────────────────

const VALIDATION_PATTERN = /\.(parse|safeParse|validate|validateSync)\s*\(|typeof\s+\w+\s*[!=]==|instanceof\s+|Array\.isArray\s*\(|z\.\w+\s*\(/;
const PATH_CONTAINMENT_PATTERN = /\.startsWith\s*\(/;
const PATH_RESOLVE_PATTERN = /\b(path\.resolve|resolve)\s*\(/;
const AUTH_PATTERN = /\b(authenticate|authorization|auth|verifyToken|requireAuth|jwt\.verify|bearerAuth|isAuthenticated)\b/i;

// ── Python patterns ──────────────────────────────────────────────────

const PY_SHELL_EXEC = /\b(os\.system|os\.popen|subprocess\.run|subprocess\.call|subprocess\.Popen|subprocess\.check_output|asyncio\.create_subprocess_exec|asyncio\.create_subprocess_shell)\s*\(/;
const PY_EVAL = /\b(eval|exec)\s*\(/;
const PY_FS = /\b(open)\s*\(|os\.(remove|unlink|rmdir|rename|listdir|makedirs)\s*\(/;
const PY_NETWORK = /\b(requests\.(get|post|put|delete)|httpx\.\w+|aiohttp|urllib\.request)\b/;
const PY_DB = /\bcursor\.(execute|fetchall|fetchone)\b/;
const PY_VALIDATION = /\bisinstance\s*\(|\.model_validate\b|pydantic/;
const PY_PATH_CONTAINMENT = /\.startswith\s*\(.*\).*(?:os\.path\.realpath|\.resolve\(\))/;
const PY_AUTH = /\b(authenticate|verify_token|require_auth|jwt\.decode|HTTPBearer|Depends.*auth)\b/i;

// ── Helpers ──────────────────────────────────────────────────────────

function loc(line: number, col = 1): { line: number; col: number } {
  return { line, col };
}

function node(type: string, line: number, props?: Record<string, unknown>, children?: IRNode[]): IRNode {
  return {
    type,
    loc: loc(line),
    ...(props ? { props } : {}),
    ...(children && children.length > 0 ? { children } : {}),
  };
}

// ── TypeScript inference ─────────────────────────────────────────────

/**
 * Infer KERN IR nodes from a TypeScript MCP server source file.
 * Maps server.tool() and setRequestHandler(CallToolRequestSchema, ...) to action nodes.
 */
export function inferMCPNodes(source: string, filePath: string): IRNode[] {
  const nodes: IRNode[] = [];

  // Quick bail: not an MCP server
  if (!/@modelcontextprotocol/.test(source) &&
      !/\bMcpServer\b/.test(source) &&
      !/\bCallToolRequestSchema\b/.test(source)) {
    return nodes;
  }

  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  const sf = project.createSourceFile(filePath, source);

  // Find all .tool() call expressions
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();

    // Match: server.tool('name', 'desc', schema, handler)
    // or:    server.setRequestHandler(CallToolRequestSchema, handler)
    let isToolCall = false;
    let toolName = '';
    let toolDesc = '';
    let handlerArg: import('ts-morph').Node | undefined;

    if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pa = expr as import('ts-morph').PropertyAccessExpression;
      const methodName = pa.getName();

      if (methodName === 'tool') {
        isToolCall = true;
        const args = call.getArguments();
        // server.tool('name', 'description', schema, handler)
        if (args.length >= 2) {
          toolName = stripQuotes(args[0].getText());
          toolDesc = args.length >= 3 ? stripQuotes(args[1].getText()) : '';
          handlerArg = args[args.length - 1]; // Last arg is the handler
        }
      } else if (methodName === 'setRequestHandler') {
        const args = call.getArguments();
        if (args.length >= 2 && args[0].getText().includes('CallToolRequest')) {
          isToolCall = true;
          toolName = 'call-tool-handler';
          handlerArg = args[1];
        }
      }
    }

    if (!isToolCall || !handlerArg) continue;

    // Extract handler body text
    const handlerText = handlerArg.getText();
    const handlerLine = call.getStartLineNumber();
    const children: IRNode[] = [];

    // Trigger
    children.push(node('trigger', handlerLine, { kind: 'tool-call' }));

    // Scan handler body for effects and guards
    const bodyLines = handlerText.split('\n');
    for (let i = 0; i < bodyLines.length; i++) {
      const line = bodyLines[i];
      const absoluteLine = handlerLine + i;

      // Effects
      if (SHELL_EXEC_PATTERN.test(line) || EVAL_PATTERN.test(line)) {
        children.push(node('effect', absoluteLine, { kind: 'shell-exec', trust: 'low' }));
      }
      if (FS_PATTERN.test(line)) {
        children.push(node('effect', absoluteLine, { kind: 'fs', trust: 'low' }));
      }
      if (NETWORK_PATTERN.test(line)) {
        children.push(node('effect', absoluteLine, { kind: 'network', trust: 'low' }));
      }
      if (DB_PATTERN.test(line)) {
        children.push(node('effect', absoluteLine, { kind: 'db', trust: 'low' }));
      }

      // Guards
      if (VALIDATION_PATTERN.test(line)) {
        children.push(node('guard', absoluteLine, { kind: 'validation' }));
      }
      if (PATH_CONTAINMENT_PATTERN.test(line) && PATH_RESOLVE_PATTERN.test(handlerText)) {
        children.push(node('guard', absoluteLine, { kind: 'path-containment' }));
      }
      if (AUTH_PATTERN.test(line)) {
        children.push(node('guard', absoluteLine, { kind: 'auth' }));
      }
    }

    // Build action node
    const actionNode = node('action', handlerLine, {
      name: toolName,
      description: toolDesc,
      trust: 'low',
      confidence: computeConfidence(children),
    }, children);

    nodes.push(actionNode);
  }

  return nodes;
}

// ── Python inference ─────────────────────────────────────────────────

/**
 * Infer KERN IR nodes from a Python MCP server source file.
 * Maps @mcp.tool() / @server.tool() handlers to action nodes.
 */
export function inferMCPNodesPython(source: string, filePath: string): IRNode[] {
  const nodes: IRNode[] = [];

  // Quick bail
  if (!/from\s+mcp\.server/.test(source) &&
      !/\bFastMCP\b/.test(source) &&
      !/['"]tools\/call['"]/.test(source)) {
    return nodes;
  }

  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    // Match @mcp.tool() or @server.tool() or @server.call_tool() decorators
    const isDecorator = /^\s*@(?:mcp|server)\.(?:tool|call_tool)/.test(lines[i]);
    // Match class methods for raw protocol servers
    const isHandlerDef = /^\s*(?:async\s+)?def\s+(?:handle_tools?_call|read_file|write_file|list_directory|execute_code)\s*\(/.test(lines[i]);

    if (!isDecorator && !isHandlerDef) continue;

    // Find the def line
    let defLine = -1;
    let defContent = '';
    if (isHandlerDef) {
      defLine = i;
      defContent = lines[i];
    } else {
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        if (/^\s*(?:async\s+)?def\s+/.test(lines[j])) {
          defLine = j;
          defContent = lines[j];
          break;
        }
      }
    }
    if (defLine < 0) continue;

    // Extract function name
    const nameMatch = defContent.match(/def\s+(\w+)/);
    const toolName = nameMatch ? nameMatch[1] : 'unknown';

    // Extract docstring as description
    let toolDesc = '';
    for (let j = defLine + 1; j < Math.min(defLine + 4, lines.length); j++) {
      if (/^\s*(?:"""|''')(.*)(?:"""|''')/.test(lines[j])) {
        toolDesc = lines[j].replace(/^\s*(?:"""|''')\s*/, '').replace(/\s*(?:"""|''')\s*$/, '');
        break;
      }
    }

    // Find function end (next def/class at same or lower indentation)
    const indent = (defContent.match(/^(\s*)/)?.[1] || '').length;
    let endLine = lines.length;
    for (let j = defLine + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      const lineIndent = (lines[j].match(/^(\s*)/)?.[1] || '').length;
      if (lineIndent <= indent && /^\s*(?:@|def |class |async def )/.test(lines[j])) {
        endLine = j;
        break;
      }
    }

    // Scan function body
    const children: IRNode[] = [];
    children.push(node('trigger', defLine + 1, { kind: 'tool-call' }));

    for (let j = defLine; j < endLine; j++) {
      const line = lines[j];
      const lineNum = j + 1; // 1-based

      // Effects
      if (PY_SHELL_EXEC.test(line)) {
        children.push(node('effect', lineNum, { kind: 'shell-exec', trust: 'low' }));
      }
      if (PY_EVAL.test(line) && !/\bexec\s*\(\s*['"]/.test(line)) {
        children.push(node('effect', lineNum, { kind: 'shell-exec', trust: 'low' }));
      }
      if (PY_FS.test(line)) {
        children.push(node('effect', lineNum, { kind: 'fs', trust: 'low' }));
      }
      if (PY_NETWORK.test(line)) {
        children.push(node('effect', lineNum, { kind: 'network', trust: 'low' }));
      }
      if (PY_DB.test(line)) {
        children.push(node('effect', lineNum, { kind: 'db', trust: 'low' }));
      }

      // Guards
      if (PY_VALIDATION.test(line)) {
        children.push(node('guard', lineNum, { kind: 'validation' }));
      }
      if (/\.startswith\s*\(/.test(line) && /(os\.path\.realpath|\.resolve\(\))/.test(source.slice(0, source.indexOf(line) + line.length))) {
        children.push(node('guard', lineNum, { kind: 'path-containment' }));
      }
      if (PY_AUTH.test(line)) {
        children.push(node('guard', lineNum, { kind: 'auth' }));
      }
    }

    const actionNode = node('action', defLine + 1, {
      name: toolName,
      description: toolDesc,
      trust: 'low',
      confidence: computeConfidence(children),
    }, children);

    nodes.push(actionNode);
  }

  return nodes;
}

// ── Shared utilities ─────────────────────────────────────────────────

/** Compute action confidence based on guard/effect ratio */
function computeConfidence(children: IRNode[]): number {
  const effects = children.filter(c => c.type === 'effect');
  const guards = children.filter(c => c.type === 'guard');

  if (effects.length === 0) return 0.9; // No dangerous effects = safe
  if (guards.length === 0) return 0.2;  // Effects with no guards = very suspicious
  if (guards.length >= effects.length) return 0.8; // Guarded = reasonable
  return 0.5; // Partially guarded
}

function stripQuotes(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, '');
}
