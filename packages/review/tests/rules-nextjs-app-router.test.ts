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
      expect(r.findings.find((f) => f.ruleId === 'server-api-in-client')).toBeDefined();
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
});
