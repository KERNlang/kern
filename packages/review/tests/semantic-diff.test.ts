import { createInMemoryProject, inferFromSource } from '../src/inferrer.js';
import { extractTsConcepts } from '../src/mappers/ts-concepts.js';
import type { SemanticChange } from '../src/semantic-diff.js';
import {
  computeSemanticDiff,
  computeSemanticDiffFromSource,
  formatSemanticDiff,
  semanticChangesToFindings,
} from '../src/semantic-diff.js';

/** Helper: infer IR + extract concepts from source string. */
function analyzeSource(source: string, filePath = 'test.ts') {
  const inferred = inferFromSource(source, filePath);
  const project = createInMemoryProject();
  const sf = project.createSourceFile(filePath, source);
  const concepts = extractTsConcepts(sf, filePath);
  return { inferred, concepts };
}

describe('Semantic Diff', () => {
  // ── Guard detection ──

  describe('guard-removed', () => {
    it('detects guard removal from a function', () => {
      const oldSource = `
export function deleteUser(req: any, res: any) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  // delete logic
  return res.json({ ok: true });
}`;
      const newSource = `
export function deleteUser(req: any, res: any) {
  // delete logic — guard was removed!
  return res.json({ ok: true });
}`;

      const old = analyzeSource(oldSource);
      const neu = analyzeSource(newSource);

      const changes = computeSemanticDiff(old.inferred, neu.inferred, old.concepts, neu.concepts, 'test.ts');

      const guardRemoved = changes.find((c) => c.type === 'guard-removed');
      expect(guardRemoved).toBeDefined();
      expect(guardRemoved!.severity).toBe('error');
      expect(guardRemoved!.functionName).toBe('deleteUser');
    });
  });

  describe('guard-added', () => {
    it('detects guard addition to a function', () => {
      const oldSource = `
export function deleteUser(req: any, res: any) {
  return res.json({ ok: true });
}`;
      const newSource = `
export function deleteUser(req: any, res: any) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return res.json({ ok: true });
}`;

      const old = analyzeSource(oldSource);
      const neu = analyzeSource(newSource);

      const changes = computeSemanticDiff(old.inferred, neu.inferred, old.concepts, neu.concepts, 'test.ts');

      const guardAdded = changes.find((c) => c.type === 'guard-added');
      expect(guardAdded).toBeDefined();
      expect(guardAdded!.severity).toBe('info');
    });
  });

  // ── Error handling detection ──

  describe('error-handling-removed', () => {
    it('detects try/catch removal', () => {
      const oldSource = `
export function fetchData(url: string) {
  try {
    return fetch(url);
  } catch (err) {
    console.error('fetch failed:', err);
    throw err;
  }
}`;
      const newSource = `
export function fetchData(url: string) {
  return fetch(url);
}`;

      const old = analyzeSource(oldSource);
      const neu = analyzeSource(newSource);

      const changes = computeSemanticDiff(old.inferred, neu.inferred, old.concepts, neu.concepts, 'test.ts');

      const errorRemoved = changes.find((c) => c.type === 'error-handling-removed');
      expect(errorRemoved).toBeDefined();
      expect(errorRemoved!.severity).toBe('warning');
      expect(errorRemoved!.functionName).toBe('fetchData');
    });
  });

  describe('error-handling-added', () => {
    it('detects try/catch addition', () => {
      const oldSource = `
export function fetchData(url: string) {
  return fetch(url);
}`;
      const newSource = `
export function fetchData(url: string) {
  try {
    return fetch(url);
  } catch (err) {
    console.error('fetch failed:', err);
    throw err;
  }
}`;

      const old = analyzeSource(oldSource);
      const neu = analyzeSource(newSource);

      const changes = computeSemanticDiff(old.inferred, neu.inferred, old.concepts, neu.concepts, 'test.ts');

      const errorAdded = changes.find((c) => c.type === 'error-handling-added');
      expect(errorAdded).toBeDefined();
      expect(errorAdded!.severity).toBe('info');
    });
  });

  // ── Effect detection ──

  describe('effect-added', () => {
    it('detects new db effect in a function', () => {
      const oldSource = `
export function createUser(data: any) {
  return { id: '1', ...data };
}`;
      const newSource = `
export function createUser(data: any) {
  return db.query('INSERT INTO users ...', data);
}`;

      const old = analyzeSource(oldSource);
      const neu = analyzeSource(newSource);

      const changes = computeSemanticDiff(old.inferred, neu.inferred, old.concepts, neu.concepts, 'test.ts');

      const effectAdded = changes.find((c) => c.type === 'effect-added');
      expect(effectAdded).toBeDefined();
      expect(effectAdded!.severity).toBe('info');
      expect(effectAdded!.functionName).toBe('createUser');
      expect(effectAdded!.description).toContain('db');
    });
  });

  describe('effect-removed', () => {
    it('detects removed effect from a function', () => {
      const oldSource = `
export function createUser(data: any) {
  return db.query('INSERT INTO users ...', data);
}`;
      const newSource = `
export function createUser(data: any) {
  return { id: '1', ...data };
}`;

      const old = analyzeSource(oldSource);
      const neu = analyzeSource(newSource);

      const changes = computeSemanticDiff(old.inferred, neu.inferred, old.concepts, neu.concepts, 'test.ts');

      const effectRemoved = changes.find((c) => c.type === 'effect-removed');
      expect(effectRemoved).toBeDefined();
      expect(effectRemoved!.severity).toBe('info');
    });
  });

  // ── Parameter changes ──

  describe('param-changed', () => {
    it('detects parameter changes', () => {
      const oldSource = `
export function getUser(id: string) {
  return { id };
}`;
      const newSource = `
export function getUser(id: string, includeDeleted: boolean) {
  return { id, includeDeleted };
}`;

      const old = analyzeSource(oldSource);
      const neu = analyzeSource(newSource);

      const changes = computeSemanticDiff(old.inferred, neu.inferred, old.concepts, neu.concepts, 'test.ts');

      const paramChanged = changes.find((c) => c.type === 'param-changed');
      expect(paramChanged).toBeDefined();
      expect(paramChanged!.severity).toBe('info');
      expect(paramChanged!.functionName).toBe('getUser');
    });
  });

  // ── Return type changes ──

  describe('return-type-changed', () => {
    it('detects return type changes', () => {
      const oldSource = `
export function getUser(id: string): { id: string } {
  return { id };
}`;
      const newSource = `
export function getUser(id: string): { id: string; name: string } | null {
  return null;
}`;

      const old = analyzeSource(oldSource);
      const neu = analyzeSource(newSource);

      const changes = computeSemanticDiff(old.inferred, neu.inferred, old.concepts, neu.concepts, 'test.ts');

      const returnChanged = changes.find((c) => c.type === 'return-type-changed');
      expect(returnChanged).toBeDefined();
      expect(returnChanged!.severity).toBe('warning');
      expect(returnChanged!.functionName).toBe('getUser');
    });
  });

  // ── New code paths ──

  describe('new-code-path', () => {
    it('detects new functions', () => {
      const oldSource = `
export function getUser(id: string) {
  return { id };
}`;
      const newSource = `
export function getUser(id: string) {
  return { id };
}
export function deleteUser(id: string) {
  return { deleted: true };
}`;

      const old = analyzeSource(oldSource);
      const neu = analyzeSource(newSource);

      const changes = computeSemanticDiff(old.inferred, neu.inferred, old.concepts, neu.concepts, 'test.ts');

      const newCodePath = changes.find((c) => c.type === 'new-code-path');
      expect(newCodePath).toBeDefined();
      expect(newCodePath!.severity).toBe('info');
      expect(newCodePath!.functionName).toBe('deleteUser');
    });
  });

  // ── No changes ──

  describe('no changes', () => {
    it('returns empty array when functions are unchanged', () => {
      const source = `
export function getUser(id: string) {
  return { id };
}`;

      const old = analyzeSource(source);
      const neu = analyzeSource(source);

      const changes = computeSemanticDiff(old.inferred, neu.inferred, old.concepts, neu.concepts, 'test.ts');

      expect(changes.length).toBe(0);
    });
  });

  // ── High-level API ──

  describe('computeSemanticDiffFromSource', () => {
    it('handles full pipeline from source strings', () => {
      const oldSource = `
export function updateUser(req: any, res: any) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'failed' });
  }
}`;
      const newSource = `
export function updateUser(req: any, res: any) {
  return res.json({ ok: true });
}`;

      const newInferred = inferFromSource(newSource, 'test.ts');
      const changes = computeSemanticDiffFromSource(oldSource, newInferred, 'test.ts', newSource);

      // Should detect guard removal and error handling removal
      const types = changes.map((c) => c.type);
      expect(types).toContain('guard-removed');
      expect(types).toContain('error-handling-removed');
    });

    it('handles unparseable old source gracefully', () => {
      const oldSource = `this is not valid typescript {{{`;
      const newInferred = inferFromSource(`export function f() { return 1; }`, 'test.ts');

      const changes = computeSemanticDiffFromSource(oldSource, newInferred, 'test.ts');

      // Should not crash — may report new functions as new-code-path since
      // old source has no functions to match against
      expect(Array.isArray(changes)).toBe(true);
      for (const c of changes) {
        expect(c.type).toBe('new-code-path');
      }
    });
  });

  // ── Formatting ──

  describe('formatSemanticDiff', () => {
    it('formats changes as <kern-diff> block', () => {
      const changes: SemanticChange[] = [
        {
          type: 'guard-removed',
          severity: 'error',
          functionName: 'deleteUser',
          filePath: 'routes/users.ts',
          line: 10,
          description: 'Validation guard removed from deleteUser',
          oldValue: 'if (!req.user) return res.status(401)',
        },
        {
          type: 'effect-added',
          severity: 'info',
          functionName: 'createUser',
          filePath: 'routes/users.ts',
          line: 45,
          description: 'New db effect in createUser: db.query(...)',
          newValue: 'db.query(...)',
        },
      ];

      const output = formatSemanticDiff(changes, 'routes/users.ts');
      expect(output).toContain('<kern-diff path="routes/users.ts">');
      expect(output).toContain('[error] guard-removed');
      expect(output).toContain('[info] effect-added');
      expect(output).toContain('</kern-diff>');
    });

    it('returns empty string for no changes', () => {
      expect(formatSemanticDiff([], 'test.ts')).toBe('');
    });
  });

  // ── Findings conversion ──

  describe('semanticChangesToFindings', () => {
    it('converts semantic changes to ReviewFindings', () => {
      const changes: SemanticChange[] = [
        {
          type: 'guard-removed',
          severity: 'error',
          functionName: 'deleteUser',
          filePath: 'routes/users.ts',
          line: 10,
          description: 'Validation guard removed from deleteUser',
        },
      ];

      const findings = semanticChangesToFindings(changes);
      expect(findings).toHaveLength(1);
      expect(findings[0].ruleId).toBe('semantic-diff/guard-removed');
      expect(findings[0].severity).toBe('error');
      expect(findings[0].source).toBe('kern');
      expect(findings[0].primarySpan.file).toBe('routes/users.ts');
      expect(findings[0].primarySpan.startLine).toBe(10);
      expect(findings[0].suggestion).toContain('intentional');
    });
  });

  // ── Sorting ──

  describe('sorting', () => {
    it('sorts errors before warnings before info', () => {
      const oldSource = `
export function handler(req: any, res: any) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'failed' });
  }
}`;
      const newSource = `
export function handler(req: any, res: any, extra: boolean) {
  return res.json({ ok: true });
}`;

      const old = analyzeSource(oldSource);
      const neu = analyzeSource(newSource);

      const changes = computeSemanticDiff(old.inferred, neu.inferred, old.concepts, neu.concepts, 'test.ts');

      // Verify sorting: errors before warnings before info
      for (let i = 1; i < changes.length; i++) {
        const severityOrder = { error: 0, warning: 1, info: 2 };
        expect(severityOrder[changes[i].severity]).toBeGreaterThanOrEqual(severityOrder[changes[i - 1].severity]);
      }
    });
  });
});
