import {
  _resetCapabilityContractForTest,
  capabilityContract,
  registerCapabilityContract,
} from '../src/ir/semantics/capability.js';
import { CONTRACT_REGISTRY, makeEnv, referenceRun } from '../src/runner.js';

describe('IR semantics: capability', () => {
  beforeEach(() => {
    CONTRACT_REGISTRY.clear();
    _resetCapabilityContractForTest();
    registerCapabilityContract();
  });

  test('invokes an explicit capability provider and binds its result', () => {
    const calls: unknown[] = [];
    const env = makeEnv({
      capabilities: {
        rag: {
          retrieve(call, context) {
            calls.push({ call, context });
            return { answer: 'grounded' };
          },
        },
      },
      capabilityContext: { runId: 'run-1' },
    });

    const trace = referenceRun(
      {
        type: 'capability',
        props: { namespace: 'rag', operation: 'retrieve', name: 'result', input: '{ query: "refund" }' },
      },
      env,
    );

    expect(trace.completion).toEqual({ kind: 'normal' });
    expect(trace.events).toEqual([
      {
        op: 'capability',
        namespace: 'rag',
        operation: 'retrieve',
        input: { query: 'refund' },
        result: { answer: 'grounded' },
      },
      { op: 'assign', target: 'result', value: { answer: 'grounded' } },
    ]);
    expect(env.bindings.get('result')).toEqual({ answer: 'grounded' });
    expect(calls).toEqual([
      {
        call: { namespace: 'rag', operation: 'retrieve', input: { query: 'refund' } },
        context: { runId: 'run-1' },
      },
    ]);
  });

  test('completion is metadata-only and does not invoke host capabilities', () => {
    let calls = 0;
    const env = makeEnv({
      capabilities: {
        rag: {
          retrieve() {
            calls += 1;
            return { answer: 'grounded' };
          },
        },
      },
    });

    expect(
      capabilityContract.completion(
        { type: 'capability', props: { namespace: 'rag', operation: 'retrieve', name: 'result' } },
        env,
      ),
    ).toEqual({ kind: 'normal' });
    expect(calls).toBe(0);
  });
});
