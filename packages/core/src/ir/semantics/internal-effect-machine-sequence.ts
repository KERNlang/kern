import type { IRNode } from '../../types.js';
import { branchPreconditions, selectBranchPath } from './branch-runtime.js';
import {
  type PreparedInternalCapabilityEffect,
  prepareInternalCapabilityEffectWithEvaluator,
  resumeInternalCapabilityEffect,
} from './capability-runtime.js';
import { iterateEachRuntimeSteps } from './each-runtime.js';
import { forRuntimeRange } from './for-runtime.js';
import { evaluateIfConditionWithEvaluator } from './if-runtime.js';
import { runInternalEffectMachineLeaf } from './internal-effect-machine-leaf.js';
import { runInternalEffectMachineTry } from './internal-effect-machine-try.js';
import {
  hasNoBody,
  INTERNAL_EFFECT_MACHINE_FORMAT,
  InternalEffectMachineError,
  type InternalEffectMachineGenerator,
  type InternalEffectMachineState,
  isUnifiedNodeType,
} from './internal-effect-machine-types.js';
import { evaluateLambdaEffects } from './lambda-runtime.js';
import { evalPortableValue as evalMachinePortableValue } from './portable-machine-evaluator.js';
import { childEnv, defineBinding, defineIntBinding, markRepeatableLoopBody, type SemanticEnv } from './semantic-env.js';
import { emptyTrace, type Trace } from './trace.js';
import { evaluateWhileConditionWithEvaluator, WHILE_MAX_ITERATIONS } from './while-runtime.js';

function prepareCapability(node: IRNode, env: SemanticEnv): PreparedInternalCapabilityEffect {
  try {
    return prepareInternalCapabilityEffectWithEvaluator(node, env, evalMachinePortableValue);
  } catch {
    throw new InternalEffectMachineError('effect machine rejected capability node', node);
  }
}

function appendTrace(out: Trace, next: Trace): boolean {
  out.events.push(...next.events);
  if (next.completion.kind === 'normal') return false;
  out.completion = next.completion;
  return true;
}

function consumeIterationBudget(state: InternalEffectMachineState, node: IRNode): void {
  if (state.remainingIterations === undefined) {
    throw new InternalEffectMachineError('effect machine loop requires an iteration budget', node);
  }
  if (state.remainingIterations <= 0) {
    throw new InternalEffectMachineError('effect machine iteration budget exhausted', node);
  }
  state.remainingIterations -= 1;
}

function* runIf(
  node: IRNode,
  elseNode: IRNode | undefined,
  env: SemanticEnv,
  state: InternalEffectMachineState,
): InternalEffectMachineGenerator {
  let selected: readonly IRNode[];
  try {
    selected = evaluateIfConditionWithEvaluator(node, env, evalMachinePortableValue)
      ? (node.children ?? [])
      : (elseNode?.children ?? []);
  } catch {
    throw new InternalEffectMachineError('effect machine rejected if node', node);
  }
  return yield* runInternalEffectMachineSequence(selected, env, state);
}

function selectMachineBranch(node: IRNode, env: SemanticEnv): IRNode | undefined {
  try {
    if (!branchPreconditions(node, env)) {
      throw new InternalEffectMachineError('effect machine rejected branch node', node);
    }
    return selectBranchPath(node, env);
  } catch (error) {
    if (error instanceof InternalEffectMachineError) throw error;
    throw new InternalEffectMachineError('effect machine rejected branch node', node);
  }
}

function evaluateMachineWhileCondition(node: IRNode, env: SemanticEnv): boolean {
  try {
    return evaluateWhileConditionWithEvaluator(node, env, evalMachinePortableValue);
  } catch {
    throw new InternalEffectMachineError('effect machine rejected while node', node);
  }
}

function machineForRange(node: IRNode, env: SemanticEnv) {
  try {
    return forRuntimeRange(node, env);
  } catch {
    throw new InternalEffectMachineError('effect machine rejected for node', node);
  }
}

function* machineEachSteps(node: IRNode, env: SemanticEnv, beforeIteration: () => void) {
  try {
    yield* iterateEachRuntimeSteps(node, env, beforeIteration);
  } catch (error) {
    if (error instanceof InternalEffectMachineError) throw error;
    throw new InternalEffectMachineError('effect machine rejected each node', node);
  }
}

function* runEach(node: IRNode, env: SemanticEnv, state: InternalEffectMachineState): InternalEffectMachineGenerator {
  const out = emptyTrace();
  for (const step of machineEachSteps(node, env, () => consumeIterationBudget(state, node))) {
    out.events.push({ binding: step.primary[0], op: 'iter-next', value: step.primary[1] });
    const iterationEnv = childEnv(env);
    markRepeatableLoopBody(iterationEnv);
    for (const [name, value] of step.bindings) defineBinding(iterationEnv, name, value);
    const next = yield* runInternalEffectMachineSequence(node.children ?? [], iterationEnv, state);
    out.events.push(...next.events);
    if (next.completion.kind === 'break') return out;
    if (next.completion.kind === 'continue') continue;
    if (next.completion.kind === 'return' || next.completion.kind === 'throw') {
      out.completion = next.completion;
      return out;
    }
  }
  return out;
}

