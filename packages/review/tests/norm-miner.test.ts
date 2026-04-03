/**
 * Norm miner tests — clustering, norm computation, violation detection.
 */

import type { ConceptMap, ConceptNode, ConceptSpan } from '@kernlang/core';
import { mineNorms, type NormViolation } from '../src/norm-miner.js';

// ── Test Helpers ─────────────────────────────────────────────────────────

const span = (file: string, line: number): ConceptSpan => ({
  file, startLine: line, startCol: 0, endLine: line, endCol: 80,
});

function fnDeclNode(file: string, name: string, line: number): ConceptNode {
  return {
    id: `${file}#function_declaration@${line}`,
    kind: 'function_declaration',
    containerId: undefined,
    payload: { kind: 'function_declaration', name, async: false, hasAwait: false, isComponent: false, isExport: false },
    primarySpan: span(file, line),
    evidence: `function ${name}() {}`,
    confidence: 1,
    language: 'ts',
  };
}

function guardNode(file: string, containerId: string, line: number): ConceptNode {
  return {
    id: `${file}#guard@${line}`,
    kind: 'guard',
    containerId,
    payload: { kind: 'guard', subtype: 'validation' },
    primarySpan: span(file, line),
    evidence: 'if (!valid) throw',
    confidence: 1,
    language: 'ts',
  };
}

function errorHandleNode(file: string, containerId: string, line: number): ConceptNode {
  return {
    id: `${file}#error_handle@${line}`,
    kind: 'error_handle',
    containerId,
    payload: { kind: 'error_handle', disposition: 'wrapped' },
    primarySpan: span(file, line),
    evidence: 'try { } catch (e) { }',
    confidence: 1,
    language: 'ts',
  };
}

function effectNode(file: string, containerId: string, line: number, subtype: 'network' | 'db' | 'fs' | 'process' | 'time' | 'random'): ConceptNode {
  return {
    id: `${file}#effect@${line}`,
    kind: 'effect',
    containerId,
    payload: { kind: 'effect', subtype, async: false },
    primarySpan: span(file, line),
    evidence: 'db.query()',
    confidence: 1,
    language: 'ts',
  };
}

function makeConceptMap(file: string, nodes: ConceptNode[]): ConceptMap {
  return {
    filePath: file,
    language: 'ts',
    nodes,
    edges: [],
    extractorVersion: '1.0.0',
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('mineNorms: violation detection', () => {
  it('detects missing-guard violation when 3+ peers have guards', () => {
    const files = ['/src/a.ts', '/src/b.ts', '/src/c.ts', '/src/d.ts'];
    const allConcepts = new Map<string, ConceptMap>();

    // containerId format used by norm-miner: filePath#fn:name@
    for (const file of files.slice(0, 3)) {
      const name = `handler_${file.replace(/\//g, '_')}`;
      const containerId = `${file}#fn:${name}@5`;
      allConcepts.set(file, makeConceptMap(file, [
        fnDeclNode(file, name, 5),
        guardNode(file, containerId, 7),
        effectNode(file, containerId, 10, 'db'),
      ]));
    }

    const noGuardFile = files[3];
    const noGuardName = 'unguarded_handler';
    const noGuardContainerId = `${noGuardFile}#fn:${noGuardName}@5`;
    allConcepts.set(noGuardFile, makeConceptMap(noGuardFile, [
      fnDeclNode(noGuardFile, noGuardName, 5),
      effectNode(noGuardFile, noGuardContainerId, 10, 'db'),
    ]));

    const violations = mineNorms(allConcepts);

    const guardViolations = violations.filter(v => v.missingKind === 'guard');
    expect(guardViolations.length).toBeGreaterThanOrEqual(1);

    const violation = guardViolations.find(v => v.functionNode.primarySpan.file === noGuardFile);
    expect(violation).toBeDefined();
    expect(violation!.prevalence).toBeGreaterThanOrEqual(0.5);
    expect(violation!.peerCount).toBeGreaterThanOrEqual(2);
  });

  it('detects missing-error-handle violation when 3+ peers handle errors', () => {
    const files = ['/src/a.ts', '/src/b.ts', '/src/c.ts', '/src/d.ts'];
    const allConcepts = new Map<string, ConceptMap>();

    for (const file of files.slice(0, 3)) {
      const name = `handler_${file.replace(/\//g, '_')}`;
      const containerId = `${file}#fn:${name}@5`;
      allConcepts.set(file, makeConceptMap(file, [
        fnDeclNode(file, name, 5),
        errorHandleNode(file, containerId, 8),
        effectNode(file, containerId, 10, 'db'),
      ]));
    }

    const noHandleFile = files[3];
    const noHandleName = 'unhandled_handler';
    const noHandleContainerId = `${noHandleFile}#fn:${noHandleName}@5`;
    allConcepts.set(noHandleFile, makeConceptMap(noHandleFile, [
      fnDeclNode(noHandleFile, noHandleName, 5),
      effectNode(noHandleFile, noHandleContainerId, 10, 'db'),
    ]));

    const violations = mineNorms(allConcepts);

    const errorViolations = violations.filter(v => v.missingKind === 'error_handle');
    expect(errorViolations.length).toBeGreaterThanOrEqual(1);

    const violation = errorViolations.find(v => v.functionNode.primarySpan.file === noHandleFile);
    expect(violation).toBeDefined();
  });

  it('does NOT flag violations when cluster has fewer than 3 members', () => {
    const files = ['/src/a.ts', '/src/b.ts'];
    const allConcepts = new Map<string, ConceptMap>();

    const fnIdA = `${files[0]}#function_declaration@5`;
    allConcepts.set(files[0], makeConceptMap(files[0], [
      fnDeclNode(files[0], 'handler_a', 5),
      guardNode(files[0], fnIdA, 7),
      effectNode(files[0], fnIdA, 10, 'db'),
    ]));

    const fnIdB = `${files[1]}#function_declaration@5`;
    allConcepts.set(files[1], makeConceptMap(files[1], [
      fnDeclNode(files[1], 'handler_b', 5),
      effectNode(files[1], fnIdB, 10, 'db'),
    ]));

    const violations = mineNorms(allConcepts);
    expect(violations.length).toBe(0);
  });

  it('returns empty array when no concepts provided', () => {
    const violations = mineNorms(new Map());
    expect(violations).toEqual([]);
  });
});
