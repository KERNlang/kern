/// <reference types="jest" />
import type { ConceptMap, ConceptNode, EffectPayload } from '@kernlang/core';
import { insecureTransport } from '../../src/concept-rules/insecure-transport.js';

function networkEffect(target: string, options: { host?: string; line?: number } = {}): ConceptNode {
  const payload: EffectPayload = {
    kind: 'effect',
    subtype: 'network',
    async: true,
    target,
    host: options.host,
  };
  return {
    id: `client.ts#effect@${options.line ?? 5}`,
    kind: 'effect',
    primarySpan: {
      file: 'client.ts',
      startLine: options.line ?? 5,
      startCol: 1,
      endLine: options.line ?? 5,
      endCol: 30,
    },
    evidence: `fetch('${target}')`,
    confidence: 0.9,
    language: 'ts',
    payload,
  };
}

function map(nodes: ConceptNode[]): ConceptMap {
  return {
    filePath: 'client.ts',
    language: 'ts',
    extractorVersion: 'test',
    nodes,
    edges: [],
  };
}

function run(nodes: ConceptNode[]) {
  return insecureTransport({
    concepts: map(nodes),
    filePath: 'client.ts',
  });
}

describe('insecure-transport', () => {
  it('fires on http:// to a public host', () => {
    const findings = run([networkEffect('http://api.example.com/users', { host: 'api.example.com' })]);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('insecure-transport');
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('api.example.com');
  });

  it('does not fire on https://', () => {
    const findings = run([networkEffect('https://api.example.com/users', { host: 'api.example.com' })]);
    expect(findings).toHaveLength(0);
  });

  it('fires on uppercase / mixed-case HTTP scheme (URL schemes are case-insensitive)', () => {
    for (const target of ['HTTP://api.example.com/x', 'Http://api.example.com/x']) {
      const findings = run([networkEffect(target, { host: 'api.example.com' })]);
      expect(findings).toHaveLength(1);
    }
  });

  it('does not fire on localhost variants', () => {
    const cases = ['localhost', 'localhost:3000', '127.0.0.1', '127.0.0.1:8080', '0.0.0.0:5000'];
    for (const host of cases) {
      const findings = run([networkEffect(`http://${host}/health`, { host })]);
      expect(findings).toHaveLength(0);
    }
  });

  it('does not fire on RFC1918 private IPs', () => {
    const cases = ['10.0.0.1', '10.20.30.40:9000', '192.168.1.1', '172.16.5.5', '172.31.0.1', '169.254.169.254'];
    for (const host of cases) {
      const findings = run([networkEffect(`http://${host}/api`, { host })]);
      expect(findings).toHaveLength(0);
    }
  });

  it('does not fire on 127.x short-form IPv4 (127.1, 127.0.1)', () => {
    for (const host of ['127.1', '127.0.1', '127.0.0.1', '127.1:8080']) {
      const findings = run([networkEffect(`http://${host}/api`, { host })]);
      expect(findings).toHaveLength(0);
    }
  });

  it('does not fire on .local / .internal / .test / .svc / cluster.local', () => {
    const cases = ['db.local', 'auth.internal', 'foo.test', 'service.svc', 'service.svc.cluster.local'];
    for (const host of cases) {
      const findings = run([networkEffect(`http://${host}/api`, { host })]);
      expect(findings).toHaveLength(0);
    }
  });

  it('does not fire on single-label internal hosts (Docker/k8s service DNS)', () => {
    for (const host of ['svc', 'internal', 'local', 'test']) {
      const findings = run([networkEffect(`http://${host}/api`, { host })]);
      expect(findings).toHaveLength(0);
    }
  });

  it('FIRES on public domains that contain reserved-TLD substrings (test.com, internal.net, svc.io)', () => {
    // Gemini impl-review caught the original SPECIAL_TLD_RE incorrectly
    // exempting `api.test.com` because the optional outer label `(?:\.[a-z]+)?`
    // let `.test.com$` slide. The anchored fix matches only when the
    // reserved TLD is at the end of the host string.
    for (const host of ['api.test.com', 'svc.io', 'internal.net', 'mytest.com']) {
      const findings = run([networkEffect(`http://${host}/api`, { host })]);
      expect(findings).toHaveLength(1);
    }
  });

  it('does not fire on http://user:pass@localhost (auth-in-URL classifies against real host)', () => {
    const findings = run([networkEffect('http://admin:secret@localhost/admin')]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when target is a template-literal residue', () => {
    const findings = run([networkEffect('http://${HOST}/api')]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when target is missing', () => {
    const node: ConceptNode = {
      id: 'client.ts#effect@5',
      kind: 'effect',
      primarySpan: { file: 'client.ts', startLine: 5, startCol: 1, endLine: 5, endCol: 30 },
      evidence: 'fetch(url)',
      confidence: 0.9,
      language: 'ts',
      payload: { kind: 'effect', subtype: 'network', async: true },
    };
    const findings = run([node]);
    expect(findings).toHaveLength(0);
  });

  it('falls back to parsing target when host is not provided', () => {
    // Mapper may emit `target` without `host` for some shapes — the rule
    // should still classify cleanly.
    const findings = run([networkEffect('http://example.org:8080/api')]);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('example.org');
  });

  it('does not fire on non-network effects (db, fs, background-task)', () => {
    const dbEffect: ConceptNode = {
      id: 'a#effect@1',
      kind: 'effect',
      primarySpan: { file: 'client.ts', startLine: 1, startCol: 1, endLine: 1, endCol: 10 },
      evidence: 'db.query()',
      confidence: 0.9,
      language: 'ts',
      payload: { kind: 'effect', subtype: 'db', async: false, target: 'http://example.com' },
    };
    const findings = run([dbEffect]);
    expect(findings).toHaveLength(0);
  });
});
