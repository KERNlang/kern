import { Project } from 'ts-morph';
import { extractTsConcepts } from '../../src/mappers/ts-concepts.js';

// Phase B (corrected scope per OpenCode's campfire convergence): annotate
// every populated `sentFields` entry with a coarse TS type tag. Lifts
// cross-stack rules from "name overlap" precision to "name + type
// overlap" — catches the `userId: string` (client) vs `userId: number`
// (server) drift that pure-name matching misses.

describe('TS sent field type extraction (phase B)', () => {
  const project = () => new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });

  function effectOf(file: string, src: string) {
    const p = project();
    const map = extractTsConcepts(p.createSourceFile(file, `export {};\n${src}`), file);
    const effects = map.nodes.filter(
      (n) => n.kind === 'effect' && n.payload.kind === 'effect' && n.payload.subtype === 'network',
    );
    if (effects.length !== 1) throw new Error(`expected 1 network effect, got ${effects.length}`);
    const e = effects[0];
    if (e.payload.kind !== 'effect') throw new Error('not an effect payload');
    return e.payload;
  }

  // ── Literal-object body, syntactic value-position recognition ──────

  it('tags primitive-literal values: string / number / boolean / null', () => {
    const src = `
      async function f() {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify({ name: 'alice', age: 30, active: true, deleted: null }),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFields).toEqual(['name', 'age', 'active', 'deleted']);
    expect(p.sentFieldTypes).toEqual({
      name: 'string',
      age: 'number',
      active: 'boolean',
      deleted: 'null',
    });
  });

  it('tags template-literal value as string (not object)', () => {
    const src = `
      async function f(slug: string) {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify({ greeting: \`hello, \${slug}\` }),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFieldTypes).toEqual({ greeting: 'string' });
  });

  it('tags negative-numeric prefix (`-1`) as number', () => {
    const src = `
      async function f() {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify({ delta: -42 }),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFieldTypes).toEqual({ delta: 'number' });
  });

  it('tags object and array literal values', () => {
    const src = `
      async function f() {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify({ meta: { trace: 'x' }, ids: [1, 2, 3] }),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFieldTypes).toEqual({ meta: 'object', ids: 'array' });
  });

  it('tags shorthand-property values from their inferred TS type', () => {
    const src = `
      async function f(rating: number, reviewer: string) {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify({ rating, reviewer }),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFieldTypes).toEqual({ rating: 'number', reviewer: 'string' });
  });

  it('tags `x ?? null` shorthand-style value-expression as the unioned type without `null`', () => {
    // `T | null` should coarsen to `T` since `null` is treated as a
    // `null`-tag absorbed at the union-coalescing step. Real audiofacets
    // pattern: `versionIndex: versionIndex ?? null`.
    const src = `
      async function f(versionIndex: number | undefined) {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify({ versionIndex: versionIndex ?? null }),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFieldTypes).toEqual({ versionIndex: 'number' });
  });

  it('emits `unknown` rather than dropping a field whose value-expression resists coarsening', () => {
    // `Math.random() > 0.5 ? 'a' : 42` — string|number heterogeneous union
    // coarsens to `unknown`. The field is still emitted (so cross-stack
    // rules can choose to skip 'unknown' tags or treat them as wildcards)
    // but never silently disappears from the type map.
    const src = `
      async function f() {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify({ blob: Math.random() > 0.5 ? 'a' : 42 }),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFields).toEqual(['blob']);
    expect(p.sentFieldTypes).toEqual({ blob: 'unknown' });
  });

  // ── Typed payload variable, TS type-checker driven ─────────────────

  it('tags fields from a typed-variable payload using TS property types', () => {
    const src = `
      interface CreateUser { id: string; age: number; admin: boolean; }
      async function f(payload: CreateUser) {
        await fetch('/api/users', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFields).toEqual(['admin', 'age', 'id']); // sorted
    expect(p.sentFieldTypes).toEqual({ id: 'string', age: 'number', admin: 'boolean' });
  });

  it('tags a typed-variable union member like `string | null` as `string` (null absorbed)', () => {
    const src = `
      interface Item { label: string | null; count: number; }
      async function f(item: Item) {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify(item),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFieldTypes).toEqual({ label: 'string', count: 'number' });
  });

  it('tags a typed-variable nested-object property as `object`', () => {
    const src = `
      interface Outer { meta: { trace: string }; tag: string; }
      async function f(outer: Outer) {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify(outer),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFieldTypes).toEqual({ meta: 'object', tag: 'string' });
  });

  // ── Bail-paths preserve current behaviour ─────────────────────────

  it('returns no sentFieldTypes when the body is `unknown` (existing bail)', () => {
    const src = `
      async function f(body: unknown) {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFields).toBeUndefined();
    expect(p.sentFieldsResolved).toBe(false);
    expect(p.sentFieldTypes).toBeUndefined();
  });

  it('returns no sentFieldTypes when the body is a spread (`{ ...x }`)', () => {
    const src = `
      async function f(other: { y: string }) {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify({ ...other, y: 'b' }),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFields).toBeUndefined();
    expect(p.sentFieldTypes).toBeUndefined();
  });

  it('returns no sentFieldTypes when there is no body at all (GET)', () => {
    const src = `
      async function f() {
        await fetch('/api/x');
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFields).toBeUndefined();
    expect(p.sentFieldTypes).toBeUndefined();
  });

  it('emits an empty sentFieldTypes when sentFields is empty (no-op typed payload)', () => {
    const src = `
      interface Empty {}
      async function f(empty: Empty) {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify(empty),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFields).toEqual([]);
    expect(p.sentFieldTypes).toEqual({});
  });

  // ── Codex review fixes (2026-05-04) ──────────────────────────────────

  it('coarsens branded primitives `string & { __brand }` to the underlying primitive', () => {
    // Real ID-type pattern. Without intersection support these collapse
    // to 'unknown' and lose exactly the signal this feature is meant to add.
    const src = `
      type UserId = string & { readonly __brand: 'UserId' };
      type Count = number & { readonly __brand: 'Count' };
      interface Body { id: UserId; count: Count; tag: string; }
      async function f(body: Body) {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFieldTypes).toEqual({ id: 'string', count: 'number', tag: 'string' });
  });

  it('tags `+stringValue` as number — unary `+` always yields number, not the operand type', () => {
    // `+x` coerces to number regardless of operand type. The original code
    // recursed into the operand and would have returned 'string' here.
    const src = `
      async function f(s: string) {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify({ count: +s }),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFieldTypes).toEqual({ count: 'number' });
  });

  it('tags `!x` as boolean regardless of operand type', () => {
    const src = `
      async function f(thing: { value: number }) {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify({ empty: !thing }),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFieldTypes).toEqual({ empty: 'boolean' });
  });

  it('tags bare `undefined` value as `unknown`, NOT `null` (different wire shape)', () => {
    // `JSON.stringify({x: undefined})` omits `x` entirely; not the same as
    // `{x: null}`. The mapper now keeps the field name (sentFields) but
    // tags the type as `unknown` so downstream rules don't false-match
    // against explicit-null fields.
    const src = `
      async function f(u: undefined) {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify({ x: u }),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFields).toEqual(['x']);
    expect(p.sentFieldTypes).toEqual({ x: 'unknown' });
  });

  it('still preserves the union absorption for `T | undefined`', () => {
    // The fix for bare-undefined must NOT regress the `T | undefined → T`
    // union-absorption (which was correct before).
    const src = `
      interface Item { v?: number; }
      async function f(item: Item) {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify({ v: item.v }),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    // `item.v` is `number | undefined` — coarsens to 'number' after
    // dropping the undefined branch.
    expect(p.sentFieldTypes).toEqual({ v: 'number' });
  });

  it('still preserves the union absorption for `T | null`', () => {
    const src = `
      interface Item { label: string | null; }
      async function f(item: Item) {
        await fetch('/api/x', {
          method: 'POST',
          body: JSON.stringify({ label: item.label }),
        });
      }
    `;
    const p = effectOf('/t/a.ts', src);
    expect(p.sentFieldTypes).toEqual({ label: 'string' });
  });
});
