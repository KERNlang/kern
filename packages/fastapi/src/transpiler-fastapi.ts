/**
 * @kernlang/fastapi — FastAPI Python backend transpiler
 *
 * IR → Python/FastAPI multi-file output.
 * Blueprint: transpiler-express.ts — same IR nodes, same multi-file pattern, Python output.
 */

import type { ResolvedKernConfig, GeneratedArtifact, IRNode, SourceMapEntry, TranspileResult } from '@kernlang/core';
import { countTokens, serializeIR } from '@kernlang/core';
import { generatePythonCoreNode } from './codegen-python.js';
import { mapTsTypeToPython, toSnakeCase } from './type-map.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

// ── Helper types ─────────────────────────────────────────────────────────

interface MiddlewareArtifactRef {
  artifact: GeneratedArtifact;
  className: string;
  fileBase: string;
}

interface RouteArtifactRef {
  artifact: GeneratedArtifact;
  routerName: string;
  fileBase: string;
}

interface SchemaShape {
  body?: string;
  params?: string;
  query?: string;
  response?: string;
}

interface RouteCapabilities {
  hasStream: boolean;
  hasSpawn: boolean;
  hasTimer: boolean;
  streamNode?: IRNode;
  spawnNode?: IRNode;
  timerNode?: IRNode;
}

// ── IR helpers ───────────────────────────────────────────────────────────

function getProps(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function getChildren(node: IRNode, type: string): IRNode[] {
  return (node.children || []).filter(child => child.type === type);
}

function getFirstChild(node: IRNode, type: string): IRNode | undefined {
  return (node.children || []).find(child => child.type === type);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'generated';
}

function escapePyStr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Strip common leading whitespace, preserving relative indentation. */
function dedent(code: string): string {
  const lines = code.split('\n');
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length === 0) return code;
  const min = Math.min(...nonEmpty.map(l => l.match(/^(\s*)/)?.[1].length ?? 0));
  return lines.map(l => l.slice(min)).join('\n');
}

/** Indent handler code by a fixed prefix, preserving internal structure. */
function indentHandler(code: string, indent: string): string[] {
  const dedented = dedent(code);
  return dedented.split('\n')
    .filter(l => l.trim().length > 0)
    .map(l => `${indent}${l}`);
}

function findServerNode(root: IRNode): IRNode | undefined {
  if (root.type === 'server') return root;
  for (const child of root.children || []) {
    const found = findServerNode(child);
    if (found) return found;
  }
  return undefined;
}

function convertPath(expressPath: string): string {
  // :id → {id}
  return expressPath.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

function derivePathParams(path: string): string[] {
  const matches = path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g);
  return [...matches].map(match => match[1]);
}

