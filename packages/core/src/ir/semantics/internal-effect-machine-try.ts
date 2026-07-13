import type { IRNode } from '../../types.js';
import { defineBinding, type SemanticEnv } from './index.js';
import {
  type InternalEffectMachineChildSequenceRunner,
  InternalEffectMachineError,
  type InternalEffectMachineGenerator,
  type InternalEffectMachineState,
} from './internal-effect-machine-types.js';
import { makeCaughtErrorValue } from './portable-error.js';
import { type CompletionRecord, emptyTrace } from './trace.js';
import { tryRuntimeParts, UNAVAILABLE_CAUGHT_ERROR } from './try-runtime.js';

export function* runInternalEffectMachineTry(
  node: IRNode,
  env: SemanticEnv,
  state: InternalEffectMachineState,
  runChildSequence: InternalEffectMachineChildSequenceRunner,
): InternalEffectMachineGenerator {
  const { body, catchNode, finallyNode } = tryRuntimeParts(node.children ?? []);
  const out = emptyTrace();
  const bodyTrace = yield* runChildSequence(body, env, state);
  out.events.push(...bodyTrace.events);
  let completion: CompletionRecord = bodyTrace.completion;

  if (completion.kind === 'return' && catchNode) {
    throw new InternalEffectMachineError('try: body return with catch is outside the portable domain', node);
  }

  if (completion.kind === 'throw' && catchNode) {
    const caught = catchNode.props?.name;
    if (typeof caught !== 'string' || caught === '') {
      throw new InternalEffectMachineError('effect machine rejected catch binding', catchNode);
    }
    const caughtValue = completion.error ? makeCaughtErrorValue(completion.error) : null;
    defineBinding(env, caught, caughtValue ?? UNAVAILABLE_CAUGHT_ERROR);
    let catchTrace;
    try {
      catchTrace = yield* runChildSequence(catchNode.children ?? [], env, state);
    } finally {
      defineBinding(env, caught, UNAVAILABLE_CAUGHT_ERROR);
    }
    out.events.push(...catchTrace.events);
    completion = catchTrace.completion;
  }

  if (finallyNode) {
    const finallyTrace = yield* runChildSequence(finallyNode.children ?? [], env, state);
    out.events.push(...finallyTrace.events);
    if (finallyTrace.completion.kind !== 'normal') {
      throw new InternalEffectMachineError('try: finally must complete normally (cleanup-only this slice)', finallyNode);
    }
  }

  out.completion = completion;
  return out;
}
