/**
 * Obligations tests — synthesis from norm violations, taint, and call graph.
 */

import type { ConceptMap, ConceptNode, ConceptSpan } from '@kernlang/core';
import type { NormViolation } from '../src/norm-miner.js';
import type { TaintResult, TaintPath } from '../src/taint.js';
import type { CallGraph, FunctionNode } from '../src/call-graph.js';
import { synthesizeObligations, type ProofObligation } from '../src/obligations.js';

// ── Test Helpers ─────────────────────────────────────────────────────────

function span(file: string, line: number): ConceptSpan {
  return { file, startLine: line, startCol: 1, endLine: line, endCol: 1 };
}

function makeViolation(overrides: Partial<NormViolation> = {}): NormViolation {
  return {
    functionId: '/src/handler.ts#function_declaration@5',
    filePath: '/src/handler.ts',
    line: 5,
    norm: '80% of peer api handlers have input guards',
    prevalence: 0.8,
    peerCount: 5,
    peerExamples: ['createUser', 'updateUser', 'deleteUser'],
    violationType: 'missing-guard',
    ...overrides,
  };
}

function makeTaintResult(overrides: Partial<TaintResult> = {}): TaintResult {
  return {
    fnName: 'createUser',
    filePath: '/src/handler.ts',
    startLine: 5,
    paths: [],
    ...overrides,
  };
}

function makeTaintPath(overrides: Partial<TaintPath> = {}): TaintPath {
  return {
    source: { name: 'input', origin: 'req.body' },
    sink: { name: 'query', category: 'sql', taintedArg: 'input' },
    sanitized: false,
    ...overrides,
  };
}

function emptyCallGraph(): CallGraph {
  return {
    functions: new Map(),
    deadExports: [],
    orphanFunctions: [],
    unresolvedCallCount: 0,
  };
}

function emptyAllConcepts(): Map<string, ConceptMap> {
  return new Map();
}

// ── Tests: Norm-Derived Obligations ──────────────────────────────────────

describe('synthesizeObligations: from norm violations', () => {
  it('creates obligation from missing-guard violation', () => {
    const violations = [makeViolation({ violationType: 'missing-guard' })];

    const obligations = synthesizeObligations(violations, [], undefined, emptyAllConcepts(), '/src/handler.ts');

    expect(obligations.length).toBe(1);
    expect(obligations[0].type).toBe('norm-violation');
    expect(obligations[0].claim).toContain('skips input validation');
    expect(obligations[0].claim).toContain('peer handlers validate');
    expect(obligations[0].prevalence).toBe(0.8);
    expect(obligations[0].id).toBe('O1');
  });

  it('creates obligation from missing-error-handle violation', () => {
    const violations = [makeViolation({ violationType: 'missing-error-handle' })];

    const obligations = synthesizeObligations(violations, [], undefined, emptyAllConcepts(), '/src/handler.ts');

    expect(obligations.length).toBe(1);
    expect(obligations[0].claim).toContain('no error handling');
    expect(obligations[0].claim).toContain('peer handlers handle errors');
  });

  it('assigns sequential IDs', () => {
    const violations = [
      makeViolation({ violationType: 'missing-guard' }),
      makeViolation({ violationType: 'missing-error-handle', line: 10 }),
    ];

    const obligations = synthesizeObligations(violations, [], undefined, emptyAllConcepts(), '/src/handler.ts');

    expect(obligations.length).toBe(2);
    expect(obligations[0].id).toBe('O1');
    expect(obligations[1].id).toBe('O2');
  });
});

// ── Tests: Sanitizer-Sufficient Obligations ──────────────────────────────

describe('synthesizeObligations: from taint results', () => {
  it('creates obligation for insufficient sanitizer', () => {
    const taintResults = [makeTaintResult({
      paths: [makeTaintPath({
        sanitizer: 'parseInt',
        sanitized: false,
        insufficientSanitizer: 'parseInt',
        sink: { name: 'exec', category: 'command', taintedArg: 'cmd', line: 12 },
      })],
    })];

    const obligations = synthesizeObligations([], taintResults, undefined, emptyAllConcepts(), '/src/handler.ts');

    expect(obligations.length).toBe(1);
    expect(obligations[0].type).toBe('sanitizer-sufficient');
    expect(obligations[0].claim).toContain('parseInt');
    expect(obligations[0].claim).toContain('exec');
    expect(obligations[0].evidence_against.length).toBeGreaterThan(0);
  });

  it('creates obligation for sufficient sanitizer (verification)', () => {
    const taintResults = [makeTaintResult({
      paths: [makeTaintPath({
        sanitizer: 'schema.parse',
        sanitized: true,
        sink: { name: 'query', category: 'sql', taintedArg: 'id', line: 15 },
      })],
    })];

    const obligations = synthesizeObligations([], taintResults, undefined, emptyAllConcepts(), '/src/handler.ts');

    expect(obligations.length).toBe(1);
    expect(obligations[0].type).toBe('sanitizer-sufficient');
    expect(obligations[0].claim).toContain('schema.parse');
    expect(obligations[0].evidence_for.length).toBeGreaterThan(0);
  });

  it('does NOT create obligation for unsanitized paths without sanitizer', () => {
    const taintResults = [makeTaintResult({
      paths: [makeTaintPath({
        sanitizer: undefined,
        sanitized: false,
      })],
    })];

    const obligations = synthesizeObligations([], taintResults, undefined, emptyAllConcepts(), '/src/handler.ts');

    expect(obligations.length).toBe(0);
  });
});

