import type {
  AccountedEntry,
  IRNode,
  KernConfig,
  ResolvedKernConfig,
  SourceMapEntry,
  TranspileDiagnostic,
  TranspileResult,
} from '@kernlang/core';
import { PY_FILE_IO_PATTERN, PY_SHELL_EXEC_PATTERN, PY_NETWORK_PATTERN } from './effect-patterns.js';
import {
  accountNode,
  buildDiagnostics,
  countTokens,
  getChildren,
  getFirstChild,
  getProps,
  serializeIR,
} from '@kernlang/core';

// ── Helpers ─────────────────────────────────────────────────────────────

function pyStr(value: string): string {
  return JSON.stringify(value);
}

function str(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function findMcpNode(root: IRNode): IRNode | undefined {
  if (root.type === 'mcp') return root;
  for (const child of root.children || []) {
    const found = findMcpNode(child);
    if (found) return found;
  }
  return undefined;
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

function ind(lines: string[], spaces: number): string[] {
  const prefix = ' '.repeat(spaces);
  return lines.map((line) => (line.length > 0 ? `${prefix}${line}` : ''));
}

function splitCsv(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Find a handler node appropriate for Python output.
 *  - handler with lang=python → use it
 *  - handler with no lang → TypeScript-only, skip for Python
 *  - handler with lang=<other> → skip
 *  Returns the Python handler code, or '' if none found. */
function findPythonHandler(node: IRNode): string {
  const handlers = getChildren(node, 'handler');
  // First look for an explicit lang=python handler
  for (const h of handlers) {
    const lang = str(getProps(h).lang);
    if (lang === 'python' || lang === 'py') {
      return str(getProps(h).code) || '';
    }
  }
  // No Python handler found — all handlers are either TS-only or absent
  return '';
}

// ── Python type mapping ─────────────────────────────────────────────────

function pyType(kernType: string): string {
  switch (kernType) {
    case 'number':
    case 'float':
      return 'float';
    case 'int':
    case 'integer':
      return 'int';
    case 'boolean':
    case 'bool':
      return 'bool';
    case 'string':
      return 'str';
    case 'string[]':
      return 'list[str]';
    case 'number[]':
      return 'list[float]';
    case 'object':
    case 'json':
      return 'dict';
    default:
      return 'str';
  }
}

// ── Guard code generation ───────────────────────────────────────────────

function emitPyGuards(node: IRNode, syntheticGuards: IRNode[] = []): string[] {
  const guards = [...getChildren(node, 'guard'), ...syntheticGuards];
  const toolName = str(getProps(node).name) || 'unknown';
  const lines: string[] = [];

  for (const g of guards) {
    const props = getProps(g);
    const kind = str(props.name) || str(props.kind) || str(props.type);
    const param = str(props.param) || str(props.target) || str(props.field);

    if (kind === 'sanitize' && param) {
      const pattern = str(props.pattern) || '[\\x00-\\x1f\\x7f]';
      const replacement = str(props.replacement) || '';
      // Validate regex and reject catastrophic patterns
      try {
        new RegExp(pattern);
        if (/([+*}])\s*\)\s*[+*{]/.test(pattern)) continue;
      } catch {
        continue;
      }
      lines.push(`    try:`);
      lines.push(`        ${param} = re.sub(r${pyStr(pattern)}, ${pyStr(replacement)}, str(${param}))`);
      lines.push(`    except re.error:`);
      lines.push(`        pass`);
    }

    if (kind === 'pathContainment' && param) {
      const allowRaw = splitCsv(str(props.allowlist) || str(props.allow));
      const allowPy = allowRaw.length > 0 ? `[${allowRaw.map((a) => pyStr(a)).join(', ')}]` : '[os.getcwd()]';
      lines.push(`    _resolved = os.path.realpath(str(${param}))`);
      lines.push(
        `    if not any(_resolved == os.path.realpath(d) or _resolved.startswith(os.path.realpath(d) + os.sep) for d in ${allowPy}):`,
      );
      lines.push(`        raise ValueError(f"Path escapes allowed directories: {${param}}")`);
      lines.push(`    ${param} = _resolved`);
    }

    if (kind === 'validate' && param) {
      if (props.min !== undefined && !Number.isNaN(Number(props.min)))
        lines.push(`    if ${param} < ${props.min}: raise ValueError("${param} below minimum ${props.min}")`);
      if (props.max !== undefined && !Number.isNaN(Number(props.max)))
        lines.push(`    if ${param} > ${props.max}: raise ValueError("${param} above maximum ${props.max}")`);
    }

    if (kind === 'auth') {
      const envVar = str(props.envVar) || str(props.env) || 'MCP_AUTH_TOKEN';
      lines.push(`    if not os.environ.get(${pyStr(envVar)}):`);
      lines.push(`        raise PermissionError(f"Authentication required: set ${envVar}")`);
    }

    if (kind === 'rateLimit') {
      const windowMs = parseInt(str(props.window) || '60000', 10) || 60000;
      const maxReqs = parseInt(str(props.requests) || str(props.maxRequests) || '100', 10) || 100;
      lines.push(`    _check_rate_limit(${pyStr(toolName)}, ${windowMs}, ${maxReqs})`);
    }

    if (kind === 'sizeLimit' && param) {
      const maxBytes = str(props.maxBytes) || str(props.max) || '1048576';
      lines.push(`    if isinstance(${param}, str) and len(${param}.encode()) > ${maxBytes}:`);
      lines.push(`        raise ValueError(f"${param} exceeds size limit of ${maxBytes} bytes")`);
      lines.push(`    elif ${param} is not None and not isinstance(${param}, str):`);
      lines.push(`        import json as _j`);
      lines.push(`        if len(_j.dumps(${param}).encode()) > ${maxBytes}:`);
      lines.push(`            raise ValueError(f"${param} exceeds size limit of ${maxBytes} bytes")`);
    }
  }

  return lines;
}

// ── Main Python transpiler ──────────────────────────────────────────────

function buildPythonCode(
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

  const toolNodes = getChildren(container, 'tool');
  const resourceNodes = getChildren(container, 'resource');
  const promptNodes = getChildren(container, 'prompt');

  for (const n of [...toolNodes, ...resourceNodes, ...promptNodes]) {
    accountNode(accounted, n, 'expressed', `mcp ${n.type}`, true);
  }

  const customDiagnostics: TranspileDiagnostic[] = [];

  // Check what imports we need — match prop priority: name > kind > type (same as emitPyGuards)
  const allGuards = [...toolNodes, ...resourceNodes, ...promptNodes].flatMap((n) => getChildren(n, 'guard'));
  const guardKind = (g: IRNode) => str(getProps(g).name) || str(getProps(g).kind) || str(getProps(g).type);

  // Pre-scan handlers for effect-based auto-injection (determines imports + sanitizeOutput)
  const willAutoInjectOs = toolNodes.some((n) => {
    const hCode = findPythonHandler(n);
    const existingKinds = new Set(getChildren(n, 'guard').map((g) => guardKind(g)));
    return hCode && PY_FILE_IO_PATTERN.test(hCode) && !existingKinds.has('pathContainment');
  });
  const willAutoInjectRe = toolNodes.some((n) => {
    const hCode = findPythonHandler(n);
    return hCode && PY_SHELL_EXEC_PATTERN.test(hCode);
  });

  const needsRe = willAutoInjectRe || allGuards.some((g) => guardKind(g) === 'sanitize');
  const needsOs =
    willAutoInjectOs ||
    allGuards.some((g) => {
      const k = guardKind(g);
      return k === 'pathContainment' || k === 'auth';
    });
  const needsRateLimit = allGuards.some((g) => guardKind(g) === 'rateLimit');
  let needsSanitizeOutput =
    allGuards.some((g) => guardKind(g) === 'sanitizeOutput') ||
    toolNodes.some((n) => {
      const hCode = findPythonHandler(n);
      return hCode && PY_NETWORK_PATTERN.test(hCode);
    });

  const transport = str(props.transport) || 'stdio';
  const sourceMap: SourceMapEntry[] = [];
  const lines: string[] = [];

  // ── Imports
  lines.push(`"""${serverName} — Generated by KERN MCP transpiler."""`);
  lines.push('');
  lines.push('import logging');
  if (needsOs) lines.push('import os');
  if (needsRe || needsSanitizeOutput) lines.push('import re');
  if (needsRateLimit) lines.push('import time');
  lines.push('');
  lines.push('from mcp.server.fastmcp import FastMCP');
  lines.push('from mcp.shared.exceptions import McpError');
  lines.push('from mcp.types import INTERNAL_ERROR');
  lines.push('');

  // ── Server
  lines.push(`mcp = FastMCP(${pyStr(serverName)})`);
  lines.push('');
  lines.push(`logger = logging.getLogger(${pyStr(serverName)})`);
  lines.push('');
  lines.push('class _JsonFormatter(logging.Formatter):');
  lines.push('    def format(self, record: logging.LogRecord) -> str:');
  lines.push('        import json as _json');
  lines.push(
    '        entry = {"level": record.levelname.lower(), "event": record.getMessage(), "ts": self.formatTime(record)}',
  );
  lines.push('        if hasattr(record, "tool"): entry["tool"] = record.tool');
  lines.push('        if hasattr(record, "error"): entry["error"] = record.error');
  lines.push('        if hasattr(record, "resource"): entry["resource"] = record.resource');
  lines.push('        if hasattr(record, "prompt"): entry["prompt"] = record.prompt');
  lines.push('        return _json.dumps(entry)');
  lines.push('');
  lines.push('_handler = logging.StreamHandler()');
  lines.push('_handler.setFormatter(_JsonFormatter())');
  lines.push('logger.addHandler(_handler)');
  lines.push('logger.setLevel(logging.INFO)');
  lines.push('');

  if (needsRateLimit) {
    lines.push('_rate_limit_store: dict[str, dict] = {}');
    lines.push('');
    lines.push('');
    lines.push('def _check_rate_limit(tool_name: str, window_ms: int, max_requests: int) -> None:');
    lines.push('    now = time.time() * 1000');
    lines.push('    entry = _rate_limit_store.get(tool_name)');
    lines.push('    if entry is None or now > entry["reset_at"]:');
    lines.push('        _rate_limit_store[tool_name] = {"count": 1, "reset_at": now + window_ms}');
    lines.push('        return');
    lines.push('    entry["count"] += 1');
    lines.push('    if entry["count"] > max_requests:');
    lines.push(
      '        raise McpError(INTERNAL_ERROR, f"Rate limit exceeded for {tool_name}: {max_requests} requests per {window_ms}ms")',
    );
    lines.push('');
    lines.push('');
  }

  if (needsSanitizeOutput) {
    lines.push('_INJECTION_PATTERNS = [');
    lines.push(
      '    re.compile(r"\\b(?:ignore|disregard|forget)\\s+(?:all\\s+)?(?:previous|above|prior)\\s+instructions?", re.IGNORECASE),',
    );
    lines.push('    re.compile(r"\\b(?:you\\s+are|act\\s+as|pretend\\s+to\\s+be|roleplay\\s+as)\\b", re.IGNORECASE),');
    lines.push('    re.compile(r"\\b(?:system\\s*prompt|</?(?:system|user|assistant)>)", re.IGNORECASE),');
    lines.push('    re.compile(r"\\[(?:INST|SYS|/?SYSTEM)\\]", re.IGNORECASE),');
    lines.push(']');
    lines.push('');
    lines.push('');
    lines.push('def _sanitize_output(result: str) -> str:');
    lines.push('    """Strip prompt injection markers from tool output."""');
    lines.push('    for pattern in _INJECTION_PATTERNS:');
    lines.push('        result = pattern.sub("[FILTERED]", result)');
    lines.push('    return result');
    lines.push('');
    lines.push('');
  }

  // ── Tools
  for (const toolNode of toolNodes) {
    sourceMap.push({
      irLine: toolNode.loc?.line || 0,
      irCol: toolNode.loc?.col || 1,
      outLine: lines.length + 1,
      outCol: 1,
    });
    const tp = getProps(toolNode);
    const name = str(tp.name) || 'tool';
    const desc = extractDescription(toolNode);
    const paramNodes = getChildren(toolNode, 'param');
    const handlerCode = findPythonHandler(toolNode);

    lines.push('@mcp.tool()');

    // Build function signature
    const pyParams: string[] = [];
    for (const p of paramNodes) {
      const pp = getProps(p);
      const pName = str(pp.name) || 'input';
      const kernType = str(pp.type) || 'string';
      let pType = pyType(kernType);
      const isOptional = str(pp.required) === 'false';
      const defaultVal = str(pp.default);

      // Auto-infer int when type=number but default/min/max are all integers
      if (pType === 'float' && defaultVal !== undefined) {
        const isIntDefault = /^-?\d+$/.test(defaultVal);
        const guards = getChildren(toolNode, 'guard').filter((g) => {
          const gp = getProps(g);
          return (
            (str(gp.param) === pName || str(gp.target) === pName) &&
            (str(gp.kind) === 'validate' || str(gp.type) === 'validate')
          );
        });
        const minMax = guards.flatMap((g) => [str(getProps(g).min), str(getProps(g).max)].filter(Boolean));
        const allIntConstraints = minMax.every((v) => /^-?\d+$/.test(v!));
        if (isIntDefault && (minMax.length === 0 || allIntConstraints)) {
          pType = 'int';
        }
      }

      if (defaultVal !== undefined) {
        const pyDefault = pType === 'bool' ? (defaultVal === 'true' ? 'True' : 'False') : defaultVal;
        pyParams.push(`${pName}: ${pType} = ${pyDefault}`);
      } else if (isOptional) {
        pyParams.push(`${pName}: ${pType} | None = None`);
      } else {
        pyParams.push(`${pName}: ${pType}`);
      }
    }

    lines.push(`async def ${name}(${pyParams.join(', ')}) -> str:`);
    if (desc) lines.push(`    """${desc}"""`);
    lines.push(`    logger.info("tool:call", extra={"tool": ${pyStr(name)}})`);

    // Missing handler diagnostic (S5-1)
    if (!handlerCode) {
      const hasAnyHandler = getChildren(toolNode, 'handler').length > 0;
      customDiagnostics.push({
        nodeType: 'tool',
        outcome: 'suppressed',
        target: 'mcp-python',
        loc: toolNode.loc ? { line: toolNode.loc.line, col: toolNode.loc.col } : undefined,
        severity: 'error',
        message: hasAnyHandler
          ? `Tool "${name}" has no Python handler — add handler lang=python <<<...>>>`
          : `Tool "${name}" has no handler — add handler <<<...>>>`,
        reason: 'no-handler',
      });
    }

    // Auto-inject guards based on handler effects — without mutating IR tree
    // Effect patterns from shared module

    // Content/code params should not be auto-guarded
    const isContentParam = (pn: string) =>
      /^(content|code|body|data|payload|text|source|script|html|markdown|template)$/i.test(pn);
    const isPathLikeParam = (pn: string) =>
      /(?:^|[_A-Z])(?:path|file|dir(?:ectory)?|root|workspace)(?:$|[_A-Z])/i.test(pn);

    // Collect synthetic guards locally instead of pushing to IR
    const syntheticGuards: IRNode[] = [];
    if (handlerCode) {
      const allToolGuards = getChildren(toolNode, 'guard');
      const allToolKinds = new Set(allToolGuards.map((g) => guardKind(g)));
      const stringParams = paramNodes.filter((p) => (str(getProps(p).type) || 'string') === 'string');

      if (PY_FILE_IO_PATTERN.test(handlerCode) && !allToolKinds.has('pathContainment') && stringParams.length > 0) {
        for (const p of stringParams) {
          const pName = str(getProps(p).name) || 'input';
          if (isPathLikeParam(pName)) {
            syntheticGuards.push({ type: 'guard', props: { type: 'pathContainment', param: pName } });
          }
        }
      }
      if (PY_SHELL_EXEC_PATTERN.test(handlerCode) && stringParams.length > 0) {
        for (const p of stringParams) {
          const pName = str(getProps(p).name) || 'input';
          if (!isContentParam(pName)) {
            const existingGuards = getChildren(toolNode, 'guard').filter((g) => str(getProps(g).param) === pName);
            if (!existingGuards.some((g) => guardKind(g) === 'sanitize')) {
              syntheticGuards.push({ type: 'guard', props: { type: 'sanitize', param: pName } });
            }
          }
        }
      }
    }
    const hasSanitizeOutput =
      getChildren(toolNode, 'guard').some((g) => guardKind(g) === 'sanitizeOutput') ||
      (handlerCode && PY_NETWORK_PATTERN.test(handlerCode));

    lines.push('    try:');

    // Guards — inside try so exceptions become MCP errors
    const guardLines = emitPyGuards(toolNode, syntheticGuards);
    if (guardLines.length > 0) {
      lines.push(...guardLines.map((l) => (l.length > 0 ? `    ${l}` : '')));
    }

    if (hasSanitizeOutput) {
      needsSanitizeOutput = true;
      // Wrap handler in nested async function, sanitize its return value
      lines.push(`        async def _handler():`);
      if (handlerCode) {
        lines.push(...ind(handlerCode.split('\n'), 12));
      } else {
        lines.push(`            return f"${name} completed"`);
      }
      lines.push(`        return _sanitize_output(await _handler())`);
    } else if (handlerCode) {
      lines.push(...ind(handlerCode.split('\n'), 8));
    } else {
      lines.push(`        return f"${name} completed"`);
    }
    lines.push('    except McpError:');
    lines.push('        raise');
    lines.push('    except Exception as e:');
    lines.push(`        logger.error("tool:error", extra={"tool": ${pyStr(name)}, "error": str(e)})`);
    lines.push(`        raise McpError(INTERNAL_ERROR, str(e))`);
    lines.push('');
  }

  // ── Resources
  for (const resourceNode of resourceNodes) {
    sourceMap.push({
      irLine: resourceNode.loc?.line || 0,
      irCol: resourceNode.loc?.col || 1,
      outLine: lines.length + 1,
      outCol: 1,
    });
    const rp = getProps(resourceNode);
    const name = str(rp.name) || 'resource';
    const uri = str(rp.uri) || `${name}://default`;
    const desc = extractDescription(resourceNode);
    const handlerCode = findPythonHandler(resourceNode);

    lines.push(`@mcp.resource(${pyStr(uri)})`);
    // Extract URI template params
    const templateParams = (uri.match(/\{(\w+)\}/g) || []).map((m) => m.slice(1, -1));
    const sig = templateParams.length > 0 ? templateParams.map((p) => `${p}: str`).join(', ') : '';
    lines.push(`async def ${name}(${sig}) -> str:`);
    if (desc) lines.push(`    """${desc}"""`);
    lines.push(`    logger.info("resource:read", extra={"resource": ${pyStr(name)}})`);

    if (handlerCode) {
      lines.push(...ind(handlerCode.split('\n'), 4));
    } else {
      lines.push(`    return f"${name} content"`);
    }
    lines.push('');
  }

  // ── Prompts
  for (const promptNode of promptNodes) {
    sourceMap.push({
      irLine: promptNode.loc?.line || 0,
      irCol: promptNode.loc?.col || 1,
      outLine: lines.length + 1,
      outCol: 1,
    });
    const pp = getProps(promptNode);
    const name = str(pp.name) || 'prompt';
    const desc = extractDescription(promptNode);
    const paramNodes = getChildren(promptNode, 'param');
    const handlerCode = findPythonHandler(promptNode);

    lines.push(`@mcp.prompt()`);
    const pyParams: string[] = [];
    for (const p of paramNodes) {
      const pProps = getProps(p);
      const pName = str(pProps.name) || 'input';
      const isOptional = str(pProps.required) === 'false';
      pyParams.push(isOptional ? `${pName}: str = ""` : `${pName}: str`);
    }
    lines.push(`async def ${name}(${pyParams.join(', ')}) -> str:`);
    if (desc) lines.push(`    """${desc}"""`);

    if (handlerCode) {
      lines.push(...ind(handlerCode.split('\n'), 4));
    } else {
      lines.push(`    return f"${name} prompt"`);
    }
    lines.push('');
  }

  // ── Entrypoint
  lines.push('');
  lines.push('if __name__ == "__main__":');
  lines.push(`    mcp.run(transport=${pyStr(transport)})`);
  lines.push('');

  return {
    code: lines.join('\n'),
    sourceMap,
    diagnostics: [...buildDiagnostics(root, accounted, 'mcp'), ...customDiagnostics],
  };
}

/** Transpile KERN IR to Python FastMCP server code. */
export function transpileMCPPython(root: IRNode, config?: ResolvedKernConfig): TranspileResult {
  const { code, sourceMap, diagnostics } = buildPythonCode(root, config);
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
