/**
 * FastAPI adapter — revised contract (post nero red-team).
 *
 * Takes a list of framework-agnostic `PurePythonHandler` values and emits a
 * FastAPI app skin that wraps each handler in a decorated endpoint. The
 * adapter does ONLY marshalling — it builds a `PureRequest` dict from
 * FastAPI's `Request` + path/query/body, calls the pure handler, unpacks
 * the `PureResponse` tuple, and returns a `JSONResponse`. ROUTE LOWERING
 * STAYS IN THE PURE HANDLER (the adapter never re-implements derive/guard/
 * respond — that's the whole point of decoupling).
 *
 * Adapter responsibilities (the ONLY things it does):
 *   1. Wire path params from FastAPI's typed signature into PureRequest.path_params
 *      (using `PurePythonHandler.pathParamTypes` for coercion).
 *   2. Wire query params from `request.query_params` into PureRequest.query
 *      (using `PurePythonHandler.queryParamTypes` for coercion).
 *   3. Wire body — if `validatesSchema` is set, attach the existing Pydantic
 *      model as a FastAPI body param; pass `.model_dump()` into the dict.
 *      Else: `await request.json()` if content-type is JSON, else raw bytes.
 *   4. Build the PureRequest dict.
 *   5. Call the pure handler `fnName(pure_request)`.
 *   6. Unpack `(status, body[, headers])` → `JSONResponse(content=body, status_code=status, headers=headers or {})`.
 *
 * Acceptance (Phase 3a smoke + Wave 3 end-to-end):
 *   - Synthetic PureRequest fixture (hand-built in the smoke, not from any
 *     framework) → pure handler returns expected (status, body).
 *   - The existing fastapi conformance suite (194/194 fixtures) passes when
 *     routed through `pure-python + this adapter` pipeline (Wave 3).
 *
 * The current monolithic `transpiler-fastapi.ts` stays as the default until
 * Phase 3a + Phase 2 both land and a follow-up flips the wiring. This phase
 * only ADDS the adapter; it does not remove the monolith.
 */

import type { PurePythonHandler } from '../core/handlers/index.js';

export interface FastAPIAdapterArtifacts {
  /** Python source for the FastAPI app file (imports, `app = FastAPI()`, decorated endpoints). */
  appPy: string;
  /** Python source for the pure-handlers module (re-emitted as a sibling .py file the adapter imports). Phase 3a's smoke uses a synthetic version of this; in production the python target writes the real one. */
  pureHandlersPy: string;
  /** Imports the ADAPTER itself needs at the top of appPy. */
  imports: Set<string>;
}

