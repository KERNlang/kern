/**
 * Portable handler generation for the FastAPI transpiler.
 *
 * Converts IR portable nodes (derive, guard, handler, respond, branch, each, collect, effect)
 * into Python/FastAPI handler code.
 */

import type { IRNode } from '@kernlang/core';
import {
  emitStringKeyArray,
  getChildren,
  getFirstChild,
  getProps,
  isPostfixMutationOperator,
  isSupportedAssignOperator,
  parseKeys,
  parsePortableNonNegativeIntLiteral,
  parsePortablePathSegments,
  splitPortableExpressionList,
} from '@kernlang/core';
import { extractExprCode, rewriteExpr } from './core/expr/index.js';
import { isUnsupportedJsHandlerBody, unsupportedRawHandlerBody } from './fastapi-raw-handler.js';
import { addRespondImports, generateRespondFastAPI } from './fastapi-response.js';
import { escapePyStr, indentHandler } from './fastapi-utils.js';
import { emitPythonRoutePluckHelper, pythonRouteCompactPredicate } from './portable-collection-emitter.js';
import { pythonRouteRecordExpr, pythonRouteRecordPickExpr } from './portable-object-emitter.js';
import { emitPythonPredicateHelpers } from './portable-predicate-emitter.js';
import { mapTsTypeToPython, toPythonBindingName, toSnakeCase } from './type-map.js';

// Extract the code from a prop that may arrive as a `{{ ... }}` curly-
// expression IR wrapper (`{ __expr: true, code: '...' }`), a plain string
// (legacy `name=value` form), OR a bare number/boolean primitive that the
// IR may carry through (e.g. `fallback=0`). Returns '' for anything else
// (objects without `__expr`, null/undefined).
//
// Review fix (Gemini B5 on 86e6b893): the previous `typeof val ===
// 'string' ? val : ''` branch silently dropped numeric/boolean primitives
// to '' and lowerPropToPython then emitted `None` — a data-loss
// regression versus the original naked `String(...)` which at least
// preserved `"0"`/`"false"`.
function extractCodeOrString(val: unknown): string {
  const fromExpr = extractExprCode(val);
  if (fromExpr) return fromExpr;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return '';
}

function requirePortableProp(nodeType: string, propName: string, value: string): string {
  if (!value) throw new Error(`portable route \`${nodeType}\` requires \`${propName}=\`.`);
  return value;
}

function pushJsObjectKeyCoercion(lines: string[], indent: string, keyName: string): void {
  lines.push(`${indent}if ${keyName} is None:`);
  lines.push(`${indent}    ${keyName} = "null"`);
  lines.push(`${indent}elif isinstance(${keyName}, bool):`);
  lines.push(`${indent}    ${keyName} = "true" if ${keyName} else "false"`);
  lines.push(`${indent}elif isinstance(${keyName}, float):`);
  lines.push(`${indent}    if ${keyName} != ${keyName}:`);
  lines.push(`${indent}        ${keyName} = "NaN"`);
  lines.push(`${indent}    elif ${keyName} == float("inf"):`);
  lines.push(`${indent}        ${keyName} = "Infinity"`);
  lines.push(`${indent}    elif ${keyName} == float("-inf"):`);
  lines.push(`${indent}        ${keyName} = "-Infinity"`);
  lines.push(`${indent}    elif ${keyName}.is_integer():`);
  lines.push(`${indent}        ${keyName} = str(int(${keyName}))`);
  lines.push(`${indent}    else:`);
  lines.push(`${indent}        ${keyName} = str(${keyName})`);
  lines.push(`${indent}elif not isinstance(${keyName}, (str, int)):`);
  lines.push(`${indent}    raise TypeError("keyed reshape selector must produce a scalar key")`);
  lines.push(`${indent}else:`);
  lines.push(`${indent}    ${keyName} = str(${keyName})`);
}

// NOTE: the former `lowerPropToPython` helper was removed when native closure
// hoisting landed (#5): every prop site now routes through `rewriteFastAPIStmtExpr`
// so a closure inside a prop (`respond json={{ items.map(x => { … }) }}`) can flush
// its hoisted `def`. The JS-literal translations it used to do (`true`→`True`,
// `null`/`undefined`→`None`) are already performed inside `rewriteFastAPIExpr`; each
// call site keeps the `.trim()` + empty-string→`None` guard it relied on.

/**
 * Streaming-body context (slice 4c). Threaded through the portable emitter only
 * when generating a `stream` response body:
 *   - `queueVar` set  → `emit` lowers to `await <queueVar>.put(<frame>)` (inside
 *     a concurrent `fanout` producer that feeds the fan-in queue).
 *   - `queueVar` unset → `emit` lowers to `yield <frame>` (the sequential
 *     generator path).
 *   - `abortExpr` is inserted as `if <abortExpr>: break` at the top of each
 *     `each await` loop body, so a disconnected client stops upstream pulls.
 * Undefined for ordinary routes — `each await` then emits no disconnect check.
 */
export interface FastAPIStreamCtx {
  queueVar?: string;
  abortExpr?: string;
  /**
   * Shared mutable counter that uniquifies each `fanout`'s generated helper
   * names (`__k_q_<name>_<seq>`, …). Threaded by reference through nested
   * scopes so two sibling fan-outs that share a loop-var name don't collide
   * (Gemini/kimi review on slice 4c).
   */
  fanoutSeq?: { n: number };
}

interface FastAPIClosureHoistCtx {
  seq: { n: number };
}

function indentHoistedDef(def: string, indent: string): string[] {
  return def.split('\n').map((line) => `${indent}${line}`);
}

function rewriteFastAPIStmtExpr(
  expr: string,
  indent: string,
  pathParams: string[],
  bodyFields: Set<string>,
  authUser: boolean,
  imports: Set<string>,
  hoistCtx: FastAPIClosureHoistCtx,
): { expr: string; hoists: string[] } {
  const defs: string[] = [];
  const rewritten = rewriteExpr(expr, pathParams, bodyFields, authUser, imports, defs, hoistCtx.seq);
  return { expr: rewritten, hoists: defs.flatMap((def) => indentHoistedDef(def, indent)) };
}

