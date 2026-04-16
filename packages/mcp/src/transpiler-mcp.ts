import type {
  AccountedEntry,
  IRNode,
  KernConfig,
  ResolvedKernConfig,
  SourceMapEntry,
  TranspileDiagnostic,
  TranspileResult,
} from '@kernlang/core';
import {
  accountNode,
  buildDiagnostics,
  camelKey,
  countTokens,
  generateCoreNode,
  getChildren,
  getFirstChild,
  getProps,
  serializeIR,
} from '@kernlang/core';
import { FILE_IO_PATTERN, NETWORK_PATTERN, SHELL_EXEC_PATTERN } from './effect-patterns.js';

// ── Types (from Codex — proper typed interfaces) ────────────────────────

type GuardKind =
  | 'sanitize'
  | 'pathContainment'
  | 'validate'
  | 'auth'
  | 'rateLimit'
  | 'sizeLimit'
  | 'sanitizeOutput'
  | 'urlValidation';

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
  // auth guard
  envVar?: string;
  header?: string;
  // rateLimit guard
  windowMs?: string;
  maxRequests?: string;
  // sizeLimit guard
  maxBytes?: string;
  // urlValidation guard
  allowSchemes?: string[];
  allowHosts?: string[];
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

const MCP_HELPER_NODE_TYPES = new Set(['import', 'const', 'fn']);
const RESERVED_MCP_TS_BINDINGS = new Set([
  'McpServer',
  'ResourceTemplate',
  'StdioServerTransport',
  'z',
  'path',
  '_realpathSync',
  'server',
  'ALLOWED_PATHS',
  'logger',
  'nextRequestId',
  'fmtError',
  'sanitizeValue',
  'ensurePathContainment',
  'checkAuth',
  'checkRateLimit',
  '_rateLimitStore',
  'sanitizeToolOutput',
  'main',
]);

function reservedToolSchemaBinding(name: string): string {
  return `${camelKey(name)}Schema`;
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
  const raw =
    str(props.description) ||
    (descNode ? str(getProps(descNode).text) || str(getProps(descNode).value) : undefined) ||
    '';
  return raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
}

function indent(code: string, spaces: number): string[] {
  const prefix = ' '.repeat(spaces);
  return code.split('\n').map((line) => (line.length > 0 ? `${prefix}${line}` : ''));
}

function splitCsv(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function helperBindings(node: IRNode): string[] {
  const props = getProps(node);
  if (node.type === 'import') {
    if (props.types === 'true' || props.types === true) return [];
    return [str(props.default), ...splitCsv(str(props.names))].filter((binding): binding is string => !!binding);
  }
  if (node.type === 'const' || node.type === 'fn') {
    const name = str(props.name);
    return name ? [name] : [];
  }
  return [];
}

function collectHelperFunctionBodies(helperNodes: IRNode[]): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const helperNode of helperNodes) {
    if (helperNode.type !== 'fn') continue;
    const name = str(getProps(helperNode).name);
    const handlerNode = getFirstChild(helperNode, 'handler');
    const code = handlerNode ? str(getProps(handlerNode).code) || '' : '';
    if (name && code) bodies.set(name, code);
  }
  return bodies;
}

function collectReachableHelperCode(entryCode: string, helperFunctionBodies: Map<string, string>): string {
  if (!entryCode) return '';
  const visited = new Set<string>();
  const chunks = [entryCode];
  const queue = [entryCode];

  while (queue.length > 0) {
    const current = queue.pop() || '';
    for (const [name, code] of helperFunctionBodies) {
      if (visited.has(name)) continue;
      if (!new RegExp(`\\b${escapeRegExp(name)}\\s*\\(`).test(current)) continue;
      visited.add(name);
      chunks.push(code);
      queue.push(code);
    }
  }

  return chunks.join('\n');
}

// ── Guard collection (from Codex — robust prop aliases) ─────────────────

function guardTarget(props: Record<string, unknown>): string | undefined {
  return str(props.param) || str(props.field) || str(props.target) || str(props.on);
}

function collectGuard(node: IRNode, fallbackAllowlist: string[]): GuardDefinition | null {
  const props = getProps(node);
  const kind = str(props.name) || str(props.kind) || str(props.type);
  const validKinds: GuardKind[] = [
    'sanitize',
    'pathContainment',
    'validate',
    'auth',
    'rateLimit',
    'sizeLimit',
    'sanitizeOutput',
    'urlValidation',
  ];
  if (!validKinds.includes(kind as GuardKind)) return null;
  const rawAllow = splitCsv(str(props.allowlist) || str(props.allow) || str(props.roots));
  return {
    kind: kind as GuardKind,
    target: guardTarget(props),
    pattern: str(props.pattern),
    replacement: str(props.replacement),
    min: str(props.min),
    max: str(props.max),
    regex: str(props.regex),
    baseDir: str(props.baseDir) || str(props.base) || str(props.root),
    allowlist: rawAllow.length > 0 ? rawAllow : fallbackAllowlist,
    envVar: str(props.envVar) || str(props.env),
    header: str(props.header),
    windowMs: str(props.windowMs) || str(props.window),
    maxRequests: str(props.maxRequests) || str(props.requests),
    maxBytes: str(props.maxBytes) || ((kind as GuardKind) === 'sizeLimit' ? str(props.max) : undefined),
    allowSchemes: splitCsv(str(props.allowSchemes) || str(props.schemes)),
    allowHosts: splitCsv(str(props.allowHosts) || str(props.hosts)),
  };
}

