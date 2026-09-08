import type { CanonicalValue } from '../../canonical-value/types.js';
import type { VerifiedKernProjection } from '../../frontend-projection/contracts.js';
import { authenticateVerifiedProjection } from '../../frontend-projection/verified-brand.js';
import type { StructuralKirNode } from '../../kir-structural/types.js';
import { KernKirFault, type KernKirLimits } from '../contracts.js';
import { canonicalJson, sha256 } from '../digest.js';
import {
  canonicalRecord,
  denseArray,
  exact,
  nodeChildren,
  nodeProperties,
  plainRecord,
  RuntimeMeter,
} from '../inspect.js';
import {
  KERN_LINKED_KIR_PROGRAM_FORMAT,
  type KernKirLinkCode,
  LINKED_KIR_DEFAULT_CALL_POLICY,
  LINKED_KIR_VOID_RETURN_TYPE,
  type LinkedKernKirCallPolicy,
  type LinkedKernKirCallScope,
  type LinkedKernKirCrossCallType,
  type LinkedKernKirEntry,
  type LinkedKernKirEntryHandler,
  type LinkedKernKirHandler,
  type LinkedKernKirHelper,
  type LinkedKernKirParameterType,
  type LinkedKernKirProgram,
  type LinkedKernKirReturnType,
  type LinkedKernKirStaticType,
  type LinkKernKirProgramResult,
  linkedKirAdmitsScalar,
  linkedKirAdmitsType,
  linkedKirCrossCallType,
} from './contracts.js';
import {
  assertLeaf,
  bindName,
  containsReturn,
  fault,
  type LinkScope,
  type ModuleContext,
  nodeKind,
  propertyBool,
  propertySet,
  propertyText,
} from './link-support.js';
import { compileBlock } from './statements.js';
import {
  createLinkedKirClosureWalk,
  type LinkedKernKirClosureWalk,
  linkedStatementsInvokeCapability,
} from './walkers.js';
export function authenticateLinkedKernKirProjectionOrThrow(projection: VerifiedKernProjection): void {
  if (!authenticateVerifiedProjection(projection)) {
    throw new KernKirFault('projection-authentication-error', 'link', 'projection is not authenticated');
  }
}

function parameterType(
  value: CanonicalValue | undefined,
  label: string,
  meter: RuntimeMeter,
): LinkedKernKirParameterType {
  if (value === undefined) fault('handler-entry-unsupported', `${label}: missing type`);
  const record = plainRecord(value, label);
  exact(record, ['tag', 'value'], label);
  if (record.tag !== 'record') fault('handler-entry-unsupported', `${label}: expected type record`);
  const entries = denseArray(record.value, `${label}.value`);
  if (entries.length === 1) {
    const fields = canonicalRecord(value, ['kind'], label);
    const kind = propertyText(fields, 'kind', label, meter);
    if (linkedKirAdmitsScalar(kind, 'parameter')) return Object.freeze({ kind });
  }
  if (entries.length === 2) {
    const fields = canonicalRecord(value, ['element', 'kind'], label);
    const kind = propertyText(fields, 'kind', label, meter);
    const element = propertyText(fields, 'element', label, meter);
    if (kind === 'list' && linkedKirAdmitsScalar(element, 'parameter')) {
      return Object.freeze({ kind: 'list', element });
    }
  }
  fault('handler-entry-unsupported', `${label}: type is outside RT-1`);
}

function handlerReturnType(
  value: CanonicalValue | undefined,
  label: string,
  meter: RuntimeMeter,
): LinkedKernKirReturnType {
  if (value !== undefined) {
    const record = plainRecord(value, label);
    exact(record, ['tag', 'value'], label);
    if (record.tag === 'record' && denseArray(record.value, `${label}.value`).length === 1) {
      const fields = canonicalRecord(value, ['kind'], label);
      const kind = propertyText(fields, 'kind', label, meter);
      if (linkedKirAdmitsType(kind, 'return') && !linkedKirAdmitsType(kind, 'parameter')) {
        return LINKED_KIR_VOID_RETURN_TYPE;
      }
    }
  }
  return parameterType(value, label, meter);
}

