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

  describe('focused-test-only', () => {
    it('flags committed test.only', () => {
      const src = `
import { test } from '@playwright/test';

test.only('checkout', async ({ page }) => {
  await page.goto('/checkout');
});
`;
      const r = reviewSource(src, 'tests/e2e/checkout.spec.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'focused-test-only')).toBeDefined();
    });

    it('does not flag normal tests', () => {
      const src = `
test('works', () => {});
`;
      const r = reviewSource(src, 'foo.test.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'focused-test-only')).toBeUndefined();
    });

    it('flags Playwright test.describe.only', () => {
      const src = `
import { test } from '@playwright/test';

test.describe.only('checkout', () => {
  test('loads', async ({ page }) => {
    await page.goto('/checkout');
  });
});
`;
      const r = reviewSource(src, 'tests/e2e/checkout.spec.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'focused-test-only')).toBeDefined();
    });

    it('flags focused table tests', () => {
      const src = `
it.only.each([[1]])('works', (value) => {
  expect(value).toBe(1);
});
`;
      const r = reviewSource(src, 'foo.test.ts', cfg);
      expect(r.findings.filter((f) => f.ruleId === 'focused-test-only')).toHaveLength(1);
    });

    it('flags fit and fdescribe focused tests', () => {
      const src = `
fdescribe('suite', () => {
  fit('works', () => {
    expect(1).toBe(1);
  });
});
`;
      const r = reviewSource(src, 'foo.test.ts', cfg);
      expect(r.findings.filter((f) => f.ruleId === 'focused-test-only')).toHaveLength(2);
    });
  });

  describe('playwright-wait-for-timeout', () => {
    it('flags fixed sleeps in Playwright tests', () => {
      const src = `
import { test } from '@playwright/test';

test('loads', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(1000);
});
`;
      const r = reviewSource(src, 'tests/e2e/home.spec.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'playwright-wait-for-timeout')).toBeDefined();
    });
  });

  describe('playwright-networkidle', () => {
    it('flags waitForLoadState networkidle', () => {
      const src = `
import { test } from '@playwright/test';

test('loads', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
});
`;
      const r = reviewSource(src, 'tests/e2e/home.spec.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'playwright-networkidle')).toBeDefined();
    });

    it('flags goto waitUntil networkidle', () => {
      const src = `
import { test } from '@playwright/test';

test('loads', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
});
`;
      const r = reviewSource(src, 'tests/e2e/home.spec.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'playwright-networkidle')).toBeDefined();
    });
  });

  describe('storybook-secret-arg', () => {
    it('flags secret-looking story args', () => {
      const src = `
const meta = {
  component: LoginForm,
  args: {
    apiKey: process.env.SECRET_API_KEY,
  },
};
export default meta;
`;
      const r = reviewSource(src, 'login-form.stories.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'storybook-secret-arg')).toBeDefined();
    });

    it('does not flag obvious placeholder secret args', () => {
      const src = `
const meta = {
  component: LoginForm,
  args: {
    apiKey: 'mock-api-key',
  },
};
export default meta;
`;
      const r = reviewSource(src, 'login-form.stories.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'storybook-secret-arg')).toBeUndefined();
    });

    it('does not flag non-secret server env vars in secret-looking story args', () => {
      const src = `
const meta = {
  component: LoginForm,
  args: {
    apiKey: process.env.PORT,
  },
};
export default meta;
`;
      const r = reviewSource(src, 'login-form.stories.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'storybook-secret-arg')).toBeUndefined();
    });
  });

  describe('storybook-random-story-data', () => {
    it('flags random data in stories', () => {
      const src = `
export const Default = {
  args: {
    id: Math.random(),
  },
};
`;
      const r = reviewSource(src, 'card.stories.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'storybook-random-story-data')).toBeDefined();
    });

    it('does not flag fixed dates in stories', () => {
      const src = `
export const Default = {
  args: {
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  },
};
`;
      const r = reviewSource(src, 'card.stories.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'storybook-random-story-data')).toBeUndefined();
    });
  });

  describe('storybook-network-call-without-mock', () => {
    it('flags story network calls without mock evidence', () => {
      const src = `
export const Loaded = {
  loaders: [
    async () => ({ data: await fetch('/api/products').then((r) => r.json()) }),
  ],
};
`;
      const r = reviewSource(src, 'products.stories.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'storybook-network-call-without-mock')).toBeDefined();
    });

    it('does not flag story network calls with msw evidence', () => {
      const src = `
export const Loaded = {
  parameters: {
    msw: { handlers: [] },
  },
  loaders: [
    async () => ({ data: await fetch('/api/products').then((r) => r.json()) }),
  ],
};
`;
      const r = reviewSource(src, 'products.stories.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'storybook-network-call-without-mock')).toBeUndefined();
    });
  });

  describe('storybook-play-without-assertion', () => {
    it('flags interaction stories with no assertion', () => {
      const src = `
import { userEvent } from '@storybook/test';

export const Filled = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button'));
  },
};
`;
      const r = reviewSource(src, 'button.stories.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'storybook-play-without-assertion')).toBeDefined();
    });

    it('does not flag interaction stories with an assertion', () => {
      const src = `
import { expect, userEvent } from '@storybook/test';

export const Filled = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button'));
    await expect(canvas.getByText('Saved')).toBeVisible();
  },
};
`;
      const r = reviewSource(src, 'button.stories.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'storybook-play-without-assertion')).toBeUndefined();
    });

    it('does not flag interaction stories that wait with findBy queries', () => {
      const src = `
import { userEvent } from '@storybook/test';

export const Filled = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button'));
    await canvas.findByText('Saved');
  },
};
`;
      const r = reviewSource(src, 'button.stories.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'storybook-play-without-assertion')).toBeUndefined();
    });
  });
});
