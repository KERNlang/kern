import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const nuxtConfig: ReviewConfig = { target: 'nuxt' };

describe('Nuxt Rules', () => {
  // ── missing-ssr-guard ──

  describe('missing-ssr-guard', () => {
    it('detects window access without guard', () => {
      const source = `
const width = window.innerWidth;
`;
      const report = reviewSource(source, 'composables/useWidth.ts', nuxtConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-ssr-guard');
      expect(f).toBeDefined();
      expect(f!.message).toContain('window');
    });

    it('detects document access without guard', () => {
      const source = `
const el = document.getElementById('app');
`;
      const report = reviewSource(source, 'composables/useDom.ts', nuxtConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-ssr-guard');
      expect(f).toBeDefined();
      expect(f!.message).toContain('document');
    });

    it('detects localStorage access without guard', () => {
      const source = `
const token = localStorage.getItem('token');
`;
      const report = reviewSource(source, 'composables/useAuth.ts', nuxtConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-ssr-guard');
      expect(f).toBeDefined();
      expect(f!.message).toContain('localStorage');
    });

    it('does not flag when wrapped in process.client', () => {
      const source = `
if (process.client) {
  const width = window.innerWidth;
}
`;
      const report = reviewSource(source, 'composables/useWidth.ts', nuxtConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-ssr-guard');
      expect(f).toBeUndefined();
    });

    it('does not flag when inside onMounted', () => {
      const source = `
onMounted(() => {
  const width = window.innerWidth;
});
`;
      const report = reviewSource(source, 'composables/useWidth.ts', nuxtConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-ssr-guard');
      expect(f).toBeUndefined();
    });

    it('does not flag .client.ts files', () => {
      const source = `
const width = window.innerWidth;
`;
      const report = reviewSource(source, 'plugins/analytics.client.ts', nuxtConfig);
      const f = report.findings.find(f => f.ruleId === 'missing-ssr-guard');
      expect(f).toBeUndefined();
    });
  });

  // ── nuxt-direct-fetch ──

  describe('nuxt-direct-fetch', () => {
    it('detects raw fetch() in component file', () => {
      const source = `
const data = await fetch('/api/users');
`;
      const report = reviewSource(source, 'pages/users.ts', nuxtConfig);
      const f = report.findings.find(f => f.ruleId === 'nuxt-direct-fetch');
      expect(f).toBeDefined();
      expect(f!.message).toContain('fetch()');
    });

    it('does not flag when $fetch is already used', () => {
      const source = `
const data = await $fetch('/api/users');
fetch('/external');
`;
      const report = reviewSource(source, 'pages/users.ts', nuxtConfig);
      const f = report.findings.find(f => f.ruleId === 'nuxt-direct-fetch');
      expect(f).toBeUndefined();
    });

    it('does not flag fetch in server directory', () => {
      const source = `
const data = await fetch('https://api.example.com');
`;
      const report = reviewSource(source, 'server/api/proxy.ts', nuxtConfig);
      const f = report.findings.find(f => f.ruleId === 'nuxt-direct-fetch');
      expect(f).toBeUndefined();
    });

    it('does not flag fetch in lib directory', () => {
      const source = `
export async function fetchData() { return fetch('/api'); }
`;
      const report = reviewSource(source, 'lib/http.ts', nuxtConfig);
      const f = report.findings.find(f => f.ruleId === 'nuxt-direct-fetch');
      expect(f).toBeUndefined();
    });
  });

  // ── server-route-leak ──

  describe('server-route-leak', () => {
    it('detects return with sensitive field in server API route', () => {
      const source = `
export default defineEventHandler(async (event) => {
  const user = await db.user.findFirst();
  return { id: user.id, email: user.email, password: user.password };
});
`;
      const report = reviewSource(source, 'server/api/user.ts', nuxtConfig);
      const f = report.findings.find(f => f.ruleId === 'server-route-leak');
      expect(f).toBeDefined();
      expect(f!.message).toContain('password');
    });

    it('does not flag return without sensitive fields', () => {
      const source = `
export default defineEventHandler(async (event) => {
  const user = await db.user.findFirst();
  return { id: user.id, name: user.name };
});
`;
      const report = reviewSource(source, 'server/api/user.ts', nuxtConfig);
      const f = report.findings.find(f => f.ruleId === 'server-route-leak');
      expect(f).toBeUndefined();
    });

    it('does not flag non-server files', () => {
      const source = `
return { password: 'hunter2' };
`;
      const report = reviewSource(source, 'pages/login.ts', nuxtConfig);
      const f = report.findings.find(f => f.ruleId === 'server-route-leak');
      expect(f).toBeUndefined();
    });
  });
});
