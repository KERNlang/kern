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
      const finding = report.findings.find((f) => f.ruleId === 'async-effect');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('error');
    });

    it('detects async useLayoutEffect callback', () => {
      const source = `
import { useLayoutEffect } from 'react';
export function Component() {
  useLayoutEffect(async () => {
    await measure();
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'async-effect');
      expect(finding).toBeDefined();
    });

    it('does not flag normal useEffect with inner async (React docs pattern)', () => {
      const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(() => {
    let ignore = false;
    async function startFetching() {
      const json = await fetchTodos(userId);
      if (!ignore) setTodos(json);
    }
    startFetching();
    return () => { ignore = true; };
  }, [userId]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'async-effect');
      expect(finding).toBeUndefined();
    });

    it('does not flag synchronous useEffect', () => {
      const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(() => {
    document.title = 'Hello';
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'async-effect');
      expect(finding).toBeUndefined();
    });

    it('detects async function expression callback', () => {
      const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(async function() {
    await loadData();
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'async-effect');
      expect(finding).toBeDefined();
    });

    it('detects React.useEffect async callback', () => {
      const source = `
import React from 'react';
export function Component() {
  React.useEffect(async () => {
    await fetch('/api');
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'async-effect');
      expect(finding).toBeDefined();
    });
  });

  // ── render-side-effect ──

  describe('render-side-effect', () => {
    it('detects setState in render body', () => {
      const source = `
import { useState } from 'react';
export function Component() {
  const [val, setVal] = useState(0);
  setVal(1);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'render-side-effect');
      expect(finding).toBeDefined();
    });

    it('detects fetch in render body', () => {
      const source = `
import { useState } from 'react';
export function Component() {
  fetch('/api');
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'render-side-effect');
      expect(finding).toBeDefined();
    });

    it('detects setState in arrow function component', () => {
      const source = `
import { useState } from 'react';
const Component = () => {
  const [val, setVal] = useState(0);
  setVal(1);
  return null;
};
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'render-side-effect');
      expect(finding).toBeDefined();
    });

    it('does not flag setState in useEffect', () => {
      const source = `
import { useState, useEffect } from 'react';
export function Component() {
  const [val, setVal] = useState(0);
  useEffect(() => { setVal(1); }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'render-side-effect');
      expect(finding).toBeUndefined();
    });

    it('does not flag non-component functions', () => {
      const source = `
import { useState } from 'react';
export function helper() {
  return 42;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'render-side-effect');
      expect(finding).toBeUndefined();
    });

    it('does not flag setTimeout/setInterval (not setState)', () => {
      const source = `
import { useState } from 'react';
export function Component() {
  const [val, setVal] = useState(0);
  return <button onClick={() => setTimeout(() => setVal(1), 100)}>Click</button>;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'render-side-effect');
      expect(finding).toBeUndefined();
    });
  });

  // ── unstable-key ──

  describe('unstable-key', () => {
    it('detects missing key in .map()', () => {
      const source = `
export function List({ items }: { items: string[] }) {
  return <ul>{items.map(item => <li>{item}</li>)}</ul>;
}
`;
      const report = reviewSource(source, 'list.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'unstable-key');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('missing a key');
    });

    it('detects key={index} in .map()', () => {
      const source = `
export function List({ items }: { items: string[] }) {
  return <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>;
}
`;
      const report = reviewSource(source, 'list.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'unstable-key');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('array index');
    });

    it('does not flag stable key={item.id}', () => {
      const source = `
export function List({ items }: { items: { id: string; name: string }[] }) {
  return <ul>{items.map(item => <li key={item.id}>{item.name}</li>)}</ul>;
}
`;
      const report = reviewSource(source, 'list.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'unstable-key');
      expect(finding).toBeUndefined();
    });

    it('does not flag non-JSX .map()', () => {
      const source = `
export function transform(items: number[]) {
  return items.map(x => x * 2);
}
`;
      const report = reviewSource(source, 'util.ts', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'unstable-key');
      expect(finding).toBeUndefined();
    });

    it('detects missing key in self-closing JSX map', () => {
      const source = `
export function Grid({ items }: { items: { id: string }[] }) {
  return <div>{items.map(item => <Card />)}</div>;
}
`;
      const report = reviewSource(source, 'grid.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'unstable-key');
      expect(finding).toBeDefined();
    });

    it('detects key from index in function expression callback', () => {
      const source = `
export function List({ items }: { items: string[] }) {
  return <ul>{items.map(function(item, i) { return <li key={i}>{item}</li>; })}</ul>;
}
`;
      const report = reviewSource(source, 'list.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'unstable-key');
      expect(finding).toBeDefined();
    });

    it('detects React.createElement key from index in .map()', () => {
      const source = `
import React from 'react';
export function List({ items }: { items: { text: string }[] }) {
  return React.createElement(
    'ul',
    null,
    items.map((item, index) => React.createElement('li', { key: index }, item.text)),
  );
}
`;
      const report = reviewSource(source, 'list.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'unstable-key');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('array index');
    });

    it('detects missing key in React.createElement .map()', () => {
      const source = `
import React from 'react';
export function List({ items }: { items: { text: string }[] }) {
  return React.createElement(
    'ul',
    null,
    items.map((item) => React.createElement('li', null, item.text)),
  );
}
`;
      const report = reviewSource(source, 'list.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'unstable-key');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('missing a key');
    });
  });

  describe('mapped-fragment-key', () => {
    it('detects fragment shorthand returned from .map()', () => {
      const source = `
export function List({ items }: { items: { id: string; name: string }[] }) {
  return <ul>{items.map(item => <><li>{item.name}</li></>)}</ul>;
}
`;
      const report = reviewSource(source, 'list.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'mapped-fragment-key');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('cannot carry a key');
      expect(report.findings.find((f) => f.ruleId === 'unstable-key')).toBeUndefined();
    });

    it('does not flag keyed Fragment in .map()', () => {
      const source = `
import { Fragment } from 'react';
export function List({ items }: { items: { id: string; name: string }[] }) {
  return <ul>{items.map(item => <Fragment key={item.id}><li>{item.name}</li></Fragment>)}</ul>;
}
`;
      const report = reviewSource(source, 'list.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'mapped-fragment-key');
      expect(finding).toBeUndefined();
      expect(report.findings.find((f) => f.ruleId === 'unstable-key')).toBeUndefined();
    });
  });

  // ── stale-closure ──

  describe('stale-closure', () => {
    it('detects setInterval in useEffect with empty deps', () => {
      const source = `
import { useEffect, useState } from 'react';
export function Component() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { console.log(count); }, 1000);
    return () => clearInterval(id);
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'stale-closure');
      expect(finding).toBeDefined();
    });

    it('detects setTimeout in useEffect with empty deps', () => {
      const source = `
import { useEffect, useState } from 'react';
export function Component() {
  const [msg, setMsg] = useState('hello');
  useEffect(() => {
    setTimeout(() => { alert(msg); }, 5000);
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'stale-closure');
      expect(finding).toBeDefined();
    });

    it('does not flag timer in useEffect with deps', () => {
      const source = `
import { useEffect, useState } from 'react';
export function Component() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => { console.log(count); }, 1000);
    return () => clearInterval(id);
  }, [count]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'stale-closure');
      expect(finding).toBeUndefined();
    });

    it('does not flag useEffect without timer', () => {
      const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(() => {
    document.title = 'Updated';
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'stale-closure');
      expect(finding).toBeUndefined();
    });

    it('detects stale closure with useLayoutEffect (React docs pattern)', () => {
      const source = `
import { useLayoutEffect, useState } from 'react';
export function Component() {
  const [size, setSize] = useState(0);
  useLayoutEffect(() => {
    const id = setInterval(() => console.log(size), 500);
    return () => clearInterval(id);
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'stale-closure');
      expect(finding).toBeDefined();
    });

    it('does not flag empty deps without any timer', () => {
      const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(() => {
    const connection = createConnection();
    connection.connect();
    return () => connection.disconnect();
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'stale-closure');
      expect(finding).toBeUndefined();
    });
  });

  // ── state-explosion ──

  describe('state-explosion', () => {
    it('detects >5 useState calls in function component', () => {
      const source = `
import { useState } from 'react';
export function BigForm() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  const [d, setD] = useState(0);
  const [e, setE] = useState(0);
  const [f, setF] = useState(0);
  return null;
}
`;
      const report = reviewSource(source, 'form.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'state-explosion');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('warning');
      expect(finding!.message).toContain('6');
    });

    it('detects >5 useState calls in arrow component', () => {
      const source = `
import { useState } from 'react';
const BigForm = () => {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  const [d, setD] = useState(0);
  const [e, setE] = useState(0);
  const [f, setF] = useState(0);
  return null;
};
`;
      const report = reviewSource(source, 'form.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'state-explosion');
      expect(finding).toBeDefined();
    });

    it('does not flag exactly 5 useState calls', () => {
      const source = `
import { useState } from 'react';
export function Form() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  const [d, setD] = useState(0);
  const [e, setE] = useState(0);
  return null;
}
`;
      const report = reviewSource(source, 'form.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'state-explosion');
      expect(finding).toBeUndefined();
    });

    it('does not flag 3 useState calls', () => {
      const source = `
import { useState } from 'react';
export function SmallForm() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  return null;
}
`;
      const report = reviewSource(source, 'form.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'state-explosion');
      expect(finding).toBeUndefined();
    });

    it('does not flag non-component (lowercase) functions', () => {
      const source = `
import { useState } from 'react';
export function setupForm() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const [c, setC] = useState(0);
  const [d, setD] = useState(0);
  const [e, setE] = useState(0);
  const [f, setF] = useState(0);
  return null;
}
`;
      const report = reviewSource(source, 'form.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'state-explosion');
      expect(finding).toBeUndefined();
    });

    it('counts React.useState calls correctly', () => {
      const source = `
import React from 'react';
export function BigForm() {
  const [a, setA] = React.useState(0);
  const [b, setB] = React.useState(0);
  const [c, setC] = React.useState(0);
  const [d, setD] = React.useState(0);
  const [e, setE] = React.useState(0);
  const [f, setF] = React.useState(0);
  return null;
}
`;
      const report = reviewSource(source, 'form.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'state-explosion');
      expect(finding).toBeDefined();
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
      const finding = report.findings.find((f) => f.ruleId === 'hook-order');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('error');
    });

    it('detects hooks inside for loop', () => {
      const source = `
import { useMemo } from 'react';
export function Component({ items }: { items: number[] }) {
  for (const item of items) {
    const val = useMemo(() => item * 2, [item]);
  }
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hook-order');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('loop');
    });

    it('detects hooks inside while loop', () => {
      const source = `
import { useState } from 'react';
export function Component() {
  let i = 0;
  while (i < 3) {
    const [val, setVal] = useState(0);
    i++;
  }
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hook-order');
      expect(finding).toBeDefined();
    });

    it('does not flag hook at top level', () => {
      const source = `
import { useState } from 'react';
export function Component() {
  const [x, setX] = useState(0);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hook-order');
      expect(finding).toBeUndefined();
    });

    it('detects hook in conditional within custom hook', () => {
      const source = `
import { useState } from 'react';
export function useCustom(flag: boolean) {
  if (flag) {
    const [val, setVal] = useState(0);
  }
  return null;
}
`;
      const report = reviewSource(source, 'hooks.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hook-order');
      expect(finding).toBeDefined();
    });

    it('does not flag hooks in non-component lowercase functions', () => {
      const source = `
import { useState } from 'react';
function helper() {
  if (true) {
    const x = useState(0);
  }
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hook-order');
      expect(finding).toBeUndefined();
    });
  });

  // ── effect-self-update-loop ──

  describe('effect-self-update-loop', () => {
    it('detects self-update loop', () => {
      const source = `
import { useState, useEffect } from 'react';
export function Component() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(count + 1);
  }, [count]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', { ...reactConfig, role: 'runtime' } as any);
      const finding = report.findings.find((f) => f.ruleId === 'effect-self-update-loop');
      expect(finding).toBeDefined();
    });

    it('does not flag update of different state', () => {
      const source = `
import { useState, useEffect } from 'react';
export function Component() {
  const [count, setCount] = useState(0);
  const [other, setOther] = useState(0);
  useEffect(() => {
    setOther(count + 1);
  }, [count]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', { ...reactConfig, role: 'runtime' } as any);
      const finding = report.findings.find((f) => f.ruleId === 'effect-self-update-loop');
      expect(finding).toBeUndefined();
    });

    it('does not flag setter inside nested event handler', () => {
      const source = `
import { useState, useEffect } from 'react';
export function Component() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const handler = () => setCount(count + 1);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [count]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', { ...reactConfig, role: 'runtime' } as any);
      const finding = report.findings.find((f) => f.ruleId === 'effect-self-update-loop');
      expect(finding).toBeUndefined();
    });

    it('does not flag useEffect without deps array', () => {
      const source = `
import { useState, useEffect } from 'react';
export function Component() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(prev => prev + 1);
  });
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', { ...reactConfig, role: 'runtime' } as any);
      const finding = report.findings.find((f) => f.ruleId === 'effect-self-update-loop');
      expect(finding).toBeUndefined();
    });

    it('does not flag setter not in deps array', () => {
      const source = `
import { useState, useEffect } from 'react';
export function Component() {
  const [count, setCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setCount(0);
  }, [loaded]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', { ...reactConfig, role: 'runtime' } as any);
      const finding = report.findings.find((f) => f.ruleId === 'effect-self-update-loop');
      expect(finding).toBeUndefined();
    });

    it('detects loop via React.useEffect', () => {
      const source = `
import React from 'react';
export function Component() {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    setCount(count + 1);
  }, [count]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', { ...reactConfig, role: 'runtime' } as any);
      const finding = report.findings.find((f) => f.ruleId === 'effect-self-update-loop');
      expect(finding).toBeDefined();
    });
  });

  // ── missing-effect-cleanup ──

  describe('missing-effect-cleanup', () => {
    it('detects missing cleanup for setInterval', () => {
      const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(() => {
    setInterval(() => {}, 1000);
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'missing-effect-cleanup');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('setInterval');
    });

    it('detects missing cleanup for setTimeout', () => {
      const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(() => {
    setTimeout(() => {}, 5000);
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'missing-effect-cleanup');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('setTimeout');
    });

    it('detects missing cleanup for addEventListener', () => {
      const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(() => {
    window.addEventListener('resize', () => {});
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'missing-effect-cleanup');
      expect(finding).toBeDefined();
    });

    it('does not flag when cleanup function is returned', () => {
      const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(() => {
    const id = setInterval(() => {}, 1000);
    return () => clearInterval(id);
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'missing-effect-cleanup');
      expect(finding).toBeUndefined();
    });

    it('does not flag when cleanup identifier is returned', () => {
      const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(() => {
    const handler = () => {};
    window.addEventListener('resize', handler);
    const cleanup = () => window.removeEventListener('resize', handler);
    return cleanup;
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'missing-effect-cleanup');
      expect(finding).toBeUndefined();
    });

    it('flags noop returned cleanup that does not clear the subscription', () => {
      const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(() => {
    const handler = () => {};
    window.addEventListener('resize', handler);
    const cleanup = () => console.log('cleanup');
    return cleanup;
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'missing-effect-cleanup');
      expect(finding).toBeDefined();
    });

    it('does not flag when subscribe returns an unsubscribe function directly', () => {
      const source = `
import { useEffect } from 'react';
export function Component({ store }: { store: { subscribe(cb: () => void): () => void } }) {
  useEffect(() => {
    return store.subscribe(() => {});
  }, [store]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'missing-effect-cleanup');
      expect(finding).toBeUndefined();
    });

    it('does not flag useEffect without leaky calls', () => {
      const source = `
import { useEffect } from 'react';
export function Component() {
  useEffect(() => {
    document.title = 'Hello';
  }, []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'missing-effect-cleanup');
      expect(finding).toBeUndefined();
    });
  });

  // ── react-legacy-unsafe-lifecycle ──

  describe('react-legacy-unsafe-lifecycle', () => {
    it('detects UNSAFE component lifecycle methods', () => {
      const source = `
import React from 'react';
export class Component extends React.Component {
  UNSAFE_componentWillReceiveProps(nextProps) {
    this.setState({ id: nextProps.id });
  }
  render() { return null; }
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'react-legacy-unsafe-lifecycle');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('UNSAFE_componentWillReceiveProps');
    });

    it('detects legacy componentWillMount lifecycle methods', () => {
      const source = `
import React from 'react';
export class Component extends React.Component {
  componentWillMount() {
    this.load();
  }
  render() { return null; }
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'react-legacy-unsafe-lifecycle')).toBeDefined();
    });

    it('does not flag componentDidMount', () => {
      const source = `
import React from 'react';
export class Component extends React.Component {
  componentDidMount() {
    this.load();
  }
  render() { return null; }
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'react-legacy-unsafe-lifecycle')).toBeUndefined();
    });

    it('does not flag non-React classes with render-like methods', () => {
      const source = `
import React from 'react';
export class TemplateRenderer {
  componentWillMount() {}
  render() { return ''; }
}
`;
      const report = reviewSource(source, 'renderer.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'react-legacy-unsafe-lifecycle')).toBeUndefined();
    });
  });

  // ── inline-context-value ──

  describe('inline-context-value', () => {
    it('detects inline object in Provider (React docs anti-pattern)', () => {
      const source = `
export function MyApp() {
  return <AuthContext.Provider value={{ currentUser, login }}><Page /></AuthContext.Provider>;
}
`;
      const report = reviewSource(source, 'app.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'inline-context-value');
      expect(finding).toBeDefined();
    });

    it('detects inline array in Provider', () => {
      const source = `
export function Parent({ children }: { children: any }) {
  return <ListContext.Provider value={[1, 2, 3]}>{children}</ListContext.Provider>;
}
`;
      const report = reviewSource(source, 'parent.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'inline-context-value');
      expect(finding).toBeDefined();
    });

    it('does not flag memoized value (React docs pattern)', () => {
      const source = `
import { useMemo } from 'react';
export function MyApp() {
  const contextValue = useMemo(() => ({ currentUser, login }), [currentUser, login]);
  return <AuthContext.Provider value={contextValue}><Page /></AuthContext.Provider>;
}
`;
      const report = reviewSource(source, 'app.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'inline-context-value');
      expect(finding).toBeUndefined();
    });

    it('does not flag non-Provider components', () => {
      const source = `
export function Component() {
  return <MyComponent value={{ a: 1 }} />;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'inline-context-value');
      expect(finding).toBeUndefined();
    });

    it('does not flag primitive value in Provider', () => {
      const source = `
export function Parent({ children }: { children: any }) {
  return <ThemeContext.Provider value="dark">{children}</ThemeContext.Provider>;
}
`;
      const report = reviewSource(source, 'parent.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'inline-context-value');
      expect(finding).toBeUndefined();
    });

    it('detects inline object with spread in Provider', () => {
      const source = `
export function Parent({ children }: { children: any }) {
  return <MyContext.Provider value={{ ...state, dispatch }}>{children}</MyContext.Provider>;
}
`;
      const report = reviewSource(source, 'parent.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'inline-context-value');
      expect(finding).toBeDefined();
    });
  });

  // ── ref-in-render ──

  describe('ref-in-render', () => {
    it('detects reading ref.current during render (React docs anti-pattern)', () => {
      const source = `
import { useRef } from 'react';
export function Component() {
  const myRef = useRef(0);
  const value = myRef.current;
  return <div>{value}</div>;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'ref-in-render');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('read');
    });

    it('detects writing ref.current during render', () => {
      const source = `
import { useRef } from 'react';
export function Component() {
  const myRef = useRef(0);
  myRef.current = 123;
  return <div>Hello</div>;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'ref-in-render');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('written');
    });

    it('detects ref.current in JSX return', () => {
      const source = `
import { useRef } from 'react';
export function Component() {
  const countRef = useRef(0);
  return <h1>{countRef.current}</h1>;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'ref-in-render');
      expect(finding).toBeDefined();
    });

    it('does not flag ref.current inside useEffect', () => {
      const source = `
import { useRef, useEffect } from 'react';
export function Component() {
  const myRef = useRef(null);
  useEffect(() => {
    myRef.current = document.getElementById('app');
  }, []);
  return <div id="app">Hello</div>;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'ref-in-render');
      expect(finding).toBeUndefined();
    });

    it('does not flag ref.current inside event handler', () => {
      const source = `
import { useRef } from 'react';
export function Component() {
  const inputRef = useRef<HTMLInputElement>(null);
  return <button onClick={() => { inputRef.current?.focus(); }}>Focus</button>;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'ref-in-render');
      expect(finding).toBeUndefined();
    });

    it('does not flag non-ref .current access', () => {
      const source = `
import { useState } from 'react';
export function Component() {
  const obj = { current: 42 };
  return <div>{obj.current}</div>;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'ref-in-render');
      expect(finding).toBeUndefined();
    });

    it('does not flag lazy initialization pattern (React docs approved)', () => {
      const source = `
import { useRef } from 'react';
function createExpensiveThing() { return { value: 42 }; }
export function Component() {
  const ref = useRef(null);
  if (ref.current === null) {
    ref.current = createExpensiveThing();
  }
  return <div>Hello</div>;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'ref-in-render');
      expect(finding).toBeUndefined();
    });

    it('does not flag ref.current writes inside deferred local callbacks', () => {
      const source = `
import { useRef } from 'react';

function Picker({ onSelect }: { onSelect: () => void }) {
  return <button onClick={onSelect}>Pick</button>;
}

export function Component() {
  const isManualStoreSelectionRef = useRef(false);
  const handlePickupSelect = async (): Promise<void> => {
    isManualStoreSelectionRef.current = true;
  };

  return <Picker onSelect={handlePickupSelect} />;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'ref-in-render');
      expect(finding).toBeUndefined();
    });

    it('does not flag guarded one-time array initialization during render', () => {
      const source = `
import { useRef } from 'react';

export function Component({ data }: { data?: { results?: string[] } }) {
  const frozenStoresRef = useRef<string[]>([]);
  if (data?.results?.length && frozenStoresRef.current.length === 0) {
    frozenStoresRef.current = data.results;
  }
  return <div>{frozenStoresRef.current.length}</div>;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'ref-in-render');
      expect(finding).toBeUndefined();
    });

    it('still flags nested local callbacks that are invoked during render', () => {
      const source = `
import { useRef } from 'react';

export function Component() {
  const myRef = useRef(0);
  const writeRef = () => {
    myRef.current = 123;
  };
  writeRef();
  return <div>Hello</div>;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'ref-in-render');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('written');
    });
  });

  // ── missing-memo-deps ──

  describe('missing-memo-deps', () => {
    it('detects useMemo without deps (React docs anti-pattern)', () => {
      const source = `
import { useMemo } from 'react';
export function Component({ data, filter }: any) {
  const filtered = useMemo(() => data.filter(filter));
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'missing-memo-deps');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('useMemo');
    });

    it('detects useCallback without deps (React docs anti-pattern)', () => {
      const source = `
import { useCallback } from 'react';
export function Component({ productId, referrer }: any) {
  const handleSubmit = useCallback((orderDetails: any) => {
    post('/product/' + productId + '/buy', { referrer, orderDetails });
  });
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'missing-memo-deps');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('useCallback');
    });

    it('does not flag useMemo with deps array', () => {
      const source = `
import { useMemo } from 'react';
export function Component({ todos, tab }: any) {
  const visible = useMemo(() => filterTodos(todos, tab), [todos, tab]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'missing-memo-deps');
      expect(finding).toBeUndefined();
    });

    it('does not flag useCallback with deps array', () => {
      const source = `
import { useCallback } from 'react';
export function Component({ productId }: any) {
  const handle = useCallback(() => buy(productId), [productId]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'missing-memo-deps');
      expect(finding).toBeUndefined();
    });

    it('does not flag useMemo with empty deps []', () => {
      const source = `
import { useMemo } from 'react';
export function Component() {
  const config = useMemo(() => ({ theme: 'dark' }), []);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'missing-memo-deps');
      expect(finding).toBeUndefined();
    });

    it('detects React.useMemo without deps', () => {
      const source = `
import React from 'react';
export function Component({ data }: any) {
  const sorted = React.useMemo(() => data.sort());
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'missing-memo-deps');
      expect(finding).toBeDefined();
    });
  });

  // ── reducer-mutation ──

  describe('reducer-mutation', () => {
    it('detects direct state.prop = value in reducer (React docs anti-pattern)', () => {
      const source = `
import { useReducer } from 'react';
function reducer(state: any, action: any) {
  switch (action.type) {
    case 'incremented_age':
      state.age = state.age + 1;
      return state;
  }
}
export function Component() {
  const [state, dispatch] = useReducer(reducer, { age: 42 });
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'reducer-mutation');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('state.age');
    });

    it('detects state.prop++ in reducer', () => {
      const source = `
import { useReducer } from 'react';
function reducer(state: any, action: any) {
  state.age++;
  return state;
}
export function Component() {
  const [s, d] = useReducer(reducer, { age: 0 });
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'reducer-mutation');
      expect(finding).toBeDefined();
    });

    it('detects state.items.push() in reducer', () => {
      const source = `
import { useReducer } from 'react';
function reducer(state: any, action: any) {
  state.items.push(action.item);
  return state;
}
export function Component() {
  const [s, d] = useReducer(reducer, { items: [] });
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'reducer-mutation');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('push');
    });

    it('does not flag immutable update in reducer (React docs pattern)', () => {
      const source = `
import { useReducer } from 'react';
function reducer(state: any, action: any) {
  switch (action.type) {
    case 'incremented_age':
      return { ...state, age: state.age + 1 };
  }
}
export function Component() {
  const [state, dispatch] = useReducer(reducer, { age: 42 });
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'reducer-mutation');
      expect(finding).toBeUndefined();
    });

    it('detects mutation in inline reducer', () => {
      const source = `
import { useReducer } from 'react';
export function Component() {
  const [state, dispatch] = useReducer((state: any, action: any) => {
    state.count = action.value;
    return state;
  }, { count: 0 });
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'reducer-mutation');
      expect(finding).toBeDefined();
    });

    it('does not flag useReducer without mutation', () => {
      const source = `
import { useReducer } from 'react';
function reducer(state: any, action: any) {
  return { ...state, count: state.count + 1 };
}
export function Component() {
  const [s, d] = useReducer(reducer, { count: 0 });
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'reducer-mutation');
      expect(finding).toBeUndefined();
    });
  });

  // ── React/browser lifecycle footguns ──

  describe('effect-cleanup-called-immediately', () => {
    it('detects cleanup call returned directly from useEffect', () => {
      const source = `
import { useEffect } from 'react';
export function Component({ id }: any) {
  useEffect(() => clearTimeout(id), [id]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'effect-cleanup-called-immediately');
      expect(finding).toBeDefined();
    });

    it('does not flag cleanup function returned from useEffect', () => {
      const source = `
import { useEffect } from 'react';
export function Component({ id }: any) {
  useEffect(() => () => clearTimeout(id), [id]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'effect-cleanup-called-immediately')).toBeUndefined();
    });

    it('detects cleanup call returned from block-body useEffect', () => {
      const source = `
import { useEffect } from 'react';
export function Component({ id }: any) {
  useEffect(() => {
    return clearInterval(id);
  }, [id]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'effect-cleanup-called-immediately')).toBeDefined();
    });

    it('detects cleanup call returned directly from useInsertionEffect', () => {
      const source = `
import { useInsertionEffect } from 'react';
export function Component({ id }: any) {
  useInsertionEffect(() => cancelAnimationFrame(id), [id]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'effect-cleanup-called-immediately')).toBeDefined();
    });
  });

  describe('class-timer-missing-unmount-cleanup', () => {
    it('detects class timer stored on this without unmount cleanup', () => {
      const source = `
import React from 'react';
export class Component extends React.Component {
  componentDidMount() {
    this.timer = setTimeout(() => this.refresh(), 1000);
  }
  render() { return null; }
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'class-timer-missing-unmount-cleanup');
      expect(finding).toBeDefined();
    });

    it('does not flag class timer cleared in componentWillUnmount', () => {
      const source = `
import React from 'react';
export class Component extends React.Component {
  componentDidMount() {
    this.timer = setInterval(() => this.refresh(), 1000);
  }
  componentWillUnmount() {
    clearInterval(this.timer);
  }
  render() { return null; }
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'class-timer-missing-unmount-cleanup')).toBeUndefined();
    });

    it('does not flag class timer cleared through helper called in componentWillUnmount', () => {
      const source = `
import React from 'react';
export class Component extends React.Component {
  componentDidMount() {
    this.timer = setTimeout(() => this.refresh(), 1000);
  }
  cleanupTimer() {
    window.clearTimeout(this.timer);
  }
  componentWillUnmount() {
    this.cleanupTimer();
  }
  render() { return null; }
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'class-timer-missing-unmount-cleanup')).toBeUndefined();
    });
  });

  describe('module-scoped-timer-in-component', () => {
    it('detects component writing timer handle to module scope', () => {
      const source = `
import React from 'react';
let hoverTimeout;
export function Component() {
  const onHover = () => {
    hoverTimeout = setTimeout(() => {}, 100);
  };
  return <button onMouseEnter={onHover}>Hover</button>;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'module-scoped-timer-in-component');
      expect(finding).toBeDefined();
    });

    it('does not flag useRef-owned timer handles', () => {
      const source = `
import { useRef } from 'react';
export function Component() {
  const hoverTimeout = useRef();
  hoverTimeout.current = setTimeout(() => {}, 100);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'module-scoped-timer-in-component')).toBeUndefined();
    });

    it('detects module timer writes from nested handlers in arrow components', () => {
      const source = `
import React from 'react';
let hoverTimeout;
export const Component = () => {
  const onHover = () => {
    hoverTimeout = setTimeout(() => {}, 100);
  };
  return <button onMouseEnter={onHover}>Hover</button>;
};
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'module-scoped-timer-in-component')).toBeDefined();
    });
  });

  describe('hook-length-dependency', () => {
    it('detects useMemo reading a collection while depending only on length', () => {
      const source = `
import { useMemo } from 'react';
export function Component({ providers }: any) {
  const value = useMemo(() => ({ providers }), [providers.length]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hook-length-dependency');
      expect(finding).toBeDefined();
    });

    it('does not flag useMemo that only reads length', () => {
      const source = `
import { useMemo } from 'react';
export function Component({ providers }: any) {
  const count = useMemo(() => providers.length, [providers.length]);
  return <span>{count}</span>;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'hook-length-dependency')).toBeUndefined();
    });

    it('does not flag when the full collection is also in deps', () => {
      const source = `
import { useMemo } from 'react';
export function Component({ providers }: any) {
  const rows = useMemo(() => providers.map(toRow), [providers, providers.length]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'hook-length-dependency')).toBeUndefined();
    });

    it('does not flag shadowed callback variables with the same name', () => {
      const source = `
import { useMemo } from 'react';
export function Component({ providers, rows }: any) {
  const ids = useMemo(() => rows.map((providers) => providers.id), [providers.length, rows]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'hook-length-dependency')).toBeUndefined();
    });

    it('detects useMemo reading a Set while depending only on size', () => {
      const source = `
import { useMemo } from 'react';
export function Component({ selected }: any) {
  const value = useMemo(() => Array.from(selected), [selected.size]);
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'hook-length-dependency')).toBeDefined();
    });
  });

  describe('props-array-mutated-in-render', () => {
    it('detects mutating array methods on destructured props', () => {
      const source = `
import React from 'react';
export function Component({ items }: any) {
  const sorted = items.sort();
  return <ul>{sorted.map((item) => <li key={item.id}>{item.name}</li>)}</ul>;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      const finding = report.findings.find((f) => f.ruleId === 'props-array-mutated-in-render');
      expect(finding).toBeDefined();
    });

    it('detects mutating array methods on this.props in class render', () => {
      const source = `
import React from 'react';
export class Component extends React.Component {
  render() {
    return <div>{this.props.items.reverse().join(',')}</div>;
  }
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'props-array-mutated-in-render')).toBeDefined();
    });

    it('does not flag cloned arrays sorted in render', () => {
      const source = `
import React from 'react';
export function Component({ items }: any) {
  const sorted = [...items].sort();
  return <ul>{sorted.map((item) => <li key={item.id}>{item.name}</li>)}</ul>;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'props-array-mutated-in-render')).toBeUndefined();
    });

    it('detects push on props-derived arrays in render', () => {
      const source = `
import React from 'react';
export function Component({ items }: any) {
  items.push({ id: 'extra' });
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'props-array-mutated-in-render')).toBeDefined();
    });

    it('does not flag shadowed prop names mutated in render', () => {
      const source = `
import React from 'react';
export function Component({ items }: any) {
  {
    const items = [];
    items.push('local');
  }
  return null;
}
`;
      const report = reviewSource(source, 'comp.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'props-array-mutated-in-render')).toBeUndefined();
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
      const finding = report.findings.find((f) => f.ruleId === 'server-hook');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('error');
      expect(finding!.provenance?.summary).toContain('client-only React hook');
      expect(finding!.provenance?.steps.map((step) => step.kind)).toEqual(['boundary', 'call']);
      expect(finding!.provenance?.steps[1]?.label).toBe('useState()');
    });

    it('detects useEffect in server component', () => {
      const source = `
import { useEffect } from 'react';
export default function ServerPage() {
  useEffect(() => {}, []);
  return <div>Hello</div>;
}
`;
      const report = reviewSource(source, 'page.tsx', nextjsConfig);
      const finding = report.findings.find((f) => f.ruleId === 'server-hook');
      expect(finding).toBeDefined();
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
      const finding = report.findings.find((f) => f.ruleId === 'server-hook');
      expect(finding).toBeUndefined();
    });
  });

  // ── next-client-api-in-server ──

  describe('next-client-api-in-server', () => {
    it('detects useRouter in server component', () => {
      const source = `
import { useRouter } from 'next/navigation';
export default function Page() {
  const router = useRouter();
  return <button onClick={() => router.push('/x')}>Go</button>;
}
`;
      const report = reviewSource(source, 'page.tsx', nextjsConfig);
      const finding = report.findings.find((f) => f.ruleId === 'next-client-api-in-server');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('useRouter');
      expect(finding!.provenance?.summary).toContain('next/navigation API useRouter()');
      expect(finding!.provenance?.steps.map((step) => step.kind)).toEqual(['boundary', 'call']);
      expect(finding!.provenance?.steps[1]?.label).toBe('useRouter()');
    });

    it('detects useSearchParams via namespace import in server component', () => {
      const source = `
import * as navigation from 'next/navigation';
export default function Page() {
  const params = navigation.useSearchParams();
  return <div>{params.get('q')}</div>;
}
`;
      const report = reviewSource(source, 'page.tsx', nextjsConfig);
      const finding = report.findings.find((f) => f.ruleId === 'next-client-api-in-server');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('useSearchParams');
    });

    it('does not flag client component with use client', () => {
      const source = `
'use client';
import { usePathname } from 'next/navigation';
export default function ClientPage() {
  const pathname = usePathname();
  return <div>{pathname}</div>;
}
`;
      const report = reviewSource(source, 'page.tsx', nextjsConfig);
      const finding = report.findings.find((f) => f.ruleId === 'next-client-api-in-server');
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
      const finding = report.findings.find((f) => f.ruleId === 'missing-use-client');
      expect(finding).toBeDefined();
    });

    it('does not flag component with use client directive', () => {
      const source = `
'use client';
export default function ClientPage() {
  return <button onClick={() => {}}>Click</button>;
}
`;
      const report = reviewSource(source, 'page.tsx', nextjsConfig);
      const finding = report.findings.find((f) => f.ruleId === 'missing-use-client');
      expect(finding).toBeUndefined();
    });
  });

  // ── hydration-mismatch ──

  describe('hydration-mismatch', () => {
    it('detects Date.now() in render', () => {
      const source = `
import React from 'react';
export default function Page() {
  const ts = Date.now();
  return <div>{ts}</div>;
}
`;
      const report = reviewSource(source, 'page.tsx', nextjsConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('Date.now()');
    });

    it('detects Math.random() in render', () => {
      const source = `
import React from 'react';
export default function Page() {
  const id = Math.random();
  return <div>{id}</div>;
}
`;
      const report = reviewSource(source, 'page.tsx', nextjsConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('Math.random()');
    });

    it('detects new Date() in render', () => {
      const source = `
import React from 'react';
export default function Page() {
  const now = new Date();
  return <div>{now.toISOString()}</div>;
}
`;
      const report = reviewSource(source, 'page.tsx', nextjsConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
      expect(finding).toBeDefined();
      expect(finding!.message).toContain('new Date()');
    });

    it('does not flag Date.now() inside useEffect', () => {
      const source = `
import React, { useEffect } from 'react';
export default function Page() {
  useEffect(() => {
    const ts = Date.now();
    console.log(ts);
  }, []);
  return <div>Hello</div>;
}
`;
      const report = reviewSource(source, 'page.tsx', nextjsConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
      expect(finding).toBeUndefined();
    });

    it('does not flag in non-React files', () => {
      const source = `
const ts = Date.now();
export function getTimestamp() { return ts; }
`;
      const report = reviewSource(source, 'utils.ts', nextjsConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
      expect(finding).toBeUndefined();
    });

    // RULE-FEEDBACK.md #5: a fetch wrapper imports NextRequest from next/server
    // for type purposes only — no JSX. Today `isReactFile` returns true on
    // any `from 'next/...'` import and the rule fires on Date.now() inside
    // the timing instrumentation.
    it('does NOT fire on a fetch wrapper that imports from next/ but renders no JSX', () => {
      const source = `
import type { NextRequest } from 'next/server';
declare const __IS_SERVER: boolean;
declare const Logger: { error: (...args: unknown[]) => void };
declare function buildHeaders(token: string): Promise<Headers>;

export async function request<T>(url: string, token: string): Promise<T> {
  const startTime = __IS_SERVER ? Date.now() : 0;
  const headers = await buildHeaders(token);
  const response = await fetch(url, { headers });
  Logger.error('API_LOG', { fetchTime: Math.round(Date.now() - startTime), status: response.status });
  return response.json();
}
`;
      const report = reviewSource(source, 'src/lib/request.ts', nextjsConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
      expect(finding).toBeUndefined();
    });

    // RULE-FEEDBACK.md #5(b): __IS_SERVER ternary guard is explicit author intent.
    it('does NOT fire when Date.now() is gated by __IS_SERVER ternary', () => {
      const source = `
declare const __IS_SERVER: boolean;
export default function Page() {
  const t = __IS_SERVER ? Date.now() : 0;
  return <div>{t}</div>;
}
`;
      const report = reviewSource(source, 'app/page.tsx', nextjsConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
      expect(finding).toBeUndefined();
    });

    it('does NOT fire when typeof window guard precedes', () => {
      const source = `
export default function Page() {
  const t = typeof window === 'undefined' ? Date.now() : 0;
  return <div>{t}</div>;
}
`;
      const report = reviewSource(source, 'app/page.tsx', nextjsConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
      expect(finding).toBeUndefined();
    });

    // RULE-FEEDBACK.md #5(c): Logger.error / metrics calls are not render.
    it('does NOT fire when Date.now() is inside Logger.error(...) call', () => {
      const source = `
declare const Logger: { error: (...args: unknown[]) => void };
export default function Page({ startTime }: { startTime: number }) {
  Logger.error('API', { fetchTime: Date.now() - startTime });
  return <div>ok</div>;
}
`;
      const report = reviewSource(source, 'app/page.tsx', nextjsConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
      expect(finding).toBeUndefined();
    });

    // Regression guard: bare Date.now() in JSX-rendering function still fires.
    it('still fires on Date.now() rendered into JSX outside any guard', () => {
      const source = `
export default function Page() {
  return <div>now: {Date.now()}</div>;
}
`;
      const report = reviewSource(source, 'app/page.tsx', nextjsConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
      expect(finding).toBeDefined();
    });

    // Gemini review #1: multi-line server-gate ternary must also be skipped.
    it('does NOT fire on multi-line __IS_SERVER ternary', () => {
      const source = `
declare const __IS_SERVER: boolean;
export default function Page() {
  const t = __IS_SERVER
    ? Date.now()
    : 0;
  return <div>{t}</div>;
}
`;
      const report = reviewSource(source, 'app/page.tsx', nextjsConfig);
      const finding = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
      expect(finding).toBeUndefined();
    });

    // Gemini review #2: bracket-balance spill. A Logger call followed by an
    // unrelated bare Date.now() on the same source span must still fire on
    // the unrelated one.
    it('STILL fires on unrelated Date.now() after a closed Logger.info call', () => {
      const source = `
declare const Logger: { info: (...args: unknown[]) => void };
export default function Page({ startTime }: { startTime: number }) {
  Logger.info('latency', { ms: Date.now() - startTime });
  return <div>{Date.now()}</div>;
}
`;
      const report = reviewSource(source, 'app/page.tsx', nextjsConfig);
      const findings = report.findings.filter((f) => f.ruleId === 'hydration-mismatch');
      // Exactly one finding — the bare Date.now() in the JSX. The one inside
      // Logger.info must NOT fire (it's telemetry). The bracket-balance fix
      // ensures the post-Logger call doesn't get silenced by spillover.
      expect(findings.length).toBe(1);
    });
  });

  // ── component-did-update-setstate-unguarded ───────────────────────────

  describe('component-did-update-setstate-unguarded', () => {
    it('flags componentDidUpdate setState without a prevProps/prevState guard', () => {
      const source = `
import React from 'react';
export class Profile extends React.Component<{ id: string }, { loaded: boolean }> {
  componentDidUpdate() {
    this.setState({ loaded: true });
  }
  render() { return null; }
}
`;
      const report = reviewSource(source, 'profile.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'component-did-update-setstate-unguarded')).toBeDefined();
    });

    it('does not flag componentDidUpdate setState behind a prevProps comparison', () => {
      const source = `
import React from 'react';
export class Profile extends React.Component<{ id: string }, { loaded: boolean }> {
  componentDidUpdate(prevProps: { id: string }) {
    if (prevProps.id !== this.props.id) {
      this.setState({ loaded: false });
    }
  }
  render() { return null; }
}
`;
      const report = reviewSource(source, 'profile.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'component-did-update-setstate-unguarded')).toBeUndefined();
    });

    it('does not flag componentDidUpdate setState after an early-return guard', () => {
      const source = `
import React from 'react';
export class Profile extends React.Component<{ id: string }, { loaded: boolean }> {
  componentDidUpdate(prevProps: { id: string }) {
    if (prevProps.id === this.props.id) return;
    this.setState({ loaded: false });
  }
  render() { return null; }
}
`;
      const report = reviewSource(source, 'profile.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'component-did-update-setstate-unguarded')).toBeUndefined();
    });

    it('does not flag componentDidUpdate setState behind a destructured prev comparison', () => {
      const source = `
import React from 'react';
export class Profile extends React.Component<{ id: string }, { loaded: boolean }> {
  componentDidUpdate(prevProps: { id: string }) {
    const { id } = this.props;
    const { id: prevId } = prevProps;
    if (id !== prevId) {
      this.setState({ loaded: false });
    }
  }
  render() { return null; }
}
`;
      const report = reviewSource(source, 'profile.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'component-did-update-setstate-unguarded')).toBeUndefined();
    });

    it('does not flag non-React classes with a componentDidUpdate method', () => {
      const source = `
export class Store {
  componentDidUpdate() {
    this.setState({ loaded: true });
  }
  setState(_next: unknown) {}
}
`;
      const report = reviewSource(source, 'store.ts', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'component-did-update-setstate-unguarded')).toBeUndefined();
    });
  });

  // ── clone-element-children-without-valid-guard ────────────────────────

  describe('clone-element-children-without-valid-guard', () => {
    it('flags cloneElement(children, ...) without validating children', () => {
      const source = `
import React, { cloneElement } from 'react';
export function Wrapper({ children }: { children: React.ReactNode }) {
  return cloneElement(children, { className: 'wrapped' });
}
`;
      const report = reviewSource(source, 'wrapper.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'clone-element-children-without-valid-guard')).toBeDefined();
    });

    it('does not flag cloneElement(children, ...) after isValidElement guard', () => {
      const source = `
import React, { cloneElement, isValidElement } from 'react';
export function Wrapper({ children }: { children: React.ReactNode }) {
  if (!isValidElement(children)) return null;
  return cloneElement(children, { className: 'wrapped' });
}
`;
      const report = reviewSource(source, 'wrapper.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'clone-element-children-without-valid-guard')).toBeUndefined();
    });

    it('does not flag cloning a normalized Children.only result', () => {
      const source = `
import React, { cloneElement, Children } from 'react';
export function Wrapper({ children }: { children: React.ReactNode }) {
  const child = Children.only(children);
  return cloneElement(child, { className: 'wrapped' });
}
`;
      const report = reviewSource(source, 'wrapper.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'clone-element-children-without-valid-guard')).toBeUndefined();
    });
  });

  // ── async-setstate-after-unmount ──────────────────────────────────────

  describe('async-setstate-after-unmount', () => {
    it('flags promise setState from componentDidMount without unmount guard', () => {
      const source = `
import React from 'react';
export class Loader extends React.Component<{}, { item?: string }> {
  componentDidMount() {
    fetch('/api/item').then((response) => response.text()).then((item) => {
      this.setState({ item });
    });
  }
  render() { return null; }
}
`;
      const report = reviewSource(source, 'loader.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'async-setstate-after-unmount')).toBeDefined();
    });

    it('does not flag promise setState when componentWillUnmount cancels work', () => {
      const source = `
import React from 'react';
export class Loader extends React.Component<{}, { item?: string }> {
  private abortController = new AbortController();
  componentDidMount() {
    fetch('/api/item', { signal: this.abortController.signal }).then((response) => response.text()).then((item) => {
      this.setState({ item });
    });
  }
  componentWillUnmount() {
    this.abortController.abort();
  }
  render() { return null; }
}
`;
      const report = reviewSource(source, 'loader.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'async-setstate-after-unmount')).toBeUndefined();
    });

    it('flags promise catch setState from componentDidMount without unmount guard', () => {
      const source = `
import React from 'react';
export class Loader extends React.Component<{}, { error?: string }> {
  componentDidMount() {
    fetch('/api/item').catch((error) => {
      this.setState({ error: String(error) });
    });
  }
  render() { return null; }
}
`;
      const report = reviewSource(source, 'loader.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'async-setstate-after-unmount')).toBeDefined();
    });

    it('does not suppress async setState just because an unrelated class member mentions cancel', () => {
      const source = `
import React from 'react';
export class Loader extends React.Component<{}, { item?: string }> {
  cancelLabel = 'Cancel';
  componentDidMount() {
    fetch('/api/item').then((response) => response.text()).then((item) => {
      this.setState({ item });
    });
  }
  componentWillUnmount() {
    console.log(this.cancelLabel);
  }
  render() { return null; }
}
`;
      const report = reviewSource(source, 'loader.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'async-setstate-after-unmount')).toBeDefined();
    });

    it('flags async lifecycle setState after await without unmount guard', () => {
      const source = `
import React from 'react';
export class Loader extends React.Component<{}, { item?: string }> {
  async componentDidMount() {
    const response = await fetch('/api/item');
    const item = await response.text();
    this.setState({ item });
  }
  render() { return null; }
}
`;
      const report = reviewSource(source, 'loader.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'async-setstate-after-unmount')).toBeDefined();
    });
  });

  describe('effect-fetch-missing-cancel-guard', () => {
    it('flags effect fetch that sets state without cleanup guard', () => {
      const source = `
import { useEffect, useState } from 'react';
export function Loader() {
  const [item, setItem] = useState('');
  useEffect(() => {
    fetch('/api/item').then((r) => r.text()).then(setItem);
  }, []);
  return <div>{item}</div>;
}
`;
      const report = reviewSource(source, 'loader.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'effect-fetch-missing-cancel-guard')).toBeDefined();
    });

    it('does not flag effect fetch with ignore cleanup guard', () => {
      const source = `
import { useEffect, useState } from 'react';
export function Loader() {
  const [item, setItem] = useState('');
  useEffect(() => {
    let ignore = false;
    fetch('/api/item').then((r) => r.text()).then((text) => {
      if (!ignore) setItem(text);
    });
    return () => { ignore = true; };
  }, []);
  return <div>{item}</div>;
}
`;
      const report = reviewSource(source, 'loader.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'effect-fetch-missing-cancel-guard')).toBeUndefined();
    });

    it('flags React.useLayoutEffect window.fetch that sets state through an arrow callback', () => {
      const source = `
import React from 'react';
export function Loader() {
  const [item, setItem] = React.useState('');
  React.useLayoutEffect(() => {
    window.fetch('/api/item').then((r) => r.text()).then((text) => setItem(text));
  }, []);
  return <div>{item}</div>;
}
`;
      const report = reviewSource(source, 'loader.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'effect-fetch-missing-cancel-guard')).toBeDefined();
    });
  });

  describe('interval-state-setter-needs-functional-update', () => {
    it('flags interval setter that closes over state', () => {
      const source = `
import { useEffect, useState } from 'react';
export function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCount(count + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <div>{count}</div>;
}
`;
      const report = reviewSource(source, 'counter.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'interval-state-setter-needs-functional-update')).toBeDefined();
    });

    it('does not flag functional interval updater', () => {
      const source = `
import { useEffect, useState } from 'react';
export function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCount((current) => current + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return <div>{count}</div>;
}
`;
      const report = reviewSource(source, 'counter.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'interval-state-setter-needs-functional-update')).toBeUndefined();
    });
  });

  describe('imperative-handle-missing-deps', () => {
    it('flags useImperativeHandle without deps', () => {
      const source = `
import { forwardRef, useImperativeHandle } from 'react';
export const Input = forwardRef(function Input(props, ref) {
  useImperativeHandle(ref, () => ({ focus() {} }));
  return null;
});
`;
      const report = reviewSource(source, 'input.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'imperative-handle-missing-deps')).toBeDefined();
    });

    it('does not flag useImperativeHandle with deps', () => {
      const source = `
import { forwardRef, useImperativeHandle } from 'react';
export const Input = forwardRef(function Input(props, ref) {
  useImperativeHandle(ref, () => ({ focus() {} }), []);
  return null;
});
`;
      const report = reviewSource(source, 'input.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'imperative-handle-missing-deps')).toBeUndefined();
    });

    it('flags useImperativeHandle with non-array deps argument', () => {
      const source = `
import { forwardRef, useImperativeHandle } from 'react';
export const Input = forwardRef(function Input(props, ref) {
  useImperativeHandle(ref, () => ({ focus() {} }), null as any);
  return null;
});
`;
      const report = reviewSource(source, 'input.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'imperative-handle-missing-deps')).toBeDefined();
    });
  });

  describe('context-created-in-component', () => {
    it('flags createContext inside component', () => {
      const source = `
import { createContext } from 'react';
export function App() {
  const ThemeContext = createContext('light');
  return <ThemeContext.Provider value="dark" />;
}
`;
      const report = reviewSource(source, 'app.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'context-created-in-component')).toBeDefined();
    });

    it('does not flag module-scope createContext', () => {
      const source = `
import { createContext } from 'react';
const ThemeContext = createContext('light');
export function App() {
  return <ThemeContext.Provider value="dark" />;
}
`;
      const report = reviewSource(source, 'app.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'context-created-in-component')).toBeUndefined();
    });

    it('flags createContext inside a custom hook', () => {
      const source = `
import { createContext } from 'react';
export function useThemeContext() {
  return createContext('light');
}
`;
      const report = reviewSource(source, 'hooks.ts', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'context-created-in-component')).toBeDefined();
    });
  });

  describe('context-default-assertion', () => {
    it('flags createContext with asserted empty object default', () => {
      const source = `
import { createContext } from 'react';
type ThemeContextValue = { theme: string; setTheme(theme: string): void };
export const ThemeContext = createContext({} as ThemeContextValue);
`;
      const report = reviewSource(source, 'theme.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'context-default-assertion')).toBeDefined();
    });

    it('does not flag nullable context default without assertion', () => {
      const source = `
import { createContext } from 'react';
type ThemeContextValue = { theme: string; setTheme(theme: string): void };
export const ThemeContext = createContext<ThemeContextValue | null>(null);
`;
      const report = reviewSource(source, 'theme.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'context-default-assertion')).toBeUndefined();
    });

    it('flags createContext with satisfies empty object default', () => {
      const source = `
import { createContext } from 'react';
type ThemeContextValue = Partial<{ theme: string; setTheme(theme: string): void }>;
export const ThemeContext = createContext({} satisfies ThemeContextValue);
`;
      const report = reviewSource(source, 'theme.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'context-default-assertion')).toBeDefined();
    });
  });

  describe('redux-selector-unstable-return', () => {
    it('flags useSelector returning object without equality function', () => {
      const source = `
import { useSelector } from 'react-redux';
export function User() {
  const user = useSelector((state: any) => ({ id: state.user.id, name: state.user.name }));
  return <div>{user.name}</div>;
}
`;
      const report = reviewSource(source, 'user.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'redux-selector-unstable-return')).toBeDefined();
    });

    it('does not flag useSelector object return with shallowEqual', () => {
      const source = `
import { shallowEqual, useSelector } from 'react-redux';
export function User() {
  const user = useSelector((state: any) => ({ id: state.user.id, name: state.user.name }), shallowEqual);
  return <div>{user.name}</div>;
}
`;
      const report = reviewSource(source, 'user.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'redux-selector-unstable-return')).toBeUndefined();
    });
  });

  describe('redux-dispatch-in-render', () => {
    it('flags dispatch called during render', () => {
      const source = `
import { useDispatch } from 'react-redux';
export function Page() {
  const dispatch = useDispatch();
  dispatch({ type: 'loaded' });
  return null;
}
`;
      const report = reviewSource(source, 'page.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'redux-dispatch-in-render')).toBeDefined();
    });

    it('does not flag dispatch inside event handler', () => {
      const source = `
import { useDispatch } from 'react-redux';
export function Page() {
  const dispatch = useDispatch();
  return <button onClick={() => dispatch({ type: 'clicked' })}>Save</button>;
}
`;
      const report = reviewSource(source, 'page.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'redux-dispatch-in-render')).toBeUndefined();
    });

    it('flags dispatch inside render-time conditional', () => {
      const source = `
import { useDispatch } from 'react-redux';
export function Page({ ready }: { ready: boolean }) {
  const dispatch = useDispatch();
  if (ready) {
    dispatch({ type: 'loaded' });
  }
  return null;
}
`;
      const report = reviewSource(source, 'page.tsx', reactConfig);
      expect(report.findings.find((f) => f.ruleId === 'redux-dispatch-in-render')).toBeDefined();
    });
  });
});
