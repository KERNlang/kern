import { reviewSource } from '../src/index.js';

function kernSuggestions(ts: string, filePath = 'input.ts') {
  const report = reviewSource(ts, filePath);
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

  it('suggests `map` with expr= when the arrow body is a computed expression (not a property chain)', () => {
    const f = kernSuggestions('const tags = users.map((u) => u.name + u.title);');
    expect(f[0].suggestion).toContain('map name=<name> in=users item=u expr="u.name + u.title"');
  });

  it('suggests `reduce` with acc/item/initial/expr props', () => {
    const f = kernSuggestions('const total = items.reduce((acc, item) => acc + item.value, 0);');
    expect(f[0].suggestion).toBe('reduce name=<name> in=items initial="0" expr="acc + item.value"');
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
    // `target` is a non-literal identifier → wrap in `{{ … }}` so KERN
    //  parses it as a raw expression (not as a string literal).
    expect(inc[0].suggestion).toBe('includes name=<name> in=items value={{ target }}');

    const idx = kernSuggestions('const pos = items.indexOf("fatal", 5);');
    expect(idx[0].suggestion).toBe('indexOf name=<name> in=items value="\\"fatal\\"" from=5');
  });

  it('suggests `concat` with raw `with=` args', () => {
    const f = kernSuggestions('const all = items.concat(a, b, c);');
    // Concat args are spread raw — wrapped in `{{ … }}` so the parser
    // doesn't truncate at the first space.
    expect(f[0].suggestion).toBe('concat name=<name> in=items with={{ a, b, c }}');
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

  it('routes `.filter(Boolean)` to the `compact` primitive', () => {
    const f = kernSuggestions('const truthy = items.filter(Boolean);');
    expect(f).toHaveLength(1);
    expect(f[0].suggestion).toBe('compact name=<name> in=items');
    expect(f[0].message).toContain('compact');
  });

  it('routes `.filter(x => !!x)` to the `compact` primitive', () => {
    const f = kernSuggestions('const truthy = items.filter((x) => !!x);');
    expect(f).toHaveLength(1);
    expect(f[0].suggestion).toBe('compact name=<name> in=items');
  });

  it('routes `.filter(x => Boolean(x))` to the `compact` primitive', () => {
    const f = kernSuggestions('const truthy = items.filter((x) => Boolean(x));');
    expect(f).toHaveLength(1);
    expect(f[0].suggestion).toBe('compact name=<name> in=items');
  });

  it('does NOT route `.filter(x => !!x.prop)` to compact — that is a property-predicate filter', () => {
    const f = kernSuggestions('const activeOnly = users.filter((x) => !!x.active);');
    expect(f).toHaveLength(1);
    // `!!x.active` is predicate-over-prop; should route to `filter`, not `compact`.
    expect(f[0].suggestion?.startsWith('filter ')).toBe(true);
    expect(f[0].suggestion).not.toContain('compact');
  });

  it('does NOT route `.filter(x => !x)` to compact — single-negation is keep-falsy, the inverse', () => {
    const f = kernSuggestions('const falsy = items.filter((x) => !x);');
    // Single `!` keeps falsy values — opposite semantics from compact.
    const compacts = f.filter((x) => x.suggestion?.startsWith('compact'));
    expect(compacts).toHaveLength(0);
  });

  it('routes `.map(x => x.prop)` to the `pluck` primitive (single prop)', () => {
    const f = kernSuggestions('const names = users.map((u) => u.name);');
    expect(f).toHaveLength(1);
    expect(f[0].suggestion).toBe('pluck name=<name> in=users item=u prop=name');
    expect(f[0].message).toContain('pluck');
  });

  it('routes `.map(x => x.a.b.c)` to `pluck` with dot-path', () => {
    const f = kernSuggestions('const cities = users.map((item) => item.profile.address.city);');
    expect(f).toHaveLength(1);
    expect(f[0].suggestion).toBe('pluck name=<name> in=users prop=profile.address.city');
  });

  it('does NOT route `.map(x => x.method())` to pluck (method call, not property chain)', () => {
    const f = kernSuggestions('const upper = names.map((n) => n.toUpperCase());');
    expect(f).toHaveLength(1);
    expect(f[0].suggestion?.startsWith('map ')).toBe(true);
    expect(f[0].suggestion).not.toContain('pluck');
  });

  it('routes `[...new Set(coll)]` to the `unique` primitive', () => {
    const f = kernSuggestions('const distinct = [...new Set(items)];');
    const uniqueFindings = f.filter((x) => x.suggestion?.startsWith('unique '));
    expect(uniqueFindings).toHaveLength(1);
    expect(uniqueFindings[0].suggestion).toBe('unique name=<name> in=items');
  });

  it('reports registry-backed portable Set membership logic', () => {
    const f = kernSuggestions('const hasSelected = (new Set(items)).has(target);');
    const portable = f.filter((x) => x.suggestion?.startsWith('portable logic primitive collection.has'));
    expect(portable).toHaveLength(1);
    expect(portable[0].message).toContain('collection.has');
    expect(portable[0].message).toContain('stable: ts, python');
    expect(portable[0].message).toContain('unsupported: go');
  });

  it('reports registry-backed portable Date epoch conversion logic', () => {
    const f = kernSuggestions('const ms = (new Date(input)).getTime();');
    const portable = f.filter((x) => x.suggestion?.startsWith('portable logic primitive time.epochMs'));
    expect(portable).toHaveLength(1);
    expect(portable[0].message).toContain('time.epochMs');
  });

  it('reports simple registry-backed portable boolean negation without mislabeling double negation', () => {
    const f = kernSuggestions(`
      const hidden = !visible;
      const truthy = !!value;
      items.filter((x) => !!x);
    `);
    const portable = f.filter((x) => x.suggestion?.startsWith('portable logic primitive logic.not'));
    expect(portable).toHaveLength(1);
    expect(portable[0].suggestion).toBe('portable logic primitive logic.not: !visible');
  });

  it('reports registry-backed portable numeric clamp logic', () => {
    const f = kernSuggestions(`
      const bounded = Math.max(0, Math.min(100, score));
      const inverted = Math.min(config.max, Math.max(config.min, score));
    `);
    const portable = f.filter((x) => x.message.includes('number.clamp'));
    expect(portable).toHaveLength(2);
    expect(portable[0].suggestion).toBe('clamp name=bounded value={{ score }} min={{ 0 }} max={{ 100 }}');
    expect(portable[1].suggestion).toBe(
      'clamp name=inverted value={{ score }} min={{ config.min }} max={{ config.max }}',
    );
    expect(portable[0].message).toContain('number.clamp');
    expect(portable[0].message).toContain('stable: ts, python');
  });

  it('keeps camelCase clamp bounds in the right suggestion positions', () => {
    const f = kernSuggestions(`
      const bounded = Math.min(maxValue, Math.max(minValue, score));
    `);
    const portable = f.filter((x) => x.message.includes('number.clamp'));
    expect(portable).toHaveLength(1);
    expect(portable[0].suggestion).toBe('clamp name=bounded value={{ score }} min={{ minValue }} max={{ maxValue }}');
  });

  it('falls back to generic clamp suggestion when value and bound are ambiguous', () => {
    const f = kernSuggestions(`
      const bounded = Math.max(a, Math.min(b, c));
    `);
    const portable = f.filter((x) => x.message.includes('number.clamp'));
    expect(portable).toHaveLength(1);
    expect(portable[0].suggestion).toBe('portable logic primitive number.clamp: Math.max(a, Math.min(b, c))');
  });

  it('does not report clamp logic when Math is shadowed or bounds can have side effects', () => {
    const shadowed = kernSuggestions(`
      const Math = { max: (...xs) => xs[0], min: (...xs) => xs[0] };
      const bounded = Math.max(0, Math.min(100, score));
    `);
    expect(shadowed.filter((x) => x.suggestion?.includes('primitive number.clamp'))).toHaveLength(0);

    const sideEffecting = kernSuggestions(`
      const bounded = Math.max(nextLow(), Math.min(100, score));
      const alsoNo = Math.min(100, Math.max(nextLow(), score));
    `);
    expect(sideEffecting.filter((x) => x.suggestion?.includes('primitive number.clamp'))).toHaveLength(0);

    const nestedSideEffecting = kernSuggestions(`
      const a = Math.max(bounds[next()], Math.min(100, score));
      const b = Math.max(arr[i++], Math.min(100, score));
      const c = Math.max(getBounds().low, Math.min(100, score));
      const d = Math.max(++lo, Math.min(100, score));
    `);
    expect(nestedSideEffecting.filter((x) => x.suggestion?.includes('primitive number.clamp'))).toHaveLength(0);
  });

  it('does not report nested Math min/max as clamp unless a clear value operand is present', () => {
    const constantsOnly = kernSuggestions(`
      const folded = Math.max(0, Math.min(100, 50));
      const alsoFolded = Math.min(100, Math.max(0, -5));
    `);
    expect(constantsOnly.filter((x) => x.suggestion?.includes('primitive number.clamp'))).toHaveLength(0);

    const computedValue = kernSuggestions('const bounded = Math.max(0, Math.min(100, score + bonus));');
    expect(computedValue.filter((x) => x.suggestion?.includes('primitive number.clamp'))).toHaveLength(0);
  });

  it('does not report clamp when numeric literal bounds are reversed', () => {
    const f = kernSuggestions(`
      const a = Math.max(100, Math.min(0, score));
      const b = Math.min(0, Math.max(100, score));
      const c = Math.max(0, Math.min(-1, score));
    `);
    expect(f.filter((x) => x.suggestion?.includes('primitive number.clamp'))).toHaveLength(0);
  });

  it('does not report numeric clamp for non-numeric literal bounds', () => {
    const f = kernSuggestions(`
      const a = Math.max("a", Math.min("z", score));
      const b = Math.max(null, Math.min(true, score));
    `);
    expect(f.filter((x) => x.suggestion?.includes('primitive number.clamp'))).toHaveLength(0);
  });

  it('reports registry-backed portable Object data-shaping logic', () => {
    const f = kernSuggestions(`
      const keys = Object.keys(row);
      const values = Object.values(row);
      const entries = Object.entries(row);
    `);
    const suggestions = f.map((x) => x.suggestion ?? '');
    expect(suggestions).toContain('portable logic primitive object.keys: Object.keys(row)');
    expect(suggestions).toContain('portable logic primitive object.values: Object.values(row)');
    expect(suggestions).toContain('portable logic primitive object.entries: Object.entries(row)');
  });

  it('reports registry-backed portable string data-shaping logic', () => {
    const f = kernSuggestions(`
      const clean = title.trim();
      const parts = clean.split(",", 2);
      const first = clean.replace("-", " ");
      const all = clean.replaceAll("-", " ");
    `);
    const suggestions = f.map((x) => x.suggestion ?? '');
    expect(suggestions).toContain('portable logic primitive string.trim: title.trim()');
    expect(suggestions).toContain('portable logic primitive string.split: clean.split(",", 2)');
    expect(suggestions).toContain('portable logic primitive string.replaceFirst: clean.replace("-", " ")');
    expect(suggestions).toContain('portable logic primitive string.replaceAll: clean.replaceAll("-", " ")');
  });

  it('reports local string literal aliases for string search/replacement logic', () => {
    const f = kernSuggestions(`
      const comma = ",";
      const dash = "-";
      const space = " ";
      const parts = clean.split(comma);
      const first = clean.replace(dash, space);
    `);
    const suggestions = f.map((x) => x.suggestion ?? '');
    expect(suggestions).toContain('portable logic primitive string.split: clean.split(comma)');
    expect(suggestions).toContain('portable logic primitive string.replaceFirst: clean.replace(dash, space)');
  });

  it('does not report unresolved string search/replacement values as portable string primitives', () => {
    const f = kernSuggestions(`
      function parse(clean, sep, replacement) {
        const parts = clean.split(sep);
        const first = clean.replace("-", replacement);
        return { parts, first };
      }
    `);
    const portableString = f.filter((x) => x.suggestion?.includes('primitive string.'));
    expect(portableString).toHaveLength(0);
  });

  it('does not report regex-backed string logic as portable string primitives', () => {
    const f = kernSuggestions(`
      const parts = clean.split(/,\\s*/);
      const first = clean.replace(/-/g, " ");
      const all = clean.replaceAll(/-/g, " ");
    `);
    const portableString = f.filter((x) => x.suggestion?.includes('primitive string.'));
    expect(portableString).toHaveLength(0);
  });

  it('does not report RegExp constructor or regex variable string logic as portable string primitives', () => {
    const f = kernSuggestions(`
      const sep = new RegExp(",\\\\s*");
      const dash = /-/g;
      const colon = RegExp(":");
      const sepAlias = sep;
      const parts = clean.split(sep);
      const aliasParts = clean.split(sepAlias);
      const first = clean.replace(dash, " ");
      const all = clean.replaceAll(colon, " ");
      const grouped = clean.replace((/-/g), " ");
    `);
    const portableString = f.filter((x) => x.suggestion?.includes('primitive string.'));
    expect(portableString).toHaveLength(0);
  });

  it('does not report replacement-callback string logic as portable string primitives', () => {
    const f = kernSuggestions(`
      function up(match) {
        return match.toUpperCase();
      }
      const lower = (match) => match.toLowerCase();
      const lowerAlias = lower;
      const first = clean.replace("-", (match) => match.toUpperCase());
      const namedFirst = clean.replace("-", up);
      const groupedFirst = clean.replace("-", ((match) => match.toUpperCase()));
      const all = clean.replaceAll("-", lowerAlias);
    `);
    const portableString = f.filter((x) => x.suggestion?.includes('primitive string.'));
    expect(portableString).toHaveLength(0);
  });

  it('does not report replacement strings with JS substitution tokens as portable string primitives', () => {
    const f = kernSuggestions(`
      const first = clean.replace("-", "$&");
      const all = clean.replaceAll("-", \`$$\`);
    `);
    const portableString = f.filter((x) => x.suggestion?.includes('primitive string.'));
    expect(portableString).toHaveLength(0);
  });

  it('does not report string primitives for arities outside registry scope', () => {
    const f = kernSuggestions(`
      const a = title.trim("left");
      const b = clean.split();
      const c = clean.replace("x");
      const d = clean.replaceAll("x");
    `);
    const portableString = f.filter((x) => x.suggestion?.includes('primitive string.'));
    expect(portableString).toHaveLength(0);
  });

  it('does not report empty string search values as portable string primitives', () => {
    const f = kernSuggestions(`
      const empty = "";
      const parts = clean.split("");
      const aliasParts = clean.split(empty);
      const first = clean.replace("", "x");
      const all = clean.replaceAll(empty, "x");
    `);
    const portableString = f.filter((x) => x.suggestion?.includes('primitive string.'));
    expect(portableString).toHaveLength(0);
  });

  it('does not recurse forever on cyclic string literal aliases', () => {
    const f = kernSuggestions(`
      const a = b;
      const b = a;
      const parts = clean.split(a);
    `);
    const portableString = f.filter((x) => x.suggestion?.includes('primitive string.'));
    expect(portableString).toHaveLength(0);
  });

  it('does not report Object portable logic for non-registered methods or wrong arity', () => {
    const f = kernSuggestions(`
      const assigned = Object.assign({}, defaults);
      const defined = Object.defineProperty({}, "x", {});
      const empty = Object.keys();
      const keys = Object.keys(assigned, defaults);
    `);
    const objectPortable = f.filter((x) => x.suggestion?.includes('primitive object.'));
    expect(objectPortable).toHaveLength(0);
  });

  it('does not report Object portable logic when Object is locally shadowed', () => {
    const f = kernSuggestions(`
      const Object = { keys(value) { return value.customKeys; } };
      const keys = Object.keys(row);
    `);
    const objectPortable = f.filter((x) => x.suggestion?.includes('primitive object.'));
    expect(objectPortable).toHaveLength(0);
  });

  it('does not report Object portable logic when Object is imported or destructured', () => {
    const imported = kernSuggestions(`
      import Object from "./local-object";
      const keys = Object.keys(row);
    `);
    expect(imported.filter((x) => x.suggestion?.includes('primitive object.'))).toHaveLength(0);

    const destructured = kernSuggestions(`
      const { Object } = env;
      const keys = Object.keys(row);
    `);
    expect(destructured.filter((x) => x.suggestion?.includes('primitive object.'))).toHaveLength(0);
  });

  it('detects .split() with separator only as portable string.split', () => {
    const f = kernSuggestions('const parts = line.split(",");');
    const portableString = f.filter((x) => x.suggestion?.includes('primitive string.split'));
    expect(portableString).toHaveLength(1);
    expect(portableString[0].message).toContain('JS string.split is covered');
  });

  it('stacks compact + pluck for `.filter(Boolean).map(x => x.name)`', () => {
    const f = kernSuggestions('const names = items.filter(Boolean).map((i) => i.name);');
    const suggestions = f.map((x) => x.suggestion ?? '');
    expect(suggestions.some((s) => s.startsWith('compact name='))).toBe(true);
    expect(suggestions.some((s) => s.startsWith('pluck name='))).toBe(true);
  });

  // ── Post-review edge cases ──────────────────────────────────────────

  it('skips .map/.filter arrows that use the index parameter', () => {
    // `(x, i) => i === 0` references `i`, which KERN's predicate/expr
    // primitives do not bind. Skip to avoid emitting a migration that
    // drops the index reference.
    const f = kernSuggestions('const firstOnly = items.filter((x, i) => i === 0);');
    expect(f).toHaveLength(0);

    const g = kernSuggestions('const withIndex = items.map((x, i) => i);');
    expect(g).toHaveLength(0);
  });

  it('skips pluck when the property access is optional-chained', () => {
    // `u.profile?.name` would route to `pluck prop=profile.name`, which
    // emits `item.profile.name` — throws on null profile. Fall back to
    // plain `map` with the full expression preserved.
    const f = kernSuggestions('const cityNames = users.map((u) => u.profile?.name);');
    expect(f).toHaveLength(1);
    expect(f[0].suggestion?.startsWith('map name=')).toBe(true);
    expect(f[0].suggestion).toContain('expr="u.profile?.name"');
  });

  it('routes non-literal join separators through the raw-expression form', () => {
    const f = kernSuggestions('const out = fields.join(delim);');
    expect(f[0].suggestion).toBe('join name=<name> in=fields separator={{ delim }}');
  });

  it('wraps complex receivers in raw-expression form for `in=`', () => {
    const f = kernSuggestions('const out = users.filter((u) => u.active).filter((u) => u.admin);');
    // At least one finding should reference the chained receiver via `{{ … }}`.
    const hasWrappedIn = f.some((x) => /in=\{\{ .*\}\}/.test(x.suggestion ?? ''));
    expect(hasWrappedIn).toBe(true);
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
    // `.map((u) => u.name + u.tag)` is a computed expression, not a property chain,
    // so it routes to `map`, not `pluck` — paired with the `filter` predicate.
    const f = kernSuggestions('const out = users.filter((u) => u.active).map((u) => u.name + u.tag);');
    expect(f.length).toBeGreaterThanOrEqual(2);
    expect(f.some((x) => x.suggestion?.startsWith('filter '))).toBe(true);
    expect(f.some((x) => x.suggestion?.startsWith('map '))).toBe(true);
  });

  // ── fmt detector ────────────────────────────────────────────────────

  describe('fmt detector', () => {
    it('suggests `fmt` for a template literal initializer', () => {
      const f = kernSuggestions('const label = `${count} files`;');
      const fmt = f.filter((x) => x.suggestion?.startsWith('fmt '));
      expect(fmt).toHaveLength(1);
      expect(fmt[0].suggestion).toBe('fmt name=label template="${count} files"');
    });

    it('preserves multiple ${…} placeholders and surrounding text verbatim', () => {
      const f = kernSuggestions('const greet = `Hello, ${first} ${last}!`;');
      const fmt = f.filter((x) => x.suggestion?.startsWith('fmt '));
      expect(fmt[0].suggestion).toBe('fmt name=greet template="Hello, ${first} ${last}!"');
    });

    it('escapes embedded double-quotes in the template body', () => {
      const f = kernSuggestions('const q = `said "${who}" loudly`;');
      const fmt = f.filter((x) => x.suggestion?.startsWith('fmt '));
      expect(fmt[0].suggestion).toBe('fmt name=q template="said \\"${who}\\" loudly"');
    });

    it('does NOT fire on plain (no-substitution) template strings', () => {
      const f = kernSuggestions('const s = `no placeholders`;');
      const fmt = f.filter((x) => x.suggestion?.startsWith('fmt '));
      expect(fmt).toHaveLength(0);
    });

    it('skips destructured bindings (no single name= target)', () => {
      // Not a realistic shape, but guards the guard.
      const f = kernSuggestions('const [a] = [`${x}`];');
      const fmt = f.filter((x) => x.suggestion?.startsWith('fmt '));
      expect(fmt).toHaveLength(0);
    });

    it('suggests `fmt return=true` for a template in return position', () => {
      const src = `
        function label(count) {
          return \`\${count} files\`;
        }
      `;
      const f = kernSuggestions(src);
      const fmt = f.filter((x) => x.suggestion?.startsWith('fmt return=true'));
      expect(fmt).toHaveLength(1);
      expect(fmt[0].suggestion).toBe('fmt return=true template="${count} files"');
      expect(fmt[0].message).toContain('fmt return=true');
    });

    it('does NOT fire on an arrow that directly returns a template', () => {
      // `(x) => \`\${x}!\`` — the template is the arrow body (no return statement)
      // so this is skipped; only explicit `return \`…\`` fires the return-position hint.
      const f = kernSuggestions('const g = (x) => `${x}!`;');
      const fmt = f.filter((x) => x.suggestion?.startsWith('fmt return=true'));
      expect(fmt).toHaveLength(0);
    });

    it('does NOT fire when a template is passed as a call argument', () => {
      const f = kernSuggestions('log(`${x} items`);');
      const fmt = f.filter((x) => x.suggestion?.startsWith('fmt '));
      expect(fmt).toHaveLength(0);
    });
  });

  // ── conditional JSX detector ────────────────────────────────────────

  describe('conditional JSX detector', () => {
    it('suggests `conditional` for a JSX ternary inside a JSX expression', () => {
      const src = 'const X = () => (<div>{loading ? <Spinner /> : <Content />}</div>);';
      const f = kernSuggestions(src, 'input.tsx');
      const cond = f.filter((x) => x.suggestion?.startsWith('conditional '));
      expect(cond).toHaveLength(1);
      expect(cond[0].suggestion).toContain('conditional if="loading"');
      expect(cond[0].suggestion).toContain('handler <<<');
      expect(cond[0].suggestion).toContain('<Spinner />');
      expect(cond[0].suggestion).toContain('else');
      expect(cond[0].suggestion).toContain('<Content />');
    });

    it('does NOT fire when either branch is non-JSX (e.g. null)', () => {
      const src = 'const X = () => (<div>{show ? <A /> : null}</div>);';
      const f = kernSuggestions(src, 'input.tsx');
      const cond = f.filter((x) => x.suggestion?.startsWith('conditional '));
      expect(cond).toHaveLength(0);
    });

    it('does NOT fire on a value-level ternary outside JSX', () => {
      const src = 'const view = flag ? "<A />" : "<B />";';
      const f = kernSuggestions(src, 'input.tsx');
      const cond = f.filter((x) => x.suggestion?.startsWith('conditional '));
      expect(cond).toHaveLength(0);
    });

    it('escapes quotes in the condition expression', () => {
      const src = 'const X = () => (<div>{tag === "admin" ? <A /> : <B />}</div>);';
      const f = kernSuggestions(src, 'input.tsx');
      const cond = f.filter((x) => x.suggestion?.startsWith('conditional '));
      expect(cond[0].suggestion).toContain('if="tag === \\"admin\\""');
    });
  });

  // ── async try/catch detector ────────────────────────────────────────

  describe('async try/catch detector', () => {
    it('suggests `async` + `recover/strategy` for an async fn whose body is try/catch', () => {
      const src = `
        async function loadUser(id) {
          try {
            const u = await fetch(id);
            return u;
          } catch (e) {
            console.error(e);
          }
        }
      `;
      const f = kernSuggestions(src);
      const async = f.filter((x) => x.suggestion?.startsWith('async '));
      expect(async).toHaveLength(1);
      expect(async[0].suggestion).toContain('async name=loadUser');
      expect(async[0].suggestion).toContain('handler <<<');
      expect(async[0].suggestion).toContain('await fetch(id)');
      expect(async[0].suggestion).toContain('recover');
      expect(async[0].suggestion).toContain('strategy <<<');
      expect(async[0].suggestion).toContain('console.error(e)');
    });

    it('picks up the variable name for an async arrow initializer', () => {
      const src = `
        const loadPosts = async () => {
          try {
            await fetch('/posts');
          } catch (e) {
            throw e;
          }
        };
      `;
      const f = kernSuggestions(src);
      const async = f.filter((x) => x.suggestion?.startsWith('async '));
      expect(async[0].suggestion).toContain('async name=loadPosts');
    });

    it('does NOT fire when the try body has no await', () => {
      const src = `
        async function noAwait() {
          try {
            return 1;
          } catch (e) {
            return 0;
          }
        }
      `;
      const f = kernSuggestions(src);
      const async = f.filter((x) => x.suggestion?.startsWith('async '));
      expect(async).toHaveLength(0);
    });

    it('does NOT fire on a non-async function with try/catch', () => {
      const src = `
        function sync() {
          try {
            return 1;
          } catch (e) {
            return 0;
          }
        }
      `;
      const f = kernSuggestions(src);
      const async = f.filter((x) => x.suggestion?.startsWith('async '));
      expect(async).toHaveLength(0);
    });

    it('does NOT fire when the body mixes statements around the try', () => {
      const src = `
        async function mixed() {
          const pre = 1;
          try {
            await fetch('/x');
          } catch (e) {
            return pre;
          }
        }
      `;
      const f = kernSuggestions(src);
      const async = f.filter((x) => x.suggestion?.startsWith('async '));
      expect(async).toHaveLength(0);
    });

    it('does NOT fire when there is no catch clause', () => {
      const src = `
        async function finallyOnly() {
          try {
            await fetch('/x');
          } finally {
            done();
          }
        }
      `;
      const f = kernSuggestions(src);
      const async = f.filter((x) => x.suggestion?.startsWith('async '));
      expect(async).toHaveLength(0);
    });
  });
});
