/**
 * Unit + zero-FP tests for the declaration walker (`checkProgram`).
 *
 * Behavioural equivalence to core's validator on the shared override surface is
 * proven in equivalence-walk.test.ts. Here we pin the diagnostic SHAPE, the
 * probe-derived duplicate-class rule, and the zero-FP guarantee: every accepted
 * (Liskov-conformant) program produces ZERO diagnostics.
 */
import { describe, expect, test } from '../../../scripts/node-test-compat.ts';
import { parseDocumentWithDiagnostics } from '../../core/dist/parser.js';
import type { CheckDiagnostic } from '../dist/walk.js';
import { checkProgram } from '../dist/walk.js';

function check(source: string): CheckDiagnostic[] {
  return checkProgram(parseDocumentWithDiagnostics(source).root as never);
}
function rules(source: string): string[] {
  return check(source).map((d) => d.rule);
}

const ANIMAL = ['class name=Animal', 'class name=Dog extends=Animal', 'class name=Cat extends=Animal'];
function program(...lines: string[]): string {
  return [...ANIMAL, ...lines].join('\n');
}

describe('checkProgram — diagnostic shape', () => {
  test('return-mismatch carries className, memberName, reason', () => {
    const diags = check(
      program(
        'class name=Base',
        '  method name=make returns=Dog',
        '    handler lang=kern',
        '      return value="new Dog()"',
        'class name=Sub extends=Base',
        '  method name=make returns=Animal',
        '    handler lang=kern',
        '      return value="new Animal()"',
      ),
    );
    const ret = diags.find((d) => d.rule === 'check-override-return');
    expect(ret).toBeDefined();
    expect(ret?.className).toBe('Sub');
    expect(ret?.memberName).toBe('make');
    expect(ret?.reason).toContain('covariant');
  });

  test('param-mismatch carries className, memberName, reason', () => {
    const diags = check(
      program(
        'class name=Base',
        '  method name=greet returns=string',
        '    param name=a type=Animal',
        '    handler lang=kern',
        '      return value="\'x\'"',
        'class name=Sub extends=Base',
        '  method name=greet returns=string',
        '    param name=a type=Dog',
        '    handler lang=kern',
        '      return value="\'y\'"',
      ),
    );
    const param = diags.find((d) => d.rule === 'check-override-param');
    expect(param?.className).toBe('Sub');
    expect(param?.memberName).toBe('greet');
    expect(param?.reason).toContain('contravariant');
  });

  test('return-mismatch suppresses param check for the same member (continue)', () => {
    // Base g returns Dog / param Animal; Sub widens return Animal AND narrows
    // param Dog. The return-mismatch fires and the param check is skipped.
    const diags = check(
      program(
        'class name=Base',
        '  method name=g returns=Dog',
        '    param name=a type=Animal',
        '    handler lang=kern',
        '      return value="new Dog()"',
        'class name=Sub extends=Base',
        '  method name=g returns=Animal',
        '    param name=a type=Dog',
        '    handler lang=kern',
        '      return value="new Animal()"',
      ),
    );
    const overrideRules = diags.filter((d) => d.rule.startsWith('check-override')).map((d) => d.rule);
    expect(overrideRules).toEqual(['check-override-return']);
  });

  test('multi-param narrow → exactly one aggregated param diagnostic', () => {
    const params = check(
      program(
        'class name=Base',
        '  method name=f returns=string',
        '    param name=a type=Animal',
        '    param name=b type=Animal',
        '    handler lang=kern',
        '      return value="\'x\'"',
        'class name=Sub extends=Base',
        '  method name=f returns=string',
        '    param name=a type=Dog',
        '    param name=b type=Dog',
        '    handler lang=kern',
        '      return value="\'y\'"',
      ),
    ).filter((d) => d.rule === 'check-override-param');
    expect(params).toHaveLength(1);
  });
});

describe('checkProgram — probe-derived duplicate-class rule', () => {
  test('emits check-duplicate-class for the SECOND declaration (first-wins)', () => {
    const diags = check(['class name=Dup', 'class name=Dup'].join('\n'));
    const dup = diags.filter((d) => d.rule === 'check-duplicate-class');
    expect(dup).toHaveLength(1);
    expect(dup[0].className).toBe('Dup');
    expect(dup[0].reason).toContain('Duplicate class');
  });

  test('first declaration wins base resolution (no spurious override mismatch)', () => {
    // Two Foo: first base m returns Animal, second base m returns Dog. Bar
    // overrides m returning Animal. Against the FIRST Foo (returns Animal) this
    // is OK; against the second (returns Dog) it would widen. First-wins ⇒ no
    // return-mismatch — mirrors the live validator (probe 1).
    const diags = check(
      program(
        'class name=Foo',
        '  method name=m returns=Animal',
        '    handler lang=kern',
        '      return value="new Animal()"',
        'class name=Foo',
        '  method name=m returns=Dog',
        '    handler lang=kern',
        '      return value="new Dog()"',
        'class name=Bar extends=Foo',
        '  method name=m returns=Animal',
        '    handler lang=kern',
        '      return value="new Animal()"',
      ),
    );
    expect(diags.some((d) => d.rule === 'check-override-return')).toBe(false);
    expect(diags.some((d) => d.rule === 'check-duplicate-class')).toBe(true);
  });

  test('three declarations of one name → two duplicate diagnostics', () => {
    const dup = check(['class name=T', 'class name=T', 'class name=T'].join('\n')).filter(
      (d) => d.rule === 'check-duplicate-class',
    );
    expect(dup).toHaveLength(2);
  });
});

