/**
 * TS emitter leg — Phase 1 PR-3a.
 *
 * Wires `runTsEmitter` against the production TS codegen
 * (`emitNativeKernBodyTS`). The flow:
 *
 *   1. Lower fixture-only IR (`__trace`, `return`, `throw`) into KERN-native
 *      shapes via [[lowerFixtureToKernIR]]. Production emitters know nothing
 *      about fixture probes.
 *   2. Wrap the lowered IR in a synthetic `handler lang="kern"` so the
 *      body-statement code path is exercised.
 *   3. Run `emitNativeKernBodyTS` with `traceHooks.eachIterNext: true` —
 *      a narrowly scoped opt-in flag that injects a `__kernTrace(...)` call
 *      at the canonical event location (after destructuring, before body).
 *   4. Wrap the emitted body in a `try` that catches two sentinel error
 *      classes — `__KernReturn` and `__KernThrow` — converting them to
 *      `CompletionRecord`s. A normal fall-through is `{kind:'normal'}`.
 *   5. Execute in a fresh `vm.Context`. Bindings from `env.bindings` are
 *      injected as globals. The trace sink (`__kernTrace`) and sentinel
 *      classes are also globals.
 *   6. Return the observed [[Trace]] for comparison against the reference.
 *
 * Scoping discipline (per agon brainstorm constraint): trace-hook injection
 * stays limited to `each`. Generalising the hook surface is an explicit
 * spec revision, not a creep.
 */

import vm from 'node:vm';
import { emitNativeKernBodyTS } from '../../codegen/body-ts.js';
import type { IRNode } from '../../types.js';
import { lowerFixtureForTarget } from './fixture-lowering.js';
import type { SemanticEnv } from './index.js';
import type { CompletionRecord, Trace, TraceEvent } from './trace.js';

interface FixtureForLeg {
  ir: IRNode;
}

/**
 * TS-target lowering — wraps the shared target-aware lowering.
 * Kept exported under the original name so existing tests + the harness
 * stay backward-compatible.
 */
export function lowerFixtureToKernIR(node: IRNode): IRNode {
  return lowerFixtureForTarget(node, 'ts');
}

class KernReturnSentinel {
  readonly value: unknown;
  constructor(value: unknown) {
    this.value = value;
  }
}

class KernThrowSentinel {
  readonly kind: string;
  constructor(kind: string) {
    this.kind = kind;
  }
}

const TS_LEG_TIMEOUT_MS = 5000;
const RESERVED_SANDBOX_NAMES = ['__kernTrace', '__KernReturn', '__KernThrow'] as const;

/**
 * Best-effort error-name extraction for vm-context throws. `err instanceof
 * Error` is unreliable across the vm boundary (the inner realm has its
 * own `Error` prototype), so we fall back to a duck-typed property check.
 */
function canonicalizeErrorName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string' && name.length > 0) return name;
  }
  return 'Error';
}

/**
 * Run the TS leg of the differential harness. PR-3a entry point.
 *
 * Always uses an `async` wrapper IIFE so emitted `for await (...)` syntax
 * compiles. Sync fixtures pay no runtime cost; the wrapper resolves
 * immediately. The reference runner stays sync — async semantics in our
 * spec are observably identical to sync, so we await once at the boundary.
 *
 * Error model: ONLY the `__KernReturn`/`__KernThrow` sentinels — which are
 * caught inside the IIFE and resolved as proper [[CompletionRecord]]s —
 * count as fixture-comparable throws. Any error that escapes the IIFE
 * (emitter bug, SyntaxError from malformed emitted code, hung async,
 * unexpected runtime exception) is RE-THROWN from this function so the
 * harness records it as `leg-error`, NOT as a fixture-comparable
 * completion. The previous "swallow everything" pattern made emitter
 * regressions falsely pass.
 *
 * Timeout: a second explicit `Promise.race` deadline covers async paths
 * that `vm.runInContext`'s sync-only timeout can't see (e.g. `for await`
 * over a never-resolving iterator). A timeout escalates to `leg-error`
 * via a re-thrown TsLegTimeoutError.
 *
 * @throws TsLegError / TsLegTimeoutError when the leg itself cannot
 *         report a meaningful trace. The harness translates these into
 *         `leg-error` verdicts.
 */
