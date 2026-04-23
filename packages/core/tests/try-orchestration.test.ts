/**
 * Tests for the `try` / `step` / `catch` orchestration nodes — sequential
 * async pipeline with declarative step bindings, optional handler body, and
 * optional catch clause.
 *
 * Agon scan (2026-04-23): 240 `await` + 205 `try/catch` occurrences inside
 * handler bodies, dominated by fetch → parse → store shapes. `try` lets that
 * pattern be expressed without a raw handler block so later tooling
 * (review, decompile, refactor) can see the structure.
 */

import { generateCoreNode, generateTry } from '../src/codegen-core.js';
import { KernCodegenError } from '../src/errors.js';
import { validateSemantics } from '../src/semantic-validator.js';
import type { IRNode } from '../src/types.js';

function mk(type: string, props: Record<string, unknown> = {}, children: IRNode[] = []): IRNode {
  return { type, props, children };
}

describe('try — sequential step bindings', () => {
  it('emits try { ... } with a single step', () => {
    const node = mk('try', { name: 'loadUser' }, [mk('step', { name: 'res', await: 'fetch(url)' })]);
    const code = generateTry(node).join('\n');
    expect(code).toContain('try {');
    expect(code).toContain('const res = await (fetch(url));');
    expect(code).toContain('}');
  });

  it('emits steps in source order so later steps see earlier names', () => {
    const node = mk('try', {}, [
      mk('step', { name: 'res', await: 'fetch(url)' }),
      mk('step', { name: 'body', await: 'res.json()' }),
    ]);
    const code = generateTry(node).join('\n');
    const resIdx = code.indexOf('const res =');
    const bodyIdx = code.indexOf('const body =');
    expect(resIdx).toBeGreaterThan(-1);
    expect(bodyIdx).toBeGreaterThan(resIdx);
  });

  it('honours an optional type annotation on a step', () => {
    const node = mk('try', {}, [mk('step', { name: 'res', await: 'fetch(url)', type: 'Response' })]);
    const code = generateTry(node).join('\n');
    expect(code).toContain('const res: Response = await (fetch(url));');
  });
});

describe('try — handler + catch composition', () => {
  it('splices a post-steps handler body inside the try block', () => {
    const node = mk('try', {}, [
      mk('step', { name: 'body', await: 'fetch(url).then(r => r.json())' }),
      mk('handler', { code: 'setUser(body);' }),
    ]);
    const code = generateTry(node).join('\n');
    expect(code).toContain('const body = await');
    expect(code).toContain('setUser(body);');
    // Handler body sits between the last step and the closing brace.
    expect(code.indexOf('setUser(body);')).toBeGreaterThan(code.indexOf('const body'));
  });

  it('emits a catch clause with a named error binding', () => {
    const node = mk('try', {}, [
      mk('step', { name: 'body', await: 'loadJson()' }),
      mk('handler', { code: 'setUser(body);' }),
      mk('catch', { name: 'err' }, [mk('handler', { code: 'setUser(null); console.error(err);' })]),
    ]);
    const code = generateTry(node).join('\n');
    expect(code).toContain('} catch (err) {');
    expect(code).toContain('setUser(null);');
    expect(code).toContain('console.error(err);');
  });

  it('defaults the catch binding to `e` when no name prop is given', () => {
    const node = mk('try', {}, [
      mk('step', { name: 'x', await: 'f()' }),
      mk('catch', {}, [mk('handler', { code: 'reportError(e);' })]),
    ]);
    const code = generateTry(node).join('\n');
    expect(code).toContain('} catch (e) {');
    expect(code).toContain('reportError(e);');
  });

  it('omits the catch clause entirely when no catch child is present', () => {
    const node = mk('try', {}, [mk('step', { name: 'x', await: 'f()' }), mk('handler', { code: 'use(x);' })]);
    const code = generateTry(node).join('\n');
    expect(code).not.toContain('catch');
    expect(code).toContain('try {');
    expect(code).toContain('}');
  });

  it('allows a catch-only try (no steps, just a handler + catch)', () => {
    // Still useful for wrapping a single imperative handler in a catch
    // without inventing step names.
    const node = mk('try', {}, [
      mk('handler', { code: 'doWork();' }),
      mk('catch', { name: 'err' }, [mk('handler', { code: 'cleanup(err);' })]),
    ]);
    const code = generateTry(node).join('\n');
    expect(code).toContain('try {');
    expect(code).toContain('doWork();');
    expect(code).toContain('} catch (err) {');
    expect(code).toContain('cleanup(err);');
  });
});

