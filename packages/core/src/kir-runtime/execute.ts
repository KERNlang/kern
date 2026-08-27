import type { CanonicalValue } from '../canonical-value/types.js';
import type { VerifiedKernProjection } from '../frontend-projection/contracts.js';
import { authenticateVerifiedProjection } from '../frontend-projection/verified-brand.js';
import type { StructuralKirNode } from '../kir-structural/types.js';
import { invokeCapability } from './capability.js';
import {
  KERN_KIR_RUNTIME_FORMAT,
  type KernKirDiagnosticCode,
  type KernKirEnvelope,
  type KernKirEvent,
  type KernKirExecutionOptions,
  KernKirFault,
  type KernKirRequest,
  type KernKirSlot,
  type KernKirValue,
} from './contracts.js';
import { createExecutionDeadline, type ExecutionDeadline } from './deadline.js';
import { failureEnvelope, successEnvelopeBytes } from './envelope.js';
import { type CompiledExpression, compileExpression, evaluateExpression } from './expression.js';
import {
  canonicalRecord,
  denseArray,
  exact,
  inspectRequest,
  inspectSlot,
  nodeChildren,
  nodeProperties,
  plainRecord,
  type RuntimeMeter,
  requiredText,
} from './inspect.js';

type ParameterType =
  | { readonly kind: 'boolean' | 'integer' | 'text' }
  | { readonly kind: 'list'; readonly element: 'boolean' | 'integer' | 'text' };

type CompiledStatement =
  | { readonly kind: 'let'; readonly name: string; readonly value: CompiledExpression }
  | {
      readonly kind: 'capability';
      readonly input: CompiledExpression | undefined;
      readonly name: string;
      readonly namespace: string;
      readonly operation: string;
    }
  | { readonly kind: 'print'; readonly value: CompiledExpression }
  | { readonly kind: 'return'; readonly value: CompiledExpression };

interface CompiledHandler {
  readonly parameters: readonly { readonly name: string; readonly type: ParameterType }[];
  readonly returnType: ParameterType;
  readonly statements: readonly CompiledStatement[];
}

function fault(code: KernKirDiagnosticCode, message: string): never {
  throw new KernKirFault(code, 'link', message);
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

function parameterType(value: CanonicalValue | undefined, label: string, meter: RuntimeMeter): ParameterType {
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

function compileStatement(
  node: StructuralKirNode,
  bindings: Set<string>,
  meter: RuntimeMeter,
  label: string,
): CompiledStatement {
  meter.step();
  const kind = nodeKind(node, label);
  const properties = nodeProperties(node, label);
  assertLeaf(node, label);
  if (kind === 'let') {
    propertySet(properties, ['name', 'value'], [], label);
    const name = propertyText(properties, 'name', label, meter);
    if (bindings.has(name)) fault('handler-entry-unsupported', `${label}: duplicate binding ${name}`);
    const value = properties.get('value');
    if (value === undefined) fault('handler-entry-unsupported', `${label}.value`);
    const compiled: Extract<CompiledStatement, { kind: 'let' }> = Object.freeze({
      kind: 'let',
      name,
      value: compileExpression(value, bindings, meter, `${label}.value`),
    });
    bindings.add(name);
    return compiled;
  }
  if (kind === 'capability') {
    propertySet(properties, ['name', 'namespace', 'operation'], ['input'], label);
    const name = propertyText(properties, 'name', label, meter);
    if (bindings.has(name)) fault('handler-entry-unsupported', `${label}: duplicate binding ${name}`);
    const namespace = propertyText(properties, 'namespace', label, meter);
    const operation = propertyText(properties, 'operation', label, meter);
    const input = properties.get('input');
    const compiled: Extract<CompiledStatement, { kind: 'capability' }> = Object.freeze({
      kind: 'capability',
      name,
      namespace,
      operation,
      input: input === undefined ? undefined : compileExpression(input, bindings, meter, `${label}.input`),
    });
    bindings.add(name);
    return compiled;
  }
  if (kind === 'print' || kind === 'return') {
    propertySet(properties, ['value'], [], label);
    const value = properties.get('value');
    if (value === undefined) fault('handler-entry-unsupported', `${label}.value`);
    return Object.freeze({ kind, value: compileExpression(value, bindings, meter, `${label}.value`) });
  }
  fault('handler-entry-unsupported', `${label}: statement kind ${kind} is outside RT-1`);
}

function compileHandler(fn: StructuralKirNode, meter: RuntimeMeter, label: string): CompiledHandler {
  const properties = nodeProperties(fn, label);
  propertySet(properties, ['export', 'name', 'returns'], [], label);
  if (!propertyBool(properties, 'export', label))
    fault('handler-entry-unsupported', `${label}: function is not exported`);
  const returnType = parameterType(properties.get('returns'), `${label}.returns`, meter);
  const children = nodeChildren(fn, label);
  const parameters: { readonly name: string; readonly type: ParameterType }[] = [];
  let handler: StructuralKirNode | undefined;
  const bindings = new Set<string>();
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const childLabel = `${label}.children[${index}]`;
    const kind = nodeKind(child, childLabel);
    if (kind === 'param' && handler === undefined) {
      const props = nodeProperties(child, childLabel);
      propertySet(props, ['name', 'type'], [], childLabel);
      assertLeaf(child, childLabel);
      const name = propertyText(props, 'name', childLabel, meter);
      if (bindings.has(name)) fault('handler-entry-unsupported', `${childLabel}: duplicate parameter`);
      bindings.add(name);
      parameters.push(Object.freeze({ name, type: parameterType(props.get('type'), `${childLabel}.type`, meter) }));
      meter.collection(parameters.length, `${label}.parameters`);
    } else if (kind === 'handler' && handler === undefined) {
      handler = child;
    } else {
      fault('handler-entry-unsupported', `${childLabel}: expected parameters followed by one handler`);
    }
  }
  if (handler === undefined) fault('handler-entry-unsupported', `${label}: missing handler`);
  const handlerProperties = nodeProperties(handler, `${label}.handler`);
  propertySet(handlerProperties, ['lang'], [], `${label}.handler`);
  if (propertyText(handlerProperties, 'lang', `${label}.handler`, meter) !== 'kern') {
    fault('handler-entry-unsupported', `${label}: handler language is not kern`);
  }
  const statementNodes = nodeChildren(handler, `${label}.handler`);
  const statements = statementNodes.map((node, index) =>
    compileStatement(node, bindings, meter, `${label}.handler.children[${index}]`),
  );
  meter.collection(statements.length, `${label}.statements`);
  if (
    statements.length === 0 ||
    statements.at(-1)?.kind !== 'return' ||
    statements.filter((item) => item.kind === 'return').length !== 1
  ) {
    fault('handler-entry-unsupported', `${label}: expected exactly one final return`);
  }
  return Object.freeze({ parameters: Object.freeze(parameters), returnType, statements: Object.freeze(statements) });
}

function link(projection: VerifiedKernProjection, request: KernKirRequest, meter: RuntimeMeter): CompiledHandler {
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
    return module.id === request.entry.moduleId;
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
    return item.kind === 'fn' && item.name === request.entry.handlerName && item.source === null;
  });
  if (exported.length !== 1)
    fault(exported.length === 0 ? 'handler-entry-not-found' : 'handler-entry-ambiguous', 'entry export mismatch');
  const roots = denseArray(module.roots, 'entry.module.roots') as readonly StructuralKirNode[];
  meter.collection(roots.length, 'entry.module.roots');
  const candidates = roots.filter((root, index) => {
    meter.step();
    const label = `entry.module.roots[${index}]`;
    if (nodeKind(root, label) !== 'fn') return false;
    return propertyText(nodeProperties(root, label), 'name', label, meter) === request.entry.handlerName;
  });
  if (candidates.length === 0) fault('handler-entry-not-found', 'entry function was not found');
  if (candidates.length !== 1) fault('handler-entry-ambiguous', 'entry function is ambiguous');
  return compileHandler(candidates[0], meter, 'entry.function');
}

