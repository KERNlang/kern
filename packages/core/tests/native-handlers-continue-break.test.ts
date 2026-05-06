/** Native KERN handler bodies — continue / break body-statements (TS target).
 *  Closes the gap that blocked self-hosting any TS function with a
 *  `for (...) { if (...) continue; }` / `for (...) { if (...) break; }`
 *  pattern in `lang="kern"` form. Authors previously had to drop into a
 *  raw `<<<JS>>>` handler for the early-skip / early-exit shape. */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import { parseDocumentStrict, parseDocumentWithDiagnostics } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('continue / break body-statements — TS target', () => {
  test('bare continue inside each emits `continue;`', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { name: 'item', in: 'items' },
        children: [
          {
            type: 'if',
            props: { cond: 'item.skip' },
            children: [{ type: 'continue', props: {} }],
          },
          { type: 'do', props: { value: 'process(item)' } },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('for (const item of items) {');
    expect(out).toContain('if (item.skip) {');
    expect(out).toContain('continue;');
    expect(out).toContain('process(item);');
  });

  test('bare break inside each emits `break;`', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { name: 'item', in: 'items' },
        children: [
          {
            type: 'if',
            props: { cond: 'item.matches' },
            children: [
              { type: 'let', props: { name: 'found', value: 'item' } },
              { type: 'break', props: {} },
            ],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('for (const item of items) {');
    expect(out).toContain('if (item.matches) {');
    expect(out).toContain('const found = item;');
    expect(out).toContain('break;');
  });

  test('continue indents under nested if/each', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { name: 'group', in: 'groups' },
        children: [
          {
            type: 'each',
            props: { name: 'item', in: 'group.items' },
            children: [
              {
                type: 'if',
                props: { cond: 'item.invalid' },
                children: [{ type: 'continue', props: {} }],
              },
            ],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    // outer for, inner for, inner if, indented continue
    const lines = out.split('\n');
    const continueLine = lines.find((l) => l.trim() === 'continue;');
    expect(continueLine).toBeDefined();
    // Continue is inside two `for` and one `if`, so indentation should be at least 6 spaces.
    expect(continueLine?.startsWith('      ')).toBe(true);
  });

  test('break at top of each (skip-first style)', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { name: 'x', in: 'xs' },
        children: [{ type: 'break', props: {} }],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('for (const x of xs) {');
    expect(out).toContain('  break;');
  });
});

describe('continue / break body-statements — parser + validator', () => {
  test('continue valid inside handler lang="kern"', () => {
    const src = [
      'fn name=ok returns=void',
      '  handler lang="kern"',
      '    each name=x in=xs',
      '      continue',
    ].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  test('break valid inside handler lang="kern"', () => {
    const src = [
      'fn name=ok returns=void',
      '  handler lang="kern"',
      '    each name=x in=xs',
      '      break',
    ].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  test('continue rejected outside native-body scope', () => {
    const src = ['fn name=ok returns=void', '  continue'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const errs = diagnostics.filter(
      (d) => d.severity === 'error' && d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER',
    );
    expect(errs.length).toBeGreaterThan(0);
  });

  test('break rejected outside native-body scope', () => {
    const src = ['fn name=ok returns=void', '  break'].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    const errs = diagnostics.filter(
      (d) => d.severity === 'error' && d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER',
    );
    expect(errs.length).toBeGreaterThan(0);
  });

  // Codex-flagged BLOCKER on the prior commit: continue / break must appear
  // in the allowedChildren of `try` and `catch`, otherwise schema validation
  // rejects valid loop-control IR. parseDocumentStrict throws on schema
  // violations, so use it to lock the regression.
  test('strict parse: continue inside try inside each is schema-valid', () => {
    const src = [
      'fn name=ok returns=void',
      '  handler lang="kern"',
      '    each name=x in=xs',
      '      try',
      '        continue',
      '        catch name=e',
      '          do value="log(e)"',
    ].join('\n');
    expect(() => parseDocumentStrict(src)).not.toThrow();
  });

  test('strict parse: break inside catch is schema-valid', () => {
    const src = [
      'fn name=ok returns=void',
      '  handler lang="kern"',
      '    each name=x in=xs',
      '      try',
      '        do value="risky(x)"',
      '        catch name=e',
      '          break',
    ].join('\n');
    expect(() => parseDocumentStrict(src)).not.toThrow();
  });

  test('strict parse: continue inside if inside each is schema-valid', () => {
    const src = [
      'fn name=ok returns=void',
      '  handler lang="kern"',
      '    each name=x in=xs',
      '      if cond="x.skip"',
      '        continue',
    ].join('\n');
    expect(() => parseDocumentStrict(src)).not.toThrow();
  });
});
