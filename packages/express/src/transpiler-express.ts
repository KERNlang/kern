import type { ResolvedKernConfig, GeneratedArtifact, IRNode, SourceMapEntry, TranspileResult, AccountedEntry } from '@kernlang/core';
import { camelKey, countTokens, generateCoreNode, getChildren, getFirstChild, getProps, serializeIR, buildDiagnostics, accountNode, propsOf, mapSemanticType } from '@kernlang/core';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

interface MiddlewareArtifactRef {
  artifact: GeneratedArtifact;
  exportName: string;
  fileBase: string;
}

interface RouteArtifactRef {
  artifact: GeneratedArtifact;
  registerName: string;
  fileBase: string;
}

interface SchemaShape {
  body?: string;
  params?: string;
  query?: string;
  response?: string;
}

interface MiddlewareUsage {
  importLine?: string;
  invocation: string;
}

// ── Route capability analysis ────────────────────────────────────────────

interface RouteCapabilities {
  hasStream: boolean;
  hasSpawn: boolean;
  hasTimer: boolean;
  streamNode?: IRNode;
  spawnNode?: IRNode;
  timerNode?: IRNode;
  needsAbortController: boolean;
  needsChildProcess: boolean;
}

function analyzeRouteCapabilities(routeNode: IRNode): RouteCapabilities {
  const streamNode = getFirstChild(routeNode, 'stream');
  // spawn must be inside stream (for SSE output), not standalone on route
  const spawnNode = streamNode ? getFirstChild(streamNode, 'spawn') : undefined;
  const timerNode = getFirstChild(routeNode, 'timer');

  const hasStream = !!streamNode;
  const hasSpawn = !!spawnNode;
  const hasTimer = !!timerNode;

  return {
    hasStream,
    hasSpawn,
    hasTimer,
    streamNode,
    spawnNode,
    timerNode,
    needsAbortController: hasStream || hasSpawn || hasTimer,
    needsChildProcess: hasSpawn,
  };
}

// ── SSE stream code generator ────────────────────────────────────────────

function generateStreamSetup(indent: string): string[] {
  return [
    `${indent}res.writeHead(200, {`,
    `${indent}  'Content-Type': 'text/event-stream',`,
    `${indent}  'Cache-Control': 'no-cache',`,
    `${indent}  'Connection': 'keep-alive',`,
    `${indent}});`,
    `${indent}res.flushHeaders();`,
    `${indent}`,
    `${indent}const emit = (data: unknown, event?: string) => {`,
    `${indent}  if (res.writableEnded) return;`,
    `${indent}  if (event) res.write(\`event: \${event}\\n\`);`,
    `${indent}  res.write(\`data: \${JSON.stringify(data)}\\n\\n\`);`,
    `${indent}};`,
    `${indent}`,
    `${indent}// SSE heartbeat — keeps proxies/browsers from killing the connection`,
    `${indent}const heartbeat = setInterval(() => {`,
    `${indent}  if (res.writableEnded) { clearInterval(heartbeat); return; }`,
    `${indent}  res.write(': keep-alive\\n\\n');`,
    `${indent}}, 15000);`,
  ];
}

