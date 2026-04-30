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
    } else if (handlerNode && handlerProps.lang === 'kern') {
      // Slice 4a — native KERN handler body (Python target). Same dispatch
      // pattern as `fn` codegen at packages/fastapi/src/generators/core.ts:
      //  - Path params are emitted camelCase as-is (line 300), so they
      //    pass through the body unchanged. NO symbol-map entry needed.
      //  - Query params ARE snake-cased in the signature (lines 307/309),
      //    so each camelCase→snake rename feeds the body symbol map.
      //  - Body emitter returns required imports (e.g. `math` ⇒
      //    `import math as __k_math`); we add them to the route's
      //    `imports` set so they land in the route file's import block.
      // Stream/timer routes still use raw bodies for now (slice 4 follow-up).
      const symbolMap: Record<string, string> = {};
      for (const qp of queryParams) {
        const snake = toSnakeCase(qp.name);
        if (snake !== qp.name) symbolMap[qp.name] = snake;
      }
      const { code: kernBody, imports: bodyImports } = emitNativeKernBodyPythonWithImports(handlerNode, { symbolMap });
      for (const mod of bodyImports) {
        imports.add(`import ${mod} as __k_${mod}`);
      }
      if (kernBody) {
        for (const kernLine of kernBody.split('\n')) {
          bodyLines.push(`    ${kernLine}`);
        }
      } else {
        bodyLines.push(`    return {"error": "Route handler not implemented"}`);
      }
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