describe('checkProgram — zero-FP corpus (accepted programs produce ZERO diagnostics)', () => {
  const ACCEPTED: ReadonlyArray<readonly [string, string]> = [
    [
      'covariant-return narrowing',
      program(
        'class name=Base',
        '  method name=make returns=Animal',
        '    handler lang=kern',
        '      return value="new Animal()"',
        'class name=Sub extends=Base',
        '  method name=make returns=Dog',
        '    handler lang=kern',
        '      return value="new Dog()"',
      ),
    ],
    [
      'contravariant-param widening',
      program(
        'class name=Base',
        '  method name=greet returns=string',
        '    param name=a type=Dog',
        '    handler lang=kern',
        '      return value="\'x\'"',
        'class name=Sub extends=Base',
        '  method name=greet returns=string',
        '    param name=a type=Animal',
        '    handler lang=kern',
        '      return value="\'y\'"',
      ),
    ],
    [
      'grandparent-chain covariant-return',
      [
        'class name=A',
        '  method name=spawn returns=A',
        '    handler lang=kern',
        '      return value="new A()"',
        'class name=B extends=A',
        'class name=C extends=B',
        '  method name=spawn returns=C',
        '    handler lang=kern',
        '      return value="new C()"',
      ].join('\n'),
    ],
    [
      'mixed accessor getter-over-setter (kind separated → skip)',
      program(
        'class name=Base',
        '  setter name=tag',
        '    param name=next type=Animal',
        '    handler lang=kern',
        '      assign target="this._tag" value="next"',
        'class name=Sub extends=Base',
        '  getter name=tag returns=Dog',
        '    handler lang=kern',
        '      return value="this._tag"',
      ),
    ],
    [
      'builtin base (extends Error → skip)',
      program(
        'class name=AppError extends=Error',
        '  method name=make returns=Animal',
        '    handler lang=kern',
        '      return value="new Animal()"',
      ),
    ],
    [
      'unknown (non-class) types → skip',
      program(
        'class name=Base',
        '  method name=load returns=Widget',
        '    param name=a type=Gadget',
        '    handler lang=kern',
        '      return value="new Widget()"',
        'class name=Sub extends=Base',
        '  method name=load returns=Sprocket',
        '    param name=a type=Cog',
        '    handler lang=kern',
        '      return value="new Sprocket()"',
      ),
    ],
    [
      'static-vs-instance same-name (statics separated → skip)',
      program(
        'class name=Base',
        '  method name=m static=true returns=Dog',
        '    handler lang=kern',
        '      return value="new Dog()"',
        'class name=Sub extends=Base',
        '  method name=m returns=Animal',
        '    handler lang=kern',
        '      return value="new Animal()"',
      ),
    ],
    [
      'arity-mismatch (variance not evaluated → no variance FP)',
      program(
        'class name=Base',
        '  method name=load returns=string',
        '    param name=id type=Animal',
        '    handler lang=kern',
        '      return value="\'x\'"',
        'class name=Sub extends=Base',
        '  method name=load returns=string',
        '    param name=id type=Dog',
        '    param name=extra type=Dog',
        '    handler lang=kern',
        '      return value="\'y\'"',
      ),
    ],
    [
      'no inheritance at all',
      program(
        'class name=Standalone',
        '  method name=run returns=string',
        '    handler lang=kern',
        '      return value="\'ok\'"',
      ),
    ],
  ];

  for (const [label, source] of ACCEPTED) {
    test(`zero diagnostics: ${label}`, () => {
      expect(check(source)).toEqual([]);
    });
  }

  test('the whole accepted corpus produces zero diagnostics in aggregate', () => {
    const total = ACCEPTED.reduce((sum, [, src]) => sum + check(src).length, 0);
    expect(total).toBe(0);
  });
});

describe('checkProgram — empty / classless programs', () => {
  test('empty program → no diagnostics', () => {
    expect(rules('')).toEqual([]);
  });
  test('program with no classes → no diagnostics', () => {
    expect(rules('handler name=noop lang=kern\n  return value=1')).toEqual([]);
  });
});
