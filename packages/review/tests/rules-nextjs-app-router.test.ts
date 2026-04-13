import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const cfg: ReviewConfig = { target: 'nextjs' };

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
