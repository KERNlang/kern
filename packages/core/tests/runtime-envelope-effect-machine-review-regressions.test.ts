import { CONTRACT_REGISTRY, makeEnv } from '../src/ir/semantics/index.js';
import {
  InternalEffectMachineError,
  isInternalEffectMachineEligible,
  runInternalEffectMachineSync,
} from '../src/ir/semantics/internal-effect-machine.js';
import { registerAllContracts, resetAllContractRegistration } from '../src/ir/semantics/register-all.js';
import { executeInternalRuntimeEnvelopeSync } from '../src/runtime-envelope/execute.js';
import { executeInternalRuntimeEnvelopeCompatSync } from '../src/runtime-envelope/execute-compat.js';
import type { InternalRuntimeEnvelopeLimits } from '../src/runtime-envelope/types.js';
import type { IRNode } from '../src/types.js';

const limits: InternalRuntimeEnvelopeLimits = {
  maxBytes: 65_536,
  maxCollectionLength: 64,
  maxDepth: 16,
  maxDiagnostics: 8,
  maxEvents: 64,
  maxIterations: 64,
  maxStringBytes: 4_096,
};
const enabled = { enabled: true, limits } as const;
const machineOptions = { iterationBudget: limits.maxIterations } as const;

function restoreRegistry(): void {
  CONTRACT_REGISTRY.clear();
  resetAllContractRegistration();
  registerAllContracts();
}

