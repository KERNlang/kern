import {
  buildKernSemanticSubstrate,
  collectClassSemanticFacts,
  lookupSemanticPrimitive,
  makeEnv,
  type NodeContract,
  semanticPrimitiveSupportSummary,
} from '../src/index.js';
import { parseDocumentWithDiagnostics } from '../src/parser.js';

function parseRoot(source: string) {
  return parseDocumentWithDiagnostics(source).root;
}

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

  test('keeps document class facts opt-in for existing review consumers', () => {
    const substrate = buildKernSemanticSubstrate();

    expect(Object.keys(substrate)).toEqual([
      'schemaVersion',
      'generatedBy',
      'source',
      'coreTypes',
      'coreGraphEdges',
      'portablePrimitives',
      'stdlibOperations',
      'irContracts',
    ]);
    expect(Object.hasOwn(substrate, 'classFacts')).toBe(false);
    expect(Object.hasOwn(substrate, 'classValidationSummary')).toBe(false);
  });

  test('exports document class member inheritance and override facts when requested', () => {
    const root = parseRoot(
      [
        'class name=Base',
        '  field name=id type=string',
        '  method name=load returns=string',
        '    param name=id type=string',
        '  getter name=label returns=string',
        'class name=Derived extends=Base',
        '  constructor',
        '    handler lang=kern',
        '      do value="super()"',
        '  method name=load returns=string',
        '    param name=id type=string',
        '    param name=extra type=string',
        '  field name=count type=number static=true',
        '  setter name=label',
        '    param name=value type=string',
      ].join('\n'),
    );

    const substrate = buildKernSemanticSubstrate({ documentClasses: root });

    expect(substrate.classFacts?.inheritanceEdges).toEqual([
      { from: 'Derived', to: 'Base', relation: 'extends', resolved: true, builtin: false },
    ]);
    expect(substrate.classFacts?.unresolvedBases).toEqual([]);

    const derived = substrate.classFacts?.classes.find((candidate) => candidate.name === 'Derived');
    expect(derived).toEqual(
      expect.objectContaining({
        name: 'Derived',
        baseName: 'Base',
        hasConstructor: true,
        constructorCount: 1,
      }),
    );
    expect(derived?.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          owner: 'Derived',
          name: 'count',
          kind: 'field',
          static: true,
          arity: 0,
          readable: true,
          writable: true,
        }),
        expect.objectContaining({
          owner: 'Derived',
          name: 'label',
          kind: 'setter',
          static: false,
          arity: 1,
          readable: false,
          writable: true,
        }),
      ]),
    );

    expect(substrate.classFacts?.overrides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          className: 'Derived',
          memberName: 'load',
          baseClassName: 'Base',
          baseKind: 'method',
          kind: 'method',
          arity: 2,
          baseArity: 1,
          status: 'arity-mismatch',
        }),
        expect.objectContaining({
          className: 'Derived',
          memberName: 'label',
          baseClassName: 'Base',
          baseKind: 'getter',
          kind: 'setter',
          status: 'compatible',
        }),
      ]),
    );
  });

  test('reports unresolved bases and inheritance cycles as class facts', () => {
    const facts = collectClassSemanticFacts(
      parseRoot(
        ['class name=UsesExternal extends=ExternalBase', 'class name=A extends=B', 'class name=B extends=A'].join('\n'),
      ),
    );

    expect(facts.unresolvedBases).toEqual(['ExternalBase']);
    expect(facts.inheritanceEdges).toEqual(
      expect.arrayContaining([
        { from: 'UsesExternal', to: 'ExternalBase', relation: 'extends', resolved: false, builtin: false },
        { from: 'A', to: 'B', relation: 'extends', resolved: true, builtin: false },
      ]),
    );
    expect(facts.cycles).toEqual([['A', 'B', 'A']]);
  });

  test('resolves imported and cross-root class bases consistently with validation', () => {
    const importedFacts = collectClassSemanticFacts(
      parseRoot(['import from="./base" names=ExternalBase', 'class name=UsesExternal extends=ExternalBase'].join('\n')),
    );
    expect(importedFacts.unresolvedBases).toEqual([]);
    expect(importedFacts.inheritanceEdges).toEqual([
      { from: 'UsesExternal', to: 'ExternalBase', relation: 'extends', resolved: true, builtin: false },
    ]);

    const importedElsewhere = collectClassSemanticFacts([
      parseRoot('import from="./base" names=ExternalBase'),
      parseRoot('class name=Leaky extends=ExternalBase'),
    ]);
    expect(importedElsewhere.unresolvedBases).toEqual(['ExternalBase']);
    expect(importedElsewhere.inheritanceEdges).toEqual([
      { from: 'Leaky', to: 'ExternalBase', relation: 'extends', resolved: false, builtin: false },
    ]);

    const baseRoot = parseRoot('class name=Base');
    const childRoot = parseRoot('class name=Child extends=Base');
    const substrate = buildKernSemanticSubstrate({
      documentClasses: [baseRoot, childRoot],
      includeClassValidationSummary: true,
    });

    expect(substrate.classFacts?.inheritanceEdges).toEqual([
      { from: 'Child', to: 'Base', relation: 'extends', resolved: true, builtin: false },
    ]);
    expect(substrate.classValidationSummary?.byRule['class-extends-unknown']).toBeUndefined();

    const invalidSubstrate = buildKernSemanticSubstrate({
      documentClasses: [baseRoot, parseRoot('class name=Broken extends=Missing')],
      includeClassValidationSummary: true,
    });
    expect(invalidSubstrate.classValidationSummary?.byRule['class-extends-unknown']).toBe(1);
  });

  test('can summarize class validation rules alongside class facts', () => {
    const root = parseRoot(
      [
        'class name=Base',
        'class name=Bad extends=Base',
        '  constructor',
        '    handler lang=kern',
        '      do value="super()"',
        '  constructor',
        '    handler lang=kern',
        '      do value="super()"',
        'machine name=Flow',
        '  transition name=go from=Missing to=Missing',
      ].join('\n'),
    );

    const substrate = buildKernSemanticSubstrate({
      documentClasses: root,
      includeClassValidationSummary: true,
    });

    expect(substrate.classFacts?.classes.find((candidate) => candidate.name === 'Bad')?.constructorCount).toBe(2);
    expect(substrate.classValidationSummary?.total).toBeGreaterThan(0);
    expect(substrate.classValidationSummary?.byRule).toEqual(
      expect.objectContaining({
        'class-single-constructor-only': 1,
      }),
    );
    expect(substrate.classValidationSummary?.byRule['machine-transition-from']).toBeUndefined();
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