export async function runTsEmitterLeg(fixture: FixtureForLeg, env: SemanticEnv): Promise<Trace> {
  const lowered = lowerFixtureToKernIR(fixture.ir);
  const handlerChildren = lowered.type === '__block' ? (lowered.children ?? []) : [lowered];
  const handlerWrapper: IRNode = {
    type: 'handler',
    props: { lang: 'kern' },
    children: handlerChildren,
  };

  const bodyCode = emitNativeKernBodyTS(handlerWrapper, {
    traceHooks: { eachIterNext: true, forIterNext: true, letAssign: shouldTraceLetAssign(fixture.ir) },
  });

  const events: TraceEvent[] = [];
  const traceSink = (e: TraceEvent) => {
    events.push(e);
  };

  // Install env.bindings FIRST so harness globals can't be shadowed by a
  // fixture that happens to bind a name like `__kernTrace`. The harness
  // globals take precedence — a collision throws loudly rather than
  // silently corrupting the trace pipeline.
  const sandbox: Record<string, unknown> = {};
  for (const [name, value] of env.bindings) {
    if ((RESERVED_SANDBOX_NAMES as readonly string[]).includes(name)) {
      throw new TsLegError(`env.bindings contains reserved harness name "${name}"`);
    }
    sandbox[name] = value;
  }
  sandbox.__kernTrace = traceSink;
  sandbox.__KernReturn = KernReturnSentinel;
  sandbox.__KernThrow = KernThrowSentinel;

  const program = [
    '(async function __kernRun() {',
    '  try {',
    bodyCode,
    `    return { kind: 'normal' };`,
    '  } catch (e) {',
    '    if (e instanceof __KernReturn) return { kind: "return", value: e.value };',
    '    if (e instanceof __KernThrow) return { kind: "throw", error: { kind: e.kind } };',
    '    throw e;',
    '  }',
    '})()',
  ].join('\n');

  const context = vm.createContext(sandbox);
  // vm.runInContext is not a security boundary — acceptable here because
  // every input is a controlled test fixture.
  const innerPromise = vm.runInContext(program, context, {
    timeout: TS_LEG_TIMEOUT_MS,
    filename: 'kern-ir-semantics-ts-leg.js',
  }) as Promise<CompletionRecord>;

  // Async-aware deadline: the vm's `timeout` only bounds synchronous
  // evaluation; once the IIFE returns its Promise, we need our own race.
  const deadline = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new TsLegTimeoutError(TS_LEG_TIMEOUT_MS)), TS_LEG_TIMEOUT_MS).unref?.();
  });
  const completion = (await Promise.race([innerPromise, deadline])) as CompletionRecord;

  // Sanity: only `kind`s the IIFE produces.
  if (
    !completion ||
    typeof completion !== 'object' ||
    (completion.kind !== 'normal' && completion.kind !== 'return' && completion.kind !== 'throw')
  ) {
    throw new TsLegError(`TS leg produced unrecognised completion shape: ${JSON.stringify(completion)}`);
  }

  return { events, completion };
}

function shouldTraceLetAssign(ir: IRNode): boolean {
  // `let` (declaration), `assign` (reassignment), and `fmt` (formatted binding)
  // observe their binding write through the same `{op:"assign"}` trace hook.
  // `while` fixtures opt in too: their counter setup/advance (let + assign in
  // body) must emit the same assign events the reference produces.
  const contract = ir.props?.__semanticContract;
  const t = ir.type;
  return (
    t === 'let' ||
    t === 'assign' ||
    t === 'fmt' ||
    contract === 'let' ||
    contract === 'assign' ||
    contract === 'fmt' ||
    contract === 'while'
  );
}

export class TsLegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TsLegError';
  }
}

export class TsLegTimeoutError extends TsLegError {
  constructor(ms: number) {
    super(`TS leg timed out after ${ms}ms`);
    this.name = 'TsLegTimeoutError';
  }
}

// Exported for tests that need it without going through the differential path.
export { canonicalizeErrorName };
