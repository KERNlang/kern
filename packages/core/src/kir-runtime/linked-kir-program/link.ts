import type { CanonicalValue } from '../../canonical-value/types.js';
import type { VerifiedKernProjection } from '../../frontend-projection/contracts.js';
import { authenticateVerifiedProjection } from '../../frontend-projection/verified-brand.js';
import type { StructuralKirNode } from '../../kir-structural/types.js';
import { type KernKirDiagnosticCode, KernKirFault, type KernKirLimits } from '../contracts.js';
import { canonicalJson, sha256 } from '../digest.js';
import {
  canonicalRecord,
  denseArray,
  exact,
  nodeChildren,
  nodeProperties,
  plainRecord,
  RuntimeMeter,
  requiredText,
} from '../inspect.js';
import {
  createLinkedKirClosureWalk,
  KERN_LINKED_KIR_PROGRAM_FORMAT,
  type KernKirLinkCode,
  LINKED_KIR_DEFAULT_CALL_POLICY,
  LINKED_KIR_VOID_RETURN_TYPE,
  type LinkedKernKirCallPolicy,
  type LinkedKernKirCallScope,
  type LinkedKernKirClosureWalk,
  type LinkedKernKirCrossCallType,
  type LinkedKernKirEntry,
  type LinkedKernKirEntryHandler,
  type LinkedKernKirExpression,
  type LinkedKernKirHandler,
  type LinkedKernKirHelper,
  type LinkedKernKirParameterType,
  type LinkedKernKirProgram,
  type LinkedKernKirReturnType,
  type LinkedKernKirStatement,
  type LinkedKernKirStaticType,
  type LinkKernKirProgramResult,
  linkedKirAdmitsScalar,
  linkedKirAdmitsType,
  linkedKirCrossCallType,
  linkedStatementsInvokeCapability,
} from './contracts.js';
import {
  compileLinkedExpression,
  containsAsyncCall,
  crossCallExpressionType,
  staticExpressionType,
} from './expression.js';

function fault(code: KernKirDiagnosticCode, message: string): never {
  throw new KernKirFault(code, 'link', message);
}

export function authenticateLinkedKernKirProjectionOrThrow(projection: VerifiedKernProjection): void {
  if (!authenticateVerifiedProjection(projection)) {
    throw new KernKirFault('projection-authentication-error', 'link', 'projection is not authenticated');
  }
}

function nodeKind(node: StructuralKirNode, label: string): string {
  const record = plainRecord(node, label);
  exact(record, ['kind', 'properties', 'children'], label);
  if (typeof record.kind !== 'string') fault('handler-entry-unsupported', `${label}.kind`);
  return record.kind;
}

function propertyText(
  properties: ReadonlyMap<string, CanonicalValue>,
  key: string,
  label: string,
  meter: RuntimeMeter,
): string {
  const value = properties.get(key);
  if (value === undefined) fault('handler-entry-unsupported', `${label}.${key}: missing property`);
  const record = plainRecord(value, `${label}.${key}`);
  exact(record, ['tag', 'value'], `${label}.${key}`);
  if (record.tag !== 'text') fault('handler-entry-unsupported', `${label}.${key}: expected text`);
  return requiredText(record.value, `${label}.${key}`, meter);
}

function propertyBool(properties: ReadonlyMap<string, CanonicalValue>, key: string, label: string): boolean {
  const value = properties.get(key);
  if (value === undefined) fault('handler-entry-unsupported', `${label}.${key}: missing property`);
  const record = plainRecord(value, `${label}.${key}`);
  exact(record, ['tag', 'value'], `${label}.${key}`);
  if (record.tag !== 'bool' || typeof record.value !== 'boolean') {
    fault('handler-entry-unsupported', `${label}.${key}: expected boolean`);
  }
  return record.value;
}

