/** Slice 2g — `use` / `from` node tests.
 *
 *  Cross-`.kern` symbol resolution. Compositional shape:
 *    use path="./helper.kern"
 *      from name=foo
 *      from name=bar as=baz
 *      from name=qux export=true
 *
 *  Codegen emits a TS `import` statement. `.kern` source paths translate
 *  to `.js` in the output. `export=true` on a `from` child emits an
 *  additional `export { ... } from '...'` re-export line. */

import { capabilitySupport } from '../src/capability-matrix.js';
import { generateCoreNode, isCoreNode } from '../src/codegen-core.js';
import { parse } from '../src/parser.js';
import { isKnownNodeType, RESERVED_FUTURE_NAMES } from '../src/spec.js';

const gen = (src: string) => generateCoreNode(parse(src)).join('\n');

describe('Use/From node (Slice 2g)', () => {
  describe('spec changes', () => {
    test("'use' and 'from' are no longer reserved future names", () => {
      expect(RESERVED_FUTURE_NAMES.includes('use')).toBe(false);
      expect(RESERVED_FUTURE_NAMES.includes('from')).toBe(false);
    });

    test("'use' is a known core node type", () => {
      expect(isKnownNodeType('use')).toBe(true);
      expect(isCoreNode('use')).toBe(true);
    });

    test("'from' is a known core node type", () => {
      expect(isKnownNodeType('from')).toBe(true);
      expect(isCoreNode('from')).toBe(true);
    });
  });

  describe('codegen — single named import', () => {
    test('one binding, no alias', () => {
      const src = `use path="./helper.kern"
  from name=foo`;
      expect(gen(src)).toBe(`import { foo } from './helper.js';`);
    });

    test('aliased binding via as=', () => {
      const src = `use path="./helper.kern"
  from name=foo as=bar`;
      expect(gen(src)).toBe(`import { foo as bar } from './helper.js';`);
    });
  });

  describe('codegen — multiple bindings', () => {
    test('two bindings, mixed alias', () => {
      const src = `use path="./helper.kern"
  from name=foo
  from name=bar as=baz`;
      expect(gen(src)).toBe(`import { foo, bar as baz } from './helper.js';`);
    });

    test('three bindings, all bare', () => {
      const src = `use path="./helper.kern"
  from name=a
  from name=b
  from name=c`;
      expect(gen(src)).toBe(`import { a, b, c } from './helper.js';`);
    });
  });

  describe('codegen — re-exports (export=true)', () => {
    test('single re-export emits both import and export-from', () => {
      // `export=true` is an ADDITIONAL re-export marker, not a replacement
      // for the local import. Codex hold (slice 2g review): TS
      // `export { x } from '...'` is a forwarding re-export and does NOT
      // create a local binding, so a `from name=foo export=true` must emit
      // both lines if the user wants both behaviours.
      const src = `use path="./helper.kern"
  from name=foo export=true`;
      const out = gen(src);
      expect(out).toContain(`import { foo } from './helper.js';`);
      expect(out).toContain(`export { foo } from './helper.js';`);
    });

    test('mixed: one import + one re-export', () => {
      const src = `use path="./helper.kern"
  from name=foo
  from name=bar export=true`;
      const out = gen(src);
      // Both bindings get a local import; only `bar` is re-exported.
      expect(out).toContain(`import { foo, bar } from './helper.js';`);
      expect(out).toContain(`export { bar } from './helper.js';`);
    });

    test('aliased re-export creates local binding AND forwards under alias', () => {
      const src = `use path="./helper.kern"
  from name=foo as=bar export=true`;
      const out = gen(src);
      // Local: `bar` is bound to the imported `foo`.
      expect(out).toContain(`import { foo as bar } from './helper.js';`);
      // Re-export: forward under the alias name `bar` (not `foo`) so consumers
      // see `bar` exported, matching the local binding.
      expect(out).toContain(`export { foo as bar } from './helper.js';`);
    });
  });

  describe('path translation', () => {
    test('.kern source path becomes .js in TS output', () => {
      const src = `use path="./worker.kern"
  from name=helper`;
      expect(gen(src)).toContain(`from './worker.js';`);
      expect(gen(src)).not.toContain('.kern');
    });

    test('non-.kern path passes through unchanged', () => {
      // `use` is intended for `.kern` paths but should not corrupt other
      // specifiers if a user happens to point it at a JS module.
      const src = `use path="./already.js"
  from name=x`;
      expect(gen(src)).toContain(`from './already.js';`);
    });
  });

  describe('parse round-trip', () => {
    test('parses without throwing', () => {
      expect(() =>
        parse(`use path="./helper.kern"
  from name=foo
  from name=bar as=baz
  from name=qux export=true`),
      ).not.toThrow();
    });
  });

  describe('capability matrix', () => {
    test('cross-kern-import is native on TS targets', () => {
      expect(capabilitySupport('lib', 'cross-kern-import', 'top-level')).toBe('native');
      expect(capabilitySupport('nextjs', 'cross-kern-import', 'top-level')).toBe('native');
      expect(capabilitySupport('express', 'cross-kern-import', 'top-level')).toBe('native');
    });

    test('cross-kern-import is unsupported on Python (FastAPI)', () => {
      expect(capabilitySupport('fastapi', 'cross-kern-import', 'top-level')).toBe('unsupported');
    });
  });
});
