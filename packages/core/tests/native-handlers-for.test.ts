/** Native KERN handler bodies — for body-statement (TS target). */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import { parseDocumentStrict, parseDocumentWithDiagnostics } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('body-statement for — TS target', () => {
  test('emits numeric range loop with cross-target List.length bound', () => {
    const handler = makeHandler([
      {
        type: 'for',
        props: { name: 'i', from: '0', to: 'List.length(items)' },
        children: [{ type: 'do', props: { value: 'visit(items[i])' } }],
      },
    ]);

    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_for_start_1 = 0;');
    expect(out).toContain('const __k_for_end_2 = items.length;');
    expect(out).toContain('for (let i = __k_for_start_1; i < __k_for_end_2; i++) {');
    expect(out).toContain('  visit(items[i]);');
  });

  test('emits explicit positive step', () => {
    const handler = makeHandler([
      {
        type: 'for',
        props: { name: 'i', from: '1', to: '10', step: '2' },
        children: [{ type: 'do', props: { value: 'visit(i)' } }],
      },
    ]);

    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_for_start_1 = 1;');
    expect(out).toContain('const __k_for_end_2 = 10;');
    expect(out).toContain('for (let i = __k_for_start_1; i < __k_for_end_2; i += 2) {');
  });

  test('emits explicit negative step', () => {
    const handler = makeHandler([
      {
        type: 'for',
        props: { name: 'i', from: '2', to: '-1', step: '-1' },
        children: [{ type: 'do', props: { value: 'visit(i)' } }],
      },
    ]);

    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('const __k_for_start_1 = 2;');
    expect(out).toContain('const __k_for_end_2 = -1;');
    expect(out).toContain('for (let i = __k_for_start_1; i > __k_for_end_2; i--) {');
  });

  test('composes with continue and break', () => {
    const handler = makeHandler([
      {
        type: 'for',
        props: { name: 'i', from: '0', to: '10' },
        children: [
          { type: 'if', props: { cond: 'i === 2' }, children: [{ type: 'continue', props: {} }] },
          { type: 'if', props: { cond: 'i === 8' }, children: [{ type: 'break', props: {} }] },
        ],
      },
    ]);

    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('continue;');
    expect(out).toContain('break;');
  });

  test('rejects propagation in range props', () => {
    const handler = makeHandler([{ type: 'for', props: { name: 'i', from: '0', to: 'load()?' }, children: [] }]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/Propagation '\?' is not allowed in `for from=`/);
  });

  test.each([
    '0',
    '0.5',
    '1.0',
    'someStep',
  ])('rejects zero, non-integer, or non-literal step %s', (step) => {
    const handler = makeHandler([{ type: 'for', props: { name: 'i', from: '0', to: '10', step }, children: [] }]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/for step=.*non-zero integer literal/);
  });

  test('rejects non-cross-target loop identifier', () => {
    const handler = makeHandler([{ type: 'for', props: { name: 'bad-name', from: '0', to: '10' }, children: [] }]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/for name=.*cross-target identifier/);
  });

  test('parses for inside native handler', () => {
    const root = parseDocumentStrict(
      [
        'fn name=visitAll returns=void',
        '  handler lang="kern"',
        '    for name=i from=0 to="List.length(items)"',
        '      break',
      ].join('\n'),
    );
    const fn = root.children?.find((c) => c.type === 'fn') ?? root;
    const handler = fn.children?.find((c) => c.type === 'handler');
    expect(handler?.children?.[0]?.type).toBe('for');
  });

  test('for outside native handler is a body-context error', () => {
    const { diagnostics } = parseDocumentWithDiagnostics(
      ['fn name=bad returns=void', '  for name=i from=0 to=10', '    break'].join('\n'),
    );
    const violation = diagnostics.find((d) => d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER');
    expect(violation?.message).toMatch(/`for`/);
  });

  test('invalid step literal is a parser diagnostic', () => {
    const { diagnostics } = parseDocumentWithDiagnostics(
      ['fn name=bad returns=void', '  handler lang="kern"', '    for name=i from=0 to=10 step=someStep'].join('\n'),
    );
    expect(diagnostics.some((d) => d.code === 'BODY_FOR_INVALID_STEP')).toBe(true);
  });

  test('invalid loop name is a parser diagnostic', () => {
    const { diagnostics } = parseDocumentWithDiagnostics(
      ['fn name=bad returns=void', '  handler lang="kern"', '    for name=bad-name from=0 to=10'].join('\n'),
    );
    expect(diagnostics.some((d) => d.code === 'BODY_FOR_INVALID_NAME')).toBe(true);
  });

  test('fractional literal bound is a parser diagnostic', () => {
    const { diagnostics } = parseDocumentWithDiagnostics(
      ['fn name=bad returns=void', '  handler lang="kern"', '    for name=i from=0 to=3.7'].join('\n'),
    );
    expect(diagnostics.some((d) => d.code === 'BODY_FOR_INVALID_BOUND')).toBe(true);
  });
});
