import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { findUsages, restoreNode, rollbackNode } from '../src/evolve-rollback.js';
import type { EvolveNodeProposal } from '../src/evolved-types.js';
import { compileCodegenToJS, graduateNode } from '../src/graduation.js';

const TEST_DIR = resolve('/tmp/kern-graduation-test');
const EVOLVED_DIR = join(TEST_DIR, '.kern', 'evolved');

function createProposal(keyword = 'test-widget'): EvolveNodeProposal {
  return {
    id: 'grad-1',
    keyword,
    displayName: 'Test Widget',
    description: 'A test graduated node',
    props: [{ name: 'name', type: 'string', required: true, description: 'Widget name' }],
    childTypes: [],
    kernExample: `${keyword} name=hello`,
    expectedOutput: '// widget: hello',
    codegenSource: `
      module.exports = function(node, helpers) {
        return ['// widget: ' + helpers.p(node).name];
      };
    `,
    reason: {
      observation: 'Test pattern',
      inefficiency: 'Test',
      kernBenefit: 'Test',
      frequency: 5,
      avgLines: 3,
      instances: ['test.ts'],
    },
    codegenTier: 1,
    proposedAt: new Date().toISOString(),
    evolveRunId: 'test-run',
  };
}

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe('Graduation', () => {
  it('graduates a proposal to .kern/evolved/', () => {
    const proposal = createProposal();
    const compiledJs = proposal.codegenSource;
    const result = graduateNode(proposal, compiledJs, 'test-user', TEST_DIR);

    expect(result.success).toBe(true);
    expect(existsSync(join(EVOLVED_DIR, 'test-widget', 'codegen.js'))).toBe(true);
    expect(existsSync(join(EVOLVED_DIR, 'test-widget', 'codegen.ts'))).toBe(true);
    expect(existsSync(join(EVOLVED_DIR, 'test-widget', 'template.kern'))).toBe(true);
    expect(existsSync(join(EVOLVED_DIR, 'test-widget', 'expected-output.ts'))).toBe(true);
    expect(existsSync(join(EVOLVED_DIR, 'test-widget', 'definition.json'))).toBe(true);
    expect(existsSync(join(EVOLVED_DIR, 'manifest.json'))).toBe(true);
  });

  it('writes correct manifest entry', () => {
    const proposal = createProposal();
    graduateNode(proposal, proposal.codegenSource, 'nicolas', TEST_DIR);

    const manifest = JSON.parse(readFileSync(join(EVOLVED_DIR, 'manifest.json'), 'utf-8'));
    expect(manifest.nodes['test-widget']).toBeDefined();
    expect(manifest.nodes['test-widget'].keyword).toBe('test-widget');
    expect(manifest.nodes['test-widget'].graduatedBy).toBe('nicolas');
    expect(manifest.nodes['test-widget'].hash).toMatch(/^sha256:/);
  });

  it('writes correct definition.json', () => {
    const proposal = createProposal();
    graduateNode(proposal, proposal.codegenSource, 'nicolas', TEST_DIR);

    const def = JSON.parse(readFileSync(join(EVOLVED_DIR, 'test-widget', 'definition.json'), 'utf-8'));
    expect(def.keyword).toBe('test-widget');
    expect(def.reason.observation).toBe('Test pattern');
    expect(def.props).toHaveLength(1);
    expect(def.props[0].name).toBe('name');
  });

  it('rejects graduation if keyword already exists', () => {
    const proposal = createProposal();
    graduateNode(proposal, proposal.codegenSource, 'user', TEST_DIR);

    const result = graduateNode(proposal, proposal.codegenSource, 'user', TEST_DIR);
    expect(result.success).toBe(false);
    expect(result.error).toContain('already graduated');
  });
});

describe('Compile Codegen to JS', () => {
  it('strips imports and converts export default', () => {
    const ts = `
import type { IRNode } from '@kernlang/core';
export default function generate(node: IRNode): string[] {
  return [];
}`;
    const js = compileCodegenToJS(ts);
    expect(js).not.toContain('import');
    expect(js).toContain('module.exports = function');
    expect(js).not.toContain(': IRNode');
  });

  it('preserves module.exports if already present', () => {
    const source = `module.exports = function(node) { return ['ok']; };`;
    const js = compileCodegenToJS(source);
    expect(js).toContain('module.exports');
  });
});

