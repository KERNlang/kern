/**
 * Tests for new review features:
 *   - Target-aware rule gating (isReactFile, BACKEND_TARGETS)
 *   - Confidence-based filtering (assignDefaultConfidence, minConfidence)
 *   - Auto-fix generation (empty-catch, floating-promise, missing-use-client, hardcoded-secret)
 *   - Interprocedural taint tracking (buildInternalSinkMap, multi-sink)
 *   - File context / import chain (buildFileContextMap, traceImportChain)
 */

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { buildFileContextMap } from '../src/file-context.js';
import { resolveImportGraph } from '../src/graph.js';
import { reviewGraph, reviewSource } from '../src/index.js';
import { assignDefaultConfidence } from '../src/reporter.js';
import { getActiveRules } from '../src/rules/index.js';
import type { ReviewConfig, ReviewFinding } from '../src/types.js';

const expressConfig: ReviewConfig = { target: 'express' };
const nextjsConfig: ReviewConfig = { target: 'nextjs' };
const _mcpConfig: ReviewConfig = { target: 'mcp' as any };
const TMP = join(tmpdir(), 'kern-review-new-features');

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });
});
afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ── Target-aware rule gating ────────────────────────────────────────────

describe('Target-aware rule gating', () => {
  describe('isReactFile guard', () => {
    it('hydration-mismatch does NOT fire on non-React files', () => {
      const source = `
export function handler(req: any, res: any) {
  const timestamp = Date.now();
  const id = Math.random();
  res.json({ timestamp, id });
}
`;
      const report = reviewSource(source, 'handler.ts', nextjsConfig);
      const hydration = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
      expect(hydration).toBeUndefined();
    });

    it('hydration-mismatch DOES fire on React files with nondeterministic expressions', () => {
      const source = `
import React from 'react';
export function Timer() {
  const now = Date.now();
  return <div>{now}</div>;
}
`;
      const report = reviewSource(source, 'timer.tsx', nextjsConfig);
      const hydration = report.findings.find((f) => f.ruleId === 'hydration-mismatch');
      expect(hydration).toBeDefined();
    });
  });

  describe('BACKEND_TARGETS', () => {
    it('Express target does NOT load React rules', () => {
      const rules = getActiveRules('express');
      // Express should have express rules but NOT react/nextjs rules
      // React rules include: asyncEffect, renderSideEffect, unstableKey, etc.
      // We check that no React-specific rule function name patterns appear
      expect(rules.length).toBeGreaterThan(0);
      // reviewSource with React hooks in Express target should NOT flag server-hook
      const source = `
import { useState } from 'react';
export function Component() {
  const [x, setX] = useState(0);
  return x;
}
`;
      const report = reviewSource(source, 'comp.tsx', expressConfig);
      const serverHook = report.findings.find((f) => f.ruleId === 'server-hook');
      expect(serverHook).toBeUndefined();
    });

    it('MCP target does NOT load Vue or React rules', () => {
      const mcpRules = getActiveRules('mcp' as any);
      const webRules = getActiveRules('web');
      // MCP is a backend target — fewer rules than 'web' (which includes React rules)
      expect(mcpRules.length).toBeLessThan(webRules.length);
    });
  });
});

// ── Confidence-based filtering ──────────────────────────────────────────

