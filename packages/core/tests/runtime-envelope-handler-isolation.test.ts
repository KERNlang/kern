import { makeEnv } from '../src/ir/semantics/semantic-env.js';
import {
  executeInternalRuntimeHandlerAsync,
  executeInternalRuntimeHandlerSync,
  type InternalRuntimeHandlerEntry,
} from '../src/runtime-envelope/handler-entry.js';
import {
  executeInternalRuntimeSourceHandlerAsync,
  executeInternalRuntimeSourceHandlerSync,
} from '../src/runtime-envelope/source-handler.js';
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
const identity = { handlerName: 'answer', sourcePath: 'app/main.kern' } as const;

function expectUnsupported(envelope: Awaited<ReturnType<typeof executeInternalRuntimeHandlerAsync>>): void {
  expect(envelope).toMatchObject({
    diagnostics: [{ code: 'unsupported-runtime-input' }],
    events: [],
    outcome: 'failure',
    result: { presence: 'absent' },
  });
}

describe('M3.16 machine-only handler roots', () => {
  test('handler whole-tree preflight rejects before an earlier capability', async () => {
    let calls = 0;
    const body: readonly IRNode[] = [
      { type: 'capability', props: { name: 'answer', namespace: 'storage', operation: 'get' } },
      { type: 'do', props: { value: '1 + 1' } },
    ];
    const entry: InternalRuntimeHandlerEntry = { body, parameters: [] };
    const host = makeEnv({
      bindings: new Map([['hostOnly', 7]]),
      capabilities: { storage: { get: () => (calls += 1) } },
    });
    const before = [...host.bindings];

    const sync = executeInternalRuntimeHandlerSync(entry, [], host, enabled);
    expectUnsupported(sync);
    expect(calls).toBe(0);
    expect([...host.bindings]).toEqual(before);

    const asyncEnvelope = await executeInternalRuntimeHandlerAsync(entry, [], host, enabled, {
      asyncCapabilities: { storage: { get: async () => (calls += 1) } },
    });
    expect(asyncEnvelope).toEqual(sync);
    expect(calls).toBe(0);
    expect([...host.bindings]).toEqual(before);
  });

  test('source link completes but machine preflight rejects before an earlier assignment effect', async () => {
    const source = [
      'fn name=answer returns=number',
      '  handler lang="kern"',
      '    let name=before value="1"',
      '    do value="1 + 1"',
      '    return value="1"',
    ].join('\n');
    const host = makeEnv();

    const sync = executeInternalRuntimeSourceHandlerSync(source, identity, [], host, enabled);
    expectUnsupported(sync);

    const asyncEnvelope = await executeInternalRuntimeSourceHandlerAsync(source, identity, [], host, enabled);
    expect(asyncEnvelope).toEqual(sync);
  });
});
