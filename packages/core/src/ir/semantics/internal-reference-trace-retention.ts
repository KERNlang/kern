import type { SemanticEnv } from './semantic-env.js';
import { isExternallyObservableTraceEvent, type Trace, type TraceEvent } from './trace.js';

export type InternalReferenceTraceRetention = 'full' | 'observable-only';

const referenceTraceRetention = Symbol('internalReferenceTraceRetention');
type RetentionEnvironment = SemanticEnv & {
  [referenceTraceRetention]?: InternalReferenceTraceRetention;
};

function retentionFor(env: SemanticEnv): InternalReferenceTraceRetention {
  return (env as RetentionEnvironment)[referenceTraceRetention] ?? 'full';
}

export function bindInternalReferenceTraceRetention(
  env: SemanticEnv,
  retention: InternalReferenceTraceRetention,
): () => void {
  const target = env as RetentionEnvironment;
  const previous = Object.getOwnPropertyDescriptor(target, referenceTraceRetention);
  Object.defineProperty(target, referenceTraceRetention, {
    configurable: true,
    enumerable: false,
    value: retention,
    writable: false,
  });
  return () => {
    if (previous) Object.defineProperty(target, referenceTraceRetention, previous);
    else Reflect.deleteProperty(target, referenceTraceRetention);
  };
}

export function copyInternalReferenceTraceRetention(source: SemanticEnv, target: SemanticEnv): void {
  const retention = (source as RetentionEnvironment)[referenceTraceRetention];
  if (retention !== undefined) bindInternalReferenceTraceRetention(target, retention);
}

export function appendInternalReferenceTraceEvent(out: Trace, event: TraceEvent, env: SemanticEnv): void {
  if (retentionFor(env) === 'full' || isExternallyObservableTraceEvent(event)) out.events.push(event);
}

export function appendInternalReferenceTraceEvents(out: Trace, events: readonly TraceEvent[], env: SemanticEnv): void {
  for (const event of events) appendInternalReferenceTraceEvent(out, event, env);
}
