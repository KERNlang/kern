/**
 * Norm miner tests — profile building, clustering, norm computation, violation detection.
 */

import type { ConceptMap, ConceptNode, ConceptSpan } from '@kernlang/core';
import type { FileContext } from '../src/types.js';
import { mineNorms, type NormViolation } from '../src/norm-miner.js';

// ── Test Helpers ─────────────────────────────────────────────────────────

function span(file: string, line: number): ConceptSpan {
  return { file, startLine: line, startCol: 1, endLine: line, endCol: 1 };
}

function fnDeclNode(file: string, name: string, line: number): ConceptNode {
  return {
    id: `${file}#function_declaration@${line}`,
    kind: 'function_declaration',
    primarySpan: span(file, line),
    evidence: `function ${name}`,
    confidence: 1,
    language: 'ts',
    payload: { kind: 'function_declaration', name, async: false, hasAwait: false, isComponent: false, isExport: true },
  };
}

function guardNode(file: string, containerId: string, line: number, subtype: 'auth' | 'validation' = 'validation'): ConceptNode {
  return {
    id: `${file}#guard@${line}`,
    kind: 'guard',
    primarySpan: span(file, line),
    evidence: 'validation guard',
    confidence: 0.9,
    language: 'ts',
    containerId,
    payload: { kind: 'guard', subtype },
  };
}

function errorHandleNode(file: string, containerId: string, line: number): ConceptNode {
  return {
    id: `${file}#error_handle@${line}`,
    kind: 'error_handle',
    primarySpan: span(file, line),
    evidence: 'try/catch',
    confidence: 0.9,
    language: 'ts',
    containerId,
    payload: { kind: 'error_handle', disposition: 'returned' },
  };
}

