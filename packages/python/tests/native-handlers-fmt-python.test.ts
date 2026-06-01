/** Native KERN handler bodies — Python parity for `fmt` body-statement.
 *
 *  Mirrors core/tests/native-handlers.test.ts fmt block on the FastAPI/Python
 *  target. `fmt name=X template="${expr}…"` lowers to `X = f"{expr}…"`;
 *  `fmt return=true template="…"` lowers to `return f"…"`. Internal `${expr}`
 *  segments are parsed as KERN expressions and re-emitted through the Python
 *  body expression context so target-specific stdlib lowerings apply. */

import type { IRNode } from '@kernlang/core';
import { emitNativeKernBodyPython } from '../src/codegen-body-python.js';
import { KERN_FMT_HELPER_PY } from '../src/core/expr/index.js';

function makeHandler(children: Array<{ type: string; props?: Record<string, unknown> }>): IRNode {
  return {
    type: 'handler',
    props: { lang: 'kern' },
    children: children.map((c) => ({ ...c, props: c.props ?? {} })),
  };
}

// Interpolating templates route each `${expr}` through the `_kern_fmt`
// canonicalizer (bool/None -> 'true'/'false'/'null', matching TS template
// literals), so the helper def is prepended to any body that interpolates.
// Literal-only templates emit no interpolation and stay byte-identical.
const withHelper = (body: string): string => `${KERN_FMT_HELPER_PY}\n\n${body}`;

describe('fmt body-statement — Python codegen', () => {
  test('binding form lowers to f-string assignment', () => {
    const handler = makeHandler([{ type: 'fmt', props: { name: 'label', template: '${count} files' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe(withHelper('label = f"{_kern_fmt(count)} files"'));
  });

  test('return form lowers to `return f"..."`', () => {
    const handler = makeHandler([{ type: 'fmt', props: { template: '${ms}ms', return: 'true' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe(withHelper('return f"{_kern_fmt(ms)}ms"'));
  });

  test('multi-interpolation template lowers to multi-segment f-string', () => {
    const handler = makeHandler([
      {
        type: 'fmt',
        props: { name: 'summary', template: '${count} files over ${total} MB' },
      },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      withHelper('summary = f"{_kern_fmt(count)} files over {_kern_fmt(total)} MB"'),
    );
  });

  test('literal text only (no interpolation) wraps in f-string', () => {
    const handler = makeHandler([{ type: 'fmt', props: { name: 'msg', template: 'hello world' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe('msg = f"hello world"');
  });

  test('literal `{` and `}` in template body are escaped to `{{`/`}}`', () => {
    const handler = makeHandler([{ type: 'fmt', props: { name: 'msg', template: 'plain {brace}' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe('msg = f"plain {{brace}}"');
  });

  test('double-quote in template body is escaped', () => {
    const handler = makeHandler([{ type: 'fmt', props: { name: 'msg', template: 'he said "hi"' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe('msg = f"he said \\"hi\\""');
  });

  test('composes with let + return', () => {
    const handler = makeHandler([
      { type: 'let', props: { name: 'count', value: '7' } },
      { type: 'fmt', props: { name: 'label', template: '${count} files' } },
      { type: 'return', props: { value: 'label' } },
    ]);
    expect(emitNativeKernBodyPython(handler)).toBe(
      withHelper(['count = 7', 'label = f"{_kern_fmt(count)} files"', 'return label'].join('\n')),
    );
  });

  test('throws on missing template', () => {
    const handler = makeHandler([{ type: 'fmt', props: { name: 'x' } }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/template/);
  });

  test('throws on inline-JSX form (no name, no return=true)', () => {
    const handler = makeHandler([{ type: 'fmt', props: { template: '${x}' } }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/name|return/);
  });

  test('throws on return=true combined with name', () => {
    const handler = makeHandler([{ type: 'fmt', props: { name: 'x', template: 'hi', return: 'true' } }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/return=true/);
  });

  test('throws on propagation `?` inside template expression', () => {
    const handler = makeHandler([{ type: 'fmt', props: { name: 'x', template: '${load()?}' } }]);
    expect(() => emitNativeKernBodyPython(handler)).toThrow(/[Pp]ropagation/);
  });

  test('member access inside ${...} is preserved', () => {
    const handler = makeHandler([{ type: 'fmt', props: { name: 'msg', template: 'hi ${user.name}' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe(withHelper('msg = f"hi {_kern_fmt(user.name)}"'));
  });
});

describe('fmt body-statement — Python codegen, backslash escape sequences', () => {
  test('passes `\\n` newline-escape through verbatim (Python interprets at runtime)', () => {
    // Template body is the raw TS source `line1\nline2` (12 chars: `line1`,
    // `\`, `n`, `line2`). Both TS template literals and Python f-strings
    // interpret `\n` as newline, so passing verbatim is semantically correct.
    const handler = makeHandler([{ type: 'fmt', props: { name: 'msg', template: 'line1\\nline2' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe('msg = f"line1\\nline2"');
  });

  test('passes `\\t` and `\\x1b` ANSI escapes through verbatim', () => {
    const handler = makeHandler([{ type: 'fmt', props: { template: '\\x1b[31m${text}\\x1b[0m', return: 'true' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe(withHelper('return f"\\x1b[31m{_kern_fmt(text)}\\x1b[0m"'));
  });

  test('TS `\\${` (literal dollar-brace) lowers to Python `${{` (renders as `${`)', () => {
    // TS source `\${expr}` is a literal `${expr}` at runtime (the `\` escapes
    // the interpolation marker). To render literal `${` in a Python f-string,
    // emit the `$` directly and double the `{`. The interpolation scanner
    // must NOT treat `\${` as an interpolation site.
    const handler = makeHandler([{ type: 'fmt', props: { name: 'msg', template: 'price: \\${cost}' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe('msg = f"price: ${{cost}}"');
  });

  test('TS `` \\` `` (escaped backtick) lowers to literal backtick (no Python escape needed)', () => {
    const handler = makeHandler([{ type: 'fmt', props: { name: 'msg', template: 'wrap \\`code\\` here' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe('msg = f"wrap `code` here"');
  });

  test('TS `\\\\` (escaped backslash) lowers to Python `\\\\` (one literal backslash at runtime)', () => {
    const handler = makeHandler([{ type: 'fmt', props: { name: 'msg', template: 'one\\\\two' } }]);
    expect(emitNativeKernBodyPython(handler)).toBe('msg = f"one\\\\two"');
  });

  test('string-aware `${...}` scanner: `{` and `}` inside an object literal expression are not miscounted', () => {
    // `${ ({foo: bar}.foo) }` — without string-awareness the scanner still
    // works because braces balance, but this exercises the recursive depth
    // tracking for nested `{}` inside interpolation. Codex P2 plan-review
    // hardening: ensure the scanner correctly handles nested braces.
    const handler = makeHandler([{ type: 'fmt', props: { name: 'msg', template: 'val: ${({foo: bar}).foo}' } }]);
    // The exact Python lowering of object-literal expressions depends on
    // emitPyExpr; the important assertion is that the f-string is well-formed
    // (closes at the right brace, no premature termination).
    const result = emitNativeKernBodyPython(handler);
    // The `_kern_fmt` helper is prepended, so the f-string body follows it.
    expect(result).toContain('msg = f"val: {');
    expect(result.endsWith('}"')).toBe(true);
  });
});
