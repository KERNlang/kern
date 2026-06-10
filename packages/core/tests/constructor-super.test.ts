import { hasDirectSuperCtorCall } from '../src/constructor-super.js';
import { parse } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

// Extract the (single) class's constructor node from a parsed KERN module. The
// canonical predicate operates on a constructor IR node, so these tests pin the
// ONE classification every layer (validator, runtime, TS + Python codegen) relies
// on — if this drifts, all four drift together, which is exactly what the shared
// predicate exists to prevent.
function ctorOf(source: string): IRNode {
  const root = parse(source);
  const cls = root.type === 'class' ? root : (root.children ?? []).find((c) => c.type === 'class');
  if (!cls) throw new Error('test fixture parsed no class');
  const ctor = (cls.children ?? []).find((c) => c.type === 'constructor');
  if (!ctor) throw new Error('test fixture parsed no constructor');
  return ctor;
}

describe('hasDirectSuperCtorCall — canonical constructor-super predicate', () => {
  test('false when the constructor omits super entirely (implicit mode)', () => {
    const ctor = ctorOf(
      [
        'class name=Box extends=Base',
        '  constructor',
        '    param name=v type=number',
        '    handler lang=kern',
        '      assign target="this.x" value="v"',
      ].join('\n'),
    );
    expect(hasDirectSuperCtorCall(ctor)).toBe(false);
  });

  test('true for a straight-line direct super(...) call (explicit mode)', () => {
    const ctor = ctorOf(
      [
        'class name=Dog extends=Animal',
        '  constructor',
        '    param name=name type=string',
        '    handler lang=kern',
        '      do value="super(name)"',
      ].join('\n'),
    );
    expect(hasDirectSuperCtorCall(ctor)).toBe(true);
  });

  test('true for a super() inside an if branch — presence, not satisfaction', () => {
    const ctor = ctorOf(
      [
        'class name=User extends=Entity',
        '  constructor',
        '    param name=ready type=boolean',
        '    handler lang=kern',
        '      if cond=ready',
        '        do value="super()"',
      ].join('\n'),
    );
    expect(hasDirectSuperCtorCall(ctor)).toBe(true);
  });

  test('false for a super() that only appears inside a lambda (never runs at construction)', () => {
    const ctor = ctorOf(
      [
        'class name=User extends=Entity',
        '  constructor',
        '    handler lang=kern',
        '      do value="(() => super())"',
      ].join('\n'),
    );
    expect(hasDirectSuperCtorCall(ctor)).toBe(false);
  });

  test('false for a super MEMBER call (super.method), which never initializes the base', () => {
    const ctor = ctorOf(
      [
        'class name=Admin extends=Entity',
        '  constructor',
        '    handler lang=kern',
        '      return value="super.kind()"',
      ].join('\n'),
    );
    expect(hasDirectSuperCtorCall(ctor)).toBe(false);
  });

  test('true for a double super (both calls are direct, structurally present)', () => {
    const ctor = ctorOf(
      [
        'class name=User extends=Entity',
        '  constructor',
        '    handler lang=kern',
        '      do value="super()"',
        '      do value="super()"',
      ].join('\n'),
    );
    expect(hasDirectSuperCtorCall(ctor)).toBe(true);
  });
});
