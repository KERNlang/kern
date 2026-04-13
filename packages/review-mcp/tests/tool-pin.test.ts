import assert from 'node:assert/strict';
import type { IRNode } from '@kernlang/core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateLockFile, verifyLockFile } from '../src/tool-pin.js';

function makeIRNodes(tools: Array<{ name: string; description: string; children?: object[] }>): IRNode[] {
  return tools.map((t) => ({
    type: 'action' as const,
    props: { name: t.name, description: t.description },
    children: t.children ?? [],
  })) as IRNode[];
}

function withTempLockFile(lockFile: object, fn: (lockPath: string) => void): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kern-pin-test-'));
  const lockPath = path.join(tmpDir, '.kern-mcp-lock.json');
  fs.writeFileSync(lockPath, JSON.stringify(lockFile));
  try {
    fn(lockPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('lockfile generation', () => {
  it('generates lockfile with correct structure', () => {
    const irNodes = makeIRNodes([
      { name: 'read_file', description: 'Read a file from disk' },
      { name: 'write_file', description: 'Write content to a file' },
    ]);
    const lock = generateLockFile('/src/server.ts', irNodes);

    assert.equal(lock.version, 1);
    assert.equal(lock.serverFile, '/src/server.ts');
    assert.equal(lock.tools.length, 2);
    assert.ok(lock.generated);
  });

  it('creates deterministic hashes for same input', () => {
    const irNodes = makeIRNodes([{ name: 'tool1', description: 'desc1' }]);
    const lock1 = generateLockFile('/a.ts', irNodes);
    const lock2 = generateLockFile('/a.ts', irNodes);

    assert.equal(lock1.tools[0].descriptionHash, lock2.tools[0].descriptionHash);
    assert.equal(lock1.tools[0].schemaHash, lock2.tools[0].schemaHash);
  });

  it('produces different hashes for different descriptions', () => {
    const ir1 = makeIRNodes([{ name: 'tool1', description: 'original' }]);
    const ir2 = makeIRNodes([{ name: 'tool1', description: 'modified' }]);
    const lock1 = generateLockFile('/a.ts', ir1);
    const lock2 = generateLockFile('/a.ts', ir2);

    assert.notEqual(lock1.tools[0].descriptionHash, lock2.tools[0].descriptionHash);
  });

  it('produces different hashes for different schemas', () => {
    const ir1 = makeIRNodes([
      { name: 'tool1', description: 'same', children: [{ type: 'param', props: { name: 'a' } }] },
    ]);
    const ir2 = makeIRNodes([
      { name: 'tool1', description: 'same', children: [{ type: 'param', props: { name: 'b' } }] },
    ]);
    const lock1 = generateLockFile('/a.ts', ir1);
    const lock2 = generateLockFile('/a.ts', ir2);

    assert.notEqual(lock1.tools[0].schemaHash, lock2.tools[0].schemaHash);
  });

  it('handles empty IR nodes', () => {
    const lock = generateLockFile('/a.ts', []);
    assert.equal(lock.tools.length, 0);
  });
});

describe('lockfile verification', () => {
  it('returns no drift when nothing changed', () => {
    const irNodes = makeIRNodes([{ name: 'read_file', description: 'Read a file' }]);
    const lock = generateLockFile('/a.ts', irNodes);

    withTempLockFile(lock, (lockPath) => {
      const drifts = verifyLockFile(lockPath, '/a.ts', irNodes);
      assert.equal(drifts.length, 0);
    });
  });

  it('detects removed tools', () => {
    const irNodes = makeIRNodes([
      { name: 'read_file', description: 'Read a file' },
      { name: 'write_file', description: 'Write a file' },
    ]);
    const lock = generateLockFile('/a.ts', irNodes);

    const currentIR = makeIRNodes([{ name: 'read_file', description: 'Read a file' }]);
    withTempLockFile(lock, (lockPath) => {
      const drifts = verifyLockFile(lockPath, '/a.ts', currentIR);
      assert.ok(drifts.some((d) => d.field === 'removed' && d.toolName === 'write_file'));
    });
  });

  it('detects new tools', () => {
    const irNodes = makeIRNodes([{ name: 'read_file', description: 'Read a file' }]);
    const lock = generateLockFile('/a.ts', irNodes);

    const currentIR = makeIRNodes([
      { name: 'read_file', description: 'Read a file' },
      { name: 'new_tool', description: 'A new tool' },
    ]);
    withTempLockFile(lock, (lockPath) => {
      const drifts = verifyLockFile(lockPath, '/a.ts', currentIR);
      assert.ok(drifts.some((d) => d.field === 'new' && d.toolName === 'new_tool'));
      assert.equal(drifts.find((d) => d.toolName === 'new_tool')!.severity, 'warning');
    });
  });

  it('detects description changes', () => {
    const irNodes = makeIRNodes([{ name: 'tool1', description: 'original desc' }]);
    const lock = generateLockFile('/a.ts', irNodes);

    const currentIR = makeIRNodes([{ name: 'tool1', description: 'MODIFIED desc with hidden instructions' }]);
    withTempLockFile(lock, (lockPath) => {
      const drifts = verifyLockFile(lockPath, '/a.ts', currentIR);
      assert.ok(drifts.some((d) => d.field === 'description' && d.toolName === 'tool1'));
      assert.equal(drifts[0].severity, 'error');
    });
  });

  it('detects schema changes', () => {
    const ir1 = makeIRNodes([
      { name: 'tool1', description: 'desc', children: [{ type: 'param', props: { name: 'path' } }] },
    ]);
    const lock = generateLockFile('/a.ts', ir1);

    const ir2 = makeIRNodes([
      {
        name: 'tool1',
        description: 'desc',
        children: [
          { type: 'param', props: { name: 'path' } },
          { type: 'param', props: { name: 'secret_exfil' } },
        ],
      },
    ]);
    withTempLockFile(lock, (lockPath) => {
      const drifts = verifyLockFile(lockPath, '/a.ts', ir2);
      assert.ok(drifts.some((d) => d.field === 'schema'));
      assert.equal(drifts[0].severity, 'error');
    });
  });
});

describe('corruption handling', () => {
  it('handles malformed JSON gracefully', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kern-pin-test-'));
    const lockPath = path.join(tmpDir, '.kern-mcp-lock.json');
    fs.writeFileSync(lockPath, 'NOT VALID JSON {{{');
    try {
      const drifts = verifyLockFile(lockPath, '/a.ts', []);
      assert.ok(drifts.length > 0);
      assert.equal(drifts[0].severity, 'error');
      assert.ok(drifts[0].message.includes('not valid JSON'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles missing tools array gracefully', () => {
    withTempLockFile({ version: 1, generated: '2026-01-01', serverFile: '/a.ts' }, (lockPath) => {
      const drifts = verifyLockFile(lockPath, '/a.ts', []);
      assert.ok(drifts.length > 0);
      assert.equal(drifts[0].severity, 'error');
      assert.ok(drifts[0].message.includes('no tools array'));
    });
  });

  it('handles tools as non-array gracefully', () => {
    withTempLockFile({ version: 1, tools: 'not-an-array' }, (lockPath) => {
      const drifts = verifyLockFile(lockPath, '/a.ts', []);
      assert.ok(drifts.length > 0);
      assert.equal(drifts[0].severity, 'error');
    });
  });

  it('handles non-existent lockfile path gracefully', () => {
    const drifts = verifyLockFile('/nonexistent/path/.kern-mcp-lock.json', '/a.ts', []);
    assert.ok(drifts.length > 0);
    assert.equal(drifts[0].severity, 'error');
    assert.ok(drifts[0].message.includes('Cannot read lockfile'));
  });
});
