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
