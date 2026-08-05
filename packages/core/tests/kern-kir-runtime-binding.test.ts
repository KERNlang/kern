import { decodeCanonicalValue, encodeCanonicalValue } from '../src/canonical-value/canonical.js';
import type { CanonicalValue, CanonicalValueLimits } from '../src/canonical-value/types.js';
import { makeEnv } from '../src/ir/semantics/index.js';
import { decodeModuleKir, encodeModuleKir } from '../src/kir-structural/module-canonical.js';
import type { ModuleKirInput } from '../src/kir-structural/module-types.js';
import { inflateStructuralKirNode } from '../src/kir-structural/runtime-inflate.js';
import {
  executeInternalRuntimeKirHandlerAsync,
  executeInternalRuntimeKirHandlerSync,
  resolveInternalRuntimeKirHandler,
} from '../src/runtime-envelope/kir-handler.js';
import { encodeInternalRuntimeEnvelope } from '../src/runtime-envelope/normalize.js';
import { InternalRuntimeEnvelopeError, type InternalRuntimeEnvelopeLimits } from '../src/runtime-envelope/types.js';
import type { IRNode } from '../src/types.js';

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
  maxStringBytes: 4_096,
};
const enabled = { enabled: true, kirLimits, limits: runtimeLimits } as const;
const identity = { handlerName: 'answer', moduleId: 'app/main.kern' } as const;

function handler(body: readonly IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children: [...body] };
}

function fn(name: string, expression: string, exported = true): IRNode {
  return {
    type: 'fn',
    props: { export: exported, name, returns: 'string' },
    children: [handler([{ type: 'return', props: { value: expression } }])],
  };
}

function imported(name: string, as: string, reexport = false, kind: 'class' | 'fn' = 'fn'): IRNode {
  return { type: 'from', props: { as, export: reexport, kind, name } };
}

function use(path: string, bindings: readonly IRNode[]): IRNode {
  return { type: 'use', props: { path }, children: [...bindings] };
}

function directFixture(expression = '"ready"'): ModuleKirInput[] {
  return [{ id: identity.moduleId, roots: [fn(identity.handlerName, expression)] }];
}

function transitiveFixture(): ModuleKirInput[] {
  return [
    { id: 'lib/value.kern', roots: [fn('helper', '"reexported"')] },
    {
      id: 'lib/reexport.kern',
      roots: [use('./value', [imported('helper', 'forwarded', true)])],
    },
    {
      id: identity.moduleId,
      roots: [use('../lib/reexport', [imported('forwarded', 'alias')]), fn(identity.handlerName, 'alias()')],
    },
  ];
}

function bytes(inputs: ModuleKirInput[]): Uint8Array {
  return encodeModuleKir(inputs, kirLimits);
}

function resultText(envelope: ReturnType<typeof executeInternalRuntimeKirHandlerSync>): string | undefined {
  return envelope.result.presence === 'value' && envelope.result.value.tag === 'text'
    ? envelope.result.value.value
    : undefined;
}

function recordField(value: CanonicalValue, key: string): CanonicalValue {
  if (value.tag !== 'record') throw new Error(`expected record containing ${key}`);
  const result = value.value.find((entry) => entry.key === key)?.value;
  if (result === undefined) throw new Error(`missing ${key}`);
  return result;
}

function listItem(value: CanonicalValue, index: number): CanonicalValue {
  if (value.tag !== 'list' || value.value[index] === undefined) throw new Error(`missing list item ${index}`);
  return value.value[index];
}