function propertySet(
  properties: ReadonlyMap<string, CanonicalValue>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const keys = [...properties.keys()];
  if (
    required.some((key) => !properties.has(key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    fault('handler-entry-unsupported', `${label}: unsupported property set`);
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

function containsReturn(statements: readonly LinkedKernKirStatement[]): boolean {
  return statements.some(
    (statement) =>
      statement.kind === 'return' ||
      (statement.kind === 'if' &&
        (containsReturn(statement.thenBranch) ||
          (statement.elseBranch !== undefined && containsReturn(statement.elseBranch)))),
  );
}

function assertLeaf(node: StructuralKirNode, label: string): void {
  if (nodeChildren(node, label).length !== 0) fault('handler-entry-unsupported', `${label}: statement must be a leaf`);
}

interface LinkScope {
  readonly assignable: Set<string>;
  readonly bindings: Set<string>;
  readonly calls: LinkedKernKirCallScope | undefined;
  readonly crossCallTypes: Map<string, LinkedKernKirCrossCallType>;
  readonly types: Map<string, LinkedKernKirStaticType>;
}

interface ModuleContext {
  readonly closureWalk: ReturnType<typeof createLinkedKirClosureWalk>;
  readonly linked: Map<string, LinkedKernKirHandler>;
  readonly linking: Set<string>;
  readonly meter: RuntimeMeter;
  readonly policy: LinkedKernKirCallPolicy;
  readonly rootNodes: readonly StructuralKirNode[];
  functions: ReadonlyMap<string, StructuralKirNode | 'ambiguous'> | undefined;
}

function branchScope(scope: LinkScope): LinkScope {
  return {
    assignable: new Set(scope.assignable),
    bindings: new Set(scope.bindings),
    calls: scope.calls,
    crossCallTypes: new Map(scope.crossCallTypes),
    types: new Map(scope.types),
  };
}

function bindName(
  scope: LinkScope,
  name: string,
  type: LinkedKernKirStaticType | undefined,
  crossCall: LinkedKernKirCrossCallType | undefined,
): void {
  scope.bindings.add(name);
  if (type === undefined) scope.types.delete(name);
  else scope.types.set(name, type);
  if (crossCall === undefined) scope.crossCallTypes.delete(name);
  else scope.crossCallTypes.set(name, crossCall);
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

// RT-4 rejected a capability anywhere in the reachable callee closure at every call position. RT-5
// narrows that to a callee reached from a position with no statement-value continuation, so the
// retained KIR_CALL_CALLEE_CAPABILITY label still names why the position gate refused.
const ASYNC_POSITION_LABEL = 'KIR_ASYNC_CALL_EXPRESSION_POSITION (KIR_CALL_CALLEE_CAPABILITY)';

function assertAsyncCallPosition(
  value: LinkedKernKirExpression,
  scope: LinkScope,
  label: string,
  statementValue: boolean,
): void {
  const misplaced =
    statementValue && value.kind === 'user-call'
      ? value.arguments.some((argument) => containsAsyncCall(argument, scope))
      : containsAsyncCall(value, scope);
  if (misplaced) fault('handler-entry-unsupported', `${label}: ${ASYNC_POSITION_LABEL}`);
}

function assignTargetName(value: CanonicalValue | undefined, label: string, meter: RuntimeMeter): string {
  if (value === undefined) fault('handler-entry-unsupported', `${label}: missing target`);
  const target = canonicalRecord(value, ['fields', 'kind'], label);
  if (propertyText(target, 'kind', label, meter) !== 'identifier') {
    fault('handler-entry-unsupported', `${label}: KIR_ASSIGN_TARGET_NOT_IDENTIFIER`);
  }
  const fields = target.get('fields');
  if (fields === undefined) fault('handler-entry-unsupported', `${label}.fields: missing record`);
  const named = canonicalRecord(fields, ['name'], `${label}.fields`);
  return propertyText(named, 'name', `${label}.fields`, meter);
}

function compileStatement(
  node: StructuralKirNode,
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
): LinkedKernKirStatement {
  meter.step();
  const kind = nodeKind(node, label);
  const properties = nodeProperties(node, label);
  assertLeaf(node, label);
  if (kind === 'let') {
    propertySet(properties, ['name', 'value'], [], label);
    const name = propertyText(properties, 'name', label, meter);
    if (scope.bindings.has(name)) fault('handler-entry-unsupported', `${label}: duplicate binding ${name}`);
    const value = properties.get('value');
    if (value === undefined) fault('handler-entry-unsupported', `${label}.value`);
    const compiled = Object.freeze({
      kind: 'let' as const,
      name,
      value: compileLinkedExpression(value, scope, meter, `${label}.value`),
    });
    assertAsyncCallPosition(compiled.value, scope, `${label}.value`, true);
    bindName(scope, name, staticExpressionType(compiled.value, scope), crossCallExpressionType(compiled.value, scope));
    scope.assignable.add(name);
    return compiled;
  }
  if (kind === 'capability') {
    propertySet(properties, ['name', 'namespace', 'operation'], ['input'], label);
    const name = propertyText(properties, 'name', label, meter);
    if (scope.bindings.has(name)) fault('handler-entry-unsupported', `${label}: duplicate binding ${name}`);
    const input = properties.get('input');
    const compiled = Object.freeze({
      kind: 'capability' as const,
      name,
      namespace: propertyText(properties, 'namespace', label, meter),
      operation: propertyText(properties, 'operation', label, meter),
      input: input === undefined ? undefined : compileLinkedExpression(input, scope, meter, `${label}.input`),
    });
    if (compiled.input !== undefined) assertAsyncCallPosition(compiled.input, scope, `${label}.input`, false);
    bindName(scope, name, undefined, undefined);
    scope.assignable.add(name);
    return compiled;
  }
  if (kind === 'assign') {
    propertySet(properties, ['target', 'value'], ['op'], label);
    if (properties.has('op')) fault('handler-entry-unsupported', `${label}: KIR_ASSIGN_OP_UNSUPPORTED`);
    const target = assignTargetName(properties.get('target'), `${label}.target`, meter);
    if (!scope.bindings.has(target)) fault('handler-entry-unsupported', `${label}: KIR_ASSIGN_UNDECLARED ${target}`);
    if (!scope.assignable.has(target)) {
      fault('handler-entry-unsupported', `${label}: KIR_ASSIGN_TARGET_NOT_LET ${target}`);
    }
    const value = properties.get('value');
    if (value === undefined) fault('handler-entry-unsupported', `${label}.value`);
    const compiled = Object.freeze({
      kind: 'assign' as const,
      target,
      value: compileLinkedExpression(value, scope, meter, `${label}.value`),
    });
    assertAsyncCallPosition(compiled.value, scope, `${label}.value`, true);
    // An assign never rebinds a link-time type record, so every downstream gate that read the
    // binding's recorded type stays valid without re-deriving it.
    if (
      staticExpressionType(compiled.value, scope) !== scope.types.get(target) ||
      crossCallExpressionType(compiled.value, scope) !== scope.crossCallTypes.get(target)
    ) {
      fault('handler-entry-unsupported', `${label}: KIR_ASSIGN_TYPE_MISMATCH ${target}`);
    }
    return compiled;
  }
  if (kind === 'print' || kind === 'return') {
    propertySet(properties, ['value'], [], label);
    const value = properties.get('value');
    if (value === undefined) fault('handler-entry-unsupported', `${label}.value`);
    const compiled = Object.freeze({ kind, value: compileLinkedExpression(value, scope, meter, `${label}.value`) });
    assertAsyncCallPosition(compiled.value, scope, `${label}.value`, true);
    return compiled;
  }
  fault('handler-entry-unsupported', `${label}: statement kind ${kind} is outside RT-1`);
}

function compileBranch(
  node: StructuralKirNode,
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
): readonly LinkedKernKirStatement[] {
  const children = nodeChildren(node, label);
  if (children.length === 0) fault('handler-entry-unsupported', `${label}: branch block is empty`);
  return compileBlock(children, branchScope(scope), meter, label);
}

function compileIf(
  node: StructuralKirNode,
  elseNode: StructuralKirNode | undefined,
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
): LinkedKernKirStatement {
  meter.step();
  const properties = nodeProperties(node, label);
  propertySet(properties, ['cond'], [], label);
  const cond = properties.get('cond');
  if (cond === undefined) fault('handler-entry-unsupported', `${label}.cond`);
  const condition = compileLinkedExpression(cond, scope, meter, `${label}.cond`);
  assertAsyncCallPosition(condition, scope, `${label}.cond`, false);
  if (staticExpressionType(condition, scope) !== 'boolean') {
    fault('handler-entry-unsupported', `${label}.cond: KIR_IF_COND_NOT_BOOLEAN`);
  }
  const thenBranch = compileBranch(node, scope, meter, `${label}.then`);
  let elseBranch: readonly LinkedKernKirStatement[] | undefined;
  if (elseNode !== undefined) {
    const elseLabel = `${label}.else`;
    propertySet(nodeProperties(elseNode, elseLabel), [], [], elseLabel);
    elseBranch = compileBranch(elseNode, scope, meter, elseLabel);
  }
  return Object.freeze({ kind: 'if' as const, condition, thenBranch, elseBranch });
}

function compileBlock(
  nodes: readonly StructuralKirNode[],
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
): readonly LinkedKernKirStatement[] {
  const statements: LinkedKernKirStatement[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const childLabel = `${label}.children[${index}]`;
    const node = nodes[index];
    if (nodeKind(node, childLabel) !== 'if') {
      statements.push(compileStatement(node, scope, meter, childLabel));
      continue;
    }
    const next = nodes[index + 1];
    const paired = next !== undefined && nodeKind(next, `${label}.children[${index + 1}]`) === 'else';
    statements.push(compileIf(node, paired ? next : undefined, scope, meter, childLabel));
    if (paired) index += 1;
  }
  meter.collection(statements.length, label);
  return Object.freeze(statements);
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
    crossCallTypes: new Map<string, LinkedKernKirCrossCallType>(),
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
