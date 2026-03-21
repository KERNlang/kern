import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import {
  pruneNodes,
  detectCollisions,
  renameEvolvedNode,
} from '../src/evolve-rollback.js';
import type { EvolvedManifest, EvolvedManifestEntry } from '../src/evolved-types.js';

let TEST_DIR: string;
let EVOLVED_DIR: string;

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function makeManifestEntry(
  keyword: string,
  overrides: Partial<EvolvedManifestEntry> = {},
): EvolvedManifestEntry {
  return {
    keyword,
    displayName: keyword.replace(/-/g, ' '),
    codegenTier: 1,
    childTypes: [],
    hash: 'sha256:abc123',
    graduatedBy: 'test-user',
    graduatedAt: daysAgo(10),
    evolveRunId: 'run-1',
    kernVersion: '2.0.0',
    ...overrides,
  };
}

function writeManifest(nodes: Record<string, EvolvedManifestEntry>): void {
  const manifest: EvolvedManifest = { version: 1, nodes };
  mkdirSync(EVOLVED_DIR, { recursive: true });
  writeFileSync(join(EVOLVED_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function writeNodeDir(keyword: string, definition?: Record<string, unknown>): void {
  const dir = join(EVOLVED_DIR, keyword);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'codegen.js'), `module.exports = function() { return []; };`);
  writeFileSync(
    join(dir, 'definition.json'),
    JSON.stringify(
      definition ?? {
        keyword,
        displayName: keyword.replace(/-/g, ' '),
        description: 'Test node',
        props: [],
        childTypes: [],
        reason: { observation: 'test', inefficiency: 'test', kernBenefit: 'test', frequency: 1, avgLines: 1, instances: [] },
        hash: 'sha256:abc123',
        graduatedBy: 'test-user',
        graduatedAt: daysAgo(10),
        evolveRunId: 'run-1',
        kernVersion: '2.0.0',
      },
      null,
      2,
    ),
  );
}

beforeEach(() => {
  TEST_DIR = mkdtempSync(join(tmpdir(), 'kern-prune-test-'));
  EVOLVED_DIR = join(TEST_DIR, '.kern', 'evolved');
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

// ── pruneNodes ────────────────────────────────────────────────────────────

describe('pruneNodes', () => {
  it('returns empty when no manifest exists', () => {
    const results = pruneNodes(TEST_DIR);
    expect(results).toEqual([]);
  });

  it('returns empty when all nodes are recent (< 90 days)', () => {
    writeManifest({
      'fresh-widget': makeManifestEntry('fresh-widget', { graduatedAt: daysAgo(5) }),
    });
    writeNodeDir('fresh-widget');

    const results = pruneNodes(TEST_DIR);
    expect(results).toEqual([]);
  });

  it('returns empty when old nodes are still in use', () => {
    writeManifest({
      'used-widget': makeManifestEntry('used-widget', { graduatedAt: daysAgo(120) }),
    });
    writeNodeDir('used-widget');

    // Create a .kern file that references the keyword
    const srcDir = join(TEST_DIR, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'app.kern'), 'used-widget name=hello');

    const results = pruneNodes(TEST_DIR);
    expect(results).toEqual([]);
  });

  it('prunes old unused nodes (> 90 days, no .kern usage)', () => {
    writeManifest({
      'stale-widget': makeManifestEntry('stale-widget', { graduatedAt: daysAgo(120) }),
    });
    writeNodeDir('stale-widget');

    const results = pruneNodes(TEST_DIR);
    expect(results).toHaveLength(1);
    expect(results[0].keyword).toBe('stale-widget');
    expect(results[0].pruned).toBe(true);
    expect(results[0].daysUnused).toBeGreaterThanOrEqual(120);

    // Node directory should be gone (moved to .trash)
    expect(existsSync(join(EVOLVED_DIR, 'stale-widget'))).toBe(false);
    expect(existsSync(join(EVOLVED_DIR, '.trash', 'stale-widget'))).toBe(true);

    // Manifest should no longer contain it
    const manifest = JSON.parse(readFileSync(join(EVOLVED_DIR, 'manifest.json'), 'utf-8'));
    expect(manifest.nodes['stale-widget']).toBeUndefined();
  });

  it('dry-run reports but does not delete', () => {
    writeManifest({
      'stale-widget': makeManifestEntry('stale-widget', { graduatedAt: daysAgo(120) }),
    });
    writeNodeDir('stale-widget');

    const results = pruneNodes(TEST_DIR, 90, true);
    expect(results).toHaveLength(1);
    expect(results[0].keyword).toBe('stale-widget');
    expect(results[0].pruned).toBe(false);
    expect(results[0].daysUnused).toBeGreaterThanOrEqual(120);

    // Node should still exist
    expect(existsSync(join(EVOLVED_DIR, 'stale-widget'))).toBe(true);

    // Manifest should still contain it
    const manifest = JSON.parse(readFileSync(join(EVOLVED_DIR, 'manifest.json'), 'utf-8'));
    expect(manifest.nodes['stale-widget']).toBeDefined();
  });

  it('custom threshold (e.g., 30 days)', () => {
    writeManifest({
      'medium-widget': makeManifestEntry('medium-widget', { graduatedAt: daysAgo(45) }),
    });
    writeNodeDir('medium-widget');

    // Default 90-day threshold: should not prune
    const defaultResults = pruneNodes(TEST_DIR);
    expect(defaultResults).toEqual([]);

    // Custom 30-day threshold: should prune
    const customResults = pruneNodes(TEST_DIR, 30);
    expect(customResults).toHaveLength(1);
    expect(customResults[0].keyword).toBe('medium-widget');
    expect(customResults[0].pruned).toBe(true);
  });
});

// ── detectCollisions ──────────────────────────────────────────────────────

describe('detectCollisions', () => {
  it('returns empty when no collisions', () => {
    writeManifest({
      'custom-widget': makeManifestEntry('custom-widget'),
    });

    const coreTypes = ['screen', 'button', 'text', 'view'] as const;
    const collisions = detectCollisions(coreTypes, TEST_DIR);
    expect(collisions).toEqual([]);
  });

  it('detects collision when evolved keyword matches a core NODE_TYPE', () => {
    writeManifest({
      'screen': makeManifestEntry('screen', {
        displayName: 'Screen',
        graduatedAt: daysAgo(30),
      }),
      'custom-widget': makeManifestEntry('custom-widget'),
    });

    const coreTypes = ['screen', 'button', 'text'] as const;
    const collisions = detectCollisions(coreTypes, TEST_DIR);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].keyword).toBe('screen');
  });

  it('returns correct CollisionInfo fields', () => {
    const graduatedAt = daysAgo(60);
    writeManifest({
      'button': makeManifestEntry('button', {
        displayName: 'Custom Button',
        graduatedAt,
      }),
    });

    const coreTypes = ['button'] as const;
    const collisions = detectCollisions(coreTypes, TEST_DIR);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toEqual({
      keyword: 'button',
      displayName: 'Custom Button',
      graduatedAt,
    });
  });

  it('returns empty when no manifest exists', () => {
    const coreTypes = ['screen', 'button'] as const;
    const collisions = detectCollisions(coreTypes, TEST_DIR);
    expect(collisions).toEqual([]);
  });

  it('detects multiple collisions', () => {
    writeManifest({
      'screen': makeManifestEntry('screen'),
      'button': makeManifestEntry('button'),
      'custom-widget': makeManifestEntry('custom-widget'),
    });

    const coreTypes = ['screen', 'button', 'text'] as const;
    const collisions = detectCollisions(coreTypes, TEST_DIR);
    expect(collisions).toHaveLength(2);
    const keywords = collisions.map(c => c.keyword).sort();
    expect(keywords).toEqual(['button', 'screen']);
  });
});

