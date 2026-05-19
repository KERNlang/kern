import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { reviewGraph, reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const cfg: ReviewConfig = { target: 'nextjs' };
const TMP = join(tmpdir(), 'kern-review-nextjs-app-router');

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('Next.js App Router Rules', () => {
  describe('use-client-drilled-too-high', () => {
    it('flags use client file with no client API usage', () => {
      const src = `'use client';

import { Child } from './child';

export function Parent() {
  return <div><Child /></div>;
}
`;
      const r = reviewSource(src, 'parent.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'use-client-drilled-too-high')).toBeDefined();
    });

    it('does not flag use client file that uses hooks', () => {
      const src = `'use client';
import { useState } from 'react';
export function Counter() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>{n}</button>;
}
`;
      const r = reviewSource(src, 'counter.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'use-client-drilled-too-high')).toBeUndefined();
    });

    it('does not flag use client file that uses next/navigation hooks', () => {
      const src = `'use client';
import { useSearchParams } from 'next/navigation';
export function ListingParams() {
  const searchParams = useSearchParams();
  return <div>{searchParams.get('page') ?? '1'}</div>;
}
`;
      const r = reviewSource(src, 'listing-params.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'use-client-drilled-too-high')).toBeUndefined();
    });

    it('does not flag use client file that uses custom hooks', () => {
      const src = `'use client';
function useNavigationCacheKey() {
  return 'cache-key';
}
export function ListingParams() {
  const cacheKey = useNavigationCacheKey();
  return <div>{cacheKey}</div>;
}
`;
      const r = reviewSource(src, 'listing-params.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'use-client-drilled-too-high')).toBeUndefined();
    });

    it('does not flag use client file with browser globals', () => {
      const src = `'use client';
export function Ls() {
  const v = localStorage.getItem('k');
  return <div>{v}</div>;
}
`;
      const r = reviewSource(src, 'ls.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'use-client-drilled-too-high')).toBeUndefined();
    });

    it('still flags drilled use client when browser global names only appear in strings', () => {
      const src = `'use client';
export function Label() {
  return <div>{"window"}</div>;
}
`;
      const r = reviewSource(src, 'label.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'use-client-drilled-too-high')).toBeDefined();
    });

    it('uses direct graph imports to describe drilled children in graph review', () => {
      const dir = join(TMP, 'use-client-drilled-too-high-graph');
      mkdirSync(dir, { recursive: true });
      const parentPath = join(dir, 'parent.tsx');
      const childPath = join(dir, 'child.tsx');
      writeFileSync(
        parentPath,
        `'use client';
import { Child } from './child.js';

export function Parent() {
  return <div><Child /></div>;
}
`,
      );
      writeFileSync(childPath, `export function Child() { return <div />; }\n`);

      const reports = reviewGraph([parentPath], cfg);
      const parent = reports.find((r) => r.filePath === parentPath)!;
      const finding = parent.findings.find((f) => f.ruleId === 'use-client-drilled-too-high');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('child.tsx');
      expect(finding!.relatedSpans?.[0]?.file).toBe(childPath);
      expect(finding!.provenance?.summary).toContain('imported child');
      expect(finding!.provenance?.steps.some((s) => s.kind === 'import' && s.label === 'child.tsx')).toBe(true);
    });
  });

  describe('server-api-in-client', () => {
    it('flags next/headers import in client component', () => {
      const src = `'use client';
import { cookies } from 'next/headers';
export function C() {
  const c = cookies();
  return <div>{c.get('x')?.value}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      const hits = r.findings.filter((f) => f.ruleId === 'server-api-in-client');
      expect(hits.length).toBeGreaterThanOrEqual(1);
      expect(hits[0].provenance?.summary).toContain('Client boundary imports server-only module');
      expect(hits[0].provenance?.steps[0]?.kind).toBe('boundary');
    });

    it('flags server-only import in client component', () => {
      const src = `'use client';
import 'server-only';
import { useState } from 'react';
export function C() {
  const [x] = useState(0);
  return <div>{x}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      const finding = r.findings.find((f) => f.ruleId === 'server-api-in-client');
      expect(finding).toBeDefined();
      expect(finding?.provenance?.steps[1]?.label).toBe('server-only');
    });

    it('does not flag next/headers in server component', () => {
      const src = `
import { cookies } from 'next/headers';
export default function Page() {
  const c = cookies();
  return <div>{c.get('x')?.value}</div>;
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-api-in-client')).toBeUndefined();
    });

    it("flags `import 'fs'` in a Client Component", () => {
      const src = `'use client';
import { readFileSync } from 'fs';
export function C() {
  const t = readFileSync('/etc/hosts', 'utf8');
  return <pre>{t}</pre>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-api-in-client')).toBeDefined();
    });

    it("flags `import 'node:fs/promises'` in a Client Component", () => {
      const src = `'use client';
import { readFile } from 'node:fs/promises';
export function C() {
  return <div onClick={() => readFile('/x')}>x</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-api-in-client')).toBeDefined();
    });

    it('does NOT flag a type-only fs import (erased at build)', () => {
      const src = `'use client';
import type { Stats } from 'fs';
export function C(props: { s: Stats }) {
  return <div>{String(props.s.size)}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-api-in-client')).toBeUndefined();
    });

    it('does NOT flag inline type-only specifier `import { type Stats } from "fs"` (Codex final review)', () => {
      const src = `'use client';
import { type Stats } from 'fs';
export function C(props: { s: Stats }) {
  return <div>{String(props.s.size)}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-api-in-client')).toBeUndefined();
    });

    it("does NOT flag fs in a 'use server' file (server actions can use fs) (Gemini final review)", () => {
      const src = `'use server';
import { readFile } from 'fs/promises';
export async function loadConfig() {
  return readFile('/etc/config', 'utf8');
}
`;
      const r = reviewSource(src, 'actions.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-api-in-client')).toBeUndefined();
    });

    it("flags require('fs') in a Client Component (CommonJS form, Gemini final review)", () => {
      const src = `'use client';
export function C() {
  const fs = require('fs');
  return <div>{fs.toString()}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-api-in-client')).toBeDefined();
    });
  });

  describe('env-var-leak-to-client', () => {
    it('flags process.env.SECRET_KEY in a client component', () => {
      const src = `'use client';
export function C() {
  const k = process.env.SECRET_KEY;
  return <div>{k}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'env-var-leak-to-client')).toBeDefined();
    });

    it('does NOT flag NEXT_PUBLIC_API_URL in a client component', () => {
      const src = `'use client';
export function C() {
  const url = process.env.NEXT_PUBLIC_API_URL;
  return <div>{url}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'env-var-leak-to-client')).toBeUndefined();
    });

    it("flags element-access form process.env['SECRET']", () => {
      const src = `'use client';
export function C() {
  const k = process.env['DATABASE_URL'];
  return <div>{k}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'env-var-leak-to-client')).toBeDefined();
    });

    it('does NOT flag in a server component (no use client)', () => {
      const src = `
export default function Page() {
  const k = process.env.SECRET_KEY;
  return <div>{k}</div>;
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'env-var-leak-to-client')).toBeUndefined();
    });

    it('does NOT flag inside a typeof guard', () => {
      const src = `'use client';
export function C() {
  const has = typeof process.env.NODE_ENV !== 'undefined';
  return <div>{has ? 'y' : 'n'}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'env-var-leak-to-client')).toBeUndefined();
    });

    it('does NOT flag NODE_ENV in a client component (Codex/Gemini/OpenCode final review — bundler-inlined)', () => {
      const src = `'use client';
export function C() {
  if (process.env.NODE_ENV === 'development') {
    console.log('dev');
  }
  return <div>x</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'env-var-leak-to-client')).toBeUndefined();
    });

    it('does NOT flag VERCEL_URL in a client component (Vercel-public)', () => {
      const src = `'use client';
export function C() {
  return <div>{process.env.VERCEL_URL}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'env-var-leak-to-client')).toBeUndefined();
    });

    it("does NOT flag in a 'use server' file (server actions reference process.env legitimately, Gemini final review)", () => {
      const src = `'use server';
export async function loadSecret() {
  return process.env.SECRET_KEY;
}
`;
      const r = reviewSource(src, 'actions.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'env-var-leak-to-client')).toBeUndefined();
    });

    it("does NOT flag inside a 'typeof window === undefined' SSR-only branch (OpenCode/Gemini final review)", () => {
      const src = `'use client';
export function C() {
  if (typeof window === 'undefined') {
    const k = process.env.SECRET_KEY;
    console.log(k);
  }
  return <div />;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'env-var-leak-to-client')).toBeUndefined();
    });

    it('does NOT flag in the alternate of `typeof window !== undefined`', () => {
      const src = `'use client';
export function C() {
  if (typeof window !== 'undefined') {
    // browser branch — would be wrong to read SECRET here, so we don't
  } else {
    const k = process.env.SECRET_KEY;
    console.log(k);
  }
  return <div />;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'env-var-leak-to-client')).toBeUndefined();
    });

    it('flags destructuring `const { API_KEY } = process.env` in a client component (Gemini final review)', () => {
      const src = `'use client';
export function C() {
  const { API_KEY, DATABASE_URL } = process.env;
  return <div>{API_KEY ?? DATABASE_URL}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      const hits = r.findings.filter((f) => f.ruleId === 'env-var-leak-to-client');
      expect(hits.length).toBeGreaterThanOrEqual(2);
      expect(hits.some((h) => h.message.includes('API_KEY'))).toBe(true);
      expect(hits.some((h) => h.message.includes('DATABASE_URL'))).toBe(true);
    });

    it('does NOT flag NEXT_PUBLIC vars in destructuring', () => {
      const src = `'use client';
export function C() {
  const { NEXT_PUBLIC_API_URL } = process.env;
  return <div>{NEXT_PUBLIC_API_URL}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'env-var-leak-to-client')).toBeUndefined();
    });

    it('flags renamed destructuring `const { SECRET: s } = process.env`', () => {
      const src = `'use client';
export function C() {
  const { SECRET: s } = process.env;
  return <div>{s}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      const hit = r.findings.find((f) => f.ruleId === 'env-var-leak-to-client');
      expect(hit).toBeDefined();
      expect(hit!.message).toContain('SECRET');
    });
  });

  describe('browser-api-in-server', () => {
    it('flags browser globals in a server component', () => {
      const src = `
export default function Page() {
  const token = localStorage.getItem('token');
  return <div>{token}</div>;
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'browser-api-in-server')).toBeDefined();
    });

    it('does not flag browser globals in a client component', () => {
      const src = `'use client';
export default function Page() {
  const token = localStorage.getItem('token');
  return <div>{token}</div>;
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'browser-api-in-server')).toBeUndefined();
    });

    it('does not flag typeof-window guarded access', () => {
      const src = `
export default function Page() {
  const href = typeof window !== 'undefined' ? window.location.href : '';
  return <div>{href}</div>;
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'browser-api-in-server')).toBeUndefined();
    });

    it('does not flag nested typeof-window guarded access inside a block', () => {
      const src = `
export default function Page() {
  let href = '';
  if (process.env.NODE_ENV !== 'test') {
    if (typeof window !== 'undefined') {
      href = window.location.href;
    }
  }
  return <div>{href}</div>;
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'browser-api-in-server')).toBeUndefined();
    });

    it('does not flag string literals that mention browser globals', () => {
      const src = `
export default function Page() {
  const label = 'window';
  return <div>{label}</div>;
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'browser-api-in-server')).toBeUndefined();
    });

    it('does not flag object property names like obj.window', () => {
      const src = `
export default function Page() {
  const obj = { window: 'x' };
  return <div>{obj.window}</div>;
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'browser-api-in-server')).toBeUndefined();
    });
  });

  describe('use-action-state-missing-pending', () => {
    it('flags useActionState form flow without pending tuple value', () => {
      const src = `'use client';
import { useActionState } from 'react';

export function SignupForm() {
  const [state, formAction] = useActionState(createUser, { ok: false });
  return (
    <form action={formAction}>
      <button type="submit">Save</button>
      {state.ok ? <p>Saved</p> : null}
    </form>
  );
}
`;
      const r = reviewSource(src, 'signup-form.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'use-action-state-missing-pending')).toBeDefined();
    });

    it('does not flag when pending tuple value is captured', () => {
      const src = `'use client';
import { useActionState } from 'react';

export function SignupForm() {
  const [state, formAction, pending] = useActionState(createUser, { ok: false });
  return (
    <form action={formAction}>
      <button type="submit" disabled={pending}>Save</button>
      {state.ok ? <p>Saved</p> : null}
    </form>
  );
}
`;
      const r = reviewSource(src, 'signup-form.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'use-action-state-missing-pending')).toBeUndefined();
    });

    it('does not flag useActionState when action is not wired into form JSX', () => {
      const src = `'use client';
import { useActionState } from 'react';

export function SignupForm() {
  const [state, formAction] = useActionState(createUser, { ok: false });
  return <div>{state.ok ? 'done' : 'idle'} {String(formAction)}</div>;
}
`;
      const r = reviewSource(src, 'signup-form.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'use-action-state-missing-pending')).toBeUndefined();
    });
  });

  describe('use-action-state-missing-feedback', () => {
    it('flags useActionState when state is never read', () => {
      const src = `'use client';
import { useActionState } from 'react';

export function SignupForm() {
  const [state, formAction, pending] = useActionState(createUser, { ok: false, error: null });
  return (
    <form action={formAction}>
      <button type="submit" disabled={pending}>Save</button>
    </form>
  );
}
`;
      const r = reviewSource(src, 'signup-form.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'use-action-state-missing-feedback')).toBeDefined();
    });

    it('flags useActionState when the state tuple slot is omitted entirely', () => {
      const src = `'use client';
import { useActionState } from 'react';

export function SignupForm() {
  const [, formAction, pending] = useActionState(createUser, { ok: false, error: null });
  return (
    <form action={formAction}>
      <button type="submit" disabled={pending}>Save</button>
    </form>
  );
}
`;
      const r = reviewSource(src, 'signup-form.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'use-action-state-missing-feedback')).toBeDefined();
    });

    it('does not flag when state is rendered in JSX', () => {
      const src = `'use client';
import { useActionState } from 'react';

export function SignupForm() {
  const [state, formAction, pending] = useActionState(createUser, { ok: false, error: null });
  return (
    <form action={formAction}>
      <button type="submit" disabled={pending}>Save</button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
`;
      const r = reviewSource(src, 'signup-form.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'use-action-state-missing-feedback')).toBeUndefined();
    });

    it('does not flag when state drives a side effect like a toast', () => {
      const src = `'use client';
import { useActionState, useEffect } from 'react';

export function SignupForm() {
  const [state, formAction, pending] = useActionState(createUser, { ok: false, error: null });

  useEffect(() => {
    if (state.error) showToast(state.error);
  }, [state]);

  return (
    <form action={formAction}>
      <button type="submit" disabled={pending}>Save</button>
    </form>
  );
}
`;
      const r = reviewSource(src, 'signup-form.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'use-action-state-missing-feedback')).toBeUndefined();
    });
  });

  describe('server-action-form-missing-pending', () => {
    it('flags direct native submit button on same-file server action form', () => {
      const src = `
export default function Page() {
  async function saveUser(formData: FormData) {
    'use server';
    await db.insert({ name: formData.get('name') });
  }

  return (
    <form action={saveUser}>
      <input name="name" />
      <button type="submit">Save</button>
    </form>
  );
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-action-form-missing-pending')).toBeDefined();
    });

    it('flags exported const server actions in use server files', () => {
      const src = `'use server';

export const saveUser = async (formData: FormData) => {
  await db.insert({ name: formData.get('name') });
};

export default function Page() {
  return (
    <form action={saveUser}>
      <input name="name" />
      <button type="submit">Save</button>
    </form>
  );
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-action-form-missing-pending')).toBeDefined();
    });

    it('does not flag when useFormStatus is used in the file', () => {
      const src = `'use client';
import { useFormStatus } from 'react-dom';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? 'Saving...' : 'Save'}</button>;
}

export default function Page() {
  async function saveUser(formData: FormData) {
    'use server';
    await db.insert({ name: formData.get('name') });
  }

  return (
    <form action={saveUser}>
      <input name="name" />
      <SubmitButton />
    </form>
  );
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-action-form-missing-pending')).toBeUndefined();
    });

    it('does not flag forms already covered by useActionState', () => {
      const src = `'use client';
import { useActionState } from 'react';

async function saveUser(prevState: { ok: boolean }, formData: FormData) {
  'use server';
  await db.insert({ name: formData.get('name') });
  return { ok: true };
}

export default function Page() {
  const [state, formAction] = useActionState(saveUser, { ok: false });
  return (
    <form action={formAction}>
      <input name="name" />
      <button type="submit">Save</button>
      {state.ok ? <p>Saved</p> : null}
    </form>
  );
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-action-form-missing-pending')).toBeUndefined();
    });

    it('does not flag custom submit components without native button evidence in the form tree', () => {
      const src = `
function SubmitButton() {
  return <button type="submit">Save</button>;
}

export default function Page() {
  async function saveUser(formData: FormData) {
    'use server';
    await db.insert({ name: formData.get('name') });
  }

  return (
    <form action={saveUser}>
      <input name="name" />
      <SubmitButton />
    </form>
  );
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-action-form-missing-pending')).toBeUndefined();
    });

    it('flags direct native submit button on imported server action forms', () => {
      const dir = join(TMP, 'imported-server-action-pending');
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });

      writeFileSync(
        join(dir, 'page.tsx'),
        `
import { saveUser } from './actions.js';

export default function Page() {
  return (
    <form action={saveUser}>
      <input name="name" />
      <button type="submit">Save</button>
    </form>
  );
}
`,
      );

      writeFileSync(
        join(dir, 'actions.ts'),
        `
'use server';

export async function saveUser(formData: FormData) {
  return { ok: true };
}
`,
      );

      const reports = reviewGraph([join(dir, 'page.tsx')], { ...cfg, noCache: true });
      const pageReport = reports.find((report) => report.filePath === join(dir, 'page.tsx'));
      expect(pageReport?.findings.find((f) => f.ruleId === 'server-action-form-missing-pending')).toBeDefined();
    });

    it('does not flag imported async helpers that are not server actions', () => {
      const dir = join(TMP, 'imported-non-server-action');
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });

      writeFileSync(
        join(dir, 'page.tsx'),
        `
import { saveUser } from './actions.js';

export default function Page() {
  return (
    <form action={saveUser}>
      <input name="name" />
      <button type="submit">Save</button>
    </form>
  );
}
`,
      );

      writeFileSync(
        join(dir, 'actions.ts'),
        `
export async function saveUser(formData: FormData) {
  return { ok: true };
}
`,
      );

      const reports = reviewGraph([join(dir, 'page.tsx')], { ...cfg, noCache: true });
      const pageReport = reports.find((report) => report.filePath === join(dir, 'page.tsx'));
      expect(pageReport?.findings.find((f) => f.ruleId === 'server-action-form-missing-pending')).toBeUndefined();
    });
  });

  describe('server-action-form-return-value-ignored', () => {
    it('flags direct form action when the server action returns structured state', () => {
      const src = `
export default function Page() {
  async function saveUser(formData: FormData) {
    'use server';
    if (!formData.get('name')) return { ok: false, error: 'Name is required' };
    return { ok: true, error: null };
  }

  return (
    <form action={saveUser}>
      <input name="name" />
      <button type="submit">Save</button>
    </form>
  );
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-action-form-return-value-ignored')).toBeDefined();
    });

    it('flags returned state from exported const server actions in use server files', () => {
      const src = `'use server';

export const saveUser = async (formData: FormData) => {
  if (!formData.get('name')) return { ok: false, error: 'Name is required' };
  return { ok: true, error: null };
};

export default function Page() {
  return (
    <form action={saveUser}>
      <input name="name" />
      <button type="submit">Save</button>
    </form>
  );
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-action-form-return-value-ignored')).toBeDefined();
    });

    it('does not flag direct form action when the server action has no return value', () => {
      const src = `
export default function Page() {
  async function saveUser(formData: FormData) {
    'use server';
    await db.insert({ name: formData.get('name') });
  }

  return (
    <form action={saveUser}>
      <input name="name" />
      <button type="submit">Save</button>
    </form>
  );
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-action-form-return-value-ignored')).toBeUndefined();
    });

    it('does not flag redirect-style server actions', () => {
      const src = `
import { redirect } from 'next/navigation';

export default function Page() {
  async function saveUser(formData: FormData) {
    'use server';
    await db.insert({ name: formData.get('name') });
    return redirect('/users');
  }

  return (
    <form action={saveUser}>
      <input name="name" />
      <button type="submit">Save</button>
    </form>
  );
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-action-form-return-value-ignored')).toBeUndefined();
    });

    it('does not flag when return state is consumed via useActionState', () => {
      const src = `'use client';
import { useActionState } from 'react';

async function saveUser(prevState: { ok: boolean; error: string | null }, formData: FormData) {
  'use server';
  if (!formData.get('name')) return { ok: false, error: 'Name is required' };
  return { ok: true, error: null };
}

export default function Page() {
  const [state, formAction] = useActionState(saveUser, { ok: false, error: null });
  return (
    <form action={formAction}>
      <input name="name" />
      <button type="submit">Save</button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-action-form-return-value-ignored')).toBeUndefined();
    });

    it('flags imported server actions that return state through namespace imports', () => {
      const dir = join(TMP, 'imported-server-action-return-value');
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });

      writeFileSync(
        join(dir, 'page.tsx'),
        `
import * as actions from './actions.js';

export default function Page() {
  return (
    <form action={actions.saveUser}>
      <input name="name" />
      <button type="submit">Save</button>
    </form>
  );
}
`,
      );

      writeFileSync(
        join(dir, 'actions.ts'),
        `
'use server';

export async function saveUser(formData: FormData) {
  if (!formData.get('name')) return { ok: false, error: 'Name is required' };
  return { ok: true, error: null };
}
`,
      );

      const reports = reviewGraph([join(dir, 'page.tsx')], { ...cfg, noCache: true });
      const pageReport = reports.find((report) => report.filePath === join(dir, 'page.tsx'));
      expect(pageReport?.findings.find((f) => f.ruleId === 'server-action-form-return-value-ignored')).toBeDefined();
    });
  });

  describe('server-action-form-mutation-missing-invalidation', () => {
    it('flags direct form action when a server action mutates without revalidation or redirect', () => {
      const src = `
export default function Page() {
  async function saveUser(formData: FormData) {
    'use server';
    await db.insert({ name: formData.get('name') });
  }

  return (
    <form action={saveUser}>
      <input name="name" />
      <button type="submit">Save</button>
    </form>
  );
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      const finding = r.findings.find((f) => f.ruleId === 'server-action-form-mutation-missing-invalidation');
      expect(finding).toBeDefined();
      expect(finding?.relatedSpans?.length).toBeGreaterThanOrEqual(1);
      expect(finding?.provenance?.summary).toContain('likely mutation');
    });

    it('does not flag when the action revalidates after mutating', () => {
      const src = `
import { revalidatePath } from 'next/cache';

export default function Page() {
  async function saveUser(formData: FormData) {
    'use server';
    await db.insert({ name: formData.get('name') });
    revalidatePath('/users');
  }

  return (
    <form action={saveUser}>
      <input name="name" />
      <button type="submit">Save</button>
    </form>
  );
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-action-form-mutation-missing-invalidation')).toBeUndefined();
    });

    it('does not flag useActionState flows that already surface post-submit state', () => {
      const src = `'use client';
import { useActionState } from 'react';

async function saveUser(prevState: { ok: boolean }, formData: FormData) {
  'use server';
  await db.insert({ name: formData.get('name') });
  return { ok: true };
}

export default function Page() {
  const [state, formAction] = useActionState(saveUser, { ok: false });
  return (
    <form action={formAction}>
      <input name="name" />
      <button type="submit">Save</button>
      {state.ok ? <p>Saved</p> : null}
    </form>
  );
}
`;
      const r = reviewSource(src, 'page.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-action-form-mutation-missing-invalidation')).toBeUndefined();
    });
  });

  describe('server-action-unvalidated-input', () => {
    it('flags server action using formData without validation', () => {
      const src = `'use server';
export async function submit(formData: FormData) {
  const name = formData.get('name');
  await db.insert({ name });
}
`;
      const r = reviewSource(src, 'action.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-action-unvalidated-input')).toBeDefined();
    });

    it('does not flag when schema validation is present', () => {
      const src = `'use server';
import { z } from 'zod';
const Schema = z.object({ name: z.string() });
export async function submit(formData: FormData) {
  const parsed = Schema.parse({ name: formData.get('name') });
  await db.insert(parsed);
}
`;
      const r = reviewSource(src, 'action.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-action-unvalidated-input')).toBeUndefined();
    });

    it('does not false-positive on JSON.parse (not a validator)', () => {
      // JSON.parse should NOT be treated as validation
      const src = `'use server';
export async function submit(formData: FormData) {
  const raw = formData.get('data') as string;
  const data = JSON.parse(raw);
  await db.insert(data);
}
`;
      const r = reviewSource(src, 'action.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-action-unvalidated-input')).toBeDefined();
    });

    it('catches unvalidated formData as params[1] (useActionState signature)', () => {
      const src = `'use server';
export async function submit(prevState: unknown, formData: FormData) {
  const name = formData.get('name');
  return { ok: true, name };
}
`;
      const r = reviewSource(src, 'action.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'server-action-unvalidated-input')).toBeDefined();
    });
  });

  describe('route-handler-json-type-assertion', () => {
    it('flags request.json() bodies trusted by a TypeScript assertion in route handlers', () => {
      const src = `
interface LoginBody {
  email: string;
  password: string;
}

export async function POST(request: Request) {
  const { email, password } = (await request.json()) as LoginBody;
  return Response.json({ email, passwordLength: password.length });
}
`;
      const r = reviewSource(src, 'app/api/login/route.ts', cfg);
      const finding = r.findings.find((f) => f.ruleId === 'route-handler-json-type-assertion');
      expect(finding).toBeDefined();
      expect(finding?.message).toContain('POST');
    });

    it('flags typed variable declarations assigned from request.json()', () => {
      const src = `
interface LogoutBody {
  accessToken: string;
}

export async function DELETE(req: Request) {
  const body: LogoutBody = await req.json();
  return Response.json({ ok: Boolean(body.accessToken) });
}
`;
      const r = reviewSource(src, 'app/api/logout/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'route-handler-json-type-assertion')).toBeDefined();
    });

    it('does not flag route handlers that validate the parsed body with a schema', () => {
      const src = `
import { z } from 'zod';

const BodySchema = z.object({ email: z.string().email() });

export async function POST(request: Request) {
  const raw = await request.json();
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ message: 'Bad request' }, { status: 400 });
  return Response.json({ email: parsed.data.email });
}
`;
      const r = reviewSource(src, 'app/api/login/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'route-handler-json-type-assertion')).toBeUndefined();
    });

    it('does not flag non-route helper functions with request.json()', () => {
      const src = `
interface Body {
  value: string;
}

export async function parseBody(request: Request) {
  return (await request.json()) as Body;
}
`;
      const r = reviewSource(src, 'helpers.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'route-handler-json-type-assertion')).toBeUndefined();
    });

    it('does not treat route context params as the request object', () => {
      const src = `
interface Body {
  value: string;
}

export async function POST(_request: Request, params: { json(): Promise<unknown> }) {
  const body = (await params.json()) as Body;
  return Response.json({ ok: Boolean(body.value) });
}
`;
      const r = reviewSource(src, 'app/api/users/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'route-handler-json-type-assertion')).toBeUndefined();
    });
  });

  describe('route-handler-json-unguarded', () => {
    it('flags request.json() outside try/catch in route handlers', () => {
      const src = `
export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ ok: Boolean(body) });
}
`;
      const r = reviewSource(src, 'app/api/users/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'route-handler-json-unguarded')).toBeDefined();
    });

    it('does not flag request.json() parsed inside try/catch', () => {
      const src = `
export async function POST(request: Request) {
  try {
    const body = await request.json();
    return Response.json({ ok: Boolean(body) });
  } catch {
    return Response.json({ message: 'Bad request' }, { status: 400 });
  }
}
`;
      const r = reviewSource(src, 'app/api/users/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'route-handler-json-unguarded')).toBeUndefined();
    });
  });

  describe('route-handler-json-content-type-missing', () => {
    it('flags JSON body route handlers without a content-type check', () => {
      const src = `
export async function POST(request: Request) {
  try {
    const body = await request.json();
    return Response.json({ ok: Boolean(body) });
  } catch {
    return Response.json({ message: 'Bad request' }, { status: 400 });
  }
}
`;
      const r = reviewSource(src, 'app/api/users/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'route-handler-json-content-type-missing')).toBeDefined();
    });

    it('does not flag JSON body route handlers with a content-type check', () => {
      const src = `
export async function POST(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return Response.json({ message: 'Unsupported media type' }, { status: 415 });
  }
  const body = await request.json();
  return Response.json({ ok: Boolean(body) });
}
`;
      const r = reviewSource(src, 'app/api/users/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'route-handler-json-content-type-missing')).toBeUndefined();
    });

    it('still flags when content-type only appears in response headers', () => {
      const src = `
export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ ok: Boolean(body) }, { headers: { 'content-type': 'application/json' } });
}
`;
      const r = reviewSource(src, 'app/api/users/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'route-handler-json-content-type-missing')).toBeDefined();
    });
  });

  describe('route-handler-catch-status-undefined', () => {
    it('flags error-derived status passed directly to Response.json', () => {
      const src = `
export async function POST() {
  try {
    await save();
    return Response.json({ ok: true });
  } catch (error) {
    const { status } = error as { status?: number };
    return Response.json({ message: 'failed' }, { status });
  }
}
`;
      const r = reviewSource(src, 'app/api/users/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'route-handler-catch-status-undefined')).toBeDefined();
    });

    it('does not flag literal fallback statuses', () => {
      const src = `
export async function POST() {
  try {
    await save();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ message: 'failed' }, { status: 500 });
  }
}
`;
      const r = reviewSource(src, 'app/api/users/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'route-handler-catch-status-undefined')).toBeUndefined();
    });

    it('flags direct error.status response statuses', () => {
      const src = `
export async function POST() {
  try {
    await save();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ message: 'failed' }, { status: (error as any).status });
  }
}
`;
      const r = reviewSource(src, 'app/api/users/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'route-handler-catch-status-undefined')).toBeDefined();
    });

    it('flags direct status from the actual catch variable name', () => {
      const src = `
export async function POST() {
  try {
    await save();
    return Response.json({ ok: true });
  } catch (ex) {
    return Response.json({ message: 'failed' }, { status: ex.status });
  }
}
`;
      const r = reviewSource(src, 'app/api/users/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'route-handler-catch-status-undefined')).toBeDefined();
    });

    it('does not flag non-error status destructuring inside catch blocks', () => {
      const src = `
export async function POST() {
  try {
    await save();
    return Response.json({ ok: true });
  } catch (error) {
    const { status } = await getFallbackResponse(error);
    return Response.json({ message: 'failed' }, { status });
  }
}
`;
      const r = reviewSource(src, 'app/api/users/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'route-handler-catch-status-undefined')).toBeUndefined();
    });
  });

  describe('forwarded-client-header', () => {
    it('flags x-forwarded-for forwarded from the incoming request', () => {
      const src = `
export async function POST(request: Request) {
  const headers = {
    'x-forwarded-for': request.headers.get('x-forwarded-for') ?? '',
    'user-agent': request.headers.get('user-agent') ?? '',
  };
  await fetch('https://auth.example.test/login', { method: 'POST', headers });
  return Response.json({ ok: true });
}
`;
      const r = reviewSource(src, 'app/api/login/route.ts', cfg);
      const hits = r.findings.filter((f) => f.ruleId === 'forwarded-client-header');
      expect(hits.length).toBeGreaterThanOrEqual(2);
    });

    it('does not flag constant user-agent values', () => {
      const src = `
export async function POST(request: Request) {
  const headers = { 'user-agent': 'service-client' };
  await fetch('https://api.example.test', { headers });
  return Response.json({ ok: Boolean(request) });
}
`;
      const r = reviewSource(src, 'app/api/proxy/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'forwarded-client-header')).toBeUndefined();
    });

    it('flags forwarded client headers passed through aliases', () => {
      const src = `
export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for') ?? '';
  const headers = new Headers();
  headers.set('x-forwarded-for', ip);
  await fetch('https://auth.example.test/login', { method: 'POST', headers });
  return Response.json({ ok: true });
}
`;
      const r = reviewSource(src, 'app/api/login/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'forwarded-client-header')).toBeDefined();
    });

    it('does not match aliases on property names', () => {
      const src = `
export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for') ?? '';
  const device = { ip: '192.0.2.1' };
  const headers = { 'x-forwarded-for': device.ip };
  await fetch('https://auth.example.test/login', { method: 'POST', headers });
  return Response.json({ ok: Boolean(ip) });
}
`;
      const r = reviewSource(src, 'app/api/login/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'forwarded-client-header')).toBeUndefined();
    });
  });

  describe('middleware-cloned-request-headers', () => {
    it('flags middleware forwarding cloned incoming headers to fetch', () => {
      const src = `
import { NextResponse } from 'next/server';

export function middleware(request: Request) {
  const requestHeaders = new Headers(request.headers);
  fetch('https://internal.example.test/audit', { headers: requestHeaders });
  return NextResponse.next();
}
`;
      const r = reviewSource(src, 'middleware.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'middleware-cloned-request-headers')).toBeDefined();
    });

    it('does not flag the documented NextResponse.next header augmentation pattern', () => {
      const src = `
import { NextResponse } from 'next/server';

export function middleware(request: Request) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', '/account');
  return NextResponse.next({ request: { headers: requestHeaders } });
}
`;
      const r = reviewSource(src, 'middleware.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'middleware-cloned-request-headers')).toBeUndefined();
    });
  });

  describe('mock-route-missing-env-guard', () => {
    it('flags mock API route handlers without an env guard', () => {
      const src = `
export async function GET() {
  return Response.json({ fixture: true });
}
`;
      const r = reviewSource(src, 'app/api/mock/products/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'mock-route-missing-env-guard')).toBeDefined();
    });

    it('does not flag mock API route handlers with an env guard', () => {
      const src = `
export async function GET() {
  if (process.env.MOCKS_ENABLED !== 'true') return Response.json({}, { status: 404 });
  return Response.json({ fixture: true });
}
`;
      const r = reviewSource(src, 'app/api/mock/products/route.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'mock-route-missing-env-guard')).toBeUndefined();
    });
  });

  describe('proxy-rewrite-env-path', () => {
    it('flags rewrites composed from env target and request pathname', () => {
      const src = `
import { NextResponse } from 'next/server';

export function middleware(request: Request & { nextUrl: URL }) {
  return NextResponse.rewrite(
    \`\${process.env.PROXY_TARGET}/\${request.nextUrl.pathname}\`
  );
}
`;
      const r = reviewSource(src, 'middleware.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'proxy-rewrite-env-path')).toBeDefined();
    });

    it('flags redirects composed from env target and request pathname', () => {
      const src = `
import { NextResponse } from 'next/server';

export function middleware(request: Request & { nextUrl: URL }) {
  return NextResponse.redirect(
    \`\${process.env.LOGIN_TARGET}/\${request.nextUrl.pathname}\`
  );
}
`;
      const r = reviewSource(src, 'middleware.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'proxy-rewrite-env-path')).toBeDefined();
    });
  });

  describe('non-public-env-jsx-prop', () => {
    it('flags non-public env vars passed through JSX props in client boundaries', () => {
      const src = `
'use client';

export default function Layout() {
  return <ClientProvider apiKey={process.env.SECRET_API_KEY} />;
}
`;
      const r = reviewSource(src, 'app/layout.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'non-public-env-jsx-prop')).toBeDefined();
    });

    it('does not flag NEXT_PUBLIC env vars passed through JSX props', () => {
      const src = `
export default function Layout() {
  return <ClientProvider apiUrl={process.env.NEXT_PUBLIC_API_URL} />;
}
`;
      const r = reviewSource(src, 'app/layout.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'non-public-env-jsx-prop')).toBeUndefined();
    });

    it('does not flag default server components without client-boundary evidence', () => {
      const src = `
export default function Layout() {
  return <ServerOnlyConfig apiKey={process.env.SECRET_API_KEY} />;
}
`;
      const r = reviewSource(src, 'app/layout.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'non-public-env-jsx-prop')).toBeUndefined();
    });
  });

  describe('next-image-remote-wildcard', () => {
    it('flags next/image wildcard remote host patterns', () => {
      const src = `
const nextConfig = {
  images: {
    remotePatterns: [{ hostname: '*' }],
  },
};
export default nextConfig;
`;
      const r = reviewSource(src, 'next.config.js', cfg);
      expect(r.findings.find((f) => f.ruleId === 'next-image-remote-wildcard')).toBeDefined();
    });
  });

  describe('sensitive-route-public-cache', () => {
    it('flags public cache headers on sensitive route patterns', () => {
      const src = `
const nextConfig = {
  async headers() {
    return [
      {
        source: '/api/v1/b2b/products',
        headers: [{ key: 'Cache-Control', value: 'public, s-maxage=600' }],
      },
    ];
  },
};
export default nextConfig;
`;
      const r = reviewSource(src, 'next.config.js', cfg);
      expect(r.findings.find((f) => f.ruleId === 'sensitive-route-public-cache')).toBeDefined();
    });

    it('does not flag private cache headers on sensitive route patterns', () => {
      const src = `
const nextConfig = {
  async headers() {
    return [
      {
        source: '/api/v1/b2b/products',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
    ];
  },
};
export default nextConfig;
`;
      const r = reviewSource(src, 'next.config.js', cfg);
      expect(r.findings.find((f) => f.ruleId === 'sensitive-route-public-cache')).toBeUndefined();
    });

    it('does not combine unrelated public headers with private Cache-Control', () => {
      const src = `
const nextConfig = {
  async headers() {
    return [
      {
        source: '/api/v1/account/profile',
        headers: [
          { key: 'X-Public-Scope', value: 'true' },
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      },
    ];
  },
};
export default nextConfig;
`;
      const r = reviewSource(src, 'next.config.js', cfg);
      expect(r.findings.find((f) => f.ruleId === 'sensitive-route-public-cache')).toBeUndefined();
    });
  });

  describe('swr-mutation-missing-invalidation', () => {
    it('flags useSWRMutation without mutate or cache-population options', () => {
      const src = `
import useSWRMutation from 'swr/mutation';

export function useSave() {
  return useSWRMutation(['item', '1'], async () => fetch('/api/item', { method: 'POST' }));
}
`;
      const r = reviewSource(src, 'src/features/item/use-save.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'swr-mutation-missing-invalidation')).toBeDefined();
    });

    it('does not flag useSWRMutation when useSWRConfig mutate is present', () => {
      const src = `
import { useSWRConfig } from 'swr';
import useSWRMutation from 'swr/mutation';

export function useSave() {
  const { mutate } = useSWRConfig();
  return useSWRMutation(['item', '1'], async () => fetch('/api/item', { method: 'POST' }), {
    onSuccess: () => mutate(['item', '1']),
  });
}
`;
      const r = reviewSource(src, 'src/features/item/use-save.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'swr-mutation-missing-invalidation')).toBeUndefined();
    });

    it('still flags a bare mutation when another function invalidates correctly', () => {
      const src = `
import { useSWRConfig } from 'swr';
import useSWRMutation from 'swr/mutation';

export function useGoodSave() {
  const { mutate } = useSWRConfig();
  return useSWRMutation(['item', '1'], async () => fetch('/api/item', { method: 'POST' }), {
    onSuccess: () => mutate(['item', '1']),
  });
}

export function useBareSave() {
  return useSWRMutation(['item', '2'], async () => fetch('/api/item', { method: 'POST' }));
}
`;
      const r = reviewSource(src, 'src/features/item/use-save.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'swr-mutation-missing-invalidation')).toBeDefined();
    });
  });

  describe('swr-cache-key-shape-drift', () => {
    it('flags the same SWR key prefix used with incompatible tuple shapes', () => {
      const src = `
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';

const KEY = 'cart';

export function useCart(locale: string) {
  useSWR([KEY, locale], fetcher);
  useSWRMutation([KEY, { locale }], updateCart);
}
`;
      const r = reviewSource(src, 'src/features/cart/use-cart.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'swr-cache-key-shape-drift')).toBeDefined();
    });

    it('does not flag consistent tuple shapes', () => {
      const src = `
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';

const KEY = 'cart';

export function useCart(locale: string, id: string) {
  useSWR([KEY, locale, id], fetcher);
  useSWRMutation([KEY, locale, id], updateCart);
}
`;
      const r = reviewSource(src, 'src/features/cart/use-cart.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'swr-cache-key-shape-drift')).toBeUndefined();
    });
  });

  describe('session-local-storage-outside-helper', () => {
    it('flags sensitive localStorage writes outside storage helpers', () => {
      const src = `
export function LoginButton() {
  localStorage.setItem('ACCESS_TOKEN', 'token');
  return null;
}
`;
      const r = reviewSource(src, 'src/features/account/login-button.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'session-local-storage-outside-helper')).toBeDefined();
    });

    it('flags sensitive sessionStorage writes outside storage helpers', () => {
      const src = `
export function LoginButton() {
  sessionStorage.setItem('REFRESH_TOKEN', 'token');
  return null;
}
`;
      const r = reviewSource(src, 'src/features/account/login-button.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'session-local-storage-outside-helper')).toBeDefined();
    });

    it('does not flag sensitive localStorage writes inside auth helpers', () => {
      const src = `
export function setSessionData(token: string) {
  localStorage.setItem('ACCESS_TOKEN', token);
}
`;
      const r = reviewSource(src, 'src/features/auth/utils/set-session-data.ts', cfg);
      expect(r.findings.find((f) => f.ruleId === 'session-local-storage-outside-helper')).toBeUndefined();
    });

    it('does not flag benign UI preference localStorage keys', () => {
      const src = `
export function savePreferences() {
  localStorage.setItem('user_theme', 'dark');
  localStorage.setItem('accessibility_motion', 'reduced');
}
`;
      const r = reviewSource(src, 'src/features/settings/preferences.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'session-local-storage-outside-helper')).toBeUndefined();
    });
  });
});