export function generatePortableChildFastAPI(
  child: IRNode,
  indent: string,
  pathParams: string[],
  imports: Set<string>,
  bodyFields: Set<string> = new Set(),
  authUser = false,
  streamCtx?: FastAPIStreamCtx,
  closureHoistCtx?: FastAPIClosureHoistCtx,
): string[] {
  const lines: string[] = [];
  const p = getProps(child);
  const hoistCtx = closureHoistCtx ?? { seq: { n: 0 } };

  switch (child.type) {
    case 'derive': {
      const name = String(p.name || '');
      const exprCode = extractExprCode(p.expr);
      if (name && exprCode) {
        const rewritten = rewriteFastAPIStmtExpr(exprCode, indent, pathParams, bodyFields, authUser, imports, hoistCtx);
        lines.push(...rewritten.hoists, `${indent}${toSnakeCase(name)} = ${rewritten.expr}`);
      }
      break;
    }
    case 'assign': {
      // Portable side-effect: `assign target="provider.enabled" value="body.enabled"`
      // → `provider.enabled = body.enabled`. Both sides flow through the same
      // rewriter as `derive`, so `body.x` lowers to the Pydantic field access.
      const target = extractExprCode(p.target);
      if (!target) break;
      const op = p.op === undefined || p.op === '' ? '=' : String(p.op);
      if (!isSupportedAssignOperator(op)) {
        throw new Error(`portable route \`assign op="${op}"\` is not supported on the FastAPI target.`);
      }
      const lhs = rewriteFastAPIStmtExpr(target, indent, pathParams, bodyFields, authUser, imports, hoistCtx);
      lines.push(...lhs.hoists);
      if (isPostfixMutationOperator(op)) {
        // Python lacks `++`/`--`; lower to the canonical compound form.
        lines.push(`${indent}${lhs.expr} ${op === '++' ? '+=' : '-='} 1`);
      } else {
        const valueCode = extractExprCode(p.value);
        // `value` is schema-required for a non-postfix `assign`; fail loud here
        // too (parity with the body-statement emitter) rather than silently
        // dropping the statement for a direct-IR caller that skipped validation.
        if (!valueCode) {
          throw new Error('portable route `assign` requires `value=` for a non-postfix operator.');
        }
        const rhs = rewriteFastAPIStmtExpr(valueCode, indent, pathParams, bodyFields, authUser, imports, hoistCtx);
        lines.push(...rhs.hoists, `${indent}${lhs.expr} ${op} ${rhs.expr}`);
      }
      break;
    }
    case 'do': {
      // Portable void side-effect: `do value="registry.register(provider)"` →
      // the bare call statement.
      const value = extractExprCode(p.value);
      if (value) {
        const rewritten = rewriteFastAPIStmtExpr(value, indent, pathParams, bodyFields, authUser, imports, hoistCtx);
        lines.push(...rewritten.hoists, `${indent}${rewritten.expr}`);
      }
      break;
    }
    case 'guard': {
      const name = String(p.name || '');
      const exprCode = extractExprCode(p.expr);
      const elseStatus = p.else ? parseInt(String(p.else), 10) : 404;
      const elseMessage = typeof p.message === 'string' ? p.message : name ? `${name} guard failed` : 'Guard failed';
      if (exprCode) {
        imports.add('from fastapi import HTTPException');
        const rewritten = rewriteFastAPIStmtExpr(exprCode, indent, pathParams, bodyFields, authUser, imports, hoistCtx);
        lines.push(...rewritten.hoists, `${indent}if not (${rewritten.expr}):`);
        lines.push(`${indent}    raise HTTPException(status_code=${elseStatus}, detail="${escapePyStr(elseMessage)}")`);
      }
      break;
    }
    case 'handler': {
      const code = String(p.code || '');
      if (code) {
        // When a route uses portable nodes and ALSO has a raw `<<<...>>>`
        // handler child, the body is typically JS/TS (the legacy authoring
        // form). Emitting it verbatim into a Python `def` produces
        // `SyntaxError` on import. Apply the same JS-detection guard the
        // top-level handler path in fastapi-route.ts uses.
        if (isUnsupportedJsHandlerBody(code)) {
          lines.push(...unsupportedRawHandlerBody(indent));
        } else {
          lines.push(...indentHandler(code, indent));
        }
      }
      break;
    }
    case 'respond': {
      // Clone props to avoid mutating shared AST, then rewrite portable refs.
      // Use extractExprCode so a curly-expression value (`json={{ {a: 1} }}`)
      // yields its code rather than `String({__expr})` → "[object Object]";
      // plain identifiers (`json=user`) pass through unchanged.
      const clonedRespond: IRNode = { ...child, props: { ...child.props } };
      if (clonedRespond.props!.json) {
        const rewritten = rewriteFastAPIStmtExpr(
          extractExprCode(clonedRespond.props!.json),
          indent,
          pathParams,
          bodyFields,
          authUser,
          imports,
          hoistCtx,
        );
        lines.push(...rewritten.hoists);
        clonedRespond.props!.json = rewritten.expr;
      }
      if (clonedRespond.props!.text) {
        const rewritten = rewriteFastAPIStmtExpr(
          extractExprCode(clonedRespond.props!.text),
          indent,
          pathParams,
          bodyFields,
          authUser,
          imports,
          hoistCtx,
        );
        lines.push(...rewritten.hoists);
        clonedRespond.props!.text = rewritten.expr;
      }
      addRespondImports(clonedRespond, imports);
      lines.push(...generateRespondFastAPI(clonedRespond, indent));
      break;
    }
    case 'branch': {
      const onSource = extractCodeOrString(p.on);
      const on =
        onSource.trim() === '' || onSource.trim() === 'null' || onSource.trim() === 'undefined'
          ? { expr: 'None', hoists: [] }
          : rewriteFastAPIStmtExpr(onSource.trim(), indent, pathParams, bodyFields, authUser, imports, hoistCtx);
      lines.push(...on.hoists);
      const paths = getChildren(child, 'path');
      for (let i = 0; i < paths.length; i++) {
        const pathNode = paths[i];
        const pp = getProps(pathNode);
        const value = String(pp.value || '');
        const keyword = i === 0 ? 'if' : 'elif';
        lines.push(`${indent}${keyword} ${on.expr} == "${escapePyStr(value)}":`);
        const bodyStart = lines.length;
        for (const pathChild of pathNode.children || []) {
          lines.push(
            ...generatePortableChildFastAPI(
              pathChild,
              `${indent}    `,
              pathParams,
              imports,
              bodyFields,
              authUser,
              streamCtx,
              hoistCtx,
            ),
          );
        }
        if (lines.length === bodyStart) lines.push(`${indent}    pass`);
      }
      break;
    }
    case 'let': {
      // Stream/iteration-scoped binding — `let name=adapter value="…"` →
      // `adapter = …`. Name is emitted verbatim (NOT snake-cased) so later
      // references in sibling expressions still resolve. Flows through the same
      // rewriter as `derive`.
      const name = String(p.name || '');
      if (!name) break;
      const valueCode = extractExprCode(p.value) || extractExprCode(p.expr);
      if (valueCode) {
        const rewritten = rewriteFastAPIStmtExpr(
          valueCode,
          indent,
          pathParams,
          bodyFields,
          authUser,
          imports,
          hoistCtx,
        );
        lines.push(...rewritten.hoists, `${indent}${name} = ${rewritten.expr}`);
      }
      break;
    }
    case 'each': {
      const name = String(p.name || 'item');
      const collection = rewriteFastAPIStmtExpr(
        extractExprCode(p.in) || String(p.in || ''),
        indent,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      lines.push(...collection.hoists);
      const index = p.index ? String(p.index) : undefined;
      const isAwait = p.await === true || p.await === 'true';
      if (isAwait) {
        // `each await=true` → `async for x in <aiter>:`. Cannot combine with
        // `index=` (rejected by the core validator), so no enumerate() branch.
        lines.push(`${indent}async for ${name} in ${collection.expr}:`);
      } else if (index) {
        lines.push(`${indent}for ${index}, ${name} in enumerate(${collection.expr}):`);
      } else {
        lines.push(`${indent}for ${name} in ${collection.expr}:`);
      }
      const bodyStart = lines.length;
      if (isAwait && streamCtx?.abortExpr) {
        // Stop pulling from the upstream async iterable once the client is gone.
        lines.push(`${indent}    if ${streamCtx.abortExpr}:`);
        lines.push(`${indent}        break`);
      }
      for (const eachChild of child.children || []) {
        lines.push(
          ...generatePortableChildFastAPI(
            eachChild,
            `${indent}    `,
            pathParams,
            imports,
            bodyFields,
            authUser,
            streamCtx,
            hoistCtx,
          ),
        );
      }
      if (lines.length === bodyStart) lines.push(`${indent}    pass`);
      break;
    }
    case 'fanout': {
      // Concurrent fan-out → `asyncio.Queue` fan-in. N producer coroutines run
      // under `asyncio.gather(..., return_exceptions=True)` (the faithful
      // analogue of TS `Promise.allSettled`), each putting pre-framed SSE
      // strings onto a shared queue; a merge task pushes a sentinel once all
      // finish, and the generator drains the queue, yielding until the
      // sentinel. Names are suffixed with the loop var so sibling fan-outs in
      // one generator don't collide.
      imports.add('import asyncio');
      const name = String(p.name || 'item');
      const collection = rewriteFastAPIStmtExpr(
        extractExprCode(p.in) || String(p.in || ''),
        indent,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      lines.push(...collection.hoists);
      // Suffix with the loop var AND a per-stream sequence so sibling fan-outs
      // sharing a name (`fanout name=item` twice) don't collide in the shared
      // generator scope.
      const seq = streamCtx?.fanoutSeq ? streamCtx.fanoutSeq.n++ : 0;
      const sfx = `${toSnakeCase(name)}_${seq}`;
      const q = `__k_q_${sfx}`;
      const done = `__k_done_${sfx}`;
      const producer = `__k_producer_${sfx}`;
      const merge = `__k_merge_${sfx}`;
      const mergeTask = `__k_merge_task_${sfx}`;
      const event = `__k_event_${sfx}`;
      // Inside a producer, `emit` puts onto the queue and `each await` checks
      // disconnect via the FastAPI Request injected into the route signature.
      // The same `fanoutSeq` ref propagates so a nested fan-out stays unique.
      const producerCtx: FastAPIStreamCtx = {
        queueVar: q,
        abortExpr: 'await request.is_disconnected()',
        fanoutSeq: streamCtx?.fanoutSeq,
      };

      lines.push(`${indent}${q}: asyncio.Queue = asyncio.Queue()`);
      lines.push(`${indent}${done} = object()`);
      lines.push(`${indent}async def ${producer}(${name}):`);
      // Skip a producer whose client already disconnected — symmetry with the
      // Express `if (ac.signal.aborted) return;` (kimi review). Covers producers
      // that have no inner `each await` to carry the per-event check.
      lines.push(`${indent}    if await request.is_disconnected():`);
      lines.push(`${indent}        return`);
      for (const fanChild of child.children || []) {
        lines.push(
          ...generatePortableChildFastAPI(
            fanChild,
            `${indent}    `,
            pathParams,
            imports,
            bodyFields,
            authUser,
            producerCtx,
            hoistCtx,
          ),
        );
      }
      lines.push(`${indent}async def ${merge}():`);
      lines.push(
        `${indent}    await asyncio.gather(*[${producer}(${name}) for ${name} in ${collection.expr}], return_exceptions=True)`,
      );
      lines.push(`${indent}    await ${q}.put(${done})`);
      lines.push(`${indent}${mergeTask} = asyncio.create_task(${merge}())`);
      lines.push(`${indent}try:`);
      lines.push(`${indent}    while True:`);
      lines.push(`${indent}        ${event} = await ${q}.get()`);
      lines.push(`${indent}        if ${event} is ${done}:`);
      lines.push(`${indent}            break`);
      // Top-level fan-out yields to the StreamingResponse; a fan-out NESTED in
      // another producer must forward to the enclosing queue instead — a `yield`
      // here would turn the outer producer into an async generator, so
      // `asyncio.gather` would receive a non-awaitable and the stream would hang
      // (Codex review). `streamCtx.queueVar` is set iff we're inside a producer.
      lines.push(
        streamCtx?.queueVar
          ? `${indent}        await ${streamCtx.queueVar}.put(${event})`
          : `${indent}        yield ${event}`,
      );
      lines.push(`${indent}finally:`);
      lines.push(`${indent}    ${mergeTask}.cancel()`);
      break;
    }
    case 'emit': {
      // Push one SSE frame. The frame string (`data: <json>\n\n`, optionally
      // prefixed with an `event:` line) is built HERE so event names work in
      // both modes; the consumer just relays it. In a `fanout` producer it goes
      // onto the queue; in a sequential generator it is yielded directly.
      const value = extractExprCode(p.value) || String(p.value || '');
      if (!value) break;
      imports.add('import json');
      const rewritten = rewriteFastAPIStmtExpr(value, indent, pathParams, bodyFields, authUser, imports, hoistCtx);
      lines.push(...rewritten.hoists);
      const evName = typeof p.event === 'string' && p.event ? p.event : undefined;
      // String concatenation, NOT an f-string: a rewritten object/dict payload
      // (`{{ {type: x} }}` → `{"type": x}`) contains double quotes that would
      // collide with an enclosing f-string's quotes and raise SyntaxError on
      // Python < 3.12 (PEP 701). Concatenation sidesteps the nesting entirely
      // (Codex P1 on slice 4c).
      const frame = evName
        ? `"event: ${escapePyStr(evName)}\\ndata: " + json.dumps(${rewritten.expr}) + "\\n\\n"`
        : `"data: " + json.dumps(${rewritten.expr}) + "\\n\\n"`;
      if (streamCtx?.queueVar) {
        lines.push(`${indent}await ${streamCtx.queueVar}.put(${frame})`);
      } else {
        lines.push(`${indent}yield ${frame}`);
      }
      break;
    }
    case 'collect': {
      const rawName = toSnakeCase(String(p.name || ''));
      // Avoid shadowing Python built-ins
      const PY_BUILTINS = new Set([
        'sorted',
        'list',
        'dict',
        'set',
        'map',
        'filter',
        'type',
        'id',
        'input',
        'print',
        'range',
        'len',
        'min',
        'max',
        'sum',
        'any',
        'all',
      ]);
      const collectName = PY_BUILTINS.has(rawName) ? `${rawName}_result` : rawName;
      const from = rewriteFastAPIStmtExpr(
        extractCodeOrString(p.from).trim(),
        indent,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      lines.push(...from.hoists);
      const where = p.where ? extractExprCode(p.where) : undefined;
      // `limit` is typically a literal integer (`limit=10`) but can be a
      // curly-expression (`limit={{params.max}}`) — route through the same
      // helper used for from/order so the `[object Object]` bug class
      // doesn't lurk here either (Gemini M3 on 86e6b893).
      const limit =
        p.limit !== undefined && p.limit !== null && p.limit !== ''
          ? rewriteFastAPIStmtExpr(
              extractCodeOrString(p.limit).trim(),
              indent,
              pathParams,
              bodyFields,
              authUser,
              imports,
              hoistCtx,
            )
          : undefined;
      // Compute order in two stages so we can suppress `sorted()`
      // emission entirely when the source value resolves to absent / null
      // / undefined. Fix-up 6 routed `order` through `lowerPropToPython`,
      // but that maps `null`/`undefined`/empty to `'None'` — which then
      // emitted `sorted(items, key=lambda item: None)` and crashed at
      // runtime with `TypeError: '<' not supported between instances of
      // 'NoneType' and 'NoneType'`. Worse failure than the pre-fix
      // `NameError: null`. Codex flagged this as blocking on commit
      // 7a25348b.
      //
      // The right call is: `order=null`/`order={{null}}` means "no
      // ordering," not "sort by None." Detect those forms in the source
      // and skip sort emission entirely.
      const orderSourceTrimmed = extractCodeOrString(p.order).trim();
      const order =
        orderSourceTrimmed === '' || orderSourceTrimmed === 'null' || orderSourceTrimmed === 'undefined'
          ? undefined
          : rewriteFastAPIStmtExpr(orderSourceTrimmed, indent, pathParams, bodyFields, authUser, imports, hoistCtx);
      if (limit) lines.push(...limit.hoists);
      if (order) lines.push(...order.hoists);
      if (where && !order && !limit) {
        const whereExpr = rewriteFastAPIStmtExpr(where, indent, pathParams, bodyFields, authUser, imports, hoistCtx);
        lines.push(...whereExpr.hoists);
        lines.push(`${indent}${collectName} = [item for item in ${from.expr} if ${whereExpr.expr}]`);
      } else {
        lines.push(`${indent}${collectName} = ${from.expr}`);
        if (where) {
          const whereExpr = rewriteFastAPIStmtExpr(where, indent, pathParams, bodyFields, authUser, imports, hoistCtx);
          lines.push(
            ...whereExpr.hoists,
            `${indent}${collectName} = [item for item in ${collectName} if ${whereExpr.expr}]`,
          );
        }
        if (order) {
          // `order` is a COMPARATOR expression over a/b — the Express and ground-layer
          // targets both emit `.sort((a, b) => <order>)`, and JS is the declared reference
          // (scripts/conformance.mjs header). Python must reproduce that, so wrap with
          // cmp_to_key; a 1-arg `key=lambda item: <order>` was the divergent outlier and
          // NameErrors on the a/b operands. (`order` already routed through lowerPropToPython.)
          imports.add('from functools import cmp_to_key');
          lines.push(`${indent}${collectName} = sorted(${collectName}, key=cmp_to_key(lambda a, b: ${order.expr}))`);
        }
        if (limit) lines.push(`${indent}${collectName} = ${collectName}[:${limit.expr}]`);
      }
      break;
    }
    case 'count': {
      const name = toSnakeCase(String(p.name || ''));
      if (!name) break;
      const collection = rewriteFastAPIStmtExpr(
        extractCodeOrString(p.in).trim(),
        indent,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      lines.push(...collection.hoists);
      const item = String(p.item || 'item');
      const where = p.where ? extractCodeOrString(p.where) : undefined;
      const predicateStr = p.predicate ? extractExprCode(p.predicate) || String(p.predicate) : undefined;
      const typeAnnotation = p.type ? `: ${mapTsTypeToPython(String(p.type))}` : '';

      if (predicateStr && where) {
        throw new Error("count node cannot combine 'where' and 'predicate'");
      }

      if (predicateStr) {
        const predicateExpr = rewriteFastAPIStmtExpr(
          predicateStr,
          indent,
          pathParams,
          bodyFields,
          authUser,
          imports,
          hoistCtx,
        );
        lines.push(...predicateExpr.hoists);

        const absentVar = `__KernAbsent_${name}`;
        const getPathVar = `__kern_get_path_${name}`;
        const equalVar = `__kern_equal_${name}`;
        const evalPredVar = `__kern_eval_predicate_${name}`;
        const predicateValueVar = `__kern_predicate_${name}`;

        lines.push(...emitPythonPredicateHelpers(indent, absentVar, getPathVar, equalVar, evalPredVar));

        lines.push(`${indent}${predicateValueVar} = ${predicateExpr.expr}`);
        lines.push(
          `${indent}${name}${typeAnnotation} = sum(1 for ${item} in ${collection.expr} if ${evalPredVar}(${predicateValueVar}, ${item}))`,
        );
      } else if (where) {
        const whereExpr = rewriteFastAPIStmtExpr(where, indent, pathParams, bodyFields, authUser, imports, hoistCtx);
        lines.push(...whereExpr.hoists);
        lines.push(`${indent}${name}${typeAnnotation} = sum(1 for ${item} in ${collection.expr} if ${whereExpr.expr})`);
      } else {
        lines.push(`${indent}${name}${typeAnnotation} = len(${collection.expr})`);
      }
      break;
    }
    case 'filter': {
      const name = toPythonBindingName(requirePortableProp('filter', 'name', String(p.name || '')), 'filter');
      const item = String(p.item || 'item');
      const inVal = extractCodeOrString(p.in).trim();
      const collection = rewriteFastAPIStmtExpr(
        requirePortableProp('filter', 'in', inVal),
        indent,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      lines.push(...collection.hoists);

      const where = p.where ? extractExprCode(p.where) : undefined;
      const predicateStr = p.predicate ? extractExprCode(p.predicate) || String(p.predicate) : undefined;

      if (predicateStr && where) {
        throw new Error("filter node cannot combine 'where' and 'predicate'");
      }

      if (predicateStr) {
        const predicateExpr = rewriteFastAPIStmtExpr(
          predicateStr,
          indent,
          pathParams,
          bodyFields,
          authUser,
          imports,
          hoistCtx,
        );
        lines.push(...predicateExpr.hoists);

        const absentVar = `__KernAbsent_${name}`;
        const getPathVar = `__kern_get_path_${name}`;
        const equalVar = `__kern_equal_${name}`;
        const evalPredVar = `__kern_eval_predicate_${name}`;
        const predicateValueVar = `__kern_predicate_${name}`;

        lines.push(...emitPythonPredicateHelpers(indent, absentVar, getPathVar, equalVar, evalPredVar));

        lines.push(`${indent}${predicateValueVar} = ${predicateExpr.expr}`);
        lines.push(
          `${indent}${name} = [${item} for ${item} in ${collection.expr} if ${evalPredVar}(${predicateValueVar}, ${item})]`,
        );
      } else if (where) {
        const whereExpr = rewriteFastAPIStmtExpr(where, indent, pathParams, bodyFields, authUser, imports, hoistCtx);
        lines.push(...whereExpr.hoists);
        lines.push(`${indent}${name} = [${item} for ${item} in ${collection.expr} if ${whereExpr.expr}]`);
      } else {
        throw new Error("filter node requires a 'where' or 'predicate' prop");
      }
      break;
    }
    case 'compact': {
      const name = toPythonBindingName(requirePortableProp('compact', 'name', String(p.name || '')), 'compact');
      const item = 'item';
      const collection = rewriteFastAPIStmtExpr(
        requirePortableProp('compact', 'in', extractCodeOrString(p.in).trim()),
        indent,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      lines.push(...collection.hoists);
      const typeAnnotation = p.type ? `: ${mapTsTypeToPython(String(p.type))}` : '';
      lines.push(
        `${indent}${name}${typeAnnotation} = [${item} for ${item} in ${collection.expr} if ${pythonRouteCompactPredicate(item)}]`,
      );
      break;
    }
    case 'pluck': {
      const name = toPythonBindingName(requirePortableProp('pluck', 'name', String(p.name || '')), 'pluck');
      const collection = rewriteFastAPIStmtExpr(
        requirePortableProp('pluck', 'in', extractCodeOrString(p.in).trim()),
        indent,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      lines.push(...collection.hoists);
      const segments = parsePortablePathSegments(
        requirePortableProp('pluck', 'prop', extractCodeOrString(p.prop).trim()),
        child,
        'prop',
      );
      const pathExpr = emitStringKeyArray(segments);
      const helperName = `__kern_pluck_${name}`;
      const typeAnnotation = p.type ? `: ${mapTsTypeToPython(String(p.type))}` : '';
      emitPythonRoutePluckHelper(lines, indent, helperName, pathExpr);
      lines.push(
        `${indent}${name}${typeAnnotation} = [${helperName}(__kern_item) for __kern_item in ${collection.expr}]`,
      );
      break;
    }
    case 'take':
    case 'drop': {
      const kind = child.type;
      const name = toPythonBindingName(requirePortableProp(kind, 'name', String(p.name || '')), kind);
      const collection = rewriteFastAPIStmtExpr(
        requirePortableProp(kind, 'in', extractCodeOrString(p.in).trim()),
        indent,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      lines.push(...collection.hoists);
      const n = parsePortableNonNegativeIntLiteral(
        requirePortableProp(kind, 'n', extractCodeOrString(p.n).trim()),
        child,
        'n',
      );
      const typeAnnotation = p.type ? `: ${mapTsTypeToPython(String(p.type))}` : '';
      const slice = kind === 'take' ? `[:${n}]` : `[${n}:]`;
      lines.push(`${indent}${name}${typeAnnotation} = ${collection.expr}${slice}`);
      break;
    }
    case 'objectMerge': {
      const name = toPythonBindingName(requirePortableProp('objectMerge', 'name', String(p.name || '')), 'objectMerge');
      const rawSources = requirePortableProp('objectMerge', 'sources', extractCodeOrString(p.sources).trim());
      const sources = splitPortableExpressionList(rawSources, 'objectMerge sources=');
      if (sources.length < 2) throw new Error('portable route `objectMerge` requires at least two source expressions.');
      const emitted: string[] = [];
      for (const source of sources) {
        if (source.startsWith('...')) {
          throw new Error('portable route `objectMerge` sources must not start with `...`; spreading is implicit.');
        }
        const rewritten = rewriteFastAPIStmtExpr(source, indent, pathParams, bodyFields, authUser, imports, hoistCtx);
        lines.push(...rewritten.hoists);
        emitted.push(`**${pythonRouteRecordExpr(rewritten.expr)}`);
      }
      const typeAnnotation = p.type ? `: ${mapTsTypeToPython(String(p.type))}` : '';
      lines.push(`${indent}${name}${typeAnnotation} = {${emitted.join(', ')}}`);
      break;
    }
    case 'objectPick': {
      const name = toPythonBindingName(requirePortableProp('objectPick', 'name', String(p.name || '')), 'objectPick');
      const source = rewriteFastAPIStmtExpr(
        requirePortableProp('objectPick', 'in', extractCodeOrString(p.in).trim()),
        indent,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      lines.push(...source.hoists);
      const keys = emitStringKeyArray(
        parseKeys(
          requirePortableProp('objectPick', 'keys', extractCodeOrString(p.keys).trim()),
          child,
          'objectPick keys=',
        ),
      );
      const typeAnnotation = p.type ? `: ${mapTsTypeToPython(String(p.type))}` : '';
      lines.push(`${indent}${name}${typeAnnotation} = ${pythonRouteRecordPickExpr(source.expr, keys)}`);
      break;
    }
    case 'objectOmit': {
      const name = toPythonBindingName(requirePortableProp('objectOmit', 'name', String(p.name || '')), 'objectOmit');
      const source = rewriteFastAPIStmtExpr(
        requirePortableProp('objectOmit', 'in', extractCodeOrString(p.in).trim()),
        indent,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      lines.push(...source.hoists);
      const keys = emitStringKeyArray(
        parseKeys(
          requirePortableProp('objectOmit', 'keys', extractCodeOrString(p.keys).trim()),
          child,
          'objectOmit keys=',
        ),
      );
      const typeAnnotation = p.type ? `: ${mapTsTypeToPython(String(p.type))}` : '';
      lines.push(
        `${indent}${name}${typeAnnotation} = {key: value for key, value in ${pythonRouteRecordExpr(source.expr)}.items() if key not in ${keys}}`,
      );
      break;
    }
    case 'uniqueBy': {
      const name = toPythonBindingName(requirePortableProp('uniqueBy', 'name', String(p.name || '')), 'uniqueBy');
      const item = String(p.item || 'item');
      const collection = rewriteFastAPIStmtExpr(
        requirePortableProp('uniqueBy', 'in', extractCodeOrString(p.in).trim()),
        indent,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      const by = rewriteFastAPIStmtExpr(
        requirePortableProp('uniqueBy', 'by', extractCodeOrString(p.by).trim()),
        `${indent}    `,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      const typeAnnotation = p.type ? `: ${mapTsTypeToPython(String(p.type))}` : '';
      const seenName = `__kern_seen_${name}`;
      const seenObjectsName = `__kern_seen_objects_${name}`;
      const keyName = `__kern_key_${name}`;
      const seenKeyName = `__kern_seen_key_${name}`;
      const seenObjectName = `__kern_seen_object_${name}`;
      lines.push(...collection.hoists);
      lines.push(`${indent}${name}${typeAnnotation} = []`);
      lines.push(`${indent}${seenName} = set()`);
      lines.push(`${indent}${seenObjectsName} = []`);
      lines.push(`${indent}for ${item} in ${collection.expr}:`);
      lines.push(...by.hoists);
      lines.push(`${indent}    ${keyName} = ${by.expr}`);
      lines.push(`${indent}    if ${keyName} is None:`);
      lines.push(`${indent}        ${seenKeyName} = ("null", None)`);
      lines.push(`${indent}    elif isinstance(${keyName}, bool):`);
      lines.push(`${indent}        ${seenKeyName} = ("boolean", ${keyName})`);
      lines.push(`${indent}    elif isinstance(${keyName}, float) and ${keyName} != ${keyName}:`);
      lines.push(`${indent}        ${seenKeyName} = ("number", "NaN")`);
      lines.push(`${indent}    elif isinstance(${keyName}, (int, float)):`);
      lines.push(`${indent}        ${seenKeyName} = ("number", ${keyName})`);
      lines.push(`${indent}    elif isinstance(${keyName}, str):`);
      lines.push(`${indent}        ${seenKeyName} = ("string", ${keyName})`);
      lines.push(`${indent}    else:`);
      lines.push(`${indent}        for ${seenObjectName} in ${seenObjectsName}:`);
      lines.push(`${indent}            if ${keyName} is ${seenObjectName}:`);
      lines.push(`${indent}                break`);
      lines.push(`${indent}        else:`);
      lines.push(`${indent}            ${seenObjectsName}.append(${keyName})`);
      lines.push(`${indent}            ${name}.append(${item})`);
      lines.push(`${indent}        continue`);
      lines.push(`${indent}    if ${seenKeyName} not in ${seenName}:`);
      lines.push(`${indent}        ${seenName}.add(${seenKeyName})`);
      lines.push(`${indent}        ${name}.append(${item})`);
      break;
    }
    case 'groupBy': {
      const name = toPythonBindingName(requirePortableProp('groupBy', 'name', String(p.name || '')), 'groupBy');
      const item = String(p.item || 'item');
      const collection = rewriteFastAPIStmtExpr(
        requirePortableProp('groupBy', 'in', extractCodeOrString(p.in).trim()),
        indent,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      const by = rewriteFastAPIStmtExpr(
        requirePortableProp('groupBy', 'by', extractCodeOrString(p.by).trim()),
        `${indent}    `,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      const typeAnnotation = p.type ? `: ${mapTsTypeToPython(String(p.type))}` : '';
      const keyName = `__kern_key_${name}`;
      lines.push(...collection.hoists);
      lines.push(`${indent}${name}${typeAnnotation} = {}`);
      lines.push(`${indent}for ${item} in ${collection.expr}:`);
      lines.push(...by.hoists);
      lines.push(`${indent}    ${keyName} = ${by.expr}`);
      pushJsObjectKeyCoercion(lines, `${indent}    `, keyName);
      lines.push(`${indent}    ${name}.setdefault(${keyName}, []).append(${item})`);
      break;
    }
    case 'partition': {
      const passName = toPythonBindingName(requirePortableProp('partition', 'pass', String(p.pass || '')), 'partition');
      const failName = toPythonBindingName(requirePortableProp('partition', 'fail', String(p.fail || '')), 'partition');
      const item = String(p.item || 'item');
      const collection = rewriteFastAPIStmtExpr(
        requirePortableProp('partition', 'in', extractCodeOrString(p.in).trim()),
        indent,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      const where = rewriteFastAPIStmtExpr(
        requirePortableProp('partition', 'where', extractCodeOrString(p.where).trim()),
        `${indent}    `,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      const elemType = p.type ? mapTsTypeToPython(String(p.type)) : undefined;
      const typeAnnotation = elemType ? `: list[${elemType}]` : '';
      lines.push(...collection.hoists);
      lines.push(`${indent}${passName}${typeAnnotation} = []`);
      lines.push(`${indent}${failName}${typeAnnotation} = []`);
      lines.push(`${indent}for ${item} in ${collection.expr}:`);
      lines.push(...where.hoists);
      lines.push(`${indent}    if ${where.expr}:`);
      lines.push(`${indent}        ${passName}.append(${item})`);
      lines.push(`${indent}    else:`);
      lines.push(`${indent}        ${failName}.append(${item})`);
      break;
    }
    case 'indexBy': {
      const name = toPythonBindingName(requirePortableProp('indexBy', 'name', String(p.name || '')), 'indexBy');
      const item = String(p.item || 'item');
      const collection = rewriteFastAPIStmtExpr(
        requirePortableProp('indexBy', 'in', extractCodeOrString(p.in).trim()),
        indent,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      const by = rewriteFastAPIStmtExpr(
        requirePortableProp('indexBy', 'by', extractCodeOrString(p.by).trim()),
        `${indent}    `,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      const typeAnnotation = p.type ? `: ${mapTsTypeToPython(String(p.type))}` : '';
      const keyName = `__kern_key_${name}`;
      lines.push(...collection.hoists);
      lines.push(`${indent}${name}${typeAnnotation} = {}`);
      lines.push(`${indent}for ${item} in ${collection.expr}:`);
      lines.push(...by.hoists);
      lines.push(`${indent}    ${keyName} = ${by.expr}`);
      pushJsObjectKeyCoercion(lines, `${indent}    `, keyName);
      lines.push(`${indent}    ${name}[${keyName}] = ${item}`);
      break;
    }
    case 'countBy': {
      const name = toPythonBindingName(requirePortableProp('countBy', 'name', String(p.name || '')), 'countBy');
      const item = String(p.item || 'item');
      const collection = rewriteFastAPIStmtExpr(
        requirePortableProp('countBy', 'in', extractCodeOrString(p.in).trim()),
        indent,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      const by = rewriteFastAPIStmtExpr(
        requirePortableProp('countBy', 'by', extractCodeOrString(p.by).trim()),
        `${indent}    `,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      const typeAnnotation = p.type ? `: ${mapTsTypeToPython(String(p.type))}` : '';
      const keyName = `__kern_key_${name}`;
      lines.push(...collection.hoists);
      lines.push(`${indent}${name}${typeAnnotation} = {}`);
      lines.push(`${indent}for ${item} in ${collection.expr}:`);
      lines.push(...by.hoists);
      lines.push(`${indent}    ${keyName} = ${by.expr}`);
      pushJsObjectKeyCoercion(lines, `${indent}    `, keyName);
      lines.push(`${indent}    ${name}[${keyName}] = ${name}.get(${keyName}, 0) + 1`);
      break;
    }
    case 'effect': {
      const effectName = toSnakeCase(String(p.name || 'effect'));
      const triggerNode = getFirstChild(child, 'trigger');
      const recoverNode = getFirstChild(child, 'recover');
      const triggerProps = triggerNode ? getProps(triggerNode) : {};
      // Source-of-truth ordering for the trigger expression:
      //   1. `expr={{...}}` — canonical expression form.
      //   2. `query=...` — typically SQL string; flows as expression
      //      (existing test behavior — emits as identifier chain that
      //      happens to ast.parse; runtime is up to the user's `db` var).
      //   3. `url=...` — ALWAYS a URL/path string; wrap as Python string
      //      literal so leading-`/` doesn't become Python division.
      //   4. `call=...` — function-call form, flows as expression.
      //
      // B8 (Codex review on 048ff1c1): I had silently reordered url
      // ahead of query in commit 048ff1c1. Restore the original
      // precedence (expr > query > url > call) so any existing
      // specs that set both `query` and `url` keep their prior
      // semantics, while still quoting `url` when it's selected.
      //
      // B9 (Codex review on 048ff1c1): use presence checks (`!== undefined`)
      // rather than truthiness, so `url=""` falls through correctly
      // instead of being treated as "missing" (truthy fallback).
      const exprCode = extractExprCode(triggerProps.expr);
      const queryCode = extractCodeOrString(triggerProps.query);
      const urlCode = extractCodeOrString(triggerProps.url);
      const callCode = extractCodeOrString(triggerProps.call);
      let triggerExpr: string;
      if (exprCode) {
        triggerExpr = exprCode;
      } else if (queryCode) {
        triggerExpr = queryCode;
      } else if (triggerProps.url !== undefined && triggerProps.url !== null) {
        // `url` is always a URL string — quote it. Empty string still
        // emits `""` (rather than falling through to `call`) because
        // the author explicitly set it.
        triggerExpr = `"${escapePyStr(urlCode)}"`;
      } else if (callCode) {
        triggerExpr = callCode;
      } else {
        triggerExpr = '';
      }
      const retryCount = recoverNode ? parseInt(String(getProps(recoverNode).retry || '0'), 10) : 0;
      const pyFallback = rewriteFastAPIStmtExpr(
        extractCodeOrString(recoverNode ? getProps(recoverNode).fallback : undefined).trim() || 'None',
        indent,
        pathParams,
        bodyFields,
        authUser,
        imports,
        hoistCtx,
      );
      const trigger = triggerExpr
        ? rewriteFastAPIStmtExpr(triggerExpr, indent, pathParams, bodyFields, authUser, imports, hoistCtx)
        : { expr: 'None', hoists: [] };
      lines.push(...pyFallback.hoists, ...trigger.hoists);

      if (retryCount > 0) {
        lines.push(`${indent}${effectName} = ${pyFallback.expr}`);
        lines.push(`${indent}for _attempt in range(${retryCount}):`);
        lines.push(`${indent}    try:`);
        lines.push(`${indent}        ${effectName} = ${trigger.expr}`);
        lines.push(`${indent}        break`);
        lines.push(`${indent}    except Exception:`);
        lines.push(`${indent}        if _attempt == ${retryCount - 1}:`);
        lines.push(`${indent}            ${effectName} = ${pyFallback.expr}`);
      } else {
        lines.push(`${indent}try:`);
        lines.push(`${indent}    ${effectName} = ${trigger.expr}`);
        lines.push(`${indent}except Exception:`);
        lines.push(`${indent}    ${effectName} = ${pyFallback.expr}`);
      }
      break;
    }
    default:
      break;
  }

  return lines;
}

export function generatePortableHandlerFastAPI(
  routeNode: IRNode,
  indent: string,
  pathParams: string[],
  imports: Set<string>,
  bodyFields: Set<string> = new Set(),
  authUser = false,
): string[] {
  const lines: string[] = [];
  const children = routeNode.children || [];

  // Walk all route children in document order
  const PORTABLE_TYPES = new Set([
    'derive',
    'guard',
    'filter',
    'handler',
    'respond',
    'branch',
    'each',
    'collect',
    'count',
    'compact',
    'pluck',
    'take',
    'drop',
    'objectMerge',
    'objectOmit',
    'objectPick',
    'uniqueBy',
    'groupBy',
    'partition',
    'indexBy',
    'countBy',
    'effect',
    'assign',
    'do',
  ]);
  const hoistCtx: FastAPIClosureHoistCtx = { seq: { n: 0 } };
  for (const child of children) {
    if (PORTABLE_TYPES.has(child.type)) {
      lines.push(
        ...generatePortableChildFastAPI(child, indent, pathParams, imports, bodyFields, authUser, undefined, hoistCtx),
      );
    }
  }

  return lines;
}

// Portable SSE body node types (slice 4c) — the route-body subset that composes
// inside a `stream`, plus the streaming primitives `fanout`/`emit`.
const PORTABLE_STREAM_TYPES = new Set([
  'derive',
  'let',
  'each',
  'fanout',
  'emit',
  'do',
  'assign',
  'branch',
  'collect',
  'count',
]);

export function hasPortableStreamBodyFastAPI(streamNode: IRNode): boolean {
  return (streamNode.children || []).some((c) => PORTABLE_STREAM_TYPES.has(c.type));
}

/**
 * Lower a portable `stream` body to the lines that go inside the FastAPI
 * `event_generator()`. `derive`/`let` run at generator scope; `each await`
 * yields directly (disconnect-aware); `fanout` injects the `asyncio.Queue`
 * fan-in. The caller appends the terminal `[DONE]` frame and wraps the result
 * in a `StreamingResponse`.
 */
export function generatePortableStreamFastAPI(
  streamNode: IRNode,
  indent: string,
  pathParams: string[],
  imports: Set<string>,
  bodyFields: Set<string> = new Set(),
  authUser = false,
): string[] {
  const lines: string[] = [];
  // Sequential generator scope: `emit` yields; `each await` still honors the
  // client-disconnect check (the route signature always injects `request`).
  // `fanoutSeq` uniquifies helper names across every fan-out in this generator.
  const ctx: FastAPIStreamCtx = { abortExpr: 'await request.is_disconnected()', fanoutSeq: { n: 0 } };
  const hoistCtx: FastAPIClosureHoistCtx = { seq: { n: 0 } };
  for (const child of streamNode.children || []) {
    if (PORTABLE_STREAM_TYPES.has(child.type)) {
      lines.push(
        ...generatePortableChildFastAPI(child, indent, pathParams, imports, bodyFields, authUser, ctx, hoistCtx),
      );
    }
  }
  return lines;
}
