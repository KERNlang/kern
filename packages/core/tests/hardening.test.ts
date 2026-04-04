/**
 * Adversarial hardening tests for KERN core.
 * Verifies prompt-injection immunity, parser resilience, and codegen safety.
 * Written based on findings from Evil Twin + Codex + Gemini + 4 tribunal modes.
 */

import {
  emitIdentifier,
  emitImportSpecifier,
  emitStringLiteral,
  emitTypeAnnotation,
  generateCoreNode,
} from '../src/codegen-core.js';
import { resolveConfig } from '../src/config.js';
import { KernCodegenError } from '../src/errors.js';
import { getParseWarnings, parse, parseDocument } from '../src/parser.js';
import {
  getEvolvedTypes,
  isKnownNodeType,
  KERN_RESERVED,
  registerEvolvedType,
  unregisterEvolvedType,
} from '../src/spec.js';
import { escapeJsString, escapeJsxAttr, escapeJsxText } from '../src/utils.js';

// Helper: parse and codegen
function gen(source: string): string {
  const root = parse(source);
  return generateCoreNode(root).join('\n');
}

// ── Parser Adversarial Tests ──────────────────────────────────────────────

describe('Parser Hardening', () => {
  describe('Unclosed delimiters', () => {
    test('unclosed quote produces warning', () => {
      parse('text value="hello world');
      const warnings = getParseWarnings();
      expect(warnings.some((w) => w.includes('Unclosed quoted string'))).toBe(true);
    });

    test('unclosed {{ produces warning', () => {
      parse('text value={{foo');
      const warnings = getParseWarnings();
      expect(warnings.some((w) => w.includes('Unclosed expression'))).toBe(true);
    });

    test('unclosed { style block produces warning', () => {
      parse('text {bg:red,fs:14');
      const warnings = getParseWarnings();
      expect(warnings.some((w) => w.includes('Unclosed style block'))).toBe(true);
    });

    test('unclosed quote does not crash — returns a node', () => {
      const result = parse('text value="unclosed');
      expect(result).toBeDefined();
      expect(result.type).toBe('text');
    });

    test('unclosed {{ does not crash', () => {
      const result = parse('text value={{broken');
      expect(result).toBeDefined();
    });
  });

  describe('Indentation resilience', () => {
    test('tabs as indentation do not crash', () => {
      const result = parse('screen\n\ttext value="hello"');
      expect(result).toBeDefined();
      expect(result.type).toBe('screen');
    });

    test('4-space indentation produces valid tree', () => {
      const result = parse('screen\n    text value="hello"\n    button label="click"');
      expect(result).toBeDefined();
      expect(result.children?.length).toBe(2);
    });

    test('3-space indentation produces valid tree', () => {
      const result = parse('screen\n   text value="one"\n   text value="two"');
      expect(result).toBeDefined();
      expect(result.children?.length).toBe(2);
    });

    test('1-space indentation produces valid tree', () => {
      const result = parse('screen\n text value="hello"');
      expect(result).toBeDefined();
      expect(result.children?.length).toBe(1);
    });

    test('deeply nested (50-level) indentation does not crash', () => {
      const lines = ['screen'];
      for (let i = 1; i <= 50; i++) {
        lines.push(`${'  '.repeat(i)}col name=level${i}`);
      }
      const result = parse(lines.join('\n'));
      expect(result).toBeDefined();
      expect(result.type).toBe('screen');
    });

    test('mixed indent depths produce correct parent-child', () => {
      const result = parseDocument('screen\n  text value="child"\n    button label="grandchild"');
      const screen = result.children?.[0];
      expect(screen?.children?.length).toBe(1); // text
      expect(screen?.children?.[0].children?.length).toBe(1); // button
    });
  });

  describe('Empty and edge cases', () => {
    test('empty source returns document node', () => {
      const result = parse('');
      expect(result.type).toBe('document');
      expect(result.children).toEqual([]);
    });

    test('whitespace-only source returns document node', () => {
      const result = parse('   \n   \n  ');
      expect(result.type).toBe('document');
    });

    test('multiline blocks preserve empty lines', () => {
      const result = parse('handler <<<\nline1\n\nline3\n>>>');
      expect(result).toBeDefined();
      const code = result.props?.code as string;
      expect(code).toContain('\n\n');
    });
  });
});

