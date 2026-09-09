import { statementSubBlocks } from '../../kir-runtime/linked-kir-program/contracts.js';
import type { LinkedKernKirExpression, LinkedKernKirStatement } from '../../kir-runtime/linked-kir-program/index.js';
import { LINKED_KIR_BINARY_OPERATORS, LINKED_KIR_UNARY_OPERATORS } from '../../kir-runtime/linked-kir-program/index.js';
import { encodedText, jsString, valueSource } from './request.js';

export interface CallLocals {
  readonly async: ReadonlySet<string>;
  readonly locals: ReadonlyMap<string, string>;
}

export function statementsContainTryFamily(statements: readonly LinkedKernKirStatement[]): boolean {
  return statements.some(
    (statement) =>
      statement.kind === 'throw' ||
      statement.kind === 'try' ||
      statementSubBlocks(statement).some(statementsContainTryFamily),
  );
}

function expressionSource(
  expression: LinkedKernKirExpression,
  bindings: ReadonlyMap<string, string>,
  calls: CallLocals,
): string {
  let source: string;
  switch (expression.kind) {
    case 'literal':
      source = valueSource(expression.value);
      break;
    case 'identifier': {
      const binding = bindings.get(expression.name);
      if (binding === undefined) throw new Error('linked expression references a missing binding');
      source = binding;
      break;
    }
    case 'list':
      source = `Object.freeze({tag:'list',value:Object.freeze([${expression.items
        .map((item) => expressionSource(item, bindings, calls))
        .join(',')}])})`;
      break;
    case 'record':
      source = `Object.freeze({tag:'record',value:Object.freeze([${expression.entries
        .map(
          (entry) =>
            `Object.freeze({key:${jsString(entry.key)},value:${expressionSource(entry.value, bindings, calls)}})`,
        )
        .join(',')}])})`;
      break;
    case 'user-call': {
      const helper = calls.locals.get(expression.handlerName);
      if (helper === undefined) throw new Error('linked expression references a missing helper');
      if (calls.async.has(expression.handlerName)) {
        throw new Error('an async helper is only callable as the whole value of a statement');
      }
      source = `${helper}(${expression.arguments.map((argument) => expressionSource(argument, bindings, calls)).join(',')})`;
      break;
    }
    case 'binary': {
      const operator = LINKED_KIR_BINARY_OPERATORS[expression.op];
      const left = expressionSource(expression.left, bindings, calls);
      const right = expressionSource(expression.right, bindings, calls);
      source =
        operator.family === 'logical'
          ? `${operator.javascriptHelper}(${left},()=>${right})`
          : operator.family === 'arithmetic'
            ? `${operator.javascriptHelper}(${left},${right},__meter)`
            : `${operator.javascriptHelper}(${left},${right})`;
      break;
    }
    case 'unary':
      source = `${LINKED_KIR_UNARY_OPERATORS[expression.op].javascriptHelper}(${expressionSource(expression.argument, bindings, calls)},__meter)`;
      break;
    case 'member':
      source = `__member(${expressionSource(expression.object, bindings, calls)},${String(expression.optional)},${encodedText(expression.property)})`;
      break;
    case 'json-call': {
      const argument = expressionSource(expression.argument, bindings, calls);
      source =
        expression.operation === 'parse'
          ? `((__value)=>{if(__value.tag!=='text')throw new __Fault('unsupported-runtime-input','execution');return __parseKernText(__value.value,__meter);})(${argument})`
          : `((__value)=>Object.freeze({tag:'text',value:__stringifyKernValue(__value,__meter)}))(${argument})`;
      break;
    }
  }
  return `(__meter.step(),${source})`;
}

// Python cannot put an await inside the lambda every expression node is wrapped in, so both targets
// lower an async call at the statement boundary instead. The call node's own meter step is emitted
// here, keeping the order - call node, then arguments left to right, then dispatch - identical to
// the synchronous lowering.
function statementValueSource(
  expression: LinkedKernKirExpression,
  bindings: ReadonlyMap<string, string>,
  calls: CallLocals,
): string {
  if (expression.kind !== 'user-call' || !calls.async.has(expression.handlerName)) {
    return expressionSource(expression, bindings, calls);
  }
  const helper = calls.locals.get(expression.handlerName);
  if (helper === undefined) throw new Error('linked expression references a missing helper');
  const args = expression.arguments.map((argument) => expressionSource(argument, bindings, calls)).join(',');
  return `(__meter.step(),await ${helper}(${args}))`;
}

