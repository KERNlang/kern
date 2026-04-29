/** Slice 3d — native destructuring statements: `const {a,b}=obj` /
 *  `const [x,y]=arr` via the `destructure` node type with `binding`
 *  (object) or `element` (array) children. Complex patterns
 *  (rest `...`, defaults `=v`, nested) fall back to the
 *  `expr={{...}}` escape hatch carrying the raw TS statement.
 *
 *  Mirrors slice 1j/3a/3b/3c precedent — schema + codegen + importer +
 *  decompiler + round-trip + capability matrix all in one place. */

import { capabilitySupport } from '../src/capability-matrix.js';
import { generateCoreNode } from '../src/codegen-core.js';
import { decompile } from '../src/decompiler.js';
import { importTypeScript } from '../src/importer.js';
import { parse } from '../src/parser.js';

function gen(kern: string): string {
  return generateCoreNode(parse(kern)).join('\n');
}

describe('destructure — slice 3d (native destructuring)', () => {
  // ─── Codegen: object patterns ──────────────────────────────────────────

  describe('codegen — object pattern (binding children)', () => {
    it('emits `const { a, b } = obj;` for a simple object pattern', () => {
      const code = gen(['destructure kind=const source=user', '  binding name=id', '  binding name=email'].join('\n'));
      expect(code).toContain('const { id, email } = user;');
    });

    it('emits a renamed binding as `key: name`', () => {
      const code = gen(['destructure kind=const source=user', '  binding name=mail key=email'].join('\n'));
      expect(code).toContain('const { email: mail } = user;');
    });

    it('mixes plain and renamed bindings', () => {
      const code = gen(
        ['destructure kind=const source=user', '  binding name=id', '  binding name=mail key=email'].join('\n'),
      );
      expect(code).toContain('const { id, email: mail } = user;');
    });

    it('emits an export prefix when export=true', () => {
      const code = gen(['destructure kind=const source=cfg export=true', '  binding name=apiUrl'].join('\n'));
      expect(code).toContain('export const { apiUrl } = cfg;');
    });

    it('emits a let pattern when kind=let', () => {
      const code = gen(['destructure kind=let source=state', '  binding name=count'].join('\n'));
      expect(code).toContain('let { count } = state;');
    });

    it('defaults kind to const when omitted', () => {
      const code = gen(['destructure source=user', '  binding name=id'].join('\n'));
      expect(code).toContain('const { id } = user;');
    });

    it('emits an inline type annotation on the LHS pattern', () => {
      const code = gen(['destructure kind=const source=user type=UserShape', '  binding name=id'].join('\n'));
      expect(code).toContain('const { id }: UserShape = user;');
    });

    it('source as an ExprObject {{...}} renders the raw expression on the RHS', () => {
      const code = gen(['destructure kind=const source={{ getUser().data }}', '  binding name=id'].join('\n'));
      expect(code).toContain('const { id } = getUser().data;');
    });
  });

  // ─── Codegen: array patterns ───────────────────────────────────────────

  describe('codegen — array pattern (element children)', () => {
    it('emits `const [a, b] = arr;` for a simple ordered pattern', () => {
      const code = gen(
        ['destructure kind=const source=pair', '  element name=first index=0', '  element name=second index=1'].join(
          '\n',
        ),
      );
      expect(code).toContain('const [first, second] = pair;');
    });

    it('emits an array hole for a missing index', () => {
      const code = gen(['destructure kind=const source=tuple', '  element name=second index=1'].join('\n'));
      expect(code).toContain('const [, second] = tuple;');
    });

    it('handles non-zero starting index', () => {
      const code = gen(['destructure kind=const source=tuple', '  element name=third index=2'].join('\n'));
      expect(code).toContain('const [, , third] = tuple;');
    });
  });

  // ─── Codegen: expr= escape hatch ───────────────────────────────────────

  describe('codegen — expr= escape hatch', () => {
    it('emits the raw statement when expr={{...}} is set, ignoring other props', () => {
      const code = gen(['destructure expr={{ const { a, ...rest } = obj }}'].join('\n'));
      expect(code).toContain('const { a, ...rest } = obj');
    });

    it('expr= overrides any structured children', () => {
      const code = gen(
        ['destructure expr={{ const [a = 1, b = 2] = arr }}', '  element name=ignored index=0'].join('\n'),
      );
      expect(code).toContain('const [a = 1, b = 2] = arr');
      expect(code).not.toContain('ignored');
    });
  });

  // ─── Codegen: error paths ──────────────────────────────────────────────

  describe('codegen — error paths', () => {
    it('throws when destructure has no children and no source', () => {
      expect(() => gen(['destructure kind=const'].join('\n'))).toThrow();
    });

    it('throws when bindings and elements are mixed', () => {
      expect(() =>
        gen(['destructure kind=const source=mixed', '  binding name=a', '  element name=b index=0'].join('\n')),
      ).toThrow();
    });

    it('throws when an element child is missing index=', () => {
      expect(() => gen(['destructure kind=const source=arr', '  element name=x'].join('\n'))).toThrow();
    });
  });

  // ─── Importer ──────────────────────────────────────────────────────────

  describe('importer — TS → KERN', () => {
    it('converts `const { a, b } = obj` into structured binding children', () => {
      const ts = `const { a, b } = obj;`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).toContain('destructure kind=const');
      expect(kern).toContain('source=obj');
      expect(kern).toContain('binding name=a');
      expect(kern).toContain('binding name=b');
    });

    it('preserves a renamed binding as binding name=foo key=a', () => {
      const ts = `const { a: foo } = obj;`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).toContain('binding name=foo key=a');
    });

    it('converts `const [x, y] = arr` into element children with indices', () => {
      const ts = `const [x, y] = arr;`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).toContain('destructure kind=const');
      expect(kern).toContain('source=arr');
      expect(kern).toContain('element name=x index=0');
      expect(kern).toContain('element name=y index=1');
    });

    it('preserves array holes by skipping missing indices', () => {
      const ts = `const [, b] = arr;`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).toContain('element name=b index=1');
      expect(kern).not.toContain('index=0');
    });

    it('detects let kind when `let` keyword is used', () => {
      const ts = `let { a } = obj;`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).toContain('destructure kind=let');
    });

    it('falls back to expr={{...}} for rest spread `...rest`', () => {
      const ts = `const { a, ...rest } = obj;`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).toContain('destructure expr={{');
      expect(kern).toContain('...rest');
      expect(kern).not.toMatch(/^destructure kind=/m);
    });

    it('falls back to expr={{...}} for binding defaults', () => {
      const ts = `const { a = 1 } = obj;`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).toContain('destructure expr={{');
      expect(kern).toContain('a = 1');
    });

    it('falls back to expr={{...}} for nested patterns', () => {
      const ts = `const { a: { b } } = obj;`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).toContain('destructure expr={{');
    });

    it('falls back to expr={{...}} for array spread', () => {
      const ts = `const [a, ...rest] = arr;`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).toContain('destructure expr={{');
    });

    it('preserves export prefix on simple object pattern', () => {
      const ts = `export const { a } = obj;`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).toContain('destructure kind=const');
      expect(kern).toContain('export=true');
      expect(kern).toContain('binding name=a');
    });

    it('wraps complex source expressions in {{...}} ExprObject form', () => {
      const ts = `const { a } = getUser();`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).toContain('source={{ getUser() }}');
    });

    it('keeps simple identifier source bare (no {{...}} wrapping)', () => {
      const ts = `const { a } = user;`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).toContain('source=user');
      expect(kern).not.toContain('source={{');
    });
  });

  // ─── Decompiler round-trip ─────────────────────────────────────────────

  describe('decompile — round-trip', () => {
    it('round-trips a simple object pattern through decompile + parse + codegen', () => {
      const kern = ['destructure kind=const source=user', '  binding name=id', '  binding name=email'].join('\n');
      const ir = parse(kern);
      const decompiled = decompile(ir).code;
      expect(decompiled).toContain('destructure');
      expect(decompiled).toContain('binding name=id');
      expect(decompiled).toContain('binding name=email');
      // Re-parse + re-codegen should match original codegen.
      const round = generateCoreNode(parse(decompiled)).join('\n');
      expect(round).toContain('const { id, email } = user;');
    });

    it('round-trips an array pattern with a gap', () => {
      const kern = ['destructure kind=const source=tuple', '  element name=second index=1'].join('\n');
      const ir = parse(kern);
      const decompiled = decompile(ir).code;
      expect(decompiled).toContain('element name=second');
      expect(decompiled).toContain('index=1');
      const round = generateCoreNode(parse(decompiled)).join('\n');
      expect(round).toContain('const [, second] = tuple;');
    });

    it('round-trips the expr= escape hatch verbatim', () => {
      const kern = ['destructure expr={{ const { a, ...rest } = obj }}'].join('\n');
      const ir = parse(kern);
      const decompiled = decompile(ir).code;
      expect(decompiled).toContain('expr={{');
      expect(decompiled).toContain('...rest');
      const round = generateCoreNode(parse(decompiled)).join('\n');
      expect(round).toContain('const { a, ...rest } = obj');
    });

    it('round-trips a renamed binding (key=)', () => {
      const kern = ['destructure kind=const source=user', '  binding name=mail key=email'].join('\n');
      const ir = parse(kern);
      const decompiled = decompile(ir).code;
      expect(decompiled).toContain('binding name=mail');
      expect(decompiled).toContain('key=email');
      const round = generateCoreNode(parse(decompiled)).join('\n');
      expect(round).toContain('const { email: mail } = user;');
    });

    it('omits the default kind=const in the decompiled form', () => {
      const kern = ['destructure source=user', '  binding name=id'].join('\n');
      const ir = parse(kern);
      const decompiled = decompile(ir).code;
      // Decompile prefers the canonical short form: drop kind when it's the default.
      expect(decompiled).not.toMatch(/kind=const/);
    });
  });

  // ─── Capability matrix ─────────────────────────────────────────────────

  describe('capability matrix', () => {
    it('reports destructure-native as native on TS targets', () => {
      expect(capabilitySupport('web', 'destructure-native', 'top-level')).toBe('native');
      expect(capabilitySupport('lib', 'destructure-native', 'top-level')).toBe('native');
    });

    it('reports destructure-native as unsupported on FastAPI', () => {
      expect(capabilitySupport('fastapi', 'destructure-native', 'top-level')).toBe('unsupported');
    });
  });
});