describe('try — codegen errors', () => {
  it('throws when a try has no steps and no handler (empty block)', () => {
    const node = mk('try', {});
    expect(() => generateTry(node)).toThrow(KernCodegenError);
    expect(() => generateTry(node)).toThrow(/at least one `step`/);
  });

  it('throws when a step has no await prop', () => {
    const node = mk('try', {}, [mk('step', { name: 'x' })]);
    expect(() => generateTry(node)).toThrow(KernCodegenError);
    expect(() => generateTry(node)).toThrow(/await/);
  });

  it('throws at dispatcher when a step reaches statement scope outside try', () => {
    const orphan = mk('step', { name: 'x', await: 'f()' });
    expect(() => generateCoreNode(orphan)).toThrow(KernCodegenError);
    expect(() => generateCoreNode(orphan)).toThrow(/must be a direct child of `try`/);
  });

  it('throws at dispatcher when a catch reaches statement scope outside try', () => {
    const orphan = mk('catch', {}, [mk('handler', { code: '// noop' })]);
    expect(() => generateCoreNode(orphan)).toThrow(KernCodegenError);
    expect(() => generateCoreNode(orphan)).toThrow(/must be a direct child of `try`/);
  });
});

describe('try — semantic validation', () => {
  it('accepts steps and catch as direct children of try', () => {
    const node = mk('try', {}, [
      mk('step', { name: 'x', await: 'f()' }),
      mk('catch', {}, [mk('handler', { code: '// noop' })]),
    ]);
    const v = validateSemantics(node);
    expect(v.some((x) => x.rule === 'step-must-be-inside-try')).toBe(false);
    expect(v.some((x) => x.rule === 'catch-must-be-inside-try')).toBe(false);
  });

  it('flags a step at top level (no try ancestor)', () => {
    const orphan = mk('step', { name: 'x', await: 'f()' });
    const v = validateSemantics(orphan);
    expect(v.some((x) => x.rule === 'step-must-be-inside-try')).toBe(true);
  });

  it('flags a catch at top level (no try ancestor)', () => {
    const orphan = mk('catch', {}, []);
    const v = validateSemantics(orphan);
    expect(v.some((x) => x.rule === 'catch-must-be-inside-try')).toBe(true);
  });

  it('flags a step nested inside a handler (not directly under try)', () => {
    const parent = mk('fn', { name: 'f' }, [mk('step', { name: 'x', await: 'f()' })]);
    const v = validateSemantics(parent);
    expect(v.some((x) => x.rule === 'step-must-be-inside-try')).toBe(true);
  });
});

describe('try — integration', () => {
  it('lowers the classic fetch → parse → store + fallback shape end to end', () => {
    const node = mk('try', { name: 'loadUser' }, [
      mk('step', { name: 'res', await: 'fetch(`/api/users/${id}`)' }),
      mk('step', { name: 'body', await: 'res.json()' }),
      mk('handler', { code: 'setUser(body);' }),
      mk('catch', { name: 'err' }, [mk('handler', { code: 'setUser(null);' })]),
    ]);
    const code = generateTry(node).join('\n');
    expect(code).toMatchInlineSnapshot(`
"try {
  const res = await (fetch(\`/api/users/\${id}\`));
  const body = await (res.json());
  setUser(body);
} catch (err) {
  setUser(null);
}"
`);
  });
});
