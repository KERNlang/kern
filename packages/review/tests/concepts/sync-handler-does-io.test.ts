import type { ConceptMap, ConceptNode, EffectPayload } from '@kernlang/core';
import { syncHandlerDoesIo } from '../../src/concept-rules/sync-handler-does-io.js';

const CONTAINER = 'app.py#fn:list_users@10';

function route(isAsync: boolean | undefined, containerId = CONTAINER): ConceptNode {
  return {
    id: 'app.py#entrypoint@1',
    kind: 'entrypoint',
    primarySpan: { file: 'app.py', startLine: 3, startCol: 1, endLine: 3, endCol: 30 },
    evidence: '@router.get("/api/users")',
    confidence: 1,
    language: 'py',
    containerId,
    payload: {
      kind: 'entrypoint',
      subtype: 'route',
      name: '/api/users',
      httpMethod: 'GET',
      isAsync,
    },
  };
}

function effect(subtype: EffectPayload['subtype'], containerId = CONTAINER, startLine = 5): ConceptNode {
  return {
    id: `app.py#effect@${startLine}`,
    kind: 'effect',
    primarySpan: { file: 'app.py', startLine, startCol: 5, endLine: startLine, endCol: 40 },
    evidence: `${subtype}()`,
    confidence: 1,
    language: 'py',
    containerId,
    payload: { kind: 'effect', subtype, async: false },
  };
}

function map(nodes: ConceptNode[]): ConceptMap {
  return { filePath: 'app.py', language: 'py', extractorVersion: 'test', nodes, edges: [] };
}

describe('sync-handler-does-io', () => {
  it('fires when a sync route handler does network I/O in the same container', () => {
    const concepts = map([route(false), effect('network')]);
    const findings = syncHandlerDoesIo({ concepts, filePath: 'app.py' });
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('sync-handler-does-io');
    expect(findings[0].message).toContain('network I/O');
  });

  it('fires when a sync route handler does db I/O', () => {
    const concepts = map([route(false), effect('db')]);
    const findings = syncHandlerDoesIo({ concepts, filePath: 'app.py' });
    expect(findings[0].message).toContain('db I/O');
  });

  it('fires when a sync route handler does fs I/O', () => {
    const concepts = map([route(false), effect('fs')]);
    const findings = syncHandlerDoesIo({ concepts, filePath: 'app.py' });
    expect(findings[0].message).toContain('fs I/O');
  });

  it('is silent when an async route handler does I/O', () => {
    const concepts = map([route(true), effect('network')]);
    expect(syncHandlerDoesIo({ concepts, filePath: 'app.py' })).toEqual([]);
  });

  it('is silent when a sync route handler has no I/O effect', () => {
    const concepts = map([route(false)]);
    expect(syncHandlerDoesIo({ concepts, filePath: 'app.py' })).toEqual([]);
  });

  it('is silent when I/O happens in a different container', () => {
    const concepts = map([route(false), effect('network', 'app.py#fn:helper@99')]);
    expect(syncHandlerDoesIo({ concepts, filePath: 'app.py' })).toEqual([]);
  });

  it('is silent when route async-ness is unknown', () => {
    const concepts = map([route(undefined), effect('network')]);
    expect(syncHandlerDoesIo({ concepts, filePath: 'app.py' })).toEqual([]);
  });

  it('is silent for non-blocking effect subtypes', () => {
    const concepts = map([route(false), effect('time')]);
    expect(syncHandlerDoesIo({ concepts, filePath: 'app.py' })).toEqual([]);
  });

  it('emits one finding per route and links all same-container I/O effects', () => {
    const concepts = map([route(false), effect('network', CONTAINER, 5), effect('db', CONTAINER, 6)]);
    const findings = syncHandlerDoesIo({ concepts, filePath: 'app.py' });
    expect(findings).toHaveLength(1);
    expect(findings[0].relatedSpans).toHaveLength(2);
  });

  it('uses fixed 0.9 confidence', () => {
    const concepts = map([route(false), effect('network')]);
    const findings = syncHandlerDoesIo({ concepts, filePath: 'app.py' });
    expect(findings[0].confidence).toBe(0.9);
  });
});
