/**
 * Route artifact builders for the FastAPI transpiler.
 *
 * generateStreamRoute  — SSE streaming route
 * generateTimerRoute   — timeout-wrapped route
 * buildRouteArtifact   — main route artifact builder
 */

import type { IRNode, SourceMapEntry } from '@kernlang/core';
import { getChildren, getFirstChild, getProps } from '@kernlang/core';
import { emitNativeKernBodyPythonWithImports } from './codegen-body-python.js';
import { generatePortableHandlerFastAPI } from './fastapi-portable.js';
import type { RouteArtifactRef, RouteCapabilities } from './fastapi-types.js';
import { HTTP_METHODS } from './fastapi-types.js';
import {
  analyzeRouteCapabilities,
  buildPydanticModel,
  buildSchema,
  convertPath,
  derivePathParams,
  escapePyStr,
  indentHandler,
  routeFileBase,
  slugify,
} from './fastapi-utils.js';
import { toSnakeCase } from './type-map.js';

// ── SSE Stream code generator ────────────────────────────────────────────

export function generateStreamRoute(
  _routeNode: IRNode,
  caps: RouteCapabilities,
  method: string,
  fastapiPath: string,
  pathParams: string[],
): string[] {
  const lines: string[] = [];
  const handlerNode = caps.streamNode ? getFirstChild(caps.streamNode!, 'handler') : undefined;
  const handlerProps = handlerNode ? getProps(handlerNode) : {};
  const handlerCode = typeof handlerProps.code === 'string' ? String(handlerProps.code) : '';

  const paramStr = pathParams.length > 0 ? pathParams.map((p) => `${p}: str`).join(', ') : '';

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
        const argsClean = args
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map((a) => a.trim().replace(/^['"]|['"]$/g, ''));
        for (const arg of argsClean) {
          lines.push(`            "${escapePyStr(arg)}",`);
        }
      }
      lines.push(`            stdout=asyncio.subprocess.PIPE,`);
      lines.push(`            stderr=asyncio.subprocess.PIPE,`);
      lines.push(`        )`);

      // stdout streaming with null guard
      const onNodes = getChildren(caps.spawnNode!, 'on');
      const stdoutHandler = onNodes.find((n) => {
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

export function generateTimerRoute(
  _routeNode: IRNode,
  caps: RouteCapabilities,
  method: string,
  fastapiPath: string,
  pathParams: string[],
  handlerCode: string,
): string[] {
  const lines: string[] = [];
  const timerProps = getProps(caps.timerNode!);
  const timeoutSec = Number(
    Object.values(timerProps).find((v) => typeof v === 'string' && !Number.isNaN(Number(v))) ||
      timerProps.timeout ||
      15,
  );

  const timerHandlerNode = getFirstChild(caps.timerNode!, 'handler');
  const timerHandlerCode = timerHandlerNode ? String(getProps(timerHandlerNode).code || '') : '';

  const paramStr = pathParams.length > 0 ? pathParams.map((p) => `${p}: str`).join(', ') : '';

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
  const onTimeoutNode = (caps.timerNode!.children || []).find(
    (c) => c.type === 'on' && (getProps(c).name === 'timeout' || getProps(c).event === 'timeout'),
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

function replaceJsLiteralsOutsideStrings(expr: string): string {
  let output = '';
  let index = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;

  while (index < expr.length) {
    const char = expr[index];

    if (quote) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      output += char;
      index += 1;
      continue;
    }

    if (/[A-Za-z_$]/.test(char)) {
      let end = index + 1;
      while (end < expr.length && /[\w$]/.test(expr[end])) end += 1;
      const word = expr.slice(index, end);
      output += word === 'true' ? 'True' : word === 'false' ? 'False' : word === 'null' ? 'None' : word;
      index = end;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function quoteObjectKeysOutsideStrings(expr: string): string {
  let output = '';
  let index = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;

  while (index < expr.length) {
    const char = expr[index];

    if (quote) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      output += char;
      index += 1;
      continue;
    }

    if (char !== '{' && char !== ',') {
      output += char;
      index += 1;
      continue;
    }

    output += char;
    index += 1;
    const whitespaceStart = index;
    while (index < expr.length && /\s/.test(expr[index])) index += 1;
    const whitespace = expr.slice(whitespaceStart, index);
    const keyStart = index;
    if (index < expr.length && /[A-Za-z_$]/.test(expr[index])) {
      index += 1;
      while (index < expr.length && /[\w$]/.test(expr[index])) index += 1;
      const key = expr.slice(keyStart, index);
      const afterKeyStart = index;
      while (index < expr.length && /\s/.test(expr[index])) index += 1;
      if (expr[index] === ':') {
        output += `${whitespace}"${key}"${expr.slice(afterKeyStart, index)}:`;
        index += 1;
        continue;
      }
    }

    output += whitespace;
    output += expr.slice(keyStart, index);
  }

  return output;
}

function lowerJsValueExpressionForPython(expr: string): string {
  return quoteObjectKeysOutsideStrings(replaceJsLiteralsOutsideStrings(expr.trim().replace(/;$/, '')));
}

function hasObjectShorthandOutsideStrings(expr: string): boolean {
  let index = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;

  while (index < expr.length) {
    const char = expr[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      index += 1;
      continue;
    }
    if (char !== '{' && char !== ',') {
      index += 1;
      continue;
    }
    index += 1;
    while (index < expr.length && /\s/.test(expr[index])) index += 1;
    if (index >= expr.length || !/[A-Za-z_$]/.test(expr[index])) continue;
    index += 1;
    while (index < expr.length && /[\w$]/.test(expr[index])) index += 1;
    while (index < expr.length && /\s/.test(expr[index])) index += 1;
    if (expr[index] === ',' || expr[index] === '}') return true;
  }

  return false;
}

function isUnsupportedJsHandlerBody(code: string): boolean {
  return (
    /\bres\./.test(code) ||
    /`/.test(code) ||
    /\?\./.test(code) ||
    /\?\?/.test(code) ||
    /=>/.test(code) ||
    hasObjectShorthandOutsideStrings(code)
  );
}

function unsupportedRawHandlerBody(indent: string): string[] {
  return [`${indent}raise NotImplementedError("Unsupported raw JavaScript handler syntax for FastAPI target")`];
}

function lowerRawHandlerBodyForPython(code: string, indent: string, imports: Set<string>): string[] | null {
  const statement = code.trim();
  if (!statement || statement.includes('\n')) return null;

  const statusJson =
    statement.match(/^(?:return\s+)?res\.status\((\d+)\)\.json\(([\s\S]*)\);?$/) ??
    statement.match(/^(?:return\s+)?response\.status\((\d+)\)\.json\(([\s\S]*)\);?$/);
  if (statusJson) {
    if (!statusJson[2].trim() || statusJson[2].includes('`') || hasObjectShorthandOutsideStrings(statusJson[2])) {
      return null;
    }
    imports.add('from fastapi.responses import JSONResponse');
    return [
      `${indent}return JSONResponse(content=${lowerJsValueExpressionForPython(statusJson[2])}, status_code=${statusJson[1]})`,
    ];
  }

  const json = statement.match(/^(?:return\s+)?res\.json\(([\s\S]*)\);?$/);
  if (json) {
    if (!json[1].trim() || json[1].includes('`') || hasObjectShorthandOutsideStrings(json[1])) return null;
    return [`${indent}return ${lowerJsValueExpressionForPython(json[1])}`];
  }

  const directReturn = statement.match(/^return\s+([\s\S]*?);?$/);
  if (directReturn) {
    if (directReturn[1].includes('`') || hasObjectShorthandOutsideStrings(directReturn[1])) return null;
    return [`${indent}return ${lowerJsValueExpressionForPython(directReturn[1])}`];
  }

  return null;
}

export function buildRouteArtifact(
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
  const hasPortableNodes =
    deriveNodes.length > 0 ||
    guardNodes.length > 0 ||
    !!respondNode ||
    branchNodes.length > 0 ||
    eachNodes.length > 0 ||
    collectNodes.length > 0 ||
    effectNodes.length > 0;

  // Get handler code
  const handlerNode = caps.hasStream
    ? getFirstChild(caps.streamNode!, 'handler')
    : caps.hasTimer
      ? null
      : getFirstChild(routeNode, 'handler');
  const routeHandlerNode = getFirstChild(routeNode, 'handler');
  const handlerProps = handlerNode ? getProps(handlerNode) : {};
  const routeHandlerCode = routeHandlerNode ? String(getProps(routeHandlerNode).code || '') : '';
  const handlerCode = typeof handlerProps.code === 'string' ? String(handlerProps.code) : '';

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
  const errorNodes = getChildren(routeNode, 'error').filter((n) => typeof getProps(n).status === 'number');

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

  // Slice 4a review fix (Codex+Gemini critical): stream/timer/portable
  // routes do not support `lang=kern` yet — fail loud at codegen instead
  // of silently swallowing the opt-in and emitting a broken handler.
  // For stream routes, the handler is nested inside `streamNode`; for
  // timer routes, inside `timerNode`. Resolve lang=kern off whichever
  // handler the route configuration points to.
  const streamHandlerNode = caps.streamNode ? getFirstChild(caps.streamNode, 'handler') : undefined;
  const timerHandlerNode = caps.timerNode ? getFirstChild(caps.timerNode, 'handler') : undefined;
  const isKernHandler =
    !caps.hasStream &&
    !caps.hasTimer &&
    handlerNode !== null &&
    handlerNode !== undefined &&
    handlerProps.lang === 'kern';
  if (caps.hasStream && streamHandlerNode && getProps(streamHandlerNode).lang === 'kern') {
    throw new Error(
      "FastAPI route 'stream' handler with lang=kern is not yet supported. " +
        'Use a non-stream route or a raw `<<<...>>>` body until slice 4c lands streaming response translation.',
    );
  }
  if (caps.hasTimer && timerHandlerNode && getProps(timerHandlerNode).lang === 'kern') {
    throw new Error(
      "FastAPI route 'timer' handler with lang=kern is not yet supported. " +
        'Use a non-timer route or a raw `<<<...>>>` body until slice 4c lands timer response translation.',
    );
  }
  if (isKernHandler && hasPortableNodes) {
    throw new Error(
      'FastAPI route has BOTH portable nodes (derive/guard/respond/branch/each/collect/effect) AND a `lang=kern` handler. ' +
        'Choose one path: portable nodes for declarative composition, or `lang=kern` for native KERN bodies.',
    );
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
      bodyLines.push(
        `    """Errors: ${errorNodes.map((n) => `${getProps(n).status} ${getProps(n).message || ''}`).join(', ')}"""`,
      );
    }

    if (hasPortableNodes) {
      bodyLines.push(...generatePortableHandlerFastAPI(routeNode, '    ', pathParams, imports));
    } else if (isKernHandler) {
      // Slice 4a — native KERN handler body (Python target).
      //  - Path params: camelCase as-is in the signature (line 300), so
      //    they pass through the body unchanged. NO symbol-map entry.
      //  - Query params: snake-cased in the signature (lines 307/309),
      //    so each camelCase→snake rename feeds the body symbol map.
      //  - Body emitter returns required imports (e.g. `math` ⇒
      //    `import math as __k_math`); aliased via slice 3 review fix.
      //  - propagateStyle: 'http-exception' (slice 4a review fix Gemini
      //    #5) so `?` err short-circuit raises HTTPException(500)
      //    instead of returning the err object as a 200-OK JSON body.
      //
      // Slice 4a review fix (OpenCode #1, Gemini #4) — collision detection.
      // Two query params that snake-case to the same Python name (e.g.
      // `xCount` + `x_count`) would emit `def f(x_count, x_count)` —
      // SyntaxError at import. Detect at codegen with a clear message.
      // Also detect path-vs-query name collisions (OpenCode #2, Gemini #4):
      // `/users/:id` + `params items=[{name:'id'}]` would emit two `id`
      // params in the signature.
      const claimedSnake = new Set<string>(pathParams);
      const symbolMap: Record<string, string> = {};
      for (const qp of queryParams) {
        const snake = toSnakeCase(qp.name);
        if (claimedSnake.has(snake)) {
          throw new Error(
            `KERN-FastAPI route codegen: query param '${qp.name}' snake-cases to '${snake}', which collides with another param on this route ` +
              '(another query param OR a path param of the same name). Rename one to disambiguate.',
          );
        }
        claimedSnake.add(snake);
        if (snake !== qp.name) symbolMap[qp.name] = snake;
      }
      const {
        code: kernBody,
        imports: bodyImports,
        usedPropagation,
        helpers: bodyHelpers,
      } = emitNativeKernBodyPythonWithImports(handlerNode, { symbolMap, propagateStyle: 'http-exception' });
      for (const mod of bodyImports) {
        imports.add(`import ${mod} as __k_${mod}`);
      }
      // PR-4 — runtime helpers (e.g. `_kern_pairs`) are emitted into the
      // imports block as raw multi-line defs; set semantics dedup across
      // multiple handlers in the same file, and Python is happy to declare
      // module-level helpers in any order before the route function defs.
      for (const helper of bodyHelpers) {
        imports.add(helper);
      }
      if (usedPropagation) {
        // Slice 4a review fix (Gemini #5) — `?` err is now translated
        // into HTTPException(500), so the import is required.
        imports.add('from fastapi import HTTPException');
      }
      if (kernBody) {
        for (const kernLine of kernBody.split('\n')) {
          bodyLines.push(`    ${kernLine}`);
        }
      } else {
        bodyLines.push(`    return {"error": "Route handler not implemented"}`);
      }
    } else if (handlerCode) {
      bodyLines.push(
        ...(lowerRawHandlerBodyForPython(handlerCode, '    ', imports) ??
          (isUnsupportedJsHandlerBody(handlerCode)
            ? unsupportedRawHandlerBody('    ')
            : indentHandler(handlerCode, '    '))),
      );
    } else if (routeHandlerCode) {
      bodyLines.push(
        ...(lowerRawHandlerBodyForPython(routeHandlerCode, '    ', imports) ??
          (isUnsupportedJsHandlerBody(routeHandlerCode)
            ? unsupportedRawHandlerBody('    ')
            : indentHandler(routeHandlerCode, '    '))),
      );
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