const AMBIGUOUS = 'ambiguous' as const;

function moduleFunctions(context: ModuleContext): ReadonlyMap<string, StructuralKirNode | typeof AMBIGUOUS> {
  if (context.functions !== undefined) return context.functions;
  const functions = new Map<string, StructuralKirNode | typeof AMBIGUOUS>();
  for (let index = 0; index < context.rootNodes.length; index += 1) {
    const node = context.rootNodes[index];
    const label = `entry.module.roots[${index}]`;
    context.meter.step();
    if (nodeKind(node, label) !== 'fn') continue;
    const name = propertyText(nodeProperties(node, label), 'name', label, context.meter);
    functions.set(name, functions.has(name) ? AMBIGUOUS : node);
  }
  context.functions = functions;
  return functions;
}

function resolveHelper(context: ModuleContext, name: string, label: string): LinkedKernKirHandler {
  const linked = context.linked.get(name);
  if (linked !== undefined) return linked;
  if (context.linking.has(name)) fault('handler-entry-unsupported', `${label}: KIR_CALL_RECURSION`);
  const node = moduleFunctions(context).get(name);
  if (node === undefined) fault('handler-entry-unsupported', `${label}: KIR_CALL_CALLEE_UNRESOLVED`);
  if (node === AMBIGUOUS) fault('handler-entry-ambiguous', `${label}: duplicate function ${name}`);
  if (context.linking.size > context.policy.maxCallDepth) {
    fault('handler-entry-unsupported', `${label}: KIR_CALL_DEPTH_EXCEEDED`);
  }
  context.linking.add(name);
  const compiled = compileHandler(node, context, `helper.${name}`, false);
  context.linking.delete(name);
  const { returnType } = compiled;
  if (returnType.kind === 'void') fault('handler-entry-unsupported', `${label}: KIR_VOID_HANDLER_NO_CALL_FORM`);
  const handler: LinkedKernKirHandler = Object.freeze({ ...compiled, returnType });
  context.linked.set(name, handler);
  return handler;
}

// The shared walk memoizes a helper reached through a call, but the helper a classification question
// is asked *about* is its own root, so without this its whole statement tree would be rescanned once
// per call site: quadratic, unmetered link work. The root is cached in the same map under the same
// exact cycle-taint rule, so one scan per helper answers every call site.
function helperIsAsync(context: ModuleContext, name: string): boolean {
  const walk = context.closureWalk;
  const memoized = walk.done.get(name);
  if (memoized !== undefined) return memoized;
  const handler = context.linked.get(name);
  if (handler === undefined) return false;
  if (walk.active.has(name)) {
    walk.cycles += 1;
    return false;
  }
  walk.active.add(name);
  walk.visits += 1;
  const enclosingCycles = walk.cycles;
  const invokes = linkedStatementsInvokeCapability(handler.statements, context.linked, walk);
  walk.active.delete(name);
  if (walk.cycles === enclosingCycles) walk.done.set(name, invokes);
  return invokes;
}

function callScope(context: ModuleContext): LinkedKernKirCallScope {
  return {
    isAsync: (name) => helperIsAsync(context, name),
    linked: context.linked,
    resolve: (name, label) => resolveHelper(context, name, label),
  };
}

