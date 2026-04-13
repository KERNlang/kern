import { reviewSource } from '../src/index.js';
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
});
