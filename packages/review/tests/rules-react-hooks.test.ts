import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { reviewGraph, reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const cfg: ReviewConfig = { target: 'web' };

describe('React Hooks Rules (Wave 2)', () => {
  describe('exhaustive-deps', () => {
    it('flags missing identifier in useEffect deps', () => {
      const src = `
import { useEffect, useState } from 'react';
export function C({ userId }: { userId: string }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch('/u/' + userId).then((r) => setData(r));
  }, []);
  return <div>{data}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      const f = r.findings.find((x) => x.ruleId === 'exhaustive-deps');
      expect(f).toBeDefined();
      expect(f!.autofix).toBeDefined();
      expect(f!.autofix!.description).toMatch(/REVIEW/);
    });

    it('catches shorthand property usage as a read', () => {
      const src = `
import { useEffect } from 'react';
export function C({ userId }: { userId: string }) {
  useEffect(() => {
    send({ userId });
  }, []);
  return null;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      const f = r.findings.find((x) => x.ruleId === 'exhaustive-deps');
      expect(f).toBeDefined();
      expect(f!.message).toMatch(/userId/);
    });

    it('does not false-positive on locally destructured variables', () => {
      const src = `
import { useEffect } from 'react';
export function C({ obj }: { obj: { foo: string } }) {
  useEffect(() => {
    const { foo } = obj;
    console.log(foo);
  }, [obj]);
  return null;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      const f = r.findings.find((x) => x.ruleId === 'exhaustive-deps');
      // foo is declared INSIDE the hook body → not missing
      expect(f).toBeUndefined();
    });

    it('does not flag correct deps', () => {
      const src = `
import { useEffect } from 'react';
export function C({ userId }: { userId: string }) {
  useEffect(() => {
    fetch('/u/' + userId);
  }, [userId]);
  return null;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'exhaustive-deps')).toBeUndefined();
    });
  });

  describe('ref-in-deps', () => {
    it('flags useRef result in deps array', () => {
      const src = `
import { useEffect, useRef } from 'react';
export function C() {
  const r = useRef(null);
  useEffect(() => {
    console.log(r.current);
  }, [r]);
  return null;
}
`;
      const r2 = reviewSource(src, 'c.tsx', cfg);
      const f = r2.findings.find((x) => x.ruleId === 'ref-in-deps');
      expect(f).toBeDefined();
      expect(f!.autofix).toBeDefined();
    });

    it('does not flag normal state in deps', () => {
      const src = `
import { useEffect, useState } from 'react';
export function C() {
  const [x, setX] = useState(0);
  useEffect(() => { setX(x + 1); }, [x]);
  return null;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'ref-in-deps')).toBeUndefined();
    });
  });

  describe('state-derived-from-props', () => {
    it('flags useState(props.x)', () => {
      const src = `
import { useState } from 'react';
export function C(props: { initial: string }) {
  const [name, setName] = useState(props.initial);
  return <div>{name}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'state-derived-from-props')).toBeDefined();
    });

    it('flags useState(destructuredProp)', () => {
      const src = `
import { useState } from 'react';
export function C({ initial }: { initial: string }) {
  const [name, setName] = useState(initial);
  return <div>{name}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'state-derived-from-props')).toBeDefined();
    });

    it('does not flag useState with literal', () => {
      const src = `
import { useState } from 'react';
export function C() {
  const [name, setName] = useState('');
  return <div>{name}</div>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'state-derived-from-props')).toBeUndefined();
    });
  });

  describe('usecallback-no-benefit', () => {
    it('flags useCallback used only on a host-element event handler', () => {
      const src = `
import { useCallback } from 'react';
export function C({ onDone }: { onDone: () => void }) {
  const handleClick = useCallback(() => onDone(), [onDone]);
  return <button onClick={handleClick}>Save</button>;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'usecallback-no-benefit')).toBeDefined();
    });

    it('does not flag useCallback passed to a custom component', () => {
      const src = `
import { useCallback } from 'react';
function Button(props: any) { return <button onClick={props.onClick}>Save</button>; }
export function C({ onDone }: { onDone: () => void }) {
  const handleClick = useCallback(() => onDone(), [onDone]);
  return <Button onClick={handleClick} />;
}
`;
      const r = reviewSource(src, 'c.tsx', cfg);
      expect(r.findings.find((f) => f.ruleId === 'usecallback-no-benefit')).toBeUndefined();
    });
  });
});

describe('Boundary gate — hook rules skip server/api files', () => {
  const TMP = join(tmpdir(), 'kern-review-hook-boundary');
  beforeAll(() => {
    mkdirSync(TMP, { recursive: true });
  });
  afterAll(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('skips hook rules on a pure non-React API route file (boundary=api)', () => {
    const dir = join(TMP, 'proj', 'api');
    mkdirSync(dir, { recursive: true });
    const routePath = join(dir, 'handler.ts');
    // Pure API route with no React content — the boundary gate should fire
    // because (a) boundary=api from /api/ path and (b) no React signals
    // (no JSX, no react import, no hook call).
    writeFileSync(
      routePath,
      `
export function GET(req: Request) {
  const userId = new URL(req.url).searchParams.get('id');
  return new Response(JSON.stringify({ userId }));
}
`,
    );

    const reports = reviewGraph([routePath], { ...cfg, noCache: true });
    const report = reports.find((r) => r.filePath === routePath)!;
    const hookFinding = report.findings.find((f) => f.ruleId === 'exhaustive-deps');
    expect(hookFinding).toBeUndefined();
  });

  it('still runs hook rules on a React file under /routes/ even though boundary=api', () => {
    const dir = join(TMP, 'proj2', 'routes');
    mkdirSync(dir, { recursive: true });
    const routeTsx = join(dir, 'Home.tsx');
    // This is a classic React route component. The boundary classifier sees
    // `/routes/` and tags it `api`, but the content is clearly a client React
    // component — hook rules should still run.
    writeFileSync(
      routeTsx,
      `
import { useEffect, useState } from 'react';
export function Home({ userId }: { userId: string }) {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    fetch('/u/' + userId).then((r) => r.text()).then(setData);
  }, []);
  return <div>{data}</div>;
}
`,
    );

    const reports = reviewGraph([routeTsx], { ...cfg, noCache: true });
    const report = reports.find((r) => r.filePath === routeTsx)!;
    const hookFinding = report.findings.find((f) => f.ruleId === 'exhaustive-deps');
    expect(hookFinding).toBeDefined();
  });

  it('still runs exhaustive-deps on a client boundary file', () => {
    const dir = join(TMP, 'client-file');
    mkdirSync(dir, { recursive: true });
    const clientPath = join(dir, 'client.tsx');
    writeFileSync(
      clientPath,
      `'use client';
import { useEffect, useState } from 'react';
export function C({ userId }: { userId: string }) {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    fetch('/u/' + userId).then((r) => r.text()).then(setData);
  }, []);
  return <div>{data}</div>;
}
`,
    );

    const reports = reviewGraph([clientPath], { ...cfg, noCache: true });
    const report = reports.find((r) => r.filePath === clientPath)!;
    const hookFinding = report.findings.find((f) => f.ruleId === 'exhaustive-deps');
    expect(hookFinding).toBeDefined();
  });
});
