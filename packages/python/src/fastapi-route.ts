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
import {
  generatePortableHandlerFastAPI,
  generatePortableStreamFastAPI,
  hasPortableStreamBodyFastAPI,
} from './fastapi-portable.js';
import {
  hasObjectShorthandOutsideStrings,
  isUnsupportedJsHandlerBody,
  stripStringsForJsCheck,
  unsupportedRawHandlerBody,
} from './fastapi-raw-handler.js';
import type { RouteArtifactRef, RouteCapabilities } from './fastapi-types.js';
import { HTTP_METHODS } from './fastapi-types.js';
import {
  analyzeRouteCapabilities,
  buildPydanticModel,
  buildSchema,
  convertPath,
  derivePathParams,
  escapePyStr,
  extractBodyFieldNames,
  indentHandler,
  quoteObjectKeysOutsideStrings,
  routeFileBase,
  slugify,
} from './fastapi-utils.js';
import { toSnakeCase } from './type-map.js';

// ── SSE Stream code generator ────────────────────────────────────────────

export interface StreamSignatureInputs {
  queryParams: Array<{ name: string; type: string; default?: string }>;
  middlewareDeps: string[];
  authNode?: IRNode | null;
  validateNode?: IRNode | null;
  normalizedMethod: string;
  authModuleSpec: string;
}