// ── Parameter categorization helpers (for auto-injection/guard scoping) ──

const CONTENT_PARAMS = /^(content|code|body|data|payload|text|source|script|html|markdown|template)$/i;
const PATH_PARAMS = /(?:^|[_A-Z])(?:path|file|dir(?:ectory)?|root|workspace)(?:$|[_A-Z])/i;

function isContentParam(name: string): boolean {
  return CONTENT_PARAMS.test(name);
}

function isPathLikeParam(name: string): boolean {
  return PATH_PARAMS.test(name);
}

const URL_PARAMS = /(?:^|[_A-Z])(?:url|uri|endpoint|href|link|origin|host)(?:$|[_A-Z])/i;

function isUrlLikeParam(name: string): boolean {
  return URL_PARAMS.test(name);
}

// ── Handler effect detection — auto-inject guards for effects found in handler code ──

// Effect patterns imported from ./effect-patterns.js

interface DetectedEffects {
  fileIO: boolean;
  shellExec: boolean;
  network: boolean;
}

function detectHandlerEffects(handlerCode: string): DetectedEffects {
  return {
    fileIO: FILE_IO_PATTERN.test(handlerCode),
    shellExec: SHELL_EXEC_PATTERN.test(handlerCode),
    network: NETWORK_PATTERN.test(handlerCode),
  };
}

/**
 * Auto-inject missing guards based on handler code effects.
 * If handler uses readFileSync but no param has pathContainment → inject on string params.
 * If handler uses exec but no param has sanitize → inject sanitize on string params.
 */
function autoInjectEffectGuards(
  params: ParamDefinition[],
  parentGuards: GuardDefinition[],
  effects: DetectedEffects,
  fallbackAllowlist: string[],
): void {
  const allGuards = [...params.flatMap((p) => p.guards), ...parentGuards];
  const stringParams = params.filter((p) => p.type === 'string');
  if (stringParams.length === 0) return;

  // File I/O without pathContainment → inject on all non-content string params
  if (effects.fileIO && !allGuards.some((g) => g.kind === 'pathContainment')) {
    for (const p of stringParams) {
      if (!p.guards.some((g) => g.kind === 'pathContainment') && !isContentParam(p.name)) {
        p.guards.push({ kind: 'pathContainment', target: p.name, allowlist: fallbackAllowlist });
      }
    }
  }

  // Shell exec without sanitize → inject on non-content string params
  if (effects.shellExec) {
    for (const p of stringParams) {
      if (!p.guards.some((g) => g.kind === 'sanitize') && !isContentParam(p.name)) {
        p.guards.push({ kind: 'sanitize', target: p.name, allowlist: [] });
      }
    }
  }

  // Network calls → inject urlValidation on URL-like params, sanitize on others
  if (effects.network) {
    for (const p of stringParams) {
      if (isUrlLikeParam(p.name) && !p.guards.some((g) => g.kind === 'urlValidation')) {
        p.guards.push({ kind: 'urlValidation', target: p.name, allowlist: [], allowSchemes: ['https', 'http'] });
      } else if (!p.guards.some((g) => g.kind === 'sanitize') && !isContentParam(p.name) && !isUrlLikeParam(p.name)) {
        p.guards.push({ kind: 'sanitize', target: p.name, allowlist: [] });
      }
    }
  }

  // JSON/object params → inject sizeLimit to prevent oversized payloads (defense-in-depth)
  const jsonParams = params.filter((p) => p.type === 'object' || p.type === 'json');
  for (const p of jsonParams) {
    if (!p.guards.some((g) => g.kind === 'sizeLimit')) {
      p.guards.push({ kind: 'sizeLimit', target: p.name, allowlist: [], maxBytes: '1048576' });
    }
  }
}