// ── renameEvolvedNode ─────────────────────────────────────────────────────

describe('renameEvolvedNode', () => {
  it('renames directory, updates manifest, updates definition.json', () => {
    const graduatedAt = daysAgo(15);
    writeManifest({
      'old-name': makeManifestEntry('old-name', { graduatedAt }),
    });
    writeNodeDir('old-name', {
      keyword: 'old-name',
      displayName: 'old name',
      description: 'Test node',
      props: [],
      childTypes: [],
      reason: { observation: 'test', inefficiency: 'test', kernBenefit: 'test', frequency: 1, avgLines: 1, instances: [] },
      hash: 'sha256:abc123',
      graduatedBy: 'test-user',
      graduatedAt,
      evolveRunId: 'run-1',
      kernVersion: '2.0.0',
    });

    const result = renameEvolvedNode('old-name', 'new-name', TEST_DIR);
    expect(result.success).toBe(true);

    // Old directory gone, new directory exists
    expect(existsSync(join(EVOLVED_DIR, 'old-name'))).toBe(false);
    expect(existsSync(join(EVOLVED_DIR, 'new-name'))).toBe(true);

    // definition.json updated with new keyword
    const def = JSON.parse(readFileSync(join(EVOLVED_DIR, 'new-name', 'definition.json'), 'utf-8'));
    expect(def.keyword).toBe('new-name');

    // Manifest updated: old key removed, new key present
    const manifest = JSON.parse(readFileSync(join(EVOLVED_DIR, 'manifest.json'), 'utf-8'));
    expect(manifest.nodes['old-name']).toBeUndefined();
    expect(manifest.nodes['new-name']).toBeDefined();
    expect(manifest.nodes['new-name'].keyword).toBe('new-name');
  });

  it('fails when source does not exist', () => {
    writeManifest({});

    const result = renameEvolvedNode('nonexistent', 'new-name', TEST_DIR);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('fails when target already exists', () => {
    writeManifest({
      'source': makeManifestEntry('source'),
      'target': makeManifestEntry('target'),
    });
    writeNodeDir('source');
    writeNodeDir('target');

    const result = renameEvolvedNode('source', 'target', TEST_DIR);
    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });
});
