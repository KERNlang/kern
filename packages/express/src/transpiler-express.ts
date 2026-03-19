import type { ResolvedKernConfig, GeneratedArtifact, IRNode, SourceMapEntry, TranspileResult } from '@kernlang/core';
import { camelKey, countTokens, serializeIR } from '@kernlang/core';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete']);

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

function getProps(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function getChildren(node: IRNode, type: string): IRNode[] {
  return (node.children || []).filter(child => child.type === type);
}

function getFirstChild(node: IRNode, type: string): IRNode | undefined {
  return (node.children || []).find(child => child.type === type);
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

  // Get handler code — priority: stream handler > timer handler > route handler > 501
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
    : caps.hasStream || caps.hasTimer ? '' : `res.status(501).json({ error: 'Route handler not implemented' });`;

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
        middlewareInvocations.push(mwName);
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

  // v3 query params — extract with type coercion and defaults
  if (queryParams.length > 0) {
    for (const qp of queryParams) {
      const coerce = qp.type === 'number' ? 'Number' : qp.type === 'boolean' ? 'Boolean' : 'String';
      if (qp.default !== undefined) {
        lines.push(`    const ${qp.name} = req.query.${qp.name} !== undefined ? ${coerce}(req.query.${qp.name}) : ${qp.default};`);
      } else {
        lines.push(`    const ${qp.name} = ${coerce}(req.query.${qp.name});`);
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
    lines.push(...indentBlock(handlerCode, '      '));
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

export function transpileExpress(root: IRNode, _config?: ResolvedKernConfig): TranspileResult {
  const sourceMap: SourceMapEntry[] = [];
  const middlewareArtifacts = new Map<string, MiddlewareArtifactRef>();
  const serverNode = findServerNode(root) || root;
  const serverProps = getProps(serverNode);
  const serverName = String(serverProps.name || 'KernExpressServer');
  const port = String(serverProps.port || '3000');
  const serverMiddlewares = getChildren(serverNode, 'middleware');
  const routeNodes = getChildren(serverNode, 'route');

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

  const websocketNodes = getChildren(serverNode, 'websocket');
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

  const artifacts: GeneratedArtifact[] = [
    ...routeArtifacts.map(route => route.artifact),
    ...[...middlewareArtifacts.values()].map(entry => entry.artifact),
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
  };
}