function capabilitySource(
  statement: Extract<LinkedKernKirStatement, { kind: 'capability' }>,
  local: string,
  bindings: Map<string, string>,
  calls: CallLocals,
): string {
  const input =
    statement.input === undefined
      ? `Object.freeze({presence:'absent'})`
      : `Object.freeze({presence:'value',value:${expressionSource(statement.input, bindings, calls)}})`;
  const namespace = encodedText(statement.namespace);
  const operation = encodedText(statement.operation);
  bindings.set(statement.name, local);
  return `
      __meter.step(); __checkAbort();
      const __input${local.slice(3)}=${input};
      if(__events.length+1>__request.limits.maxEvents)throw new __Fault('runtime-limit-exceeded','execution');
      let __raw${local.slice(3)};
      try {
        __raw${local.slice(3)}=await __invokeCapability(__options.invoke,{namespace:${namespace},operation:${operation},input:__input${local.slice(3)},signal:__controller.signal},()=>new __Fault(__reason==='timeout'?'execution-timeout':'execution-cancelled','execution'));
      } catch(error) {
        if(error instanceof __Fault)throw error;
        throw new __Fault('capability-error','execution');
      }
      __checkAbort();
      let __slot${local.slice(3)};
      try { __slot${local.slice(3)}=__inspectSlot(__raw${local.slice(3)},__meter); }
      catch(error) {
        if(error instanceof __Fault&&error.code==='runtime-limit-exceeded')throw error;
        throw new __Fault('invalid-handler-result','execution');
      }
      if(__slot${local.slice(3)}.presence!=='value')throw new __Fault('invalid-handler-result','execution');
      __events.push(Object.freeze({input:__input${local.slice(3)},namespace:${namespace},op:'capability',operation:${operation},result:__slot${local.slice(3)}}));
      ${local}=__slot${local.slice(3)}.value;`;
}

function assignSource(
  statement: Extract<LinkedKernKirStatement, { kind: 'assign' }>,
  bindings: ReadonlyMap<string, string>,
  calls: CallLocals,
): string {
  const local = bindings.get(statement.target);
  if (local === undefined) throw new Error('a linked assign target must already own a host local');
  return `
      __meter.step(); __checkAbort();
      ${local}=${statementValueSource(statement.value, bindings, calls)};`;
}

function leafSource(
  statement: LinkedKernKirStatement,
  local: string,
  bindings: Map<string, string>,
  calls: CallLocals,
): string {
  if (statement.kind === 'capability') return capabilitySource(statement, local, bindings, calls);
  if (statement.kind === 'let') {
    const value = statementValueSource(statement.value, bindings, calls);
    bindings.set(statement.name, local);
    return `
      __meter.step(); __checkAbort();
      ${local}=${value};`;
  }
  if (statement.kind === 'print') {
    const value = statementValueSource(statement.value, bindings, calls);
    return `
      __meter.step(); __checkAbort();
      {const __printed=${value};
      if(__printed.tag!=='text')throw new __Fault('unsupported-runtime-input','execution');
      if(__events.length+1>__request.limits.maxEvents)throw new __Fault('runtime-limit-exceeded','execution');
      __events.push(Object.freeze({op:'stdout',text:__printed.value}));}`;
  }
  throw new Error('return statements are emitted by the specialized handler');
}

// Every bound is read once, above the head, so the trip count is fixed before the first test. The
// head is the one new checkpoint site this slice adds: a loop's statement count is not bounded by
// the program text, so without it a long loop would be uninterruptible for its whole run.
function forSource(
  statement: Extract<LinkedKernKirStatement, { kind: 'for' }>,
  scope: Map<string, string>,
  calls: CallLocals,
  nextLocal: (prefix?: string) => string,
  returnSource: (value: string, charged?: boolean) => string,
): string {
  const cursor = nextLocal();
  const bound = nextLocal();
  const stride = nextLocal();
  const counter = nextLocal();
  const from = expressionSource(statement.from, scope, calls);
  const to = expressionSource(statement.to, scope, calls);
  const step = expressionSource(statement.step, scope, calls);
  const body = new Map(scope);
  body.set(statement.counter, counter);
  return `
      __meter.step();
      ${cursor}=__intOperand(${from});
      ${bound}=__intOperand(${to});
      ${stride}=__intOperand(${step});
      if(${stride}===0n)throw new __Fault('unsupported-runtime-input','execution','ERR_KIR_LOOP_ZERO_STEP');
      for(;${stride}>0n?${cursor}<${bound}:${cursor}>${bound};${cursor}+=${stride}){
      __meter.step(); __checkAbort();
      ${counter}=__intValue(${cursor},__meter);${blockSource(statement.body, body, calls, nextLocal, returnSource)}
      }
      __meter.step();`;
}

