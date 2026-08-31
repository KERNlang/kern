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
  KERN_LINKED_KIR_PROGRAM_FORMAT,
  type KernKirLinkCode,
  type LinkedKernKirEntry,
  type LinkedKernKirHandler,
  type LinkedKernKirParameterType,
  type LinkedKernKirProgram,
  type LinkedKernKirStatement,
  type LinkedKernKirStaticType,
  type LinkKernKirProgramResult,
} from './contracts.js';
import { compileLinkedExpression, staticExpressionType } from './expression.js';

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
    if (kind === 'boolean' || kind === 'integer' || kind === 'text') return Object.freeze({ kind });
  }
  if (entries.length === 2) {
    const fields = canonicalRecord(value, ['element', 'kind'], label);
    const kind = propertyText(fields, 'kind', label, meter);
    const element = propertyText(fields, 'element', label, meter);
    if (kind === 'list' && (element === 'boolean' || element === 'integer' || element === 'text')) {
      return Object.freeze({ kind: 'list', element });
    }
  }
  fault('handler-entry-unsupported', `${label}: type is outside RT-1`);
}

function assertLeaf(node: StructuralKirNode, label: string): void {
  if (nodeChildren(node, label).length !== 0) fault('handler-entry-unsupported', `${label}: statement must be a leaf`);
}

interface LinkScope {
  readonly bindings: Set<string>;
  readonly types: Map<string, LinkedKernKirStaticType>;
}

function branchScope(scope: LinkScope): LinkScope {
  return { bindings: new Set(scope.bindings), types: new Map(scope.types) };
}

function bindName(scope: LinkScope, name: string, type: LinkedKernKirStaticType | undefined): void {
  scope.bindings.add(name);
  if (type === undefined) scope.types.delete(name);
  else scope.types.set(name, type);
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
    bindName(scope, name, staticExpressionType(compiled.value, scope));
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
    bindName(scope, name, undefined);
    return compiled;
  }
  if (kind === 'print' || kind === 'return') {
    propertySet(properties, ['value'], [], label);
    const value = properties.get('value');
    if (value === undefined) fault('handler-entry-unsupported', `${label}.value`);
    return Object.freeze({ kind, value: compileLinkedExpression(value, scope, meter, `${label}.value`) });
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

function compileHandler(fn: StructuralKirNode, meter: RuntimeMeter, label: string): LinkedKernKirHandler {
  const properties = nodeProperties(fn, label);
  propertySet(properties, ['export', 'name', 'returns'], [], label);
  if (!propertyBool(properties, 'export', label))
    fault('handler-entry-unsupported', `${label}: function is not exported`);
  const returnType = parameterType(properties.get('returns'), `${label}.returns`, meter);
  const children = nodeChildren(fn, label);
  const parameters: { readonly name: string; readonly type: LinkedKernKirParameterType }[] = [];
  let handler: StructuralKirNode | undefined;
  const scope: LinkScope = { bindings: new Set<string>(), types: new Map<string, LinkedKernKirStaticType>() };
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
      bindName(scope, name, type.kind === 'boolean' ? 'boolean' : undefined);
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
  if (
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
): LinkedKernKirHandler {
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
  return compileHandler(candidates[0], meter, 'entry.function');
}

export function linkVerifiedKernKirProgramOrThrow(
  projection: VerifiedKernProjection,
  entry: LinkedKernKirEntry,
  meter: RuntimeMeter,
): LinkedKernKirProgram {
  authenticateLinkedKernKirProjectionOrThrow(projection);
  const program = selectHandler(projection, entry, meter);
  const projectionArtifactSha256 = sha256(projection.bytes);
  const base = Object.freeze({
    format: KERN_LINKED_KIR_PROGRAM_FORMAT,
    entry: Object.freeze({ moduleId: entry.moduleId, handlerName: entry.handlerName }),
    program,
    projectionArtifactSha256,
  });
  return Object.freeze({ ...base, sha256: sha256(canonicalJson(base)) });
}

export function linkVerifiedKernKirProgram(
  projection: VerifiedKernProjection,
  entry: LinkedKernKirEntry,
  limits: KernKirLimits,
): LinkKernKirProgramResult {
  try {
    return Object.freeze({
      outcome: 'success',
      program: linkVerifiedKernKirProgramOrThrow(projection, entry, new RuntimeMeter(limits)),
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