function matchesType(value: KernKirValue, type: ParameterType): boolean {
  if (type.kind !== 'list') return value.tag === type.kind;
  return value.tag === 'list' && value.value.every((item) => item.tag === type.element);
}

function inspectOptions(value: KernKirExecutionOptions | undefined): KernKirExecutionOptions {
  if (value === undefined) return Object.freeze({});
  const record = plainRecord(value, 'options');
  if (Object.keys(record).some((key) => key !== 'invoke' && key !== 'signal'))
    fault('invalid-handler-arguments', 'options has unknown fields');
  if (record.invoke !== undefined && typeof record.invoke !== 'function')
    fault('invalid-handler-arguments', 'options.invoke must be callable');
  if (record.signal !== undefined && !(record.signal instanceof AbortSignal))
    fault('invalid-handler-arguments', 'options.signal must be an AbortSignal');
  return Object.freeze({
    ...(record.invoke === undefined ? {} : { invoke: record.invoke as KernKirExecutionOptions['invoke'] }),
    ...(record.signal === undefined ? {} : { signal: record.signal as AbortSignal }),
  });
}

function requestIdFrom(value: unknown): string | null {
  try {
    const record = plainRecord(value, 'request');
    return typeof record.requestId === 'string' ? record.requestId : null;
  } catch {
    return null;
  }
}

