/**
 * End-to-end integration test for the evolve v4 pipeline.
 *
 * Tests the full lifecycle: validate → stage → review → graduate → compile.
 * Also tests target-specific codegen loading.
 */

import { clearEvolvedGenerators, clearEvolvedTypes, generateCoreNode, parse } from '@kernlang/core';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import type { EvolveNodeProposal } from '../src/evolved-types.js';
import {
  cleanApprovedEvolveV4,
  clearEvolvedNodes,
  compileCodegenToJS,
  getStagedEvolveV4,
  graduateNode,
  listStagedEvolveV4,
  loadEvolvedNodes,
  readEvolvedManifest,
  rebuildEvolvedManifest,
  rollbackNode,
  stageEvolveV4Proposal,
  updateStagedEvolveV4Status,
  validateEvolveProposal,
} from '../src/index.js';

const TEST_DIR = resolve('/tmp/kern-evolve-e2e-test');
const STAGING_DIR = join(TEST_DIR, '.kern', 'evolve', 'staged-v4');

// A minimal evolved node proposal
function makeProposal(keyword = 'greeting'): EvolveNodeProposal {
  return {
    id: `proposal-${keyword}-${Date.now()}`,
    keyword,
    displayName: 'Greeting',
    description: 'A greeting node for testing',
    props: [{ name: 'name', type: 'string', required: true, description: 'Who to greet' }],
    childTypes: [],
    kernExample: `${keyword} name=World`,
    expectedOutput: `export const greetingWorld = "Hello, World!";`,
    codegenSource: `module.exports = function(node, helpers) {
  var name = helpers.p(node).name || 'World';
  return ['export const greeting' + helpers.capitalize(name) + ' = "Hello, ' + name + '!";'];
};`,
    parserHints: undefined,
    targetOverrides: undefined,
    reason: {
      observation: 'Found 5 greeting patterns',
      inefficiency: 'Each requires 3 lines',
      kernBenefit: 'Reduces to 1 line',
      frequency: 5,
      avgLines: 3,
      instances: ['src/a.ts', 'src/b.ts'],
    },
    codegenTier: 1,
    proposedAt: new Date().toISOString(),
    evolveRunId: 'run-test-e2e',
  };
}

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  clearEvolvedNodes();
  clearEvolvedGenerators();
  clearEvolvedTypes();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  clearEvolvedNodes();
  clearEvolvedGenerators();
  clearEvolvedTypes();
});