function collectParams(node: IRNode, fallbackAllowlist: string[]): ParamDefinition[] {
  const paramNodes = getChildren(node, 'param');
  const parentGuards = getChildren(node, 'guard')
    .map((g) => collectGuard(g, fallbackAllowlist))
    .filter((g): g is GuardDefinition => !!g);

  return paramNodes.map((paramNode) => {
    const props = getProps(paramNode);
    const name = str(props.name) || 'input';
    const type = str(props.type) || 'string';
    const guards = [
      ...getChildren(paramNode, 'guard')
        .map((g) => collectGuard(g, fallbackAllowlist))
        .filter((g): g is GuardDefinition => !!g),
      ...parentGuards.filter((g) => {
        if (g.target) return g.target === name;
        // Untargeted guard: apply to compatible types instead of silently dropping
        if (g.kind === 'pathContainment') return type === 'string' && !isContentParam(name);
        if (g.kind === 'sanitize') return type === 'string';
        if (g.kind === 'sizeLimit') return true; // works on string (byteLength) and non-string (JSON.stringify)
        return true; // validate applies to all types
      }),
    ];

    // Auto-inject pathContainment for path-like params (from Codex)
    if (!guards.some((g) => g.kind === 'pathContainment') && isPathLikeParam(name)) {
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
    case 'number':
    case 'float':
      expr = 'z.number()';
      break;
    case 'int':
    case 'integer':
      expr = 'z.number().int()';
      break;
    case 'boolean':
    case 'bool':
      expr = 'z.boolean()';
      break;
    case 'string[]':
      expr = 'z.array(z.string())';
      break;
    case 'number[]':
      expr = 'z.array(z.number())';
      break;
    case 'object':
    case 'json':
      expr = 'z.record(z.string(), z.unknown())';
      break;
    default:
      expr = 'z.string()';
      break;
  }

  // Apply validate guards — type-gated to prevent invalid Zod chains
  const isStringType = param.type === 'string' || !param.type || param.type === '';
  const isNumericType = ['number', 'float', 'int', 'integer'].includes(param.type);
  const isArrayType = param.type.endsWith('[]');
  const supportsMinMax = isStringType || isNumericType || isArrayType;

  for (const guard of param.guards.filter((g) => g.kind === 'validate')) {
    if (guard.min && !Number.isNaN(Number(guard.min)) && supportsMinMax) expr += `.min(${Number(guard.min)})`;
    if (guard.max && !Number.isNaN(Number(guard.max)) && supportsMinMax) expr += `.max(${Number(guard.max)})`;
    if (guard.regex && isStringType) {
      try {
        new RegExp(guard.regex);
        // Reject nested quantifiers to prevent ReDoS
        if (/([+*}])\s*\)\s*[+*{]/.test(guard.regex)) continue;
        expr += `.regex(new RegExp(${json(guard.regex)}))`;
      } catch {
        /* skip invalid regex */
      }
    }
  }

  // Apply inline min/max from param props — type-gated
  const pp = getProps(param.node);
  if (
    pp.min !== undefined &&
    !Number.isNaN(Number(pp.min)) &&
    supportsMinMax &&
    !param.guards.some((g) => g.kind === 'validate' && g.min)
  ) {
    expr += `.min(${Number(pp.min)})`;
  }
  if (
    pp.max !== undefined &&
    !Number.isNaN(Number(pp.max)) &&
    supportsMinMax &&
    !param.guards.some((g) => g.kind === 'validate' && g.max)
  ) {
    expr += `.max(${Number(pp.max)})`;
  }

  if (param.description) {
    expr += `.describe(${json(param.description)})`;
  }

  if (param.defaultValue !== undefined) {
    const t = param.type;
    const isNumeric = t === 'number' || t === 'float' || t === 'int' || t === 'integer';
    const dv = isNumeric
      ? Number.isNaN(Number(param.defaultValue))
        ? '0'
        : param.defaultValue
      : t === 'boolean' || t === 'bool'
        ? param.defaultValue === 'true'
          ? 'true'
          : 'false'
        : json(param.defaultValue);
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
    for (const guard of param.guards.filter((g) => g.kind === 'sanitize')) {
      const pattern = guard.pattern || '[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]';
      // Validate regex at transpile time and reject catastrophic patterns
      try {
        new RegExp(pattern);
        if (/([+*}])\s*\)\s*[+*{]/.test(pattern)) continue; // ReDoS prevention
      } catch {
        continue;
      }
      lines.push(`${accessor} = sanitizeValue(${accessor}, ${json(pattern)}, ${json(guard.replacement || '')});`);
    }
    const pathGuard = param.guards.find((g) => g.kind === 'pathContainment');
    if (pathGuard) {
      // Guard against undefined/null becoming the string "undefined"
      lines.push(
        `if (${accessor} == null || ${accessor} === "") throw new Error("${param.name} is required for path containment check");`,
      );
      const base = pathGuard.baseDir
        ? `path.resolve(${json(pathGuard.baseDir)}, String(${accessor}))`
        : `path.resolve(String(${accessor}))`;
      // Use guard-specific allowlist if set, otherwise fall back to global ALLOWED_PATHS
      const hasExplicitAllowlist =
        pathGuard.allowlist.length > 0 &&
        !(pathGuard.allowlist.length === 1 && pathGuard.allowlist[0] === 'process.cwd()');
      if (hasExplicitAllowlist) {
        const inlineList =
          `[${pathGuard.allowlist.map((v) => json(v)).join(', ')}]` +
          '.map(r => { try { return _realpathSync(r); } catch { return path.resolve(r); } })';
        lines.push(`${accessor} = ensurePathContainment(${base}, ${inlineList});`);
      } else {
        lines.push(`${accessor} = ensurePathContainment(${base}, ALLOWED_PATHS);`);
      }
    }
    // urlValidation guard — validate URL scheme and optionally host
    for (const guard of param.guards.filter((g) => g.kind === 'urlValidation')) {
      const schemes = guard.allowSchemes?.length ? guard.allowSchemes : ['https', 'http'];
      const schemeLiteral = `[${schemes.map((s) => json(s)).join(', ')}]`;
      lines.push(`if (typeof ${accessor} === "string") {`);
      lines.push(
        `  let _url: URL; try { _url = new URL(${accessor}); } catch { throw new Error("Invalid URL: " + ${accessor}); }`,
      );
      lines.push(
        `  if (!${schemeLiteral}.includes(_url.protocol.replace(":", ""))) throw new Error("URL scheme must be one of ${schemes.join(', ')}: " + ${accessor});`,
      );
      if (guard.allowHosts?.length) {
        const hostLiteral = `[${guard.allowHosts.map((h) => json(h)).join(', ')}]`;
        lines.push(
          `  if (!${hostLiteral}.includes(_url.hostname)) throw new Error("URL host not in allowlist: " + _url.hostname);`,
        );
      }
      lines.push(`}`);
    }
    // sizeLimit guard — check byte length for strings and serialized size for other types
    for (const guard of param.guards.filter((g) => g.kind === 'sizeLimit')) {
      const maxBytes = guard.maxBytes || guard.max || '1048576';
      lines.push(
        `if (typeof ${accessor} === "string" && Buffer.byteLength(${accessor}) > ${maxBytes}) throw new Error("Input ${param.name} exceeds size limit of ${maxBytes} bytes");`,
      );
      lines.push(
        `else if (${accessor} != null && typeof ${accessor} !== "string") { const _sz = JSON.stringify(${accessor}); if (_sz && Buffer.byteLength(_sz) > ${maxBytes}) throw new Error("Input ${param.name} exceeds size limit of ${maxBytes} bytes"); }`,
      );
    }
  }
  return lines;
}