function effectNode(file: string, containerId: string, line: number, subtype: 'db' | 'network' | 'fs' = 'db'): ConceptNode {
  return {
    id: `${file}#effect@${line}`,
    kind: 'effect',
    primarySpan: span(file, line),
    evidence: 'db query',
    confidence: 0.9,
    language: 'ts',
    containerId,
    payload: { kind: 'effect', subtype, async: true },
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

function makeFileContext(boundary: 'api' | 'server' | 'client' | 'middleware' | 'shared' | 'unknown'): FileContext {
  return {
    boundary,
    entryPoints: [],
    importChain: [],
    depth: 0,
    importedBy: [],
    isClientBoundary: false,
    hasUseClientDirective: false,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('mineNorms: profile building', () => {
  it('builds profiles for functions with guards, error handling, and effects', () => {
    const file = '/src/handler.ts';
    const fnId = `${file}#function_declaration@5`;
    const nodes: ConceptNode[] = [
      fnDeclNode(file, 'createUser', 5),
      guardNode(file, fnId, 7),
      errorHandleNode(file, fnId, 10),
      effectNode(file, fnId, 12, 'db'),
    ];
    const allConcepts = new Map([[file, makeConceptMap(file, nodes)]]);
    const fileContextMap = new Map([[file, makeFileContext('api')]]);
    const inferredPerFile = new Map([[file, []]]);

    const { profiles } = mineNorms(allConcepts, inferredPerFile, fileContextMap);

    expect(profiles.length).toBe(1);
    expect(profiles[0].hasGuard).toBe(true);
    expect(profiles[0].hasErrorHandle).toBe(true);
    expect(profiles[0].effectSubtypes.has('db')).toBe(true);
    expect(profiles[0].boundary).toBe('api');
  });

  it('builds profiles for functions without guards or error handling', () => {
    const file = '/src/handler.ts';
    const fnId = `${file}#function_declaration@5`;
    const nodes: ConceptNode[] = [
      fnDeclNode(file, 'deleteUser', 5),
      effectNode(file, fnId, 8, 'db'),
    ];
    const allConcepts = new Map([[file, makeConceptMap(file, nodes)]]);
    const fileContextMap = new Map([[file, makeFileContext('api')]]);
    const inferredPerFile = new Map([[file, []]]);

    const { profiles } = mineNorms(allConcepts, inferredPerFile, fileContextMap);

    expect(profiles.length).toBe(1);
    expect(profiles[0].hasGuard).toBe(false);
    expect(profiles[0].hasErrorHandle).toBe(false);
  });
});

describe('mineNorms: clustering and violation detection', () => {
  it('detects missing-guard violation when 3+ peers have guards', () => {
    const files = ['/src/a.ts', '/src/b.ts', '/src/c.ts', '/src/d.ts'];
    const allConcepts = new Map<string, ConceptMap>();
    const fileContextMap = new Map<string, FileContext>();
    const inferredPerFile = new Map<string, never[]>();

    // 3 handlers with guards + effects
    for (const file of files.slice(0, 3)) {
      const fnId = `${file}#function_declaration@5`;
      allConcepts.set(file, makeConceptMap(file, [
        fnDeclNode(file, `handler_${file}`, 5),
        guardNode(file, fnId, 7),
        effectNode(file, fnId, 10, 'db'),
      ]));
      fileContextMap.set(file, makeFileContext('api'));
      inferredPerFile.set(file, []);
    }

    // 1 handler WITHOUT guard but with effect
    const noGuardFile = files[3];
    const noGuardFnId = `${noGuardFile}#function_declaration@5`;
    allConcepts.set(noGuardFile, makeConceptMap(noGuardFile, [
      fnDeclNode(noGuardFile, 'unguarded_handler', 5),
      effectNode(noGuardFile, noGuardFnId, 10, 'db'),
    ]));
    fileContextMap.set(noGuardFile, makeFileContext('api'));
    inferredPerFile.set(noGuardFile, []);

    const { violations } = mineNorms(allConcepts, inferredPerFile, fileContextMap);

    const guardViolations = violations.filter(v => v.violationType === 'missing-guard');
    expect(guardViolations.length).toBeGreaterThanOrEqual(1);

    const violation = guardViolations.find(v => v.filePath === noGuardFile);
    expect(violation).toBeDefined();
    expect(violation!.prevalence).toBeGreaterThanOrEqual(0.7);
    expect(violation!.peerCount).toBeGreaterThanOrEqual(3);
  });

  it('detects missing-error-handle violation when 3+ peers handle errors', () => {
    const files = ['/src/a.ts', '/src/b.ts', '/src/c.ts', '/src/d.ts'];
    const allConcepts = new Map<string, ConceptMap>();
    const fileContextMap = new Map<string, FileContext>();
    const inferredPerFile = new Map<string, never[]>();

    for (const file of files.slice(0, 3)) {
      const fnId = `${file}#function_declaration@5`;
      allConcepts.set(file, makeConceptMap(file, [
        fnDeclNode(file, `handler_${file}`, 5),
        errorHandleNode(file, fnId, 8),
        effectNode(file, fnId, 10, 'db'),
      ]));
      fileContextMap.set(file, makeFileContext('api'));
      inferredPerFile.set(file, []);
    }

    const noHandleFile = files[3];
    const noHandleFnId = `${noHandleFile}#function_declaration@5`;
    allConcepts.set(noHandleFile, makeConceptMap(noHandleFile, [
      fnDeclNode(noHandleFile, 'unhandled_handler', 5),
      effectNode(noHandleFile, noHandleFnId, 10, 'db'),
    ]));
    fileContextMap.set(noHandleFile, makeFileContext('api'));
    inferredPerFile.set(noHandleFile, []);

    const { violations } = mineNorms(allConcepts, inferredPerFile, fileContextMap);

    const errorViolations = violations.filter(v => v.violationType === 'missing-error-handle');
    expect(errorViolations.length).toBeGreaterThanOrEqual(1);

    const violation = errorViolations.find(v => v.filePath === noHandleFile);
    expect(violation).toBeDefined();
  });

  it('does NOT flag violations when cluster has fewer than 3 members', () => {
    const files = ['/src/a.ts', '/src/b.ts'];
    const allConcepts = new Map<string, ConceptMap>();
    const fileContextMap = new Map<string, FileContext>();
    const inferredPerFile = new Map<string, never[]>();

    // 1 handler with guard
    const fnIdA = `${files[0]}#function_declaration@5`;
    allConcepts.set(files[0], makeConceptMap(files[0], [
      fnDeclNode(files[0], 'handler_a', 5),
      guardNode(files[0], fnIdA, 7),
      effectNode(files[0], fnIdA, 10, 'db'),
    ]));
    fileContextMap.set(files[0], makeFileContext('api'));
    inferredPerFile.set(files[0], []);

    // 1 handler without guard
    const fnIdB = `${files[1]}#function_declaration@5`;
    allConcepts.set(files[1], makeConceptMap(files[1], [
      fnDeclNode(files[1], 'handler_b', 5),
      effectNode(files[1], fnIdB, 10, 'db'),
    ]));
    fileContextMap.set(files[1], makeFileContext('api'));
    inferredPerFile.set(files[1], []);

    const { violations } = mineNorms(allConcepts, inferredPerFile, fileContextMap);

    expect(violations.length).toBe(0);
  });

  it('clusters by boundary — does not mix api and middleware handlers', () => {
    const allConcepts = new Map<string, ConceptMap>();
    const fileContextMap = new Map<string, FileContext>();
    const inferredPerFile = new Map<string, never[]>();

    // 3 API handlers with guards
    for (let i = 0; i < 3; i++) {
      const file = `/src/api-${i}.ts`;
      const fnId = `${file}#function_declaration@5`;
      allConcepts.set(file, makeConceptMap(file, [
        fnDeclNode(file, `api_${i}`, 5),
        guardNode(file, fnId, 7),
        effectNode(file, fnId, 10, 'db'),
      ]));
      fileContextMap.set(file, makeFileContext('api'));
      inferredPerFile.set(file, []);
    }

    // 1 middleware handler without guard — should NOT be flagged (different boundary)
    const mwFile = '/src/middleware.ts';
    const mwFnId = `${mwFile}#function_declaration@5`;
    allConcepts.set(mwFile, makeConceptMap(mwFile, [
      fnDeclNode(mwFile, 'middleware_handler', 5),
      effectNode(mwFile, mwFnId, 10, 'db'),
    ]));
    fileContextMap.set(mwFile, makeFileContext('middleware'));
    inferredPerFile.set(mwFile, []);

    const { violations } = mineNorms(allConcepts, inferredPerFile, fileContextMap);

    // Middleware handler should not be flagged (cluster too small)
    const mwViolations = violations.filter(v => v.filePath === mwFile);
    expect(mwViolations.length).toBe(0);
  });

  it('returns profiles for all function declarations', () => {
    const file = '/src/handler.ts';
    const fn1Id = `${file}#function_declaration@5`;
    const fn2Id = `${file}#function_declaration@20`;
    const nodes: ConceptNode[] = [
      fnDeclNode(file, 'createUser', 5),
      guardNode(file, fn1Id, 7),
      effectNode(file, fn1Id, 10, 'db'),
      fnDeclNode(file, 'listUsers', 20),
      effectNode(file, fn2Id, 22, 'db'),
    ];
    const allConcepts = new Map([[file, makeConceptMap(file, nodes)]]);
    const fileContextMap = new Map([[file, makeFileContext('api')]]);
    const inferredPerFile = new Map([[file, []]]);

    const { profiles } = mineNorms(allConcepts, inferredPerFile, fileContextMap);

    expect(profiles.length).toBe(2);
    const createProfile = profiles.find(p => p.functionId.includes('function_declaration@5'));
    const listProfile = profiles.find(p => p.functionId.includes('function_declaration@20'));
    expect(createProfile?.hasGuard).toBe(true);
    expect(listProfile?.hasGuard).toBe(false);
  });
});
