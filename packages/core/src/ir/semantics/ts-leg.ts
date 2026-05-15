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
import type { SemanticEnv } from './index.js';
import type { CanonicalError, CompletionRecord, Trace, TraceEvent } from './trace.js';

interface FixtureForLeg {
  ir: IRNode;
}

/**
 * Translate fixture-only primitives into KERN-native IR the production
 * codegen can lower. Pure: returns a new tree, never mutates `node`.
 *
 *   - `__trace {event:E}` → `do value="__kernTrace(<JSON(E)>)"`
 *   - `return {value:V}`  → `throw value="new __KernReturn(<JSON(V)>)"`
 *   - `throw  {errorKind:K}` → `throw value="new __KernThrow(<JSON(K)>)"`
 *
 * `break` and `continue` pass through (real KERN body-stmts).
 */
export function lowerFixtureToKernIR(node: IRNode): IRNode {
  if (node.type === '__trace') {
    const event = node.props?.event;
    return {
      type: 'do',
      props: { value: `__kernTrace(${JSON.stringify(event)})` },
    };
  }
  if (node.type === 'return') {
    const value = node.props?.value;
    return {
      type: 'throw',
      props: { value: `new __KernReturn(${JSON.stringify(value)})` },
    };
  }
  if (node.type === 'throw') {
    const errorKind = node.props?.errorKind;
    return {
      type: 'throw',
      props: { value: `new __KernThrow(${JSON.stringify(errorKind)})` },
    };
  }
  if (Array.isArray(node.children) && node.children.length > 0) {
    return { ...node, children: node.children.map(lowerFixtureToKernIR) };
  }
  return node;
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

/**
 * Run the TS leg of the differential harness. PR-3a entry point.
 *
 * Always uses an `async` wrapper IIFE so emitted `for await (...)` syntax
 * compiles. Sync fixtures pay no runtime cost; the wrapper resolves
 * immediately. The reference runner stays sync — async semantics in our
 * spec are observably identical to sync, so we await once at the boundary
 * and compare.
 *
 * @throws never — runtime errors are caught and surfaced as a `throw`
 *         completion so the harness sees a comparable trace rather than
 *         a `leg-error` for what is really an expected divergence.
 */
export async function runTsEmitterLeg(fixture: FixtureForLeg, env: SemanticEnv): Promise<Trace> {
  const lowered = lowerFixtureToKernIR(fixture.ir);
  const handlerWrapper: IRNode = {
    type: 'handler',
    props: { lang: 'kern' },
    children: [lowered],
  };

  const bodyCode = emitNativeKernBodyTS(handlerWrapper, {
    traceHooks: { eachIterNext: true },
  });

  const events: TraceEvent[] = [];
  const traceSink = (e: TraceEvent) => {
    events.push(e);
  };

  const sandbox: Record<string, unknown> = {
    __kernTrace: traceSink,
    __KernReturn: KernReturnSentinel,
    __KernThrow: KernThrowSentinel,
  };
  for (const [name, value] of env.bindings) {
    sandbox[name] = value;
  }

  // Async IIFE so `for await` compiles; sync fixtures still work.
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
  let completion: CompletionRecord;
  try {
    const result = vm.runInContext(program, context, {
      timeout: 5000,
      filename: 'kern-ir-semantics-ts-leg.js',
    }) as Promise<CompletionRecord>;
    completion = await result;
  } catch (err) {
    const canonical: CanonicalError = {
      kind: err instanceof Error ? err.name : 'Error',
    };
    return {
      events,
      completion: { kind: 'throw', error: canonical },
    };
  }

  return { events, completion };
}