/** Emit tool-level (non-param) guard lines — auth and rateLimit apply per-tool, not per-param. */
function emitToolGuardLines(node: IRNode): { pre: string[]; helpers: Set<string>; sanitizeOutput: boolean } {
  const guards = getChildren(node, 'guard');
  const pre: string[] = [];
  const helpers = new Set<string>();
  let sanitizeOutput = false;

  for (const g of guards) {
    const props = getProps(g);
    const kind = str(props.name) || str(props.kind) || str(props.type);

    if (kind === 'auth') {
      const envVar = str(props.envVar) || str(props.env) || 'MCP_AUTH_TOKEN';
      const header = str(props.header) || 'authorization';
      helpers.add('auth');
      pre.push(`checkAuth(${json(envVar)}, ${json(header)}, extra);`);
    }

    if (kind === 'rateLimit') {
      const windowMs = str(props.windowMs) || str(props.window) || '60000';
      const maxReqs = str(props.maxRequests) || str(props.requests) || '100';
      helpers.add('rateLimit');
      pre.push(`checkRateLimit(${json(str(getProps(node).name) || 'tool')}, ${windowMs}, ${maxReqs}, extra);`);
    }

    if (kind === 'sanitizeOutput') {
      sanitizeOutput = true;
      helpers.add('sanitizeOutput');
    }
  }

  return { pre, helpers, sanitizeOutput };
}

// ── Tool / Resource / Prompt emission ───────────────────────────────────