function analyzeRouteCapabilities(routeNode: IRNode): RouteCapabilities {
  const streamNode = getFirstChild(routeNode, 'stream');
  const spawnNode = streamNode ? getFirstChild(streamNode, 'spawn') : undefined;
  const timerNode = getFirstChild(routeNode, 'timer');

  return {
    hasStream: !!streamNode,
    hasSpawn: !!spawnNode,
    hasTimer: !!timerNode,
    streamNode,
    spawnNode,
    timerNode,
  };
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

function routeFileBase(method: string, path: string, index: number): string {
  const base = slugify(`${method}_${path.replace(/[:/]/g, '_')}`);
  return base === 'generated' ? `route_${index}` : base;
}

// ── Pydantic schema model from inline type ───────────────────────────────

function buildPydanticModel(name: string, schemaType: string): string[] {
  const lines: string[] = [];
  const trimmed = schemaType.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return [];

  lines.push(`class ${name}(BaseModel):`);
  const inner = trimmed.slice(1, -1);
  for (const part of inner.split(',')) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const rawKey = part.slice(0, colonIdx).trim().replace(/['"?]/g, '');
    const rawType = part.slice(colonIdx + 1).trim();
    const isOptional = part.slice(0, colonIdx).trim().endsWith('?');
    const pyType = mapTsTypeToPython(rawType);
    if (isOptional) {
      lines.push(`    ${toSnakeCase(rawKey)}: ${pyType} | None = None`);
    } else {
      lines.push(`    ${toSnakeCase(rawKey)}: ${pyType}`);
    }
  }
  return lines;
}

// ── SSE Stream code generator ────────────────────────────────────────────

function generateStreamRoute(
  routeNode: IRNode,
  caps: RouteCapabilities,
  method: string,
  fastapiPath: string,
  pathParams: string[],
): string[] {
  const lines: string[] = [];
  const handlerNode = caps.streamNode ? getFirstChild(caps.streamNode!, 'handler') : undefined;
  const handlerProps = handlerNode ? getProps(handlerNode) : {};
  const handlerCode = typeof handlerProps.code === 'string' ? String(handlerProps.code) : '';

  const paramStr = pathParams.length > 0
    ? pathParams.map(p => `${p}: str`).join(', ')
    : '';

  lines.push(`@router.${method}("${fastapiPath}")`);
  lines.push(`async def ${toSnakeCase(method)}_${slugify(fastapiPath)}(${paramStr}):`);
  lines.push(`    async def event_generator():`);

  if (caps.hasSpawn && caps.spawnNode) {
    const spawnProps = getProps(caps.spawnNode);
    const binary = String(spawnProps.binary || 'echo');
    const args = spawnProps.args as string | undefined;
    const timeoutSec = Number(spawnProps.timeout) || 0;

    // Security: reject dynamic binary names
    if (binary.includes('{{') || binary.includes('req.') || binary.includes('request.')) {
      lines.push(`        # ERROR: Dynamic binary is not allowed for security. Use a static binary name.`);
      lines.push(`        yield "data: {\\"error\\": \\"Dynamic binary not allowed\\"}\\n\\n"`);
    } else {
      lines.push(`        process = await asyncio.create_subprocess_exec(`);
      lines.push(`            "${escapePyStr(binary)}",`);
      if (args) {
        const argsClean = args.replace(/^\[|\]$/g, '').split(',').map(a => a.trim().replace(/^['"]|['"]$/g, ''));
        for (const arg of argsClean) {
          lines.push(`            "${escapePyStr(arg)}",`);
        }
      }
      lines.push(`            stdout=asyncio.subprocess.PIPE,`);
      lines.push(`            stderr=asyncio.subprocess.PIPE,`);
      lines.push(`        )`);

      // stdout streaming with null guard
      const onNodes = getChildren(caps.spawnNode!, 'on');
      const stdoutHandler = onNodes.find(n => {
        const op = getProps(n);
        return String(op.name || op.event || '') === 'stdout';
      });
      lines.push(`        if process.stdout:`);
      if (stdoutHandler) {
        const stdoutHandlerNode = getFirstChild(stdoutHandler, 'handler');
        const stdoutCode = stdoutHandlerNode ? String(getProps(stdoutHandlerNode).code || '') : '';
        lines.push(`            async for chunk in process.stdout:`);
        if (stdoutCode) {
          lines.push(...indentHandler(stdoutCode, '                '));
        } else {
          lines.push(`                yield f"data: {chunk.decode()}\\n\\n"`);
        }
      } else {
        lines.push(`            async for chunk in process.stdout:`);
        lines.push(`                yield f"data: {chunk.decode()}\\n\\n"`);
      }
    }

    lines.push(`        await process.wait()`);
    if (timeoutSec > 0) {
      // Wrap with timeout
      lines.push(`        # timeout: ${timeoutSec}s`);
    }
  } else if (handlerCode) {
    lines.push(...indentHandler(handlerCode, '        '));
  } else {
    lines.push(`        yield "data: [DONE]\\n\\n"`);
  }

  lines.push(`    return StreamingResponse(`);
  lines.push(`        event_generator(),`);
  lines.push(`        media_type="text/event-stream",`);
  lines.push(`        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},`);
  lines.push(`    )`);

  return lines;
}

// ── Timer code generator ─────────────────────────────────────────────────

function generateTimerRoute(
  routeNode: IRNode,
  caps: RouteCapabilities,
  method: string,
  fastapiPath: string,
  pathParams: string[],
  handlerCode: string,
): string[] {
  const lines: string[] = [];
  const timerProps = getProps(caps.timerNode!);
  const timeoutSec = Number(Object.values(timerProps).find(v => typeof v === 'string' && !isNaN(Number(v))) || timerProps.timeout || 15);

  const timerHandlerNode = getFirstChild(caps.timerNode!, 'handler');
  const timerHandlerCode = timerHandlerNode ? String(getProps(timerHandlerNode).code || '') : '';

  const paramStr = pathParams.length > 0
    ? pathParams.map(p => `${p}: str`).join(', ')
    : '';

  lines.push(`@router.${method}("${fastapiPath}")`);
  lines.push(`async def ${toSnakeCase(method)}_${slugify(fastapiPath)}(${paramStr}):`);
  lines.push(`    async def _work():`);
  if (timerHandlerCode) {
    lines.push(...indentHandler(timerHandlerCode, '        '));
  }
  if (handlerCode) {
    lines.push(...indentHandler(handlerCode, '        '));
  }
  lines.push(`    try:`);
  lines.push(`        return await asyncio.wait_for(_work(), timeout=${timeoutSec})`);
  lines.push(`    except asyncio.TimeoutError:`);

  // Check for custom timeout handler
  const onTimeoutNode = (caps.timerNode!.children || []).find(c =>
    c.type === 'on' && (getProps(c).name === 'timeout' || getProps(c).event === 'timeout'),
  );
  if (onTimeoutNode) {
    const timeoutHandler = getFirstChild(onTimeoutNode, 'handler');
    const timeoutCode = timeoutHandler ? String(getProps(timeoutHandler).code || '') : '';
    if (timeoutCode) {
      lines.push(...indentHandler(timeoutCode, '        '));
    } else {
      lines.push(`        raise HTTPException(status_code=408, detail="Request timed out")`);
    }
  } else {
    lines.push(`        raise HTTPException(status_code=408, detail="Request timed out")`);
  }

  return lines;
}

// ── Route artifact builder ───────────────────────────────────────────────

function buildRouteArtifact(
  routeNode: IRNode,
  routeIndex: number,
  sourceMap: SourceMapEntry[],
): RouteArtifactRef {
  const props = getProps(routeNode);
  const method = String(props.method || 'get').toLowerCase();
  const normalizedMethod = HTTP_METHODS.has(method) ? method : 'get';
  const path = String(props.path || '/');
  const fastapiPath = convertPath(path);
  const fileBase = routeFileBase(normalizedMethod, path, routeIndex);
  const routerName = `${fileBase}_router`;
  const schema = buildSchema(getFirstChild(routeNode, 'schema'));
  const caps = analyzeRouteCapabilities(routeNode);
  const pathParams = derivePathParams(path);

  // Get handler code
  const handlerNode = caps.hasStream
    ? getFirstChild(caps.streamNode!, 'handler')
    : caps.hasTimer
      ? null
      : getFirstChild(routeNode, 'handler');
  const routeHandlerNode = getFirstChild(routeNode, 'handler');
  const handlerProps = handlerNode ? getProps(handlerNode) : {};
  const routeHandlerCode = routeHandlerNode ? String(getProps(routeHandlerNode).code || '') : '';
  const handlerCode = typeof handlerProps.code === 'string'
    ? String(handlerProps.code)
    : '';

  const lines: string[] = [];
  const imports = new Set<string>();

  imports.add('from fastapi import APIRouter');

  if (caps.hasStream) {
    imports.add('from fastapi.responses import StreamingResponse');
    imports.add('import asyncio');
  }
  if (caps.hasTimer) {
    imports.add('from fastapi import HTTPException');
    imports.add('import asyncio');
  }
  if (caps.hasSpawn) {
    imports.add('import asyncio');
  }

  // v3 route children: params, auth, validate, error
  const paramsNodes = getChildren(routeNode, 'params');
  const queryParams: Array<{ name: string; type: string; default?: string }> = [];
  for (const paramNode of paramsNodes) {
    const paramItems = getProps(paramNode).items as Array<{ name: string; type: string; default?: string }> | undefined;
    if (paramItems) queryParams.push(...paramItems);
  }

  const authNode = getFirstChild(routeNode, 'auth');
  const validateNode = getFirstChild(routeNode, 'validate');
  const errorNodes = getChildren(routeNode, 'error').filter(n => typeof getProps(n).status === 'number');

  // Auth requires Depends import
  if (authNode) {
    imports.add('from fastapi import Depends');
  }

  // Error responses require HTTPException
  if (errorNodes.length > 0) {
    imports.add('from fastapi import HTTPException');
  }

  // Schema — generate Pydantic models
  const modelLines: string[] = [];
  if (schema.body) {
    imports.add('from pydantic import BaseModel');
    const bodyModel = buildPydanticModel('RequestBody', schema.body);
    modelLines.push(...bodyModel);
    modelLines.push('');
  }
  if (schema.response) {
    imports.add('from pydantic import BaseModel');
    const respModel = buildPydanticModel('ResponseBody', schema.response);
    modelLines.push(...respModel);
    modelLines.push('');
  }

  // Write imports (must come after all imports.add() calls)
  for (const imp of [...imports].sort()) {
    lines.push(imp);
  }
  lines.push('');

  // Router
  lines.push(`router = APIRouter()`);
  lines.push('');

  // Model definitions
  if (modelLines.length > 0) {
    lines.push(...modelLines);
  }

  // Route handler
  if (caps.hasStream) {
    lines.push(...generateStreamRoute(routeNode, caps, normalizedMethod, fastapiPath, pathParams));
  } else if (caps.hasTimer && caps.timerNode) {
    lines.push(...generateTimerRoute(routeNode, caps, normalizedMethod, fastapiPath, pathParams, routeHandlerCode));
  } else {
    // Standard route — build function signature
    const paramParts: string[] = [];
    for (const param of pathParams) {
      paramParts.push(`${param}: str`);
    }

    // v3 query params with types and defaults
    for (const qp of queryParams) {
      const pyType = qp.type === 'number' ? 'int' : qp.type === 'boolean' ? 'bool' : 'str';
      if (qp.default !== undefined) {
        paramParts.push(`${toSnakeCase(qp.name)}: ${pyType} = ${qp.default}`);
      } else {
        paramParts.push(`${toSnakeCase(qp.name)}: ${pyType}`);
      }
    }

    if (schema.body) {
      paramParts.push('body: RequestBody');
    }

    // v3 validate — add schema as body param
    if (validateNode) {
      const validateSchema = String(getProps(validateNode).schema || '');
      if (validateSchema) {
        paramParts.push(`body: ${validateSchema}`);
      }
    }

    // v3 auth — add Depends(auth_required)
    if (authNode) {
      const authMode = String(getProps(authNode).mode || 'required');
      const authFunc = authMode === 'optional' ? 'auth_optional' : 'auth_required';
      paramParts.push(`user = Depends(${authFunc})`);
    }

    const paramStr = paramParts.join(', ');
    lines.push(`@router.${normalizedMethod}("${fastapiPath}")`);
    lines.push(`async def ${toSnakeCase(normalizedMethod)}_${slugify(fastapiPath)}(${paramStr}):`);

    // v3 error contract as docstring
    if (errorNodes.length > 0) {
      lines.push(`    """Errors: ${errorNodes.map(n => `${getProps(n).status} ${getProps(n).message || ''}`).join(', ')}"""`);
    }

    if (handlerCode) {
      lines.push(...indentHandler(handlerCode, '    '));
    } else if (routeHandlerCode) {
      lines.push(...indentHandler(routeHandlerCode, '    '));
    } else {
      lines.push(`    return {"error": "Route handler not implemented"}`);
    }
  }

  sourceMap.push({
    irLine: routeNode.loc?.line || 0,
    irCol: routeNode.loc?.col || 1,
    outLine: 1,
    outCol: 1,
  });

  return {
    routerName,
    fileBase,
    artifact: {
      path: `routes/${fileBase}.py`,
      content: lines.join('\n'),
      type: 'route',
    },
  };
}

// ── Middleware artifact builder ───────────────────────────────────────────

function buildMiddlewareArtifact(node: IRNode): MiddlewareArtifactRef {
  const props = getProps(node);
  const name = String(props.name || 'middleware');
  const fileBase = slugify(name);
  const className = name.charAt(0).toUpperCase() + name.slice(1) + 'Middleware';

  const handlerNode = getFirstChild(node, 'handler');
  const handlerProps = handlerNode ? getProps(handlerNode) : {};
  const handlerCode = typeof handlerProps.code === 'string' ? String(handlerProps.code) : '';

  const lines: string[] = [];
  lines.push('from starlette.middleware.base import BaseHTTPMiddleware');
  lines.push('from starlette.requests import Request');
  lines.push('from starlette.responses import Response');
  lines.push('');
  lines.push('');
  lines.push(`class ${className}(BaseHTTPMiddleware):`);
  lines.push(`    async def dispatch(self, request: Request, call_next) -> Response:`);
  if (handlerCode) {
    for (const line of handlerCode.split('\n')) {
      lines.push(`        ${line}`);
    }
  } else {
    lines.push('        response = await call_next(request)');
    lines.push('        return response');
  }

  return {
    className,
    fileBase,
    artifact: {
      path: `middleware/${fileBase}.py`,
      content: lines.join('\n'),
      type: 'middleware',
    },
  };
}

// ── Built-in middleware mapping ───────────────────────────────────────────

interface MiddlewareUsage {
  importLine?: string;
  addLine: string;
}

function resolveMiddlewareUsage(
  node: IRNode,
  middlewareArtifacts: Map<string, MiddlewareArtifactRef>,
): MiddlewareUsage {
  const props = getProps(node);
  const name = String(props.name || 'middleware');

  if (name === 'cors') {
    return {
      importLine: 'from fastapi.middleware.cors import CORSMiddleware',
      addLine: 'app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])',
    };
  }

  if (name === 'gzip') {
    return {
      importLine: 'from fastapi.middleware.gzip import GZipMiddleware',
      addLine: 'app.add_middleware(GZipMiddleware)',
    };
  }

  if (name === 'json') {
    // FastAPI handles JSON automatically via Pydantic — no-op
    return { addLine: '# JSON parsing handled automatically by FastAPI/Pydantic' };
  }

  // Custom middleware
  const existing = middlewareArtifacts.get(slugify(name));
  if (existing) {
    return {
      importLine: `from middleware.${existing.fileBase} import ${existing.className}`,
      addLine: `app.add_middleware(${existing.className})`,
    };
  }

  const created = buildMiddlewareArtifact(node);
  middlewareArtifacts.set(created.fileBase, created);
  return {
    importLine: `from middleware.${created.fileBase} import ${created.className}`,
    addLine: `app.add_middleware(${created.className})`,
  };
}

// ── WebSocket artifact builder ────────────────────────────────────────────

interface WebSocketArtifactRef {
  artifact: GeneratedArtifact;
  funcName: string;
  fileBase: string;
  wsPath: string;
}

function buildWebSocketArtifact(
  wsNode: IRNode,
  wsIndex: number,
  sourceMap: SourceMapEntry[],
): WebSocketArtifactRef {
  const props = getProps(wsNode);
  const wsPath = String(props.path || '/ws');
  const fileBase = slugify(`ws_${wsPath.replace(/[:/]/g, '_')}`) || `ws_${wsIndex}`;
  const funcName = `websocket_${slugify(wsPath.replace(/[:/]/g, '_'))}`;

  const onNodes = getChildren(wsNode, 'on');

  // Extract handler code per event
  let connectCode = '';
  let messageCode = '';
  let disconnectCode = '';

  for (const onNode of onNodes) {
    const onProps = getProps(onNode);
    const event = String(onProps.event || onProps.name || '');
    const handlerNode = getFirstChild(onNode, 'handler');
    const handlerProps = handlerNode ? getProps(handlerNode) : {};
    const code = typeof handlerProps.code === 'string' ? String(handlerProps.code) : '';

    if (event === 'connect') connectCode = code;
    else if (event === 'message') messageCode = code;
    else if (event === 'disconnect') disconnectCode = code;
  }

  const lines: string[] = [];

  // Imports
  lines.push('from fastapi import WebSocket');
  lines.push('from starlette.websockets import WebSocketDisconnect');
  lines.push('');

  // WebSocket endpoint function (standalone, will be mounted via app.websocket)
  lines.push(`async def ${funcName}(websocket: WebSocket):`);
  lines.push('    await websocket.accept()');

  // Connect handler
  if (connectCode) {
    lines.push(...indentHandler(connectCode, '    '));
  }

  // Message loop + disconnect
  lines.push('    try:');
  lines.push('        while True:');
  lines.push('            data = await websocket.receive_json()');
  if (messageCode) {
    lines.push(...indentHandler(messageCode, '            '));
  }
  lines.push('    except WebSocketDisconnect:');
  if (disconnectCode) {
    lines.push(...indentHandler(disconnectCode, '        '));
  } else {
    lines.push('        pass');
  }

  sourceMap.push({
    irLine: wsNode.loc?.line || 0,
    irCol: wsNode.loc?.col || 1,
    outLine: 1,
    outCol: 1,
  });

  return {
    funcName,
    fileBase,
    wsPath,
    artifact: {
      path: `ws/${fileBase}.py`,
      content: lines.join('\n'),
      type: 'websocket',
    },
  };
}

// ── Main transpiler ──────────────────────────────────────────────────────

export function transpileFastAPI(root: IRNode, _config?: ResolvedKernConfig): TranspileResult {
  const sourceMap: SourceMapEntry[] = [];
  const middlewareArtifacts = new Map<string, MiddlewareArtifactRef>();
  const serverNode = findServerNode(root) || root;
  const serverProps = getProps(serverNode);
  const serverName = String(serverProps.name || 'KernFastAPIServer');
  const port = String(serverProps.port || '8000');
  const serverMiddlewares = getChildren(serverNode, 'middleware');
  const routeNodes = getChildren(serverNode, 'route');
  const websocketNodes = getChildren(serverNode, 'websocket');

  const isStrict = !_config || (_config.fastapi?.security ?? 'strict') === 'strict';
  const corsEnabled = _config?.fastapi?.cors ?? false;
  const gzipEnabled = _config?.fastapi?.gzip ?? false;
  const uvicornHost = _config?.fastapi?.uvicorn?.host ?? '0.0.0.0';
  const uvicornReload = isStrict ? false : (_config?.fastapi?.uvicorn?.reload ?? false);
  const uvicornWorkers = _config?.fastapi?.uvicorn?.workers;

  // Collect top-level core language nodes (type, interface, fn, machine, etc.)
  // Exclude child-only types (field, transition, handler, describe, it, etc.)
  const TOP_LEVEL_CORE = new Set([
    'type', 'interface', 'fn', 'machine', 'error', 'module',
    'config', 'store', 'test', 'event', 'import', 'const',
    // Ground layer
    'derive', 'transform', 'action', 'guard', 'assume', 'invariant',
    'each', 'collect', 'branch', 'resolve', 'expect', 'recover',
  ]);
  const allChildren = serverNode.children || [];
  const coreNodes = allChildren.filter(c => TOP_LEVEL_CORE.has(c.type));

  const serverImports = new Set<string>();
  const middlewareLines: string[] = [];

  serverImports.add('from fastapi import FastAPI');
  if (!isStrict || routeNodes.some(r => {
    const caps = analyzeRouteCapabilities(r);
    return caps.hasTimer;
  })) {
    serverImports.add('from fastapi import HTTPException');
  }
  serverImports.add('import uvicorn');

  // Config-level cors/gzip
  if (corsEnabled) {
    serverImports.add('from fastapi.middleware.cors import CORSMiddleware');
    middlewareLines.push('app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])');
  }
  if (gzipEnabled) {
    serverImports.add('from fastapi.middleware.gzip import GZipMiddleware');
    middlewareLines.push('app.add_middleware(GZipMiddleware)');
  }

  // IR-level middleware
  for (const middlewareNode of serverMiddlewares) {
    const usage = resolveMiddlewareUsage(middlewareNode, middlewareArtifacts);
    if (usage.importLine) serverImports.add(usage.importLine);
    middlewareLines.push(usage.addLine);
  }

  // Build route artifacts
  const routeArtifacts = routeNodes.map((routeNode, index) =>
    buildRouteArtifact(routeNode, index, sourceMap),
  );

  // Build websocket artifacts
  const wsArtifacts = websocketNodes.map((wsNode, index) =>
    buildWebSocketArtifact(wsNode, index, sourceMap),
  );

  // WebSocket imports
  if (wsArtifacts.length > 0) {
    serverImports.add('from fastapi import WebSocket');
    serverImports.add('from starlette.websockets import WebSocketDisconnect');
  }

  // Route imports
  for (const route of routeArtifacts) {
    serverImports.add(`from routes.${route.fileBase} import router as ${route.routerName}`);
  }

  // WebSocket imports
  for (const ws of wsArtifacts) {
    serverImports.add(`from ws.${ws.fileBase} import ${ws.funcName}`);
  }

  // ── Generate main.py ──────────────────────────────────────────────────

  const lines: string[] = [];

  // Imports
  for (const imp of [...serverImports].sort()) {
    lines.push(imp);
  }
  lines.push('');

  // Core language nodes (models, types, etc.)
  if (coreNodes.length > 0) {
    lines.push('');
    for (const node of coreNodes) {
      const coreLines = generatePythonCoreNode(node);
      if (coreLines.length > 0) {
        lines.push(...coreLines);
        lines.push('');
      }
    }
  }

  // App instantiation
  lines.push(`app = FastAPI(title="${serverName}")`);
  lines.push('');

  // Middleware
  for (const mLine of middlewareLines) {
    lines.push(mLine);
  }
  if (middlewareLines.length > 0) {
    lines.push('');
  }

  // Router includes
  for (const route of routeArtifacts) {
    lines.push(`app.include_router(${route.routerName})`);
  }
  if (routeArtifacts.length > 0) {
    lines.push('');
  }

  // WebSocket route decorators
  for (const ws of wsArtifacts) {
    lines.push(`app.websocket("${ws.wsPath}")(${ws.funcName})`);
  }
  if (wsArtifacts.length > 0) {
    lines.push('');
  }

  // Error handlers
  if (isStrict) {
    lines.push('');
    lines.push('@app.exception_handler(Exception)');
    lines.push('async def global_exception_handler(request, exc):');
    lines.push('    from fastapi.responses import JSONResponse');
    lines.push('    return JSONResponse(status_code=500, content={"error": "Internal Server Error"})');
  } else {
    lines.push('');
    lines.push('@app.exception_handler(Exception)');
    lines.push('async def global_exception_handler(request, exc):');
    lines.push('    from fastapi.responses import JSONResponse');
    lines.push('    return JSONResponse(status_code=500, content={"error": str(exc)})');
  }

  lines.push('');
  lines.push('');
  lines.push('if __name__ == "__main__":');
  const uvicornOpts: string[] = [
    `app`,
    `host="${uvicornHost}"`,
    `port=${port}`,
  ];
  if (uvicornReload) uvicornOpts.push('reload=True');
  if (uvicornWorkers && uvicornWorkers > 1) uvicornOpts.push(`workers=${uvicornWorkers}`);
  lines.push(`    uvicorn.run(${uvicornOpts.join(', ')})`);

  // ── Assemble result ────────────────────────────────────────────────────

  sourceMap.unshift({
    irLine: serverNode.loc?.line || root.loc?.line || 0,
    irCol: serverNode.loc?.col || root.loc?.col || 1,
    outLine: 1,
    outCol: 1,
  });

  const artifacts: GeneratedArtifact[] = [
    ...routeArtifacts.map(r => r.artifact),
    ...wsArtifacts.map(w => w.artifact),
    ...[...middlewareArtifacts.values()].map(m => m.artifact),
  ];

  const output = lines.join('\n');
  const irText = serializeIR(root);
  const allText = [output, ...artifacts.map(a => a.content)].join('\n');
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(allText);
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
