import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const cfg: ReviewConfig = { target: 'web' };

describe('Test-quality Rules', () => {
  describe('expect-no-matcher', () => {
    it('flags `expect(x);` with no matcher chained', () => {
      const src = `
it('does nothing', () => {
  const x = 1;
  expect(x);
});
`;
      const r = reviewSource(src, 'foo.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'expect-no-matcher')).toBeDefined();
    });

    it('does NOT flag `expect(x).toBe(...)`', () => {
      const src = `
it('asserts', () => {
  const x = 1;
  expect(x).toBe(1);
});
`;
      const r = reviewSource(src, 'foo.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'expect-no-matcher')).toBeUndefined();
    });

    it('does NOT flag `expect.assertions(1)`', () => {
      const src = `
it('async', async () => {
  expect.assertions(1);
  await Promise.resolve();
});
`;
      const r = reviewSource(src, 'foo.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'expect-no-matcher')).toBeUndefined();
    });

    it('does NOT flag `expect.hasAssertions()`', () => {
      const src = `
it('async', async () => {
  expect.hasAssertions();
});
`;
      const r = reviewSource(src, 'foo.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'expect-no-matcher')).toBeUndefined();
    });

    it('does NOT fire in non-test files', () => {
      const src = `
function f() {
  expect(1);
}
`;
      const r = reviewSource(src, 'foo.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'expect-no-matcher')).toBeUndefined();
    });

    it('flags awaited bare expect (Gemini final review)', () => {
      const src = `
it('async no-op', async () => {
  await expect(Promise.resolve(1));
});
`;
      const r = reviewSource(src, 'foo.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'expect-no-matcher')).toBeDefined();
    });

    it('flags returned bare expect', () => {
      const src = `
it('returns', () => {
  return expect(1);
});
`;
      const r = reviewSource(src, 'foo.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'expect-no-matcher')).toBeDefined();
    });

    it('does NOT flag awaited expect with chained matcher', () => {
      const src = `
it('async ok', async () => {
  await expect(Promise.resolve(1)).resolves.toBe(1);
});
`;
      const r = reviewSource(src, 'foo.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'expect-no-matcher')).toBeUndefined();
    });
  });

  describe('empty-test-file', () => {
    it('flags a .test.ts with no it/test calls', () => {
      const src = `
describe('foo', () => {
  // TODO: add tests
});
`;
      const r = reviewSource(src, 'foo.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'empty-test-file')).toBeDefined();
    });

    it('flags a .spec.tsx with no it/test calls', () => {
      const src = `
// nothing here yet
`;
      const r = reviewSource(src, 'foo.spec.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'empty-test-file')).toBeDefined();
    });

    it('does NOT flag a .test.ts that has it()', () => {
      const src = `
it('works', () => {
  expect(1).toBe(1);
});
`;
      const r = reviewSource(src, 'foo.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'empty-test-file')).toBeUndefined();
    });

    it('does NOT flag a .test.ts that has test()', () => {
      const src = `
test('works', () => {});
`;
      const r = reviewSource(src, 'foo.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'empty-test-file')).toBeUndefined();
    });

    it('does NOT flag a .test.ts that has it.only', () => {
      const src = `
it.only('focused', () => {});
`;
      const r = reviewSource(src, 'foo.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'empty-test-file')).toBeUndefined();
    });

    it('does NOT fire in non-test files', () => {
      const src = `
const x = 1;
`;
      const r = reviewSource(src, 'foo.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'empty-test-file')).toBeUndefined();
    });

    it('does NOT flag a fixture file (exports anything)', () => {
      const src = `
export const fixture = { foo: 1 };
`;
      const r = reviewSource(src, 'data.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'empty-test-file')).toBeUndefined();
    });

    it('does NOT flag a setup file by path', () => {
      const src = `
// global setup runs once
beforeAll(() => {});
`;
      const r = reviewSource(src, 'tests/setup.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'empty-test-file')).toBeUndefined();
    });

    it('does NOT flag a fixtures-named file', () => {
      const src = `
// no exports, no it() — would normally fire, but path contains "fixtures"
const x = 1;
`;
      const r = reviewSource(src, 'tests/fixtures.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'empty-test-file')).toBeUndefined();
    });

    it('does NOT flag a setupTests.test.ts (regex must not require word boundary)', () => {
      const src = `
beforeAll(() => {});
`;
      const r = reviewSource(src, 'tests/setupTests.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'empty-test-file')).toBeUndefined();
    });

    it('does NOT flag a tagged-template it.each test (Gemini final review)', () => {
      const src = `
it.each\`
  a    | b    | expected
  \${1} | \${1} | \${2}
\`('returns $expected', ({ a, b, expected }) => {
  expect(a + b).toBe(expected);
});
`;
      const r = reviewSource(src, 'foo.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'empty-test-file')).toBeUndefined();
    });
  });
});