export function generateStreamRoute(
  _routeNode: IRNode,
  caps: RouteCapabilities,
  method: string,
  fastapiPath: string,
  pathParams: string[],
  imports: Set<string>,
  bodyFields: Set<string>,
  hasBody: boolean,
  sig: StreamSignatureInputs,
): string[] {
  const lines: string[] = [];
  const handlerNode = caps.streamNode ? getFirstChild(caps.streamNode!, 'handler') : undefined;
  const handlerProps = handlerNode ? getProps(handlerNode) : {};
  const handlerCode = typeof handlerProps.code === 'string' ? String(handlerProps.code) : '';

  // Slice 4c: a `stream` whose body is portable nodes (derive/let/each/fanout/
  // emit/…) lowers through the portable emitter; the raw-handler/spawn paths
  // are unchanged.
  const portable = !!caps.streamNode && hasPortableStreamBodyFastAPI(caps.streamNode);
  if (portable && (getFirstChild(caps.streamNode!, 'handler') || getFirstChild(caps.streamNode!, 'spawn'))) {
    // A portable body and a raw `handler`/`spawn` are different lowering paths;
    // the portable walker would silently drop the raw child. Fail loud.
    throw new Error(
      "FastAPI 'stream' mixes portable nodes (fanout/emit/derive/…) with a raw `handler`/`spawn` body. " +
        'Use one streaming style per route.',
    );
  }

  // authUser drives the rewriter's `user.x` → `user["x"]` lowering; set when the
  // portable stream route declares auth (Codex/Gemini/kimi review on slice 4c).
  let authUser = false;
  let paramStr: string;
  if (portable) {
    // Bucket params by whether they carry a default — Python forbids a
    // non-default parameter after a defaulted one, and query params may arrive
    // in any source order (Codex review). All no-default params are emitted
    // first, then all defaulted ones.
    const required: string[] = pathParams.map((p) => `${p}: str`);
    const defaulted: string[] = [];
    // `request` powers is_disconnected(); the Pydantic body model binds input.
    required.push('request: Request');
    imports.add('from fastapi import Request');
    if (hasBody) required.push('body: RequestBody');
    // Query params, validate, middleware, and auth dependencies — the same
    // injections a standard portable route receives. Previously omitted, so a
    // stream referencing `query.x` / `user.x` or guarded by auth middleware
    // generated a broken signature (NameError / missing Depends).
    for (const qp of sig.queryParams) {
      const pyType = qp.type === 'number' ? 'int' : qp.type === 'boolean' ? 'bool' : 'str';
      if (qp.default !== undefined) defaulted.push(`${toSnakeCase(qp.name)}: ${pyType} = ${qp.default}`);
      else required.push(`${toSnakeCase(qp.name)}: ${pyType}`);
    }
    if (sig.validateNode && !hasBody) {
      const validateSchema = String(getProps(sig.validateNode).schema || '');
      if (validateSchema) {
        if (new Set(['post', 'put', 'patch']).has(sig.normalizedMethod)) {
          required.push(`body: ${validateSchema}`);
        } else {
          imports.add('from fastapi import Depends');
          defaulted.push(`validated = Depends(${toSnakeCase(validateSchema)})`);
        }
      }
    }
    for (const dep of sig.middlewareDeps) defaulted.push(`_${dep} = Depends(${dep})`);
    if (sig.authNode) {
      const authMode = String(getProps(sig.authNode).mode || 'required');
      const authFunc = authMode === 'optional' ? 'auth_optional' : 'auth_required';
      imports.add(`from ${sig.authModuleSpec} import ${authFunc}`);
      defaulted.push(`user = Depends(${authFunc})`);
      authUser = true;
    }
    paramStr = [...required, ...defaulted].join(', ');
  } else {
    paramStr = pathParams.map((p) => `${p}: str`).join(', ');
  }

  lines.push(`@router.${method}("${fastapiPath}")`);
  lines.push(`async def ${toSnakeCase(method)}_${slugify(fastapiPath)}(${paramStr}):`);
  lines.push(`    async def event_generator():`);

  if (portable) {
    const bodyLines = generatePortableStreamFastAPI(
      caps.streamNode!,
      '        ',
      pathParams,
      imports,
      bodyFields,
      authUser,
    );
    if (bodyLines.length === 0) lines.push(`        pass`);
    else lines.push(...bodyLines);
    lines.push(`        yield "data: [DONE]\\n\\n"`);
  } else if (caps.hasSpawn && caps.spawnNode) {
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
        // B7 (Codex review on 4115c0bb): if the stdout handler body is
        // un-lowerable JS, hoist the NotImplementedError OUTSIDE the
        // `async for chunk in process.stdout` loop. Inside the loop the
        // raise would never fire if the subprocess emits zero stdout
        // — silent failure. Failing fast at the generator's `if
        // process.stdout:` branch makes the error path deterministic.
        if (stdoutCode && isUnsupportedJsHandlerBody(stdoutCode)) {
          lines.push(...unsupportedRawHandlerBody('            '));
        } else {
          lines.push(`            async for chunk in process.stdout:`);
          if (stdoutCode) {
            lines.push(...indentHandler(stdoutCode, '                '));
          } else {
            lines.push(`                yield f"data: {chunk.decode()}\\n\\n"`);
          }
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
    if (isUnsupportedJsHandlerBody(handlerCode)) {
      lines.push(...unsupportedRawHandlerBody('        '));
    } else {
      lines.push(...indentHandler(handlerCode, '        '));
    }
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

function pyPolicyDescriptor(policyNodes: readonly IRNode[], method: string, path: string): string {
  const policies = policyNodes.map((node, index) => {
    const props = getProps(node);
    const kind = String(props.kind || 'passthrough');
    const name = String(props.name || `Policy${index + 1}`);
    const plan =
      kind === 'auth'
        ? `{"kind": "auth", "verifierRef": "${escapePyStr(String(props.verifierRef || props.ref || 'default'))}", "credentialHeader": "${escapePyStr(String(props.credentialHeader || 'authorization').toLowerCase())}"}`
        : kind === 'hmacSignature'
          ? `{"kind": "hmacSignature", "keyRef": "${escapePyStr(String(props.keyRef || 'default'))}", "algorithm": "${escapePyStr(String(props.algorithm || 'sha256'))}", "signatureHeader": "${escapePyStr(String(props.signatureHeader || 'x-signature').toLowerCase())}", "encoding": "${escapePyStr(String(props.encoding || 'hex'))}"${props.prefix ? `, "prefix": "${escapePyStr(String(props.prefix))}"` : ''}}`
          : kind === 'rag-review'
            ? `{"kind": "rag-review", "queryField": "query", "answerField": "answer", "citedChunkIdsField": "citedChunkIds", "groundingSpansField": "groundingSpans", "minGroundingCoverage": ${Number(props.minGroundingCoverage ?? 1)}}`
            : kind === 'passthrough'
              ? `{"kind": "passthrough"}`
              : (() => {
                  // A kind this leg cannot execute must fail the build — emitting
                  // a passthrough here would ship an unguarded route.
                  throw new Error(`fastapi emitter: unsupported pre-slot policy kind '${kind}' for policy ${name}`);
                })();
    // `props` is a raw IR node.props blob — JSON.stringify's output is a
    // JS-object-literal-compatible subset of JSON that happens to double as
    // Python syntax for strings/numbers/nested structures, but JSON's
    // `true`/`false`/`null` are NameErrors in Python. Round-trip through
    // json.loads(...) so ANY JSON-representable prop value (not just the
    // string/number props this emitter currently reads) lowers correctly.
    const propsJson = escapePyStr(JSON.stringify(props));
    return `{"node": {"type": "policy", "props": json.loads("${propsJson}"), "children": []}, "name": "${escapePyStr(name)}", "slot": "pre", "kind": "${escapePyStr(kind)}", "handler": "main", "requires": [], "plan": ${plan}, "label": "policy ${escapePyStr(name)}"}`;
  });
  return `{"node": {"type": "route", "props": {}, "children": []}, "kind": "route", "name": "GeneratedRoute", "path": "${escapePyStr(path)}", "sourcePath": "./generated.kern", "handler": "main", "policies": [], "prePolicies": [${policies.join(', ')}], "postPolicies": [], "appCapabilities": [], "entryCapabilities": [], "policyCapabilities": [], "declaredCapabilities": [], "requiredCapabilities": [], "requiredSyncCapabilities": [], "requiredAsyncCapabilities": [], "label": "route GeneratedRoute", "method": "${escapePyStr(method)}", "key": "${escapePyStr(method.toUpperCase())} ${escapePyStr(path)}"}`;
}

function lowerJsValueExpressionForPython(expr: string): string {
  return quoteObjectKeysOutsideStrings(replaceJsLiteralsOutsideStrings(expr.trim().replace(/;$/, '')));
}

// Whether a JS value expression is safe to lower into Python via the
// literal/key-quote passes alone. Rejects constructs the lowerers don't
// understand — backtick template literals, object-property shorthand,
// and JS `new X(...)` construction (Python has no `new` keyword, so it
// becomes `SyntaxError` on `ast.parse`).
function isLowerableJsValueExpression(expr: string): boolean {
  // Run keyword checks on a string-stripped view so a payload like
  // `{ msg: "example: new Date()" }` (where `new Date()` appears only
  // inside a string literal) doesn't false-positive. Codex flagged the
  // raw-text scan on commit 85593a3f.
  const stripped = stripStringsForJsCheck(expr);
  // Backticks inside strings are stripped to `_`; an unmatched backtick
  // outside strings (i.e., a JS template literal) survives.
  if (/`/.test(stripped)) return false;
  if (hasObjectShorthandOutsideStrings(expr)) return false;
  // JS construction `new Date()`, `new AbortController()`, etc.
  // Drop the PascalCase constraint per Gemini+Codex review on ae9663cf
  // / 85593a3f — `new foo()`, `new globalThis.Date()`, etc. are all
  // un-lowerable. Match any identifier (possibly dotted) following
  // `new`. Two variants: with parens (`new X(...)`) and without
  // (`new X` — valid JS, invalid Python). Negative lookbehind avoids
  // Python `for new in items:` false-positive (Codex+Gemini fix-up 5
  // review).
  // Parens form: allow newlines (`\s+` instead of horizontal-only).
  //
  // CRITICAL distinction from `isUnsupportedJsHandlerBody`:
  // `isLowerableJsValueExpression` is called on EXPRESSION content
  // (e.g., the JSON payload of `res.json({...})`), not on full handler
  // bodies. In expression context, there are no statement boundaries —
  // a Python-valid construct like `return new\nDate()` (two statements)
  // simply does not occur here. The expression IS one syntactic unit.
  //
  // So `new\nDate()` inside an expression payload is unambiguously JS
  // construction; the Python statement-cross argument used in the
  // handler-body guard doesn't apply. Codex fix-up 16 review flagged
  // that my fix-up 16 over-corrected by applying statement-level
  // reasoning to this expression-level gate.
  if (/\bnew\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\(/.test(stripped)) return false;
  // No-parens `new IDENT` form. Same asymmetric reasoning as the
  // parens form above: this is an EXPRESSION-level gate (`res.json(X)`
  // payload), so `new\nDate` is unambiguously JS construction — no
  // statement boundaries within X. Use `\s+` (newlines OK).
  // Gemini fix-up 18 review pointed out that I'd only relaxed the
  // parens form, leaving this no-parens form horizontal-only by
  // accident — a false-negative for `res.json({ x: new\nDate })`.
  //
  // The negative lookahead still excludes Python idioms `new is`,
  // `new in`, `new for`, etc. — those checks are language-content,
  // not whitespace-shape, so they remain.
  //
  // Lookbehind kept on `\bfor\s+` (with `\s+`, not `[^\S\r\n]+`) so
  // newline-separated `for new` patterns also get the Python-idiom
  // suppression in expression context.
  if (
    /(?<!\bfor\s+)\bnew\s+(?!(?:is|in|for|if|else|and|or|not)\b)[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\b/.test(
      stripped,
    )
  )
    return false;
  return true;
}

function splitRawHandlerStatements(code: string): string[] | null {
  const statements: string[] = [];
  let current = '';
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    if (quote) {
      current += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(') parenDepth += 1;
    else if (char === ')') parenDepth -= 1;
    else if (char === '[') bracketDepth += 1;
    else if (char === ']') bracketDepth -= 1;
    else if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth -= 1;
    if (parenDepth < 0 || bracketDepth < 0 || braceDepth < 0) return null;

    if ((char === ';' || char === '\n') && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      continue;
    }
    current += char;
  }

  if (quote || parenDepth !== 0 || bracketDepth !== 0 || braceDepth !== 0) return null;
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

function hasTopLevelComma(expr: string): boolean {
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = 0; index < expr.length; index += 1) {
    const char = expr[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') parenDepth += 1;
    else if (char === ')') parenDepth -= 1;
    else if (char === '[') bracketDepth += 1;
    else if (char === ']') bracketDepth -= 1;
    else if (char === '{') braceDepth += 1;
    else if (char === '}') braceDepth -= 1;
    if (parenDepth < 0 || bracketDepth < 0 || braceDepth < 0) return true;
    if (char === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) return true;
  }
  return quote !== null || parenDepth !== 0 || bracketDepth !== 0 || braceDepth !== 0;
}

function lowerRawHandlerBodyForPython(code: string, indent: string, imports: Set<string>): string[] | null {
  const statements = splitRawHandlerStatements(code);
  if (!statements || statements.length === 0) return null;

  const lines: string[] = [];
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    const isLast = index === statements.length - 1;

    const declaration = statement.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/);
    if (declaration) {
      if (isLast || hasTopLevelComma(declaration[2]) || !isLowerableJsValueExpression(declaration[2])) return null;
      lines.push(`${indent}${declaration[1]} = ${lowerJsValueExpressionForPython(declaration[2])}`);
      continue;
    }

    const statusJson =
      statement.match(/^(?:return\s+)?res\.status\((\d+)\)\.json\(([\s\S]*)\)$/) ??
      statement.match(/^(?:return\s+)?response\.status\((\d+)\)\.json\(([\s\S]*)\)$/);
    if (statusJson && isLast) {
      if (!statusJson[2].trim() || !isLowerableJsValueExpression(statusJson[2])) return null;
      imports.add('from fastapi.responses import JSONResponse');
      lines.push(
        `${indent}return JSONResponse(content=${lowerJsValueExpressionForPython(statusJson[2])}, status_code=${statusJson[1]})`,
      );
      continue;
    }

    const json = statement.match(/^(?:return\s+)?res\.json\(([\s\S]*)\)$/);
    if (json && isLast) {
      if (!json[1].trim() || !isLowerableJsValueExpression(json[1])) return null;
      lines.push(`${indent}return ${lowerJsValueExpressionForPython(json[1])}`);
      continue;
    }

    const directReturn = statement.match(/^return\s+([\s\S]+)$/);
    if (directReturn && isLast) {
      if (!isLowerableJsValueExpression(directReturn[1])) return null;
      lines.push(`${indent}return ${lowerJsValueExpressionForPython(directReturn[1])}`);
      continue;
    }

    return null;
  }

  return lines;
}

export function buildRouteArtifact(
  routeNode: IRNode,
  routeIndex: number,
  sourceMap: SourceMapEntry[],
  // Module specifier a `routes/*.py` artifact uses to import the generated
  // auth helper. Defaults to the flat `'auth'` (single-file / non-package
  // output); the caller passes a package-relative spec like `'..auth'` when
  // emitting a Python package, so the import resolves from the routes
  // subpackage instead of looking for a top-level `auth` module (Codex review).
  routeAuthModuleSpec = 'auth',
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
  const policyNodes = getChildren(routeNode, 'policy');
  const hasPolicyNodes = policyNodes.length > 0;
  const hmacPolicyNodes = policyNodes.filter((node) => String(getProps(node).kind || '') === 'hmacSignature');
  if (hasPolicyNodes) {
    imports.add('from fastapi import Request, HTTPException');
  }
  if (hmacPolicyNodes.length > 0) {
    imports.add('import hmac');
  }
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
  if (hasPolicyNodes) {
    imports.add('import json');
    bodyLines.push(`__kern_route_policy_entry = ${pyPolicyDescriptor(policyNodes, normalizedMethod, fastapiPath)}`);
    if (hmacPolicyNodes.length > 0) {
      bodyLines.push(`# HMAC compare must use hmac.compare_digest; core policy runtime owns guard meaning.`);
      bodyLines.push(`__kern_hmac_compare = hmac.compare_digest`);
    }
    // Fail-closed fallback for `request.app.state.execute_kern_policy_slot`.
    // transpileFastAPI installs the real executor on `app.state` whenever any
    // route declares a policy (see fastapi-policy-runtime.ts); this fallback
    // only fires if a route module is imported/mounted outside that app
    // construction path — it denies instead of raising AttributeError.
    bodyLines.push('async def __kern_policy_runtime_missing(entry, slot, facts):');
    bodyLines.push(
      '    return [{"action": "deny", "status": 401, "body": {"error": "policy_denied", "reason": "policy runtime not installed"}}]',
    );
    bodyLines.push('');
  }

  // Route handler
  if (caps.hasStream) {
    // Portable stream bodies remap `body.<camelField>` to the snake_case
    // Pydantic attribute, exactly as the standard portable route does.
    const streamBodyFields = new Set(schema.body ? extractBodyFieldNames(schema.body) : []);
    bodyLines.push(
      ...generateStreamRoute(
        routeNode,
        caps,
        normalizedMethod,
        fastapiPath,
        pathParams,
        imports,
        streamBodyFields,
        !!schema.body,
        {
          queryParams,
          middlewareDeps,
          authNode,
          validateNode,
          normalizedMethod,
          authModuleSpec: routeAuthModuleSpec,
        },
      ),
    );
  } else if (caps.hasTimer && caps.timerNode) {
    bodyLines.push(...generateTimerRoute(routeNode, caps, normalizedMethod, fastapiPath, pathParams, routeHandlerCode));
  } else {
    // Standard route — build function signature
    const paramParts: string[] = [];
    // Names IN the def signature — fed to the body emitter as outerBindings so
    // a native KERN `let x` inside an inner block that shadows a param triggers
    // the block-scope rename (post-agon-review #f1afb9b3; production-caller
    // fix for nero Challenge 2). Order matches paramParts pushes 1:1.
    const paramNames: string[] = [];
    if (hasPolicyNodes) {
      paramParts.push('request: Request');
      paramNames.push('request');
    }
    for (const param of pathParams) {
      paramParts.push(`${param}: str`);
      paramNames.push(param);
    }

    // v3 query params with types and defaults
    for (const qp of queryParams) {
      const pyType = qp.type === 'number' ? 'int' : qp.type === 'boolean' ? 'bool' : 'str';
      const snake = toSnakeCase(qp.name);
      if (qp.default !== undefined) {
        paramParts.push(`${snake}: ${pyType} = ${qp.default}`);
      } else {
        paramParts.push(`${snake}: ${pyType}`);
      }
      paramNames.push(snake);
    }

    // A policy-guarded route with a declared body schema must NOT bind
    // `body: RequestBody` directly in the def signature — FastAPI's
    // dependency solver parses/validates every declared parameter (Pydantic
    // models included) BEFORE the function body runs, which would let
    // Pydantic reject (422) or consume the raw body ahead of the pre-slot
    // guard. `body` is instead constructed from the raw bytes AFTER an
    // allow decision, further down. It still claims the `body` name in
    // paramNames so a native KERN `let body` inside the handler still
    // triggers the shadow-rename protection.
    const bindsBodyAsHandlerLocal = !!schema.body && hasPolicyNodes;
    if (schema.body) {
      if (!hasPolicyNodes) paramParts.push('body: RequestBody');
      paramNames.push('body');
    }

    // v3 validate — method-aware: body param for POST/PUT/PATCH, Depends for GET/DELETE
    if (validateNode && !schema.body) {
      const validateSchema = String(getProps(validateNode).schema || '');
      if (validateSchema) {
        const bodyMethods = new Set(['post', 'put', 'patch']);
        if (bodyMethods.has(normalizedMethod)) {
          paramParts.push(`body: ${validateSchema}`);
          paramNames.push('body');
        } else {
          imports.add('from fastapi import Depends');
          paramParts.push(`validated = Depends(${toSnakeCase(validateSchema)})`);
          paramNames.push('validated');
        }
      }
    }

    // v3 route-level middleware → Depends()
    for (const dep of middlewareDeps) {
      paramParts.push(`_${dep} = Depends(${dep})`);
      paramNames.push(`_${dep}`);
    }

    // v3 auth — add Depends(auth_required)
    if (authNode) {
      const authMode = String(getProps(authNode).mode || 'required');
      const authFunc = authMode === 'optional' ? 'auth_optional' : 'auth_required';
      // The auth helper lives in the generated `auth.py`; each route module
      // that depends on it must import it, or the route file fails at import
      // time with a NameError (Codex review on commit 54fb0e24). The specifier
      // is package-aware (`routeAuthModuleSpec`) so packaged output resolves it
      // relatively (Codex review on commit 02ecb2fa).
      imports.add(`from ${routeAuthModuleSpec} import ${authFunc}`);
      paramParts.push(`user = Depends(${authFunc})`);
      paramNames.push('user');
    }

    const paramStr = paramParts.join(', ');
    bodyLines.push(`@router.${normalizedMethod}("${fastapiPath}")`);
    bodyLines.push(`async def ${toSnakeCase(normalizedMethod)}_${slugify(fastapiPath)}(${paramStr}):`);
    if (hasPolicyNodes) {
      bodyLines.push(`    __kern_raw_body = await request.body()`);
      bodyLines.push(
        `    __kern_policy_facts = getattr(request.app.state, "kern_policy_facts", lambda request, raw_body: {"headers": dict(request.headers), "rawBody": raw_body})(request, __kern_raw_body)`,
      );
      bodyLines.push(
        `    __kern_decision = await getattr(request.app.state, "execute_kern_policy_slot", __kern_policy_runtime_missing)(__kern_route_policy_entry, "pre", __kern_policy_facts)`,
      );
      bodyLines.push(`    __kern_denied = next((p for p in __kern_decision if p.get("action") == "deny"), None)`);
      bodyLines.push(`    if __kern_denied is not None:`);
      bodyLines.push(
        `        raise HTTPException(status_code=__kern_denied.get("status", 401), detail=__kern_denied.get("body", {"error": "policy_denied"}))`,
      );
      if (bindsBodyAsHandlerLocal) {
        // Only reachable past an allow decision — the Pydantic model is
        // constructed from the SAME raw bytes the guard verified, so the
        // handler still receives the parsed model (H7) without giving
        // Pydantic a chance to run ahead of the guard.
        bodyLines.push('    try:');
        bodyLines.push('        body = RequestBody.model_validate_json(__kern_raw_body)');
        bodyLines.push('    except Exception as __kern_body_error:');
        bodyLines.push('        raise HTTPException(status_code=422, detail=str(__kern_body_error))');
      }
    }

    // v3 error contract as docstring
    if (errorNodes.length > 0) {
      bodyLines.push(
        `    """Errors: ${errorNodes.map((n) => `${getProps(n).status} ${getProps(n).message || ''}`).join(', ')}"""`,
      );
    }

    if (hasPortableNodes) {
      // Body fields are snake-cased into the generated Pydantic model, so
      // portable expressions referencing `body.<camelField>` must be
      // rewritten to the model's snake_case attribute. Only fields from a
      // model WE generate (inline `schema.body`) are remapped; an external
      // `validate` schema's field naming is the author's contract.
      const bodyFields = new Set(schema.body ? extractBodyFieldNames(schema.body) : []);
      // When the route declares auth, the `user` symbol is the decoded JWT
      // payload — a plain dict returned by auth_required/auth_optional — so
      // attribute access (`user.id`) must lower to subscript (`user["id"]`).
      bodyLines.push(...generatePortableHandlerFastAPI(routeNode, '    ', pathParams, imports, bodyFields, !!authNode));
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
      } = emitNativeKernBodyPythonWithImports(handlerNode, {
        symbolMap,
        propagateStyle: 'http-exception',
        // Pass def-signature param names so a native `let x` inside an inner
        // block that shadows a param triggers __k_shadow_x_N rename in the
        // body emitter. Without this, params remained unprotected in
        // production builds (caught by agon review of commit f1afb9b3).
        outerBindings: paramNames,
      });
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