function emitTool(
  node: IRNode,
  fallbackAllowlist: string[],
  requiredHelpers: Set<string>,
  customDiagnostics: TranspileDiagnostic[],
  helperFunctionBodies: Map<string, string>,
): string[] {
  const name = str(getProps(node).name) || 'tool';
  const description = extractDescription(node) || `Run ${name}`;
  const params = collectParams(node, fallbackAllowlist);
  const handlerNode = getFirstChild(node, 'handler');
  const handlerCode = handlerNode ? str(getProps(handlerNode).code) || '' : '';
  const analyzedHandlerCode = collectReachableHelperCode(handlerCode, helperFunctionBodies);

  // Diagnostic: missing handler
  if (!handlerCode) {
    customDiagnostics.push({
      nodeType: 'tool',
      outcome: 'suppressed',
      target: 'mcp',
      loc: node.loc ? { line: node.loc.line, col: node.loc.col } : undefined,
      severity: 'error',
      message: `Tool "${name}" has no handler — add handler <<<...>>>`,
      reason: 'no-handler',
    });
  }

  // Auto-inject guards based on handler effects (secure by construction)
  const effects = detectHandlerEffects(analyzedHandlerCode);
  const parentGuards = getChildren(node, 'guard')
    .map((g) => collectGuard(g, fallbackAllowlist))
    .filter((g): g is GuardDefinition => !!g);
  autoInjectEffectGuards(params, parentGuards, effects, fallbackAllowlist);

  // Auto-inject sanitizeOutput without mutating the IR tree
  const autoSanitizeOutput =
    effects.network && !getChildren(node, 'guard').some((g) => str(getProps(g).type) === 'sanitizeOutput');

  const toolGuards = emitToolGuardLines(node);
  if (autoSanitizeOutput) {
    toolGuards.sanitizeOutput = true;
    toolGuards.helpers.add('sanitizeOutput');
  }
  for (const h of toolGuards.helpers) requiredHelpers.add(h);

  // Detect sampling/elicitation children — if present, handler gets extra context
  const hasSampling = getFirstChild(node, 'sampling') !== undefined;
  const hasElicitation = getFirstChild(node, 'elicitation') !== undefined;
  const needsContext =
    hasSampling || hasElicitation || toolGuards.helpers.has('auth') || toolGuards.helpers.has('rateLimit');

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

  lines.push(
    `server.tool(${json(name)}, ${json(description)}, ${params.length > 0 ? `${camelKey(name)}Schema` : '{}'}, async (_raw_input${needsContext ? ', extra' : ''}) => {`,
  );
  lines.push(`  const requestId = nextRequestId();`);
  lines.push(`  logger.info("tool:call", { requestId, tool: ${json(name)} });`);
  lines.push(`  try {`);

  // Tool-level guards (auth, rateLimit)
  for (const line of toolGuards.pre) {
    lines.push(`    ${line}`);
  }

  // Always declare params and args — handler code can reference either consistently
  if (params.length > 0) {
    lines.push(`    const params = { ..._raw_input } as Record<string, unknown>;`);
    const hasRuntimeGuards = params.some((p) =>
      p.guards.some(
        (g) =>
          g.kind === 'sanitize' || g.kind === 'pathContainment' || g.kind === 'sizeLimit' || g.kind === 'urlValidation',
      ),
    );
    if (hasRuntimeGuards) {
      for (const line of emitGuardLines(params)) {
        lines.push(`    ${line}`);
      }
    }
    lines.push(`    const args = params as typeof _raw_input;`);
  } else {
    lines.push(`    const params = { ...(_raw_input ?? {}) } as Record<string, unknown>;`);
    lines.push(`    const args = params as Record<string, unknown>;`);
  }

  // Inject sampling/elicitation context helpers
  if (hasSampling) {
    const samplingNode = getFirstChild(node, 'sampling')!;
    const sp = getProps(samplingNode);
    const maxTokens = str(sp.maxTokens) || '500';
    lines.push(`    // Sampling — request LLM completion from the client`);
    lines.push(`    // SDK v1: server.server.createMessage() | SDK v2: ctx.mcpReq.requestSampling()`);
    lines.push(`    async function requestSampling(prompt: string): Promise<string> {`);
    lines.push(`      const response = await server.server.createMessage({`);
    lines.push(`        messages: [{ role: "user", content: { type: "text", text: prompt } }],`);
    lines.push(`        maxTokens: ${maxTokens},`);
    lines.push(`      });`);
    lines.push(
      `      return response.content.type === "text" ? response.content.text : JSON.stringify(response.content);`,
    );
    lines.push(`    }`);
  }

  if (hasElicitation) {
    const elicitNode = getFirstChild(node, 'elicitation')!;
    const ep = getProps(elicitNode);
    const elicitMessage = str(ep.message) || str(ep.text) || 'Please provide input';
    lines.push(`    // Elicitation — request structured user input`);
    lines.push(`    // SDK v1: server.server.elicitInput() | SDK v2: ctx.mcpReq.elicitInput()`);
    lines.push(
      `    async function requestInput(message = ${json(elicitMessage)}): Promise<Record<string, unknown> | null> {`,
    );
    lines.push(
      `      const result = await server.server.elicitInput({ mode: "form", message, requestedSchema: { type: "object", properties: {} } });`,
    );
    lines.push(`      return result.action === "accept" ? (result.content || {}) : null;`);
    lines.push(`    }`);
  }

  // Always wrap handler code in async IIFE when it contains return statements —
  // prevents bare return in the server.tool callback from bypassing error handling.
  // sanitizeOutput wraps the result additionally.
  const handlerHasReturn = handlerCode && /\breturn\b/.test(handlerCode);

  if (toolGuards.sanitizeOutput) {
    lines.push(`    const _rawResult = await (async () => {`);
    if (handlerCode) {
      lines.push(...indent(handlerCode, 6));
    } else {
      lines.push(`      return { content: [{ type: "text" as const, text: ${json(`${name} completed`)} }] };`);
    }
    lines.push(`    })();`);
    lines.push(`    return sanitizeToolOutput(_rawResult);`);
  } else if (handlerHasReturn) {
    // Wrap in IIFE so return works correctly inside try/catch
    lines.push(`    return await (async () => {`);
    lines.push(...indent(handlerCode, 6));
    lines.push(`    })();`);
  } else {
    if (handlerCode) {
      lines.push(...indent(handlerCode, 4));
    } else {
      lines.push(`    return { content: [{ type: "text" as const, text: ${json(`${name} completed`)} }] };`);
    }
  }
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

  const uriArg = hasTemplate ? `new ResourceTemplate(${json(uri)}, { list: undefined })` : json(uri);

  lines.push(
    `server.resource(${json(name)}, ${uriArg}, async (uri: URL${hasTemplate ? ', variables: Record<string, string>' : ''}) => {`,
  );
  lines.push(`  logger.info("resource:read", { resource: ${json(name)}, uri: uri.href });`);
  lines.push(`  try {`);

  if (params.length > 0) {
    lines.push(`    const params = { ...(${hasTemplate ? 'variables' : '{}'}) } as Record<string, unknown>;`);
    for (const line of emitGuardLines(params)) {
      lines.push(`    ${line}`);
    }
    lines.push(`    const args = params;`);
  } else {
    lines.push(`    const args = ${hasTemplate ? 'variables ?? {}' : '{}'};`);
  }

  if (handlerCode) {
    lines.push(...indent(handlerCode, 4));
  } else {
    lines.push(`    return { contents: [{ uri: uri.href, text: ${json(`${name} content`)} }] };`);
  }
  lines.push(`  } catch (error) {`);
  lines.push(`    logger.error("resource:error", { resource: ${json(name)}, error: fmtError(error) });`);
  lines.push(`    throw error;`);
  lines.push(`  }`);
  lines.push(`});`);
  return lines;
}

