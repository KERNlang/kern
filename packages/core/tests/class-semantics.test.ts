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