function* runFor(node: IRNode, env: SemanticEnv, state: InternalEffectMachineState): InternalEffectMachineGenerator {
  const { name, from, to, step, children } = machineForRange(node, env);
  const out = emptyTrace();
  for (let value = from; step > 0 ? value < to : value > to; value += step) {
    consumeIterationBudget(state, node);
    out.events.push({ binding: name, op: 'iter-next', value });
    const iterationEnv = childEnv(env);
    markRepeatableLoopBody(iterationEnv);
    defineIntBinding(iterationEnv, name, value);
    const next = yield* runInternalEffectMachineSequence(children, iterationEnv, state);
    out.events.push(...next.events);
    if (next.completion.kind === 'break') return out;
    if (next.completion.kind === 'continue') continue;
    if (next.completion.kind === 'return' || next.completion.kind === 'throw') {
      out.completion = next.completion;
      return out;
    }
  }
  return out;
}

function* runWhile(node: IRNode, env: SemanticEnv, state: InternalEffectMachineState): InternalEffectMachineGenerator {
  const out = emptyTrace();
  let iterations = 0;
  while (evaluateMachineWhileCondition(node, env)) {
    consumeIterationBudget(state, node);
    if (iterations >= WHILE_MAX_ITERATIONS) {
      throw new InternalEffectMachineError(
        `while: exceeded ${WHILE_MAX_ITERATIONS} iterations — non-terminating fixture`,
        node,
      );
    }
    iterations += 1;
    const iterationEnv = childEnv(env);
    markRepeatableLoopBody(iterationEnv);
    const next = yield* runInternalEffectMachineSequence(node.children ?? [], iterationEnv, state);
    out.events.push(...next.events);
    if (next.completion.kind === 'break') return out;
    if (next.completion.kind === 'continue') continue;
    if (next.completion.kind === 'return' || next.completion.kind === 'throw') {
      out.completion = next.completion;
      return out;
    }
  }
  return out;
}

function* runBranch(node: IRNode, env: SemanticEnv, state: InternalEffectMachineState): InternalEffectMachineGenerator {
  const selected = selectMachineBranch(node, env);
  if (!selected) return emptyTrace();
  const branchEnv = childEnv(env);
  return yield* runInternalEffectMachineSequence(selected.children ?? [], branchEnv, state);
}

export function* runInternalEffectMachineSequence(
  nodes: readonly IRNode[],
  env: SemanticEnv,
  state: InternalEffectMachineState,
): InternalEffectMachineGenerator {
  const out = emptyTrace();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    let elseNode: IRNode | undefined;
    if (node.type === 'if') {
      elseNode = nodes[index + 1]?.type === 'else' ? nodes[index + 1] : undefined;
      if (elseNode) index += 1;
    } else if (node.type === 'else') {
      throw new InternalEffectMachineError('else must immediately follow an if sibling', node);
    }
    let next: Trace;
    if (node.type === 'if') {
      next = yield* runIf(node, elseNode, env, state);
    } else if (node.type === 'branch') {
      next = yield* runBranch(node, env, state);
    } else if (node.type === 'for') {
      next = yield* runFor(node, env, state);
    } else if (node.type === 'each') {
      next = yield* runEach(node, env, state);
    } else if (node.type === 'while') {
      next = yield* runWhile(node, env, state);
    } else if (node.type === 'try') {
      next = yield* runInternalEffectMachineTry(node, env, state, runInternalEffectMachineSequence);
    } else if (node.type === 'lambda') {
      try {
        next = evaluateLambdaEffects(node, env, () => consumeIterationBudget(state, node));
      } catch (cause) {
        if (cause instanceof InternalEffectMachineError) throw cause;
        throw new InternalEffectMachineError('effect machine rejected lambda node', node, cause);
      }
    } else if (!isUnifiedNodeType(node.type) || !hasNoBody(node)) {
      throw new InternalEffectMachineError(`effect machine rejected nested node type "${node.type}"`, node);
    } else if (node.type === 'capability') {
      const prepared = prepareCapability(node, env);
      const result = yield Object.freeze({
        format: INTERNAL_EFFECT_MACHINE_FORMAT,
        kind: 'capability',
        prepared,
      });
      next = resumeInternalCapabilityEffect(prepared, result, env);
    } else {
      try {
        next = runInternalEffectMachineLeaf(node, env);
      } catch (cause) {
        throw new InternalEffectMachineError(`effect machine rejected node type "${node.type}"`, node, cause);
      }
    }
    if (appendTrace(out, next)) return out;
  }
  return out;
}