describe('internal decoded Module KIR runtime binding', () => {
  test('is default-off before inspecting malformed bytes', async () => {
    const malformed = new Uint8Array([0xff]);
    expect(() => resolveInternalRuntimeKirHandler(malformed, identity)).toThrow(InternalRuntimeEnvelopeError);
    expect(() => executeInternalRuntimeKirHandlerSync(malformed, identity, [], makeEnv())).toThrow(
      InternalRuntimeEnvelopeError,
    );
    await expect(executeInternalRuntimeKirHandlerAsync(malformed, identity, [], makeEnv())).rejects.toThrow(
      InternalRuntimeEnvelopeError,
    );
  });

  test('executes only decoded bytes and changes behavior when encoded semantics change', () => {
    const firstInputs = directFixture('"first"');
    const firstBytes = bytes(firstInputs);
    const fnRoot = firstInputs[0]?.roots[0];
    const returnNode = fnRoot?.children?.[0]?.children?.[0];
    if (returnNode?.props) returnNode.props.value = '"poisoned-after-encode"';

    const first = executeInternalRuntimeKirHandlerSync(firstBytes, identity, [], makeEnv(), enabled);
    const second = executeInternalRuntimeKirHandlerSync(
      bytes(directFixture('"second"')),
      identity,
      [],
      makeEnv(),
      enabled,
    );
    expect(resultText(first)).toBe('first');
    expect(resultText(second)).toBe('second');
  });

  test('links aliased helpers through a transitive re-export from decoded metadata', async () => {
    const encoded = bytes(transitiveFixture());
    const sync = executeInternalRuntimeKirHandlerSync(encoded, identity, [], makeEnv(), enabled);
    const asyncEnvelope = await executeInternalRuntimeKirHandlerAsync(encoded, identity, [], makeEnv(), enabled);
    expect(resultText(sync)).toBe('reexported');
    expect(asyncEnvelope).toEqual(sync);
    expect(encodeInternalRuntimeEnvelope(asyncEnvelope, runtimeLimits)).toEqual(
      encodeInternalRuntimeEnvelope(sync, runtimeLimits),
    );
  });

  test('inflates structured parameters and expression precedence without semantic drift', async () => {
    const answer: IRNode = {
      type: 'fn',
      props: { export: true, name: identity.handlerName, returns: 'number' },
      children: [
        { type: 'param', props: { name: 'left', type: 'number' } },
        { type: 'param', props: { name: 'right', type: 'number' } },
        handler([{ type: 'return', props: { value: '(left + right) * 2' } }]),
      ],
    };
    const encoded = bytes([{ id: identity.moduleId, roots: [answer] }]);
    const sync = executeInternalRuntimeKirHandlerSync(encoded, identity, [3, 4], makeEnv(), enabled);
    expect(sync.result).toEqual({ presence: 'value', value: { tag: 'integer', value: '14' } });
    await expect(executeInternalRuntimeKirHandlerAsync(encoded, identity, [3, 4], makeEnv(), enabled)).resolves.toEqual(
      sync,
    );
  });

  test('round-trips every structured expression kind through deterministic runtime inflation', () => {
    const expressions = [
      'value',
      'null',
      'true',
      '42',
      '1.25',
      '"text"',
      '[1, "two"]',
      '{ answer: 42, text: "ready" }',
      'record.answer',
      'items[0]',
      'helper(1, 2)',
      'new Map()',
      'new Error("failure")',
      '(value) => value + 1',
      '(left + right) * 2',
      '!ready',
      'ready ? "yes" : "no"',
    ];
    for (const expression of expressions) {
      const original = bytes(directFixture(expression));
      const artifact = decodeModuleKir(original, kirLimits);
      const root = artifact.modules[0]?.roots[0];
      if (!root) throw new Error('expected decoded function root');
      const inflated = inflateStructuralKirNode(root);
      expect(bytes([{ id: identity.moduleId, roots: [inflated] }])).toEqual(original);
    }
  });

  test('selects an exact module and function identity without widening to classes', () => {
    const encoded = bytes(directFixture());
    expect(
      executeInternalRuntimeKirHandlerSync(
        encoded,
        { ...identity, moduleId: 'app/missing.kern' },
        [],
        makeEnv(),
        enabled,
      ),
    ).toMatchObject({ diagnostics: [{ code: 'handler-entry-not-found', phase: 'link' }] });
    expect(
      executeInternalRuntimeKirHandlerSync(encoded, { ...identity, handlerName: 'missing' }, [], makeEnv(), enabled),
    ).toMatchObject({ diagnostics: [{ code: 'handler-entry-not-found', phase: 'link' }] });

    const classBytes = bytes([
      { id: identity.moduleId, roots: [{ type: 'class', props: { export: true, name: identity.handlerName } }] },
    ]);
    expect(executeInternalRuntimeKirHandlerSync(classBytes, identity, [], makeEnv(), enabled)).toMatchObject({
      diagnostics: [{ code: 'handler-entry-unsupported', phase: 'link' }],
    });
  });

  test('rejects malformed bytes, graph drift, wrong symbol kind, and unsupported signatures before effects', async () => {
    let calls = 0;
    const host = makeEnv({
      capabilities: {
        storage: {
          get: () => {
            calls += 1;
            return 'leak';
          },
        },
      },
    });
    const malformed = bytes(directFixture());
    malformed[malformed.length - 1] ^= 1;

    const drift = structuredClone(decodeCanonicalValue(bytes(transitiveFixture()), kirLimits));
    const modules = recordField(drift, 'modules');
    const app = listItem(modules, 0);
    const imports = recordField(app, 'imports');
    const firstImport = listItem(imports, 0);
    const bindings = recordField(firstImport, 'bindings');
    const firstBinding = listItem(bindings, 0);
    const local = recordField(firstBinding, 'local');
    if (local.tag !== 'text') throw new Error('expected local alias');
    local.value = 'drifted';
    const driftBytes = encodeCanonicalValue(drift, kirLimits);

    const classBytes = bytes([
      { id: identity.moduleId, roots: [{ type: 'class', props: { export: true, name: identity.handlerName } }] },
    ]);
    const optionalBytes = bytes([
      {
        id: identity.moduleId,
        roots: [
          {
            type: 'fn',
            props: { export: true, name: identity.handlerName, returns: 'string' },
            children: [
              { type: 'param', props: { name: 'value', optional: true, type: 'string' } },
              handler([
                { type: 'capability', props: { name: 'secret', namespace: 'storage', operation: 'get' } },
                { type: 'return', props: { value: 'secret' } },
              ]),
            ],
          },
        ],
      },
    ]);

    const missingReturnBytes = bytes([
      {
        id: identity.moduleId,
        roots: [
          {
            type: 'fn',
            props: { export: true, name: identity.handlerName },
            children: [
              handler([
                { type: 'capability', props: { name: 'secret', namespace: 'storage', operation: 'get' } },
                { type: 'return', props: { value: 'secret' } },
              ]),
            ],
          },
        ],
      },
    ]);
    const missingParameterTypeBytes = bytes([
      {
        id: identity.moduleId,
        roots: [
          {
            type: 'fn',
            props: { export: true, name: identity.handlerName, returns: 'string' },
            children: [
              { type: 'param', props: { name: 'value' } },
              handler([
                { type: 'capability', props: { name: 'secret', namespace: 'storage', operation: 'get' } },
                { type: 'return', props: { value: 'secret' } },
              ]),
            ],
          },
        ],
      },
    ]);

    for (const [encoded, code, args] of [
      [malformed, 'handler-link-error', ['x']],
      [driftBytes, 'handler-link-error', ['x']],
      [classBytes, 'handler-entry-unsupported', ['x']],
      [optionalBytes, 'handler-entry-unsupported', ['x']],
      [missingReturnBytes, 'handler-entry-unsupported', []],
      [missingParameterTypeBytes, 'handler-entry-unsupported', ['x']],
    ] as const) {
      const sync = executeInternalRuntimeKirHandlerSync(encoded, identity, args, host, enabled);
      expect(sync).toMatchObject({
        diagnostics: [{ code, phase: 'link' }],
        events: [],
        outcome: 'failure',
        result: { presence: 'absent' },
      });
      await expect(executeInternalRuntimeKirHandlerAsync(encoded, identity, args, host, enabled)).resolves.toEqual(
        sync,
      );
    }
    expect(calls).toBe(0);
  });
});
