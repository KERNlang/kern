import { makeEnv } from '../src/ir/semantics/index.js';
import type { SemanticEnv } from '../src/ir/semantics/semantic-env.js';
import type { IRNode } from '../src/types.js';

export function buildBranchQuotedPathFixture() {
  const body = (on: string): IRNode[] => [
    { type: 'let', props: { name: 'paid', value: '"binding-value"' } },
    {
      type: 'branch',
      props: { name: 'route', on },
      children: [
        { type: 'path', props: { value: 'paid' }, children: [{ type: 'return', props: { value: '1' } }] },
        {
          type: 'path',
          props: { value: 'paid' },
          __quotedProps: ['value'],
          children: [{ type: 'return', props: { value: '7' } }],
        },
        { type: 'path', props: { default: true }, children: [{ type: 'return', props: { value: '9' } }] },
      ],
    },
  ];
  const host = (): SemanticEnv => makeEnv();
  return {
    asyncHost: host(),
    body: body('"paid"'),
    controlBody: body('"missing"'),
    fixtureId: 'branch-quoted-path-seven' as const,
    oracleId: 'exact-branch-result' as const,
    returns: 'number' as const,
    runnerId: 'branch' as const,
    semanticEnvelopeId: 'quoted-path-seven' as const,
    syncHost: host(),
  };
}

export function buildCapabilityStorageGetFixture() {
  return {
    asyncHost: makeEnv({ capabilities: { storage: { get: () => 'secret' } } }),
    body: [
      { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
      { type: 'return', props: { value: 'answer' } },
    ] satisfies IRNode[],
    controlBody: [
      { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
      { type: 'return', props: { value: '"changed"' } },
    ] satisfies IRNode[],
    fixtureId: 'capability-storage-get' as const,
    oracleId: 'exact-capability-event-and-result' as const,
    returns: 'string' as const,
    runnerId: 'capability' as const,
    semanticEnvelopeId: 'storage-get-secret' as const,
    syncHost: makeEnv({ capabilities: { storage: { get: () => 'secret' } } }),
  };
}
