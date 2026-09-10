import { type KernKirDiagnosticCode, KernKirFault, type KernKirSlot, type KernKirValue } from './contracts.js';
import { type ExpressionRuntime, evaluateExpression, integerOperand, integerValue, matchesType } from './expression.js';
import type { RuntimeMeter } from './inspect.js';
import type {
  LinkedKernKirEntryHandler,
  LinkedKernKirExpression,
  LinkedKernKirHandler,
  LinkedKernKirStatement,
} from './linked-kir-program/index.js';

export type StatementStep =
  | {
      readonly kind: 'capability';
      readonly input: KernKirSlot;
      readonly statement: Extract<LinkedKernKirStatement, { kind: 'capability' }>;
    }
  | {
      readonly kind: 'call';
      readonly arguments: readonly KernKirValue[];
      readonly handler: LinkedKernKirHandler;
    };

// A drained walk is not an error on its own: RT-6's void entry completes there, while a helper and
// a value-returning entry both fail closed. The core reports which happened and each driver decides.
export type StatementWalkResult =
  | { readonly kind: 'returned'; readonly value: KernKirValue }
  | { readonly kind: 'threw'; readonly value: KernKirValue }
  | { readonly kind: 'drained' };

export interface StatementWalkPolicy {
  readonly meterReturn: boolean;
  readonly returnCode: KernKirDiagnosticCode;
  readonly returnMessage: string;
}

export const ENTRY_WALK_POLICY = Object.freeze({
  meterReturn: true,
  returnCode: 'invalid-handler-result',
  returnMessage: 'return type mismatch',
}) satisfies StatementWalkPolicy;

export const HELPER_WALK_POLICY = Object.freeze({
  meterReturn: false,
  returnCode: 'unsupported-runtime-input',
  returnMessage: 'KIR_CALL_RETURN_TAG',
}) satisfies StatementWalkPolicy;

// A driver seeds the first next() with this and the walk discards it, so neither driver needs a
// special case for the first resumption.
export const WALK_SEED: KernKirValue = Object.freeze({ tag: 'null' });

function* statementValue(
  expression: LinkedKernKirExpression,
  bindings: ReadonlyMap<string, KernKirValue>,
  meter: RuntimeMeter,
  runtime: ExpressionRuntime,
): Generator<StatementStep, KernKirValue, KernKirValue> {
  if (expression.kind !== 'user-call' || !runtime.asyncHelpers.has(expression.handlerName)) {
    return evaluateExpression(expression, bindings, meter, runtime);
  }
  meter.step();
  const handler = runtime.helpers?.get(expression.handlerName);
  if (handler === undefined) {
    throw new KernKirFault('handler-link-error', 'execution', `missing helper ${expression.handlerName}`);
  }
  const args = expression.arguments.map((argument) => evaluateExpression(argument, bindings, meter, runtime));
  return yield Object.freeze({ arguments: Object.freeze(args), handler, kind: 'call' as const });
}

interface ForLoopState {
  readonly counter: string;
  readonly kind: 'for';
  readonly step: bigint;
  readonly to: bigint;
  current: bigint;
}

interface EachLoopState {
  readonly items: readonly KernKirValue[];
  readonly item: string;
  readonly indexBinding?: string;
  readonly kind: 'each';
  cursor: number;
}

interface WhileLoopState {
  readonly condition: LinkedKernKirExpression;
  readonly kind: 'while';
}

type LoopState = EachLoopState | ForLoopState | WhileLoopState;

// The try statement is its own trap record: the frame that carries it needs exactly the clause
// bodies and the binding the statement already declares.
type TryTrap = Extract<LinkedKernKirStatement, { readonly kind: 'try' }>;

interface WalkFrame {
  readonly completion: StatementWalkResult | undefined;
  readonly loop: LoopState | undefined;
  readonly statements: readonly LinkedKernKirStatement[];
  readonly trap: TryTrap | undefined;
  index: number;
}

const walkFrame = (
  statements: readonly LinkedKernKirStatement[],
  loop?: LoopState,
  trap?: TryTrap,
  completion?: StatementWalkResult,
): WalkFrame => ({ completion, index: 0, loop, statements, trap });

function loopContinues(loop: ForLoopState): boolean {
  return loop.step > 0n ? loop.current < loop.to : loop.current > loop.to;
}

