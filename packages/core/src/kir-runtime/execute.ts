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
import {
  calleeBindings,
  ENTRY_WALK_POLICY,
  type ExpressionRuntime,
  HELPER_WALK_POLICY,
  matchesType,
  WALK_SEED,
  walkStatements,
} from './expression.js';
import { inspectRequest, inspectSlot, plainRecord, type RuntimeMeter } from './inspect.js';
import {
  authenticateLinkedKernKirProjectionOrThrow,
  type LinkedKernKirHelper,
  type LinkedKernKirProgram,
  linkedProgramAsyncHelpers,
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
  handler: LinkedKernKirProgram['program'],
  helpers: readonly LinkedKernKirHelper[] | undefined,
  request: KernKirRequest,
  options: KernKirExecutionOptions,
  meter: RuntimeMeter,
  deadline: ExecutionDeadline,
  events: KernKirEvent[],
): Promise<KernKirEnvelope> {
  const { returnType } = handler;
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
  const finish = (result: KernKirSlot): KernKirEnvelope => {
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
  };
  const runtime: ExpressionRuntime = {
    asyncHelpers: linkedProgramAsyncHelpers(helpers),
    checkAbort,
    events,
    helpers: linkedHelpers,
    maxEvents: request.limits.maxEvents,
  };
  // Continuation frames: a callee body is a walk pushed onto this stack, never host recursion, so
  // the only await in a whole call chain is the provider call above. Both completions - a returned
  // value and a drained void tail - are built inside this loop, so neither path crosses an await the
  // other does not.
  const stack = [walkStatements(handler, bindings, meter, runtime, ENTRY_WALK_POLICY)];
  const runFrames = async (): Promise<KernKirEnvelope> => {
    let resume = WALK_SEED;
    for (;;) {
      const step = stack[stack.length - 1].next(resume);
      resume = WALK_SEED;
      if (step.done) {
        stack.pop();
        if (stack.length > 0) {
          if (step.value.kind === 'drained') {
            throw new KernKirFault('handler-entry-unsupported', 'execution', 'helper did not return');
          }
          resume = step.value.value;
          continue;
        }
        if (step.value.kind === 'returned') {
          return finish(Object.freeze({ presence: 'value', value: step.value.value }));
        }
        if (returnType.kind === 'void') return finish(Object.freeze({ presence: 'absent' }));
        throw new KernKirFault('handler-entry-unsupported', 'execution', 'handler did not return');
      }
      if (step.value.kind === 'call') {
        meter.step();
        const callee = step.value.handler;
        stack.push(
          walkStatements(callee, calleeBindings(callee, step.value.arguments), meter, runtime, HELPER_WALK_POLICY),
        );
        continue;
      }
      // Inlined, not delegated to an async helper: awaiting an extra async frame would add a
      // microtask hop RT-1 has and the emitted legs do not, which is exactly what the tick fences
      // measure.
      const { input, statement } = step.value;
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
      let slot: KernKirSlot;
      try {
        slot = inspectSlot(rawResult, meter, 'capability result');
      } catch (error) {
        if (error instanceof KernKirFault && error.code === 'runtime-limit-exceeded') throw error;
        throw new KernKirFault('invalid-handler-result', 'execution', 'capability result is invalid');
      }
      if (slot.presence !== 'value')
        throw new KernKirFault('invalid-handler-result', 'execution', 'capability result is absent');
      events.push(
        Object.freeze({
          input,
          namespace: statement.namespace,
          op: 'capability',
          operation: statement.operation,
          result: slot,
        }),
      );
      resume = slot.value;
    }
  };
  try {
    return await runFrames();
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
