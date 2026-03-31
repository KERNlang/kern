import type { AccountedEntry, IRNode, ResolvedKernConfig, KernConfig, SourceMapEntry, TranspileResult } from '@kernlang/core';
import { accountNode, buildDiagnostics, countTokens, getChildren, getFirstChild, getProps, serializeIR } from '@kernlang/core';

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
  const raw = str(props.description)
    || (descNode ? str(getProps(descNode).text) || str(getProps(descNode).value) : undefined)
    || '';
  return raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
}

function ind(lines: string[], spaces: number): string[] {
  const prefix = ' '.repeat(spaces);
  return lines.map(line => line.length > 0 ? `${prefix}${line}` : '');
}

function splitCsv(value?: string): string[] {
  return (value || '').split(',').map(p => p.trim()).filter(Boolean);
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
    case 'number': case 'float': return 'float';
    case 'int': case 'integer': return 'int';
    case 'boolean': case 'bool': return 'bool';
    case 'string': return 'str';
    case 'string[]': return 'list[str]';
    case 'number[]': return 'list[float]';
    case 'object': case 'json': return 'dict';
    default: return 'str';
  }
}

// ── Guard code generation ───────────────────────────────────────────────

function emitPyGuards(node: IRNode): string[] {
  const guards = getChildren(node, 'guard');
  const lines: string[] = [];

  for (const g of guards) {
    const props = getProps(g);
    const kind = str(props.name) || str(props.kind) || str(props.type);
    const param = str(props.param) || str(props.target) || str(props.field);

    if (kind === 'sanitize' && param) {
      const pattern = str(props.pattern) || '[^\\w./ -]';
      // Validate regex at transpile time to prevent ReDoS
      try { new RegExp(pattern); } catch { continue; }
      lines.push(`    try:`);
      lines.push(`        ${param} = re.sub(r${pyStr(pattern)}, "", str(${param}))`);
      lines.push(`    except re.error:`);
      lines.push(`        pass`);
    }

    if (kind === 'pathContainment' && param) {
      const allowRaw = splitCsv(str(props.allowlist) || str(props.allow));
      const allowPy = allowRaw.length > 0
        ? `[${allowRaw.map(a => pyStr(a)).join(', ')}]`
        : '[os.getcwd()]';
      lines.push(`    _resolved = os.path.realpath(str(${param}))`);
      lines.push(`    if not any(_resolved == os.path.realpath(d) or _resolved.startswith(os.path.realpath(d) + os.sep) for d in ${allowPy}):`);
      lines.push(`        raise ValueError(f"Path escapes allowed directories: {${param}}")`);
      lines.push(`    ${param} = _resolved`);
    }

    if (kind === 'validate' && param) {
      if (props.min !== undefined && !Number.isNaN(Number(props.min))) lines.push(`    if ${param} < ${props.min}: raise ValueError("${param} below minimum ${props.min}")`);
      if (props.max !== undefined && !Number.isNaN(Number(props.max))) lines.push(`    if ${param} > ${props.max}: raise ValueError("${param} above maximum ${props.max}")`);
    }

    if (kind === 'auth') {
      const envVar = str(props.envVar) || str(props.env) || 'MCP_AUTH_TOKEN';
      lines.push(`    if not os.environ.get(${pyStr(envVar)}):`);
      lines.push(`        raise PermissionError(f"Authentication required: set ${envVar}")`);
    }

    if (kind === 'rateLimit') {
      lines.push(`    # Rate limiting handled by middleware`);
    }

    if (kind === 'sizeLimit' && param) {
      const maxBytes = str(props.maxBytes) || str(props.max) || '1048576';
      lines.push(`    if isinstance(${param}, str) and len(${param}.encode()) > ${maxBytes}:`);
      lines.push(`        raise ValueError(f"${param} exceeds size limit of ${maxBytes} bytes")`);
    }
  }

  return lines;
}

// ── Main Python transpiler ──────────────────────────────────────────────

