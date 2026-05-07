/** Native KERN handler bodies — while body-statement (TS target). */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import { parseDocumentStrict, parseDocumentWithDiagnostics } from '../src/parser.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('body-statement while — TS target', () => {
  test('emits while loop with nested body statements', () => {
    const handler = makeHandler([
      {
        type: 'while',
        props: { cond: 'queue.length > 0' },
        children: [
          { type: 'let', props: { name: 'item', value: 'queue.shift()' } },
          { type: 'do', props: { value: 'process(item)' } },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('while (queue.length > 0) {');
    expect(out).toContain('  const item = queue.shift();');
    expect(out).toContain('  process(item);');
  });

  test('composes with break and continue', () => {
    const handler = makeHandler([
      {
        type: 'while',
        props: { cond: 'running' },
        children: [
          { type: 'if', props: { cond: 'skip' }, children: [{ type: 'continue', props: {} }] },
          { type: 'if', props: { cond: 'done' }, children: [{ type: 'break', props: {} }] },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('while (running) {');
    expect(out).toContain('continue;');
    expect(out).toContain('break;');
  });

  test('emits nested while and each loops with innermost loop control', () => {
    const handler = makeHandler([
      {
        type: 'while',
        props: { cond: 'running' },
        children: [
          {
            type: 'each',
            props: { name: 'job', in: 'jobs' },
            children: [
              {
                type: 'while',
                props: { cond: 'job.pending' },
                children: [
                  { type: 'do', props: { value: 'job.step()' } },
                  { type: 'if', props: { cond: 'job.done' }, children: [{ type: 'break', props: {} }] },
                ],
              },
              { type: 'continue', props: {} },
            ],
          },
        ],
      },
    ]);

    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('while (running) {');
    expect(out).toContain('  for (const job of jobs) {');
    expect(out).toContain('    while (job.pending) {');
    expect(out).toContain('      job.step();');
    expect(out).toContain('        break;');
    expect(out).toContain('    }');
    expect(out).toContain('    continue;');
  });

  test('rejects propagation in condition', () => {
    const handler = makeHandler([{ type: 'while', props: { cond: 'load()?' }, children: [] }]);
    expect(() => emitNativeKernBodyTS(handler)).toThrow(/Propagation '\?' is not allowed in `while cond=`/);
  });

  test('parses while inside native handler', () => {
    const root = parseDocumentStrict(
      ['fn name=drain returns=void', '  handler lang="kern"', '    while cond="queue.length > 0"', '      break'].join(
        '\n',
      ),
    );
    const fn = root.children?.find((c) => c.type === 'fn') ?? root;
    const handler = fn.children?.find((c) => c.type === 'handler');
    expect(handler?.children?.[0]?.type).toBe('while');
  });

  test('while outside native handler is a body-context error', () => {
    const { diagnostics } = parseDocumentWithDiagnostics(
      ['fn name=bad returns=void', '  while cond="running"', '    break'].join('\n'),
    );
    const violation = diagnostics.find((d) => d.code === 'BODY_STATEMENT_OUTSIDE_NATIVE_HANDLER');
    expect(violation?.message).toMatch(/`while`/);
  });
});