function whileSource(
  statement: Extract<LinkedKernKirStatement, { kind: 'while' }>,
  scope: Map<string, string>,
  calls: CallLocals,
  nextLocal: (prefix?: string) => string,
  returnSource: (value: string, charged?: boolean) => string,
): string {
  const local = nextLocal();
  const condition = expressionSource(statement.condition, scope, calls);
  const body = blockSource(statement.body, new Map(scope), calls, nextLocal, returnSource);
  return `
      __meter.step();
      while(true){
      ${local}=${condition};
      if(${local}.tag!=='boolean')throw new __Fault('unsupported-runtime-input','execution');
      if(${local}.value!==true)break;
      __meter.step(); __checkAbort();${body}
      }
      __meter.step();`;
}

export function blockSource(
  statements: readonly LinkedKernKirStatement[],
  scope: Map<string, string>,
  calls: CallLocals,
  nextLocal: (prefix?: string) => string,
  returnSource: (value: string, charged?: boolean) => string,
): string {
  return statements
    .map((statement) => {
      if (statement.kind === 'return') return returnSource(statementValueSource(statement.value, scope, calls));
      if (statement.kind === 'throw') {
        return `\n      __meter.step(); __checkAbort();\n      throw new __UserThrow(${statementValueSource(statement.value, scope, calls)});`;
      }
      if (statement.kind === 'assign') return assignSource(statement, scope, calls);
      if (statement.kind === 'for') return forSource(statement, scope, calls, nextLocal, returnSource);
      if (statement.kind === 'while') return whileSource(statement, scope, calls, nextLocal, returnSource);
      if (statement.kind === 'try') {
        const cleanup = statement.finallyBody;
        const catchScope = new Map(scope);
        const catchLocal = nextLocal();
        if (statement.binding !== undefined) catchScope.set(statement.binding, catchLocal);
        const [faultFlag, slot, held] =
          cleanup === undefined ? ['', '', ''] : [nextLocal('__ef'), nextLocal('__r'), nextLocal('__h')];
        const exit = `__t${held.slice(3)}`;
        // A return crossing a finally must not build the success envelope before the cleanup runs:
        // the envelope freezes the event array and charges maxBytes, so a finally that commits an
        // event would throw on the frozen array and escape the byte limit. The return breaks a
        // labeled block, the native finally runs on the way out, and the real return follows it.
        // It is charged exactly once however many finallys it crosses: only the return SITE charges,
        // and each tail hands the value outward uncharged, through the next `defer` out.
        let deferred = false;
        const defer = (value: string, charged = true): string => {
          deferred = true;
          const boundary = charged ? '\n      __meter.step(); __checkAbort();' : '';
          return `${boundary}\n      {${slot}=${value}; ${held}=true; break ${exit};}`;
        };
        const bodyReturn = cleanup === undefined ? returnSource : defer;
        const body = blockSource(statement.body, new Map(scope), calls, nextLocal, bodyReturn);
        const catchBody = blockSource(statement.catchBody, catchScope, calls, nextLocal, bodyReturn);
        const caught =
          statement.catchBody.length === 0
            ? `${body}`
            : `try {${body}
      } catch(__e) { if(!(__e instanceof __UserThrow))throw __e;
      __meter.step(); __checkAbort();${statement.binding === undefined ? '' : `${catchLocal}=__e.value;`}${catchBody}}`;
        if (cleanup === undefined) {
          return `\n      __meter.step(); __checkAbort(); __meter.step(); __checkAbort();${caught}`;
        }
        const finallyBody = blockSource(cleanup, new Map(scope), calls, nextLocal, returnSource);
        const tail = deferred ? `\n      if(${held}){${returnSource(slot, false)}}` : '';
        return `\n      __meter.step(); __checkAbort(); ${faultFlag}=false; ${held}=false;
      ${exit}: { try { try { __meter.step(); __checkAbort();${caught} }
      catch(__e2){if(__e2?.constructor!==__UserThrow)${faultFlag}=true;throw __e2;}
      } finally {if(!${faultFlag}){__meter.step(); __checkAbort();${finallyBody}}} }${tail}`;
      }
      if (statement.kind === 'break' || statement.kind === 'continue') {
        return `\n      __meter.step(); __checkAbort();\n      ${statement.kind};`;
      }
      if (statement.kind !== 'if') return leafSource(statement, nextLocal(), scope, calls);
      const local = nextLocal();
      const condition = expressionSource(statement.condition, scope, calls);
      const thenSource = blockSource(statement.thenBranch, new Map(scope), calls, nextLocal, returnSource);
      const elseSource =
        statement.elseBranch === undefined
          ? undefined
          : blockSource(statement.elseBranch, new Map(scope), calls, nextLocal, returnSource);
      return `
      __meter.step(); __checkAbort();
      ${local}=${condition};
      if(${local}.tag!=='boolean')throw new __Fault('unsupported-runtime-input','execution');
      if(${local}.value===true){${thenSource}
      }${
        elseSource === undefined
          ? ''
          : `else{${elseSource}
      }`
      }`;
    })
    .join('');
}
