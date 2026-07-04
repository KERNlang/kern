import type { IRNode, SourceMapEntry } from '@kernlang/core';
import { emitNativeKernBodyTS, getChildren, getFirstChild, getProps } from '@kernlang/core';
import { normalizeKernHmacAlgorithm } from '@kernlang/core/runtime';
import { buildSchema, resolveMiddlewareUsage } from './express-middleware.js';
import {
  generatePortableHandlerExpress,
  generatePortableStreamExpress,
  hasPortableStreamBody,
} from './express-portable.js';
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

function expressPolicyDescriptor(policyNodes: readonly IRNode[], method: string, path: string): string {
  const policies = policyNodes.map((node, index) => {
    const props = getProps(node);
    const kind = String(props.kind || 'passthrough');
    const name = String(props.name || `Policy${index + 1}`);
    // Route-child policies bypass the core manifest loader, so this emitter
    // must enforce the same fail-closed plan validation policySlotPlan does
    // — otherwise a negative minGroundingCoverage silently disables the
    // grounding threshold at runtime (coverage < negative is never true).
    const minGroundingCoverage = Number(props.minGroundingCoverage ?? 1);
    if (kind === 'rag-review' && !(minGroundingCoverage >= 0 && minGroundingCoverage <= 1)) {
      throw new Error(`express emitter: policy ${name} minGroundingCoverage must be between 0 and 1`);
    }
    // Same fail-closed rule as core's loader for the HMAC signature encoding:
    // anything other than the two supported encodings must fail the BUILD.
    // Emitted verbatim it reaches generated runtime code, where the Python
    // runtime treats every non-hex value as base64 — silently drifted
    // semantics instead of a build error.
    const encoding = String(props.encoding || 'hex');
    if (kind === 'hmacSignature' && encoding !== 'hex' && encoding !== 'base64') {
      throw new Error(`express emitter: policy ${name} hmacSignature encoding must be hex or base64`);
    }
    const plan =
      kind === 'auth'
        ? `{ kind: 'auth', verifierRef: '${escapeSingleQuotes(String(props.verifierRef || props.ref || 'default'))}', credentialHeader: '${escapeSingleQuotes(String(props.credentialHeader || 'authorization').toLowerCase())}' }`
        : kind === 'hmacSignature'
          ? `{ kind: 'hmacSignature', keyRef: '${escapeSingleQuotes(String(props.keyRef || 'default'))}', algorithm: '${escapeSingleQuotes(normalizeKernHmacAlgorithm(String(props.algorithm || 'sha256')))}', signatureHeader: '${escapeSingleQuotes(String(props.signatureHeader || 'x-signature').toLowerCase())}', encoding: '${escapeSingleQuotes(encoding)}'${props.prefix ? `, prefix: '${escapeSingleQuotes(String(props.prefix))}'` : ''} }`
          : kind === 'rag-review'
            ? `{ kind: 'rag-review', queryField: 'query', answerField: 'answer', citedChunkIdsField: 'citedChunkIds', groundingSpansField: 'groundingSpans', minGroundingCoverage: ${minGroundingCoverage} }`
            : kind === 'passthrough'
              ? `{ kind: 'passthrough' }`
              : (() => {
                  // A kind this leg cannot execute must fail the build — emitting
                  // a passthrough here would ship an unguarded route.
                  throw new Error(`express emitter: unsupported pre-slot policy kind '${kind}' for policy ${name}`);
                })();
    return `{ node: { type: 'policy', props: ${JSON.stringify(props)}, children: [] }, name: '${escapeSingleQuotes(name)}', slot: 'pre', kind: '${escapeSingleQuotes(kind)}', handler: 'main', requires: [], plan: ${plan}, label: 'policy ${escapeSingleQuotes(name)}' }`;
  });
  return `{ node: { type: 'route', props: {}, children: [] }, kind: 'route', name: 'GeneratedRoute', path: '${escapeSingleQuotes(path)}', sourcePath: './generated.kern', handler: 'main', policies: [], prePolicies: [${policies.join(', ')}], postPolicies: [], appCapabilities: [], entryCapabilities: [], policyCapabilities: [], declaredCapabilities: [], requiredCapabilities: [], requiredSyncCapabilities: [], requiredAsyncCapabilities: [], label: 'route GeneratedRoute', method: '${escapeSingleQuotes(method)}', key: '${escapeSingleQuotes(method.toUpperCase())} ${escapeSingleQuotes(path)}' }`;
}

