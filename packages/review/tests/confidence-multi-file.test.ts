/**
 * Cross-file confidence graph tests (Plan 2)
 */

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { IRNode } from '@kernlang/core';
import { tmpdir } from 'os';
import { buildConfidenceGraph, buildMultiFileConfidenceGraph } from '../src/confidence.js';
import { reviewGraph } from '../src/index.js';
import { lintMultiFileConfidenceGraph } from '../src/rules/confidence.js';

function makeNode(type: string, props: Record<string, unknown> = {}, children: IRNode[] = [], line = 0): IRNode {
  return { type, props, children, loc: { line, col: 1 } };
}

const TMP = join(tmpdir(), 'kern-review-confidence-tests');

describe('Cross-file confidence: buildMultiFileConfidenceGraph', () => {
  it('resolves from: across files', () => {
    const fileMap = new Map([
      ['models.kern', [makeNode('derive', { name: 'authMethod', confidence: '0.85' }, [], 1)]],
      ['routes.kern', [makeNode('guard', { name: 'loginRoute', confidence: 'from:authMethod', expr: 'x' }, [], 1)]],
    ]);
    const graph = buildMultiFileConfidenceGraph(fileMap);
    expect(graph.nodes.get('loginRoute')!.resolved).toBe(0.85);
    expect(graph.nodes.get('authMethod')!.resolved).toBe(0.85);
  });

  it('resolves min: sources spanning two files', () => {
    const fileMap = new Map([
      ['a.kern', [makeNode('derive', { name: 'x', confidence: '0.9' }, [], 1)]],
      [
        'b.kern',
        [
          makeNode('derive', { name: 'y', confidence: '0.6' }, [], 1),
          makeNode('derive', { name: 'z', confidence: 'min:x,y' }, [], 2),
        ],
      ],
    ]);
    const graph = buildMultiFileConfidenceGraph(fileMap);
    expect(graph.nodes.get('z')!.resolved).toBe(0.6); // min(0.9, 0.6)
  });

  it('detects cycles across files', () => {
    const fileMap = new Map([
      ['a.kern', [makeNode('derive', { name: 'p', confidence: 'from:q' }, [], 1)]],
      ['b.kern', [makeNode('derive', { name: 'q', confidence: 'from:p' }, [], 1)]],
    ]);
    const graph = buildMultiFileConfidenceGraph(fileMap);
    expect(graph.nodes.get('p')!.inCycle).toBe(true);
    expect(graph.nodes.get('q')!.inCycle).toBe(true);
    expect(graph.cycles.length).toBe(1);
  });

  it('reports duplicate names across files', () => {
    const fileMap = new Map([
      ['a.kern', [makeNode('derive', { name: 'shared', confidence: '0.7' }, [], 1)]],
      ['b.kern', [makeNode('derive', { name: 'shared', confidence: '0.9' }, [], 1)]],
    ]);
    const graph = buildMultiFileConfidenceGraph(fileMap);
    expect(graph.duplicates.length).toBe(1);
    expect(graph.duplicates[0].name).toBe('shared');
    expect(graph.duplicates[0].files).toEqual(['a.kern', 'b.kern']);
  });

  it('handles missing source that exists in neither file', () => {
    const fileMap = new Map([
      ['a.kern', [makeNode('derive', { name: 'orphan', confidence: 'from:nonexistent' }, [], 1)]],
    ]);
    const graph = buildMultiFileConfidenceGraph(fileMap);
    expect(graph.nodes.get('orphan')!.resolved).toBeNull();
  });

  it('sets sourceFile on ConfidenceNode', () => {
    const fileMap = new Map([['models.kern', [makeNode('derive', { name: 'auth', confidence: '0.8' }, [], 1)]]]);
    const graph = buildMultiFileConfidenceGraph(fileMap);
    expect(graph.nodes.get('auth')!.sourceFile).toBe('models.kern');
  });
});

describe('Cross-file confidence: lintMultiFileConfidenceGraph', () => {
  it('returns zero findings for clean multi-file graph', () => {
    const fileMap = new Map([
      ['a.kern', [makeNode('derive', { name: 'x', confidence: '0.8' }, [], 1)]],
      ['b.kern', [makeNode('derive', { name: 'y', confidence: 'from:x' }, [], 1)]],
    ]);
    const findings = lintMultiFileConfidenceGraph(fileMap);
    expect(findings).toEqual([]);
  });

  it('reports confidence-duplicate-name finding', () => {
    const fileMap = new Map([
      ['a.kern', [makeNode('derive', { name: 'dup', confidence: '0.7' }, [], 1)]],
      ['b.kern', [makeNode('derive', { name: 'dup', confidence: '0.9' }, [], 1)]],
    ]);
    const findings = lintMultiFileConfidenceGraph(fileMap);
    expect(findings.some((f) => f.ruleId === 'confidence-duplicate-name')).toBe(true);
  });
});

describe('Cross-file confidence: regression', () => {
  it('single-file buildConfidenceGraph behavior unchanged', () => {
    const nodes = [
      makeNode('derive', { name: 'a', confidence: '0.7' }, [], 1),
      makeNode('derive', { name: 'b', confidence: 'from:a' }, [], 2),
    ];
    const graph = buildConfidenceGraph(nodes);
    expect(graph.nodes.get('a')!.resolved).toBe(0.7);
    expect(graph.nodes.get('b')!.resolved).toBe(0.7);
    expect(graph.nodes.get('a')!.sourceFile).toBeUndefined();
  });
});

describe('Cross-file confidence: reviewGraph integration', () => {
  it('attaches duplicate-name findings to each .kern report', () => {
    const dir = join(TMP, 'duplicate-name-review-graph');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const aFile = join(dir, 'a.kern');
    const bFile = join(dir, 'b.kern');
    writeFileSync(aFile, `derive name=shared confidence=0.7`);
    writeFileSync(bFile, `derive name=shared confidence=0.9`);

    const reports = reviewGraph([aFile, bFile], { noCache: true });
    const aReport = reports.find((r) => r.filePath === aFile);
    const bReport = reports.find((r) => r.filePath === bFile);

    expect(aReport?.findings.some((f) => f.ruleId === 'confidence-duplicate-name')).toBe(true);
    expect(bReport?.findings.some((f) => f.ruleId === 'confidence-duplicate-name')).toBe(true);
  });
});