function compileHandler(
  fn: StructuralKirNode,
  context: ModuleContext,
  label: string,
  requireExport: boolean,
): LinkedKernKirEntryHandler {
  const { meter } = context;
  const properties = nodeProperties(fn, label);
  propertySet(properties, ['export', 'name', 'returns'], [], label);
  if (requireExport && !propertyBool(properties, 'export', label))
    fault('handler-entry-unsupported', `${label}: function is not exported`);
  const returnType = handlerReturnType(properties.get('returns'), `${label}.returns`, meter);
  const children = nodeChildren(fn, label);
  const parameters: { readonly name: string; readonly type: LinkedKernKirParameterType }[] = [];
  let handler: StructuralKirNode | undefined;
  const scope: LinkScope = {
    assignable: new Set<string>(),
    bindings: new Set<string>(),
    calls: callScope(context),
    counters: new Set<string>(),
    crossCallTypes: new Map<string, LinkedKernKirCrossCallType>(),
    loopDepth: 0,
    types: new Map<string, LinkedKernKirStaticType>(),
  };
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const childLabel = `${label}.children[${index}]`;
    const kind = nodeKind(child, childLabel);
    if (kind === 'param' && handler === undefined) {
      const props = nodeProperties(child, childLabel);
      propertySet(props, ['name', 'type'], [], childLabel);
      assertLeaf(child, childLabel);
      const name = propertyText(props, 'name', childLabel, meter);
      if (scope.bindings.has(name)) fault('handler-entry-unsupported', `${childLabel}: duplicate parameter`);
      const type = parameterType(props.get('type'), `${childLabel}.type`, meter);
      bindName(
        scope,
        name,
        type.kind === 'boolean' || type.kind === 'integer' ? type.kind : undefined,
        linkedKirCrossCallType(type),
      );
      parameters.push(Object.freeze({ name, type }));
      meter.collection(parameters.length, `${label}.parameters`);
    } else if (kind === 'handler' && handler === undefined) handler = child;
    else fault('handler-entry-unsupported', `${childLabel}: expected parameters followed by one handler`);
  }
  if (handler === undefined) fault('handler-entry-unsupported', `${label}: missing handler`);
  const handlerProperties = nodeProperties(handler, `${label}.handler`);
  propertySet(handlerProperties, ['lang'], [], `${label}.handler`);
  if (propertyText(handlerProperties, 'lang', `${label}.handler`, meter) !== 'kern') {
    fault('handler-entry-unsupported', `${label}: handler language is not kern`);
  }
  const statements = compileBlock(nodeChildren(handler, `${label}.handler`), scope, meter, `${label}.handler`);
  if (returnType.kind === 'void') {
    if (containsReturn(statements)) fault('handler-entry-unsupported', `${label}: KIR_VOID_HANDLER_VALUE_RETURN`);
  } else if (
    statements.length === 0 ||
    statements.at(-1)?.kind !== 'return' ||
    statements.filter((item) => item.kind === 'return').length !== 1
  ) {
    fault('handler-entry-unsupported', `${label}: expected exactly one final return`);
  }
  return Object.freeze({ parameters: Object.freeze(parameters), returnType, statements });
}

