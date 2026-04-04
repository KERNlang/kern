import {
  clearEvolvedGenerators,
  clearEvolvedTypes,
  clearParserHints,
  generateCoreNode,
  isKnownNodeType,
  KERN_RESERVED,
  parse,
  registerEvolvedGenerator,
  registerEvolvedType,
  registerParserHints,
} from '@kernlang/core';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  clearEvolvedNodes,
  evolvedNodeCount,
  getEvolvedKeywords,
  loadEvolvedNodes,
} from '../src/evolved-node-loader.js';
import { compileSandboxedGenerator } from '../src/sandboxed-generator.js';

const TEST_DIR = resolve('/tmp/kern-evolve-v4-test');
const EVOLVED_DIR = join(TEST_DIR, '.kern', 'evolved');

function setupTestNode(keyword: string, codegenJs: string): string {
  const nodeDir = join(EVOLVED_DIR, keyword);
  mkdirSync(nodeDir, { recursive: true });
  writeFileSync(join(nodeDir, 'codegen.js'), codegenJs);
  const hash = `sha256:${createHash('sha256').update(codegenJs).digest('hex')}`;

  // Write manifest
  const manifest = {
    version: 1,
    nodes: {
      [keyword]: {
        keyword,
        displayName: keyword,
        codegenTier: 1,
        childTypes: [],
        hash,
        graduatedBy: 'test',
        graduatedAt: new Date().toISOString(),
        evolveRunId: 'test-run',
        kernVersion: '2.0.0',
      },
    },
  };
  writeFileSync(join(EVOLVED_DIR, 'manifest.json'), JSON.stringify(manifest));
  return hash;
}

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(EVOLVED_DIR, { recursive: true });
  clearEvolvedNodes();
  clearEvolvedTypes();
  clearEvolvedGenerators();
  clearParserHints();
});

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  clearEvolvedNodes();
  clearEvolvedTypes();
  clearEvolvedGenerators();
  clearParserHints();
});

describe('Sandboxed Generator', () => {
  it('compiles and runs a simple generator', () => {
    const code = `
      module.exports = function(node, helpers) {
        var name = helpers.p(node).name;
        return ['export const ' + name + ' = {};'];
      };
    `;
    const gen = compileSandboxedGenerator(code);
    const result = gen({ type: 'test', props: { name: 'myThing' }, children: [], loc: { line: 1, col: 1 } });
    expect(result).toEqual(['export const myThing = {};']);
  });

  it('provides helpers (capitalize, kids, p)', () => {
    const code = `
      module.exports = function(node, helpers) {
        var name = helpers.capitalize(helpers.p(node).name);
        var fields = helpers.kids(node, 'field');
        var lines = ['interface ' + name + ' {'];
        for (var i = 0; i < fields.length; i++) {
          lines.push('  ' + helpers.p(fields[i]).name + ': string;');
        }
        lines.push('}');
        return lines;
      };
    `;
    const gen = compileSandboxedGenerator(code);
    const result = gen({
      type: 'test',
      props: { name: 'user' },
      children: [
        { type: 'field', props: { name: 'email' }, children: [], loc: { line: 2, col: 1 } },
        { type: 'field', props: { name: 'id' }, children: [], loc: { line: 3, col: 1 } },
      ],
      loc: { line: 1, col: 1 },
    });
    expect(result).toEqual(['interface User {', '  email: string;', '  id: string;', '}']);
  });

  it('blocks require access', () => {
    const code = `
      module.exports = function(node, helpers) {
        var fs = require('fs');
        return ['hacked'];
      };
    `;
    const gen = compileSandboxedGenerator(code);
    expect(() => gen({ type: 'x', props: {}, children: [], loc: { line: 1, col: 1 } })).toThrow();
  });

  it('blocks process access', () => {
    const code = `
      module.exports = function(node, helpers) {
        process.exit(1);
        return [];
      };
    `;
    const gen = compileSandboxedGenerator(code);
    expect(() => gen({ type: 'x', props: {}, children: [], loc: { line: 1, col: 1 } })).toThrow();
  });

  it('rejects non-function exports', () => {
    const code = `module.exports = { notAFunction: true };`;
    expect(() => compileSandboxedGenerator(code)).toThrow('must export a function');
  });

  it('rejects non-array return', () => {
    const code = `module.exports = function() { return 'not an array'; };`;
    const gen = compileSandboxedGenerator(code);
    expect(() => gen({ type: 'x', props: {}, children: [], loc: { line: 1, col: 1 } })).toThrow('must return string[]');
  });
});

