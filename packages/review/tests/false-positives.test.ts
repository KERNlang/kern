/**
 * False-positive regression tests.
 *
 * Every test here verifies that a specific rule does NOT fire
 * on code that looks similar to a violation but isn't one.
 */

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { reviewGraph, reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const reactConfig: ReviewConfig = { target: 'web' };
const nextjsConfig: ReviewConfig = { target: 'nextjs' };
const vueConfig: ReviewConfig = { target: 'vue' };
const expressConfig: ReviewConfig = { target: 'express' };
const TMP = join(tmpdir(), 'kern-review-false-positives');

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('False Positive Regression: floating-promise', () => {
  it('does NOT fire on .then in regex patterns', () => {
    const source = `
export const THEN_REGEX = /\\.then\\s*\\(/;
export function checkPattern(text: string): boolean {
  return THEN_REGEX.test(text);
}
`;
    const report = reviewSource(source, 'regex.ts');
    const fp = report.findings.find((f) => f.ruleId === 'floating-promise');
    expect(fp).toBeUndefined();
  });

  it('does NOT fire on .then in string literals', () => {
    const source = `
export function describe(): string {
  return "Call .then() to chain promises";
}
`;
    const report = reviewSource(source, 'strings.ts');
    const fp = report.findings.find((f) => f.ruleId === 'floating-promise');
    expect(fp).toBeUndefined();
  });

  it('does NOT fire on .then in comments', () => {
    const source = `
// Use promise.then() to chain
export function doWork(): void {
  console.log('done');
}
`;
    const report = reviewSource(source, 'comments.ts');
    const fp = report.findings.find((f) => f.ruleId === 'floating-promise');
    expect(fp).toBeUndefined();
  });

  it('does NOT fire on awaited async calls', () => {
    const source = `
export async function fetchData(): Promise<string> {
  try {
    const res = await fetch('/api');
    return res.text();
  } catch { return ''; }
}
export async function main(): Promise<void> {
  try {
    const data = await fetchData();
    console.log(data);
  } catch { /* ignore */ }
}
`;
    const report = reviewSource(source, 'awaited.ts');
    const fp = report.findings.find((f) => f.ruleId === 'floating-promise');
    expect(fp).toBeUndefined();
  });

  it('does NOT fire on returned promises', () => {
    const source = `
export async function inner(): Promise<void> {
  try { await fetch('/api'); } catch {}
}
export function outer(): Promise<void> {
  return inner();
}
`;
    const report = reviewSource(source, 'returned.ts');
    const fp = report.findings.find((f) => f.ruleId === 'floating-promise');
    expect(fp).toBeUndefined();
  });

  it('DOES fire on actual floating .then()', () => {
    const source = `
export function doWork(): void {
  fetch('/api').then(r => r.json());
}
`;
    const report = reviewSource(source, 'actual.ts');
    const fp = report.findings.find((f) => f.ruleId === 'floating-promise');
    expect(fp).toBeDefined();
  });
});

describe('False Positive Regression: state-mutation', () => {
  it('does NOT fire on push() inside zustand set()', () => {
    const source = `
import { create } from 'zustand';
const useStore = create((set: any) => ({
  items: [] as string[],
  addItem: (item: string) => set((state: any) => {
    state.items.push(item);
    return { items: [...state.items] };
  }),
}));
`;
    const report = reviewSource(source, 'store.ts');
    const fp = report.findings.find((f) => f.ruleId === 'state-mutation');
    expect(fp).toBeUndefined();
  });

  it('does NOT fire on push() inside immer produce()', () => {
    const source = `
import produce from 'immer';
export function addItem(state: { items: string[] }, item: string): { items: string[] } {
  return produce(state, (draft) => {
    draft.items.push(item);
  });
}
`;
    const report = reviewSource(source, 'immer.ts');
    // draft.items is not state.items, so shouldn't fire anyway
    const fp = report.findings.find((f) => f.ruleId === 'state-mutation');
    expect(fp).toBeUndefined();
  });

  it('does NOT fire on push() on non-state variables', () => {
    const source = `
export function buildList(): string[] {
  const results: string[] = [];
  results.push('a');
  results.push('b');
  return results;
}
`;
    const report = reviewSource(source, 'list.ts');
    const fp = report.findings.find((f) => f.ruleId === 'state-mutation');
    expect(fp).toBeUndefined();
  });
});

describe('False Positive Regression: empty-catch', () => {
  it('does NOT fire on catch with a comment', () => {
    const source = `
export function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch (err) {
    console.error(err);
  }
}
`;
    const report = reviewSource(source, 'safe.ts');
    const fp = report.findings.find((f) => f.ruleId === 'empty-catch');
    expect(fp).toBeUndefined();
  });
});

describe('False Positive Regression: async-effect (React)', () => {
  it('does NOT fire on non-async useEffect', () => {
    const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(() => {
    fetch('/api').then(r => console.log(r));
  }, []);
  return null;
}
`;
    const report = reviewSource(source, 'comp.tsx', reactConfig);
    const fp = report.findings.find((f) => f.ruleId === 'async-effect');
    expect(fp).toBeUndefined();
  });
});

describe('False Positive Regression: hook-order (React)', () => {
  it('does NOT fire on hooks at top level of component', () => {
    const source = `
import { useState, useEffect } from 'react';
export function Component() {
  const [count, setCount] = useState(0);
  useEffect(() => { console.log(count); }, [count]);
  return null;
}
`;
    const report = reviewSource(source, 'comp.tsx', reactConfig);
    const fp = report.findings.find((f) => f.ruleId === 'hook-order');
    expect(fp).toBeUndefined();
  });
});

describe('False Positive Regression: reviewGraph client boundaries (Next.js)', () => {
  it('suppresses server-hook through a transitive client boundary', () => {
    const dir = join(TMP, 'nextjs-client-boundary-server-hook');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'page.tsx'),
      `
'use client';
import { Widget } from './widget.js';
export default function Page() {
  return <Widget />;
}
`,
    );
    writeFileSync(
      join(dir, 'widget.tsx'),
      `
import { useThing } from './use-thing.js';
export function Widget() {
  return <div>{useThing()}</div>;
}
`,
    );
    writeFileSync(
      join(dir, 'use-thing.ts'),
      `
import { useState } from 'react';
export function useThing() {
  const [count] = useState(0);
  return count;
}
`,
    );

    const reports = reviewGraph([join(dir, 'page.tsx')], nextjsConfig);
    const hookReport = reports.find((r) => r.filePath === join(dir, 'use-thing.ts'));
    expect(hookReport?.findings.find((f) => f.ruleId === 'server-hook')).toBeUndefined();
  });

  it('suppresses missing-use-client when all importers are within a client boundary', () => {
    const dir = join(TMP, 'nextjs-client-boundary-missing-use-client');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'page.tsx'),
      `
'use client';
import { Panel } from './panel.js';
export default function Page() {
  return <Panel />;
}
`,
    );
    writeFileSync(
      join(dir, 'panel.tsx'),
      `
import { Button } from './button.js';
export function Panel() {
  return <Button />;
}
`,
    );
    writeFileSync(
      join(dir, 'button.tsx'),
      `
export function Button() {
  return <button onClick={() => {}}>Push</button>;
}
`,
    );

    const reports = reviewGraph([join(dir, 'page.tsx')], nextjsConfig);
    const buttonReport = reports.find((r) => r.filePath === join(dir, 'button.tsx'));
    expect(buttonReport?.findings.find((f) => f.ruleId === 'missing-use-client')).toBeUndefined();
  });

  it('keeps server-hook when a file is also imported outside the client boundary', () => {
    const dir = join(TMP, 'nextjs-client-boundary-mixed-importers');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'client-page.tsx'),
      `
'use client';
import { useThing } from './use-thing.js';
export default function ClientPage() {
  return <div>{useThing()}</div>;
}
`,
    );
    writeFileSync(
      join(dir, 'server-page.tsx'),
      `
import { useThing } from './use-thing.js';
export default function ServerPage() {
  return <div>{useThing()}</div>;
}
`,
    );
    writeFileSync(
      join(dir, 'use-thing.ts'),
      `
import { useState } from 'react';
export function useThing() {
  const [count] = useState(0);
  return count;
}
`,
    );

    const reports = reviewGraph([join(dir, 'client-page.tsx'), join(dir, 'server-page.tsx')], nextjsConfig);
    const hookReport = reports.find((r) => r.filePath === join(dir, 'use-thing.ts'));
    expect(hookReport?.findings.find((f) => f.ruleId === 'server-hook')).toBeDefined();
  });
});

describe('False Positive Regression: server-hook (Next.js)', () => {
  it('does NOT fire on client component with use client', () => {
    const source = `
'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
export default function Page() {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  useEffect(() => {}, []);
  const cb = useCallback(() => {}, []);
  return <div>{count}</div>;
}
`;
    const report = reviewSource(source, 'page.tsx', nextjsConfig);
    const fp = report.findings.find((f) => f.ruleId === 'server-hook');
    expect(fp).toBeUndefined();
  });
});

describe('False Positive Regression: server-hook on example files', () => {
  it('does NOT fire on files named *-examples.ts containing hooks in strings', () => {
    const source = `
export const EXAMPLES: Record<string, string> = {
  counter: \`import React, { useState } from 'react';
export function Counter() {
  const [count, setCount] = useState(0);
  return <div>{count}</div>;
}\`,
};
`;
    const report = reviewSource(source, 'packages/playground/src/lib/infer-examples.ts', nextjsConfig);
    const fp = report.findings.find((f) => f.ruleId === 'server-hook');
    expect(fp).toBeUndefined();
  });

  it('does NOT fire on files named examples.ts containing hooks in strings', () => {
    const source = `
export const EXAMPLES = [{ name: 'Counter', source: \`const [count, setCount] = useState(0);\` }];
`;
    const report = reviewSource(source, 'src/lib/examples.ts', nextjsConfig);
    const fp = report.findings.find((f) => f.ruleId === 'server-hook');
    expect(fp).toBeUndefined();
  });

  it('still fires server-hook on runtime files with hooks', () => {
    const source = `
import { useState } from 'react';
export default function Page() {
  const [count, setCount] = useState(0);
  return <div>{count}</div>;
}
`;
    const report = reviewSource(source, 'src/components/page.tsx', nextjsConfig);
    const hit = report.findings.find((f) => f.ruleId === 'server-hook');
    expect(hit).toBeDefined();
  });
});

describe('False Positive Regression: hydration-mismatch (Next.js)', () => {
  it('does NOT fire on Date.now inside useEffect', () => {
    const source = `
'use client';
import { useEffect } from 'react';
export default function Page() {
  useEffect(() => {
    const now = Date.now();
    console.log(now);
  }, []);
  return <div>hello</div>;
}
`;
    const report = reviewSource(source, 'page.tsx', nextjsConfig);
    const fp = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
    expect(fp).toBeUndefined();
  });
});

describe('False Positive Regression: unvalidated-input (Express)', () => {
  it('does NOT fire when zod schema validates req.body', () => {
    const source = `
import express from 'express';
import { z } from 'zod';
const schema = z.object({ name: z.string() });
const app = express();
app.post('/users', (req: any, res: any) => {
  const data = schema.parse(req.body);
  res.json(data);
});
`;
    const report = reviewSource(source, 'routes.ts', expressConfig);
    const fp = report.findings.find((f) => f.ruleId === 'unvalidated-input');
    expect(fp).toBeUndefined();
  });
});

describe('False Positive Regression: non-exhaustive-switch', () => {
  it('does NOT fire on switch with default clause', () => {
    const source = `
export type Action = 'create' | 'update' | 'delete';
export function handle(action: Action): string {
  switch (action) {
    case 'create': return 'created';
    default: return 'other';
  }
}
`;
    const report = reviewSource(source, 'switch.ts');
    const fp = report.findings.find((f) => f.ruleId === 'non-exhaustive-switch');
    expect(fp).toBeUndefined();
  });
});

describe('False Positive Regression: missing-ref-value (Vue)', () => {
  it('does NOT fire when ref is passed to watch()', () => {
    const source = `
import { ref, watch, onUnmounted } from 'vue';
export function setup() {
  const count = ref(0);
  const stop = watch(count, (val) => {
    console.log(val);
  });
  onUnmounted(() => stop());
  return { count };
}
`;
    const report = reviewSource(source, 'setup.ts', vueConfig);
    const fp = report.findings.find((f) => f.ruleId === 'missing-ref-value');
    expect(fp).toBeUndefined();
  });

  it('does NOT fire on ref used with .value', () => {
    const source = `
import { ref } from 'vue';
export function setup() {
  const count = ref(0);
  function increment(): void {
    count.value++;
  }
  return { count, increment };
}
`;
    const report = reviewSource(source, 'setup.ts', vueConfig);
    const fp = report.findings.find((f) => f.ruleId === 'missing-ref-value');
    expect(fp).toBeUndefined();
  });
});

describe('Self-review: kern review on its own rules', () => {
  it('does NOT produce false floating-promise on rule files with .then regex', () => {
    // This is the exact pattern that caused false positives in the self-review
    const source = `
import { SyntaxKind } from 'ts-morph';

const thenRegex = /\\.then\\s*\\(/;

export function checkPromise(text: string): boolean {
  return thenRegex.test(text);
}

export function serializeNode(node: any): string {
  const parts = [node.type];
  if (node.props) {
    for (const [k, v] of Object.entries(node.props)) {
      if (typeof v === 'string') parts.push(v.includes(' ') ? k + '="' + v + '"' : k + '=' + v);
    }
  }
  return parts.join(' ');
}
`;
    const report = reviewSource(source, 'rules.ts');
    const fp = report.findings.find((f) => f.ruleId === 'floating-promise');
    expect(fp).toBeUndefined();
  });
});

// ── v2.1 AST-rewrite false-positive regressions ──────────────────────

describe('False Positive Regression: unstableKey (AST)', () => {
  it('does NOT fire on .map() returning non-JSX', () => {
    const source = `
export function transform(items: string[]): string[] {
  return items.map((item, index) => item.toUpperCase());
}
`;
    const report = reviewSource(source, 'transform.ts', reactConfig);
    const fp = report.findings.find((f) => f.ruleId === 'unstable-key');
    expect(fp).toBeUndefined();
  });

  it('DOES fire on .map() returning JSX without key', () => {
    const source = `
export function List({ items }: { items: string[] }) {
  return <ul>{items.map((item) => <li>{item}</li>)}</ul>;
}
`;
    const report = reviewSource(source, 'list.tsx', reactConfig);
    const fp = report.findings.find((f) => f.ruleId === 'unstable-key');
    expect(fp).toBeDefined();
  });
});

describe('False Positive Regression: hookOrder (AST)', () => {
  it('does NOT fire on hook name in string literal inside if block', () => {
    const source = `
export function Component() {
  if (true) {
    console.log("useState is a React hook");
  }
  return null;
}
`;
    const report = reviewSource(source, 'comp.tsx', reactConfig);
    const fp = report.findings.find((f) => f.ruleId === 'hook-order');
    expect(fp).toBeUndefined();
  });

  it('DOES fire on actual hook call inside if block', () => {
    const source = `
import { useState } from 'react';
export function Component({ flag }: { flag: boolean }) {
  if (flag) {
    const [val, setVal] = useState(0);
  }
  return null;
}
`;
    const report = reviewSource(source, 'comp.tsx', reactConfig);
    const fp = report.findings.find((f) => f.ruleId === 'hook-order');
    expect(fp).toBeDefined();
  });
});

describe('False Positive Regression: memoryLeak (AST)', () => {
  it('does NOT fire on addEventListener in comment inside useEffect', () => {
    const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(() => {
    // window.addEventListener('resize', handler);
    console.log('no subscription');
  }, []);
  return null;
}
`;
    const report = reviewSource(source, 'comp.tsx');
    const fp = report.findings.find((f) => f.ruleId === 'memory-leak');
    expect(fp).toBeUndefined();
  });

  it('DOES fire on actual addEventListener without cleanup', () => {
    const source = `
import { useEffect } from 'react';
function handler() {}
export function Component() {
  useEffect(() => {
    window.addEventListener('resize', handler);
  }, []);
  return null;
}
`;
    const report = reviewSource(source, 'comp.tsx');
    const fp = report.findings.find((f) => f.ruleId === 'memory-leak');
    expect(fp).toBeDefined();
  });
});

describe('False Positive Regression: missingOnUnmounted (AST)', () => {
  it('does NOT fire on watch in string literal', () => {
    const source = `
export function setup(): string {
  return "Call watch() to observe reactive data";
}
`;
    const report = reviewSource(source, 'setup.ts', vueConfig);
    const fp = report.findings.find((f) => f.ruleId === 'missing-onUnmounted');
    expect(fp).toBeUndefined();
  });
});

describe('False Positive Regression: configDefaultMismatch (AST)', () => {
  it('handles nested object in defaults — only top-level keys', () => {
    const source = `
export interface AppConfig {
  host: string;
  port: number;
  db: { url: string; pool: number };
}
export const DEFAULT_APP_CONFIG: AppConfig = {
  host: 'localhost',
  port: 3000,
  db: { url: 'postgres://localhost', pool: 5 },
};
`;
    const report = reviewSource(source, 'config.ts');
    const fp = report.findings.find(
      (f) => f.ruleId === 'config-default-mismatch' && (f.message.includes("'url'") || f.message.includes("'pool'")),
    );
    // url and pool are nested keys — should NOT appear as top-level mismatches
    expect(fp).toBeUndefined();
  });
});

// ── New guard false-positive tests (target-aware + file context) ────────

describe('False Positive Regression: hydration-mismatch on backend', () => {
  it('does NOT flag Date.now() in Express handler', () => {
    const source = `
export function handler(req: any, res: any) {
  const timestamp = Date.now();
  res.json({ timestamp });
}
`;
    // File has no JSX, no React imports — isReactFile guard should skip
    const report = reviewSource(source, 'api-handler.ts', nextjsConfig);
    const fp = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
    expect(fp).toBeUndefined();
  });

  it('does NOT flag Math.random() in utility function', () => {
    const source = `
export function generateId(): string {
  return Math.random().toString(36).slice(2);
}
`;
    const report = reviewSource(source, 'utils.ts', nextjsConfig);
    const fp = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
    expect(fp).toBeUndefined();
  });

  it('does NOT flag new Date() in server-side data loader', () => {
    const source = `
export async function getServerSideProps() {
  const now = new Date();
  return { props: { timestamp: now.toISOString() } };
}
`;
    const report = reviewSource(source, 'page-data.ts', nextjsConfig);
    const fp = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
    expect(fp).toBeUndefined();
  });
});

describe('False Positive Regression: server-hook in client boundary', () => {
  it('does NOT flag useState in file within client boundary (graph mode)', () => {
    const dir = join(TMP, 'client-boundary-hook');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    // Parent has 'use client' — child inherits client boundary
    writeFileSync(
      join(dir, 'page.ts'),
      `
'use client';
import { useCounter } from './counter.js';
export const page = useCounter;
`,
    );
    writeFileSync(
      join(dir, 'counter.ts'),
      `
import { useState } from 'react';
export function useCounter() {
  const [count, setCount] = useState(0);
  return { count, setCount };
}
`,
    );

    const reports = reviewGraph([join(dir, 'page.ts')], nextjsConfig);
    const counterReport = reports.find((r) => r.filePath.includes('counter'));
    if (counterReport) {
      const fp = counterReport.findings.find((f) => f.ruleId === 'server-hook');
      expect(fp).toBeUndefined();
    }
  });
});

describe('False Positive Regression: missing-use-client in client boundary', () => {
  it('does NOT flag onClick in file within client boundary (graph mode)', () => {
    const dir = join(TMP, 'client-boundary-event');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    writeFileSync(
      join(dir, 'app.ts'),
      `
'use client';
import { Button } from './button.js';
export const app = Button;
`,
    );
    writeFileSync(
      join(dir, 'button.tsx'),
      `
export function Button() {
  return <button onClick={() => alert('hi')}>Click</button>;
}
`,
    );

    const reports = reviewGraph([join(dir, 'app.ts')], nextjsConfig);
    const buttonReport = reports.find((r) => r.filePath.includes('button'));
    if (buttonReport) {
      const fp = buttonReport.findings.find((f) => f.ruleId === 'missing-use-client');
      expect(fp).toBeUndefined();
    }
  });
});
