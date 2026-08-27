import { reviewSource } from '../src/index.js';

describe('Null Safety Rules', () => {
  // ── unchecked-find ─────────────────────────────────────────────────────

  it('should flag .find() result used without null check', () => {
    const source = `
      const users = [{ id: 1, name: 'Alice' }];
      const user = users.find(u => u.id === 2);
      console.log(user.name);
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'unchecked-find');
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('.find()');
    expect(findings[0].message).toContain('user');
  });

  it('should not flag .find() when result is guarded', () => {
    const source = `
      const users = [{ id: 1, name: 'Alice' }];
      const user = users.find(u => u.id === 2);
      if (user) {
        console.log(user.name);
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'unchecked-find');
    expect(findings.length).toBe(0);
  });

  it('should not flag .find() after an exact assert.ok(identifier) narrowing assertion', () => {
    const source = `
      import assert from 'node:assert/strict';
      const users = [{ id: 1, name: 'Alice' }];
      function nameOf(id: number): string {
        const identifier = users.find((user) => user.id === id);
        assert.ok(identifier, 'expected user');
        return identifier.name;
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'unchecked-find');
    expect(findings).toHaveLength(0);
  });

  it('still flags unrelated and post-dereference assertions', () => {
    const source = `
      import assert from 'node:assert/strict';
      const users = [{ id: 1, name: 'Alice' }];
      function unrelated(id: number): string {
        const identifier = users.find((user) => user.id === id);
        const other = users.find((user) => user.id === id + 1);
        assert.ok(other);
        return identifier.name;
      }
      function tooLate(id: number): string {
        const identifier = users.find((user) => user.id === id);
        const name = identifier.name;
        assert.ok(identifier);
        return name;
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'unchecked-find');
    expect(findings.length).toBeGreaterThanOrEqual(2);
  });

  it('does not treat a different assertion method as assert.ok narrowing', () => {
    const source = `
      import assert from 'node:assert/strict';
      const users = [{ id: 1, name: 'Alice' }];
      const identifier = users.find((user) => user.id === 1);
      assert.equal(identifier, true);
      console.log(identifier.name);
    `;
    const report = reviewSource(source, 'test.ts');
    expect(report.findings.find((finding) => finding.ruleId === 'unchecked-find')).toBeDefined();
  });

  // Regression: kern-sight review-panel.ts:6264 — `if (!a || !b) continue;`
  // narrows `b` for all later uses, but the old regex required the var to
  // appear immediately after `if (`. Now we check structurally for any
  // early-exit if-statement whose condition includes !varName.
  it('should not flag .find() result used after `if (!a || !b) continue;` early-exit', () => {
    const source = `
      const items = [{ id: 1, x: 0, y: 0 }];
      function run(): number {
        let total = 0;
        for (const it of items) {
          const a = items.find(i => i.id === it.id);
          const b = items.find(i => i.id === it.id + 1);
          if (!a || !b) continue;
          total += b.y;
        }
        return total;
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'unchecked-find');
    expect(findings.length).toBe(0);
  });

  it('should not flag .find() result used after `if (!user) return;`', () => {
    const source = `
      const users = [{ id: 1, name: 'Alice' }];
      function nameOf(id: number): string {
        const user = users.find(u => u.id === id);
        if (!user) return '';
        return user.name;
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'unchecked-find');
    expect(findings.length).toBe(0);
  });

  it('should not flag .find() result used after `if (!user) throw ...;`', () => {
    const source = `
      const users = [{ id: 1, name: 'Alice' }];
      function nameOf(id: number): string {
        const user = users.find(u => u.id === id);
        if (!user) throw new Error('not found');
        return user.name;
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'unchecked-find');
    expect(findings.length).toBe(0);
  });

  it('should not flag .find() when optional chaining is used', () => {
    const source = `
      const users = [{ id: 1, name: 'Alice' }];
      const user = users.find(u => u.id === 2);
      console.log(user?.name);
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'unchecked-find');
    expect(findings.length).toBe(0);
  });

  // ── optional-chain-bang ────────────────────────────────────────────────

  it('should flag optional chain with non-null assertion', () => {
    const source = `
      interface User { profile?: { name: string } }
      function getName(user: User) {
        return user.profile?.name!;
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'optional-chain-bang');
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('?.');
  });

  it('should not flag non-null assertion without optional chain', () => {
    const source = `
      function getName(name: string | null) {
        return name!;
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'optional-chain-bang');
    expect(findings.length).toBe(0);
  });

  // ── unchecked-cast ─────────────────────────────────────────────────────

  it('should flag casting .find() result to non-nullable type', () => {
    const source = `
      interface Item { id: number; value: string }
      const items: Item[] = [];
      const item = items.find(i => i.id === 1) as Item;
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'unchecked-cast');
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('.find()');
    expect(findings[0].message).toContain('as Item');
  });

  it('should not flag casting to nullable union', () => {
    const source = `
      interface Item { id: number }
      const items: Item[] = [];
      const item = items.find(i => i.id === 1) as Item | undefined;
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'unchecked-cast');
    expect(findings.length).toBe(0);
  });

  // ── typeCheckedNullable: top-level vs. nested nullability ──────────────
  // Regression for the substring-on-getText() bug that flagged safe array
  // values like `(string | undefined)[]` because the rendered type
  // contains the substring "undefined" — the top-level Array isn't
  // nullable, only its elements are. Reported by kern-guard self-review
  // on its own SubmitButton component (PR #287, follow-up fix here).

  it('does not flag .filter().join() on string[] (top-level array, never nullable)', () => {
    const source = `
      function classes(a: string, b: string | undefined): string {
        return [a, b].filter(Boolean).join(' ');
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'unchecked-find');
    // The previous substring check would have flagged the .join because
    // the filter return type renders as `(string | undefined)[]`.
    expect(findings.length).toBe(0);
  });

  it('does not flag .filter().length on (T | undefined)[] — array, not nullable', () => {
    const source = `
      function countDefined(xs: Array<string | undefined>): number {
        return xs.filter(Boolean).length;
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'unchecked-find');
    expect(findings.length).toBe(0);
  });

  it('still flags arr.find().prop — top-level union with undefined IS nullable', () => {
    const source = `
      const items: Array<{ id: number; name: string }> = [];
      function nameOf(id: number): string {
        return items.find(i => i.id === id).name;
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'unchecked-find');
    expect(findings.length).toBeGreaterThan(0);
  });

  it('still flags map.get().prop — Map.get returns V | undefined at top level', () => {
    const source = `
      const cache = new Map<string, { value: number }>();
      function read(key: string): number {
        return cache.get(key).value;
      }
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter((f) => f.ruleId === 'unchecked-find');
    expect(findings.length).toBeGreaterThan(0);
  });
});
