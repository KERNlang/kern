import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const reactConfig: ReviewConfig = { target: 'web' };
const nextjsConfig: ReviewConfig = { target: 'nextjs' };

describe('React Rules', () => {
  // ── async-effect ──

  describe('async-effect', () => {
    it('detects async useEffect callback', () => {
      const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(async () => {
    const data = await fetch('/api');
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find(f => f.ruleId === 'async-effect');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('error');
    });
  });

  // ── unstable-key ──

  describe('unstable-key', () => {
    it('detects key={index} in .map()', () => {
      const source = `
export function List({ items }: { items: string[] }) {
  return <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>;
}
`;
      const report = reviewSource(source, 'list.tsx', reactConfig);
      const finding = report.findings.find(f => f.ruleId === 'unstable-key');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('index');
    });
  });

  // ── state-explosion ──

  describe('state-explosion', () => {
    it('detects >5 useState calls', () => {
      const source = `
import { useState } from 'react';
export function BigForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState(0);
  const [city, setCity] = useState('');
  const [zip, setZip] = useState('');
  return <form></form>;
}
`;
      const report = reviewSource(source, 'form.tsx', reactConfig);
      const finding = report.findings.find(f => f.ruleId === 'state-explosion');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('warning');
    });
  });

  // ── hook-order ──

  describe('hook-order', () => {
    it('detects hooks inside if statement', () => {
      const source = `
import { useState } from 'react';
export function Component({ show }: { show: boolean }) {
  if (show) {
    const [val, setVal] = useState(0);
  }
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find(f => f.ruleId === 'hook-order');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('error');
    });
  });
});

describe('Next.js Rules', () => {
  // ── server-hook ──

  describe('server-hook', () => {
    it('detects useState in server component', () => {
      const source = `
import { useState } from 'react';
export default function ServerPage() {
  const [count, setCount] = useState(0);
  return <div>{count}</div>;
}
`;
      const report = reviewSource(source, 'page.tsx', nextjsConfig);
      const finding = report.findings.find(f => f.ruleId === 'server-hook');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('error');
    });

    it('does not flag client component with use client', () => {
      const source = `
'use client';
import { useState } from 'react';
export default function ClientPage() {
  const [count, setCount] = useState(0);
  return <div>{count}</div>;
}
`;
      const report = reviewSource(source, 'page.tsx', nextjsConfig);
      const finding = report.findings.find(f => f.ruleId === 'server-hook');
      expect(finding).toBeUndefined();
    });
  });

  // ── missing-use-client ──

  describe('missing-use-client', () => {
    it('detects event handlers in server component', () => {
      const source = `
export default function ServerPage() {
  return <button onClick={() => {}}>Click</button>;
}
`;
      const report = reviewSource(source, 'page.tsx', nextjsConfig);
      const finding = report.findings.find(f => f.ruleId === 'missing-use-client');
      expect(finding).toBeDefined();
    });
  });
});
