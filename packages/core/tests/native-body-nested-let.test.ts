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
});