function emitPrompt(node: IRNode, fallbackAllowlist: string[]): string[] {
  const name = str(getProps(node).name) || 'prompt';
  const description = extractDescription(node);
  const _paramNodes = getChildren(node, 'param');
  const params = collectParams(node, fallbackAllowlist);
  const handlerNode = getFirstChild(node, 'handler');
  const handlerCode = handlerNode ? str(getProps(handlerNode).code) || '' : '';

  const lines: string[] = [];
  if (description) lines.push(`// ${description}`);

  if (params.length > 0) {
    lines.push(`server.prompt(${json(name)}, ${json(description || name)}, {`);
    for (const param of params) {
      lines.push(`  ${json(param.name)}: z.string()${param.optional ? '.optional()' : ''},`);
    }
    lines.push(`}, async (args: Record<string, string>) => {`);
  } else {
    lines.push(`server.prompt(${json(name)}, ${json(description || name)}, async (args: Record<string, string>) => {`);
  }
  lines.push(`  const requestId = nextRequestId();`);
  lines.push(`  logger.info("prompt:call", { requestId, prompt: ${json(name)} });`);
  lines.push(`  try {`);
  lines.push(`    const params = args;`);

  // Apply guards to prompt params (Bug 4 fix)
  if (params.length > 0) {
    for (const line of emitGuardLines(params)) {
      lines.push(`    ${line}`);
    }
  }

  if (handlerCode) {
    lines.push(...indent(handlerCode, 4));
  } else {
    lines.push(
      `    return { messages: [{ role: "user" as const, content: { type: "text" as const, text: ${json(`${name} prompt`)} } }] };`,
    );
  }

  lines.push(`  } catch (error) {`);
  lines.push(`    logger.error("prompt:error", { requestId, prompt: ${json(name)}, error: fmtError(error) });`);
  lines.push(
    `    return { messages: [{ role: "user" as const, content: { type: "text" as const, text: fmtError(error) } }] };`,
  );
  lines.push(`  }`);
  lines.push(`});`);
  return lines;
}

// ── Main transpiler ─────────────────────────────────────────────────────

