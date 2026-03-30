import type { AccountedEntry, IRNode, ResolvedKernConfig, KernConfig, SourceMapEntry, TranspileResult } from '@kernlang/core';
import { accountNode, buildDiagnostics, camelKey, countTokens, getChildren, getFirstChild, getProps, serializeIR } from '@kernlang/core';

// ── Types (from Codex — proper typed interfaces) ────────────────────────

type GuardKind = 'sanitize' | 'pathContainment' | 'validate';

interface GuardDefinition {
  kind: GuardKind;
  target?: string;
  pattern?: string;
  replacement?: string;
  min?: string;
  max?: string;
  regex?: string;
  allowlist: string[];
  baseDir?: string;
}

interface ParamDefinition {
  name: string;
  type: string;
  optional: boolean;
  defaultValue?: string;
  description?: string;
  guards: GuardDefinition[];
  node: IRNode;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function json(value: string): string {
  return JSON.stringify(value);
}

function findMcpNode(root: IRNode): IRNode | undefined {
  if (root.type === 'mcp') return root;
  for (const child of root.children || []) {
    const found = findMcpNode(child);
    if (found) return found;
  }
  return undefined;
}

function str(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function extractDescription(node: IRNode): string {
  const props = getProps(node);
  const descNode = getFirstChild(node, 'description');
  const raw = str(props.description)
    || (descNode ? str(getProps(descNode).text) || str(getProps(descNode).value) : undefined)
    || '';
  return raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
}

function indent(code: string, spaces: number): string[] {
  const prefix = ' '.repeat(spaces);
  return code.split('\n').map(line => line.length > 0 ? `${prefix}${line}` : '');
}

function splitCsv(value?: string): string[] {
  return (value || '').split(',').map(p => p.trim()).filter(Boolean);
}

// ── Guard collection (from Codex — robust prop aliases) ─────────────────

function guardTarget(props: Record<string, unknown>): string | undefined {
  return str(props.param) || str(props.field) || str(props.target) || str(props.on);
}

function collectGuard(node: IRNode, fallbackAllowlist: string[]): GuardDefinition | null {
  const props = getProps(node);
  const kind = str(props.name) || str(props.kind) || str(props.type);
  if (kind !== 'sanitize' && kind !== 'pathContainment' && kind !== 'validate') return null;
  const rawAllow = splitCsv(str(props.allowlist) || str(props.allow) || str(props.roots));
  return {
    kind,
    target: guardTarget(props),
    pattern: str(props.pattern),
    replacement: str(props.replacement),
    min: str(props.min),
    max: str(props.max),
    regex: str(props.regex),
    baseDir: str(props.baseDir) || str(props.base) || str(props.root),
    allowlist: rawAllow.length > 0 ? rawAllow : fallbackAllowlist,
  };
}

function isPathLikeParam(name: string): boolean {
  return /(?:path|file|dir|root|workspace)/i.test(name);
}

function collectParams(node: IRNode, fallbackAllowlist: string[]): ParamDefinition[] {
  const paramNodes = getChildren(node, 'param');
  const parentGuards = getChildren(node, 'guard')
    .map(g => collectGuard(g, fallbackAllowlist))
    .filter((g): g is GuardDefinition => !!g);

  return paramNodes.map((paramNode) => {
    const props = getProps(paramNode);
    const name = str(props.name) || 'input';
    const type = str(props.type) || 'string';
    const guards = [
      ...getChildren(paramNode, 'guard')
        .map(g => collectGuard(g, fallbackAllowlist))
        .filter((g): g is GuardDefinition => !!g),
      ...parentGuards.filter(g => !g.target ? paramNodes.length === 1 : g.target === name),
    ];

    // Auto-inject pathContainment for path-like params (from Codex)
    if (!guards.some(g => g.kind === 'pathContainment') && isPathLikeParam(name)) {
      guards.push({ kind: 'pathContainment', target: name, allowlist: fallbackAllowlist });
    }

    return {
      name,
      type,
      optional: str(props.required) === 'false' || props.default !== undefined,
      defaultValue: str(props.default),
      description: str(props.description),
      guards,
      node: paramNode,
    };
  });
}

// ── Zod schema generation ───────────────────────────────────────────────

function zodForParam(param: ParamDefinition): string {
  let expr: string;
  switch (param.type) {
    case 'number': case 'float': expr = 'z.number()'; break;
    case 'int': case 'integer': expr = 'z.number().int()'; break;
    case 'boolean': case 'bool': expr = 'z.boolean()'; break;
    case 'string[]': expr = 'z.array(z.string())'; break;
    case 'number[]': expr = 'z.array(z.number())'; break;
    case 'object': case 'json': expr = 'z.record(z.string(), z.unknown())'; break;
    default: expr = 'z.string()'; break;
  }

  // Apply validate guards
  for (const guard of param.guards.filter(g => g.kind === 'validate')) {
    if (guard.min) expr += `.min(${Number(guard.min)})`;
    if (guard.max) expr += `.max(${Number(guard.max)})`;
    if (guard.regex) expr += `.regex(new RegExp(${json(guard.regex)}))`;
  }

  // Apply inline min/max/regex from param props
  const pp = getProps(param.node);
  if (pp.min !== undefined && !param.guards.some(g => g.kind === 'validate' && g.min)) {
    expr += `.min(${Number(pp.min)})`;
  }
  if (pp.max !== undefined && !param.guards.some(g => g.kind === 'validate' && g.max)) {
    expr += `.max(${Number(pp.max)})`;
  }

  if (param.description) {
    expr += `.describe(${json(param.description)})`;
  }

  if (param.defaultValue !== undefined) {
    const dv = param.type === 'number' || param.type === 'int' ? param.defaultValue : json(param.defaultValue);
    expr += `.default(${dv})`;
  } else if (param.optional) {
    expr += '.optional()';
  }

  return expr;
}

// ── Runtime guard emission ──────────────────────────────────────────────

function emitGuardLines(params: ParamDefinition[]): string[] {
  const lines: string[] = [];
  for (const param of params) {
    const accessor = `params[${json(param.name)}]`;
    for (const guard of param.guards.filter(g => g.kind === 'sanitize')) {
      const pattern = guard.pattern || '[^\\w./ -]';
      lines.push(`${accessor} = sanitizeValue(${accessor}, ${json(pattern)}, ${json(guard.replacement || '')});`);
    }
    const pathGuard = param.guards.find(g => g.kind === 'pathContainment');
    if (pathGuard) {
      const base = pathGuard.baseDir
        ? `path.resolve(${json(pathGuard.baseDir)}, String(${accessor}))`
        : `path.resolve(String(${accessor}))`;
      lines.push(`${accessor} = ensurePathContainment(${base}, ALLOWED_PATHS);`);
    }
  }
  return lines;
}

// ── Tool / Resource / Prompt emission ───────────────────────────────────

function emitTool(node: IRNode, fallbackAllowlist: string[]): string[] {
  const name = str(getProps(node).name) || 'tool';
  const description = extractDescription(node) || `Run ${name}`;
  const params = collectParams(node, fallbackAllowlist);
  const handlerNode = getFirstChild(node, 'handler');
  const handlerCode = handlerNode ? str(getProps(handlerNode).code) || '' : '';

  const lines: string[] = [];

  // Zod schema object
  if (params.length > 0) {
    lines.push(`const ${camelKey(name)}Schema = {`);
    for (const param of params) {
      lines.push(`  ${json(param.name)}: ${zodForParam(param)},`);
    }
    lines.push(`};`);
    lines.push('');
  }

  lines.push(`server.tool(${json(name)}, ${json(description)}, ${params.length > 0 ? `${camelKey(name)}Schema` : '{}'}, async (input) => {`);
  lines.push(`  const requestId = nextRequestId();`);
  lines.push(`  logger.info("tool:call", { requestId, tool: ${json(name)} });`);
  lines.push(`  try {`);

  if (params.length > 0) {
    lines.push(`    const params = { ...input } as Record<string, unknown>;`);
    for (const line of emitGuardLines(params)) {
      lines.push(`    ${line}`);
    }
  }

  lines.push(`    const result = await (async () => {`);
  if (handlerCode) {
    lines.push(...indent(handlerCode, 6));
  } else {
    lines.push(`      return { content: [{ type: "text" as const, text: ${json(`${name} completed`)} }] };`);
  }
  lines.push(`    })();`);
  lines.push(`    logger.info("tool:ok", { requestId, tool: ${json(name)} });`);
  lines.push(`    return normalizeToolResult(result);`);
  lines.push(`  } catch (error) {`);
  lines.push(`    logger.error("tool:error", { requestId, tool: ${json(name)}, error: fmtError(error) });`);
  lines.push(`    return { isError: true as const, content: [{ type: "text" as const, text: fmtError(error) }] };`);
  lines.push(`  }`);
  lines.push(`});`);
  return lines;
}

function emitResource(node: IRNode, fallbackAllowlist: string[]): string[] {
  const name = str(getProps(node).name) || 'resource';
  const uri = str(getProps(node).uri) || `${name}://default`;
  const description = extractDescription(node);
  const params = collectParams(node, fallbackAllowlist);
  const handlerNode = getFirstChild(node, 'handler');
  const handlerCode = handlerNode ? str(getProps(handlerNode).code) || '' : '';

  const lines: string[] = [];
  const hasTemplate = uri.includes('{');

  if (description) lines.push(`// ${description}`);

  const uriArg = hasTemplate
    ? `new ResourceTemplate(${json(uri)}, { list: undefined })`
    : json(uri);

  lines.push(`server.resource(${json(name)}, ${uriArg}, async (uri${hasTemplate ? ', variables' : ''}) => {`);
  lines.push(`  logger.info("resource:read", { resource: ${json(name)}, uri: uri.href });`);
  lines.push(`  try {`);

  if (params.length > 0) {
    lines.push(`    const params = { ...(${hasTemplate ? 'variables' : '{}'}) } as Record<string, unknown>;`);
    for (const line of emitGuardLines(params)) {
      lines.push(`    ${line}`);
    }
  }

  lines.push(`    const result = await (async () => {`);
  if (handlerCode) {
    lines.push(...indent(handlerCode, 6));
  } else {
    lines.push(`      return { contents: [{ uri: uri.href, text: ${json(`${name} content`)} }] };`);
  }
  lines.push(`    })();`);
  lines.push(`    return result;`);
  lines.push(`  } catch (error) {`);
  lines.push(`    logger.error("resource:error", { resource: ${json(name)}, error: fmtError(error) });`);
  lines.push(`    throw error;`);
  lines.push(`  }`);
  lines.push(`});`);
  return lines;
}

function emitPrompt(node: IRNode): string[] {
  const name = str(getProps(node).name) || 'prompt';
  const description = extractDescription(node);
  const paramNodes = getChildren(node, 'param');
  const handlerNode = getFirstChild(node, 'handler');
  const handlerCode = handlerNode ? str(getProps(handlerNode).code) || '' : '';

  const lines: string[] = [];
  if (description) lines.push(`// ${description}`);

  lines.push(`server.prompt(${json(name)}, ${json(description || name)}, [`);
  for (const p of paramNodes) {
    const pp = getProps(p);
    const pName = str(pp.name) || 'input';
    const required = str(pp.required) !== 'false';
    lines.push(`  { name: ${json(pName)}, required: ${required} },`);
  }
  lines.push(`], async (args) => {`);
  lines.push(`  const requestId = nextRequestId();`);
  lines.push(`  logger.info("prompt:call", { requestId, prompt: ${json(name)} });`);
  lines.push(`  try {`);

  if (handlerCode) {
    lines.push(...indent(handlerCode, 4));
  } else {
    lines.push(`    return { messages: [{ role: "user" as const, content: { type: "text" as const, text: ${json(`${name} prompt`)} } }] };`);
  }

  lines.push(`  } catch (error) {`);
  lines.push(`    logger.error("prompt:error", { requestId, prompt: ${json(name)}, error: fmtError(error) });`);
  lines.push(`    return { messages: [{ role: "user" as const, content: { type: "text" as const, text: fmtError(error) } }] };`);
  lines.push(`  }`);
  lines.push(`});`);
  return lines;
}

// ── Main transpiler ─────────────────────────────────────────────────────

function buildCode(root: IRNode, _config?: KernConfig | ResolvedKernConfig): {
  code: string;
  sourceMap: SourceMapEntry[];
  diagnostics: ReturnType<typeof buildDiagnostics>;
} {
  const accounted = new Map<IRNode, AccountedEntry>();
  accountNode(accounted, root, 'consumed', 'parse root');

  const mcpNode = findMcpNode(root);
  const container = mcpNode || root;
  if (mcpNode) accountNode(accounted, mcpNode, 'expressed', 'mcp server root', true);

  const props = mcpNode ? getProps(mcpNode) : {};
  const serverName = str(props.name) || 'KernMCPServer';
  const serverVersion = str(props.version) || '1.0.0';

  // Allowlist from mcp node props
  const rawAllow = splitCsv(str(props.allowlist) || str(props.allowedPaths) || str(props.baseDir));
  const allowlist = rawAllow.length > 0 ? rawAllow : ['process.cwd()'];

  const toolNodes = getChildren(container, 'tool');
  const resourceNodes = getChildren(container, 'resource');
  const promptNodes = getChildren(container, 'prompt');

  // Track all children
  for (const n of [...toolNodes, ...resourceNodes, ...promptNodes]) {
    accountNode(accounted, n, 'expressed', `mcp ${n.type}`, true);
  }

  // Determine if we need path import and ResourceTemplate — scan ALL node types, not just tools
  const allNodes = [...toolNodes, ...resourceNodes, ...promptNodes];
  const allGuards = allNodes.flatMap(n => getChildren(n, 'guard'));
  const allParams = allNodes.flatMap(n => collectParams(n, allowlist));
  const needsPath = allGuards.some(g => str(getProps(g).type) === 'pathContainment' || str(getProps(g).kind) === 'pathContainment')
    || allParams.some(p => p.guards.some(g => g.kind === 'pathContainment'));
  const needsResourceTemplate = resourceNodes.some(r => (str(getProps(r).uri) || '').includes('{'));

  const allowlistLiteral = `[${allowlist.map(v => v === 'process.cwd()' ? 'process.cwd()' : json(v)).join(', ')}]`;
  const sourceMap: SourceMapEntry[] = [];
  const lines: string[] = [];

  // ── Imports
  if (needsResourceTemplate) {
    lines.push(`import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";`);
  } else {
    lines.push(`import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";`);
  }
  lines.push(`import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";`);
  lines.push(`import { z } from "zod";`);
  if (needsPath) {
    lines.push(`import path from "node:path";`);
  }
  lines.push('');

  // ── Server instance
  lines.push(`const server = new McpServer({`);
  lines.push(`  name: ${json(serverName)},`);
  lines.push(`  version: ${json(serverVersion)},`);
  lines.push(`});`);
  lines.push('');

  // ── Runtime helpers (auto-injected — from Codex's structured approach)
  if (needsPath) {
    lines.push(`const ALLOWED_PATHS = ${allowlistLiteral}.map(r => path.resolve(r));`);
    lines.push('');
  }

  lines.push(`const logger = {`);
  lines.push(`  info(event: string, details: Record<string, unknown> = {}) {`);
  lines.push(`    console.error(JSON.stringify({ level: "info", event, ...details, ts: new Date().toISOString() }));`);
  lines.push(`  },`);
  lines.push(`  error(event: string, details: Record<string, unknown> = {}) {`);
  lines.push(`    console.error(JSON.stringify({ level: "error", event, ...details, ts: new Date().toISOString() }));`);
  lines.push(`  },`);
  lines.push(`};`);
  lines.push('');
  lines.push(`function nextRequestId(): string {`);
  lines.push('  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;');
  lines.push(`}`);
  lines.push('');
  lines.push(`function fmtError(error: unknown): string {`);
  lines.push(`  return error instanceof Error ? error.message : String(error);`);
  lines.push(`}`);
  lines.push('');

  if (allParams.some(p => p.guards.some(g => g.kind === 'sanitize'))) {
    lines.push(`function sanitizeValue(value: unknown, pattern: string, replacement: string): unknown {`);
    lines.push(`  if (typeof value !== "string") return value;`);
    lines.push(`  return value.replace(new RegExp(pattern, "g"), replacement);`);
    lines.push(`}`);
    lines.push('');
  }

  if (needsPath) {
    lines.push(`function ensurePathContainment(candidate: string, allowlist: string[]): string {`);
    lines.push(`  const resolved = path.resolve(candidate);`);
    lines.push('  const ok = allowlist.some(root => resolved === root || resolved.startsWith(`${root}${path.sep}`));');
    lines.push(`  if (!ok) throw new Error("Path escapes allowed directories: " + candidate);`);
    lines.push(`  return resolved;`);
    lines.push(`}`);
    lines.push('');
  }

  lines.push(`function normalizeToolResult(result: unknown): { content: Array<{ type: "text"; text: string }> } {`);
  lines.push(`  if (result && typeof result === "object" && "content" in result) return result as { content: Array<{ type: "text"; text: string }> };`);
  lines.push(`  return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] };`);
  lines.push(`}`);
  lines.push('');

  // ── Registrations
  for (const toolNode of toolNodes) {
    sourceMap.push({ irLine: toolNode.loc?.line || 0, irCol: toolNode.loc?.col || 1, outLine: lines.length + 1, outCol: 1 });
    lines.push(...emitTool(toolNode, allowlist), '');
  }
  for (const resourceNode of resourceNodes) {
    sourceMap.push({ irLine: resourceNode.loc?.line || 0, irCol: resourceNode.loc?.col || 1, outLine: lines.length + 1, outCol: 1 });
    lines.push(...emitResource(resourceNode, allowlist), '');
  }
  for (const promptNode of promptNodes) {
    sourceMap.push({ irLine: promptNode.loc?.line || 0, irCol: promptNode.loc?.col || 1, outLine: lines.length + 1, outCol: 1 });
    lines.push(...emitPrompt(promptNode), '');
  }

  // ── Main entrypoint (from Codex — proper async main + fatal handler)
  lines.push(`async function main(): Promise<void> {`);
  lines.push(`  logger.info("server:start", { server: ${json(serverName)}, version: ${json(serverVersion)} });`);
  lines.push(`  const transport = new StdioServerTransport();`);
  lines.push(`  await server.connect(transport);`);
  lines.push(`}`);
  lines.push('');
  lines.push(`void main().catch((error) => {`);
  lines.push(`  logger.error("server:fatal", { error: fmtError(error) });`);
  lines.push(`  process.exitCode = 1;`);
  lines.push(`});`);
  lines.push('');

  return {
    code: lines.join('\n'),
    sourceMap,
    diagnostics: buildDiagnostics(root, accounted, 'mcp'),
  };
}

/** Transpile a KERN IR tree to MCP server TypeScript code string. */
export function transpileMCP(root: IRNode, config?: ResolvedKernConfig): TranspileResult {
  const { code, sourceMap, diagnostics } = buildCode(root, config);
  const ir = serializeIR(root);
  const irTokenCount = countTokens(ir);
  const tsTokenCount = countTokens(code);

  return {
    code,
    sourceMap: sourceMap.length > 0 ? sourceMap : [{ irLine: root.loc?.line || 0, irCol: root.loc?.col || 1, outLine: 1, outCol: 1 }],
    irTokenCount,
    tsTokenCount,
    tokenReduction: irTokenCount === 0 ? 0 : Math.round((1 - irTokenCount / tsTokenCount) * 100),
    diagnostics,
  };
}

/** Alias for use from CLI where config may not be fully resolved. */
export function transpileMCPResult(root: IRNode, config?: KernConfig | ResolvedKernConfig): TranspileResult {
  return transpileMCP(root, config as ResolvedKernConfig | undefined);
}