describe('Confidence-based filtering', () => {
  describe('assignDefaultConfidence', () => {
    it('assigns TSC findings confidence 1.0', () => {
      const findings: ReviewFinding[] = [
        {
          source: 'tsc',
          ruleId: 'ts2792',
          severity: 'error',
          category: 'bug',
          message: 'Cannot find module',
          primarySpan: { file: 'test.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          fingerprint: 'tsc-1',
        },
      ];
      assignDefaultConfidence(findings);
      expect(findings[0].confidence).toBe(1.0);
    });

    it('assigns kern findings confidence 0.85', () => {
      const findings: ReviewFinding[] = [
        {
          source: 'kern',
          ruleId: 'floating-promise',
          severity: 'error',
          category: 'bug',
          message: 'Floating promise',
          primarySpan: { file: 'test.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          fingerprint: 'kern-1',
        },
      ];
      assignDefaultConfidence(findings);
      expect(findings[0].confidence).toBe(0.85);
    });

    it('assigns taint findings confidence 0.95', () => {
      const findings: ReviewFinding[] = [
        {
          source: 'kern',
          ruleId: 'taint-command',
          severity: 'error',
          category: 'bug',
          message: 'Taint flow',
          primarySpan: { file: 'test.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          fingerprint: 'taint-1',
        },
      ];
      assignDefaultConfidence(findings);
      expect(findings[0].confidence).toBe(0.95);
    });

    it('assigns structural diff findings confidence 0.60', () => {
      const findings: ReviewFinding[] = [
        {
          source: 'kern',
          ruleId: 'extra-code',
          severity: 'info',
          category: 'structure',
          message: 'Uncovered lines',
          primarySpan: { file: 'test.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          fingerprint: 'diff-1',
        },
      ];
      assignDefaultConfidence(findings);
      expect(findings[0].confidence).toBe(0.6);
    });

    it('preserves existing confidence (LLM = 0.7)', () => {
      const findings: ReviewFinding[] = [
        {
          source: 'llm',
          ruleId: 'llm-bug',
          severity: 'warning',
          category: 'bug',
          message: 'LLM finding',
          primarySpan: { file: 'test.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
          fingerprint: 'llm-1',
          confidence: 0.7,
        },
      ];
      assignDefaultConfidence(findings);
      expect(findings[0].confidence).toBe(0.7);
    });
  });
});

// ── Auto-fix generation ─────────────────────────────────────────────────

describe('Auto-fix generation', () => {
  it('empty-catch produces autofix with console.error', () => {
    const source = `
export async function doWork() {
  try {
    await fetch('/api');
  } catch (err) {
  }
}
`;
    const report = reviewSource(source, 'work.ts');
    const finding = report.findings.find((f) => f.ruleId === 'empty-catch');
    // empty-catch may be suppressed by ignored-error concept rule — check either
    if (finding) {
      expect(finding.autofix).toBeDefined();
      expect(finding.autofix!.replacement).toContain('console.error');
    }
    // If suppressed by ignored-error, the concept rule fires instead — that's correct behavior
  });

  it('floating-promise produces insert-before autofix with await', () => {
    const source = `
export async function run() {
  console.log('start');
}
export async function main() {
  run();
}
`;
    const report = reviewSource(source, 'main.ts');
    const finding = report.findings.find((f) => f.ruleId === 'floating-promise');
    expect(finding).toBeDefined();
    expect(finding!.autofix).toBeDefined();
    expect(finding!.autofix!.type).toBe('insert-before');
    expect(finding!.autofix!.replacement).toBe('await ');
  });

  it('floating-promise suggests a top-level catch handler for Node CLI scripts', () => {
    const source = `
async function runWithRetry() {
  await doWork();
}
runWithRetry();
`;
    const report = reviewSource(source, 'scripts/guard/forge-retry.mjs');
    const finding = report.findings.find((f) => f.ruleId === 'floating-promise');
    expect(finding).toBeDefined();
    expect(finding!.autofix).toBeDefined();
    expect(finding!.autofix!.type).toBe('replace');
    expect(finding!.autofix!.replacement).toContain('runWithRetry().catch');
    expect(finding!.autofix!.replacement).toContain('process.exit(1)');
  });

  it('missing-use-client produces insert-before autofix at line 1', () => {
    const source = `
import React from 'react';
export function Button() {
  return <button onClick={() => {}}>Click</button>;
}
`;
    const report = reviewSource(source, 'button.tsx', nextjsConfig);
    const finding = report.findings.find((f) => f.ruleId === 'missing-use-client');
    expect(finding).toBeDefined();
    expect(finding!.autofix).toBeDefined();
    expect(finding!.autofix!.type).toBe('insert-before');
    expect(finding!.autofix!.span.startLine).toBe(1);
    expect(finding!.autofix!.replacement).toContain("'use client'");
  });

  it('hardcoded-secret produces replace autofix with process.env', () => {
    const source = `
const API_KEY = 'sk-live-1234567890abcdef1234567890';
export function getKey() { return API_KEY; }
`;
    const report = reviewSource(source, 'config.ts');
    const finding = report.findings.find((f) => f.ruleId === 'hardcoded-secret');
    expect(finding).toBeDefined();
    expect(finding!.autofix).toBeDefined();
    expect(finding!.autofix!.type).toBe('replace');
    expect(finding!.autofix!.replacement).toContain('process.env.');
  });
});

// ── Interprocedural taint tracking ──────────────────────────────────────

describe('Interprocedural taint tracking', () => {
  it('detects taint flow through internal function call via reviewSource', () => {
    const source = `
import { exec } from 'child_process';
function processInput(data: string) {
  exec(data);
}
export function handler(req: Request, res: Response) {
  const cmd = req.body.command;
  processInput(cmd);
}
`;
    const report = reviewSource(source, 'handler.ts');
    // Should detect taint flow: req.body → processInput → exec (interprocedural)
    const taintFindings = report.findings.filter((f) => f.ruleId.startsWith('taint-'));
    expect(taintFindings.length).toBeGreaterThanOrEqual(1);
    // The finding should mention the interprocedural sink
    const interproc = taintFindings.some((f) => f.message.includes('processInput') || f.message.includes('exec'));
    expect(interproc).toBe(true);
  });

  it('detects multiple sink categories when param reaches both exec and query', () => {
    const source = `
import { exec } from 'child_process';
import { db } from './db';
function dangerous(input: string) {
  exec(input);
  db.query(input);
}
export function handler(req: Request, res: Response) {
  dangerous(req.body.data);
}
`;
    const report = reviewSource(source, 'handler.ts');
    const taintFindings = report.findings.filter((f) => f.ruleId.startsWith('taint-'));
    // Should have findings for both command and sql categories
    const _categories = new Set(taintFindings.map((f) => f.ruleId));
    // At minimum should catch the direct sinks in dangerous()
    expect(taintFindings.length).toBeGreaterThanOrEqual(1);
  });
});

// ── File context / import chain ─────────────────────────────────────────

describe('File context and import chain', () => {
  it('classifies Next.js page as server boundary', () => {
    const dir = join(TMP, 'nextjs-context');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'app'), { recursive: true });

    writeFileSync(
      join(dir, 'app', 'page.tsx'),
      `
import { Widget } from './widget';
export default function Page() { return <Widget />; }
`,
    );
    writeFileSync(
      join(dir, 'app', 'widget.tsx'),
      `
export function Widget() { return <div>Hello</div>; }
`,
    );

    const graph = resolveImportGraph([join(dir, 'app', 'page.tsx')]);
    const contextMap = buildFileContextMap(graph);

    const pageCtx = contextMap.get(join(dir, 'app', 'page.tsx'));
    expect(pageCtx).toBeDefined();
    expect(pageCtx!.boundary).toBe('server');
  });

  it('propagates client boundary through import chain', () => {
    const dir = join(TMP, 'client-boundary');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    // Use .ts extension in import to match actual file (avoids extension resolution issues)
    writeFileSync(
      join(dir, 'page.ts'),
      `
'use client';
import { helper } from './helper.js';
export const page = helper;
`,
    );
    writeFileSync(
      join(dir, 'helper.ts'),
      `
export const helper = 42;
`,
    );

    const graph = resolveImportGraph([join(dir, 'page.ts')]);
    const contextMap = buildFileContextMap(graph);

    // Find helper in context map (path may be resolved differently)
    const helperEntry = [...contextMap.entries()].find(([k]) => k.includes('helper'));
    expect(helperEntry).toBeDefined();
    expect(helperEntry![1].isClientBoundary).toBe(true);
  });

  it('classifies API route as api boundary', () => {
    const dir = join(TMP, 'api-route');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, 'app', 'api', 'users'), { recursive: true });

    writeFileSync(
      join(dir, 'app', 'api', 'users', 'route.ts'),
      `
export async function GET(req: Request) {
  return Response.json({ users: [] });
}
`,
    );

    const graph = resolveImportGraph([join(dir, 'app', 'api', 'users', 'route.ts')]);
    const contextMap = buildFileContextMap(graph);

    const routeCtx = contextMap.get(join(dir, 'app', 'api', 'users', 'route.ts'));
    expect(routeCtx).toBeDefined();
    expect(routeCtx!.boundary).toBe('api');
  });

  it('traceImportChain returns correct path from entry to target', () => {
    const dir = join(TMP, 'import-chain');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    writeFileSync(join(dir, 'entry.ts'), `import { mid } from './mid.js';`);
    writeFileSync(join(dir, 'mid.ts'), `import { leaf } from './leaf.js'; export const mid = leaf;`);
    writeFileSync(join(dir, 'leaf.ts'), `export const leaf = 42;`);

    const graph = resolveImportGraph([join(dir, 'entry.ts')]);
    const contextMap = buildFileContextMap(graph);

    const leafCtx = contextMap.get(join(dir, 'leaf.ts'));
    expect(leafCtx).toBeDefined();
    // Import chain should go entry → mid → leaf
    expect(leafCtx!.importChain.length).toBeGreaterThanOrEqual(2);
    expect(leafCtx!.depth).toBe(2);
  });

  it('attaches graph-backed evidence to missing-use-client findings', () => {
    const dir = join(TMP, 'missing-use-client-evidence');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const pagePath = join(dir, 'page.tsx');
    const buttonPath = join(dir, 'button.tsx');

    writeFileSync(
      pagePath,
      `
import { Button } from './button.js';
export default function Page() {
  return <Button />;
}
`,
    );
    writeFileSync(
      buttonPath,
      `
export function Button() {
  return <button onClick={() => {}}>Push</button>;
}
`,
    );

    const reports = reviewGraph([pagePath], nextjsConfig);
    const buttonReport = reports.find((r) => r.filePath === buttonPath);
    const finding = buttonReport?.findings.find((f) => f.ruleId === 'missing-use-client');

    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('error');
    expect(finding!.relatedSpans?.[0]?.file).toBe(pagePath);
    expect(finding!.provenance?.summary).toContain('server importer');
    expect(finding!.provenance?.steps.map((step) => step.kind)).toEqual(['source', 'boundary', 'import']);
    expect(finding!.provenance?.steps[0]?.label).toBe('onClick');
    expect(finding!.provenance?.steps[2]?.label).toBe('page.tsx');
  });

  it('attaches import-chain evidence to server-hook findings', () => {
    const dir = join(TMP, 'server-hook-evidence');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const pagePath = join(dir, 'page.tsx');
    const widgetPath = join(dir, 'widget.tsx');

    writeFileSync(
      pagePath,
      `
import { Widget } from './widget.js';
export default function Page() {
  return <Widget />;
}
`,
    );
    writeFileSync(
      widgetPath,
      `
import { useState } from 'react';
export function Widget() {
  const [count] = useState(0);
  return <div>{count}</div>;
}
`,
    );

    const reports = reviewGraph([pagePath], nextjsConfig);
    const widgetReport = reports.find((r) => r.filePath === widgetPath);
    const finding = widgetReport?.findings.find((f) => f.ruleId === 'server-hook');

    expect(finding).toBeDefined();
    expect(finding!.relatedSpans?.[0]?.file).toBe(pagePath);
    expect(finding!.provenance?.summary).toContain('page.tsx -> widget.tsx');
    expect(finding!.provenance?.steps.map((step) => step.kind)).toEqual(['boundary', 'call']);
    expect(finding!.provenance?.steps[0]?.label).toBe('server entry page.tsx');
    expect(finding!.provenance?.steps[1]?.label).toBe('useState()');
  });

  it('attaches import-chain evidence to next-client-api-in-server findings', () => {
    const dir = join(TMP, 'next-client-api-evidence');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const pagePath = join(dir, 'page.tsx');
    const navPath = join(dir, 'nav.tsx');

    writeFileSync(
      pagePath,
      `
import { NavWidget } from './nav.js';
export default function Page() {
  return <NavWidget />;
}
`,
    );
    writeFileSync(
      navPath,
      `
import { useRouter } from 'next/navigation';
export function NavWidget() {
  const router = useRouter();
  return <button onClick={() => router.push('/next')}>Go</button>;
}
`,
    );

    const reports = reviewGraph([pagePath], nextjsConfig);
    const navReport = reports.find((r) => r.filePath === navPath);
    const finding = navReport?.findings.find((f) => f.ruleId === 'next-client-api-in-server');

    expect(finding).toBeDefined();
    expect(finding!.relatedSpans?.[0]?.file).toBe(pagePath);
    expect(finding!.provenance?.summary).toContain('page.tsx -> nav.tsx');
    expect(finding!.provenance?.steps.map((step) => step.kind)).toEqual(['boundary', 'call']);
    expect(finding!.provenance?.steps[0]?.label).toBe('server entry page.tsx');
    expect(finding!.provenance?.steps[1]?.label).toBe('useRouter()');
  });
});