function selectHandler(
  projection: VerifiedKernProjection,
  entry: LinkedKernKirEntry,
  meter: RuntimeMeter,
  policy: LinkedKernKirCallPolicy,
  walk: LinkedKernKirClosureWalk,
): { readonly helpers: readonly LinkedKernKirHelper[]; readonly program: LinkedKernKirEntryHandler } {
  const projected = plainRecord(projection, 'projection');
  exact(projected, ['status', 'bytes', 'artifact', 'diagnostics', 'receipt'], 'projection');
  const artifact = plainRecord(projected.artifact, 'projection.artifact');
  exact(
    artifact,
    ['constitution', 'diagnostics', 'format', 'modules', 'proofLabel', 'symbolCatalog'],
    'projection.artifact',
  );
  const modules = denseArray(artifact.modules, 'projection.artifact.modules');
  meter.collection(modules.length, 'projection.artifact.modules');
  const matchingModules = modules.filter((candidate, index) => {
    meter.step();
    const module = plainRecord(candidate, `projection.artifact.modules[${index}]`);
    exact(module, ['exports', 'id', 'imports', 'roots'], `projection.artifact.modules[${index}]`);
    return module.id === entry.moduleId;
  });
  if (matchingModules.length === 0) fault('handler-entry-not-found', 'entry module was not found');
  if (matchingModules.length !== 1) fault('handler-entry-ambiguous', 'entry module is ambiguous');
  const module = plainRecord(matchingModules[0], 'entry.module');
  const exports = denseArray(module.exports, 'entry.module.exports');
  meter.collection(exports.length, 'entry.module.exports');
  const exported = exports.filter((candidate, index) => {
    meter.step();
    const item = plainRecord(candidate, `entry.module.exports[${index}]`);
    exact(item, ['kind', 'name', 'source'], `entry.module.exports[${index}]`);
    return item.kind === 'fn' && item.name === entry.handlerName && item.source === null;
  });
  if (exported.length !== 1)
    fault(exported.length === 0 ? 'handler-entry-not-found' : 'handler-entry-ambiguous', 'entry export mismatch');
  const roots = denseArray(module.roots, 'entry.module.roots') as readonly StructuralKirNode[];
  meter.collection(roots.length, 'entry.module.roots');
  const candidates = roots.filter((root, index) => {
    meter.step();
    const label = `entry.module.roots[${index}]`;
    return (
      nodeKind(root, label) === 'fn' &&
      propertyText(nodeProperties(root, label), 'name', label, meter) === entry.handlerName
    );
  });
  if (candidates.length === 0) fault('handler-entry-not-found', 'entry function was not found');
  if (candidates.length !== 1) fault('handler-entry-ambiguous', 'entry function is ambiguous');
  const context: ModuleContext = {
    closureWalk: walk,
    functions: undefined,
    linked: new Map<string, LinkedKernKirHandler>(),
    linking: new Set<string>([entry.handlerName]),
    meter,
    policy,
    rootNodes: roots,
  };
  const program = compileHandler(candidates[0], context, 'entry.function', true);
  // The fixed point async(f) = containsCapability(f) or an async callee is asked of the one shared
  // memoized walk, once, after the whole reachable closure is linked and in name order, so the
  // answer cannot depend on the order the helpers happened to resolve in.
  const helpers = [...context.linked.keys()].sort().map((name) => {
    const handler = context.linked.get(name) as LinkedKernKirHandler;
    return Object.freeze(helperIsAsync(context, name) ? { async: true as const, handler, name } : { handler, name });
  });
  return { helpers: Object.freeze(helpers), program };
}

export function linkVerifiedKernKirProgramOrThrow(
  projection: VerifiedKernProjection,
  entry: LinkedKernKirEntry,
  meter: RuntimeMeter,
  policy: LinkedKernKirCallPolicy = LINKED_KIR_DEFAULT_CALL_POLICY,
  walk: LinkedKernKirClosureWalk = createLinkedKirClosureWalk(),
): LinkedKernKirProgram {
  authenticateLinkedKernKirProjectionOrThrow(projection);
  const { helpers, program } = selectHandler(projection, entry, meter, policy, walk);
  const projectionArtifactSha256 = sha256(projection.bytes);
  const base = Object.freeze({
    format: KERN_LINKED_KIR_PROGRAM_FORMAT,
    entry: Object.freeze({ moduleId: entry.moduleId, handlerName: entry.handlerName }),
    helpers: helpers.length === 0 ? undefined : helpers,
    program,
    projectionArtifactSha256,
  });
  return Object.freeze({ ...base, sha256: sha256(canonicalJson(base)) });
}

export function linkVerifiedKernKirProgram(
  projection: VerifiedKernProjection,
  entry: LinkedKernKirEntry,
  limits: KernKirLimits,
  policy: LinkedKernKirCallPolicy = LINKED_KIR_DEFAULT_CALL_POLICY,
  walk: LinkedKernKirClosureWalk = createLinkedKirClosureWalk(),
): LinkKernKirProgramResult {
  try {
    return Object.freeze({
      outcome: 'success',
      program: linkVerifiedKernKirProgramOrThrow(projection, entry, new RuntimeMeter(limits), policy, walk),
    });
  } catch (error) {
    const code =
      error instanceof KernKirFault &&
      [
        'projection-authentication-error',
        'handler-entry-not-found',
        'handler-entry-ambiguous',
        'handler-entry-unsupported',
        'handler-link-error',
      ].includes(error.code)
        ? (error.code as KernKirLinkCode)
        : 'handler-link-error';
    return Object.freeze({ outcome: 'failure', code });
  }
}