export function emitFastAPIAdapter(handlers: PurePythonHandler[]): FastAPIAdapterArtifacts {
  const imports = new Set<string>([
    'from fastapi import FastAPI, Request',
    'from fastapi.responses import JSONResponse',
  ]);

  const appPyLines: string[] = [];

  // Add standard imports for FastAPI
  appPyLines.push('from fastapi import FastAPI, Request');
  appPyLines.push('from fastapi.responses import JSONResponse');

  // Import each pure handler and its validatesSchema model (if any) from the pure_handlers module
  // Use try-except to support both absolute and relative imports across different runtime environments
  for (const handler of handlers) {
    appPyLines.push('try:');
    appPyLines.push(`    from .pure_handlers import ${handler.fnName}`);
    appPyLines.push('except ImportError:');
    appPyLines.push(`    from pure_handlers import ${handler.fnName}`);

    if (handler.validatesSchema) {
      appPyLines.push('try:');
      appPyLines.push(`    from .pure_handlers import ${handler.validatesSchema}`);
      appPyLines.push('except ImportError:');
      appPyLines.push(`    from pure_handlers import ${handler.validatesSchema}`);
    }
  }

  appPyLines.push('');
  appPyLines.push('app = FastAPI()');
  appPyLines.push('');

  function mapPythonType(typeStr: string | undefined): string {
    if (!typeStr) return 'str';
    const t = typeStr.trim().toLowerCase();
    if (t === 'string') return 'str';
    if (t === 'number') return 'float';
    if (t === 'boolean') return 'bool';
    if (t === 'integer') return 'int';
    return typeStr;
  }

  for (const handler of handlers) {
    // Convert path param style from KERN (:param) to FastAPI ({param})
    const pathWithFastapiBraces = handler.path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}');

    // Extract path param names
    const paramMatches = handler.path.match(/:([a-zA-Z0-9_]+)/g) || [];
    const paramNames = paramMatches.map((m) => m.slice(1));

    // Map path params to typed parameters
    const typedPathParams = paramNames.map((name) => {
      const type = handler.pathParamTypes[name] || 'str';
      return `${name}: ${mapPythonType(type)}`;
    });

    const bodyPydanticParamOrNone = handler.validatesSchema ? `body_pydantic_param: ${handler.validatesSchema}` : '';

    const routeArgs: string[] = [];
    for (const p of typedPathParams) {
      routeArgs.push(p);
    }
    if (bodyPydanticParamOrNone) {
      routeArgs.push(bodyPydanticParamOrNone);
    }
    routeArgs.push('request: Request');

    const routeArgsStr = routeArgs.join(', ');

    // Construct path params dict
    const pathParamsEntries = paramNames.map((name) => `"${name}": ${name}`).join(', ');
    const pathParamsStr = `{${pathParamsEntries}}`;

    const responseHeadersLiteral = JSON.stringify(handler.responseHeaders);
    const methodLower = handler.method.toLowerCase();
    const methodUpper = handler.method.toUpperCase();

    appPyLines.push(`@app.${methodLower}("${pathWithFastapiBraces}")`);
    appPyLines.push(`async def ${handler.fnName}_route(${routeArgsStr}):`);

    if (!handler.validatesSchema) {
      appPyLines.push('    body_pydantic_param = None');
    }

    appPyLines.push('    pure_request = {');
    appPyLines.push(`        "method": "${methodUpper}",`);
    appPyLines.push(`        "path_params": ${pathParamsStr},`);
    appPyLines.push(
      '        "query": {k: (request.query_params.getlist(k)[0] if len(request.query_params.getlist(k)) == 1 else request.query_params.getlist(k)) for k in request.query_params.keys()},',
    );
    appPyLines.push(
      '        "body": (body_pydantic_param.model_dump() if body_pydantic_param is not None else (await request.json() if "application/json" in request.headers.get("content-type", "") else (await request.body()))),',
    );
    appPyLines.push('        "headers": {k.lower(): v for k, v in request.headers.items()},');
    appPyLines.push('        "user": getattr(request.state, "user", None),');
    appPyLines.push('    }');
    appPyLines.push(`    result = ${handler.fnName}(pure_request)`);
    appPyLines.push('    status, body, *rest = result if isinstance(result, tuple) else (200, result)');
    appPyLines.push('    extra_headers = rest[0] if rest else {}');
    appPyLines.push(`    merged_headers = {**${responseHeadersLiteral}, **extra_headers}`);
    appPyLines.push('    return JSONResponse(content=body, status_code=status, headers=merged_headers or None)');
    appPyLines.push('');
  }

  // Concatenate all handler code to build pureHandlersPy, including their combined imports
  const allPureImports = new Set<string>();
  for (const handler of handlers) {
    if (handler.imports) {
      for (const imp of handler.imports) {
        allPureImports.add(imp);
      }
    }
  }

  const sortedPureImports = Array.from(allPureImports).sort();
  const pureImportsStr = sortedPureImports.length > 0 ? `${sortedPureImports.join('\n')}\n\n` : '';

  const pureHandlersPy = `${pureImportsStr + handlers.map((h) => `${h.signature}\n${h.bodyLines.join('\n')}`).join('\n\n')}\n`;

  return {
    appPy: appPyLines.join('\n'),
    pureHandlersPy,
    imports,
  };
}