describe('Rollback', () => {
  it('rolls back a graduated node to .trash/', () => {
    const proposal = createProposal();
    graduateNode(proposal, proposal.codegenSource, 'user', TEST_DIR);
    expect(existsSync(join(EVOLVED_DIR, 'test-widget'))).toBe(true);

    const result = rollbackNode('test-widget', TEST_DIR, true);
    expect(result.success).toBe(true);
    expect(existsSync(join(EVOLVED_DIR, 'test-widget'))).toBe(false);
    expect(existsSync(join(EVOLVED_DIR, '.trash', 'test-widget'))).toBe(true);
  });

  it('removes from manifest on rollback', () => {
    const proposal = createProposal();
    graduateNode(proposal, proposal.codegenSource, 'user', TEST_DIR);
    rollbackNode('test-widget', TEST_DIR, true);

    const manifest = JSON.parse(readFileSync(join(EVOLVED_DIR, 'manifest.json'), 'utf-8'));
    expect(manifest.nodes['test-widget']).toBeUndefined();
  });

  it('fails for non-existent node', () => {
    const result = rollbackNode('nonexistent', TEST_DIR);
    expect(result.success).toBe(false);
    expect(result.error).toContain('not graduated');
  });

  it('blocks rollback if keyword is in use (without force)', () => {
    const proposal = createProposal();
    graduateNode(proposal, proposal.codegenSource, 'user', TEST_DIR);

    // Create a .kern file that uses the keyword
    const kernDir = join(TEST_DIR, 'src');
    mkdirSync(kernDir, { recursive: true });
    writeFileSync(join(kernDir, 'app.kern'), 'test-widget name=hello');

    const result = rollbackNode('test-widget', TEST_DIR);
    expect(result.success).toBe(false);
    expect(result.usageFiles).toHaveLength(1);
  });
});

describe('Restore', () => {
  it('restores a rolled-back node', () => {
    const proposal = createProposal();
    graduateNode(proposal, proposal.codegenSource, 'user', TEST_DIR);
    rollbackNode('test-widget', TEST_DIR, true);
    expect(existsSync(join(EVOLVED_DIR, 'test-widget'))).toBe(false);

    const result = restoreNode('test-widget', TEST_DIR);
    expect(result.success).toBe(true);
    expect(existsSync(join(EVOLVED_DIR, 'test-widget', 'codegen.js'))).toBe(true);
  });

  it('re-adds to manifest on restore', () => {
    const proposal = createProposal();
    graduateNode(proposal, proposal.codegenSource, 'user', TEST_DIR);
    rollbackNode('test-widget', TEST_DIR, true);
    restoreNode('test-widget', TEST_DIR);

    const manifest = JSON.parse(readFileSync(join(EVOLVED_DIR, 'manifest.json'), 'utf-8'));
    expect(manifest.nodes['test-widget']).toBeDefined();
  });

  it('fails if nothing to restore', () => {
    const result = restoreNode('nonexistent', TEST_DIR);
    expect(result.success).toBe(false);
  });
});

describe('Find Usages', () => {
  it('finds keyword usage in .kern files', () => {
    mkdirSync(join(TEST_DIR, 'kern'), { recursive: true });
    writeFileSync(join(TEST_DIR, 'kern', 'app.kern'), 'test-widget name=foo\n  text value="hi"');
    writeFileSync(join(TEST_DIR, 'kern', 'other.kern'), 'screen name="Home"\n  button label="Go"');

    const usages = findUsages('test-widget', TEST_DIR);
    expect(usages).toHaveLength(1);
    expect(usages[0]).toContain('app.kern');
  });

  it('returns empty when keyword not used', () => {
    mkdirSync(join(TEST_DIR, 'kern'), { recursive: true });
    writeFileSync(join(TEST_DIR, 'kern', 'app.kern'), 'screen name="Home"');

    const usages = findUsages('test-widget', TEST_DIR);
    expect(usages).toHaveLength(0);
  });
});
