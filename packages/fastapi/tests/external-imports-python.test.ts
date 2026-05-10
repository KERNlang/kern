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

  test('emits dotted Python module imports', () => {
    expect(py('import from=urllib.parse names=quote')).toBe('from urllib.parse import quote');
    expect(py('import from=numpy.linalg registry=pypi names=norm')).toBe('from numpy.linalg import norm');
  });

  test('supports legacy default=true import aliases', () => {
    expect(py('import default=true name=App from=app')).toBe('import app as App');
  });

  test('emits module alias and named imports separately', () => {
    expect(py('import default=true name=App from=app names=create_app')).toBe(
      ['import app as App', 'from app import create_app'].join('\n'),
    );
  });
});
