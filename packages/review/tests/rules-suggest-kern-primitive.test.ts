import { reviewSource } from '../src/index.js';

function kernSuggestions(ts: string) {
  const report = reviewSource(ts, 'input.ts');
  return report.findings.filter((f) => f.ruleId === 'suggest-kern-primitive');
}

describe('suggest-kern-primitive rule', () => {
  it('suggests `filter` for `.filter(x => pred)`', () => {
    const f = kernSuggestions('const active = users.filter((u) => u.active);');
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('info');
    expect(f[0].suggestion).toContain('filter name=<name> in=users item=u where="u.active"');
  });

  it('defaults to the `item` binding name without an explicit item= prop', () => {
    const f = kernSuggestions('const active = users.filter((item) => item.active);');
    expect(f[0].suggestion).toBe('filter name=<name> in=users where="item.active"');
  });

  it('suggests `map` with expr= (not where=)', () => {
    const f = kernSuggestions('const names = users.map((u) => u.profile.name);');
    expect(f[0].suggestion).toContain('map name=<name> in=users item=u expr="u.profile.name"');
  });

  it('suggests `reduce` with acc/item/initial/expr props', () => {
    const f = kernSuggestions('const total = items.reduce((acc, item) => acc + item.value, 0);');
    expect(f[0].suggestion).toBe(
      'reduce name=<name> in=items initial="0" expr="acc + item.value"',
    );
  });

  it('suggests `find` / `some` / `every` / `findIndex` with predicate shape', () => {
    const f = kernSuggestions(`
      const admin = users.find((u) => u.role === 'admin');
      const hasBad = results.some((r) => !r.ok);
      const allDone = tasks.every((t) => t.done);
      const pos = users.findIndex((u) => u.id === target);
    `);
    const byRule = f.map((x) => x.suggestion ?? '');
    expect(byRule.some((s) => s.startsWith('find name='))).toBe(true);
    expect(byRule.some((s) => s.startsWith('some name='))).toBe(true);
    expect(byRule.some((s) => s.startsWith('every name='))).toBe(true);
    expect(byRule.some((s) => s.startsWith('findIndex name='))).toBe(true);
  });

  it('suggests `slice` with only the supplied indices', () => {
    const both = kernSuggestions('const head = items.slice(0, 5);');
    expect(both[0].suggestion).toBe('slice name=<name> in=items start=0 end=5');

    const bareStart = kernSuggestions('const tail = items.slice(2);');
    expect(bareStart[0].suggestion).toBe('slice name=<name> in=items start=2');

    const copy = kernSuggestions('const copy = items.slice();');
    expect(copy[0].suggestion).toBe('slice name=<name> in=items');
  });

  it('suggests `at` with index= and `flat` with optional depth=', () => {
    const atF = kernSuggestions('const first = items.at(0);');
    expect(atF[0].suggestion).toBe('at name=<name> in=items index=0');

    const flatD = kernSuggestions('const flattened = nested.flat(2);');
    expect(flatD[0].suggestion).toBe('flat name=<name> in=nested depth=2');

    const flatBare = kernSuggestions('const flattened = nested.flat();');
    expect(flatBare[0].suggestion).toBe('flat name=<name> in=nested');
  });

  it('suggests `join` with or without a separator literal', () => {
    const withSep = kernSuggestions('const csv = fields.join(",");');
    expect(withSep[0].suggestion).toBe('join name=<name> in=fields separator=","');

    const bare = kernSuggestions('const joined = fields.join();');
    expect(bare[0].suggestion).toBe('join name=<name> in=fields');
  });

  it('suggests `includes` / `indexOf` / `lastIndexOf` with value= prop', () => {
    const inc = kernSuggestions('const has = items.includes(target);');
    expect(inc[0].suggestion).toBe('includes name=<name> in=items value="target"');

    const idx = kernSuggestions('const pos = items.indexOf("fatal", 5);');
    expect(idx[0].suggestion).toBe('indexOf name=<name> in=items value="\\"fatal\\"" from=5');
  });

  it('suggests `concat` with raw `with=` args', () => {
    const f = kernSuggestions('const all = items.concat(a, b, c);');
    expect(f[0].suggestion).toBe('concat name=<name> in=items with="a, b, c"');
  });

  it('flags `.sort()` and `.reverse()` with an immutability note', () => {
    const s = kernSuggestions('const sorted = items.sort((a, b) => a.age - b.age);');
    expect(s[0].suggestion).toContain('sort name=<name> in=items compare="a.age - b.age"');
    expect(s[0].suggestion).toContain('kern sort is immutable');

    const r = kernSuggestions('items.reverse();');
    expect(r[0].suggestion).toContain('reverse name=<name> in=items');
    expect(r[0].suggestion).toContain('kern reverse is immutable');
  });

  it('emits `forEach` as a handler-block shape (no name=)', () => {
    const f = kernSuggestions('items.forEach((item) => log(item));');
    expect(f[0].suggestion).toContain('forEach in=items');
    expect(f[0].suggestion).toContain('handler <<<');
    expect(f[0].suggestion).not.toContain('name=');
  });

  it('skips `.filter(Boolean)` — reserved for the future `compact` primitive', () => {
    const f = kernSuggestions('const truthy = items.filter(Boolean);');
    expect(f).toHaveLength(0);
  });

  it('skips multi-statement arrow bodies (block form needs a handler child)', () => {
    const f = kernSuggestions(`
      const parsed = lines.map((line) => {
        const trimmed = line.trim();
        return trimmed.split(':');
      });
    `);
    // Outer .map has a block body → skip. No suggestion.
    const mapSuggestions = f.filter((x) => x.suggestion?.startsWith('map '));
    expect(mapSuggestions).toHaveLength(0);
  });

  it('skips .d.ts files by path', () => {
    const report = reviewSource('export const x = items.filter((i) => i.ok);', 'types.d.ts');
    expect(report.findings.filter((f) => f.ruleId === 'suggest-kern-primitive')).toHaveLength(0);
  });

  it('emits multiple findings for a chained pipeline', () => {
    const f = kernSuggestions('const out = users.filter((u) => u.active).map((u) => u.name);');
    expect(f.length).toBeGreaterThanOrEqual(2);
    expect(f.some((x) => x.suggestion?.startsWith('filter '))).toBe(true);
    expect(f.some((x) => x.suggestion?.startsWith('map '))).toBe(true);
  });
});
