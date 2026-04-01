/**
 * @kernlang/fastapi — FastAPI Python backend transpiler
 *
 * IR → Python/FastAPI multi-file output.
 * Blueprint: transpiler-express.ts — same IR nodes, same multi-file pattern, Python output.
 */

import type { ResolvedKernConfig, GeneratedArtifact, IRNode, SourceMapEntry, TranspileResult, AccountedEntry } from '@kernlang/core';
import { countTokens, dedent, getChildren, getFirstChild, getProps, serializeIR, buildDiagnostics, accountNode } from '@kernlang/core';
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

// ── Portable respond node → FastAPI ──────────────────────────────────────

function generateRespondFastAPI(respondNode: IRNode, indent: string): string[] {
  const p = getProps(respondNode);
  const status = typeof p.status === 'number' ? p.status : undefined;
  const json = p.json as string | undefined;
  const error = p.error as string | undefined;
  const text = p.text as string | undefined;
  const redirect = p.redirect as string | undefined;

  if (redirect) {
    return [`${indent}return RedirectResponse(url="${escapePyStr(String(redirect))}")`];
  }
  if (error) {
    return [`${indent}raise HTTPException(status_code=${status || 500}, detail="${escapePyStr(String(error))}")`];
  }
  if (json) {
    if (!status || status === 200) {
      return [`${indent}return ${json}`];
    }
    return [`${indent}return JSONResponse(content=${json}, status_code=${status})`];
  }
  if (text) {
    if (!status || status === 200) {
      return [`${indent}return PlainTextResponse(content=${text})`];
    }
    return [`${indent}return PlainTextResponse(content=${text}, status_code=${status})`];
  }
  if (status === 204) {
    return [`${indent}return Response(status_code=204)`];
  }
  if (status) {
    return [`${indent}return Response(status_code=${status})`];
  }
  return [`${indent}return Response(status_code=200)`];
}

// ── Portable request reference rewriting → FastAPI ────────────────────────

function rewriteFastAPIExpr(expr: string, pathParams: string[]): string {
  let result = expr;
  // params.X → X (function param) for path params
  for (const param of pathParams) {
    result = result.replace(new RegExp(`\\bparams\\.${param}\\b`, 'g'), param);
  }
  // Fallback: any remaining params.X → X (for query params not in pathParams)
  result = result.replace(/\bparams\.([A-Za-z_]\w*)/g, '$1');
  // body.X → body.X (Pydantic model — already correct)
  // query.X → X (function param)
  result = result.replace(/\bquery\.([A-Za-z_]\w*)/g, '$1');
  // headers.X → request.headers.get("X")
  result = result.replace(/\bheaders\.([A-Za-z_][\w-]*)/g, (_m, key) => `request.headers.get("${key}")`);
  // effectName.result → effect_name (effect variables hold the result directly, snake_cased)
  result = result.replace(/\b([A-Za-z_]\w*)\.result\b/g, (_m, name) => toSnakeCase(name));
  return result;
}

// ── Portable handler generation (derive → guard → handler → respond) ─────

function extractExprCode(prop: unknown): string {
  if (typeof prop === 'object' && prop !== null && (prop as any).__expr) return (prop as any).code;
  return typeof prop === 'string' ? prop : '';
}

function addRespondImports(respondNode: IRNode, imports: Set<string>): void {
  const rp = getProps(respondNode);
  if (rp.redirect) imports.add('from fastapi.responses import RedirectResponse');
  if (rp.text) imports.add('from fastapi.responses import PlainTextResponse');
  if (typeof rp.status === 'number' && rp.status !== 200 && rp.json) imports.add('from fastapi.responses import JSONResponse');
  if (typeof rp.status === 'number' && !rp.json && !rp.text && !rp.redirect && !rp.error) imports.add('from fastapi.responses import Response');
  if (rp.error) imports.add('from fastapi import HTTPException');
}

