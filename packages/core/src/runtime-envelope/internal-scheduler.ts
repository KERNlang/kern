import type { SemanticEnv } from '../ir/semantics/index.js';
import type { InternalRuntimeEnvelopeOptions } from './types.js';

type SchedulerControl = NonNullable<InternalRuntimeEnvelopeOptions['scheduler']>;

interface SchedulerState {
  disposed: boolean;
  readonly key: object;
  pendingWork: number;
  readonly terminalPromise: Promise<InternalRuntimeSchedulerError>;
  terminal: InternalRuntimeSchedulerError | undefined;
}

export class InternalRuntimeSchedulerError extends Error {
  readonly code: 'execution-cancelled' | 'execution-timeout';

  constructor(code: InternalRuntimeSchedulerError['code']) {
    super(code);
    this.name = 'InternalRuntimeSchedulerError';
    this.code = code;
  }
}

const states = new WeakMap<object, SchedulerState>();
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function stateKey(env: SemanticEnv): object {
  return env.runnerCallCache ?? env;
}

function stateFor(env: SemanticEnv): SchedulerState | undefined {
  for (let current: SemanticEnv | undefined = env; current; current = current.parent) {
    const state = states.get(stateKey(current));
    if (state) return state;
  }
  return undefined;
}

function releaseIfIdle(state: SchedulerState): void {
  if (state.disposed && state.pendingWork === 0 && states.get(state.key) === state) states.delete(state.key);
}

function inspectedControl(control: SchedulerControl): {
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number | undefined;
} {
  if (typeof control !== 'object' || control === null || Array.isArray(control)) {
    throw new TypeError('internal runtime scheduler control must be an object');
  }
  const prototype = Object.getPrototypeOf(control);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('internal runtime scheduler control must be plain data');
  }
  if (Object.getOwnPropertySymbols(control).length > 0) {
    throw new TypeError('internal runtime scheduler control contains symbol keys');
  }
  const descriptors = Object.getOwnPropertyDescriptors(control);
  const keys = Object.keys(descriptors);
  if (keys.length === 0 || keys.some((key) => key !== 'signal' && key !== 'timeoutMs')) {
    throw new TypeError('internal runtime scheduler control fields are invalid');
  }
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError('internal runtime scheduler control is not inspectable plain data');
    }
  }

  const signal = descriptors.signal?.value;
  if (
    signal !== undefined &&
    (typeof signal !== 'object' ||
      signal === null ||
      typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function')
  ) {
    throw new TypeError('internal runtime scheduler signal is invalid');
  }
  const timeoutMs = descriptors.timeoutMs?.value;
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== 'number' ||
      !Number.isSafeInteger(timeoutMs) ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > MAX_TIMER_DELAY_MS)
  ) {
    throw new TypeError('internal runtime scheduler timeoutMs is invalid');
  }
  return { signal, timeoutMs };
}

export function installInternalRuntimeScheduler(env: SemanticEnv, control: SchedulerControl | undefined): () => void {
  if (control === undefined) return () => {};
  const accepted = inspectedControl(control);
  const key = stateKey(env);
  if (states.has(key)) throw new TypeError('internal runtime scheduler is already installed');

  let resolveTerminal: ((error: InternalRuntimeSchedulerError) => void) | undefined;
  const state: SchedulerState = {
    disposed: false,
    key,
    pendingWork: 0,
    terminal: undefined,
    terminalPromise: new Promise((resolve) => {
      resolveTerminal = resolve;
    }),
  };
  const terminate = (code: InternalRuntimeSchedulerError['code']) => {
    if (state.terminal) return;
    state.terminal = new InternalRuntimeSchedulerError(code);
    resolveTerminal?.(state.terminal);
  };
  states.set(key, state);

  const onAbort = () => terminate('execution-cancelled');
  let listening = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (accepted.signal?.aborted) {
    terminate('execution-cancelled');
  } else {
    if (accepted.signal) {
      accepted.signal.addEventListener('abort', onAbort, { once: true });
      listening = true;
      if (accepted.signal.aborted) terminate('execution-cancelled');
    }
    if (!state.terminal && accepted.timeoutMs !== undefined) {
      timer = setTimeout(() => terminate('execution-timeout'), accepted.timeoutMs);
    }
  }

  return () => {
    if (timer !== undefined) clearTimeout(timer);
    if (listening) accepted.signal?.removeEventListener('abort', onAbort);
    state.disposed = true;
    releaseIfIdle(state);
  };
}

export function throwIfInternalRuntimeSchedulerTerminated(env: SemanticEnv): void {
  const terminal = stateFor(env)?.terminal;
  if (terminal) throw terminal;
}

export async function waitForInternalRuntimeScheduler<T>(env: SemanticEnv, work: () => PromiseLike<T> | T): Promise<T> {
  const state = stateFor(env);
  if (!state) return work();
  if (state.terminal) throw state.terminal;

  state.pendingWork += 1;
  const workPromise = Promise.resolve().then(() => {
    if (state.terminal) throw state.terminal;
    return work();
  });
  workPromise.catch(() => {
    // A late rejection after scheduler termination is deliberately observed.
  });
  void workPromise.then(
    () => {
      state.pendingWork -= 1;
      releaseIfIdle(state);
    },
    () => {
      state.pendingWork -= 1;
      releaseIfIdle(state);
    },
  );
  return Promise.race([
    workPromise,
    state.terminalPromise.then((error) => {
      throw error;
    }),
  ]);
}