describe('E2E Pipeline', () => {
  // Save and restore cwd
  const origCwd = process.cwd();
  beforeEach(() => process.chdir(TEST_DIR));
  afterEach(() => process.chdir(origCwd));

  it('validate → stage → approve → graduate → compile', () => {
    const proposal = makeProposal();

    // 1. Validate
    const validation = validateEvolveProposal(proposal);
    expect(validation.schemaOk).toBe(true);
    expect(validation.keywordOk).toBe(true);
    expect(validation.parseOk).toBe(true);
    expect(validation.codegenCompileOk).toBe(true);
    expect(validation.codegenRunOk).toBe(true);

    // 2. Stage
    const staged = stageEvolveV4Proposal(proposal, validation);
    expect(staged.status).toBe('pending');
    expect(existsSync(join(STAGING_DIR, `${staged.id}.json`))).toBe(true);

    // 3. List & get
    const list = listStagedEvolveV4();
    expect(list.length).toBe(1);
    expect(list[0].proposal.keyword).toBe('greeting');

    const found = getStagedEvolveV4(staged.id);
    expect(found).toBeDefined();
    expect(found!.proposal.keyword).toBe('greeting');

    // 4. Approve
    const updated = updateStagedEvolveV4Status(staged.id, 'approved');
    expect(updated!.status).toBe('approved');

    // 5. Compile codegen & graduate
    const compiledJs = compileCodegenToJS(proposal.codegenSource);
    expect(compiledJs).toContain('module.exports');

    const gradResult = graduateNode(proposal, compiledJs, 'test-user');
    expect(gradResult.success).toBe(true);
    expect(existsSync(join(TEST_DIR, '.kern', 'evolved', 'greeting', 'codegen.js'))).toBe(true);

    // 6. Clean staging
    cleanApprovedEvolveV4(staged.id);
    expect(listStagedEvolveV4().length).toBe(0);

    // 7. Load evolved nodes & compile
    const loadResult = loadEvolvedNodes(TEST_DIR);
    expect(loadResult.loaded).toBe(1);

    const ast = parse('greeting name=World');
    const output = generateCoreNode(ast);
    expect(output.length).toBeGreaterThan(0);
    expect(output.join('\n')).toContain('Hello, World!');
  });

  it('graduate → rollback → restore lifecycle', () => {
    const proposal = makeProposal();
    const compiledJs = compileCodegenToJS(proposal.codegenSource);
    graduateNode(proposal, compiledJs, 'test-user');

    // Manifest exists
    const manifest = readEvolvedManifest();
    expect(manifest).not.toBeNull();
    expect(manifest!.nodes.greeting).toBeDefined();

    // Rollback
    const rollResult = rollbackNode('greeting', TEST_DIR, true);
    expect(rollResult.success).toBe(true);
    expect(existsSync(join(TEST_DIR, '.kern', 'evolved', '.trash', 'greeting'))).toBe(true);

    // Manifest updated
    const afterManifest = readEvolvedManifest();
    expect(afterManifest!.nodes.greeting).toBeUndefined();
  });

  it('manifest rebuild recovers from corruption', () => {
    const proposal = makeProposal();
    const compiledJs = compileCodegenToJS(proposal.codegenSource);
    graduateNode(proposal, compiledJs, 'test-user');

    // Corrupt manifest
    const manifestPath = join(TEST_DIR, '.kern', 'evolved', 'manifest.json');
    writeFileSync(manifestPath, '{ broken json!!!');

    // Rebuild
    const result = rebuildEvolvedManifest(TEST_DIR);
    expect(result.rebuilt).toBe(1);
    expect(result.errors.length).toBe(0);

    // Manifest is valid again
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest.nodes.greeting).toBeDefined();
    expect(manifest.nodes.greeting.keyword).toBe('greeting');
  });

  it('target-specific codegen is used when available', () => {
    const proposal = makeProposal();
    const compiledJs = compileCodegenToJS(proposal.codegenSource);
    graduateNode(proposal, compiledJs, 'test-user');

    // Write a target-specific override
    const targetsDir = join(TEST_DIR, '.kern', 'evolved', 'greeting', 'targets');
    mkdirSync(targetsDir, { recursive: true });
    const vueCodegen = `module.exports = function(node, helpers) {
      var name = helpers.p(node).name || 'World';
      return ['<template><p>Bonjour, ' + name + '!</p></template>'];
    };`;
    writeFileSync(join(targetsDir, 'vue.js'), vueCodegen);

    // Load evolved nodes (picks up targets)
    const loadResult = loadEvolvedNodes(TEST_DIR);
    expect(loadResult.loaded).toBe(1);

    // Default codegen (no target)
    const ast = parse('greeting name=World');
    const defaultOutput = generateCoreNode(ast);
    expect(defaultOutput.join('\n')).toContain('Hello, World!');

    // Target-specific codegen (vue)
    const vueOutput = generateCoreNode(ast, 'vue');
    expect(vueOutput.join('\n')).toContain('Bonjour, World!');
  });

  it('evolved: namespace prefix parses correctly', () => {
    const proposal = makeProposal();
    const compiledJs = compileCodegenToJS(proposal.codegenSource);
    graduateNode(proposal, compiledJs, 'test-user');

    loadEvolvedNodes(TEST_DIR);

    // Regular parse
    const ast1 = parse('greeting name=World');
    expect(ast1.type).toBe('greeting');

    // With evolved: prefix — should resolve to the same type
    const ast2 = parse('evolved:greeting name=World');
    expect(ast2.type).toBe('greeting');
    expect(ast2.props?.name).toBe('World');

    // Both should produce identical codegen output
    const out1 = generateCoreNode(ast1);
    const out2 = generateCoreNode(ast2);
    expect(out1).toEqual(out2);
    expect(out1.join('\n')).toContain('Hello, World!');
  });
});