function buildPythonCode(root: IRNode, _config?: KernConfig | ResolvedKernConfig): {
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

  // Check what imports we need — match prop priority: name > kind > type (same as emitPyGuards)
  const allGuards = [...toolNodes, ...resourceNodes, ...promptNodes].flatMap(n => getChildren(n, 'guard'));
  const guardKind = (g: IRNode) => str(getProps(g).name) || str(getProps(g).kind) || str(getProps(g).type);
  const needsRe = allGuards.some(g => guardKind(g) === 'sanitize');
  const needsOs = allGuards.some(g => {
    const k = guardKind(g);
    return k === 'pathContainment' || k === 'auth';
  });

  const transport = str(props.transport) || 'stdio';
  const sourceMap: SourceMapEntry[] = [];
  const lines: string[] = [];

  // ── Imports
  lines.push(`"""${serverName} — Generated by KERN MCP transpiler."""`);
  lines.push('');
  lines.push('import logging');
  if (needsOs) lines.push('import os');
  if (needsRe) lines.push('import re');
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
  lines.push('        entry = {"level": record.levelname.lower(), "event": record.getMessage(), "ts": self.formatTime(record)}');
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

  // ── Tools
  for (const toolNode of toolNodes) {
    sourceMap.push({ irLine: toolNode.loc?.line || 0, irCol: toolNode.loc?.col || 1, outLine: lines.length + 1, outCol: 1 });
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
        const guards = getChildren(toolNode, 'guard').filter(g => {
          const gp = getProps(g);
          return (str(gp.param) === pName || str(gp.target) === pName)
            && (str(gp.kind) === 'validate' || str(gp.type) === 'validate');
        });
        const minMax = guards.flatMap(g => [str(getProps(g).min), str(getProps(g).max)].filter(Boolean));
        const allIntConstraints = minMax.every(v => /^-?\d+$/.test(v!));
        if (isIntDefault && (minMax.length === 0 || allIntConstraints)) {
          pType = 'int';
        }
      }

      if (defaultVal !== undefined) {
        const pyDefault = pType === 'bool'
          ? (defaultVal === 'true' ? 'True' : 'False')
          : defaultVal;
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

    lines.push('    try:');

    // Guards — inside try so exceptions become MCP errors
    const guardLines = emitPyGuards(toolNode);
    if (guardLines.length > 0) {
      // Re-indent guards to be inside try block (add 4 more spaces)
      lines.push(...guardLines.map(l => l.length > 0 ? '    ' + l : ''));
    }

    if (handlerCode) {
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
    sourceMap.push({ irLine: resourceNode.loc?.line || 0, irCol: resourceNode.loc?.col || 1, outLine: lines.length + 1, outCol: 1 });
    const rp = getProps(resourceNode);
    const name = str(rp.name) || 'resource';
    const uri = str(rp.uri) || `${name}://default`;
    const desc = extractDescription(resourceNode);
    const handlerCode = findPythonHandler(resourceNode);

    lines.push(`@mcp.resource(${pyStr(uri)})`);
    // Extract URI template params
    const templateParams = (uri.match(/\{(\w+)\}/g) || []).map(m => m.slice(1, -1));
    const sig = templateParams.length > 0 ? templateParams.map(p => `${p}: str`).join(', ') : '';
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
    sourceMap.push({ irLine: promptNode.loc?.line || 0, irCol: promptNode.loc?.col || 1, outLine: lines.length + 1, outCol: 1 });
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
    diagnostics: buildDiagnostics(root, accounted, 'mcp'),
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
    sourceMap: sourceMap.length > 0 ? sourceMap : [{ irLine: root.loc?.line || 0, irCol: root.loc?.col || 1, outLine: 1, outCol: 1 }],
    irTokenCount,
    tsTokenCount,
    tokenReduction: irTokenCount === 0 ? 0 : Math.round((1 - irTokenCount / tsTokenCount) * 100),
    diagnostics,
  };
}