async function run(
  handler: CompiledHandler,
  request: KernKirRequest,
  options: KernKirExecutionOptions,
  meter: RuntimeMeter,
  deadline: ExecutionDeadline,
  events: KernKirEvent[],
): Promise<KernKirEnvelope> {
  const expected = handler.parameters.map((parameter) => parameter.name).sort();
  const actual = Object.keys(request.arguments).sort();
  if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
    fault('invalid-handler-arguments', 'argument names do not match handler parameters');
  }
  const bindings = new Map<string, KernKirValue>();
  for (const parameter of handler.parameters) {
    const value = request.arguments[parameter.name];
    if (value === undefined || !matchesType(value, parameter.type))
      fault('invalid-handler-arguments', `argument ${parameter.name} has wrong type`);
    bindings.set(parameter.name, value);
  }
  if (handler.statements.some((statement) => statement.kind === 'capability') && options.invoke === undefined) {
    throw new KernKirFault('capability-error', 'execution', 'capability provider is missing');
  }
  if (request.control.preCancelled || options.signal?.aborted) {
    throw new KernKirFault('execution-cancelled', 'execution', 'execution was cancelled');
  }
  const controller = new AbortController();
  let reason: 'cancelled' | 'timeout' | undefined;
  const cancel = (): void => {
    reason = 'cancelled';
    controller.abort();
  };
  options.signal?.addEventListener('abort', cancel, { once: true });
  const remaining = deadline.remainingMs();
  const timer =
    remaining === null
      ? undefined
      : setTimeout(() => {
          reason = 'timeout';
          controller.abort();
        }, remaining);
  const checkAbort = (): void => {
    deadline.check();
    if (!controller.signal.aborted) return;
    throw new KernKirFault(
      reason === 'timeout' ? 'execution-timeout' : 'execution-cancelled',
      'execution',
      'execution interrupted',
    );
  };
  try {
    for (const statement of handler.statements) {
      meter.step();
      checkAbort();
      if (statement.kind === 'let') {
        bindings.set(statement.name, evaluateExpression(statement.value, bindings, meter));
      } else if (statement.kind === 'capability') {
        const input: KernKirSlot =
          statement.input === undefined
            ? Object.freeze({ presence: 'absent' })
            : Object.freeze({ presence: 'value', value: evaluateExpression(statement.input, bindings, meter) });
        if (events.length + 1 > request.limits.maxEvents) {
          throw new KernKirFault('runtime-limit-exceeded', 'execution', 'event limit exceeded');
        }
        let rawResult: unknown;
        try {
          rawResult = await invokeCapability(
            options.invoke as NonNullable<KernKirExecutionOptions['invoke']>,
            {
              namespace: statement.namespace,
              operation: statement.operation,
              input,
              signal: controller.signal,
            },
            () =>
              new KernKirFault(
                reason === 'timeout' ? 'execution-timeout' : 'execution-cancelled',
                'execution',
                'capability interrupted',
              ),
          );
        } catch (error) {
          if (error instanceof KernKirFault) throw error;
          throw new KernKirFault('capability-error', 'execution', 'capability provider failed');
        }
        checkAbort();
        let result: KernKirSlot;
        try {
          result = inspectSlot(rawResult, meter, 'capability result');
        } catch (error) {
          if (error instanceof KernKirFault && error.code === 'runtime-limit-exceeded') throw error;
          throw new KernKirFault('invalid-handler-result', 'execution', 'capability result is invalid');
        }
        if (result.presence !== 'value')
          throw new KernKirFault('invalid-handler-result', 'execution', 'capability result is absent');
        events.push(
          Object.freeze({
            input,
            namespace: statement.namespace,
            op: 'capability',
            operation: statement.operation,
            result,
          }),
        );
        bindings.set(statement.name, result.value);
      } else if (statement.kind === 'print') {
        const value = evaluateExpression(statement.value, bindings, meter);
        if (value.tag !== 'text')
          throw new KernKirFault('unsupported-runtime-input', 'execution', 'print expects text');
        if (events.length + 1 > request.limits.maxEvents)
          throw new KernKirFault('runtime-limit-exceeded', 'execution', 'event limit exceeded');
        events.push(Object.freeze({ op: 'stdout', text: value.value }));
      } else {
        const value = evaluateExpression(statement.value, bindings, meter);
        if (!matchesType(value, handler.returnType))
          throw new KernKirFault('invalid-handler-result', 'execution', 'return type mismatch');
        const result: KernKirSlot = Object.freeze({ presence: 'value', value });
        checkAbort();
        if (successEnvelopeBytes(request.requestId, events, result, checkAbort) > request.limits.maxBytes) {
          throw new KernKirFault('runtime-limit-exceeded', 'execution', 'envelope byte limit exceeded');
        }
        checkAbort();
        return Object.freeze({
          completion: Object.freeze({ kind: 'return' }),
          diagnostics: Object.freeze([]),
          events: Object.freeze(events),
          format: KERN_KIR_RUNTIME_FORMAT,
          outcome: 'success',
          requestId: request.requestId,
          result,
        });
      }
    }
    throw new KernKirFault('handler-entry-unsupported', 'execution', 'handler did not return');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}

export async function executeKernKir(
  projection: VerifiedKernProjection,
  input: KernKirRequest,
  executionOptions?: KernKirExecutionOptions,
): Promise<KernKirEnvelope> {
  const deadline = createExecutionDeadline(input);
  const requestId = requestIdFrom(input);
  const committedEvents: KernKirEvent[] = [];
  try {
    if (!authenticateVerifiedProjection(projection)) {
      throw new KernKirFault('projection-authentication-error', 'link', 'projection is not authenticated');
    }
    deadline.check();
    const { request, meter } = inspectRequest(input, deadline.check);
    const options = inspectOptions(executionOptions);
    const handler = link(projection, request, meter);
    deadline.check();
    return await run(handler, request, options, meter, deadline, committedEvents);
  } catch (error) {
    return failureEnvelope(requestId, error, committedEvents);
  }
}
