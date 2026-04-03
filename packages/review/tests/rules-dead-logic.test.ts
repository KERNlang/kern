import { reviewSource } from '../src/index.js';

describe('Dead Logic Rules', () => {
  // ── identical-conditions ───────────────────────────────────────────────

  describe('identical-conditions', () => {
    it('flags duplicate condition in if/else-if chain', () => {
      const source = `
        function check(x: number) {
          if (x > 10) {
            return 'big';
          } else if (x > 10) {
            return 'also big';
          }
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'identical-conditions');
      expect(f.length).toBe(1);
      expect(f[0].severity).toBe('error');
    });

    it('passes different conditions', () => {
      const source = `
        function check(x: number) {
          if (x > 10) {
            return 'big';
          } else if (x > 5) {
            return 'medium';
          }
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'identical-conditions');
      expect(f.length).toBe(0);
    });
  });

  // ── identical-expressions ──────────────────────────────────────────────

  describe('identical-expressions', () => {
    it('flags a === a', () => {
      const source = `
        function check(a: string) {
          return a === a;
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'identical-expressions');
      expect(f.length).toBe(1);
    });

    it('flags x - x', () => {
      const source = `
        function calc(x: number) {
          return x - x;
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'identical-expressions');
      expect(f.length).toBe(1);
    });

    it('passes a === b', () => {
      const source = `
        function check(a: string, b: string) {
          return a === b;
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'identical-expressions');
      expect(f.length).toBe(0);
    });
  });

  // ── all-identical-branches ─────────────────────────────────────────────

  describe('all-identical-branches', () => {
    it('flags if/else with identical bodies', () => {
      const source = `
        function doSomething(x: boolean) {
          if (x) {
            console.log('hello');
          } else {
            console.log('hello');
          }
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'all-identical-branches');
      expect(f.length).toBe(1);
    });

    it('flags identical ternary', () => {
      const source = `
        const val = condition ? 'same' : 'same';
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'all-identical-branches');
      expect(f.length).toBe(1);
    });

    it('passes different branches', () => {
      const source = `
        function doSomething(x: boolean) {
          if (x) {
            console.log('yes');
          } else {
            console.log('no');
          }
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'all-identical-branches');
      expect(f.length).toBe(0);
    });
  });

  // ── constant-condition ─────────────────────────────────────────────────

  describe('constant-condition', () => {
    it('flags if (true)', () => {
      const source = `
        if (true) { doSomething(); }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'constant-condition');
      expect(f.length).toBe(1);
      expect(f[0].message).toContain('always true');
    });

    it('flags if (false)', () => {
      const source = `
        if (false) { doSomething(); }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'constant-condition');
      expect(f.length).toBe(1);
      expect(f[0].message).toContain('always false');
    });

    it('flags while (false)', () => {
      const source = `
        while (false) { doSomething(); }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'constant-condition');
      expect(f.length).toBe(1);
    });

    it('does not flag variable condition', () => {
      const source = `
        function check(enabled: boolean) {
          if (enabled) { doSomething(); }
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'constant-condition');
      expect(f.length).toBe(0);
    });
  });

  // ── one-iteration-loop ─────────────────────────────────────────────────

  describe('one-iteration-loop', () => {
    it('flags loop with unconditional return', () => {
      const source = `
        function first(arr: number[]) {
          for (const item of arr) {
            return item;
          }
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'one-iteration-loop');
      expect(f.length).toBe(1);
    });

    it('flags loop with unconditional break', () => {
      const source = `
        function first(arr: number[]) {
          let result = 0;
          for (const item of arr) {
            result = item;
            break;
          }
          return result;
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'one-iteration-loop');
      expect(f.length).toBe(1);
    });

    it('passes loop with conditional break', () => {
      const source = `
        function findBig(arr: number[]) {
          for (const item of arr) {
            if (item > 10) return item;
            console.log(item);
          }
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'one-iteration-loop');
      expect(f.length).toBe(0);
    });
  });

  // ── unused-collection ──────────────────────────────────────────────────

  describe('unused-collection', () => {
    it('flags array populated but never read', () => {
      const source = `
        const items = [];
        items.push('a');
        items.push('b');
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'unused-collection');
      expect(f.length).toBe(1);
    });

    it('passes array that is returned', () => {
      const source = `
        function collect() {
          const items = [];
          items.push('a');
          return items;
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'unused-collection');
      expect(f.length).toBe(0);
    });
  });

  // ── empty-collection-access ────────────────────────────────────────────

  describe('empty-collection-access', () => {
    it('flags empty array that is read but never populated', () => {
      const source = `
        const items: string[] = [];
        const first = items.find(x => x === 'a');
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'empty-collection-access');
      expect(f.length).toBe(1);
    });

    it('passes array that is populated then read', () => {
      const source = `
        const items: string[] = [];
        items.push('hello');
        const first = items.find(x => x === 'hello');
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'empty-collection-access');
      expect(f.length).toBe(0);
    });
  });

  // ── redundant-jump ─────────────────────────────────────────────────────

  describe('redundant-jump', () => {
    it('flags redundant continue at end of loop', () => {
      const source = `
        for (const item of items) {
          console.log(item);
          continue;
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'redundant-jump');
      expect(f.length).toBe(1);
    });

    it('flags redundant bare return at end of function', () => {
      const source = `
        function doStuff() {
          console.log('done');
          return;
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'redundant-jump');
      expect(f.length).toBe(1);
    });

    it('passes return with value', () => {
      const source = `
        function getValue() {
          console.log('computing');
          return 42;
        }
      `;
      const report = reviewSource(source, 'test.ts');
      const f = report.findings.filter(f => f.ruleId === 'redundant-jump');
      expect(f.length).toBe(0);
    });
  });
});