describe('M3.15 PR review regressions', () => {
  afterEach(restoreRegistry);

  test.each([
    { type: 'let', props: { name: 'value', value: 'item' } },
    { type: 'fmt', props: { name: 'value', template: '${item}' } },
  ] satisfies IRNode[])('reserves a deferred $type declaration before provider dispatch', (producer) => {
    let calls = 0;
    const nodes: IRNode[] = [
      {
        type: 'each',
        props: { in: 'items', name: 'item' },
        children: [
          producer,
          { type: 'capability', props: { namespace: 'storage', operation: 'get' } },
          { type: 'let', props: { name: 'value', value: '2' } },
        ],
      },
    ];
    const env = makeEnv({
      bindings: new Map([['items', [1]]]),
      capabilities: { storage: { get: () => (calls += 1) } },
    });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test.each(['(m + late) || 1', '(m + late) ? 1 : 2'])(
    'validates the definitely evaluated subtree of deferred expression %s before dispatch',
    (value) => {
      let calls = 0;
      const nodes: IRNode[] = [
        { type: 'capability', props: { name: 'late', namespace: 'storage', operation: 'get' } },
        { type: 'return', props: { value } },
      ];
      const env = makeEnv({
        bindings: new Map([['m', new Map([['key', 1]])]]),
        capabilities: { storage: { get: () => (calls += 1) } },
      });

      expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
      expect(calls).toBe(0);
    },
  );

  test.each(['[m + late]', '{ value: [m + late] }'])(
    'validates deferred bindings nested in leaf composite %s before dispatch',
    (value) => {
      let calls = 0;
      const nodes: IRNode[] = [
        { type: 'capability', props: { name: 'late', namespace: 'storage', operation: 'get' } },
        { type: 'let', props: { name: 'result', value } },
      ];
      const env = makeEnv({
        bindings: new Map([['m', new Map([['key', 1]])]]),
        capabilities: { storage: { get: () => (calls += 1) } },
      });

      expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        events: [],
        outcome: 'failure',
      });
      expect(calls).toBe(0);
    },
  );

  test('treats undefined as nullish while preflighting a deferred right operand', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'capability', props: { name: 'late', namespace: 'storage', operation: 'get' } },
      { type: 'return', props: { value: 'unset ?? (m + late)' } },
    ];
    const env = makeEnv({
      bindings: new Map<string, unknown>([
        ['m', new Map([['key', 1]])],
        ['unset', undefined],
      ]),
      capabilities: { storage: { get: () => (calls += 1) } },
    });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('applies Decimal operation guards before a deferred provider dispatch', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'capability', props: { name: 'late', namespace: 'storage', operation: 'get' } },
      {
        type: 'return',
        props: { value: 'Decimal.eq(Decimal.div(late, Decimal.of("0")), Decimal.of("1"))' },
      },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1) } } });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test('rejects deferred capability record spreads before dispatch', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      { type: 'capability', props: { name: 'late', namespace: 'storage', operation: 'get' } },
      {
        type: 'capability',
        props: { input: '{ ...late }', namespace: 'storage', operation: 'set' },
      },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => (calls += 1), set: () => undefined } } });

    expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      events: [],
      outcome: 'failure',
    });
    expect(calls).toBe(0);
  });

  test.each([
    {
      nodes: [
        { type: 'return', props: { value: '1' } },
        { type: 'print', props: { value: 'missing' } },
      ],
    },
    {
      nodes: [
        { type: 'throw', props: { value: 'new Error("boom")' } },
        { type: 'print', props: { value: 'missing' } },
      ],
    },
    {
      nodes: [
        {
          type: 'for',
          props: { from: '0', name: 'i', to: '1' },
          children: [{ type: 'break' }, { type: 'print', props: { value: 'missing' } }],
        },
      ],
    },
    {
      nodes: [
        {
          type: 'for',
          props: { from: '0', name: 'i', to: '1' },
          children: [{ type: 'continue' }, { type: 'print', props: { value: 'missing' } }],
        },
      ],
    },
  ] satisfies { nodes: IRNode[] }[])(
    'does not value-evaluate siblings after an unconditional completion',
    ({ nodes }) => {
      expect(() => runInternalEffectMachineSync(nodes, makeEnv(), machineOptions)).not.toThrow();
    },
  );

  test('still shape-validates unreachable siblings', () => {
    const nodes: IRNode[] = [{ type: 'return', props: { value: '1' } }, { type: 'expression-v1' }];
    expect(() => runInternalEffectMachineSync(nodes, makeEnv(), machineOptions)).toThrow(InternalEffectMachineError);
  });

  test.each([
    {
      env: makeEnv(),
      frame: {
        type: 'branch',
        props: { on: '"selected"' },
        children: [
          {
            type: 'path',
            props: { value: 'selected' },
            __quotedProps: ['value'],
            children: [{ type: 'return', props: { value: '1' } }],
          },
        ],
      } satisfies IRNode,
      label: 'known branch',
    },
    {
      env: makeEnv(),
      frame: {
        type: 'for',
        props: { from: '0', name: 'i', to: '1' },
        children: [{ type: 'return', props: { value: '1' } }],
      } satisfies IRNode,
      label: 'known non-empty for',
    },
    {
      env: makeEnv({ bindings: new Map([['items', [1]]]) }),
      frame: {
        type: 'each',
        props: { in: 'items', name: 'item' },
        children: [{ type: 'return', props: { value: '1' } }],
      } satisfies IRNode,
      label: 'known non-empty each',
    },
    {
      env: makeEnv(),
      frame: {
        type: 'while',
        props: { cond: 'true' },
        children: [{ type: 'return', props: { value: '1' } }],
      } satisfies IRNode,
      label: 'known true while',
    },
  ])('does not value-evaluate a sibling after a $label completion', ({ env, frame }) => {
    const nodes: IRNode[] = [frame, { type: 'print', props: { value: 'missing' } }];
    expect(() => runInternalEffectMachineSync(nodes, env, machineOptions)).not.toThrow();
  });

  test('clones dense arrays without invoking inherited numeric setters', () => {
    const index = 777;
    const source = Array.from({ length: index + 1 }, (_, item) => item);
    let setterCalls = 0;
    Object.defineProperty(Array.prototype, String(index), {
      configurable: true,
      set() {
        setterCalls += 1;
      },
    });
    try {
      const env = makeEnv({ bindings: new Map([['items', source]]) });
      const cloned = env.bindings.get('items') as unknown[];
      expect(setterCalls).toBe(0);
      expect(Object.hasOwn(cloned, index)).toBe(true);
      expect(cloned[index]).toBe(index);
    } finally {
      delete Array.prototype[index];
    }
  });

  test('compat preserves bounded machine selection without weakening direct ownership', () => {
    CONTRACT_REGISTRY.clear();
    resetAllContractRegistration();
    const nodes: IRNode[] = [
      {
        type: 'each',
        props: { in: 'items', name: 'item' },
        children: [{ type: 'print', props: { value: 'item' } }],
      },
    ];
    const directEnv = makeEnv();
    directEnv.bindings.set('items', [1, 2]);
    expect(executeInternalRuntimeEnvelopeSync(nodes, directEnv, enabled)).toMatchObject({
      diagnostics: [{ code: 'unsupported-runtime-input' }],
      outcome: 'failure',
    });

    const compatEnv = makeEnv();
    compatEnv.bindings.set('items', [1, 2]);
    expect(executeInternalRuntimeEnvelopeCompatSync(nodes, compatEnv, enabled)).toMatchObject({
      events: [
        { op: 'stdout', text: '1' },
        { op: 'stdout', text: '2' },
      ],
      outcome: 'success',
    });
    expect(CONTRACT_REGISTRY.size).toBe(0);
  });

  test.each([{ runnerSuperClass: 'HostBase' }, { runnerProtectedClassInstances: new WeakSet() }])(
    'rejects class call-frame metadata at a machine root',
    (metadata) => {
      const nodes: IRNode[] = [{ type: 'return', props: { value: '1' } }];
      const env = makeEnv(metadata);
      expect(isInternalEffectMachineEligible(nodes, env)).toBe(false);
      expect(executeInternalRuntimeEnvelopeSync(nodes, env, enabled)).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        outcome: 'failure',
      });
    },
  );

  test.each([Symbol.iterator, 'values'] as const)('rejects a poisoned Map.prototype %s without invoking it', (key) => {
    const original = Object.getOwnPropertyDescriptor(Map.prototype, key);
    if (!original || !('value' in original)) throw new Error('expected a Map prototype data method');
    const env = makeEnv();
    let touches = 0;
    Object.defineProperty(Map.prototype, key, {
      configurable: original.configurable,
      enumerable: original.enumerable,
      get() {
        touches += 1;
        return original.value;
      },
    });
    try {
      expect(
        executeInternalRuntimeEnvelopeSync([{ type: 'return', props: { value: '1' } }], env, enabled),
      ).toMatchObject({
        diagnostics: [{ code: 'unsupported-runtime-input' }],
        outcome: 'failure',
      });
      expect(touches).toBe(0);
    } finally {
      Object.defineProperty(Map.prototype, key, original);
    }
  });

  test('raw machine leaf failures retain the original cause', () => {
    const nodes: IRNode[] = [
      { type: 'capability', props: { name: 'late', namespace: 'storage', operation: 'get' } },
      { type: 'print', props: { value: 'late' } },
    ];
    const env = makeEnv({ capabilities: { storage: { get: () => [1] } } });
    try {
      runInternalEffectMachineSync(nodes, env, machineOptions);
      throw new Error('expected the machine to reject a deferred composite print value');
    } catch (error) {
      expect(error).toBeInstanceOf(InternalEffectMachineError);
      expect((error as Error).cause).toBeInstanceOf(Error);
    }
  });

  test('checks each budget before a second body effect', () => {
    let calls = 0;
    const nodes: IRNode[] = [
      {
        type: 'each',
        props: { in: 'items', name: 'item' },
        children: [{ type: 'capability', props: { namespace: 'storage', operation: 'get' } }],
      },
    ];
    const env = makeEnv({
      bindings: new Map([['items', [1, 2]]]),
      capabilities: { storage: { get: () => (calls += 1) } },
    });
    expect(() => runInternalEffectMachineSync(nodes, env, { iterationBudget: 1 })).toThrow(/budget exhausted/u);
    expect(calls).toBe(1);
  });
});
