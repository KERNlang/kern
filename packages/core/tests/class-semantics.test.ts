import { parseDocumentWithDiagnostics } from '../src/parser.js';
import { validateSemantics } from '../src/semantic-validator.js';

function violationsFor(source: string) {
  return validateSemantics(parseDocumentWithDiagnostics(source).root);
}

function rulesFor(source: string): string[] {
  return violationsFor(source).map((violation) => violation.rule);
}

describe('semantic-validator — class object model', () => {
  test('accepts valid inheritance with explicit constructor super and method override', () => {
    const source = [
      'class name=Entity',
      '  field name=id type=string',
      '  constructor',
      '    param name=id type=string',
      '    handler lang=kern',
      '      assign target="this.id" value="id"',
      '  method name=kind returns=string',
      '    handler lang=kern',
      '      return value="\'entity\'"',
      'class name=User extends=Entity',
      '  constructor',
      '    param name=id type=string',
      '    handler lang=kern',
      '      do value="super(id)"',
      '  method name=kind returns=string',
      '    handler lang=kern',
      '      return value="`user/${super.kind()}`"',
    ].join('\n');

    expect(rulesFor(source)).toEqual([]);
  });

  test('accepts imported base class names as visible extension targets', () => {
    const source = [
      'import from="./base" names=BaseEntity',
      'class name=User extends=BaseEntity',
      '  field name=id type=string',
    ].join('\n');

    expect(rulesFor(source)).not.toContain('class-extends-unknown');
  });

  test('accepts external package imports as visible extension targets', () => {
    const source = [
      'import from="@kern/base" registry=npm names=ExternalBase',
      'class name=User extends=ExternalBase',
      '  field name=id type=string',
    ].join('\n');

    expect(rulesFor(source)).not.toContain('class-extends-unknown');
  });

  test('accepts class implements when effective readable instance members satisfy local interfaces', () => {
    const source = [
      'interface name=Entity',
      '  field name=id type=string',
      'interface name=Named extends=Entity',
      '  field name=name type=string',
      '  field name=nickname type=string optional=true',
      'class name=Base',
      '  field name=id type=string',
      'class name=User extends=Base implements=Named',
      '  getter name=name returns=string',
      '    handler lang=kern',
      '      return value="this.id"',
    ].join('\n');

    const rules = rulesFor(source);
    expect(rules).not.toContain('class-implements-unknown');
    expect(rules).not.toContain('class-implements-missing-member');
  });

  test('accepts class implements when instance methods satisfy interface methods', () => {
    const rules = rulesFor(
      [
        'interface name=Runnable',
        '  method name=run params="input:string" returns=number',
        'class name=Base',
        '  method name=run params="input:string" returns=number',
        '    handler lang=kern',
        '      return value="input.length"',
        'class name=Job extends=Base implements=Runnable',
      ].join('\n'),
    );

    expect(rules).not.toContain('class-implements-missing-member');
  });

  test('reports missing and incompatible interface methods for class implements', () => {
    const violations = violationsFor(
      [
        'interface name=Runnable',
        '  method name=run params="input:string" returns=number',
        '  method name=stop returns=void',
        'class name=Job implements=Runnable',
        '  method name=run returns=number',
        '    handler lang=kern',
        '      return value="1"',
        '  getter name=stop returns=void',
        '    handler lang=kern',
        '      return value="undefined"',
      ].join('\n'),
    );

    const violation = violations.find((candidate) => candidate.rule === 'class-implements-missing-member');
    expect(violation?.message).toContain('run');
    expect(violation?.message).toContain('stop');
  });

  test('checks interface method parameter types and accepts implicit void returns', () => {
    const acceptedRules = rulesFor(
      [
        'interface name=Lifecycle',
        '  method name=close returns=void',
        'class name=Socket implements=Lifecycle',
        '  method name=close',
        '    handler lang=kern',
        '      do value="undefined"',
      ].join('\n'),
    );
    expect(acceptedRules).not.toContain('class-implements-missing-member');

    const rejectedRules = rulesFor(
      [
        'interface name=Runnable',
        '  method name=run params="input:string" returns=number',
        'class name=Job implements=Runnable',
        '  method name=run params="input:number" returns=number',
        '    handler lang=kern',
        '      return value="input"',
      ].join('\n'),
    );
    expect(rejectedRules).toContain('class-implements-missing-member');
  });

  test('requires stream interface methods to be implemented as stream methods', () => {
    const acceptedRules = rulesFor(
      [
        'interface name=Events',
        '  method name=read returns=Event stream=true',
        'class name=Reader implements=Events',
        '  method name=read returns=Event stream=true',
        '    handler lang=kern',
        '      return value="undefined"',
      ].join('\n'),
    );
    expect(acceptedRules).not.toContain('class-implements-missing-member');

    const rejectedRules = rulesFor(
      [
        'interface name=Events',
        '  method name=read returns=Event stream=true',
        'class name=Reader implements=Events',
        '  method name=read returns=Event',
        '    handler lang=kern',
        '      return value="undefined"',
      ].join('\n'),
    );
    expect(rejectedRules).toContain('class-implements-missing-member');
  });

  test('normalizes streamed method returns and generic parameter types for class implements', () => {
    const streamedRules = rulesFor(
      [
        'interface name=Events',
        '  method name=read returns="AsyncGenerator<Event>" stream=true',
        'class name=Reader implements=Events',
        '  method name=read returns=Event stream=true',
        '    handler lang=kern',
        '      return value="undefined"',
      ].join('\n'),
    );
    expect(streamedRules).not.toContain('class-implements-missing-member');

    const genericParamRules = rulesFor(
      [
        'interface name=Sink',
        '  method name=write params="item:Record<string,number>" returns=void',
        'class name=BadSink implements=Sink',
        '  method name=write params="item:Record<string,boolean>" returns=void',
        '    handler lang=kern',
        '      do value="undefined"',
      ].join('\n'),
    );
    expect(genericParamRules).toContain('class-implements-missing-member');

    const literalWhitespaceRules = rulesFor(
      [
        'interface name=Sink',
        '  method name=write params="item:\'a b\'" returns=void',
        'class name=BadSink implements=Sink',
        '  method name=write params="item:\'ab\'" returns=void',
        '    handler lang=kern',
        '      do value="undefined"',
      ].join('\n'),
    );
    expect(literalWhitespaceRules).toContain('class-implements-missing-member');
  });

  test('rejects private protocol methods and tolerates whitespace/default comparison params', () => {
    const privateRules = rulesFor(
      [
        'interface name=Runnable',
        '  method name=run returns=number',
        'class name=Job implements=Runnable',
        '  method name=run private=true returns=number',
        '    handler lang=kern',
        '      return value="1"',
      ].join('\n'),
    );
    expect(privateRules).toContain('class-implements-missing-member');

    const whitespaceRules = rulesFor(
      [
        'interface name=Sink',
        '  method name=write params="item:Record<string, number>" returns=void',
        'class name=GoodSink implements=Sink',
        '  method name=write params="item:Record<string,number>" returns=void',
        '    handler lang=kern',
        '      do value="undefined"',
      ].join('\n'),
    );
    expect(whitespaceRules).not.toContain('class-implements-missing-member');

    const defaultComparisonRules = rulesFor(
      [
        'interface name=Calculator',
        '  method name=calc params="value:number=1 < 2,unit:string" returns=number',
        'class name=DefaultCalc implements=Calculator',
        '  method name=calc params="value:number=1 < 2,unit:string" returns=number',
        '    handler lang=kern',
        '      return value="value"',
      ].join('\n'),
    );
    expect(defaultComparisonRules).not.toContain('class-implements-missing-member');

    const defaultEqualityRules = rulesFor(
      [
        'interface name=Comparator',
        '  method name=cmp params="value:number=a==b,unit:string" returns=number',
        'class name=DefaultCmp implements=Comparator',
        '  method name=cmp params="value:number=a==b,unit:string" returns=number',
        '    handler lang=kern',
        '      return value="value"',
      ].join('\n'),
    );
    expect(defaultEqualityRules).not.toContain('class-implements-missing-member');

    const genericDefaultRules = rulesFor(
      [
        'interface name=Formatter',
        '  method name=format params="value:Map<string, number>=make<Pair<string, number>>(),unit:string" returns=number',
        'class name=DefaultFormatter implements=Formatter',
        '  method name=format params="value:Map<string, number>=make<Pair<string, number>>(),unit:string" returns=number',
        '    handler lang=kern',
        '      return value="1"',
      ].join('\n'),
    );
    expect(genericDefaultRules).not.toContain('class-implements-missing-member');
  });

  test('reports unknown class implements targets unless imported', () => {
    const localRules = rulesFor('class name=User implements=MissingProtocol');
    expect(localRules).toContain('class-implements-unknown');

    const importedRules = rulesFor(
      ['import from="./protocols" names=ExternalProtocol', 'class name=User implements=ExternalProtocol'].join('\n'),
    );
    expect(importedRules).not.toContain('class-implements-unknown');
  });

  test('reports malformed class implements reference lists', () => {
    const rules = rulesFor('class name=User implements="Known,"');

    expect(rules).toContain('class-implements-invalid-reference-list');
  });

  test('parses generic implements references with default types containing commas', () => {
    const rules = rulesFor(
      ['interface name=Protocol', 'class name=User implements="Protocol<T = Map<string, number>>"'].join('\n'),
    );

    expect(rules).not.toContain('class-implements-invalid-reference-list');
    expect(rules).not.toContain('class-implements-unknown');
  });

  test('reports missing required readable instance members for class implements', () => {
    const violations = violationsFor(
      [
        'interface name=RoleBearing',
        '  field name=role type=string',
        '  field name=status type=string optional=true',
        'class name=Account implements=RoleBearing',
        '  field name=role type=string static=true',
      ].join('\n'),
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'class-implements-missing-member',
          message: expect.stringContaining('role'),
        }),
      ]),
    );
  });

  test('does not satisfy interface fields with methods or mismatched field types', () => {
    const rules = rulesFor(
      [
        'interface name=RoleBearing',
        '  field name=role type=string',
        'class name=MethodRole implements=RoleBearing',
        '  method name=role returns=string',
        '    handler lang=kern',
        '      return value="\'admin\'"',
        'class name=NumberRole implements=RoleBearing',
        '  field name=role type=number',
      ].join('\n'),
    );

    expect(rules.filter((rule) => rule === 'class-implements-missing-member')).toHaveLength(2);
  });

  test('reports invalid interface shapes before class implements conformance', () => {
    const unknownBaseRules = rulesFor(
      [
        'interface name=Protocol extends=MissingProtocol',
        '  field name=id type=string',
        'class name=User implements=Protocol',
        '  field name=id type=string',
      ].join('\n'),
    );
    expect(unknownBaseRules).toContain('class-implements-invalid-interface');

    const optionalityConflictRules = rulesFor(
      [
        'interface name=BaseProtocol',
        '  field name=id type=string',
        'interface name=Protocol extends=BaseProtocol',
        '  field name=id type=string optional=true',
        'class name=User implements=Protocol',
        '  field name=id type=string',
      ].join('\n'),
    );
    expect(optionalityConflictRules).toContain('class-implements-invalid-interface');
  });

  test('reports cyclic method protocols as invalid interfaces', () => {
    const rules = rulesFor(
      [
        'interface name=A extends=B',
        '  method name=a returns=void',
        'interface name=B extends=A',
        '  method name=b returns=void',
        'class name=CycleImpl implements=A',
        '  method name=a returns=void',
        '    handler lang=kern',
        '      do value="undefined"',
      ].join('\n'),
    );

    expect(rules).toContain('class-implements-invalid-interface');
    expect(rules).not.toContain('class-implements-missing-member');
  });

  test('reports interface indexers as unsupported class implements protocols in v1', () => {
    const rules = rulesFor(
      [
        'interface name=DictionaryProtocol',
        '  indexer keyName=key keyType=string type=number',
        'class name=Dictionary implements=DictionaryProtocol',
      ].join('\n'),
    );

    expect(rules).toContain('class-implements-unsupported-protocol');
  });

  test('reports unknown base class names', () => {
    const violations = violationsFor('class name=User extends=MissingBase');

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'class-extends-unknown',
          message: expect.stringContaining("extends unknown base 'MissingBase'"),
        }),
      ]),
    );
  });

  test('reports non-class declarations used as superclass targets', () => {
    const violations = violationsFor(['interface name=Shape', 'class name=Circle extends=Shape'].join('\n'));

    expect(violations.map((violation) => violation.rule)).toContain('class-extends-unknown');
  });

  test('reports inheritance cycles across known local classes', () => {
    const violations = violationsFor(
      ['class name=A extends=B', 'class name=B extends=C', 'class name=C extends=A'].join('\n'),
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rule: 'class-inheritance-cycle',
          message: expect.stringContaining('A -> B -> C -> A'),
        }),
      ]),
    );
    expect(violations.filter((violation) => violation.rule === 'class-inheritance-cycle')).toHaveLength(1);
  });

  test('reports duplicate constructors', () => {
    const violations = violationsFor(
      [
        'class name=User',
        '  constructor',
        '    handler lang=kern',
        '      do value="1"',
        '  constructor',
        '    handler lang=kern',
        '      do value="2"',
      ].join('\n'),
    );

    expect(violations.map((violation) => violation.rule)).toContain('class-single-constructor-only');
  });

  test('reports class member conflicts while allowing getter/setter pairs', () => {
    const conflict = violationsFor(
      [
        'class name=Bad',
        '  field name=value type=number',
        '  method name=value returns=number',
        '    handler lang=kern',
        '      return value=1',
      ].join('\n'),
    );
    expect(conflict.map((violation) => violation.rule)).toContain('class-member-conflict');

    const accessorPair = rulesFor(
      [
        'class name=Good',
        '  getter name=value returns=number',
        '    handler lang=kern',
        '      return value="this._value"',
        '  setter name=value',
        '    param name=next type=number',
        '    handler lang=kern',
        '      assign target="this._value" value="next"',
      ].join('\n'),
    );
    expect(accessorPair).not.toContain('class-member-conflict');
  });

  test('reports duplicate accessors for the same member name', () => {
    const violations = violationsFor(
      [
        'class name=Bad',
        '  getter name=value returns=number',
        '    handler lang=kern',
        '      return value=1',
        '  setter name=value',
        '    param name=next type=number',
        '    handler lang=kern',
        '      assign target="this._value" value="next"',
        '  setter name=value',
        '    param name=other type=number',
        '    handler lang=kern',
        '      assign target="this._value" value="other"',
      ].join('\n'),
    );

    expect(violations.map((violation) => violation.rule)).toContain('class-member-conflict');
  });

  test('reports derived constructors that omit super', () => {
    const violations = violationsFor(
      [
        'class name=Entity',
        'class name=User extends=Entity',
        '  constructor',
        '    handler lang=kern',
        '      assign target="this.name" value="\'Ada\'"',
      ].join('\n'),
    );

    expect(violations.map((violation) => violation.rule)).toContain('class-constructor-missing-super');
  });

  test('does not accept delayed super calls inside constructor lambdas', () => {
    const violations = violationsFor(
      [
        'class name=Entity',
        'class name=User extends=Entity',
        '  constructor',
        '    handler lang=kern',
        '      do value="(() => super())"',
      ].join('\n'),
    );

    expect(violations.map((violation) => violation.rule)).toContain('class-constructor-missing-super');
  });

  test('reports this and super member access before constructor super', () => {
    const rules = rulesFor(
      [
        'class name=Entity',
        '  method name=kind returns=string',
        '    handler lang=kern',
        '      return value="\'entity\'"',
        'class name=User extends=Entity',
        '  constructor',
        '    handler lang=kern',
        '      assign target="this.name" value="\'Ada\'"',
        '      do value="super()"',
        'class name=Admin extends=Entity',
        '  constructor',
        '    handler lang=kern',
        '      return value="super.kind()"',
      ].join('\n'),
    );

    expect(rules.filter((rule) => rule === 'class-constructor-this-before-super')).toHaveLength(2);
  });

  test('reports double constructor super calls', () => {
    const rules = rulesFor(
      [
        'class name=Entity',
        'class name=User extends=Entity',
        '  constructor',
        '    handler lang=kern',
        '      do value="super()"',
        '      do value="super()"',
      ].join('\n'),
    );

    expect(rules).toContain('class-constructor-double-super');
  });

  test('reports direct constructor super after maybe-initialized state', () => {
    const rules = rulesFor(
      [
        'class name=Entity',
        'class name=User extends=Entity',
        '  field name=name type=string',
        '  constructor',
        '    param name=ready type=boolean',
        '    handler lang=kern',
        '      if cond=ready',
        '        do value="super()"',
        '      do value="super()"',
      ].join('\n'),
    );

    expect(rules).toContain('class-constructor-double-super');
    expect(rules).toContain('class-constructor-conditional-super');
  });

  test('reports nested constructor super inside super arguments as double super', () => {
    const rules = rulesFor(
      [
        'class name=Entity',
        'class name=User extends=Entity',
        '  constructor',
        '    handler lang=kern',
        '      do value="super(super())"',
      ].join('\n'),
    );

    expect(rules).toContain('class-constructor-double-super');
  });

  test('reports non-direct constructor super after initialization as double super', () => {
    const rules = rulesFor(
      [
        'class name=Entity',
        'class name=User extends=Entity',
        '  constructor',
        '    handler lang=kern',
        '      do value="super()"',
        '      return value="super()"',
      ].join('\n'),
    );

    expect(rules).toContain('class-constructor-double-super');
  });

  test('reports conditional constructor super when not every path initializes', () => {
    const rules = rulesFor(
      [
        'class name=Entity',
        'class name=User extends=Entity',
        '  constructor',
        '    param name=ready type=boolean',
        '    handler lang=kern',
        '      if cond=ready',
        '        do value="super()"',
      ].join('\n'),
    );

    expect(rules).toContain('class-constructor-conditional-super');
  });

  test('accepts branch-complete constructor super before derived this usage', () => {
    const rules = rulesFor(
      [
        'class name=Entity',
        'class name=User extends=Entity',
        '  constructor',
        '    param name=ready type=boolean',
        '    handler lang=kern',
        '      if cond=ready',
        '        do value="super()"',
        '      else',
        '        do value="super()"',
        '      assign target="this.name" value="\'Ada\'"',
      ].join('\n'),
    );

    expect(rules).not.toContain('class-constructor-conditional-super');
    expect(rules).not.toContain('class-constructor-this-before-super');
    expect(rules).not.toContain('class-constructor-missing-super');
  });

  test('reports undeclared this and super class-shape member access', () => {
    const rules = rulesFor(
      [
        'class name=Base',
        '  field name=known type=number',
        'class name=User extends=Base',
        '  field name=own type=number',
        '  method name=readMissing returns=number',
        '    handler lang=kern',
        '      return value="this.missing"',
        '  method name=writeMissing returns=void',
        '    handler lang=kern',
        '      assign target="this.missing" value=1',
        '  method name=readMissingSuper returns=number',
        '    handler lang=kern',
        '      return value="super.missing"',
      ].join('\n'),
    );

    expect(rules.filter((rule) => rule === 'class-member-undeclared')).toHaveLength(3);
  });

  test('reports static and instance shape mismatches for this access', () => {
    const rules = rulesFor(
      [
        'class name=Shape',
        '  field name=instanceOnly type=number',
        '  field name=staticOnly type=number static=true',
        '  method name=badInstance returns=number',
        '    handler lang=kern',
        '      return value="this.staticOnly"',
        '  method name=badStatic static=true returns=number',
        '    handler lang=kern',
        '      return value="this.instanceOnly"',
      ].join('\n'),
    );

    expect(rules.filter((rule) => rule === 'class-member-undeclared')).toHaveLength(2);
  });

  test('reports non-readable and non-writable class-shape members', () => {
    const rules = rulesFor(
      [
        'class name=Access',
        '  setter name=writeOnly',
        '    param name=value type=number',
        '    handler lang=kern',
        '      do value=value',
        '  getter name=readOnly returns=number',
        '    handler lang=kern',
        '      return value=1',
        '  method name=run returns=number',
        '    handler lang=kern',
        '      assign target="this.readOnly" value=2',
        '      return value="this.writeOnly"',
      ].join('\n'),
    );

    expect(rules).toContain('class-member-read-not-readable');
    expect(rules).toContain('class-member-write-not-writable');
  });

  test('reports constructor this usage in conditions before super', () => {
    const rules = rulesFor(
      [
        'class name=Entity',
        'class name=User extends=Entity',
        '  constructor',
        '    handler lang=kern',
        '      if cond="this.ready"',
        '        do value="super()"',
        '      else',
        '        do value="super()"',
      ].join('\n'),
    );

    expect(rules).toContain('class-constructor-this-before-super');
  });

  test('reports super usage in classes without a base', () => {
    const violations = violationsFor(
      [
        'class name=User',
        '  method name=kind returns=string',
        '    handler lang=kern',
        '      return value="super.kind()"',
      ].join('\n'),
    );

    expect(violations.map((violation) => violation.rule)).toContain('class-super-without-base');
  });

  test('finds super usage in control-flow expression props', () => {
    const violations = violationsFor(
      [
        'class name=User',
        '  method name=check returns=void',
        '    handler lang=kern',
        '      if cond="super.ready()"',
        '        do value="1"',
      ].join('\n'),
    );

    expect(violations.map((violation) => violation.rule)).toContain('class-super-without-base');
  });

  test('does not attribute nested class super usage to the outer class', () => {
    const source = [
      'class name=Base',
      'class name=Outer',
      '  method name=install returns=void',
      '    handler lang=kern',
      '      class name=Inner extends=Base',
      '        constructor',
      '          handler lang=kern',
      '            do value="super()"',
    ].join('\n');

    expect(rulesFor(source)).not.toContain('class-super-without-base');
  });

  test('reports override kind and arity mismatches', () => {
    const source = [
      'class name=Base',
      '  method name=load returns=string',
      '    param name=id type=string',
      '    handler lang=kern',
      '      return value=id',
      '  field name=status type=string',
      'class name=Derived extends=Base',
      '  method name=load returns=string',
      '    handler lang=kern',
      '      return value="\'missing id\'"',
      '  method name=status returns=string',
      '    handler lang=kern',
      '      return value="\'ok\'"',
    ].join('\n');
    const rules = rulesFor(source);

    expect(rules).toContain('class-override-arity-mismatch');
    expect(rules).toContain('class-override-kind-mismatch');
  });

  test('override validation terminates when an inheritance cycle has no matching member', () => {
    const rules = rulesFor(
      [
        'class name=A extends=B',
        '  method name=onlyA returns=number',
        '    handler lang=kern',
        '      return value=1',
        'class name=B extends=C',
        'class name=C extends=B',
      ].join('\n'),
    );

    expect(rules).toContain('class-inheritance-cycle');
  });
});