describe('Evolved Node Loader', () => {
  it('loads evolved nodes from .kern/evolved/', () => {
    const codegen = `module.exports = function(node, helpers) { return ['// evolved: ' + helpers.p(node).name]; };`;
    setupTestNode('my-widget', codegen);

    const result = loadEvolvedNodes(TEST_DIR);
    expect(result.loaded).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(evolvedNodeCount()).toBe(1);
    expect(getEvolvedKeywords()).toContain('my-widget');
  });

  it('returns empty for missing .kern/evolved/', () => {
    const result = loadEvolvedNodes('/tmp/nonexistent-kern-test');
    expect(result.loaded).toBe(0);
  });

  it('rejects evolved nodes that shadow core types', () => {
    const codegen = `module.exports = function() { return []; };`;
    // 'button' is a core type
    const nodeDir = join(EVOLVED_DIR, 'button');
    mkdirSync(nodeDir, { recursive: true });
    writeFileSync(join(nodeDir, 'codegen.js'), codegen);

    const manifest = {
      version: 1,
      nodes: {
        button: {
          keyword: 'button',
          displayName: 'Button',
          codegenTier: 1,
          childTypes: [],
          hash: 'sha256:fake',
          graduatedBy: 'test',
          graduatedAt: '',
          evolveRunId: '',
          kernVersion: '2.0.0',
        },
      },
    };
    writeFileSync(join(EVOLVED_DIR, 'manifest.json'), JSON.stringify(manifest));

    const result = loadEvolvedNodes(TEST_DIR);
    expect(result.loaded).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].error).toContain('conflicts with core');
  });

  it('verifies hash when verify=true', () => {
    const codegen = `module.exports = function() { return ['ok']; };`;
    setupTestNode('hashed-node', codegen);

    // Tamper with the file
    writeFileSync(
      join(EVOLVED_DIR, 'hashed-node', 'codegen.js'),
      'module.exports = function() { return ["tampered"]; };',
    );

    const result = loadEvolvedNodes(TEST_DIR, true);
    expect(result.loaded).toBe(0);
    expect(result.errors[0].error).toContain('Hash mismatch');
  });
});

describe('Parser Hints', () => {
  it('handles positional args from evolved hints', () => {
    registerParserHints('api-route', { positionalArgs: ['method', 'path'] });

    const ast = parse('api-route GET /users');
    expect(ast.type).toBe('api-route');
    expect(ast.props?.method).toBe('GET');
    expect(ast.props?.path).toBe('/users');

    clearParserHints();
  });

  it('handles bare word from evolved hints', () => {
    registerParserHints('auth-guard', { bareWord: 'name' });

    const ast = parse('auth-guard admin role=superuser');
    expect(ast.type).toBe('auth-guard');
    expect(ast.props?.name).toBe('admin');
    expect(ast.props?.role).toBe('superuser');

    clearParserHints();
  });

  it('does not consume bare word when key=value follows', () => {
    registerParserHints('my-node', { bareWord: 'name' });

    const ast = parse('my-node key=value');
    expect(ast.props?.name).toBeUndefined();
    expect(ast.props?.key).toBe('value');

    clearParserHints();
  });
});

describe('Codegen Integration', () => {
  it('evolved generator is called from generateCoreNode', () => {
    const gen = (node: any) => [`// evolved: ${node.props?.name}`];
    registerEvolvedGenerator('my-evolved', gen);

    const ast = parse('my-evolved name=test');
    const output = generateCoreNode(ast);
    expect(output).toEqual(['// evolved: test']);

    clearEvolvedGenerators();
  });

  it('evolved generator does not override core nodes', () => {
    // 'type' is a core node — the evolved generator should NOT be reached
    const gen = (_node: any) => ['// should not appear'];
    registerEvolvedGenerator('type', gen);

    const ast = parse('type name=MyType values="a|b"');
    const output = generateCoreNode(ast);
    expect(output.join('\n')).toContain("export type MyType = 'a' | 'b';");
    expect(output.join('\n')).not.toContain('should not appear');

    clearEvolvedGenerators();
  });
});

describe('Spec Dynamic Types', () => {
  it('registerEvolvedType makes type known', () => {
    expect(isKnownNodeType('my-custom-node')).toBe(false);
    registerEvolvedType('my-custom-node');
    expect(isKnownNodeType('my-custom-node')).toBe(true);
    clearEvolvedTypes();
  });

  it('KERN_RESERVED contains core types', () => {
    expect(KERN_RESERVED.has('button' as any)).toBe(true);
    expect(KERN_RESERVED.has('screen' as any)).toBe(true);
    expect(KERN_RESERVED.has('route' as any)).toBe(true);
    expect(KERN_RESERVED.has('nonexistent' as any)).toBe(false);
  });
});
