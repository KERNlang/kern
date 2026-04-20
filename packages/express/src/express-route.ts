import type { IRNode, SourceMapEntry } from '@kernlang/core';
import { getChildren, getFirstChild, getProps } from '@kernlang/core';
import { buildSchema, resolveMiddlewareUsage } from './express-middleware.js';
import { generatePortableHandlerExpress } from './express-portable.js';
import { generateSpawnCode, generateStreamSetup, generateStreamWrap, generateTimerCode } from './express-stream.js';
import type { KeyTypeInfo, MiddlewareArtifactRef, RouteArtifactRef } from './express-types.js';
import { analyzeRouteCapabilities, HTTP_METHODS } from './express-types.js';
import {
  buildPathParamsType,
  derivePathParams,
  escapeSingleQuotes,
  extractRequiredKeyTypes,
  indentBlock,
  routeFileBase,
  routeRegisterName,
} from './express-utils.js';

export function buildRouteArtifact(
  routeNode: IRNode,
  routeIndex: number,
  middlewareArtifacts: Map<string, MiddlewareArtifactRef>,
  sourceMap: SourceMapEntry[],
  securityLevel: 'strict' | 'relaxed',
  /** Rendered `import ... from '...'` lines propagated from the enclosing `server` block. */
  propagatedImports: readonly string[] = [],
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
  const hasPortableNodes =
    deriveNodes.length > 0 ||
    guardNodes.length > 0 ||
    !!respondNode ||
    branchNodes.length > 0 ||
    eachNodes.length > 0 ||
    collectNodes.length > 0 ||
    effectNodes.length > 0;

  // Get handler code — priority: stream handler > timer handler > route handler > portable > 501
  const handlerNode = caps.hasStream
    ? getFirstChild(caps.streamNode!, 'handler')
    : caps.hasTimer
      ? null // timer owns its own handler, don't look at route level
      : getFirstChild(routeNode, 'handler');
  const routeHandlerNode = getFirstChild(routeNode, 'handler');
  const handlerProps = handlerNode ? getProps(handlerNode) : {};
  const routeHandlerCode = routeHandlerNode ? String(getProps(routeHandlerNode).code || '') : '';
  const handlerCode =
    typeof handlerProps.code === 'string'
      ? String(handlerProps.code)
      : caps.hasStream || caps.hasTimer || hasPortableNodes
        ? ''
        : `res.status(501).json({ error: 'Route handler not implemented' });`;

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
        const mwUsage = resolveMiddlewareUsage(syntheticNode, middlewareArtifacts, '../', securityLevel);
        if (mwUsage.importLine) routeImports.add(mwUsage.importLine);
        if (mwUsage.invocation.startsWith('express.json(')) needsExpressDefaultImport = true;
        middlewareInvocations.push(mwUsage.invocation);
      }
      continue;
    }
    const usage = resolveMiddlewareUsage(middlewareNode, middlewareArtifacts, '../', securityLevel);
    if (usage.importLine) routeImports.add(usage.importLine);
    if (usage.invocation.startsWith('express.json(')) needsExpressDefaultImport = true;
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
  const errorNodes = getChildren(routeNode, 'error').filter((n) => typeof getProps(n).status === 'number');
  const errorResponses: Array<{ status: number; message: string }> = errorNodes.map((n) => ({
    status: getProps(n).status as number,
    message: String(getProps(n).message || 'Error'),
  }));

  const paramsType = schema.params || buildPathParamsType(path) || 'Record<string, never>';
  const queryType = schema.query || 'Record<string, never>';
  const bodyType = schema.body || 'Record<string, never>';
  const responseType = schema.response || 'unknown';
  const requestType = `Request<RouteParams, ResponseBody, RequestBody, RequestQuery>`;

  const validationLines: string[] = [];
  // Params and query arrive as strings in Express — only check existence, not typeof.
  // Body comes from JSON parsing and has real types — check both existence and typeof.
  const requiredParamKeys = (
    schema.params
      ? extractRequiredKeyTypes(schema.params)
      : derivePathParams(path).map((k) => ({ key: k, type: 'any' }))
  ).map((k) => ({ ...k, type: 'any' }));
  const requiredBodyKeys = schema.body ? extractRequiredKeyTypes(schema.body) : [];
  const requiredQueryKeys = (schema.query ? extractRequiredKeyTypes(schema.query) : []).map((k) => ({
    ...k,
    type: 'any',
  }));

  function formatFieldSpec(fields: KeyTypeInfo[]): string {
    return `[${fields.map((f) => `{ key: '${escapeSingleQuotes(f.key)}', type: '${f.type}' }`).join(', ')}]`;
  }

  if (requiredParamKeys.length > 0) {
    validationLines.push(`assertRequiredFields('params', req.params, ${formatFieldSpec(requiredParamKeys)});`);
  }
  if (requiredBodyKeys.length > 0) {
    validationLines.push(`assertRequiredFields('body', req.body, ${formatFieldSpec(requiredBodyKeys)});`);
  }
  if (requiredQueryKeys.length > 0) {
    validationLines.push(`assertRequiredFields('query', req.query, ${formatFieldSpec(requiredQueryKeys)});`);
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
  for (const propagated of propagatedImports) {
    lines.push(propagated);
  }
  lines.push('');
  lines.push(`type RouteParams = ${paramsType};`);
  lines.push(`type RequestQuery = ${queryType};`);
  lines.push(`type RequestBody = ${bodyType};`);
  lines.push(`type ResponseBody = ${responseType};`);
  if (validationLines.length > 0) {
    lines.push('');
    lines.push(
      `function assertRequiredFields(label: string, value: unknown, fields: Array<{ key: string; type: string }>): void {`,
    );
    lines.push(`  if (typeof value !== 'object' || value === null) {`);
    lines.push(`    throw new Error(\`Invalid \${label}: expected object payload\`);`);
    lines.push('  }');
    lines.push(`  const obj = value as Record<string, unknown>;`);
    lines.push(`  for (const { key, type } of fields) {`);
    lines.push(`    if (!(key in obj)) {`);
    lines.push(`      throw new Error(\`Invalid \${label}: missing \${key}\`);`);
    lines.push('    }');
    lines.push(`    if (type !== 'any' && typeof obj[key] !== type) {`);
    lines.push(`      throw new Error(\`Invalid \${label}: \${key} must be \${type}, got \${typeof obj[key]}\`);`);
    lines.push('    }');
    lines.push('  }');
    lines.push('}');
  }
  lines.push('');
  lines.push(`export function ${registerName}(app: Express): void {`);
  lines.push(
    `  app.${normalizedMethod}('${escapeSingleQuotes(path)}', ${middlewareInvocations.length > 0 ? `${middlewareInvocations.join(', ')}, ` : ''}async (req: ${requestType}, res: Response, next: NextFunction) => {`,
  );

  // Schema validation — always runs first, before stream/timer
  if (validationLines.length > 0) {
    lines.push('    try {');
    for (const validationLine of validationLines) {
      lines.push(`      ${validationLine}`);
    }
    lines.push('    } catch (err) {');
    lines.push(
      '      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) } as any);',
    );
    lines.push('    }');
    lines.push('');
  }

  // v3 query params — extract with safe type coercion and defaults
  if (queryParams.length > 0) {
    for (const qp of queryParams) {
      if (qp.default !== undefined) {
        if (qp.type === 'number') {
          lines.push(
            `    const ${qp.name} = req.query.${qp.name} !== undefined ? Number(req.query.${qp.name}) : ${qp.default};`,
          );
        } else if (qp.type === 'boolean') {
          lines.push(
            `    const ${qp.name} = req.query.${qp.name} !== undefined ? req.query.${qp.name} === 'true' : ${qp.default};`,
          );
        } else {
          lines.push(
            `    const ${qp.name} = typeof req.query.${qp.name} === 'string' ? req.query.${qp.name} : ${qp.default};`,
          );
        }
      } else {
        if (qp.type === 'number') {
          lines.push(
            `    const ${qp.name} = req.query.${qp.name} !== undefined ? Number(req.query.${qp.name}) : undefined;`,
          );
        } else if (qp.type === 'boolean') {
          lines.push(
            `    const ${qp.name} = req.query.${qp.name} !== undefined ? req.query.${qp.name} === 'true' : undefined;`,
          );
        } else {
          lines.push(
            `    const ${qp.name} = typeof req.query.${qp.name} === 'string' ? req.query.${qp.name} as string : undefined;`,
          );
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

    const streamHandlerLines = handlerCode
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

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
