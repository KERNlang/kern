import type { VerifiedKernProjection } from '../frontend-projection/contracts.js';
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
import { type ExpressionRuntime, evaluateExpression, matchesType } from './expression.js';
import { inspectRequest, inspectSlot, plainRecord, type RuntimeMeter } from './inspect.js';
import {
  authenticateLinkedKernKirProjectionOrThrow,
  type LinkedKernKirHandler,
  type LinkedKernKirHelper,
  type LinkedKernKirStatement,
  linkedProgramHelpers,
  linkedStatementsInvokeCapability,
  linkVerifiedKernKirProgramOrThrow,
} from './linked-kir-program/index.js';

function fault(code: KernKirDiagnosticCode, message: string): never {
  throw new KernKirFault(code, 'link', message);
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
  handler: LinkedKernKirHandler,
  helpers: readonly LinkedKernKirHelper[] | undefined,
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
  const linkedHelpers = linkedProgramHelpers(helpers);
  if (linkedStatementsInvokeCapability(handler.statements, linkedHelpers) && options.invoke === undefined) {
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
  const runtime: ExpressionRuntime = {
    checkAbort,
    events,
    helpers: linkedHelpers,
    maxEvents: request.limits.maxEvents,
  };
  const frames: { readonly statements: readonly LinkedKernKirStatement[]; index: number }[] = [];
  const runFrames = async (): Promise<KernKirEnvelope | undefined> => {
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      if (frame.index >= frame.statements.length) {
        frames.pop();
        continue;
      }
      const statement = frame.statements[frame.index];
      frame.index += 1;
      meter.step();
      checkAbort();
      if (statement.kind === 'let') {
        bindings.set(statement.name, evaluateExpression(statement.value, bindings, meter, runtime));
      } else if (statement.kind === 'capability') {
        const input: KernKirSlot =
          statement.input === undefined
            ? Object.freeze({ presence: 'absent' })
            : Object.freeze({
                presence: 'value',
                value: evaluateExpression(statement.input, bindings, meter, runtime),
              });
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
        const value = evaluateExpression(statement.value, bindings, meter, runtime);
        if (value.tag !== 'text')
          throw new KernKirFault('unsupported-runtime-input', 'execution', 'print expects text');
        if (events.length + 1 > request.limits.maxEvents)
          throw new KernKirFault('runtime-limit-exceeded', 'execution', 'event limit exceeded');
        events.push(Object.freeze({ op: 'stdout', text: value.value }));
      } else if (statement.kind === 'if') {
        const condition = evaluateExpression(statement.condition, bindings, meter, runtime);
        if (condition.tag !== 'boolean')
          throw new KernKirFault('unsupported-runtime-input', 'execution', 'if condition expects boolean');
        const branch = condition.value === true ? statement.thenBranch : statement.elseBranch;
        if (branch !== undefined) frames.push({ statements: branch, index: 0 });
      } else {
        const value = evaluateExpression(statement.value, bindings, meter, runtime);
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
    return undefined;
  };
  try {
    frames.push({ statements: handler.statements, index: 0 });
    const returned = await runFrames();
    if (returned !== undefined) return returned;
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
  let requestId: string | null = null;
  const committedEvents: KernKirEvent[] = [];
  try {
    authenticateLinkedKernKirProjectionOrThrow(projection);
    const deadline = createExecutionDeadline(input);
    requestId = requestIdFrom(input);
    deadline.check();
    const { request, meter } = inspectRequest(input, deadline.check);
    const options = inspectOptions(executionOptions);
    const linked = linkVerifiedKernKirProgramOrThrow(projection, request.entry, meter);
    deadline.check();
    return await run(linked.program, linked.helpers, request, options, meter, deadline, committedEvents);
  } catch (error) {
    return failureEnvelope(requestId, error, committedEvents);
  }
}
