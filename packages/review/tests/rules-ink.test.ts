import { reviewSource } from '../src/index.js';
import type { ReviewConfig } from '../src/types.js';

const inkConfig: ReviewConfig = { target: 'ink' };

describe('Ink Rules', () => {
  describe('ink-console-output', () => {
    it('detects console.log in Ink component', () => {
      const source = `
import React from 'react';
import { Text } from 'ink';

export function App() {
  console.log('debug');
  return <Text>Hello</Text>;
}
`;
      const report = reviewSource(source, 'app.tsx', inkConfig);
      const finding = report.findings.find(f => f.ruleId === 'ink-console-output');
      expect(finding).toBeDefined();
    });

    it('does not flag files without ink import', () => {
      const source = `
import React from 'react';
export function App() {
  console.log('debug');
  return null;
}
`;
      const report = reviewSource(source, 'app.tsx', inkConfig);
      const finding = report.findings.find(f => f.ruleId === 'ink-console-output');
      expect(finding).toBeUndefined();
    });
  });

  describe('ink-direct-stdout', () => {
    it('detects process.stdout.write in Ink component', () => {
      const source = `
import React from 'react';
import { Text } from 'ink';

export function App() {
  process.stdout.write('raw output');
  return <Text>OK</Text>;
}
`;
      const report = reviewSource(source, 'app.tsx', inkConfig);
      const finding = report.findings.find(f => f.ruleId === 'ink-direct-stdout');
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe('error');
    });
  });

  describe('ink-process-exit', () => {
    it('detects process.exit() in Ink component', () => {
      const source = `
import React from 'react';
import { Text } from 'ink';

export function App() {
  if (error) process.exit(1);
  return <Text>OK</Text>;
}
`;
      const report = reviewSource(source, 'app.tsx', inkConfig);
      const finding = report.findings.find(f => f.ruleId === 'ink-process-exit');
      expect(finding).toBeDefined();
    });
  });

  describe('ink-uncleared-interval', () => {
    it('detects setInterval without clearInterval', () => {
      const source = `
import React, { useEffect } from 'react';
import { Text } from 'ink';

export function Timer() {
  useEffect(() => {
    setInterval(() => {}, 1000);
  }, []);
  return <Text>tick</Text>;
}
`;
      const report = reviewSource(source, 'timer.tsx', inkConfig);
      const finding = report.findings.find(f => f.ruleId === 'ink-uncleared-interval');
      expect(finding).toBeDefined();
    });

    it('does not flag when clearInterval is used', () => {
      const source = `
import React, { useEffect } from 'react';
import { Text } from 'ink';

export function Timer() {
  useEffect(() => {
    const id = setInterval(() => {}, 1000);
    return () => clearInterval(id);
  }, []);
  return <Text>tick</Text>;
}
`;
      const report = reviewSource(source, 'timer.tsx', inkConfig);
      const finding = report.findings.find(f => f.ruleId === 'ink-uncleared-interval');
      expect(finding).toBeUndefined();
    });
  });

  describe('ink gets React rules', () => {
    it('detects async-effect (React rule) with ink target', () => {
      const source = `
import { useEffect } from 'react';
import { Text } from 'ink';

export function App() {
  useEffect(async () => { await fetch('/api'); }, []);
  return <Text>data</Text>;
}
`;
      const report = reviewSource(source, 'app.tsx', inkConfig);
      const reactRule = report.findings.find(f => f.ruleId === 'async-effect');
      expect(reactRule).toBeDefined();
    });
  });
});
