import type { CanonicalValueLimits } from '../src/canonical-value/types.js';
import { encodeModuleKir } from '../src/kir-structural/module-canonical.js';
import type { ModuleKirInput } from '../src/kir-structural/module-types.js';
import {
  executeInternalRuntimeKirHandlerAsync,
  executeInternalRuntimeKirHandlerSync,
} from '../src/runtime-envelope/kir-handler.js';
import { encodeInternalRuntimeEnvelope } from '../src/runtime-envelope/normalize.js';
import type { InternalRuntimeEnvelopeLimits } from '../src/runtime-envelope/types.js';
import type { IRNode } from '../src/types.js';
import {
  buildComposedRunnerFixture,
  COMPOSED_RUNNER_ORACLES,
  COMPOSED_RUNNER_WITNESSES,
} from './kern-kir-runner-composed-fixtures.js';

const kirLimits: CanonicalValueLimits = {
  maxBytes: 262_144,
  maxDepth: 64,
  maxNodes: 4_096,
  maxStringBytes: 8_192,
  maxCollectionLength: 1_024,
  maxRecordFields: 512,
  maxMapEntries: 64,
  maxIntegerDigits: 256,
  maxFractionDigits: 256,
  maxDecimalChars: 520,
};
const runtimeLimits: InternalRuntimeEnvelopeLimits = {
  maxBytes: 65_536,
  maxCollectionLength: 64,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxIterations: 64,
  maxStringBytes: 4_096,
};
const enabled = { enabled: true, kirLimits, limits: runtimeLimits } as const;
const identity = { handlerName: 'answer', moduleId: 'app/main.kern' } as const;

function handler(body: readonly IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children: [...body] };
}

function moduleFixture(body: readonly IRNode[], returns: 'number' | 'string'): ModuleKirInput[] {
  return [
    {
      id: identity.moduleId,
      roots: [
        {
          type: 'fn',
          props: { export: true, name: identity.handlerName, returns },
          children: [handler(body)],
        },
      ],
    },
  ];
}

function countNodeType(nodes: readonly IRNode[], type: string): number {
  return nodes.reduce(
    (count, node) => count + (node.type === type ? 1 : 0) + countNodeType(node.children ?? [], type),
    0,
  );
}

describe('internal composed runner KIR evidence', () => {
  test.each(COMPOSED_RUNNER_WITNESSES)('$id has exact sync and async semantic envelopes', async (witness) => {
    const fixture = buildComposedRunnerFixture(witness);
    const expected = COMPOSED_RUNNER_ORACLES[witness.oracleId];
    expect(fixture.runnerId).toBe(witness.id);
    expect(fixture.fixtureId).toBe(witness.fixtureId);
    expect(fixture.semanticEnvelopeId).toBe(witness.semanticEnvelopeId);
    expect(fixture.oracleId).toBe(witness.oracleId);
    expect(countNodeType(fixture.body, witness.id)).toBeGreaterThan(0);

    const encoded = encodeModuleKir(moduleFixture(fixture.body, fixture.returns), kirLimits);

    const sync = executeInternalRuntimeKirHandlerSync(encoded, identity, [], fixture.syncHost, enabled);
    const asyncEnvelope = await executeInternalRuntimeKirHandlerAsync(
      encoded,
      identity,
      [],
      fixture.asyncHost,
      enabled,
      fixture.asyncOptions,
    );

    expect(sync).toEqual(expected);
    expect(asyncEnvelope).toEqual(expected);
    expect(encodeInternalRuntimeEnvelope(asyncEnvelope, runtimeLimits)).toEqual(
      encodeInternalRuntimeEnvelope(sync, runtimeLimits),
    );

    const controlEncoded = encodeModuleKir(moduleFixture(fixture.controlBody, fixture.returns), kirLimits);
    const controlSync = executeInternalRuntimeKirHandlerSync(controlEncoded, identity, [], fixture.syncHost, enabled);
    const controlAsync = await executeInternalRuntimeKirHandlerAsync(
      controlEncoded,
      identity,
      [],
      fixture.asyncHost,
      enabled,
      fixture.asyncOptions,
    );
    expect(controlSync).toEqual(controlAsync);
    expect(controlSync).not.toEqual(expected);
  });
});
