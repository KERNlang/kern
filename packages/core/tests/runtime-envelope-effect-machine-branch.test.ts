import { makeEnv } from '../src/ir/semantics/index.js';
import { runInternalEffectMachineSync } from '../src/ir/semantics/internal-effect-machine.js';
import { registerAllContracts } from '../src/ir/semantics/register-all.js';
import { executeInternalRuntimeEnvelopeSync } from '../src/runtime-envelope/execute.js';
import type { InternalRuntimeEnvelopeLimits } from '../src/runtime-envelope/types.js';
import type { IRNode } from '../src/types.js';

const limits: InternalRuntimeEnvelopeLimits = {
  maxBytes: 65_536,
  maxCollectionLength: 64,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxStringBytes: 4_096,
};
const enabled = { enabled: true, limits } as const;

describe('private effect-machine structural preflight', () => {
  beforeAll(() => registerAllContracts());

  test('capability results remain available to later pure branch formatting', () => {
    const nodes: IRNode[] = [
      {
        type: 'branch',
        props: { on: '"selected"' },
        children: [
          {
            type: 'path',
            props: { value: 'selected' },
            __quotedProps: ['value'],
            children: [
              {
                type: 'capability',
                props: { name: 'answer', namespace: 'llm', operation: 'complete' },
              },
              { type: 'fmt', props: { name: 'message', template: 'value=${answer}' } },
              { type: 'return', props: { value: 'message' } },
            ],
          },
        ],
      },
    ];
    expect(
      runInternalEffectMachineSync(nodes, makeEnv({ capabilities: { llm: { complete: () => 'dynamic' } } })),
    ).toMatchObject({ completion: { kind: 'return', value: 'value=dynamic' } });
  });

  test('selected if frames reject later unsupported nodes before capability dispatch', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      {
        type: 'if',
        props: { cond: 'true' },
        children: [
          { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
          { type: 'while', children: [] },
        ],
      },
    ];
    const envelope = executeInternalRuntimeEnvelopeSync(
      nodes,
      makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } }),
      enabled,
    );
    expect(envelope).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('malformed nested branch values reject before capability dispatch', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      {
        type: 'if',
        props: { cond: 'true' },
        children: [
          { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
          {
            type: 'branch',
            props: { on: '"selected"' },
            children: [{ type: 'path', props: { value: 'not + portable' }, children: [] }],
          },
        ],
      },
    ];
    expect(
      executeInternalRuntimeEnvelopeSync(
        nodes,
        makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } }),
        enabled,
      ),
    ).toMatchObject({ diagnostics: [{ code: 'unsupported-runtime-input' }], outcome: 'failure' });
    expect(calls).toBe(0);
  });
});
