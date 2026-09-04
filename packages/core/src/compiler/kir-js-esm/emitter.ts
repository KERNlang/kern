import type { KernKirValue } from '../../kir-runtime/contracts.js';
import { canonicalJson, sha256 } from '../../kir-runtime/digest.js';
import type {
  LinkedKernKirExpression,
  LinkedKernKirHelper,
  LinkedKernKirParameterType,
  LinkedKernKirProgram,
  LinkedKernKirStatement,
} from '../../kir-runtime/linked-kir-program/index.js';
import {
  LINKED_KIR_BINARY_OPERATORS,
  LINKED_KIR_UNARY_OPERATORS,
  linkedProgramAsyncHelpers,
  linkedProgramHelpers,
  linkedStatementsInvokeCapability,
} from '../../kir-runtime/linked-kir-program/index.js';
import { TARGET_BASE_SOURCE } from './target-base.js';
import { TARGET_EXECUTION_SOURCE } from './target-execution.js';
import { TARGET_HASH_SOURCE } from './target-hash.js';
import { TARGET_JSON_SOURCE } from './target-json.js';

const encoder = new TextEncoder();
const KERNEL_SOURCE = `${TARGET_BASE_SOURCE}${TARGET_JSON_SOURCE}${TARGET_HASH_SOURCE}${TARGET_EXECUTION_SOURCE}`;

export const TARGET_KERNEL_SHA256 = sha256(KERNEL_SOURCE);

export interface TargetManifestBase {
  readonly artifactFormat: string;
  readonly canonicalization: string;
  readonly compilerFormat: string;
  readonly compilerRequestSha256: string;
  readonly entry: { readonly moduleId: string; readonly handlerName: string };
  readonly hashAlgorithm: string;
  readonly hostProfile: string;
  readonly kernelSha256: string;
  readonly linkedProgramSha256: string;
  readonly projectionArtifactSha256: string;
  readonly runtimeFormat: string;
}

function jsString(value: string): string {
  return canonicalJson(value);
}

function encodedText(value: string): string {
  return `__chars([${Array.from(value, (character) => character.codePointAt(0) as number).join(',')}])`;
}

function valueSource(value: KernKirValue): string {
  switch (value.tag) {
    case 'null':
      return `Object.freeze({tag:'null'})`;
    case 'boolean':
      return `Object.freeze({tag:'boolean',value:${String(value.value)}})`;
    case 'text':
    case 'integer':
    case 'decimal':
      return `Object.freeze({tag:${jsString(value.tag)},value:${jsString(value.value)}})`;
    case 'list':
      return `Object.freeze({tag:'list',value:Object.freeze([${value.value.map(valueSource).join(',')}])})`;
    case 'record':
      return `Object.freeze({tag:'record',value:Object.freeze([${value.value
        .map((entry) => `Object.freeze({key:${jsString(entry.key)},value:${valueSource(entry.value)}})`)
        .join(',')}])})`;
  }
}

