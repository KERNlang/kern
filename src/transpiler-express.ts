import type { ResolvedKernConfig } from './config.js';
import type { GeneratedArtifact, IRNode, SourceMapEntry, TranspileResult } from './types.js';
import { camelKey, countTokens, serializeIR } from './utils.js';

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
): MiddlewareUsage {
  const props = getProps(node);
  const name = String(props.name || 'middleware');

  if (name === 'cors') {
    return { importLine: `import cors from 'cors';`, invocation: 'cors()' };
  }

  if (name === 'json') {
    return { invocation: 'express.json()' };
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
  const handlerNode = getFirstChild(routeNode, 'handler');
  const handlerProps = handlerNode ? getProps(handlerNode) : {};
  const handlerCode = typeof handlerProps.code === 'string'
    ? String(handlerProps.code)
    : `res.status(501).json({ error: 'Route handler not implemented' });`;

  const routeMiddleware = getChildren(routeNode, 'middleware');
  const routeImports = new Set<string>();
  const middlewareInvocations: string[] = [];

  let needsExpressDefaultImport = false;

  for (const middlewareNode of routeMiddleware) {
    const usage = resolveMiddlewareUsage(middlewareNode, middlewareArtifacts, '../');
    if (usage.importLine) routeImports.add(usage.importLine);
    if (usage.invocation === 'express.json()') needsExpressDefaultImport = true;
    middlewareInvocations.push(usage.invocation);
  }

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
  lines.push(`  app.${normalizedMethod}('${escapeSingleQuotes(path)}', ${middlewareInvocations.length > 0 ? `${middlewareInvocations.join(', ')}, ` : ''}async (req: ${requestType}, res: Response<ResponseBody>, next: NextFunction) => {`);
  lines.push('    try {');
  for (const validationLine of validationLines) {
    lines.push(`      ${validationLine}`);
  }
  lines.push(...indentBlock(handlerCode, '      '));
  lines.push('    } catch (error) {');
  lines.push('      next(error);');
  lines.push('    }');
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

  const serverImports = new Set<string>();
  const serverMiddlewareInvocations: string[] = [];

  for (const middlewareNode of serverMiddlewares) {
    const usage = resolveMiddlewareUsage(middlewareNode, middlewareArtifacts, './');
    if (usage.importLine) serverImports.add(usage.importLine);
    serverMiddlewareInvocations.push(usage.invocation);
  }

  const routeArtifacts = routeNodes.map((routeNode, index) => buildRouteArtifact(routeNode, index, middlewareArtifacts, sourceMap));

  const lines: string[] = [];
  lines.push(`import express from 'express';`);
  lines.push(`import type { NextFunction, Request, Response } from 'express';`);
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
  lines.push(`app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {`);
  lines.push(`  const message = error instanceof Error ? error.message : 'Internal Server Error';`);
  lines.push(`  res.status(500).json({ error: message });`);
  lines.push('});');
  lines.push('');
  lines.push(`app.listen(port, () => {`);
  lines.push(`  console.log(\`\${serverName} listening on port \${port}\`);`);
  lines.push('});');
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
