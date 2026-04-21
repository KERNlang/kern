import type {
  CallPayload,
  ConceptEdge,
  ConceptMap,
  ConceptNode,
  ConceptSpan as ConceptSpanType,
  DependencyPayload,
  EffectPayload,
  EntrypointPayload,
  ErrorHandlePayload,
  ErrorRaisePayload,
  FunctionDeclarationPayload,
  GuardPayload,
  StateMutationPayload,
} from '../src/concepts.js';
import { conceptId, conceptSpan } from '../src/concepts.js';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeSpan(file = 'test.ts', line = 1, col = 0): ConceptSpanType {
  return conceptSpan(file, line, col, line + 5, col + 10);
}

function makeNode(kind: ConceptNode['kind'], payload: ConceptNode['payload'], offset = 0): ConceptNode {
  return {
    id: conceptId('test.ts', kind, offset),
    kind,
    primarySpan: makeSpan(),
    evidence: `evidence for ${kind}`,
    confidence: 0.95,
    language: 'ts',
    payload,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('conceptId', () => {
  it('formats filePath#kind@offset', () => {
    expect(conceptId('src/app.ts', 'entrypoint', 42)).toBe('src/app.ts#entrypoint@42');
  });

  it('handles empty strings', () => {
    expect(conceptId('', '', 0)).toBe('#@0');
  });

  it('handles special characters in path', () => {
    expect(conceptId('/a b/c#d.ts', 'effect', 7)).toBe('/a b/c#d.ts#effect@7');
  });
});

describe('conceptSpan', () => {
  it('returns span with all arguments', () => {
    const span = conceptSpan('file.ts', 10, 5, 20, 30);
    expect(span).toEqual({ file: 'file.ts', startLine: 10, startCol: 5, endLine: 20, endCol: 30 });
  });

  it('defaults endLine to startLine when omitted', () => {
    const span = conceptSpan('file.ts', 10, 5);
    expect(span.endLine).toBe(10);
    expect(span.endCol).toBe(5);
  });

  it('defaults endCol to startCol when only endLine provided', () => {
    const span = conceptSpan('file.ts', 10, 5, 20);
    expect(span.endLine).toBe(20);
    expect(span.endCol).toBe(5);
  });

  it('handles zero values', () => {
    const span = conceptSpan('', 0, 0, 0, 0);
    expect(span).toEqual({ file: '', startLine: 0, startCol: 0, endLine: 0, endCol: 0 });
  });
});

describe('ConceptNode construction', () => {
  it('builds entrypoint node', () => {
    const payload: EntrypointPayload = {
      kind: 'entrypoint',
      subtype: 'route',
      name: '/api/users',
      httpMethod: 'GET',
      responseModel: 'UserOut',
      isAsync: true,
    };
    const node = makeNode('entrypoint', payload);
    expect(node.kind).toBe('entrypoint');
    expect(node.payload.kind).toBe('entrypoint');
    expect((node.payload as EntrypointPayload).subtype).toBe('route');
    expect((node.payload as EntrypointPayload).responseModel).toBe('UserOut');
    expect((node.payload as EntrypointPayload).isAsync).toBe(true);
  });

  it('builds effect node', () => {
    const payload: EffectPayload = {
      kind: 'effect',
      subtype: 'network',
      target: 'https://api.example.com',
      async: true,
    };
    const node = makeNode('effect', payload);
    expect(node.kind).toBe('effect');
    expect(node.payload.kind).toBe('effect');
    expect((node.payload as EffectPayload).async).toBe(true);
  });

  it('builds state_mutation node', () => {
    const payload: StateMutationPayload = {
      kind: 'state_mutation',
      target: 'count',
      scope: 'module',
      via: 'increment',
    };
    const node = makeNode('state_mutation', payload);
    expect(node.kind).toBe('state_mutation');
    expect(node.payload.kind).toBe('state_mutation');
    expect((node.payload as StateMutationPayload).scope).toBe('module');
  });

  it('builds error_raise node', () => {
    const payload: ErrorRaisePayload = { kind: 'error_raise', subtype: 'throw', errorType: 'TypeError' };
    const node = makeNode('error_raise', payload);
    expect(node.kind).toBe('error_raise');
    expect(node.payload.kind).toBe('error_raise');
    expect((node.payload as ErrorRaisePayload).errorType).toBe('TypeError');
  });

  it('builds error_handle node', () => {
    const payload: ErrorHandlePayload = { kind: 'error_handle', disposition: 'logged', errorVariable: 'err' };
    const node = makeNode('error_handle', payload);
    expect(node.kind).toBe('error_handle');
    expect(node.payload.kind).toBe('error_handle');
    expect((node.payload as ErrorHandlePayload).disposition).toBe('logged');
  });

  it('builds guard node', () => {
    const payload: GuardPayload = { kind: 'guard', subtype: 'auth', name: 'requireAdmin' };
    const node = makeNode('guard', payload);
    expect(node.kind).toBe('guard');
    expect(node.payload.kind).toBe('guard');
    expect((node.payload as GuardPayload).name).toBe('requireAdmin');
  });

  it('builds function_declaration node', () => {
    const payload: FunctionDeclarationPayload = {
      kind: 'function_declaration',
      name: 'fetchUsers',
      async: true,
      hasAwait: true,
      isComponent: false,
      isExport: true,
    };
    const node = makeNode('function_declaration', payload);
    expect(node.kind).toBe('function_declaration');
    expect(node.payload.kind).toBe('function_declaration');
    expect((node.payload as FunctionDeclarationPayload).name).toBe('fetchUsers');
  });
});

describe('ConceptEdge construction', () => {
  it('builds call edge', () => {
    const payload: CallPayload = { kind: 'call', async: true, name: 'fetchUsers' };
    const edge: ConceptEdge = {
      id: conceptId('test.ts', 'call', 10),
      kind: 'call',
      sourceId: conceptId('test.ts', 'entrypoint', 0),
      targetId: conceptId('test.ts', 'effect', 5),
      primarySpan: makeSpan(),
      evidence: 'fetchUsers()',
      confidence: 0.9,
      language: 'ts',
      payload,
    };
    expect(edge.kind).toBe('call');
    expect(edge.payload.kind).toBe('call');
    expect((edge.payload as CallPayload).async).toBe(true);
  });

  it('builds dependency edge', () => {
    const payload: DependencyPayload = { kind: 'dependency', subtype: 'external', specifier: 'express' };
    const edge: ConceptEdge = {
      id: conceptId('test.ts', 'dependency', 0),
      kind: 'dependency',
      sourceId: conceptId('test.ts', 'entrypoint', 0),
      targetId: conceptId('test.ts', 'effect', 5),
      primarySpan: makeSpan(),
      evidence: "import express from 'express'",
      confidence: 1.0,
      language: 'ts',
      payload,
    };
    expect(edge.kind).toBe('dependency');
    expect(edge.payload.kind).toBe('dependency');
    expect((edge.payload as DependencyPayload).specifier).toBe('express');
  });
});

describe('ConceptMap construction', () => {
  it('builds a complete map with nodes and edges', () => {
    const entryNode = makeNode('entrypoint', { kind: 'entrypoint', subtype: 'handler', name: 'handleReq' }, 0);
    const effectNode = makeNode('effect', { kind: 'effect', subtype: 'db', async: true }, 10);

    const callEdge: ConceptEdge = {
      id: conceptId('test.ts', 'call', 5),
      kind: 'call',
      sourceId: entryNode.id,
      targetId: effectNode.id,
      primarySpan: makeSpan(),
      evidence: 'db.query()',
      confidence: 0.85,
      language: 'ts',
      payload: { kind: 'call', async: true, name: 'query' },
    };

    const map: ConceptMap = {
      filePath: 'test.ts',
      language: 'ts',
      nodes: [entryNode, effectNode],
      edges: [callEdge],
      extractorVersion: '1.0.0',
    };

    expect(map.nodes).toHaveLength(2);
    expect(map.edges).toHaveLength(1);
    expect(map.nodes[0].kind).toBe('entrypoint');
    expect(map.nodes[1].kind).toBe('effect');
    expect(map.edges[0].sourceId).toBe(entryNode.id);
    expect(map.edges[0].targetId).toBe(effectNode.id);
    expect(map.extractorVersion).toBe('1.0.0');
  });
});
