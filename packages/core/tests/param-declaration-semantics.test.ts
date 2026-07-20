import { parseDocumentWithDiagnostics } from '../src/parser.js';
import { validateSemantics } from '../src/semantic-validator.js';

function mixedParameterViolations(source: string) {
  return validateSemantics(parseDocumentWithDiagnostics(source).root).filter(
    (violation) => violation.rule === 'mixed-parameter-declarations',
  );
}

describe('semantic-validator — callable parameter declarations', () => {
  test('rejects mixed legacy and structured declarations at the function location', () => {
    const violations = mixedParameterViolations(
      [
        'fn name=load params="id:string" returns=string',
        '  param name=name type=string',
        '  handler code="return name;"',
      ].join('\n'),
    );

    expect(violations).toEqual([
      {
        rule: 'mixed-parameter-declarations',
        nodeType: 'fn',
        message: 'Callable cannot combine legacy `params=` with structured `param` children.',
        line: 1,
        col: 1,
      },
    ]);
  });

  test('rejects mixed declarations on non-function callables', () => {
    const violations = mixedParameterViolations(
      [
        'class name=Store',
        '  method name=load params="id:string" returns=string',
        '    param name=name type=string',
        '    handler code="return name;"',
      ].join('\n'),
    );

    expect(violations).toEqual([
      {
        rule: 'mixed-parameter-declarations',
        nodeType: 'method',
        message: 'Callable cannot combine legacy `params=` with structured `param` children.',
        line: 2,
        col: 3,
      },
    ]);
  });

  test('accepts legacy-only and structured-only declarations', () => {
    expect(
      mixedParameterViolations('fn name=legacy params="id:string" returns=string\n  handler code="return id;"'),
    ).toEqual([]);
    expect(
      mixedParameterViolations(
        'fn name=structured returns=string\n  param name=id type=string\n  handler code="return id;"',
      ),
    ).toEqual([]);
  });
});