interface CallLocals {
  readonly async: ReadonlySet<string>;
  readonly locals: ReadonlyMap<string, string>;
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

function typeSource(type: LinkedKernKirParameterType): string {
  return type.kind === 'list'
    ? `Object.freeze({kind:'list',element:${jsString(type.element)}})`
    : `Object.freeze({kind:${jsString(type.kind)}})`;
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
  nextLocal: () => string,
  returnSource: (value: string) => string,
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

function blockSource(
  statements: readonly LinkedKernKirStatement[],
  scope: Map<string, string>,
  calls: CallLocals,
  nextLocal: () => string,
  returnSource: (value: string) => string,
): string {
  return statements
    .map((statement) => {
      if (statement.kind === 'return') return returnSource(statementValueSource(statement.value, scope, calls));
      if (statement.kind === 'assign') return assignSource(statement, scope, calls);
      if (statement.kind === 'for') return forSource(statement, scope, calls, nextLocal, returnSource);
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

function helperSource(helper: LinkedKernKirHelper, local: string, calls: CallLocals): string {
  const isAsync = helper.async === true;
  if (!isAsync && linkedStatementsInvokeCapability(helper.handler.statements)) {
    throw new Error('a linked helper must not invoke a capability: the emitted helper is synchronous');
  }
  const { returnType } = helper.handler;
  const scope = new Map<string, string>();
  const parameters = helper.handler.parameters.map((parameter, index) => {
    const name = `${local}p${index.toString(36)}`;
    scope.set(parameter.name, name);
    return name;
  });
  const guards = helper.handler.parameters.map(
    (parameter, index) =>
      `if(!__matches(${parameters[index]},${typeSource(parameter.type)}))throw new __Fault('unsupported-runtime-input','execution');`,
  );
  const locals: string[] = [];
  const nextLocal = (): string => {
    const name = `${local}k${locals.length.toString(36)}`;
    locals.push(name);
    return name;
  };
  const returnSource = (value: string): string => `
      __checkAbort();
      {const ${local}r=${value};
      if(!__matches(${local}r,${typeSource(returnType)}))throw new __Fault('unsupported-runtime-input','execution');
      return ${local}r;}`;
  const body = blockSource(helper.handler.statements, scope, calls, nextLocal, returnSource);
  const declarations = locals.length === 0 ? '' : `let ${locals.join(',')};`;
  return `const ${local}=${isAsync ? 'async' : ''}(${parameters.join(',')})=>{
      __meter.step();
      ${guards.join('')}${declarations}${body}
      throw new __Fault('handler-entry-unsupported','execution');
    };
    `;
}

function specializedSource(linked: LinkedKernKirProgram): string {
  const { entry, helpers } = linked;
  const handler = linked.program;
  const calls: CallLocals = {
    async: linkedProgramAsyncHelpers(helpers),
    locals: new Map<string, string>((helpers ?? []).map((helper, index) => [helper.name, `__f${index.toString(36)}`])),
  };
  const helperSources = (helpers ?? []).map((helper, index) => helperSource(helper, `__f${index.toString(36)}`, calls));
  const bindings = new Map<string, string>();
  const argumentNames = handler.parameters.map((parameter) => encodedText(parameter.name));
  const parameterLines = handler.parameters.map((parameter, index) => {
    const local = `__k${index.toString(36)}`;
    bindings.set(parameter.name, local);
    return `const ${local}=__request.arguments[__argumentNames[${index}]];if(${local}===undefined||!__matches(${local},${typeSource(parameter.type)}))throw new __Fault('invalid-handler-arguments','link');`;
  });
  const statementLocals: string[] = [];
  const nextLocal = (): string => {
    const local = `__k${(handler.parameters.length + statementLocals.length).toString(36)}`;
    statementLocals.push(local);
    return local;
  };
  const { returnType } = handler;
  const returnSource = (value: string): string => {
    if (returnType.kind === 'void') throw new Error('a void handler must not carry a return statement');
    return `
      __meter.step(); __checkAbort();
      {const __returned=${value};
      if(!__matches(__returned,${typeSource(returnType)}))throw new __Fault('invalid-handler-result','execution');
      const __result=Object.freeze({presence:'value',value:__returned});
      __checkAbort();
      if(__successBytes(__request.requestId,__events,__result,__checkAbort)>__request.limits.maxBytes)throw new __Fault('runtime-limit-exceeded','execution');
      __checkAbort();
      return Object.freeze({completion:Object.freeze({kind:'return'}),diagnostics:Object.freeze([]),events:Object.freeze(__events),format:__runtimeFormat,outcome:'success',requestId:__request.requestId,result:__result});}`;
  };
  const tail =
    returnType.kind === 'void'
      ? `__checkAbort();
      {const __result=Object.freeze({presence:'absent'});
      if(__successBytes(__request.requestId,__events,__result,__checkAbort)>__request.limits.maxBytes)throw new __Fault('runtime-limit-exceeded','execution');
      __checkAbort();
      return Object.freeze({completion:Object.freeze({kind:'return'}),diagnostics:Object.freeze([]),events:Object.freeze(__events),format:__runtimeFormat,outcome:'success',requestId:__request.requestId,result:__result});}`
      : `throw new __Fault('handler-entry-unsupported','execution');`;
  const body = blockSource(handler.statements, bindings, calls, nextLocal, returnSource);
  const declarations = statementLocals.length === 0 ? '' : `let ${statementLocals.join(',')};`;
  const hasCapability = linkedStatementsInvokeCapability(handler.statements, linkedProgramHelpers(helpers));
  return `
  const __runSpecialized=async(__request,__options,__meter,__deadline,__events)=>{
    const __argumentNames=Object.freeze([${argumentNames.join(',')}]);
    const __actual=Object.keys(__request.arguments).sort();
    const __expected=[...__argumentNames].sort();
    if(__actual.length!==__expected.length||__actual.some((name,index)=>name!==__expected[index]))throw new __Fault('invalid-handler-arguments','link');
    ${parameterLines.join('\n    ')}
    ${declarations}
    if(${String(hasCapability)}&&__options.invoke===undefined)throw new __Fault('capability-error','execution');
    if(__request.control.preCancelled||(__options.signal&&__options.signal.aborted))throw new __Fault('execution-cancelled','execution');
    const __controller=new AbortController();
    let __reason;
    const __cancel=()=>{__reason='cancelled';__controller.abort();};
    if(__options.signal)__options.signal.addEventListener('abort',__cancel,{once:true});
    const __remaining=__deadline.remainingMs();
    const __timer=__remaining===null?undefined:setTimeout(()=>{__reason='timeout';__controller.abort();},__remaining);
    const __checkAbort=()=>{__deadline.check();if(__controller.signal.aborted)throw new __Fault(__reason==='timeout'?'execution-timeout':'execution-cancelled','execution');};
    ${helperSources.join('')}try {${body}
      ${tail}
    } finally {
      if(__timer!==undefined)clearTimeout(__timer);
      if(__options.signal)__options.signal.removeEventListener('abort',__cancel);
    }
  };
  const execute=async(input,executionOptions)=>{
    const __deadline=__createDeadline(input);
    const __requestId=__requestIdFrom(input);
    const __events=[];
    try {
      __deadline.check();
      const {request:__request,meter:__meter}=__inspectRequest(input,__deadline.check);
      const __options=__inspectOptions(executionOptions);
      if(__request.entry.moduleId!==${encodedText(entry.moduleId)}||__request.entry.handlerName!==${encodedText(entry.handlerName)})throw new __Fault('handler-entry-not-found','link');
      __deadline.check();
      return await __runSpecialized(__request,__options,__meter,__deadline,__events);
    } catch(error) { return __failureEnvelope(__requestId,error,__events); }
  };
`;
}

function dataSource(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return jsString(value);
  if (Array.isArray(value)) return `[${value.map(dataSource).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${jsString(key)}:${dataSource(record[key])}`)
    .join(',')}}`;
}

const MODULE_SUFFIX = `
const __exports=__module();
export const format=__exports.format;
export const manifest=__exports.manifest;
export const execute=__exports.execute;
`;

export function emitJavaScriptEsm(program: LinkedKernKirProgram, manifestBase: TargetManifestBase): Uint8Array {
  const manifestWithoutArtifact = dataSource(manifestBase);
  const source = `function __module() {${KERNEL_SOURCE}${specializedSource(program)}
  const __suffix=${jsString(MODULE_SUFFIX)};
  const __artifactSha256=__sha256(new TextEncoder().encode(__module.toString()+__suffix));
  const __base=${manifestWithoutArtifact};
  const manifest=Object.freeze({artifact:Object.freeze({path:'entry.mjs',sha256:__artifactSha256}),...__base});
  return Object.freeze({format:__runtimeFormat,manifest,execute});
}${MODULE_SUFFIX}`;
  return encoder.encode(source);
}