function generatePortableChildFastAPI(
  child: IRNode,
  indent: string,
  pathParams: string[],
  imports: Set<string>,
): string[] {
  const lines: string[] = [];
  const p = getProps(child);

  switch (child.type) {
    case 'derive': {
      const name = String(p.name || '');
      const exprCode = extractExprCode(p.expr);
      if (name && exprCode) {
        lines.push(`${indent}${toSnakeCase(name)} = ${rewriteFastAPIExpr(exprCode, pathParams)}`);
      }
      break;
    }
    case 'guard': {
      const name = String(p.name || '');
      const exprCode = extractExprCode(p.expr);
      const elseStatus = p.else ? parseInt(String(p.else), 10) : 404;
      const elseMessage = typeof p.message === 'string' ? p.message : (name ? `${name} guard failed` : 'Guard failed');
      if (exprCode) {
        imports.add('from fastapi import HTTPException');
        lines.push(`${indent}if not (${rewriteFastAPIExpr(exprCode, pathParams)}):`);
        lines.push(`${indent}    raise HTTPException(status_code=${elseStatus}, detail="${escapePyStr(elseMessage)}")`);
      }
      break;
    }
    case 'handler': {
      const code = String(p.code || '');
      if (code) lines.push(...indentHandler(code, indent));
      break;
    }
    case 'respond': {
      // Clone props to avoid mutating shared AST, then rewrite portable refs
      const clonedRespond: IRNode = { ...child, props: { ...child.props } };
      if (clonedRespond.props!.json) clonedRespond.props!.json = rewriteFastAPIExpr(String(clonedRespond.props!.json), pathParams);
      if (clonedRespond.props!.text) clonedRespond.props!.text = rewriteFastAPIExpr(String(clonedRespond.props!.text), pathParams);
      addRespondImports(clonedRespond, imports);
      lines.push(...generateRespondFastAPI(clonedRespond, indent));
      break;
    }
    case 'branch': {
      const on = rewriteFastAPIExpr(String(p.on || ''), pathParams);
      const paths = getChildren(child, 'path');
      for (let i = 0; i < paths.length; i++) {
        const pathNode = paths[i];
        const pp = getProps(pathNode);
        const value = String(pp.value || '');
        const keyword = i === 0 ? 'if' : 'elif';
        lines.push(`${indent}${keyword} ${on} == "${escapePyStr(value)}":`);
        const bodyStart = lines.length;
        for (const pathChild of pathNode.children || []) {
          lines.push(...generatePortableChildFastAPI(pathChild, indent + '    ', pathParams, imports));
        }
        if (lines.length === bodyStart) lines.push(`${indent}    pass`);
      }
      break;
    }
    case 'each': {
      const name = String(p.name || 'item');
      const collection = rewriteFastAPIExpr(extractExprCode(p.in) || String(p.in || ''), pathParams);
      const index = p.index ? String(p.index) : undefined;
      if (index) {
        lines.push(`${indent}for ${index}, ${name} in enumerate(${collection}):`);
      } else {
        lines.push(`${indent}for ${name} in ${collection}:`);
      }
      const bodyStart = lines.length;
      for (const eachChild of child.children || []) {
        lines.push(...generatePortableChildFastAPI(eachChild, indent + '    ', pathParams, imports));
      }
      if (lines.length === bodyStart) lines.push(`${indent}    pass`);
      break;
    }
    case 'collect': {
      const rawName = toSnakeCase(String(p.name || ''));
      // Avoid shadowing Python built-ins
      const PY_BUILTINS = new Set(['sorted', 'list', 'dict', 'set', 'map', 'filter', 'type', 'id', 'input', 'print', 'range', 'len', 'min', 'max', 'sum', 'any', 'all']);
      const collectName = PY_BUILTINS.has(rawName) ? `${rawName}_result` : rawName;
      const from = rewriteFastAPIExpr(String(p.from || ''), pathParams);
      const where = p.where ? extractExprCode(p.where) : undefined;
      const limit = p.limit ? String(p.limit) : undefined;
      const order = p.order ? String(p.order) : undefined;
      if (where && !order && !limit) {
        lines.push(`${indent}${collectName} = [item for item in ${from} if ${rewriteFastAPIExpr(where, pathParams)}]`);
      } else {
        lines.push(`${indent}${collectName} = ${from}`);
        if (where) lines.push(`${indent}${collectName} = [item for item in ${collectName} if ${rewriteFastAPIExpr(where, pathParams)}]`);
        if (order) lines.push(`${indent}${collectName} = sorted(${collectName}, key=lambda item: ${rewriteFastAPIExpr(order, pathParams)})`);
        if (limit) lines.push(`${indent}${collectName} = ${collectName}[:${limit}]`);
      }
      break;
    }
    case 'effect': {
      const effectName = toSnakeCase(String(p.name || 'effect'));
      const triggerNode = getFirstChild(child, 'trigger');
      const recoverNode = getFirstChild(child, 'recover');
      const triggerProps = triggerNode ? getProps(triggerNode) : {};
      const triggerExpr = extractExprCode(triggerProps.expr) || String(triggerProps.query || triggerProps.url || triggerProps.call || '');
      const retryCount = recoverNode ? parseInt(String(getProps(recoverNode).retry || '0'), 10) : 0;
      const fallback = recoverNode ? String(getProps(recoverNode).fallback || 'None') : 'None';
      const pyFallback = fallback === 'null' ? 'None' : fallback;

      if (retryCount > 0) {
        lines.push(`${indent}${effectName} = ${pyFallback}`);
        lines.push(`${indent}for _attempt in range(${retryCount}):`);
        lines.push(`${indent}    try:`);
        lines.push(`${indent}        ${effectName} = ${rewriteFastAPIExpr(triggerExpr, pathParams)}`);
        lines.push(`${indent}        break`);
        lines.push(`${indent}    except Exception:`);
        lines.push(`${indent}        if _attempt == ${retryCount - 1}:`);
        lines.push(`${indent}            ${effectName} = ${pyFallback}`);
      } else {
        lines.push(`${indent}try:`);
        lines.push(`${indent}    ${effectName} = ${rewriteFastAPIExpr(triggerExpr, pathParams)}`);
        lines.push(`${indent}except Exception:`);
        lines.push(`${indent}    ${effectName} = ${pyFallback}`);
      }
      break;
    }
    default:
      break;
  }

  return lines;
}

