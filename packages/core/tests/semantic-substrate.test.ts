import {
  buildKernSemanticSubstrate,
  lookupSemanticPrimitive,
  makeEnv,
  type NodeContract,
  semanticPrimitiveSupportSummary,
} from '../src/index.js';

describe('KERN semantic substrate', () => {
  test('exports core runtime contracts as reviewable semantic operations', () => {
    const substrate = buildKernSemanticSubstrate();

    expect(substrate.schemaVersion).toBe(1);
    expect(substrate.generatedBy).toBe('kern-semantic-substrate');
    expect(substrate.source).toBe('codegen-from-ts');

    const numberType = substrate.coreTypes.find((type) => type.name === 'Number');
    expect(numberType?.strict).toBe(true);
    expect(numberType?.operations.map((operation) => operation.id)).toContain('Number.divide');

    const divide = numberType?.operations.find((operation) => operation.id === 'Number.divide');
    expect(divide?.args).toEqual(['Number', 'Number']);
    expect(divide?.returns).toEqual(['Number']);
    expect(divide?.fixtureCount).toBeGreaterThan(0);
    expect(divide?.reviewTags).toContain('strict');

    expect(
      substrate.coreGraphEdges.find(
        (edge) =>
          edge.from === 'Number.divide' &&
          edge.relation === 'returns' &&
          edge.to === 'Number' &&
          edge.operation === 'Number.divide',
      ),
    ).toEqual(
      expect.objectContaining({
        from: 'Number.divide',
        relation: 'returns',
        to: 'Number',
        operation: 'Number.divide',
      }),
    );
  });

  test('exports portable review primitives as stable query objects', () => {
    const substrate = buildKernSemanticSubstrate();
    const clamp = lookupSemanticPrimitive(substrate, 'number.clamp');

    expect(clamp.kernName).toBe('clamp');
    expect(clamp.domain).toBe('number');
    expect(clamp.support.ts).toBe('stable');
    expect(clamp.support.python).toBe('stable');
    expect(semanticPrimitiveSupportSummary(clamp, ['ts', 'python', 'go'])).toBe('stable: ts, python; unsupported: go');
  });

  test('throws when a review consumer asks for an unknown semantic primitive', () => {
    const substrate = buildKernSemanticSubstrate();

    expect(() => lookupSemanticPrimitive(substrate, 'number.missing' as never)).toThrow(
      "KERN semantic substrate missing portable primitive 'number.missing'.",
    );
  });

  test('exports stdlib operation summaries for downstream review/doc consumers', () => {
    const substrate = buildKernSemanticSubstrate();

    expect(substrate.stdlibOperations.find((operation) => operation.id === 'stdlib.Text.trim')).toEqual(
      expect.objectContaining({
        module: 'Text',
        method: 'trim',
        arity: 1,
      }),
    );
    expect(substrate.stdlibOperations.find((operation) => operation.id === 'stdlib.Json.stringify')).toEqual(
      expect.objectContaining({
        module: 'Json',
        method: 'stringify',
      }),
    );
  });

  test('can include IR semantic contract summaries without touching the global registry', () => {
    const fakeContract: NodeContract = {
      nodeType: 'fixtureNode',
      preconditions: () => true,
      effects: () => ({ events: [], completion: { kind: 'normal' } }),
      completion: () => ({ kind: 'normal' }),
      forbiddenRewrites: ['erase fixture node'],
      fixtures: [
        {
          description: 'fixture node completes normally',
          ir: { type: 'fixtureNode', props: {} },
          env: makeEnv(),
          expected: { events: [], completion: { kind: 'normal' } },
        },
      ],
    };

    const substrate = buildKernSemanticSubstrate({
      irContracts: new Map([[fakeContract.nodeType, fakeContract]]),
    });

    expect(substrate.irContracts).toEqual([
      {
        nodeType: 'fixtureNode',
        forbiddenRewrites: ['erase fixture node'],
        fixtureCount: 1,
      },
    ]);
  });
});
