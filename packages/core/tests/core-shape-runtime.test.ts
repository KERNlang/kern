import {
  assertCoreShape,
  collectCoreShapeFacts,
  createCoreRuntimeEnv,
  evalCoreExpression,
  fromHostValue,
  type KernValue,
  runCoreRuntime,
  toHostValue,
  validateCoreShape,
} from '../src/index.js';
import { parse } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function codes(result: ReturnType<typeof validateCoreShape>): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function classNodes(root: IRNode): IRNode[] {
  return (root.children ?? []).filter((child) => child.type === 'class');
}

function cyclicRecord(): KernValue {
  const entries = Object.create(null) as Record<string, KernValue>;
  const value = { kind: 'record' as const, entries };
  entries.id = fromHostValue('n1');
  entries.next = value;
  return value;
}

describe('KERN core declared shape validators', () => {
  test('validates required, optional, array, nested, and inherited fields', () => {
    const root = parse(
      [
        'interface name=Entity',
        '  field name=id type=string',
        'interface name=Profile',
        '  field name=age type=number optional=true',
        'interface name=User extends=Entity',
        '  field name=name type=string',
        '  field name=active type=boolean',
        '  field name=tags type="string[]"',
        '  field name=profile type=Profile optional=true',
      ].join('\n'),
    );

    const result = validateCoreShape(
      fromHostValue({ id: 'u1', name: 'Ada', active: true, tags: ['admin'], profile: {} }),
      'User',
      root,
    );

    expect(result).toEqual({ passed: true, interfaceName: 'User', diagnostics: [] });
    expect(() =>
      assertCoreShape(fromHostValue({ id: 'u1', name: 'Ada', active: true, tags: [] }), 'User', root),
    ).not.toThrow();
  });

  test('reports missing required and wrong primitive fields with stable paths', () => {
    const root = parse(
      ['interface name=User', '  field name=id type=string', '  field name=count type=number'].join('\n'),
    );

    const result = validateCoreShape(fromHostValue({ id: 7 }), 'User', root);

    expect(result.passed).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'shape-field-type',
          path: 'User.id',
          expected: 'string',
          actual: 'number',
        }),
        expect.objectContaining({
          code: 'shape-field-missing',
          path: 'User.count',
          expected: 'number',
        }),
      ]),
    );
  });

  test('keeps runtime records open unless explicit shape validation is requested', () => {
    const runtimeResult = runCoreRuntime({
      type: 'handler',
      props: { lang: 'kern' },
      children: [
        { type: 'let', props: { name: 'record', value: '{ id: "u1" }' } },
        { type: 'assign', props: { target: 'record.extra', value: '2' } },
        { type: 'return', props: { value: 'record.extra' } },
      ],
    });
    expect(toHostValue(runtimeResult.completion.value)).toBe(2);

    const root = parse('interface name=User\n  field name=id type=string');
    const explicit = validateCoreShape(fromHostValue({ id: 'u1', extra: 2 }), 'User', root);
    expect(codes(explicit)).toContain('shape-unexpected-field');
  });

  test('allows explicit extra fields only through compatible indexers', () => {
    const root = parse(
      ['interface name=Scores', '  field name=id type=string', '  indexer keyType=string type=number'].join('\n'),
    );

    expect(validateCoreShape(fromHostValue({ id: 'u1', math: 10 }), 'Scores', root).passed).toBe(true);

    const result = validateCoreShape(fromHostValue({ id: 'u1', math: 'A' }), 'Scores', root);
    expect(result.passed).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'shape-field-type',
          path: 'Scores.math',
          expected: 'number',
          actual: 'string',
        }),
      ]),
    );
  });

  test('matches number indexers against numeric record keys', () => {
    const root = parse('interface name=NumericMap\n  indexer keyType=number type=string');

    expect(
      validateCoreShape(fromHostValue({ '-1': 'left', '0': 'zero', '42': 'answer' }), 'NumericMap', root).passed,
    ).toBe(true);
    expect(codes(validateCoreShape(fromHostValue({ label: 'not numeric' }), 'NumericMap', root))).toContain(
      'shape-unexpected-field',
    );
    expect(codes(validateCoreShape(fromHostValue({ '1.5': 'half', '2e3': 'large' }), 'NumericMap', root))).toEqual(
      expect.arrayContaining(['shape-unexpected-field', 'shape-unexpected-field']),
    );
  });

  test('validates numeric keys against both string and number indexers', () => {
    const root = parse(
      ['interface name=DualMap', '  indexer keyType=string type=unknown', '  indexer keyType=number type=number'].join(
        '\n',
      ),
    );

    expect(validateCoreShape(fromHostValue({ label: 'free-form', 1: 7 }), 'DualMap', root).passed).toBe(true);
    expect(codes(validateCoreShape(fromHostValue({ 1: 'bad' }), 'DualMap', root))).toContain('shape-field-type');
  });

  test('reports inherited field conflicts and unknown type references', () => {
    const root = parse(
      [
        'interface name=Entity',
        '  field name=id type=string',
        'interface name=User extends=Entity',
        '  field name=id type=number',
        '  field name=profile type=MissingProfile',
      ].join('\n'),
    );

    const result = validateCoreShape(fromHostValue({ id: 1, profile: {} }), 'User', root);

    expect(result.passed).toBe(false);
    expect(codes(result)).toEqual(expect.arrayContaining(['shape-field-conflict', 'shape-type-reference-unknown']));
  });

  test('allows explicit undefined for optional fields', () => {
    const root = parse(
      ['interface name=User', '  field name=id type=string', '  field name=nickname type=string optional=true'].join(
        '\n',
      ),
    );

    expect(validateCoreShape(fromHostValue({ id: 'u1', nickname: undefined }), 'User', root).passed).toBe(true);
    expect(codes(validateCoreShape(fromHostValue({ id: undefined }), 'User', root))).toContain('shape-field-type');
  });

  test('reports recursive values instead of recursing through self-referential shape fields', () => {
    const root = parse(
      ['interface name=Node', '  field name=id type=string', '  field name=next type=Node optional=true'].join('\n'),
    );

    const result = validateCoreShape(cyclicRecord(), 'Node', root);

    expect(result.passed).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'shape-value-cycle',
          path: 'Node.next',
          interfaceName: 'Node',
        }),
      ]),
    );
  });

  test('reports unsupported generic and complex type contracts instead of silently passing', () => {
    const root = parse(
      [
        'interface name=Box generics="<T>"',
        '  field name=value type=T',
        'interface name=MaybeName',
        '  field name=name type="string | null"',
      ].join('\n'),
    );

    const boxCodes = codes(validateCoreShape(fromHostValue({ value: 'x' }), 'Box', root));
    expect(boxCodes).toContain('shape-generic-unsupported');
    expect(boxCodes.filter((code) => code === 'shape-generic-unsupported')).toHaveLength(1);
    const maybeNameCodes = codes(validateCoreShape(fromHostValue({ name: 'Ada' }), 'MaybeName', root));
    expect(maybeNameCodes).toContain('shape-type-unsupported');
    expect(maybeNameCodes).not.toContain('shape-generic-unsupported');
  });

  test('accepts field-backed class instances through declared shape validation', () => {
    const root = parse(
      [
        'interface name=UserLike',
        '  field name=id type=string',
        'class name=User',
        '  field name=id type=string value="u1"',
      ].join('\n'),
    );
    const env = createCoreRuntimeEnv();
    runCoreRuntime(classNodes(root), env);

    expect(validateCoreShape(evalCoreExpression('new User()', env), 'UserLike', root).passed).toBe(true);
  });

  test('exports shape facts for review and guard consumers', () => {
    const root = parse(
      [
        'interface name=Entity',
        '  field name=id type=string',
        'interface name=User extends=Entity',
        '  field name=name type=string optional=true',
        '  indexer keyType=string type=unknown',
      ].join('\n'),
    );

    expect(collectCoreShapeFacts(root)).toEqual(
      expect.objectContaining({
        extendsEdges: [{ from: 'User', to: 'Entity', resolved: true }],
        validationDiagnostics: [],
        interfaces: expect.arrayContaining([
          expect.objectContaining({
            name: 'User',
            extends: ['Entity'],
            validatorAvailable: true,
            fields: expect.arrayContaining([
              expect.objectContaining({ name: 'id', type: 'string', inheritedFrom: 'Entity' }),
              expect.objectContaining({ name: 'name', type: 'string', optional: true }),
            ]),
          }),
        ]),
      }),
    );
  });

  test('collects nested interface declarations and invalid graph diagnostics into facts', () => {
    const root = parse(
      [
        'module name=Domain',
        '  interface name=Nested',
        '    field name=id type=string',
        'interface name=Left',
        '  field name=id type=string',
        'interface name=Right',
        '  field name=id type=number',
        'interface name=Joined extends=Left,Right',
        'interface name=GenericChild extends="Pair<string, string>,Left"',
        'interface name=ObjectGenericChild extends="Wrapper<{ a: string, b: number }>,Left"',
        'interface name=Broken extends=Missing',
        '  indexer keyType=symbol type=string',
        'interface name=Indexed',
        '  indexer keyType=string type=unknown',
        'interface name=IndexedChild extends=Indexed',
        'interface name=Duplicate',
        '  field name=id type=string',
        '  field name=id type=string',
        'interface name=Shadowed',
        '  field name=id type=string',
        'interface name=Shadowed',
        '  field name=id type=number',
        'interface name=ShadowedChild extends=Shadowed',
        'interface name=UsesShadowed',
        '  field name=child type=Shadowed',
      ].join('\n'),
    );

    const facts = collectCoreShapeFacts(root);

    expect(facts.interfaces.map((shape) => shape.name)).toEqual(
      expect.arrayContaining([
        'Nested',
        'Left',
        'Right',
        'Joined',
        'GenericChild',
        'ObjectGenericChild',
        'Broken',
        'Indexed',
        'IndexedChild',
        'Duplicate',
        'Shadowed',
        'ShadowedChild',
        'UsesShadowed',
      ]),
    );
    expect(facts.extendsEdges).toEqual(
      expect.arrayContaining([
        { from: 'Joined', to: 'Left', resolved: true },
        { from: 'Joined', to: 'Right', resolved: true },
        { from: 'GenericChild', to: 'Pair<string, string>', resolved: false },
        { from: 'GenericChild', to: 'Left', resolved: true },
        { from: 'ObjectGenericChild', to: 'Wrapper<{ a: string, b: number }>', resolved: false },
        { from: 'ObjectGenericChild', to: 'Left', resolved: true },
        { from: 'Broken', to: 'Missing', resolved: false },
        { from: 'IndexedChild', to: 'Indexed', resolved: true },
        { from: 'ShadowedChild', to: 'Shadowed', resolved: true },
      ]),
    );
    expect(facts.validationDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'shape-field-conflict', interfaceName: 'Joined' }),
        expect.objectContaining({ code: 'shape-extends-unknown', interfaceName: 'Broken' }),
        expect.objectContaining({ code: 'shape-extends-unknown', interfaceName: 'GenericChild' }),
        expect.objectContaining({ code: 'shape-extends-unknown', interfaceName: 'ObjectGenericChild' }),
        expect.objectContaining({ code: 'shape-indexer-key-unsupported', interfaceName: 'Broken' }),
        expect.objectContaining({ code: 'shape-field-duplicate', interfaceName: 'Duplicate' }),
        expect.objectContaining({ code: 'shape-interface-duplicate', interfaceName: 'Shadowed' }),
      ]),
    );
    expect(facts.interfaces.find((shape) => shape.name === 'Broken')?.unsupportedReasons).toEqual(
      expect.arrayContaining(['shape-extends-unknown', 'shape-indexer-key-unsupported']),
    );
    expect(facts.interfaces.find((shape) => shape.name === 'IndexedChild')?.indexers).toEqual([
      expect.objectContaining({ keyType: 'string', type: 'unknown' }),
    ]);
    expect(facts.interfaces.find((shape) => shape.name === 'Shadowed')).toEqual(
      expect.objectContaining({
        validatorAvailable: false,
        unsupportedReasons: expect.arrayContaining(['shape-interface-duplicate']),
      }),
    );
    expect(facts.interfaces.find((shape) => shape.name === 'UsesShadowed')).toEqual(
      expect.objectContaining({
        validatorAvailable: false,
        unsupportedReasons: expect.arrayContaining(['shape-interface-duplicate']),
      }),
    );
    const shadowed = validateCoreShape(fromHostValue({ id: 1 }), 'Shadowed', root);
    expect(shadowed.passed).toBe(false);
    expect(shadowed.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'shape-interface-duplicate' })]),
    );
    expect(codes(validateCoreShape(fromHostValue({ id: 1 }), 'ShadowedChild', root))).toContain(
      'shape-interface-duplicate',
    );
    expect(codes(validateCoreShape(fromHostValue({ child: { id: 1 } }), 'UsesShadowed', root))).toContain(
      'shape-interface-duplicate',
    );
  });
});
