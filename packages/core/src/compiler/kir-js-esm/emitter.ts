import { sha256 } from '../../kir-runtime/digest.js';
import type { LinkedKernKirHelper, LinkedKernKirProgram } from '../../kir-runtime/linked-kir-program/index.js';
import {
  linkedProgramAsyncHelpers,
  linkedProgramHelpers,
  linkedStatementsInvokeCapability,
} from '../../kir-runtime/linked-kir-program/index.js';
import { dataSource, encodedText, jsString, typeSource } from './request.js';
import { blockSource, type CallLocals, statementsContainTryFamily } from './statement-source.js';
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
  const nextLocal = (prefix = `${local}k`): string => {
    const name = `${prefix}${locals.length.toString(36)}`;
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
  const nextLocal = (prefix = '__k'): string => {
    const local = `${prefix}${(handler.parameters.length + statementLocals.length).toString(36)}`;
    statementLocals.push(local);
    return local;
  };
  const { returnType } = handler;
  const returnSource = (value: string, charged = true): string => {
    if (returnType.kind === 'void') throw new Error('a void handler must not carry a return statement');
    return `${charged ? '\n      __meter.step(); __checkAbort();' : ''}
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
  const hasUserThrow = statementsContainTryFamily(handler.statements);
  const userThrowSource = hasUserThrow
    ? `
  class __UserThrow{constructor(value){this.value=value;}}
  const __throwLabel=(value)=>{const __at=(key)=>value.value.find((entry)=>entry.key===key)?.value;const message=__at('message');const code=__at('code');if(message?.tag!=='text')return '';const label=message.value.slice(0,256);return code?.tag==='text'?label+' ['+code.value.slice(0,64)+']':label;};`
    : '';
  const catchSource = hasUserThrow
    ? `if(error?.constructor===__UserThrow)error=new __Fault('uncaught-throw','execution',__throwLabel(error.value));return __failureEnvelope(__requestId,error,__events);`
    : `return __failureEnvelope(__requestId,error,__events);`;
  return `${userThrowSource}
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
    } catch(error) { ${catchSource} }
  };
`;
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