function buildCode(
  root: IRNode,
  _config?: KernConfig | ResolvedKernConfig,
): {
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
  const usingDefaultAllowlist = rawAllow.length === 0;

  const toolNodes = getChildren(container, 'tool');
  const resourceNodes = getChildren(container, 'resource');
  const promptNodes = getChildren(container, 'prompt');
  const helperNodes = (container.children || []).filter((child) => MCP_HELPER_NODE_TYPES.has(child.type));
  const customDiagnostics: TranspileDiagnostic[] = [];
  const emittedHelperNodes: IRNode[] = [];
  const seenHelperBindings = new Map<string, string>();
  const generatedBindings = new Set<string>(RESERVED_MCP_TS_BINDINGS);

  for (const toolNode of toolNodes) {
    const toolName = str(getProps(toolNode).name);
    if (toolName) generatedBindings.add(reservedToolSchemaBinding(toolName));
  }

  for (const helperNode of helperNodes) {
    const bindings = helperBindings(helperNode);
    const reservedBindings = bindings.filter((binding) => generatedBindings.has(binding));
    const duplicateBindings = bindings.filter((binding) => seenHelperBindings.has(binding));

    if (reservedBindings.length > 0 || duplicateBindings.length > 0) {
      accountNode(accounted, helperNode, 'suppressed', 'helper-binding-conflict', true);
      customDiagnostics.push({
        nodeType: helperNode.type,
        outcome: 'suppressed',
        target: 'mcp',
        loc: helperNode.loc ? { line: helperNode.loc.line, col: helperNode.loc.col } : undefined,
        severity: 'error',
        message: `MCP helper ${helperNode.type} conflicts with existing bindings: ${[
          ...reservedBindings,
          ...duplicateBindings,
        ].join(', ')}. Rename the helper binding.`,
        reason: 'helper-binding-conflict',
      });
      continue;
    }

    for (const binding of bindings) {
      seenHelperBindings.set(binding, helperNode.type);
    }
    emittedHelperNodes.push(helperNode);
    accountNode(accounted, helperNode, 'expressed', `mcp helper ${helperNode.type}`, true);
  }
  const helperFunctionBodies = collectHelperFunctionBodies(emittedHelperNodes);

  // Track all children
  for (const n of [...toolNodes, ...resourceNodes, ...promptNodes]) {
    accountNode(accounted, n, 'expressed', `mcp ${n.type}`, true);
  }

  // Determine if we need path import and ResourceTemplate — scan ALL node types, not just tools
  const allNodes = [...toolNodes, ...resourceNodes, ...promptNodes];
  const allGuards = allNodes.flatMap((n) => getChildren(n, 'guard'));
  const allParams = allNodes.flatMap((n) => collectParams(n, allowlist));

  // Pre-scan: detect which helpers auto-injection will need (S5-4 fix)
  const autoInjectedGuardKinds = new Set<string>();
  for (const toolNode of toolNodes) {
    const preParams = collectParams(toolNode, allowlist);
    const hNode = getFirstChild(toolNode, 'handler');
    const hCode = hNode ? str(getProps(hNode).code) || '' : '';
    if (hCode) {
      const eff = detectHandlerEffects(collectReachableHelperCode(hCode, helperFunctionBodies));
      const pGuards = getChildren(toolNode, 'guard')
        .map((g) => collectGuard(g, allowlist))
        .filter((g): g is GuardDefinition => !!g);
      autoInjectEffectGuards(preParams, pGuards, eff, allowlist);
      for (const p of preParams) {
        for (const g of p.guards) autoInjectedGuardKinds.add(g.kind);
      }
    }
  }

  const needsPath =
    allGuards.some((g) => str(getProps(g).type) === 'pathContainment' || str(getProps(g).kind) === 'pathContainment') ||
    allParams.some((p) => p.guards.some((g) => g.kind === 'pathContainment')) ||
    autoInjectedGuardKinds.has('pathContainment');
  const needsResourceTemplate = resourceNodes.some((r) => (str(getProps(r).uri) || '').includes('{'));

  const transportType = str(props.transport) || 'stdio';
  const _needsSizeLimit = allParams.some((p) => p.guards.some((g) => g.kind === 'sizeLimit'));

  const allowlistLiteral = `[${allowlist.map((v) => (v === 'process.cwd()' ? 'process.cwd()' : json(v))).join(', ')}]`;
  const sourceMap: SourceMapEntry[] = [];
  const lines: string[] = [];
  const helperImportLines: string[] = [];
  const helperDeclarationLines: string[] = [];

  for (const helperNode of emittedHelperNodes) {
    const emitted = generateCoreNode(helperNode, 'mcp');
    if (emitted.length === 0) continue;
    const targetLines = helperNode.type === 'import' ? helperImportLines : helperDeclarationLines;
    if (targetLines.length > 0) targetLines.push('');
    targetLines.push(...emitted);
  }

  // ── Imports
  if (needsResourceTemplate) {
    lines.push(`import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";`);
  } else {
    lines.push(`import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";`);
  }
  if (transportType === 'stdio') {
    lines.push(`import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";`);
  }
  lines.push(`import { z } from "zod";`);
  if (needsPath) {
    lines.push(`import path from "node:path";`);
    lines.push(`import { realpathSync as _realpathSync } from "node:fs";`);
  }
  if (helperImportLines.length > 0) {
    lines.push(...helperImportLines);
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
    lines.push(
      `const ALLOWED_PATHS = ${allowlistLiteral}.map(r => { try { return _realpathSync(r); } catch { return path.resolve(r); } });`,
    );
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

  if (allParams.some((p) => p.guards.some((g) => g.kind === 'sanitize')) || autoInjectedGuardKinds.has('sanitize')) {
    lines.push(`function sanitizeValue(value: unknown, pattern: string, replacement: string): unknown {`);
    lines.push(`  if (typeof value !== "string") return value;`);
    lines.push(`  try { return value.replace(new RegExp(pattern, "g"), replacement); }`);
    lines.push(`  catch { return value; }`);
    lines.push(`}`);
    lines.push('');
  }

  if (needsPath) {
    lines.push(`function ensurePathContainment(candidate: string, allowlist: string[]): string {`);
    lines.push(`  let resolved: string;`);
    lines.push(`  try { resolved = _realpathSync(candidate); } catch { resolved = path.resolve(candidate); }`);
    lines.push('  const ok = allowlist.some(root => resolved === root || resolved.startsWith(`${root}${path.sep}`));');
    lines.push(`  if (!ok) throw new Error("Path escapes allowed directories: " + candidate);`);
    lines.push(`  return resolved;`);
    lines.push(`}`);
    lines.push('');
  }

  if (helperDeclarationLines.length > 0) {
    lines.push(...helperDeclarationLines);
    lines.push('');
  }

  // ── Registrations (collect required helpers from tool guards)
  const requiredHelpers = new Set<string>();
  for (const toolNode of toolNodes) {
    sourceMap.push({
      irLine: toolNode.loc?.line || 0,
      irCol: toolNode.loc?.col || 1,
      outLine: lines.length + 1,
      outCol: 1,
    });
    lines.push(...emitTool(toolNode, allowlist, requiredHelpers, customDiagnostics, helperFunctionBodies), '');
  }
  for (const resourceNode of resourceNodes) {
    sourceMap.push({
      irLine: resourceNode.loc?.line || 0,
      irCol: resourceNode.loc?.col || 1,
      outLine: lines.length + 1,
      outCol: 1,
    });
    lines.push(...emitResource(resourceNode, allowlist), '');
  }
  for (const promptNode of promptNodes) {
    sourceMap.push({
      irLine: promptNode.loc?.line || 0,
      irCol: promptNode.loc?.col || 1,
      outLine: lines.length + 1,
      outCol: 1,
    });
    lines.push(...emitPrompt(promptNode, allowlist), '');
  }

  // ── Info diagnostics for guard quality (S3-12/13/14)
  if (usingDefaultAllowlist && needsPath) {
    customDiagnostics.push({
      nodeType: 'mcp',
      outcome: 'expressed',
      target: 'mcp',
      severity: 'info',
      message:
        'No explicit allowlist — using process.cwd() which may not match workspace root. Set allowlist in .kern file for production.',
    });
  }

  // ── Inject auth/rateLimit helpers if any tool uses them (after registrations so we know what's needed)
  const helperBlock: string[] = [];
  if (requiredHelpers.has('auth')) {
    if (transportType === 'stdio') {
      // stdio is trusted-local — no caller identity available
      customDiagnostics.push({
        nodeType: 'guard',
        outcome: 'expressed',
        target: 'mcp',
        severity: 'warning',
        message:
          'Auth guard on stdio transport is config-only — verifies env var exists, cannot authenticate callers. Use HTTP/SSE transport for real auth.',
      });
      helperBlock.push(`// WARNING: stdio transport — auth is config-only, not caller verification.`);
      helperBlock.push(`// Switch to transport=http or transport=sse for real authentication via MCP session.`);
      helperBlock.push(`function checkAuth(envVar: string, _header: string, _extra?: Record<string, unknown>): void {`);
      helperBlock.push(`  const token = process.env[envVar];`);
      helperBlock.push(
        `  if (!token) throw new Error("Server not configured: set " + envVar + " environment variable");`,
      );
      helperBlock.push(`}`);
    } else {
      // HTTP/SSE — real caller authentication via MCP session
      helperBlock.push(`function checkAuth(envVar: string, _header: string, extra?: Record<string, unknown>): void {`);
      helperBlock.push(`  // Verify caller via MCP session authInfo (HTTP/SSE transport)`);
      helperBlock.push(`  const authInfo = (extra as any)?.authInfo;`);
      helperBlock.push(`  if (authInfo) {`);
      helperBlock.push(`    if (!authInfo.token) throw new Error("Authentication required: no token in session");`);
      helperBlock.push(
        `    if (authInfo.expiresAt && authInfo.expiresAt < Date.now() / 1000) throw new Error("Authentication token expired");`,
      );
      helperBlock.push(`    return;`);
      helperBlock.push(`  }`);
      helperBlock.push(`  // Fallback: verify server configuration`);
      helperBlock.push(`  const token = process.env[envVar];`);
      helperBlock.push(
        `  if (!token) throw new Error("Authentication required: set " + envVar + " or configure MCP auth");`,
      );
      helperBlock.push(`}`);
    }
    helperBlock.push('');
  }
  if (requiredHelpers.has('rateLimit')) {
    helperBlock.push(`const _rateLimitStore = new Map<string, { count: number; resetAt: number }>();`);
    helperBlock.push(
      `function checkRateLimit(toolName: string, windowMs: number, maxRequests: number, extra?: Record<string, unknown>): void {`,
    );
    helperBlock.push(
      `  const sessionId = (extra as any)?.sessionId || (extra as any)?.authInfo?.clientId || "global";`,
    );
    helperBlock.push('  const key = `${sessionId}:${toolName}`;');
    helperBlock.push(`  const now = Date.now();`);
    helperBlock.push(`  const entry = _rateLimitStore.get(key);`);
    helperBlock.push(`  if (!entry || now > entry.resetAt) {`);
    helperBlock.push(`    _rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });`);
    helperBlock.push(`    return;`);
    helperBlock.push(`  }`);
    helperBlock.push(`  entry.count++;`);
    helperBlock.push(
      `  if (entry.count > maxRequests) throw new Error(\`Rate limit exceeded for \${toolName}: \${maxRequests} requests per \${windowMs}ms\`);`,
    );
    helperBlock.push(`}`);
    helperBlock.push('');
  }
  if (requiredHelpers.has('sanitizeOutput')) {
    helperBlock.push(`/** Strip prompt injection markers from tool output — defense against indirect injection. */`);
    helperBlock.push(
      `function sanitizeToolOutput<T extends { content: Array<{ type: "text"; text: string }> }>(result: T): T {`,
    );
    helperBlock.push(`  const INJECTION_PATTERNS = [`);
    helperBlock.push(
      `    /\\b(?:ignore|disregard|forget)\\s+(?:all\\s+)?(?:previous|above|prior)\\s+instructions?/gi,`,
    );
    helperBlock.push(`    /\\b(?:you\\s+are|act\\s+as|pretend\\s+to\\s+be|roleplay\\s+as)\\b/gi,`);
    helperBlock.push(`    /\\b(?:system\\s*prompt|\\<\\/?(?:system|user|assistant)\\>)/gi,`);
    helperBlock.push(`    /\\[(?:INST|SYS|\\/?SYSTEM)\\]/gi,`);
    helperBlock.push(`  ];`);
    helperBlock.push(`  return {`);
    helperBlock.push(`    ...result,`);
    helperBlock.push(`    content: result.content.map(c => {`);
    helperBlock.push(`      if (c.type !== "text") return c;`);
    helperBlock.push(`      let text = c.text;`);
    helperBlock.push(`      for (const pattern of INJECTION_PATTERNS) text = text.replace(pattern, "[FILTERED]");`);
    helperBlock.push(`      return { ...c, text };`);
    helperBlock.push(`    }) as T["content"],`);
    helperBlock.push(`  };`);
    helperBlock.push(`}`);
    helperBlock.push('');
  }
  // Insert helpers before registrations
  if (helperBlock.length > 0) {
    const insertIdx = lines.findIndex(
      (l) => l.includes('server.tool(') || l.includes('server.resource(') || l.includes('server.prompt('),
    );
    if (insertIdx >= 0) {
      lines.splice(insertIdx, 0, ...helperBlock);
    } else {
      lines.push(...helperBlock);
    }
  }

  // ── Transport detection — check mcp node for transport prop
  const transport = str(props.transport) || 'stdio';
  const port = str(props.port) || '3000';

  // ── Main entrypoint
  lines.push(`async function main(): Promise<void> {`);
  lines.push(
    `  logger.info("server:start", { server: ${json(serverName)}, version: ${json(serverVersion)}, transport: ${json(transport)} });`,
  );

  if (transport === 'http' || transport === 'streamable-http') {
    lines.push(
      `  const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");`,
    );
    lines.push(`  const _express = (await import("express")).default;`);
    lines.push(`  const app = _express();`);
    lines.push(`  app.use(_express.json());`);
    lines.push(`  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });`);
    lines.push(`  await server.connect(transport);`);
    lines.push(`  app.post("/mcp", async (req, res) => {`);
    lines.push(`    await transport.handleRequest(req, res, req.body);`);
    lines.push(`  });`);
    lines.push(`  app.listen(${port}, () => logger.info("server:listening", { port: ${port} }));`);
  } else {
    lines.push(`  const transport = new StdioServerTransport();`);
    lines.push(`  await server.connect(transport);`);
  }

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
    diagnostics: [...buildDiagnostics(root, accounted, 'mcp'), ...customDiagnostics],
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
    sourceMap:
      sourceMap.length > 0
        ? sourceMap
        : [{ irLine: root.loc?.line || 0, irCol: root.loc?.col || 1, outLine: 1, outCol: 1 }],
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