// ── Tests: Error-Handled-By-Caller Obligations ──────────────────────────

describe('synthesizeObligations: from call graph', () => {
  it('creates obligation when function raises errors but caller does not handle them', () => {
    const file = '/src/handler.ts';
    const callerFile = '/src/api.ts';

    // Setup concepts: handler.ts has a function that throws
    const fnId = `${file}#function_declaration@5`;
    const concepts: ConceptMap = {
      filePath: file,
      language: 'ts',
      nodes: [
        {
          id: fnId,
          kind: 'function_declaration',
          primarySpan: span(file, 5),
          evidence: 'function riskyOp',
          confidence: 1,
          language: 'ts',
          payload: { kind: 'function_declaration', name: 'riskyOp', async: false, hasAwait: false, isComponent: false, isExport: true },
        },
        {
          id: `${file}#error_raise@10`,
          kind: 'error_raise',
          primarySpan: span(file, 10),
          evidence: 'throw new Error',
          confidence: 0.9,
          language: 'ts',
          containerId: fnId,
          payload: { kind: 'error_raise', subtype: 'throw' },
        },
      ],
      edges: [],
      extractorVersion: '1.0.0',
    };

    // Caller concepts: no error_handle
    const callerFnId = `${callerFile}#function_declaration@3`;
    const callerConcepts: ConceptMap = {
      filePath: callerFile,
      language: 'ts',
      nodes: [
        {
          id: callerFnId,
          kind: 'function_declaration',
          primarySpan: span(callerFile, 3),
          evidence: 'function apiHandler',
          confidence: 1,
          language: 'ts',
          payload: { kind: 'function_declaration', name: 'apiHandler', async: false, hasAwait: false, isComponent: false, isExport: true },
        },
      ],
      edges: [],
      extractorVersion: '1.0.0',
    };

    const allConcepts = new Map([
      [file, concepts],
      [callerFile, callerConcepts],
    ]);

    // Call graph: apiHandler calls riskyOp
    const callerFn: FunctionNode = {
      name: 'apiHandler',
      filePath: callerFile,
      line: 3,
      isExported: true,
      isAsync: false,
      paramCount: 2,
      calls: [{
        callerName: 'apiHandler',
        callerFile,
        targetName: 'riskyOp',
        targetFile: file,
        line: 5,
        argumentCount: 1,
        resolved: true,
        hasAwait: false,
      }],
      calledBy: [],
    };
    const targetFn: FunctionNode = {
      name: 'riskyOp',
      filePath: file,
      line: 5,
      isExported: true,
      isAsync: false,
      paramCount: 0,
      calls: [],
      calledBy: [{
        callerName: 'apiHandler',
        callerFile,
        targetName: 'riskyOp',
        targetFile: file,
        line: 5,
        argumentCount: 1,
        resolved: true,
        hasAwait: false,
      }],
    };

    const callGraph: CallGraph = {
      functions: new Map([
        [`${callerFile}#apiHandler`, callerFn],
        [`${file}#riskyOp`, targetFn],
      ]),
      deadExports: [],
      orphanFunctions: [],
      unresolvedCallCount: 0,
    };

    const obligations = synthesizeObligations([], [], callGraph, allConcepts, file);

    expect(obligations.length).toBe(1);
    expect(obligations[0].type).toBe('error-handled-by-caller');
    expect(obligations[0].claim).toContain('riskyOp');
    expect(obligations[0].claim).toContain('apiHandler');
  });
});

// ── Tests: Priority and Capping ──────────────────────────────────────────

describe('synthesizeObligations: priority and capping', () => {
  it('sorts by priority: error > sanitizer > norm', () => {
    const violations = [makeViolation({ violationType: 'missing-guard' })];
    const taintResults = [makeTaintResult({
      paths: [makeTaintPath({
        sanitizer: 'parseInt',
        sanitized: false,
        insufficientSanitizer: 'parseInt',
        sink: { name: 'exec', category: 'command', taintedArg: 'cmd', line: 12 },
      })],
    })];

    const obligations = synthesizeObligations(violations, taintResults, undefined, emptyAllConcepts(), '/src/handler.ts');

    expect(obligations.length).toBe(2);
    // Sanitizer should come before norm (priority order: error > sanitizer > norm)
    expect(obligations[0].type).toBe('sanitizer-sufficient');
    expect(obligations[1].type).toBe('norm-violation');
  });

  it('caps obligations at 15 per file', () => {
    // Generate 20 violations
    const violations: NormViolation[] = [];
    for (let i = 0; i < 20; i++) {
      violations.push(makeViolation({ line: i + 1 }));
    }

    const obligations = synthesizeObligations(violations, [], undefined, emptyAllConcepts(), '/src/handler.ts');

    expect(obligations.length).toBe(15);
    // All should have sequential IDs
    for (let i = 0; i < 15; i++) {
      expect(obligations[i].id).toBe(`O${i + 1}`);
    }
  });

  it('returns empty array when no violations, taint, or call graph issues', () => {
    const obligations = synthesizeObligations([], [], undefined, emptyAllConcepts(), '/src/handler.ts');
    expect(obligations.length).toBe(0);
  });
});