// ── Codegen Injection Tests ──────────────────────────────────────────────

describe('Codegen Injection Immunity', () => {
  describe('emitIdentifier rejects malicious names', () => {
    test('rejects single-quote injection', () => {
      expect(() => emitIdentifier("'; console.log(1); //", 'fallback')).toThrow(KernCodegenError);
    });

    test('rejects backtick injection', () => {
      expect(() => emitIdentifier('`${process.exit(1)}`', 'fallback')).toThrow(KernCodegenError);
    });

    test('rejects empty string', () => {
      // Empty falls back to fallback, which must be valid
      const result = emitIdentifier('', 'SafeFallback');
      expect(result).toBe('SafeFallback');
    });

    test('rejects parentheses', () => {
      expect(() => emitIdentifier('foo()', 'fallback')).toThrow(KernCodegenError);
    });

    test('rejects semicolons', () => {
      expect(() => emitIdentifier('foo;bar', 'fallback')).toThrow(KernCodegenError);
    });

    test('accepts valid KERN identifiers', () => {
      expect(emitIdentifier('myVar', 'fallback')).toBe('myVar');
      expect(emitIdentifier('_private', 'fallback')).toBe('_private');
      expect(emitIdentifier('PascalCase', 'fallback')).toBe('PascalCase');
      // Hyphens are NOT valid in generated JS/TS identifiers
      expect(() => emitIdentifier('kebab-case', 'fallback')).toThrow(KernCodegenError);
      expect(emitIdentifier('$state', 'fallback')).toBe('$state');
    });
  });

  describe('emitStringLiteral escapes dangerous content', () => {
    test('escapes single quotes', () => {
      const result = emitStringLiteral("it's dangerous");
      expect(result).not.toContain("it's");
      expect(result).toContain("\\'");
    });

    test('escapes backticks', () => {
      const result = emitStringLiteral('`template`');
      expect(result).toContain('\\`');
    });

    test('escapes ${} template interpolation', () => {
      const result = emitStringLiteral('${process.env.SECRET}');
      expect(result).toContain('\\$');
      // The escaped form \${ still contains ${ as a substring, so check the output
      // doesn't contain an UNESCAPED template literal that JS would evaluate
      expect(result).not.toMatch(/[^\\]\$\{/);
    });

    test('escapes backslashes', () => {
      const result = emitStringLiteral('path\\to\\file');
      expect(result).toContain('\\\\');
    });
  });

  describe('emitTypeAnnotation validates TS types', () => {
    test('accepts simple types', () => {
      expect(emitTypeAnnotation('string', 'unknown')).toBe('string');
      expect(emitTypeAnnotation('number', 'unknown')).toBe('number');
      expect(emitTypeAnnotation('boolean', 'unknown')).toBe('boolean');
      expect(emitTypeAnnotation('void', 'unknown')).toBe('void');
      expect(emitTypeAnnotation('any', 'unknown')).toBe('any');
      expect(emitTypeAnnotation('unknown', 'fallback')).toBe('unknown');
      expect(emitTypeAnnotation('never', 'unknown')).toBe('never');
    });

    test('accepts generics', () => {
      expect(emitTypeAnnotation('Map<string, number>', 'unknown')).toBe('Map<string, number>');
      expect(emitTypeAnnotation('Promise<void>', 'unknown')).toBe('Promise<void>');
      expect(emitTypeAnnotation('Array<T>', 'unknown')).toBe('Array<T>');
      expect(emitTypeAnnotation('Record<string, unknown>', 'unknown')).toBe('Record<string, unknown>');
    });

    test('accepts arrays', () => {
      expect(emitTypeAnnotation('string[]', 'unknown')).toBe('string[]');
      expect(emitTypeAnnotation('number[][]', 'unknown')).toBe('number[][]');
      expect(emitTypeAnnotation('Promise<User>[]', 'unknown')).toBe('Promise<User>[]');
    });

    test('accepts unions and intersections', () => {
      expect(emitTypeAnnotation('string | number', 'unknown')).toBe('string | number');
      expect(emitTypeAnnotation('Foo | null', 'unknown')).toBe('Foo | null');
      expect(emitTypeAnnotation('A & B', 'unknown')).toBe('A & B');
      expect(emitTypeAnnotation('(string | number)[]', 'unknown')).toBe('(string | number)[]');
    });

    test('accepts tuples', () => {
      expect(emitTypeAnnotation('[string, number]', 'unknown')).toBe('[string, number]');
      expect(emitTypeAnnotation('[string, ...number[]]', 'unknown')).toBe('[string, ...number[]]');
    });

    test('accepts function types', () => {
      expect(emitTypeAnnotation('(x: number) => void', 'unknown')).toBe('(x: number) => void');
      expect(emitTypeAnnotation('() => Promise<void>', 'unknown')).toBe('() => Promise<void>');
    });

    test('accepts nested generics', () => {
      expect(emitTypeAnnotation('Map<string, Promise<User[]>>', 'unknown')).toBe('Map<string, Promise<User[]>>');
    });

    test('accepts string literal types', () => {
      expect(emitTypeAnnotation("'active' | 'paused'", 'unknown')).toBe("'active' | 'paused'");
    });

    test('accepts typeof and keyof', () => {
      expect(emitTypeAnnotation('typeof Foo', 'unknown')).toBe('typeof Foo');
      expect(emitTypeAnnotation('keyof T', 'unknown')).toBe('keyof T');
    });

    test('rejects backticks (template literal injection)', () => {
      expect(() => emitTypeAnnotation('`${evil}`', 'unknown')).toThrow(KernCodegenError);
      expect(() => emitTypeAnnotation('string`', 'unknown')).toThrow(KernCodegenError);
    });

    test('rejects template interpolation', () => {
      expect(() => emitTypeAnnotation('${process.exit(1)}', 'unknown')).toThrow(KernCodegenError);
    });

    test('rejects semicolons (statement injection)', () => {
      expect(() => emitTypeAnnotation('string; console.log(1)', 'unknown')).toThrow(KernCodegenError);
    });

    test('rejects dynamic imports', () => {
      expect(() => emitTypeAnnotation('import("fs")', 'unknown')).toThrow(KernCodegenError);
      expect(() => emitTypeAnnotation('typeof import("evil")', 'unknown')).toThrow(KernCodegenError);
    });

    test('rejects comments', () => {
      expect(() => emitTypeAnnotation('string // evil', 'unknown')).toThrow(KernCodegenError);
      expect(() => emitTypeAnnotation('string /* evil */', 'unknown')).toThrow(KernCodegenError);
    });

    test('rejects unbalanced brackets', () => {
      expect(() => emitTypeAnnotation('Map<string', 'unknown')).toThrow(KernCodegenError);
      expect(() => emitTypeAnnotation('string>', 'unknown')).toThrow(KernCodegenError);
      expect(() => emitTypeAnnotation('[string', 'unknown')).toThrow(KernCodegenError);
      expect(() => emitTypeAnnotation('((string)', 'unknown')).toThrow(KernCodegenError);
    });

    test('rejects unclosed string literals', () => {
      expect(() => emitTypeAnnotation("'unclosed", 'unknown')).toThrow(KernCodegenError);
    });

    test('uses fallback for empty/undefined', () => {
      expect(emitTypeAnnotation(undefined, 'unknown')).toBe('unknown');
      expect(emitTypeAnnotation('', 'fallback')).toBe('fallback');
    });
  });

  describe('emitImportSpecifier validates import paths', () => {
    test('accepts relative paths', () => {
      expect(emitImportSpecifier('./utils')).toBe('./utils');
      expect(emitImportSpecifier('../lib/helpers')).toBe('../lib/helpers');
    });

    test('accepts bare specifiers', () => {
      expect(emitImportSpecifier('express')).toBe('express');
      expect(emitImportSpecifier('lodash/merge')).toBe('lodash/merge');
    });

    test('accepts scoped packages', () => {
      expect(emitImportSpecifier('@kernlang/core')).toBe('@kernlang/core');
      expect(emitImportSpecifier('@types/node')).toBe('@types/node');
    });

    test('rejects single-quote breaking', () => {
      expect(() => emitImportSpecifier("'; process.exit(1); //")).toThrow(KernCodegenError);
    });

    test('rejects backticks', () => {
      expect(() => emitImportSpecifier('`evil`')).toThrow(KernCodegenError);
    });

    test('rejects semicolons', () => {
      expect(() => emitImportSpecifier('foo; bar')).toThrow(KernCodegenError);
    });

    test('rejects template interpolation', () => {
      expect(() => emitImportSpecifier('${evil}')).toThrow(KernCodegenError);
    });

    test('rejects empty specifier', () => {
      expect(() => emitImportSpecifier('')).toThrow(KernCodegenError);
    });
  });

  describe('generateStore injection vectors', () => {
    test('malicious name throws', () => {
      expect(() => gen('store name="\'; process.exit(1); //" path="~/.data" key=id model=Plan')).toThrow();
    });

    test('valid store generates clean code', () => {
      const code = gen('store name=Plan path="~/.agon/plans" key=id model=Plan');
      expect(code).toContain('function savePlan');
      expect(code).toContain('function loadPlan');
      expect(code).not.toContain('process.exit');
    });

    test('storePath with quotes is rejected', () => {
      expect(() => gen('store name=Test path="~/test\'s" key=id model=Test')).toThrow();
    });
  });

  describe('generateConfig injection vectors', () => {
    test('default value with quotes is escaped', () => {
      const code = gen('config name=Cfg\n  field name=label type=string default="O\'Connor"');
      expect(code).toContain('O\\');
      expect(code).not.toContain("O'Connor',");
    });

    test('field names are validated', () => {
      expect(() => gen('config name=Cfg\n  field name="x;alert()" type=string')).toThrow();
    });
  });

  describe('generateType / generateInterface injection', () => {
    test('type with malicious name throws', () => {
      expect(() => gen('type name="A;B" values="a|b"')).toThrow();
    });

    test('interface with malicious name throws', () => {
      expect(() => gen('interface name="Foo;Bar"\n  field name=id type=string')).toThrow();
    });
  });
});

// ── Round-Trip Tests (parse → codegen → non-empty) ───────────────────────

describe('Round-Trip Codegen', () => {
  const cases: Array<[string, string]> = [
    ['type', 'type name=Status values="active|inactive"'],
    ['interface', 'interface name=User\n  field name=id type=string\n  field name=email type=string'],
    ['union', 'union name=Shape discriminant=kind\n  variant name=circle\n    field name=radius type=number'],
    ['fn', 'fn name=greet params="name:string" returns=string\n  handler <<<\n    return `Hello ${name}`;\n  >>>'],
    [
      'machine',
      'machine name=Light\n  state name=off initial=true\n  state name=on\n  transition name=toggle from=off to=on',
    ],
    ['error', 'error name=AppError extends=Error'],
    ['config', 'config name=AppConfig\n  field name=port type=number default=3000'],
    ['store', 'store name=Item path="~/.data/items" key=id model=Item'],
    ['event', 'event name=AppEvent\n  type name=start\n  type name=stop'],
    ['derive', 'derive name=total expr={{a + b}} type=number'],
    ['transform', 'transform name=doubled target="items" via="map(x => x * 2)"'],
    ['action', 'action name=notify\n  handler <<<\n    console.log("done");\n  >>>'],
    ['guard', 'guard name=isAuth expr={{user.authenticated}}'],
    ['invariant', 'invariant name=positive expr={{count > 0}}'],
    ['each', 'each name=item in="items"\n  derive name=upper expr={{item.toUpperCase()}}'],
    ['collect', 'collect name=active from="users" where={{u.active}}'],
    ['branch', 'branch name=router on="action"\n  path value="create"\n    derive name=result expr={{create()}}'],
    ['expect', 'expect name=score expr={{totalScore}} within="0..100"'],
    [
      'recover',
      'recover name=api\n  strategy name=retry max=3 delay=1000\n  strategy name=fallback\n    handler <<<\n      throw new Error("failed");\n    >>>',
    ],
    ['const', 'const name=API_URL type=string value="https://example.com"'],
    ['import', 'import from="node:fs" names="readFileSync"'],
    ['on', 'on event=click\n  handler <<<\n    handleClick();\n  >>>'],
  ];

  for (const [label, source] of cases) {
    test(`${label} node produces non-empty output`, () => {
      const code = gen(source);
      expect(code.trim().length).toBeGreaterThan(0);
    });
  }
});

// ── Config Isolation Tests ───────────────────────────────────────────────

describe('Config Isolation', () => {
  test('resolveConfig returns independent copies', () => {
    const a = resolveConfig();
    const b = resolveConfig();
    a.target = 'express';
    expect(b.target).toBe('nextjs');
  });

  test('resolveConfig with user overrides does not leak', () => {
    const a = resolveConfig({ target: 'express' });
    const b = resolveConfig();
    expect(a.target).toBe('express');
    expect(b.target).toBe('nextjs');
  });

  test('uvicorn workers=0 is preserved', () => {
    const config = resolveConfig({ fastapi: { uvicorn: { workers: 0 } } });
    expect(config.fastapi.uvicorn.workers).toBe(0);
  });

  test('nested objects are independent', () => {
    const a = resolveConfig();
    const b = resolveConfig();
    a.colors['#custom'] = 'custom';
    expect(b.colors['#custom']).toBeUndefined();
  });
});

// ── Mutable State Isolation Tests ────────────────────────────────────────

describe('Mutable State Isolation', () => {
  test('getEvolvedTypes returns defensive copy', () => {
    const types = getEvolvedTypes();
    (types as Set<string>).add('poison');
    expect(isKnownNodeType('poison')).toBe(false);
  });

  test('KERN_RESERVED is frozen', () => {
    expect(Object.isFrozen(KERN_RESERVED)).toBe(true);
  });

  test('registerEvolvedType + unregister is clean', () => {
    registerEvolvedType('testnode');
    expect(isKnownNodeType('testnode')).toBe(true);
    unregisterEvolvedType('testnode');
    expect(isKnownNodeType('testnode')).toBe(false);
  });
});

// ── Escape Function Tests ────────────────────────────────────────────────

describe('Escape Functions', () => {
  test('escapeJsString escapes backticks', () => {
    expect(escapeJsString('hello `world`')).toContain('\\`');
  });

  test('escapeJsString escapes dollar signs', () => {
    expect(escapeJsString('${evil}')).toContain('\\$');
  });

  test('escapeJsString escapes double quotes', () => {
    expect(escapeJsString('say "hello"')).toContain('\\"');
  });

  test('escapeJsxAttr escapes single quotes', () => {
    expect(escapeJsxAttr("it's")).toContain('&#39;');
  });

  test('escapeJsxText escapes angle brackets', () => {
    expect(escapeJsxText('<script>alert(1)</script>')).toContain('&lt;');
    expect(escapeJsxText('<script>alert(1)</script>')).not.toContain('<script>');
  });
});

// ── Systemic Guard: No Raw Interpolation in Codegen ──────────────────────

describe('Systemic Guard', () => {
  test('codegen-core.ts has no remaining raw name interpolation', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const { fileURLToPath } = await import('url');
    const thisDir = fileURLToPath(new URL('.', import.meta.url));
    const source = readFileSync(resolve(thisDir, '../src/codegen-core.ts'), 'utf-8');
    // This pattern catches: const name = props.name as string;
    // which was the root cause of injection — all should now use emitIdentifier
    const rawPattern = /const name = props\.name as string;/g;
    const matches = source.match(rawPattern);
    expect(matches).toBeNull();
  });
});
