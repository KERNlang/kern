import { parse } from '../src/parser.js';
import { validateSemantics } from '../src/semantic-validator.js';

// Regression coverage for the `let-must-be-inside-each` semantic-validator
// over-rejection: `let` inside `try`/`catch`/`while`/`for` (nested under a
// `handler lang="kern"` body) was wrongly flagged even though the parser
// already accepts that shape and the native body emitter lowers it.
function semanticViolations(source: string) {
  const root = parse(source);
  return validateSemantics(root).filter((v) => v.rule === 'let-must-be-inside-each');
}

describe('let inside nested native-body containers', () => {
  test('let inside try (under handler lang=kern) is valid', () => {
    const source = [
      'fn name=loadStore returns=any',
      '  handler lang="kern"',
      '    let name=path value="getPath()"',
      '    try',
      '      let name=data value="JSON.parse(read(path))"',
      '      return value="data"',
      '      catch name=_e',
      '        return value="null"',
    ].join('\n');
    expect(semanticViolations(source)).toEqual([]);
  });

  test('let inside catch (under handler lang=kern) is valid', () => {
    const source = [
      'fn name=safe returns=any',
      '  handler lang="kern"',
      '    try',
      '      do value="risky()"',
      '      catch name=err',
      '        let name=msg value="errToString(err)"',
      '        return value="msg"',
    ].join('\n');
    expect(semanticViolations(source)).toEqual([]);
  });

  test('let inside while (under handler lang=kern) is valid', () => {
    const source = [
      'fn name=drain returns=void',
      '  handler lang="kern"',
      '    while cond="queue.length > 0"',
      '      let name=item value="queue.shift()"',
      '      do value="process(item)"',
    ].join('\n');
    expect(semanticViolations(source)).toEqual([]);
  });

  test('let inside nested if-inside-try (under handler lang=kern) is valid', () => {
    const source = [
      'fn name=fetch returns=any',
      '  handler lang="kern"',
      '    try',
      '      if cond="cache.has(key)"',
      '        let name=hit value="cache.get(key)"',
      '        return value="hit"',
      '      catch name=_e',
      '        return value="null"',
    ].join('\n');
    expect(semanticViolations(source)).toEqual([]);
  });

  test('let outside any native-body container is still rejected', () => {
    // Bare `let` at module scope — no enclosing handler, no `each`. Should
    // surface the diagnostic so authors don't silently lose a binding.
    const source = ['fn name=bad returns=void', '  let name=x value="1"'].join('\n');
    const v = semanticViolations(source);
    expect(v.length).toBe(1);
    expect(v[0].rule).toBe('let-must-be-inside-each');
  });

  test('let inside catch (under handler lang=kern) is approved (positive control)', () => {
    // Sanity check the positive case used as a baseline for the negative
    // raw-handler-nested case below — the legitimate let-inside-catch
    // ancestry must still pass after the innermost-handler-wins fix.
    const source = [
      'fn name=outer returns=void',
      '  handler lang="kern"',
      '    try',
      '      do value="risky()"',
      '      catch name=err',
      '        let name=msg value="errToString(err)"',
    ].join('\n');
    expect(semanticViolations(source)).toEqual([]);
  });

  test('raw handler nested inside a native handler does NOT inherit native-body permissions', () => {
    // Gemini + OpenCode review fix: `insideNativeBodyHandler` previously
    // returned true for ANY kern-handler ancestor anywhere up the tree.
    // That meant a `let` inside a raw (non-`lang=kern`) handler nested
    // under a native handler was silently approved even though the
    // immediate handler boundary is raw. The corrected walk stops at the
    // first `handler` ancestor and checks ITS lang.
    //
    // The parser will not naturally produce this ancestry (the schema
    // doesn't list `handler` as an `allowedChildren` of `handler`), so
    // we feed the validator the IR directly. This exercises the
    // semantic-validator's defence-in-depth: even if an upstream pass or
    // a future evolved node nests a raw handler inside a native one, the
    // `let` inside the raw handler must be rejected.
    const root = {
      type: 'document',
      children: [
        {
          type: 'fn',
          props: { name: 'outer' },
          children: [
            {
              type: 'handler',
              props: { lang: 'kern' },
              children: [
                { type: 'do', props: { value: 'before()' }, loc: { line: 3, col: 5 } },
                {
                  type: 'handler',
                  // raw — no `lang=kern`
                  props: {},
                  children: [{ type: 'let', props: { name: 'x', value: '1' }, loc: { line: 5, col: 7 } }],
                  loc: { line: 4, col: 5 },
                },
              ],
              loc: { line: 2, col: 3 },
            },
          ],
          loc: { line: 1, col: 1 },
        },
      ],
      loc: { line: 1, col: 1 },
    };
    const violations = validateSemantics(root).filter((v) => v.rule === 'let-must-be-inside-each');
    expect(violations).toHaveLength(1);
  });
});