export function* walkStatements(
  handler: LinkedKernKirEntryHandler,
  bindings: Map<string, KernKirValue>,
  meter: RuntimeMeter,
  runtime: ExpressionRuntime,
  policy: StatementWalkPolicy,
): Generator<StatementStep, StatementWalkResult, KernKirValue> {
  const frames: WalkFrame[] = [walkFrame(handler.statements)];
  const enterTrip = (loop: LoopState): void => {
    meter.step();
    runtime.checkAbort();
    if (loop.kind === 'for') bindings.set(loop.counter, integerValue(loop.current, meter));
    if (loop.kind === 'each') {
      bindings.set(loop.item, loop.items[loop.cursor]);
      if (loop.indexBinding !== undefined) bindings.set(loop.indexBinding, integerValue(BigInt(loop.cursor), meter));
    }
  };
  // A completion the enclosing traps may absorb: a user throw enters the nearest catch body, and any
  // abrupt completion crossing a finally-bearing try runs that finally before it continues outward.
  // Returns the completion only when nothing can absorb it, so the caller leaves the generator.
  const settle = (completion: Exclude<StatementWalkResult, { kind: 'drained' }>): StatementWalkResult | undefined => {
    const absorbs = (trap: TryTrap | undefined): boolean =>
      trap !== undefined &&
      (trap.finallyBody !== undefined || (completion.kind === 'threw' && trap.catchBody.length > 0));
    let depth = frames.length - 1;
    while (depth >= 0 && !absorbs(frames[depth].trap)) depth -= 1;
    if (depth < 0) return completion;
    const trap = frames[depth].trap as TryTrap;
    frames.length = depth;
    meter.step();
    if (completion.kind === 'threw' && trap.catchBody.length > 0) {
      if (trap.binding !== undefined) bindings.set(trap.binding, completion.value);
      frames.push(walkFrame(trap.catchBody, undefined, { ...trap, catchBody: [] }));
      return undefined;
    }
    frames.push(walkFrame(trap.finallyBody as readonly LinkedKernKirStatement[], undefined, undefined, completion));
    return undefined;
  };
  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame.index >= frame.statements.length) {
      const { completion, loop, trap } = frame;
      if (loop !== undefined) {
        let continues: boolean;
        if (loop.kind === 'for') {
          loop.current += loop.step;
          continues = loopContinues(loop);
        } else if (loop.kind === 'each') {
          loop.cursor += 1;
          continues = loop.cursor < loop.items.length;
        } else {
          const condition = evaluateExpression(loop.condition, bindings, meter, runtime);
          if (condition.tag !== 'boolean') {
            throw new KernKirFault('unsupported-runtime-input', 'execution', 'while condition expects boolean');
          }
          continues = condition.value === true;
        }
        if (continues) {
          frame.index = 0;
          enterTrip(loop);
          continue;
        }
        meter.step();
      }
      frames.pop();
      if (trap?.finallyBody !== undefined) {
        meter.step();
        frames.push(walkFrame(trap.finallyBody, undefined, undefined, completion));
      } else if (completion !== undefined && completion.kind !== 'drained') {
        const settled = settle(completion);
        if (settled !== undefined) return settled;
      }
      continue;
    }
    const statement = frame.statements[frame.index];
    frame.index += 1;
    if (statement.kind !== 'return' || policy.meterReturn) meter.step();
    runtime.checkAbort();
    if (statement.kind === 'let') {
      bindings.set(statement.name, yield* statementValue(statement.value, bindings, meter, runtime));
    } else if (statement.kind === 'break') {
      let depth = frames.length - 1;
      while (depth >= 0 && frames[depth].loop === undefined) depth -= 1;
      if (depth < 0) {
        throw new KernKirFault('unsupported-runtime-input', 'execution', 'KIR_JUMP_WITHOUT_LOOP_FRAME');
      }
      frames.length = depth;
      meter.step();
    } else if (statement.kind === 'continue') {
      let depth = frames.length - 1;
      while (depth >= 0 && frames[depth].loop === undefined) depth -= 1;
      if (depth < 0) {
        throw new KernKirFault('unsupported-runtime-input', 'execution', 'KIR_JUMP_WITHOUT_LOOP_FRAME');
      }
      frames.length = depth + 1;
      frames[depth].index = frames[depth].statements.length;
    } else if (statement.kind === 'assign') {
      bindings.set(statement.target, yield* statementValue(statement.value, bindings, meter, runtime));
    } else if (statement.kind === 'capability') {
      const input: KernKirSlot =
        statement.input === undefined
          ? Object.freeze({ presence: 'absent' })
          : Object.freeze({
              presence: 'value',
              value: evaluateExpression(statement.input, bindings, meter, runtime),
            });
      if (runtime.events.length + 1 > runtime.maxEvents) {
        throw new KernKirFault('runtime-limit-exceeded', 'execution', 'event limit exceeded');
      }
      bindings.set(statement.name, yield Object.freeze({ input, kind: 'capability' as const, statement }));
    } else if (statement.kind === 'print') {
      const value = yield* statementValue(statement.value, bindings, meter, runtime);
      if (value.tag !== 'text') throw new KernKirFault('unsupported-runtime-input', 'execution', 'print expects text');
      if (runtime.events.length + 1 > runtime.maxEvents) {
        throw new KernKirFault('runtime-limit-exceeded', 'execution', 'event limit exceeded');
      }
      runtime.events.push(Object.freeze({ op: 'stdout', text: value.value }));
    } else if (statement.kind === 'do') {
      if (statement.value !== undefined) yield* statementValue(statement.value, bindings, meter, runtime);
    } else if (statement.kind === 'if') {
      const condition = evaluateExpression(statement.condition, bindings, meter, runtime);
      if (condition.tag !== 'boolean') {
        throw new KernKirFault('unsupported-runtime-input', 'execution', 'if condition expects boolean');
      }
      const branch = condition.value === true ? statement.thenBranch : statement.elseBranch;
      if (branch !== undefined) frames.push(walkFrame(branch));
    } else if (statement.kind === 'each') {
      const { index, item } = statement;
      const source = evaluateExpression({ kind: 'identifier', name: statement.source }, bindings, meter, runtime);
      if (source.tag !== 'list') {
        throw new KernKirFault('unsupported-runtime-input', 'execution', 'each source expects list');
      }
      const loop: EachLoopState = { cursor: 0, indexBinding: index, item, items: source.value, kind: 'each' };
      if (loop.items.length > 0) {
        enterTrip(loop);
        frames.push(walkFrame(statement.body, loop));
      } else {
        meter.step();
      }
    } else if (statement.kind === 'for') {
      const from = integerOperand(evaluateExpression(statement.from, bindings, meter, runtime));
      const to = integerOperand(evaluateExpression(statement.to, bindings, meter, runtime));
      const step = integerOperand(evaluateExpression(statement.step, bindings, meter, runtime));
      if (step === 0n) throw new KernKirFault('unsupported-runtime-input', 'execution', 'ERR_KIR_LOOP_ZERO_STEP');
      const loop: ForLoopState = { counter: statement.counter, current: from, kind: 'for', step, to };
      if (loopContinues(loop)) {
        enterTrip(loop);
        frames.push(walkFrame(statement.body, loop));
      } else {
        meter.step();
      }
    } else if (statement.kind === 'while') {
      const condition = evaluateExpression(statement.condition, bindings, meter, runtime);
      if (condition.tag !== 'boolean') {
        throw new KernKirFault('unsupported-runtime-input', 'execution', 'while condition expects boolean');
      }
      if (condition.value === true) {
        const loop: WhileLoopState = { condition: statement.condition, kind: 'while' };
        enterTrip(loop);
        frames.push(walkFrame(statement.body, loop));
      } else {
        meter.step();
      }
    } else if (statement.kind === 'throw') {
      const value = yield* statementValue(statement.value, bindings, meter, runtime);
      const settled = settle(Object.freeze({ kind: 'threw' as const, value }));
      if (settled !== undefined) return settled;
    } else if (statement.kind === 'try') {
      meter.step();
      frames.push(walkFrame(statement.body, undefined, statement));
    } else {
      const { returnType } = handler;
      if (returnType.kind === 'void') {
        throw new KernKirFault('invalid-handler-result', 'execution', 'a void handler must not return a value');
      }
      const value = yield* statementValue(statement.value, bindings, meter, runtime);
      if (!matchesType(value, returnType)) {
        throw new KernKirFault(policy.returnCode, 'execution', policy.returnMessage);
      }
      const settled = settle(Object.freeze({ kind: 'returned' as const, value }));
      if (settled !== undefined) return settled;
    }
  }
  return Object.freeze({ kind: 'drained' as const });
}