export function buildRouteArtifact(
  routeNode: IRNode,
  routeIndex: number,
  middlewareArtifacts: Map<string, MiddlewareArtifactRef>,
  sourceMap: SourceMapEntry[],
  securityLevel: 'strict' | 'relaxed',
  /** Rendered `import ... from '...'` lines propagated from the enclosing `server` block. */
  propagatedImports: readonly string[] = [],
  /**
   * Body-parser invocation (e.g. `express.json({ limit: '1mb' })`) the server
   * moved from the global middleware stack to per-route registration because
   * at least one route in the app carries an hmacSignature pre-policy. Applied
   * to every route EXCEPT hmacSignature-guarded ones, whose body lifecycle is
   * raw-capture -> policy -> parse-after-allow.
   */
  injectedJsonParserInvocation?: string,
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
  const filterNodes = getChildren(routeNode, 'filter');
  const countNodes = getChildren(routeNode, 'count');
  const compactNodes = getChildren(routeNode, 'compact');
  const pluckNodes = getChildren(routeNode, 'pluck');
  const takeNodes = getChildren(routeNode, 'take');
  const dropNodes = getChildren(routeNode, 'drop');
  const sliceNodes = getChildren(routeNode, 'slice');
  const reverseNodes = getChildren(routeNode, 'reverse');
  const atNodes = getChildren(routeNode, 'at');
  const joinNodes = getChildren(routeNode, 'join');
  const concatNodes = getChildren(routeNode, 'concat');
  const includesNodes = getChildren(routeNode, 'includes');
  const indexOfNodes = getChildren(routeNode, 'indexOf');
  const lastIndexOfNodes = getChildren(routeNode, 'lastIndexOf');
  const trimNodes = getChildren(routeNode, 'trim');
  const splitNodes = getChildren(routeNode, 'split');
  const replaceFirstNodes = getChildren(routeNode, 'replaceFirst');
  const replaceAllNodes = getChildren(routeNode, 'replaceAll');
  const sortNodes = getChildren(routeNode, 'sort');
  const objectMergeNodes = getChildren(routeNode, 'objectMerge');
  const objectOmitNodes = getChildren(routeNode, 'objectOmit');
  const objectPickNodes = getChildren(routeNode, 'objectPick');
  const objectKeysNodes = getChildren(routeNode, 'objectKeys');
  const objectValuesNodes = getChildren(routeNode, 'objectValues');
  const objectEntriesNodes = getChildren(routeNode, 'objectEntries');
  const uniqueByNodes = getChildren(routeNode, 'uniqueBy');
  const groupByNodes = getChildren(routeNode, 'groupBy');
  const partitionNodes = getChildren(routeNode, 'partition');
  const indexByNodes = getChildren(routeNode, 'indexBy');
  const countByNodes = getChildren(routeNode, 'countBy');
  const effectNodes = getChildren(routeNode, 'effect');
  // Only DIRECT assign/do children are counted; a nested one (inside a portable
  // branch/each) is covered transitively because its enclosing portable node
  // already flips hasPortableNodes.
  const assignNodes = getChildren(routeNode, 'assign');
  const doNodes = getChildren(routeNode, 'do');
  const hasPortableNodes =
    deriveNodes.length > 0 ||
    guardNodes.length > 0 ||
    !!respondNode ||
    branchNodes.length > 0 ||
    eachNodes.length > 0 ||
    collectNodes.length > 0 ||
    filterNodes.length > 0 ||
    countNodes.length > 0 ||
    compactNodes.length > 0 ||
    pluckNodes.length > 0 ||
    takeNodes.length > 0 ||
    dropNodes.length > 0 ||
    sliceNodes.length > 0 ||
    reverseNodes.length > 0 ||
    atNodes.length > 0 ||
    joinNodes.length > 0 ||
    concatNodes.length > 0 ||
    includesNodes.length > 0 ||
    indexOfNodes.length > 0 ||
    lastIndexOfNodes.length > 0 ||
    trimNodes.length > 0 ||
    splitNodes.length > 0 ||
    replaceFirstNodes.length > 0 ||
    replaceAllNodes.length > 0 ||
    sortNodes.length > 0 ||
    objectMergeNodes.length > 0 ||
    objectOmitNodes.length > 0 ||
    objectPickNodes.length > 0 ||
    objectKeysNodes.length > 0 ||
    objectValuesNodes.length > 0 ||
    objectEntriesNodes.length > 0 ||
    uniqueByNodes.length > 0 ||
    groupByNodes.length > 0 ||
    partitionNodes.length > 0 ||
    indexByNodes.length > 0 ||
    countByNodes.length > 0 ||
    effectNodes.length > 0 ||
    assignNodes.length > 0 ||
    doNodes.length > 0;

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
  const policyNodes = getChildren(routeNode, 'policy');
  const hmacPolicyNodes = policyNodes.filter((node) => String(getProps(node).kind || '') === 'hmacSignature');
  const hasPolicyNodes = policyNodes.length > 0;
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

  if (hmacPolicyNodes.length > 0) {
    // An hmacSignature-guarded route owns its body lifecycle end to end:
    // __kernCaptureRawBody preserves the exact raw bytes, the pre-policy
    // middleware verifies them, and __kernParseJsonAfterPolicy parses only
    // after an allow decision. A route-local `middleware name=json` here
    // would (a) never see the stream (already consumed by the raw capture,
    // so express.json stalls waiting for data that never comes) and (b) be
    // redundant with the post-allow parse. Drop it, fail-safe.
    for (let index = middlewareInvocations.length - 1; index >= 0; index -= 1) {
      if (middlewareInvocations[index].startsWith('express.json(')) middlewareInvocations.splice(index, 1);
    }
  } else if (injectedJsonParserInvocation) {
    // Whole-app generation moved the global JSON parser per-route (a global
    // parser cannot know which routes are HMAC-guarded without path-shape
    // heuristics — see transpiler-express). Non-HMAC routes receive it at the
    // FRONT of their chain, mirroring the old global ordering (parser before
    // auth/validate/user middleware).
    middlewareInvocations.unshift(injectedJsonParserInvocation);
    if (injectedJsonParserInvocation.startsWith('express.json(')) needsExpressDefaultImport = true;
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
  const errorMessagesByStatus = new Map(errorResponses.map((er) => [er.status, er.message]));

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
  if (hasPolicyNodes) {
    lines.push(`import { executeKernAppEntryPolicySlot, type KernAppRouteDescriptor } from '@kernlang/core/runtime';`);
  }
  if (hmacPolicyNodes.length > 0) {
    lines.push(`import { createHmac, timingSafeEqual } from 'node:crypto';`);
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
  if (hmacPolicyNodes.length > 0) {
    lines.push('');
    // Cap matches the strict-mode express.json({ limit: '1mb' }) the HMAC
    // route opted out of — otherwise raw capture would buffer an arbitrarily
    // large body in memory BEFORE any signature check. Overflow responds 413
    // and drains the remaining stream unbuffered (no hang, no growth).
    lines.push(`const __KERN_RAW_BODY_LIMIT_BYTES = 1048576;`);
    lines.push('');
    lines.push(`function __kernCaptureRawBody(req: Request, res: Response, next: NextFunction): void {`);
    // Defensive: a stream something upstream already consumed never fires
    // 'end', so waiting on it would hang the request forever. Capture is
    // registered first so generated code cannot currently reach this state —
    // but if a host composes extra middleware ahead of it, fail safe with an
    // empty raw body (which the guard then denies) instead of hanging.
    lines.push(`  if (req.readableEnded) {`);
    lines.push(`    (req as Request & { rawBody?: Buffer }).rawBody = Buffer.alloc(0);`);
    lines.push(`    next();`);
    lines.push(`    return;`);
    lines.push(`  }`);
    lines.push(`  const chunks: Buffer[] = [];`);
    lines.push(`  let receivedBytes = 0;`);
    lines.push(`  let overflowed = false;`);
    lines.push(`  req.on('data', (chunk: Buffer | string) => {`);
    lines.push(`    if (overflowed) return;`);
    lines.push(`    const buffer = Buffer.from(chunk);`);
    lines.push(`    receivedBytes += buffer.length;`);
    lines.push(`    if (receivedBytes > __KERN_RAW_BODY_LIMIT_BYTES) {`);
    lines.push(`      overflowed = true;`);
    lines.push(`      chunks.length = 0;`);
    // Overflow: respond 413, STOP READING immediately (req.pause() lets TCP
    // backpressure stall the sender instead of draining an arbitrarily large
    // upload at full bandwidth), and tear the connection down after a short
    // lingering close. Destroying the instant the response flushes can RST
    // the connection while unread upload bytes sit in the receive buffer,
    // discarding the in-flight 413 before the client reads it — the linger
    // (unref'd, so it never holds the process) lets a well-behaved client
    // observe the status first; a misbehaving one is cut off regardless.
    lines.push(`      res.setHeader('Connection', 'close');`);
    lines.push(`      res.status(413).json({ error: 'Payload Too Large' });`);
    lines.push(`      req.pause();`);
    lines.push(`      res.once('finish', () => setTimeout(() => req.destroy(), 1000).unref());`);
    lines.push(`      return;`);
    lines.push(`    }`);
    lines.push(`    chunks.push(buffer);`);
    lines.push(`  });`);
    lines.push(`  req.on('end', () => {`);
    lines.push(`    if (overflowed) return;`);
    lines.push(`    (req as Request & { rawBody?: Buffer }).rawBody = Buffer.concat(chunks);`);
    lines.push(`    next();`);
    lines.push(`  });`);
    // After an overflow teardown the destroyed request may emit an error;
    // the 413 response is already finished, so routing it into the error
    // middleware would only produce a headers-already-sent crash.
    lines.push(`  req.on('error', (error) => {`);
    lines.push(`    if (!overflowed) next(error);`);
    lines.push(`  });`);
    lines.push('}');
    lines.push('');
    lines.push(
      `function __kernParseJsonAfterPolicy(req: Request): { readonly ok: true } | { readonly ok: false; readonly error: string } {`,
    );
    lines.push(`  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;`);
    lines.push(`  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();`);
    lines.push(
      `  if (!rawBody || rawBody.length === 0 || !contentType.includes('application/json')) return { ok: true };`,
    );
    lines.push(`  try {`);
    lines.push(`    (req as Request & { body?: unknown }).body = JSON.parse(rawBody.toString('utf8'));`);
    lines.push(`    return { ok: true };`);
    lines.push(`  } catch (error) {`);
    lines.push(`    return { ok: false, error: error instanceof Error ? error.message : String(error) };`);
    lines.push(`  }`);
    lines.push('}');
    lines.push('');
    lines.push(
      `function __kernVerifyHmac(key: string | Uint8Array, input: { body: string | Uint8Array; signature: string; algorithm: string; encoding: 'hex' | 'base64'; prefix?: string }): boolean {`,
    );
    // Same normalization as core's normalizeKernHmacAlgorithm (the emitter
    // already canonicalizes the plan; this is runtime defense for plans that
    // reach the verifier from other sources): 'sha-256'/'sha_256' -> 'sha256',
    // 'sha3_256' -> 'sha3-256' (Node/OpenSSL digest names).
    lines.push(
      `  const algorithm = input.algorithm.trim().toLowerCase().replace(/_/g, '-').replace(/^sha-(\\d+)$/, 'sha$1');`,
    );
    lines.push(`  const expected = createHmac(algorithm, Buffer.from(key))`);
    lines.push(`    .update(Buffer.from(input.body))`);
    lines.push(`    .digest(input.encoding);`);
    lines.push(
      `  const received = input.prefix && input.signature.startsWith(input.prefix) ? input.signature.slice(input.prefix.length) : input.signature;`,
    );
    lines.push(`  const expectedBuffer = Buffer.from(expected, input.encoding);`);
    lines.push(`  const receivedBuffer = Buffer.from(received, input.encoding);`);
    lines.push(
      `  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);`,
    );
    lines.push('}');
  }
  lines.push('');
  if (hasPolicyNodes) {
    const descriptor = expressPolicyDescriptor(policyNodes, normalizedMethod, path);
    lines.push(`const __kernRoutePolicyEntry = ${descriptor} as unknown as KernAppRouteDescriptor;`);
    lines.push(`const __kernPolicyFacts = (req: Request) => ({`);
    lines.push(
      `  headers: Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : value])),`,
    );
    lines.push(`  rawBody: (req as Request & { rawBody?: Buffer }).rawBody,`);
    lines.push(`  authVerifiers: (req.app.locals.kernAuthVerifiers ?? {}) as any,`);
    if (hmacPolicyNodes.length > 0) {
      lines.push(
        `  hmacVerifiers: Object.fromEntries(Object.entries((req.app.locals.kernHmacKeys ?? {}) as Record<string, string | Uint8Array | undefined>).filter((entry): entry is [string, string | Uint8Array] => entry[1] !== undefined).map(([keyRef, key]) => [keyRef, (input: { body: string | Uint8Array; signature: string; algorithm: string; encoding: 'hex' | 'base64'; prefix?: string }) => __kernVerifyHmac(key, input)])) as any,`,
      );
    } else {
      lines.push(`  hmacVerifiers: {},`);
    }
    lines.push(`  ragReview: (req as Request & { kernRagReview?: unknown }).kernRagReview as any,`);
    lines.push(`});`);
    lines.push('');
    // The pre-policy slot runs as its OWN middleware, registered immediately
    // after the raw-body capture and BEFORE every user-level middleware
    // (auth, validate, route-local parsers). Running it inside the handler —
    // the previous shape — let user middleware observe, parse, or reject the
    // request ahead of a policy denial, violating the deny-before-parse
    // contract (oracle H10). For HMAC routes the post-allow JSON parse also
    // lives here, so downstream middleware (e.g. validate) still sees
    // req.body.
    lines.push(
      `async function __kernEnforcePrePolicy(req: Request, res: Response, next: NextFunction): Promise<void> {`,
    );
    lines.push(`  try {`);
    lines.push(
      `    const __kernPrePolicy = await executeKernAppEntryPolicySlot(__kernRoutePolicyEntry, 'pre', __kernPolicyFacts(req));`,
    );
    lines.push(`    const __kernDenied = __kernPrePolicy.find((policy) => policy.action === 'deny');`);
    lines.push(`    if (__kernDenied) {`);
    lines.push(`      res.status(__kernDenied.status ?? 401).json(__kernDenied.body ?? { error: 'policy_denied' });`);
    lines.push(`      return;`);
    lines.push(`    }`);
    if (hmacPolicyNodes.length > 0) {
      lines.push(`    const __kernParsedBody = __kernParseJsonAfterPolicy(req);`);
      lines.push(`    if (!__kernParsedBody.ok) {`);
      lines.push('      res.status(400).json({ error: `Invalid body: ${__kernParsedBody.error}` });');
      lines.push(`      return;`);
      lines.push(`    }`);
    }
    lines.push(`    next();`);
    lines.push(`  } catch (error) {`);
    lines.push(`    next(error);`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push('');
  }
  lines.push(`export function ${registerName}(app: Express): void {`);
  lines.push(
    `  app.${normalizedMethod}('${escapeSingleQuotes(path)}', ${hmacPolicyNodes.length > 0 ? '__kernCaptureRawBody, ' : ''}${hasPolicyNodes ? '__kernEnforcePrePolicy, ' : ''}${middlewareInvocations.length > 0 ? `${middlewareInvocations.join(', ')}, ` : ''}async (req: ${requestType}, res: Response, next: NextFunction) => {`,
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

  // Slice 4a review fix (Codex+Gemini critical): stream/timer/portable
  // routes do not support `lang=kern` yet — fail loud at codegen instead
  // of silently swallowing the opt-in and emitting a broken handler.
  // For stream routes, the handler is nested inside `streamNode`; for
  // timer routes, inside `timerNode`. Resolve lang=kern off whichever
  // handler the route configuration points to.
  const streamHandlerNode = caps.streamNode ? getFirstChild(caps.streamNode, 'handler') : undefined;
  const timerHandlerNode = caps.timerNode ? getFirstChild(caps.timerNode, 'handler') : undefined;
  const standardHandlerNode = !caps.hasStream && !caps.hasTimer ? handlerNode : undefined;
  const isKernHandler =
    standardHandlerNode !== null && standardHandlerNode !== undefined && handlerProps.lang === 'kern';
  if (caps.hasStream && streamHandlerNode && getProps(streamHandlerNode).lang === 'kern') {
    throw new Error(
      "Express route 'stream' handler with lang=kern is not yet supported. " +
        'Use a non-stream route or a raw `<<<...>>>` body until slice 4c lands streaming response translation.',
    );
  }
  if (caps.hasTimer && timerHandlerNode && getProps(timerHandlerNode).lang === 'kern') {
    throw new Error(
      "Express route 'timer' handler with lang=kern is not yet supported. " +
        'Use a non-timer route or a raw `<<<...>>>` body until slice 4c lands timer response translation.',
    );
  }
  if (isKernHandler && hasPortableNodes) {
    throw new Error(
      'Express route has BOTH portable nodes (derive/guard/respond/branch/each/collect/effect) AND a `lang=kern` handler. ' +
        'Choose one path: portable nodes for declarative composition, or `lang=kern` for native KERN bodies.',
    );
  }

  if (caps.hasStream) {
    // SSE route — validate first, then stream
    lines.push(...generateStreamSetup('    '));
    lines.push('');

    // Slice 4c: a `stream` whose body is portable nodes (derive/let/each/
    // fanout/emit/…) instead of a raw `<<<JS>>>` handler lowers through the
    // portable emitter, declaring its own abort controller. The raw-handler
    // path is unchanged.
    const portableStream = caps.streamNode && hasPortableStreamBody(caps.streamNode);
    if (portableStream && (getFirstChild(caps.streamNode!, 'handler') || getFirstChild(caps.streamNode!, 'spawn'))) {
      // A portable body (fanout/emit/…) and a raw `handler`/`spawn` are two
      // different lowering paths; the portable walker would silently drop the
      // raw child. Fail loud (mirrors the route-level portable-vs-kern guard).
      throw new Error(
        "Express 'stream' mixes portable nodes (fanout/emit/derive/…) with a raw `handler`/`spawn` body. " +
          'Use one streaming style per route.',
      );
    }
    const streamHandlerLines = portableStream
      ? generatePortableStreamExpress(caps.streamNode!, '', path, { errorMessagesByStatus })
      : handlerCode
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
      lines.push(...generatePortableHandlerExpress(routeNode, '      ', path, { errorMessagesByStatus }));
    } else if (isKernHandler) {
      // Slice 4a + 4a review fixes (Codex P1+P2, Gemini #1+#3): Express
      // route handlers don't communicate via `return X` — Express ignores
      // the return value and only acts on side-effecting `res.json(...)`
      // calls. The native KERN body emitter generates `return X;` (slice 1
      // for `fn` semantics). To bridge the gap, we wrap the emitted body
      // in an IIFE, capture its return value, and translate that result
      // back into an Express response:
      //   - undefined         → no response (user wrote bare `return;`)
      //   - { kind: 'err' }   → 500 with the err.error payload (Result.err
      //                          short-circuit from `?` propagation)
      //   - any other value   → 200 with the value as JSON
      // Path params on Express live in `req.params.X`, NOT as free locals
      // (Codex P2). We pre-bind them inside the IIFE so KERN bodies that
      // reference path params by their KERN name resolve correctly.
      // standardHandlerNode is guaranteed non-undefined when isKernHandler is true.
      const kernBody = emitNativeKernBodyTS(standardHandlerNode!);
      const kernBodyTrimmed = kernBody.trim();
      if (kernBodyTrimmed === '') {
        // Slice 4a review fix (Codex+Gemini+OpenCode): empty native body
        // would produce a request that hangs (`next` never called, `res`
        // never written). Send a clear 501 instead of silent failure.
        lines.push(`      res.status(501).json({ error: 'Route handler not implemented' });`);
      } else {
        const pathParams = derivePathParams(path);
        lines.push('      const __k_result = await (async () => {');
        for (const param of pathParams) {
          lines.push(`        const ${param} = req.params.${param};`);
        }
        for (const kernLine of kernBody.split('\n')) {
          lines.push(`        ${kernLine}`);
        }
        lines.push('      })();');
        lines.push(
          "      if (__k_result !== undefined && typeof __k_result === 'object' && __k_result !== null && (__k_result as { kind?: unknown }).kind === 'err') {",
        );
        lines.push('        res.status(500).json({ error: (__k_result as { error?: unknown }).error });');
        lines.push('      } else if (__k_result !== undefined) {');
        lines.push('        res.json(__k_result);');
        lines.push('      }');
      }
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
