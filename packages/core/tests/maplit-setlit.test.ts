/** Slice 3e — native Map/Set literals at the statement level via `mapLit`
 *  + `mapEntry` and `setLit` + `setItem`. Codegens to `new Map([[k,v]])`
 *  and `new Set([v1, v2])`. The `expr={{...}}` escape hatch carries
 *  arbitrary TS for shapes the structured emitter can't represent.
 *
 *  Mirrors slice 3d (destructure) shape: schema + codegen + importer +
 *  decompiler + round-trip + capability matrix in one place. */

import { capabilitySupport } from '../src/capability-matrix.js';
import { generateCoreNode } from '../src/codegen-core.js';
import { decompile } from '../src/decompiler.js';
import { importTypeScript } from '../src/importer.js';
import { parse } from '../src/parser.js';

function gen(kern: string): string {
  return generateCoreNode(parse(kern)).join('\n');
}

describe('mapLit / setLit — slice 3e (native Map/Set literals)', () => {
  // ─── Codegen: mapLit ───────────────────────────────────────────────────

  describe('codegen — mapLit', () => {
    it('emits `new Map([["k", v], ...])` for string-keyed entries', () => {
      const code = gen(
        [
          'mapLit name=cache type="Map<string, number>"',
          '  mapEntry key="foo" value=1',
          '  mapEntry key="bar" value=2',
        ].join('\n'),
      );
      expect(code).toContain('const cache: Map<string, number> = new Map([["foo", 1], ["bar", 2]]);');
    });

    it('respects the export prefix and let kind', () => {
      const code = gen(
        ['mapLit name=cache type="Map<string, string>" export=true', '  mapEntry key="a" value="x"'].join('\n'),
      );
      expect(code).toContain('export const cache: Map<string, string> = new Map([["a", "x"]]);');

      const letCode = gen(
        ['mapLit name=cache type="Map<string, number>" kind=let', '  mapEntry key="a" value=1'].join('\n'),
      );
      expect(letCode).toContain('let cache:');
    });

    it('handles ExprObject keys and values for arbitrary TS', () => {
      const code = gen(
        [
          'mapLit name=registry type="Map<symbol, () => void>"',
          '  mapEntry key={{ Symbol.for("init") }} value={{ () => {} }}',
        ].join('\n'),
      );
      expect(code).toContain('new Map([[Symbol.for("init"), () => {}]])');
    });

    it('emits an empty `new Map([])` when there are no entries', () => {
      const code = gen(['mapLit name=empty type="Map<string, number>"'].join('\n'));
      expect(code).toContain('new Map([])');
    });

    it('expr={{...}} escape hatch overrides structured children', () => {
      const code = gen(
        [
          'mapLit name=cache expr={{ const cache: Map<string, number> = new Map(loadEntries()) }}',
          '  mapEntry key="ignored" value=1',
        ].join('\n'),
      );
      expect(code).toContain('new Map(loadEntries())');
      expect(code).not.toContain('"ignored"');
    });

    it('throws when a mapEntry is missing key=', () => {
      expect(() => gen(['mapLit name=bad', '  mapEntry value=1'].join('\n'))).toThrow();
    });

    it('throws when a mapEntry is missing value=', () => {
      expect(() => gen(['mapLit name=bad', '  mapEntry key="a"'].join('\n'))).toThrow();
    });
  });

  // ─── Codegen: setLit ───────────────────────────────────────────────────

  describe('codegen — setLit', () => {
    it('emits `new Set([v1, v2])` for primitive items', () => {
      const code = gen(
        ['setLit name=allowed type="Set<string>"', '  setItem value="admin"', '  setItem value="user"'].join('\n'),
      );
      expect(code).toContain('const allowed: Set<string> = new Set(["admin", "user"]);');
    });

    it('respects export prefix and kind=let', () => {
      const code = gen(
        ['setLit name=flags type="Set<number>" export=true kind=let', '  setItem value=1', '  setItem value=2'].join(
          '\n',
        ),
      );
      expect(code).toContain('export let flags: Set<number> = new Set([1, 2]);');
    });

    it('handles ExprObject items for arbitrary TS', () => {
      const code = gen(['setLit name=ports type="Set<number>"', '  setItem value={{ DEFAULT_PORT + 1 }}'].join('\n'));
      expect(code).toContain('new Set([DEFAULT_PORT + 1])');
    });

    it('emits an empty `new Set([])` when there are no items', () => {
      const code = gen(['setLit name=empty type="Set<string>"'].join('\n'));
      expect(code).toContain('new Set([])');
    });

    it('expr={{...}} escape hatch overrides structured children', () => {
      const code = gen(
        ['setLit name=allowed expr={{ const allowed = new Set(loadList()) }}', '  setItem value="ignored"'].join('\n'),
      );
      expect(code).toContain('new Set(loadList())');
      expect(code).not.toContain('"ignored"');
    });

    it('throws when a setItem is missing value=', () => {
      expect(() => gen(['setLit name=bad', '  setItem'].join('\n'))).toThrow();
    });
  });

  // ─── Importer ──────────────────────────────────────────────────────────

  describe('importer — TS → KERN', () => {
    it('converts `const m = new Map([["k", 1]])` into a structured mapLit', () => {
      const ts = `const m = new Map([["foo", 1], ["bar", 2]]);`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).toContain('mapLit name=m');
      expect(kern).toContain('mapEntry key="foo" value=1');
      expect(kern).toContain('mapEntry key="bar" value=2');
    });

    it('preserves the type annotation on the variable declaration', () => {
      const ts = `const m: Map<string, number> = new Map([["k", 1]]);`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).toContain('mapLit name=m');
      expect(kern).toContain('type="Map<string, number>"');
    });

    it('preserves export prefix and let kind', () => {
      const exportTs = `export const allowed = new Set(["a", "b"]);`;
      const exportKern = importTypeScript(exportTs, 'test.ts').kern;
      expect(exportKern).toContain('setLit name=allowed');
      expect(exportKern).toContain('export=true');

      const letTs = `let allowed = new Set(["a"]);`;
      const letKern = importTypeScript(letTs, 'test.ts').kern;
      expect(letKern).toContain('kind=let');
    });

    it('converts `const s = new Set([1, 2, 3])` into a structured setLit', () => {
      const ts = `const s = new Set([1, 2, 3]);`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).toContain('setLit name=s');
      expect(kern).toContain('setItem value=1');
      expect(kern).toContain('setItem value=2');
      expect(kern).toContain('setItem value=3');
    });

    it('falls back to legacy const for `new Map(notAnArrayLiteral)`', () => {
      const ts = `const m = new Map(loadEntries());`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      // Should NOT produce a mapLit because the constructor argument isn't a structurable array literal.
      expect(kern).not.toMatch(/^mapLit /m);
      expect(kern).toMatch(/^const name=m/m);
    });

    it('falls back to legacy const for spread inside a Set literal', () => {
      const ts = `const s = new Set([1, ...others]);`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).not.toMatch(/^setLit /m);
    });

    it('falls back when an entry is not a 2-element tuple', () => {
      const ts = `const m = new Map([["a", 1, 2]]);`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).not.toMatch(/^mapLit /m);
    });

    it('emits ExprObject form for non-string-literal Map keys', () => {
      const ts = `const m = new Map([[KEY, 1]]);`;
      const kern = importTypeScript(ts, 'test.ts').kern;
      expect(kern).toContain('mapLit name=m');
      expect(kern).toContain('key={{ KEY }}');
      // Numeric value flows through ValueIR — bare form per slice 3a-c precedent.
      expect(kern).toContain('value=1');
    });
  });

  // ─── Decompiler round-trip ─────────────────────────────────────────────

  describe('decompile — round-trip', () => {
    it('round-trips a mapLit through decompile + parse + codegen', () => {
      const kern = [
        'mapLit name=cache type="Map<string, number>"',
        '  mapEntry key="a" value=1',
        '  mapEntry key="b" value=2',
      ].join('\n');
      const ir = parse(kern);
      const decompiled = decompile(ir).code;
      expect(decompiled).toContain('mapLit name=cache');
      expect(decompiled).toContain('mapEntry');
      const round = generateCoreNode(parse(decompiled)).join('\n');
      expect(round).toContain('new Map([["a", 1], ["b", 2]])');
    });

    it('round-trips a setLit through decompile + parse + codegen', () => {
      const kern = ['setLit name=allowed type="Set<string>"', '  setItem value="admin"', '  setItem value="user"'].join(
        '\n',
      );
      const ir = parse(kern);
      const decompiled = decompile(ir).code;
      expect(decompiled).toContain('setLit name=allowed');
      expect(decompiled).toContain('setItem');
      const round = generateCoreNode(parse(decompiled)).join('\n');
      expect(round).toContain('new Set(["admin", "user"])');
    });

    it('round-trips the expr= escape hatch verbatim', () => {
      const kern = ['mapLit name=cache expr={{ const cache = new Map(loadEntries()) }}'].join('\n');
      const ir = parse(kern);
      const decompiled = decompile(ir).code;
      expect(decompiled).toContain('expr={{');
      const round = generateCoreNode(parse(decompiled)).join('\n');
      expect(round).toContain('new Map(loadEntries())');
    });
  });

  // ─── Capability matrix ─────────────────────────────────────────────────

  describe('capability matrix', () => {
    it('reports maplit-setlit-native as native on TS targets', () => {
      expect(capabilitySupport('web', 'maplit-setlit-native', 'top-level')).toBe('native');
      expect(capabilitySupport('lib', 'maplit-setlit-native', 'top-level')).toBe('native');
    });

    it('reports maplit-setlit-native as unsupported on FastAPI', () => {
      expect(capabilitySupport('fastapi', 'maplit-setlit-native', 'top-level')).toBe('unsupported');
    });
  });
});