function generatePortableHandlerFastAPI(
  routeNode: IRNode,
  indent: string,
  pathParams: string[],
  imports: Set<string>,
): string[] {
  const lines: string[] = [];
  const children = routeNode.children || [];

  // Walk all route children in document order
  const PORTABLE_TYPES = new Set(['derive', 'guard', 'handler', 'respond', 'branch', 'each', 'collect', 'effect']);
  for (const child of children) {
    if (PORTABLE_TYPES.has(child.type)) {
      lines.push(...generatePortableChildFastAPI(child, indent, pathParams, imports));
    }
  }

  return lines;
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

  // v3 route children: params, auth, validate, error, middleware
  const paramsNodes = getChildren(routeNode, 'params');
  const queryParams: Array<{ name: string; type: string; default?: string }> = [];
  for (const paramNode of paramsNodes) {
    const paramItems = getProps(paramNode).items as Array<{ name: string; type: string; default?: string }> | undefined;
    if (paramItems) queryParams.push(...paramItems);
  }

  // Route-level middleware → Depends() in FastAPI
  const routeMiddleware = getChildren(routeNode, 'middleware');
  const middlewareDeps: string[] = [];
  for (const mwNode of routeMiddleware) {
    const mwProps = getProps(mwNode);
    const mwNames = mwProps.names as string[] | undefined;
    if (mwNames && Array.isArray(mwNames)) {
      for (const mwName of mwNames) {
        middlewareDeps.push(toSnakeCase(mwName));
      }
    } else if (mwProps.name) {
      middlewareDeps.push(toSnakeCase(String(mwProps.name)));
    }
  }
  if (middlewareDeps.length > 0) {
    imports.add('from fastapi import Depends');
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

  // Generate handler body lines first (may add to imports)
  const bodyLines: string[] = [];

  // Route handler
  if (caps.hasStream) {
    bodyLines.push(...generateStreamRoute(routeNode, caps, normalizedMethod, fastapiPath, pathParams));
  } else if (caps.hasTimer && caps.timerNode) {
    bodyLines.push(...generateTimerRoute(routeNode, caps, normalizedMethod, fastapiPath, pathParams, routeHandlerCode));
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

    // v3 validate — method-aware: body param for POST/PUT/PATCH, Depends for GET/DELETE
    if (validateNode && !schema.body) {
      const validateSchema = String(getProps(validateNode).schema || '');
      if (validateSchema) {
        const bodyMethods = new Set(['post', 'put', 'patch']);
        if (bodyMethods.has(normalizedMethod)) {
          paramParts.push(`body: ${validateSchema}`);
        } else {
          imports.add('from fastapi import Depends');
          paramParts.push(`validated = Depends(${toSnakeCase(validateSchema)})`);
        }
      }
    }

    // v3 route-level middleware → Depends()
    for (const dep of middlewareDeps) {
      paramParts.push(`_${dep} = Depends(${dep})`);
    }

    // v3 auth — add Depends(auth_required)
    if (authNode) {
      const authMode = String(getProps(authNode).mode || 'required');
      const authFunc = authMode === 'optional' ? 'auth_optional' : 'auth_required';
      paramParts.push(`user = Depends(${authFunc})`);
    }

    const paramStr = paramParts.join(', ');
    bodyLines.push(`@router.${normalizedMethod}("${fastapiPath}")`);
    bodyLines.push(`async def ${toSnakeCase(normalizedMethod)}_${slugify(fastapiPath)}(${paramStr}):`);

    // v3 error contract as docstring
    if (errorNodes.length > 0) {
      bodyLines.push(`    """Errors: ${errorNodes.map(n => `${getProps(n).status} ${getProps(n).message || ''}`).join(', ')}"""`);
    }

    if (hasPortableNodes) {
      bodyLines.push(...generatePortableHandlerFastAPI(routeNode, '    ', pathParams, imports));
    } else if (handlerCode) {
      bodyLines.push(...indentHandler(handlerCode, '    '));
    } else if (routeHandlerCode) {
      bodyLines.push(...indentHandler(routeHandlerCode, '    '));
    } else {
      bodyLines.push(`    return {"error": "Route handler not implemented"}`);
    }
  }

  // Write imports (after all imports.add() calls, including from portable handler)
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

  // Append handler body
  lines.push(...bodyLines);

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

function buildCorsMiddlewareLine(isStrict: boolean): string {
  return isStrict
    ? 'app.add_middleware(CORSMiddleware, allow_origins=[origin.strip() for origin in os.environ.get("CORS_ORIGINS", "").split(",") if origin.strip()], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])'
    : 'app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])';
}

function resolveMiddlewareUsage(
  node: IRNode,
  middlewareArtifacts: Map<string, MiddlewareArtifactRef>,
  isStrict = false,
): MiddlewareUsage {
  const props = getProps(node);
  const name = String(props.name || 'middleware');

  if (name === 'cors') {
    return {
      importLine: 'from fastapi.middleware.cors import CORSMiddleware',
      addLine: buildCorsMiddlewareLine(isStrict),
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

  if (name === 'rateLimit' || name === 'rate-limit' || name === 'rateLimiter') {
    return {
      importLine: 'from slowapi import Limiter, _rate_limit_exceeded_handler\nfrom slowapi.util import get_remote_address\nfrom slowapi.errors import RateLimitExceeded',
      addLine: 'limiter = Limiter(key_func=get_remote_address)\napp.state.limiter = limiter\napp.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)',
    };
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
  lines.push('import json');
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
  lines.push('            try:');
  lines.push('                data = json.loads(await websocket.receive_text())');
  lines.push('            except json.JSONDecodeError:');
  lines.push('                await websocket.send_json({"error": "Invalid JSON payload"})');
  lines.push('                continue');
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
  const accounted = new Map<IRNode, AccountedEntry>();
  const middlewareArtifacts = new Map<string, MiddlewareArtifactRef>();
  const serverNode = findServerNode(root) || root;
  accountNode(accounted, root, 'consumed', 'parse root');
  if (serverNode !== root) accountNode(accounted, serverNode, 'consumed', 'server container');
  const serverProps = getProps(serverNode);
  const serverName = String(serverProps.name || 'KernFastAPIServer');
  const port = String(serverProps.port || '8000');
  const serverMiddlewares = getChildren(serverNode, 'middleware');
  for (const mw of serverMiddlewares) accountNode(accounted, mw, 'consumed', 'server middleware', true);
  const routeNodes = getChildren(serverNode, 'route');
  for (const rn of routeNodes) accountNode(accounted, rn, 'consumed', 'route artifact', true);
  const websocketNodes = getChildren(serverNode, 'websocket');
  for (const ws of websocketNodes) accountNode(accounted, ws, 'consumed', 'websocket handler', true);
  const hasHealthRoute = routeNodes.some((routeNode) => {
    const props = getProps(routeNode);
    return String(props.path || '/') === '/health' && String(props.method || 'get').toLowerCase() === 'get';
  });

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
    // Data layer
    'model', 'repository', 'cache', 'dependency', 'service', 'union',
    // Backend infrastructure
    'job', 'storage', 'email',
    // Ground layer
    'derive', 'transform', 'action', 'guard', 'assume', 'invariant',
    'each', 'collect', 'branch', 'resolve', 'expect', 'recover',
  ]);
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
  for (const cn of coreNodes) accountNode(accounted, cn, 'expressed', 'core artifact', true);

  const serverImports = new Set<string>();
  const middlewareLines: string[] = [];

  serverImports.add('from fastapi import FastAPI');
  if (!isStrict || routeNodes.some(r => {
    const caps = analyzeRouteCapabilities(r);
    return caps.hasTimer;
  })) {
    serverImports.add('from fastapi import HTTPException');
  }
  if (isStrict) {
    serverImports.add('import logging');
    serverImports.add('from uuid import uuid4');
  }
  serverImports.add('import uvicorn');

  // Config-level cors/gzip
  if (corsEnabled) {
    if (isStrict) serverImports.add('import os');
    serverImports.add('from fastapi.middleware.cors import CORSMiddleware');
    middlewareLines.push(buildCorsMiddlewareLine(isStrict));
  }
  if (gzipEnabled) {
    serverImports.add('from fastapi.middleware.gzip import GZipMiddleware');
    middlewareLines.push('app.add_middleware(GZipMiddleware)');
  }

  // IR-level middleware
  for (const middlewareNode of serverMiddlewares) {
    if (isStrict && String(getProps(middlewareNode).name || '') === 'cors') {
      serverImports.add('import os');
    }
    const usage = resolveMiddlewareUsage(middlewareNode, middlewareArtifacts, isStrict);
    if (usage.importLine) serverImports.add(usage.importLine);
    middlewareLines.push(usage.addLine);
  }

  // Build route artifacts
  const routeArtifacts = routeNodes.map((routeNode, index) =>
    buildRouteArtifact(routeNode, index, sourceMap),
  );

  // Auth: generate auth.py artifact when any route uses auth
  const hasAuth = routeNodes.some(r => getFirstChild(r, 'auth'));
  let authArtifact: GeneratedArtifact | null = null;
  if (hasAuth) {
    authArtifact = {
      path: 'auth.py',
      content: [
        `from fastapi import Depends, HTTPException`,
        `from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials`,
        `from jose import JWTError, jwt`,
        `import os`,
        ``,
        ...(isStrict
          ? [
              `JWT_SECRET = os.environ.get("JWT_SECRET")`,
              ``,
              `if not JWT_SECRET:`,
              `    raise RuntimeError("JWT_SECRET environment variable is required in strict mode")`,
            ]
          : [`JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-production")`]),
        `JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")`,
        ``,
        `security = HTTPBearer()`,
        `security_optional = HTTPBearer(auto_error=False)`,
        ``,
        ``,
        `async def auth_required(`,
        `    credentials: HTTPAuthorizationCredentials = Depends(security),`,
        `) -> dict:`,
        `    try:`,
        `        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])`,
        `        return payload`,
        `    except JWTError:`,
        `        raise HTTPException(status_code=401, detail="Invalid or expired token")`,
        ``,
        ``,
        `async def auth_optional(`,
        `    credentials: HTTPAuthorizationCredentials | None = Depends(security_optional),`,
        `) -> dict | None:`,
        `    if not credentials:`,
        `        return None`,
        `    try:`,
        `        return jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])`,
        `    except JWTError:`,
        `        return None`,
      ].join('\n'),
      type: 'lib' as GeneratedArtifact['type'],
    };
    serverImports.add('from auth import auth_required, auth_optional');
  }

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

  // Collect imports needed by core language nodes
  const coreTypes = new Set(coreNodes.map(n => n.type));
  const hasExplicitDb = coreNodes.some(n => n.type === 'dependency' && String((n.props || {}).kind) === 'database');
  if (coreTypes.has('model')) {
    serverImports.add('from sqlmodel import SQLModel, Field, Relationship');
    // Implicit DB connection: add engine/session imports when models exist but no explicit database dependency
    if (!hasExplicitDb) {
      serverImports.add('import os');
      serverImports.add('from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession');
      serverImports.add('from sqlalchemy.orm import sessionmaker');
    }
  }
  if (coreTypes.has('union')) {
    serverImports.add('from pydantic import BaseModel');
    serverImports.add('from typing import Literal, Union');
  }
  if (coreTypes.has('repository')) {
    serverImports.add('from sqlalchemy.ext.asyncio import AsyncSession');
  }
  // Scan model columns for type-specific imports
  for (const node of coreNodes) {
    if (node.type === 'model') {
      for (const col of getChildren(node, 'column')) {
        const colType = (col.props?.type as string) || '';
        if (colType === 'uuid') serverImports.add('from uuid import UUID');
        if (['date', 'datetime', 'timestamp', 'Timestamp'].includes(colType)) serverImports.add('from datetime import date, datetime');
        if (['decimal', 'Money'].includes(colType)) serverImports.add('from decimal import Decimal');
        if (colType === 'json') serverImports.add('from typing import Any');
      }
    }
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

  // Implicit DB connection boilerplate (when models exist but no explicit database dependency)
  if (coreTypes.has('model') && !hasExplicitDb) {
    lines.push('# Database connection');
    lines.push('DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./app.db")');
    lines.push('engine = create_async_engine(DATABASE_URL, echo=False)');
    lines.push('async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)');
    lines.push('');
    lines.push('');
    lines.push('async def get_db():');
    lines.push('    async with async_session() as session:');
    lines.push('        yield session');
    lines.push('');
    lines.push('');
    lines.push('async def init_db():');
    lines.push('    async with engine.begin() as conn:');
    lines.push('        await conn.run_sync(SQLModel.metadata.create_all)');
    lines.push('');
  }

  // App instantiation
  lines.push(`app = FastAPI(title="${serverName}")`);
  lines.push('');

  // DB startup event
  if (coreTypes.has('model') && !hasExplicitDb) {
    lines.push('');
    lines.push('@app.on_event("startup")');
    lines.push('async def startup():');
    lines.push('    await init_db()');
    lines.push('');
  }

  // Request ID middleware (strict mode)
  if (isStrict) {
    lines.push('');
    lines.push('@app.middleware("http")');
    lines.push('async def add_request_id(request, call_next):');
    lines.push('    request_id = str(uuid4())');
    lines.push('    request.state.request_id = request_id');
    lines.push('    response = await call_next(request)');
    lines.push('    response.headers["X-Request-ID"] = request_id');
    lines.push('    return response');
    lines.push('');
  }

  // Middleware
  for (const mLine of middlewareLines) {
    lines.push(mLine);
  }
  if (middlewareLines.length > 0) {
    lines.push('');
  }

  // Health check — before user routes so it can't be shadowed by catch-all
  if (isStrict && !hasHealthRoute) {
    lines.push('@app.get("/health")');
    lines.push('async def health_check():');
    lines.push('    return {"status": "ok"}');
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
    lines.push('    logging.exception("Unhandled exception")');
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
  const uvicornTarget = uvicornReload || (uvicornWorkers !== undefined && uvicornWorkers > 1) ? '"main:app"' : 'app';
  const uvicornOpts: string[] = [
    uvicornTarget,
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

  // Alembic migration scaffolding when models exist
  const alembicArtifacts: GeneratedArtifact[] = [];
  if (coreTypes.has('model')) {
    alembicArtifacts.push({
      path: 'alembic.ini',
      content: [
        '# Generated by KERN. Run migrations:',
        '#   alembic revision --autogenerate -m "init"',
        '#   alembic upgrade head',
        '',
        '[alembic]',
        'script_location = alembic',
        'sqlalchemy.url = sqlite+aiosqlite:///./app.db',
      ].join('\n'),
      type: 'config',
    });
    alembicArtifacts.push({
      path: 'alembic/env.py',
      content: [
        `from logging.config import fileConfig`,
        `from sqlalchemy import engine_from_config, pool`,
        `from alembic import context`,
        `from sqlmodel import SQLModel`,
        ``,
        `# Import models so metadata is populated`,
        `from main import *  # noqa: F403`,
        ``,
        `config = context.config`,
        `if config.config_file_name is not None:`,
        `    fileConfig(config.config_file_name)`,
        ``,
        `target_metadata = SQLModel.metadata`,
        ``,
        ``,
        `def run_migrations_offline():`,
        `    url = config.get_main_option("sqlalchemy.url")`,
        `    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)`,
        `    with context.begin_transaction():`,
        `        context.run_migrations()`,
        ``,
        ``,
        `def run_migrations_online():`,
        `    connectable = engine_from_config(`,
        `        config.get_section(config.config_ini_section, {}),`,
        `        prefix="sqlalchemy.",`,
        `        poolclass=pool.NullPool,`,
        `    )`,
        `    with connectable.connect() as connection:`,
        `        context.configure(connection=connection, target_metadata=target_metadata)`,
        `        with context.begin_transaction():`,
        `            context.run_migrations()`,
        ``,
        ``,
        `if context.is_offline_mode():`,
        `    run_migrations_offline()`,
        `else:`,
        `    run_migrations_online()`,
      ].join('\n'),
      type: 'config',
    });
  }

  const artifacts: GeneratedArtifact[] = [
    ...routeArtifacts.map(r => r.artifact),
    ...wsArtifacts.map(w => w.artifact),
    ...[...middlewareArtifacts.values()].map(m => m.artifact),
    ...(authArtifact ? [authArtifact] : []),
    ...alembicArtifacts,
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
    diagnostics: buildDiagnostics(root, accounted, 'fastapi'),
  };
}
