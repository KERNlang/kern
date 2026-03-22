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
    const findings = report.findings.filter(f => f.ruleId === 'unchecked-find');
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
    const findings = report.findings.filter(f => f.ruleId === 'unchecked-find');
    expect(findings.length).toBe(0);
  });

  it('should not flag .find() when optional chaining is used', () => {
    const source = `
      const users = [{ id: 1, name: 'Alice' }];
      const user = users.find(u => u.id === 2);
      console.log(user?.name);
    `;
    const report = reviewSource(source, 'test.ts');
    const findings = report.findings.filter(f => f.ruleId === 'unchecked-find');
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
    const findings = report.findings.filter(f => f.ruleId === 'optional-chain-bang');
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
    const findings = report.findings.filter(f => f.ruleId === 'optional-chain-bang');
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
    const findings = report.findings.filter(f => f.ruleId === 'unchecked-cast');
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
    const findings = report.findings.filter(f => f.ruleId === 'unchecked-cast');
    expect(findings.length).toBe(0);
  });
});