function generateStreamWrap(handlerLines: string[], hasSpawn: boolean, indent: string): string[] {
  const lines: string[] = [];

  // Await the async IIFE so Express doesn't return before stream completes
  lines.push(`${indent}await (async () => {`);
  lines.push(`${indent}  try {`);

  if (hasSpawn) {
    // Wrap spawn in a Promise so we await child completion before closing stream
    lines.push(`${indent}    await new Promise<void>((resolveStream, rejectStream) => {`);
    lines.push(...handlerLines.map(l => `${indent}      ${l}`));
    // The spawn's on('close') handler should call resolveStream()
    lines.push(`${indent}    });`);
  } else {
    lines.push(...handlerLines.map(l => `${indent}    ${l}`));
  }

  lines.push(`${indent}  } catch (err) {`);
  lines.push(`${indent}    emit({ type: 'error', error: err instanceof Error ? err.message : String(err) });`);
  lines.push(`${indent}  } finally {`);
  lines.push(`${indent}    clearInterval(heartbeat);`);
  lines.push(`${indent}    if (!res.writableEnded) {`);
  lines.push(`${indent}      res.write(\`data: \${JSON.stringify('[DONE]')}\\n\\n\`);`);
  lines.push(`${indent}      res.end();`);
  lines.push(`${indent}    }`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}})();`);

  return lines;
}

// ── Spawn code generator ─────────────────────────────────────────────────

function generateSpawnCode(spawnNode: IRNode, indent: string): string[] {
  const p = getProps(spawnNode);
  const binary = String(p.binary || 'echo');
  const args = p.args as string | undefined;
  const timeoutSec = Number(p.timeout) || 0;
  const lines: string[] = [];

  // Validate: binary must be static (security: no dynamic binary)
  if (binary.includes('{{') || binary.includes('req.')) {
    lines.push(`${indent}// ERROR: Dynamic binary is not allowed for security. Use a static binary name.`);
    lines.push(`${indent}res.status(500).json({ error: 'Dynamic binary not allowed' });`);
    return lines;
  }

  const argsExpr = args || '[]';
  lines.push(`${indent}const child = spawn('${escapeSingleQuotes(binary)}', ${argsExpr}, {`);
  lines.push(`${indent}  stdio: ['pipe', 'pipe', 'pipe'],`);
  lines.push(`${indent}  shell: false,`);

  // Env vars
  const envNodes = getChildren(spawnNode, 'env');
  if (envNodes.length > 0) {
    const envPairs = envNodes.map(e => {
      const ep = getProps(e);
      const entries = Object.entries(ep).filter(([k]) => k !== 'styles' && k !== 'pseudoStyles' && k !== 'themeRefs');
      return entries.map(([k, v]) => `${k}: '${String(v)}'`).join(', ');
    }).join(', ');
    lines.push(`${indent}  env: { ...process.env, ${envPairs} },`);
  }

  lines.push(`${indent}});`);

  // stdin handling — only end if no stdin prop
  if (!p.stdin) {
    lines.push(`${indent}child.stdin.end();`);
  }

  lines.push(`${indent}let errorText = '';`);

  // Timeout with SIGTERM → SIGKILL escalation
  lines.push(`${indent}let childExited = false;`);
  lines.push(`${indent}child.on('exit', () => { childExited = true; });`);

  if (timeoutSec > 0) {
    lines.push(`${indent}const spawnTimer = setTimeout(() => {`);
    lines.push(`${indent}  child.kill('SIGTERM');`);
    lines.push(`${indent}  setTimeout(() => { if (!childExited) child.kill('SIGKILL'); }, 3000);`);
    lines.push(`${indent}}, ${timeoutSec * 1000});`);
  }

  // Abort on request close — SIGTERM then force SIGKILL + resolve after 5s
  lines.push(`${indent}ac.signal.addEventListener('abort', () => {`);
  lines.push(`${indent}  if (!childExited) {`);
  lines.push(`${indent}    child.kill('SIGTERM');`);
  lines.push(`${indent}    setTimeout(() => {`);
  lines.push(`${indent}      if (!childExited) child.kill('SIGKILL');`);
  lines.push(`${indent}      if (typeof resolveStream === 'function') resolveStream();`);
  lines.push(`${indent}    }, 5000);`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}});`);

  // Event handlers from child nodes
  const onNodes = getChildren(spawnNode, 'on');
  let hasCloseHandler = false;

  for (const onNode of onNodes) {
    const onProps = getProps(onNode);
    const event = String(onProps.name || onProps.event || '');
    const handlerChild = getFirstChild(onNode, 'handler');
    const code = handlerChild ? String(getProps(handlerChild).code || '') : '';

    if (event === 'stdout') {
      lines.push(`${indent}child.stdout.on('data', (chunk: Buffer) => {`);
      lines.push(...code.split('\n').map(l => `${indent}  ${l.trim()}`));
      lines.push(`${indent}});`);
    } else if (event === 'stderr') {
      lines.push(`${indent}child.stderr.on('data', (chunk: Buffer) => {`);
      lines.push(...code.split('\n').map(l => `${indent}  ${l.trim()}`));
      lines.push(`${indent}});`);
    } else if (event === 'close') {
      hasCloseHandler = true;
      lines.push(`${indent}child.on('close', (code: number | null) => {`);
      if (timeoutSec > 0) lines.push(`${indent}  clearTimeout(spawnTimer);`);
      lines.push(...code.split('\n').map(l => `${indent}  ${l.trim()}`));
      // Resolve the stream promise so finally block runs AFTER child exits
      lines.push(`${indent}  if (typeof resolveStream === 'function') resolveStream();`);
      lines.push(`${indent}});`);
    } else if (event === 'timeout') {
      // Handled via the timer killed branch
    }
  }

  // Default close handler if none specified — ensures stream promise resolves
  if (!hasCloseHandler) {
    lines.push(`${indent}child.on('close', (code: number | null) => {`);
    if (timeoutSec > 0) lines.push(`${indent}  clearTimeout(spawnTimer);`);
    lines.push(`${indent}  if (typeof resolveStream === 'function') resolveStream();`);
    lines.push(`${indent}});`);
  }

  // Catch spawn errors (binary not found)
  lines.push(`${indent}child.on('error', (err: Error) => {`);
  lines.push(`${indent}  emit({ type: 'error', error: err.message });`);
  lines.push(`${indent}  if (typeof resolveStream === 'function') resolveStream();`);
  lines.push(`${indent}});`);

  return lines;
}

// ── Timer code generator ─────────────────────────────────────────────────

function generateTimerCode(timerNode: IRNode, handlerCode: string, indent: string): string[] {
  const p = getProps(timerNode);
  const timeoutSec = Number(Object.values(p).find(v => typeof v === 'string' && !isNaN(Number(v))) || p.timeout || 15);
  const handlerChild = getFirstChild(timerNode, 'handler');
  const timerHandlerCode = handlerChild ? String(getProps(handlerChild).code || '') : '';
  const onTimeoutNode = (timerNode.children || []).find(c => c.type === 'on' && (getProps(c).name === 'timeout' || getProps(c).event === 'timeout'));
  const timeoutHandler = onTimeoutNode ? getFirstChild(onTimeoutNode, 'handler') : undefined;
  const timeoutCode = timeoutHandler ? String(getProps(timeoutHandler).code || '') : `res.status(408).json({ error: 'Request timed out' });`;

  const lines: string[] = [];
  lines.push(`${indent}const timeoutMs = ${timeoutSec * 1000};`);
  lines.push(`${indent}const timer = setTimeout(() => {`);
  lines.push(`${indent}  ac.abort();`);
  lines.push(...timeoutCode.split('\n').map(l => `${indent}  ${l.trim()}`));
  lines.push(`${indent}}, timeoutMs);`);
  lines.push(`${indent}`);
  lines.push(`${indent}try {`);
  // Timer handler code (the work to do)
  if (timerHandlerCode) {
    lines.push(...timerHandlerCode.split('\n').map(l => `${indent}  ${l.trim()}`));
  }
  // Original route handler code
  if (handlerCode) {
    lines.push(...handlerCode.split('\n').map(l => `${indent}  ${l.trim()}`));
  }
  lines.push(`${indent}} catch (err) {`);
  lines.push(`${indent}  if (!ac.signal.aborted) {`);
  lines.push(`${indent}    clearTimeout(timer);`);
  lines.push(`${indent}    throw err;`);
  lines.push(`${indent}  }`);
  lines.push(`${indent}} finally {`);
  lines.push(`${indent}  clearTimeout(timer);`);
  lines.push(`${indent}}`);

  return lines;
}

// ── Portable respond node → Express ──────────────────────────────────────

function generateRespondExpress(respondNode: IRNode, indent: string): string[] {
  const p = getProps(respondNode);
  const status = typeof p.status === 'number' ? p.status : undefined;
  const json = p.json as string | undefined;
  const error = p.error as string | undefined;
  const text = p.text as string | undefined;
  const redirect = p.redirect as string | undefined;

  if (redirect) {
    return [`${indent}res.redirect('${escapeSingleQuotes(String(redirect))}');`];
  }
  if (error) {
    return [`${indent}res.status(${status || 500}).json({ error: '${escapeSingleQuotes(String(error))}' });`];
  }
  if (json) {
    if (!status || status === 200) {
      return [`${indent}res.json(${json});`];
    }
    return [`${indent}res.status(${status}).json(${json});`];
  }
  if (text) {
    if (!status || status === 200) {
      return [`${indent}res.send(${text});`];
    }
    return [`${indent}res.status(${status}).send(${text});`];
  }
  if (status === 204) {
    return [`${indent}res.status(204).send();`];
  }
  if (status) {
    return [`${indent}res.status(${status}).send();`];
  }
  return [`${indent}res.status(200).send();`];
}

function pascalCase(value: string): string {
  const camel = camelKey(value);
  return camel ? camel.charAt(0).toUpperCase() + camel.slice(1) : 'Generated';
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'generated';
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function indentBlock(code: string, indent: string): string[] {
  return code.split('\n').map(line => `${indent}${line}`);
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let inQuote = false;

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"' && value[i - 1] !== '\\') {
      inQuote = !inQuote;
      current += ch;
      continue;
    }
    if (!inQuote) {
      if (ch === '{') braceDepth++;
      if (ch === '}') braceDepth--;
      if (ch === '[') bracketDepth++;
      if (ch === ']') bracketDepth--;
      if (ch === '(') parenDepth++;
      if (ch === ')') parenDepth--;
      if (ch === ',' && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function extractRequiredKeys(schemaType: string): string[] {
  const trimmed = schemaType.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return [];

  const keys: string[] = [];
  const inner = trimmed.slice(1, -1);
  for (const part of splitTopLevel(inner)) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const rawKey = part.slice(0, colonIdx).trim();
    if (!rawKey || rawKey.endsWith('?')) continue;
    keys.push(rawKey.replace(/^['"]|['"]$/g, ''));
  }
  return keys;
}

function derivePathParams(path: string): string[] {
  const matches = path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g);
  return [...matches].map(match => match[1]);
}

function buildPathParamsType(path: string): string | undefined {
  const params = derivePathParams(path);
  if (params.length === 0) return undefined;
  return `{ ${params.map(param => `${param}: string`).join('; ')} }`;
}

function findServerNode(root: IRNode): IRNode | undefined {
  if (root.type === 'server') return root;
  for (const child of root.children || []) {
    const found = findServerNode(child);
    if (found) return found;
  }
  return undefined;
}

function routeFileBase(method: string, path: string, index: number): string {
  const base = slugify(`${method}-${path.replace(/[:/]/g, '-')}`);
  return base === 'generated' ? `route-${index}` : base;
}

function routeRegisterName(method: string, path: string): string {
  return `register${pascalCase(`${method} ${path}`)}Route`;
}

function middlewareExportName(node: IRNode): string {
  const props = getProps(node);
  const handlerName = typeof props.handler === 'string' ? props.handler : undefined;
  if (handlerName) return handlerName;

  const name = typeof props.name === 'string' ? props.name : 'middleware';
  return camelKey(name) || 'middlewareHandler';
}

function buildSchema(node?: IRNode): SchemaShape {
  if (!node) return {};
  const props = getProps(node);
  const schema: SchemaShape = {};

  if (typeof props.body === 'string') schema.body = props.body;
  if (typeof props.params === 'string') schema.params = props.params;
  if (typeof props.query === 'string') schema.query = props.query;
  if (typeof props.response === 'string') schema.response = props.response;

  return schema;
}

function buildMiddlewareArtifact(node: IRNode, exportName: string): GeneratedArtifact {
  const handlerNode = getFirstChild(node, 'handler');
  const handlerProps = handlerNode ? getProps(handlerNode) : {};
  const handlerCode = typeof handlerProps.code === 'string'
    ? String(handlerProps.code)
    : '';

  const lines: string[] = [];
  lines.push(`import type { NextFunction, Request, Response } from 'express';`);
  lines.push('');
  lines.push(`export function ${exportName}(req: Request, res: Response, next: NextFunction): void {`);
  if (handlerCode) {
    lines.push(...indentBlock(handlerCode, '  '));
  } else {
    lines.push('  next();');
  }
  lines.push('}');

  const name = String(getProps(node).name || exportName);
  return {
    path: `middleware/${slugify(name)}.ts`,
    content: lines.join('\n'),
    type: 'middleware',
  };
}

function ensureCustomMiddlewareArtifact(
  node: IRNode,
  middlewareArtifacts: Map<string, MiddlewareArtifactRef>,
): MiddlewareArtifactRef {
  const name = String(getProps(node).name || 'middleware');
  const fileBase = slugify(name);
  const existing = middlewareArtifacts.get(fileBase);
  if (existing) return existing;

  const exportName = middlewareExportName(node);
  const artifact = buildMiddlewareArtifact(node, exportName);
  const created: MiddlewareArtifactRef = { artifact, exportName, fileBase };
  middlewareArtifacts.set(fileBase, created);
  return created;
}

function resolveMiddlewareUsage(
  node: IRNode,
  middlewareArtifacts: Map<string, MiddlewareArtifactRef>,
  importPrefix: string,
  securityLevel?: 'strict' | 'relaxed',
): MiddlewareUsage {
  const props = getProps(node);
  const name = String(props.name || 'middleware');

  if (name === 'cors') {
    return { importLine: `import cors from 'cors';`, invocation: 'cors()' };
  }

  if (name === 'json') {
    const invocation = securityLevel === 'relaxed' ? 'express.json()' : `express.json({ limit: '1mb' })`;
    return { invocation };
  }

  const artifact = ensureCustomMiddlewareArtifact(node, middlewareArtifacts);
  return {
    importLine: `import { ${artifact.exportName} } from '${importPrefix}middleware/${artifact.fileBase}.js';`,
    invocation: artifact.exportName,
  };
}

// ── Portable request reference rewriting ──────────────────────────────────

function rewriteExpressExpr(expr: string, path: string): string {
  const pathParams = derivePathParams(path);
  let result = expr;
  // params.X → req.params.X
  result = result.replace(/\bparams\.([A-Za-z_]\w*)/g, 'req.params.$1');
  // body.X → req.body.X
  result = result.replace(/\bbody\.([A-Za-z_]\w*)/g, 'req.body.$1');
  // query.X → req.query.X
  result = result.replace(/\bquery\.([A-Za-z_]\w*)/g, 'req.query.$1');
  // headers.X → req.headers['X']
  result = result.replace(/\bheaders\.([A-Za-z_][\w-]*)/g, (_m, key) => `req.headers['${key}']`);
  // effectName.result → effectName (effect variables hold the result directly)
  result = result.replace(/\b([A-Za-z_]\w*)\.result\b/g, '$1');
  return result;
}

// ── Portable handler generation (derive → guard → handler → respond) ─────

function extractExprCode(prop: unknown): string {
  if (typeof prop === 'object' && prop !== null && (prop as any).__expr) return (prop as any).code;
  return typeof prop === 'string' ? prop : '';
}

function generatePortableChildExpress(child: IRNode, indent: string, path: string): string[] {
  const lines: string[] = [];
  const p = getProps(child);

  switch (child.type) {
    case 'derive': {
      const name = String(p.name || '');
      const exprCode = extractExprCode(p.expr);
      if (name && exprCode) {
        lines.push(`${indent}const ${name} = ${rewriteExpressExpr(exprCode, path)};`);
      }
      break;
    }
    case 'guard': {
      const name = String(p.name || '');
      const exprCode = extractExprCode(p.expr);
      const elseStatus = p.else ? parseInt(String(p.else), 10) : 404;
      const elseMessage = typeof p.message === 'string' ? p.message : (name ? `${name} guard failed` : 'Guard failed');
      if (exprCode) {
        lines.push(`${indent}if (!(${rewriteExpressExpr(exprCode, path)})) {`);
        lines.push(`${indent}  return res.status(${elseStatus}).json({ error: '${escapeSingleQuotes(elseMessage)}' });`);
        lines.push(`${indent}}`);
      }
      break;
    }
    case 'handler': {
      const code = String(p.code || '');
      if (code) lines.push(...indentBlock(code, indent));
      break;
    }
    case 'respond': {
      // Clone props to avoid mutating shared AST, then rewrite portable refs
      const clonedRespond: IRNode = { ...child, props: { ...child.props } };
      if (clonedRespond.props!.json) clonedRespond.props!.json = rewriteExpressExpr(String(clonedRespond.props!.json), path);
      if (clonedRespond.props!.text) clonedRespond.props!.text = rewriteExpressExpr(String(clonedRespond.props!.text), path);
      lines.push(...generateRespondExpress(clonedRespond, indent));
      break;
    }
    case 'branch': {
      const on = rewriteExpressExpr(String(p.on || ''), path);
      const paths = getChildren(child, 'path');
      for (let i = 0; i < paths.length; i++) {
        const pathNode = paths[i];
        const pp = getProps(pathNode);
        const value = String(pp.value || '');
        const keyword = i === 0 ? 'if' : 'else if';
        lines.push(`${indent}${keyword} (${on} === '${escapeSingleQuotes(value)}') {`);
        // Recurse into path children
        for (const pathChild of pathNode.children || []) {
          lines.push(...generatePortableChildExpress(pathChild, indent + '  ', path));
        }
        lines.push(`${indent}}`);
      }
      break;
    }
    case 'each': {
      const name = String(p.name || 'item');
      const collection = rewriteExpressExpr(extractExprCode(p.in) || String(p.in || ''), path);
      const index = p.index ? String(p.index) : undefined;
      if (index) {
        lines.push(`${indent}for (const [${index}, ${name}] of (${collection}).entries()) {`);
      } else {
        lines.push(`${indent}for (const ${name} of ${collection}) {`);
      }
      for (const eachChild of child.children || []) {
        lines.push(...generatePortableChildExpress(eachChild, indent + '  ', path));
      }
      lines.push(`${indent}}`);
      break;
    }
    case 'collect': {
      const name = String(p.name || '');
      const from = rewriteExpressExpr(String(p.from || ''), path);
      const where = p.where ? extractExprCode(p.where) : undefined;
      const limit = p.limit ? String(p.limit) : undefined;
      const order = p.order ? rewriteExpressExpr(extractExprCode(p.order) || String(p.order), path) : undefined;
      let chain = from;
      if (where) chain += `.filter(item => ${rewriteExpressExpr(where, path)})`;
      if (order) chain += `.sort((a, b) => ${order})`;
      if (limit) chain += `.slice(0, ${limit})`;
      if (name) lines.push(`${indent}const ${name} = ${chain};`);
      break;
    }
    case 'effect': {
      const effectName = String(p.name || 'effect');
      const triggerNode = getFirstChild(child, 'trigger');
      const recoverNode = getFirstChild(child, 'recover');
      const triggerProps = triggerNode ? getProps(triggerNode) : {};
      const triggerExpr = extractExprCode(triggerProps.expr) || String(triggerProps.query || triggerProps.url || triggerProps.call || '');
      const retryCount = recoverNode ? parseInt(String(getProps(recoverNode).retry || '0'), 10) : 0;
      const fallback = recoverNode ? String(getProps(recoverNode).fallback || 'null') : 'null';

      if (retryCount > 0) {
        lines.push(`${indent}let ${effectName} = ${fallback};`);
        lines.push(`${indent}for (let _attempt = 0; _attempt < ${retryCount}; _attempt++) {`);
        lines.push(`${indent}  try {`);
        lines.push(`${indent}    ${effectName} = ${rewriteExpressExpr(triggerExpr, path)};`);
        lines.push(`${indent}    break;`);
        lines.push(`${indent}  } catch (_err) {`);
        lines.push(`${indent}    if (_attempt === ${retryCount - 1}) ${effectName} = ${fallback};`);
        lines.push(`${indent}  }`);
        lines.push(`${indent}}`);
      } else {
        lines.push(`${indent}let ${effectName} = ${fallback};`);
        lines.push(`${indent}try {`);
        lines.push(`${indent}  ${effectName} = ${rewriteExpressExpr(triggerExpr, path)};`);
        lines.push(`${indent}} catch (_err) {`);
        lines.push(`${indent}  ${effectName} = ${fallback};`);
        lines.push(`${indent}}`);
      }
      break;
    }
    default:
      break;
  }

  return lines;
}

function generatePortableHandlerExpress(
  routeNode: IRNode,
  indent: string,
  path: string,
): string[] {
  const lines: string[] = [];
  const children = routeNode.children || [];

  // Walk all route children in document order — portable nodes are emitted inline
  const PORTABLE_TYPES = new Set(['derive', 'guard', 'handler', 'respond', 'branch', 'each', 'collect', 'effect']);
  for (const child of children) {
    if (PORTABLE_TYPES.has(child.type)) {
      lines.push(...generatePortableChildExpress(child, indent, path));
    }
  }

  return lines;
}

function buildRouteArtifact(
  routeNode: IRNode,
  routeIndex: number,
  middlewareArtifacts: Map<string, MiddlewareArtifactRef>,
  sourceMap: SourceMapEntry[],
): RouteArtifactRef {
  const props = getProps(routeNode);
  const method = String(props.method || 'get').toLowerCase();
  const normalizedMethod = HTTP_METHODS.has(method) ? method : 'get';
  const path = String(props.path || '/');
  const fileBase = routeFileBase(normalizedMethod, path, routeIndex);
  const registerName = routeRegisterName(normalizedMethod, path);
  const schema = buildSchema(getFirstChild(routeNode, 'schema'));
  const caps = analyzeRouteCapabilities(routeNode);

  // Portable route children: derive, guard, respond, branch, each, collect
  const deriveNodes = getChildren(routeNode, 'derive');
  const guardNodes = getChildren(routeNode, 'guard');
  const respondNode = getFirstChild(routeNode, 'respond');
  const branchNodes = getChildren(routeNode, 'branch');
  const eachNodes = getChildren(routeNode, 'each');
  const collectNodes = getChildren(routeNode, 'collect');
  const effectNodes = getChildren(routeNode, 'effect');
  const hasPortableNodes = deriveNodes.length > 0 || guardNodes.length > 0 || !!respondNode
    || branchNodes.length > 0 || eachNodes.length > 0 || collectNodes.length > 0
    || effectNodes.length > 0;

  // Get handler code — priority: stream handler > timer handler > route handler > portable > 501
  const handlerNode = caps.hasStream
    ? getFirstChild(caps.streamNode!, 'handler')
    : caps.hasTimer
      ? null // timer owns its own handler, don't look at route level
      : getFirstChild(routeNode, 'handler');
  const routeHandlerNode = getFirstChild(routeNode, 'handler');
  const handlerProps = handlerNode ? getProps(handlerNode) : {};
  const routeHandlerCode = routeHandlerNode ? String(getProps(routeHandlerNode).code || '') : '';
  const handlerCode = typeof handlerProps.code === 'string'
    ? String(handlerProps.code)
    : caps.hasStream || caps.hasTimer || hasPortableNodes ? '' : `res.status(501).json({ error: 'Route handler not implemented' });`;

  const routeMiddleware = getChildren(routeNode, 'middleware');
  const routeImports = new Set<string>();
  const middlewareInvocations: string[] = [];

  let needsExpressDefaultImport = false;

  for (const middlewareNode of routeMiddleware) {
    // Handle v3 bare-word middleware list: middleware names=["rateLimit","cors"]
    const mwProps = getProps(middlewareNode);
    const mwNames = mwProps.names as string[] | undefined;
    if (mwNames && Array.isArray(mwNames)) {
      for (const mwName of mwNames) {
        const syntheticNode: IRNode = { type: 'middleware', props: { name: mwName }, children: [] };
        const mwUsage = resolveMiddlewareUsage(syntheticNode, middlewareArtifacts, '../');
        if (mwUsage.importLine) routeImports.add(mwUsage.importLine);
        if (mwUsage.invocation === 'express.json()') needsExpressDefaultImport = true;
        middlewareInvocations.push(mwUsage.invocation);
      }
      continue;
    }
    const usage = resolveMiddlewareUsage(middlewareNode, middlewareArtifacts, '../');
    if (usage.importLine) routeImports.add(usage.importLine);
    if (usage.invocation === 'express.json()') needsExpressDefaultImport = true;
    middlewareInvocations.push(usage.invocation);
  }

  // v3 route children: auth, validate
  const authNode = getFirstChild(routeNode, 'auth');
  if (authNode) {
    const authMode = String(getProps(authNode).mode || 'required');
    middlewareInvocations.unshift(authMode === 'optional' ? 'authOptional' : 'authRequired');
  }

  const validateNode = getFirstChild(routeNode, 'validate');
  if (validateNode) {
    const validateSchema = String(getProps(validateNode).schema || '');
    if (validateSchema) {
      middlewareInvocations.push(`validate(${validateSchema})`);
    }
  }

  // v3 route children: params (query params with types and defaults)
  const paramsNodes = getChildren(routeNode, 'params');
  const queryParams: Array<{ name: string; type: string; default?: string }> = [];
  for (const paramNode of paramsNodes) {
    const items = getProps(paramNode).items as Array<{ name: string; type: string; default?: string }> | undefined;
    if (items) queryParams.push(...items);
  }

  // v3 route children: error (HTTP error contract)
  const errorNodes = getChildren(routeNode, 'error').filter(n => typeof getProps(n).status === 'number');
  const errorResponses: Array<{ status: number; message: string }> = errorNodes.map(n => ({
    status: getProps(n).status as number,
    message: String(getProps(n).message || 'Error'),
  }));

  const paramsType = schema.params || buildPathParamsType(path) || 'Record<string, never>';
  const queryType = schema.query || 'Record<string, never>';
  const bodyType = schema.body || 'Record<string, never>';
  const responseType = schema.response || 'unknown';
  const requestType = `Request<RouteParams, ResponseBody, RequestBody, RequestQuery>`;

  const validationLines: string[] = [];
  const requiredParams = schema.params ? extractRequiredKeys(schema.params) : derivePathParams(path);
  const requiredBody = schema.body ? extractRequiredKeys(schema.body) : [];
  const requiredQuery = schema.query ? extractRequiredKeys(schema.query) : [];

  if (requiredParams.length > 0) {
    validationLines.push(`assertRequiredFields('params', req.params, [${requiredParams.map(key => `'${escapeSingleQuotes(key)}'`).join(', ')}]);`);
  }
  if (requiredBody.length > 0) {
    validationLines.push(`assertRequiredFields('body', req.body, [${requiredBody.map(key => `'${escapeSingleQuotes(key)}'`).join(', ')}]);`);
  }
  if (requiredQuery.length > 0) {
    validationLines.push(`assertRequiredFields('query', req.query, [${requiredQuery.map(key => `'${escapeSingleQuotes(key)}'`).join(', ')}]);`);
  }

  const lines: string[] = [];
  if (needsExpressDefaultImport) {
    lines.push(`import express, { type Express, type NextFunction, type Request, type Response } from 'express';`);
  } else {
    lines.push(`import { type Express, type NextFunction, type Request, type Response } from 'express';`);
  }
  if (caps.needsChildProcess) {
    lines.push(`import { spawn } from 'node:child_process';`);
  }
  for (const routeImport of [...routeImports].sort()) {
    lines.push(routeImport);
  }
  lines.push('');
  lines.push(`type RouteParams = ${paramsType};`);
  lines.push(`type RequestQuery = ${queryType};`);
  lines.push(`type RequestBody = ${bodyType};`);
  lines.push(`type ResponseBody = ${responseType};`);
  if (validationLines.length > 0) {
    lines.push('');
    lines.push(`function assertRequiredFields(label: string, value: unknown, requiredKeys: string[]): void {`);
    lines.push(`  if (typeof value !== 'object' || value === null) {`);
    lines.push(`    throw new Error(\`Invalid \${label}: expected object payload\`);`);
    lines.push('  }');
    lines.push(`  for (const key of requiredKeys) {`);
    lines.push(`    if (!(key in value)) {`);
    lines.push(`      throw new Error(\`Invalid \${label}: missing \${key}\`);`);
    lines.push('    }');
    lines.push('  }');
    lines.push('}');
  }
  lines.push('');
  lines.push(`export function ${registerName}(app: Express): void {`);
  lines.push(`  app.${normalizedMethod}('${escapeSingleQuotes(path)}', ${middlewareInvocations.length > 0 ? `${middlewareInvocations.join(', ')}, ` : ''}async (req: ${requestType}, res: Response, next: NextFunction) => {`);

  // Schema validation — always runs first, before stream/timer
  if (validationLines.length > 0) {
    lines.push('    try {');
    for (const validationLine of validationLines) {
      lines.push(`      ${validationLine}`);
    }
    lines.push('    } catch (err) {');
    lines.push('      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) } as any);');
    lines.push('    }');
    lines.push('');
  }

  // v3 query params — extract with safe type coercion and defaults
  if (queryParams.length > 0) {
    for (const qp of queryParams) {
      if (qp.default !== undefined) {
        if (qp.type === 'number') {
          lines.push(`    const ${qp.name} = req.query.${qp.name} !== undefined ? Number(req.query.${qp.name}) : ${qp.default};`);
        } else if (qp.type === 'boolean') {
          lines.push(`    const ${qp.name} = req.query.${qp.name} !== undefined ? req.query.${qp.name} === 'true' : ${qp.default};`);
        } else {
          lines.push(`    const ${qp.name} = typeof req.query.${qp.name} === 'string' ? req.query.${qp.name} : ${qp.default};`);
        }
      } else {
        if (qp.type === 'number') {
          lines.push(`    const ${qp.name} = req.query.${qp.name} !== undefined ? Number(req.query.${qp.name}) : undefined;`);
        } else if (qp.type === 'boolean') {
          lines.push(`    const ${qp.name} = req.query.${qp.name} !== undefined ? req.query.${qp.name} === 'true' : undefined;`);
        } else {
          lines.push(`    const ${qp.name} = typeof req.query.${qp.name} === 'string' ? req.query.${qp.name} as string : undefined;`);
        }
      }
    }
    lines.push('');
  }

  // v3 error responses — JSDoc contract
  if (errorResponses.length > 0) {
    lines.push('    // Error contract:');
    for (const er of errorResponses) {
      lines.push(`    // ${er.status} — ${er.message}`);
    }
    lines.push('');
  }

  // Request-scoped AbortController (if any async capability)
  if (caps.needsAbortController) {
    lines.push('    const ac = new AbortController();');
    lines.push("    req.on('close', () => ac.abort());");
    lines.push('');
  }

  if (caps.hasStream) {
    // SSE route — validate first, then stream
    lines.push(...generateStreamSetup('    '));
    lines.push('');

    const streamHandlerLines = handlerCode.split('\n').map(l => l.trim()).filter(Boolean);

    // If spawn inside stream, generate spawn code
    if (caps.hasSpawn && caps.spawnNode) {
      const spawnLines = generateSpawnCode(caps.spawnNode, '');
      streamHandlerLines.push(...spawnLines);
    }

    lines.push(...generateStreamWrap(streamHandlerLines, caps.hasSpawn, '    '));
  } else if (caps.hasTimer && caps.timerNode) {
    // Timer route — wrap handler in timeout
    lines.push(...generateTimerCode(caps.timerNode, routeHandlerCode, '    '));
  } else {
    // Standard route — try/catch → next(error)
    lines.push('    try {');

    // Phase 1-3: Portable handler — derive → guard → handler → respond
    if (hasPortableNodes) {
      lines.push(...generatePortableHandlerExpress(routeNode, '      ', path));
    } else {
      lines.push(...indentBlock(handlerCode, '      '));
    }

    lines.push('    } catch (error) {');
    lines.push('      next(error);');
    lines.push('    }');
  }

  lines.push('  });');
  lines.push('}');

  sourceMap.push({
    irLine: routeNode.loc?.line || 0,
    irCol: routeNode.loc?.col || 1,
    outLine: 1,
    outCol: 1,
  });

  return {
    registerName,
    fileBase,
    artifact: {
      path: `routes/${fileBase}.ts`,
      content: lines.join('\n'),
      type: 'route',
    },
  };
}

// ── Core node artifact mapping ────────────────────────────────────────────

/** Map core node type → output directory + artifact type. */
function coreNodeMeta(type: string): { dir: string; artifactType: GeneratedArtifact['type'] } {
  switch (type) {
    case 'interface': return { dir: 'models', artifactType: 'model' };
    case 'model':     return { dir: 'models', artifactType: 'model' };
    case 'repository':return { dir: 'models', artifactType: 'repository' };
    case 'cache':     return { dir: 'lib', artifactType: 'lib' };
    case 'dependency':return { dir: 'lib', artifactType: 'lib' };
    case 'service':   return { dir: 'services', artifactType: 'service' };
    case 'type':      return { dir: 'types', artifactType: 'types' };
    case 'config':    return { dir: 'config', artifactType: 'config' };
    case 'error':     return { dir: 'errors', artifactType: 'error' };
    default:          return { dir: 'lib', artifactType: 'lib' };
  }
}

const TOP_LEVEL_CORE = new Set([
  'type', 'interface', 'service', 'fn', 'machine', 'error',
  'module', 'config', 'store', 'event', 'const',
  // Data layer
  'model', 'repository', 'cache', 'dependency',
]);

// ── Prisma Schema Artifact ───────────────────────────────────────────────

/** Map KERN column type to Prisma schema type. Strips @db.* decorators for non-PostgreSQL providers. */
function mapColumnToPrisma(kernType: string, provider: string): string {
  const mapped = mapSemanticType(kernType, 'prisma');
  if (provider !== 'postgresql') {
    return mapped.replace(/ @db\.\w+/g, '');
  }
  return mapped;
}

/**
 * Build a complete schema.prisma file from model IR nodes.
 * This runs ONLY in Express — not in the shared codegen path.
 */
function formatPrismaDefault(value: string): string {
  const trimmed = value.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return trimmed;
  if (trimmed === 'true' || trimmed === 'false') return trimmed;
  if (trimmed === 'uuid4()' || trimmed === 'uuid4') return 'uuid()';
  if (trimmed === 'now()' || trimmed === 'now') return 'now()';
  if (trimmed === 'autoincrement()' || trimmed === 'autoincrement') return 'autoincrement()';
  if (/^[A-Za-z_]\w*\([^)]*\)$/.test(trimmed)) return trimmed;
  return `"${trimmed}"`;
}

export function buildPrismaArtifact(modelNodes: IRNode[], config?: ResolvedKernConfig): GeneratedArtifact | null {
  if (modelNodes.length === 0) return null;

  const provider = config?.express?.prisma?.provider ?? 'postgresql';

  const lines: string[] = [
    'generator client {',
    '  provider = "prisma-client-js"',
    '}',
    '',
    'datasource db {',
    `  provider = "${provider}"`,
    '  url      = env("DATABASE_URL")',
    '}',
    '',
  ];

  for (const node of modelNodes) {
    const props = propsOf<'model'>(node);
    const name = props.name || 'UnknownModel';
    const table = props.table;
    const columns = getChildren(node, 'column');
    const relations = getChildren(node, 'relation');

    lines.push(`model ${name} {`);

    for (const col of columns) {
      const cp = propsOf<'column'>(col);
      const colName = cp.name || 'column';
      const rawType = mapColumnToPrisma(cp.type || 'String', provider);
      // Split off Prisma decorators embedded in the type (e.g., 'String @db.Uuid')
      const [prismaType, ...typeDecorators] = rawType.split(' ');
      const decorators: string[] = [...typeDecorators];
      const isPrimary = cp.primary === 'true' || cp.primary === true;
      const isUnique = cp.unique === 'true' || cp.unique === true;
      const isNullable = cp.nullable === 'true' || cp.nullable === true;
      const defaultVal = cp.default;

      if (isPrimary) decorators.push('@id');
      if (isUnique) decorators.push('@unique');
      if (defaultVal !== undefined) decorators.push(`@default(${formatPrismaDefault(defaultVal)})`);

      const nullMark = isNullable ? '?' : '';
      const decoStr = decorators.length > 0 ? ' ' + decorators.join(' ') : '';
      lines.push(`  ${colName} ${prismaType}${nullMark}${decoStr}`);
    }

    for (const rel of relations) {
      const rp = propsOf<'relation'>(rel);
      const relName = rp.name || 'relation';
      const target = rp.target || rp.model || 'Unknown';
      const kind = rp.kind || 'one-to-many';
      const fk = rp.foreignKey;

      if (kind === 'one-to-many' || kind === 'many-to-many') {
        lines.push(`  ${relName} ${target}[]`);
      } else {
        const relDeco = fk ? ` @relation(fields: [${fk}], references: [id])` : '';
        lines.push(`  ${relName} ${target}?${relDeco}`);
      }
    }

    if (table) {
      lines.push('');
      lines.push(`  @@map("${table}")`);
    }

    lines.push('}');
    lines.push('');
  }

  return { path: 'prisma/schema.prisma', content: lines.join('\n'), type: 'prisma' };
}

interface CoreArtifactRef {
  artifact: GeneratedArtifact;
  importPath: string;
  exportNames: string[];
}

function buildCoreArtifact(node: IRNode): CoreArtifactRef {
  const name = String((node.props || {}).name || node.type);
  const fileBase = slugify(name);
  const { dir, artifactType } = coreNodeMeta(node.type);
  const tsLines = generateCoreNode(node);
  const content = tsLines.join('\n');

  // Extract export names for the import line
  const exportNames: string[] = [];
  for (const line of tsLines) {
    const m = line.match(/^export (?:type |interface |function |const |class |enum |abstract class )(\w+)/);
    if (m) exportNames.push(m[1]);
  }

  return {
    importPath: `./${dir}/${fileBase}.js`,
    exportNames,
    artifact: {
      path: `${dir}/${fileBase}.ts`,
      content,
      type: artifactType,
    },
  };
}

export function transpileExpress(root: IRNode, _config?: ResolvedKernConfig): TranspileResult {
  const sourceMap: SourceMapEntry[] = [];
  const accounted = new Map<IRNode, AccountedEntry>();
  const middlewareArtifacts = new Map<string, MiddlewareArtifactRef>();
  const serverNode = findServerNode(root) || root;
  accountNode(accounted, root, 'consumed', 'parse root');
  if (serverNode !== root) accountNode(accounted, serverNode, 'consumed', 'server container');
  const serverProps = getProps(serverNode);
  const serverName = String(serverProps.name || 'KernExpressServer');
  const port = String(serverProps.port || '3000');
  const serverMiddlewares = getChildren(serverNode, 'middleware');
  for (const mw of serverMiddlewares) accountNode(accounted, mw, 'consumed', 'server middleware', true);
  const routeNodes = getChildren(serverNode, 'route');
  for (const rn of routeNodes) accountNode(accounted, rn, 'consumed', 'route artifact', true);

  const isStrict = !_config || _config.express.security === 'strict';
  const hasJsonMiddleware = serverMiddlewares.some(m => String(getProps(m).name || '') === 'json');

  const serverImports = new Set<string>();
  const serverMiddlewareInvocations: string[] = [];
  const dependencyComments: string[] = [];

  for (const middlewareNode of serverMiddlewares) {
    const usage = resolveMiddlewareUsage(middlewareNode, middlewareArtifacts, './', isStrict ? 'strict' : 'relaxed');
    if (usage.importLine) serverImports.add(usage.importLine);
    serverMiddlewareInvocations.push(usage.invocation);
  }

  // Helmet/compression: opt-in via config
  if (_config?.express.helmet) {
    serverImports.add(`import helmet from 'helmet';`);
    serverMiddlewareInvocations.unshift('helmet()');
    dependencyComments.push('helmet');
  }
  if (_config?.express.compression) {
    serverImports.add(`import compression from 'compression';`);
    serverMiddlewareInvocations.unshift('compression()');
    dependencyComments.push('compression');
  }

  // Collect top-level core language nodes (type, interface, service, config, etc.)
  // Core nodes may live as siblings of server under the parse root, or as server children.
  const rootChildren = root.children || [];
  const serverChildren = serverNode !== root ? (serverNode.children || []) : [];
  const coreNodes = [
    ...rootChildren.filter(c => TOP_LEVEL_CORE.has(c.type)),
    ...serverChildren.filter(c => TOP_LEVEL_CORE.has(c.type)),
  ];
  // If the root itself is a core node (parser wraps first top-level node as root), include it
  if (TOP_LEVEL_CORE.has(root.type) && root !== serverNode) {
    coreNodes.unshift(root);
  }
  const coreArtifactRefs = coreNodes.map(n => buildCoreArtifact(n));
  for (const cn of coreNodes) accountNode(accounted, cn, 'expressed', 'core artifact', true);

  const websocketNodes = getChildren(serverNode, 'websocket');
  for (const ws of websocketNodes) accountNode(accounted, ws, 'consumed', 'websocket handler', true);
  const routeArtifacts = routeNodes.map((routeNode, index) => buildRouteArtifact(routeNode, index, middlewareArtifacts, sourceMap));

  const lines: string[] = [];
  if (dependencyComments.length > 0) {
    lines.push(`// Dependencies: ${dependencyComments.join(', ')}`);
  }
  lines.push(`import express from 'express';`);
  lines.push(`import type { NextFunction, Request, Response } from 'express';`);
  if (websocketNodes.length > 0) {
    lines.push(`import { createServer } from 'http';`);
    lines.push(`import { WebSocketServer, type WebSocket } from 'ws';`);
  }
  for (const serverImport of [...serverImports].sort()) {
    lines.push(serverImport);
  }
  for (const routeArtifact of routeArtifacts) {
    lines.push(`import { ${routeArtifact.registerName} } from './routes/${routeArtifact.fileBase}.js';`);
  }
  for (const coreRef of coreArtifactRefs) {
    if (coreRef.exportNames.length > 0) {
      lines.push(`import { ${coreRef.exportNames.join(', ')} } from '${coreRef.importPath}';`);
    }
  }
  lines.push('');
  lines.push(`const app = express();`);
  lines.push(`const port = ${port};`);
  lines.push(`const serverName = '${escapeSingleQuotes(serverName)}';`);
  lines.push('');

  // Hardened defaults (strict mode)
  if (isStrict) {
    lines.push(`app.disable('x-powered-by');`);
    if (!hasJsonMiddleware) {
      lines.push(`app.use(express.json({ limit: '1mb' }));`);
    }
    lines.push('');
  }

  for (const invocation of serverMiddlewareInvocations) {
    lines.push(`app.use(${invocation});`);
  }
  if (serverMiddlewareInvocations.length > 0 && routeArtifacts.length > 0) {
    lines.push('');
  }
  for (const routeArtifact of routeArtifacts) {
    lines.push(`${routeArtifact.registerName}(app);`);
  }
  if (routeArtifacts.length > 0) {
    lines.push('');
  }

  // 404 handler (strict mode)
  if (isStrict) {
    lines.push(`app.use((_req: Request, res: Response) => {`);
    lines.push(`  res.status(404).json({ error: 'Not Found' });`);
    lines.push('});');
    lines.push('');
  }

  // Error handler — sanitized in strict mode, verbose in relaxed
  if (isStrict) {
    lines.push(`app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {`);
    lines.push(`  console.error(err);`);
    lines.push(`  res.status(500).json({ error: 'Internal Server Error' });`);
    lines.push('});');
  } else {
    lines.push(`app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {`);
    lines.push(`  const message = error instanceof Error ? error.message : 'Internal Server Error';`);
    lines.push(`  res.status(500).json({ error: message });`);
    lines.push('});');
  }

  // WebSocket support
  if (websocketNodes.length > 0) {
    lines.push('');
    lines.push(`const server = createServer(app);`);

    for (const wsNode of websocketNodes) {
      const wsProps = getProps(wsNode);
      const wsPath = String(wsProps.path || '/ws');
      const wsName = String(wsProps.name || 'ws');
      const wsOnNodes = getChildren(wsNode, 'on');

      lines.push(`const ${wsName}Server = new WebSocketServer({ server, path: '${wsPath}' });`);
      lines.push('');
      lines.push(`${wsName}Server.on('connection', (ws: WebSocket) => {`);

      // on event=connect
      const connectNode = wsOnNodes.find(n => {
        const e = String(getProps(n).event || getProps(n).name || '');
        return e === 'connect' || e === 'connection';
      });
      if (connectNode) {
        const handlerChild = getChildren(connectNode, 'handler')[0];
        const code = handlerChild ? String(getProps(handlerChild).code || '') : '';
        if (code) {
          for (const line of code.split('\n')) {
            lines.push(`  ${line}`);
          }
        }
      }

      // on event=message
      const messageNode = wsOnNodes.find(n => {
        const e = String(getProps(n).event || getProps(n).name || '');
        return e === 'message';
      });
      lines.push('');
      lines.push(`  ws.on('message', (raw: Buffer) => {`);
      lines.push(`    const data = JSON.parse(raw.toString());`);
      if (messageNode) {
        const handlerChild = getChildren(messageNode, 'handler')[0];
        const code = handlerChild ? String(getProps(handlerChild).code || '') : '';
        if (code) {
          for (const line of code.split('\n')) {
            lines.push(`    ${line}`);
          }
        }
      }
      lines.push(`  });`);

      // on event=error
      const errorNode = wsOnNodes.find(n => {
        const e = String(getProps(n).event || getProps(n).name || '');
        return e === 'error';
      });
      if (errorNode) {
        const handlerChild = getChildren(errorNode, 'handler')[0];
        const code = handlerChild ? String(getProps(handlerChild).code || '') : '';
        lines.push('');
        lines.push(`  ws.on('error', (error: Error) => {`);
        if (code) {
          for (const line of code.split('\n')) {
            lines.push(`    ${line}`);
          }
        }
        lines.push(`  });`);
      }

      // on event=disconnect/close
      const closeNode = wsOnNodes.find(n => {
        const e = String(getProps(n).event || getProps(n).name || '');
        return e === 'disconnect' || e === 'close';
      });
      lines.push('');
      lines.push(`  ws.on('close', () => {`);
      if (closeNode) {
        const handlerChild = getChildren(closeNode, 'handler')[0];
        const code = handlerChild ? String(getProps(handlerChild).code || '') : '';
        if (code) {
          for (const line of code.split('\n')) {
            lines.push(`    ${line}`);
          }
        }
      }
      lines.push(`  });`);

      lines.push(`});`);
    }

    lines.push('');
    lines.push(`server.listen(port, () => {`);
    lines.push(`  console.log(\`\${serverName} listening on port \${port}\`);`);
    lines.push('});');
  } else {
    lines.push('');
    lines.push(`app.listen(port, () => {`);
    lines.push(`  console.log(\`\${serverName} listening on port \${port}\`);`);
    lines.push('});');
  }
  lines.push('');
  lines.push('export default app;');

  sourceMap.unshift({
    irLine: serverNode.loc?.line || root.loc?.line || 0,
    irCol: serverNode.loc?.col || root.loc?.col || 1,
    outLine: 1,
    outCol: 1,
  });

  // Build Prisma schema artifact from model nodes
  const modelNodes = coreNodes.filter(n => n.type === 'model');
  const prismaArtifact = buildPrismaArtifact(modelNodes, _config);

  const artifacts: GeneratedArtifact[] = [
    ...routeArtifacts.map(route => route.artifact),
    ...[...middlewareArtifacts.values()].map(entry => entry.artifact),
    ...coreArtifactRefs.map(ref => ref.artifact),
    ...(prismaArtifact ? [prismaArtifact] : []),
  ];

  const output = lines.join('\n');
  const irText = serializeIR(root);
  const tsText = [output, ...artifacts.map(artifact => artifact.content)].join('\n');
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(tsText);
  const tokenReduction = Math.round((1 - irTokenCount / tsTokenCount) * 100);

  return {
    code: output,
    sourceMap,
    irTokenCount,
    tsTokenCount,
    tokenReduction,
    artifacts,
    diagnostics: buildDiagnostics(root, accounted, 'express'),
  };
}
