import { parse } from '../../core/src/parser.js';
import { generatePythonCoreNode } from '../src/codegen-python.js';

function py(source: string): string {
  return generatePythonCoreNode(parse(source)).join('\n');
}

describe('FastAPI external import metadata', () => {
  test('emits PyPI imports and skips NPM imports for Python targets', () => {
    expect(py('import from=numpy registry=pypi names=array')).toBe('from numpy import array');
    expect(py('import from=react registry=npm names=useMemo')).toBe('');
  });

  test('skips scoped NPM imports before Python module validation', () => {
    expect(py('import from="@tanstack/react-query" registry=npm names=useQuery')).toBe('');
  });

  test('missing import source returns no Python import', () => {
    expect(py('import registry=npm names=useMemo')).toBe('');
  });
});
