/** Native KERN handler bodies — body-statement `branch` (TS target).
 *  Closes the gap that blocked self-hosting any TS function with a
 *  `switch (...)` pattern in `lang="kern"` form. Authors previously had
 *  to drop into a raw `<<<JS>>>` handler for switch-style dispatch — even
 *  though `branch`/`path` already existed as a top-level construct, it
 *  wasn't admitted as a body-statement child. */

import { emitNativeKernBodyTS } from '../src/codegen/body-ts.js';
import { parseDocumentStrict, parseDocumentWithDiagnostics } from '../src/parser.js';
import { validateSchema } from '../src/schema.js';
import type { IRNode } from '../src/types.js';

function makeHandler(children: IRNode[]): IRNode {
  return { type: 'handler', props: { lang: 'kern' }, children };
}

describe('body-statement branch — TS target', () => {
  test('branch with quoted string paths emits switch + JSON-quoted literals', () => {
    const handler = makeHandler([
      {
        type: 'branch',
        props: { name: 'route', on: 'kind' },
        children: [
          {
            type: 'path',
            props: { value: 'paid' },
            __quotedProps: ['value'],
            children: [{ type: 'do', props: { value: 'markPaid()' } }],
          },
          {
            type: 'path',
            props: { value: 'pending' },
            __quotedProps: ['value'],
            children: [{ type: 'do', props: { value: 'markPending()' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('switch (kind) {');
    expect(out).toContain('case "paid": {');
    expect(out).toContain('case "pending": {');
    expect(out).toContain('markPaid();');
    expect(out).toContain('markPending();');
    expect(out).toContain('break;');
  });

  test('branch with identifier path values emits unquoted refs', () => {
    const handler = makeHandler([
      {
        type: 'branch',
        props: { name: 'route', on: 'status' },
        children: [
          {
            type: 'path',
            props: { value: 'PaymentStatus.Paid' },
            children: [{ type: 'do', props: { value: 'log("paid")' } }],
          },
          {
            type: 'path',
            props: { value: 'PaymentStatus.Pending' },
            children: [{ type: 'do', props: { value: 'log("pending")' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('switch (status) {');
    // Unquoted (no __quotedProps) → identifier reference, not a string.
    expect(out).toContain('case PaymentStatus.Paid: {');
    expect(out).toContain('case PaymentStatus.Pending: {');
    expect(out).not.toContain('"PaymentStatus.Paid"');
  });

  test('branch with default path emits `default:` clause', () => {
    const handler = makeHandler([
      {
        type: 'branch',
        props: { name: 'route', on: 'kind' },
        children: [
          {
            type: 'path',
            props: { value: 'paid' },
            __quotedProps: ['value'],
            children: [{ type: 'do', props: { value: 'markPaid()' } }],
          },
          {
            type: 'path',
            props: { default: true },
            children: [{ type: 'do', props: { value: 'log("unknown")' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('case "paid": {');
    expect(out).toContain('default: {');
    expect(out).toContain('log("unknown");');
  });

  test('branch values with apostrophes / backslashes survive JSON quoting (codex review-fix)', () => {
    const handler = makeHandler([
      {
        type: 'branch',
        props: { name: 'route', on: 'kind' },
        children: [
          {
            type: 'path',
            props: { value: "won't" },
            __quotedProps: ['value'],
            children: [{ type: 'do', props: { value: 'log()' } }],
          },
          {
            type: 'path',
            props: { value: 'a\\b' },
            __quotedProps: ['value'],
            children: [{ type: 'do', props: { value: 'log()' } }],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    // JSON.stringify produces "won\u0027t" or "won't" depending on policy;
    // the only guarantee we lock in is that the emitted code is valid JS
    // string literal syntax for both. Easier check: each case starts with
    // double-quote and the original `'` from `won't` survives in some form.
    expect(out).toMatch(/case "won['\\u0027]?t":/);
    expect(out).toContain('case "a\\\\b":');
  });

  test('branch indents under nested each', () => {
    const handler = makeHandler([
      {
        type: 'each',
        props: { name: 'item', in: 'items' },
        children: [
          {
            type: 'branch',
            props: { name: 'r', on: 'item.kind' },
            children: [
              {
                type: 'path',
                props: { value: 'a' },
                __quotedProps: ['value'],
                children: [{ type: 'continue', props: {} }],
              },
              {
                type: 'path',
                props: { default: true },
                children: [{ type: 'do', props: { value: 'process(item)' } }],
              },
            ],
          },
        ],
      },
    ]);
    const out = emitNativeKernBodyTS(handler);
    expect(out).toContain('for (const item of items) {');
    expect(out).toContain('  switch (item.kind) {');
    expect(out).toContain('    case "a": {');
    expect(out).toContain('      continue;');
    expect(out).toContain('    default: {');
    expect(out).toContain('      process(item);');
  });
});

describe('body-statement branch — parser + validator', () => {
  test('branch is schema-valid inside handler lang="kern"', () => {
    const src = [
      'fn name=route returns=void',
      '  handler lang="kern"',
      '    branch name=r on="kind"',
      '      path value="paid"',
      '        return value="1"',
      '      path default=true',
      '        return value="0"',
    ].join('\n');
    expect(() => parseDocumentStrict(src)).not.toThrow();
  });

  test('branch is schema-valid inside try', () => {
    const src = [
      'fn name=route returns=void',
      '  handler lang="kern"',
      '    try',
      '      branch name=r on="x"',
      '        path default=true',
      '          do value="noop()"',
      '      catch name=e',
      '        do value="log(e)"',
    ].join('\n');
    expect(() => parseDocumentStrict(src)).not.toThrow();
  });

  test('path with both value= and default=true is rejected', () => {
    const node: IRNode = {
      type: 'branch',
      props: { name: 'r', on: 'x' },
      children: [{ type: 'path', props: { value: 'a', default: true } }],
    };
    const violations = validateSchema(node);
    expect(violations.some((v) => v.message.includes('must not combine'))).toBe(true);
  });

  test('path with neither value= nor default=true is rejected', () => {
    const node: IRNode = {
      type: 'branch',
      props: { name: 'r', on: 'x' },
      children: [{ type: 'path', props: {} }],
    };
    const violations = validateSchema(node);
    expect(violations.some((v) => v.message.includes("requires either 'value='"))).toBe(true);
  });

  test('branch with two default paths is rejected', () => {
    const node: IRNode = {
      type: 'branch',
      props: { name: 'r', on: 'x' },
      children: [
        { type: 'path', props: { default: true } },
        { type: 'path', props: { default: true } },
      ],
    };
    const violations = validateSchema(node);
    expect(violations.some((v) => v.message.includes("'branch' must contain at most one"))).toBe(true);
  });

  test('branch on truthy "default" string also dedups (loose-truthy)', () => {
    const node: IRNode = {
      type: 'branch',
      props: { name: 'r', on: 'x' },
      children: [
        { type: 'path', props: { default: 'true' } },
        { type: 'path', props: { default: 'true' } },
      ],
    };
    const violations = validateSchema(node);
    expect(violations.some((v) => v.message.includes("'branch' must contain at most one"))).toBe(true);
  });

  test('plain parser accepts branch in handler lang="kern" without errors', () => {
    const src = [
      'fn name=ok returns=void',
      '  handler lang="kern"',
      '    branch name=r on="kind"',
      '      path value="a"',
      '        return value="1"',
    ].join('\n');
    const { diagnostics } = parseDocumentWithDiagnostics(src);
    expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });
});
