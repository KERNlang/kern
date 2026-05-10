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

  test('emits extern package child imports for Python targets', () => {
    expect(py(['extern package=numpy registry=pypi target=fastapi', '  import names=array'].join('\n'))).toBe(
      'from numpy import array',
    );
  });

  test('emits extern inline props for Python targets', () => {
    expect(py('extern package=numpy registry=pypi target=fastapi names=array')).toBe('from numpy import array');
  });

  test('skips extern NPM packages for Python targets', () => {
    expect(py(['extern package=react registry=npm target=react', '  import names=useMemo'].join('\n'))).toBe('');
  });

  test('emits extern default and named child imports for Python targets', () => {
    expect(
      py(['extern package=numpy registry=pypi target=fastapi', '  import default=np names=array'].join('\n')),
    ).toBe(['import numpy as np', 'from numpy import array'].join('\n'));
  });

  test('emits extern inline bindings alongside child imports for Python targets', () => {
    expect(
      py(['extern package=numpy registry=pypi target=fastapi names=array', '  import names=ndarray'].join('\n')),
    ).toBe(['from numpy import array', 'from numpy import ndarray'].join('\n'));
  });

  test('allows extern child imports to target Python package submodules', () => {
    expect(
      py(['extern package=numpy registry=pypi target=fastapi', '  import from=numpy.linalg names=norm'].join('\n')),
    ).toBe('from numpy.linalg import norm');
  });

  test('treats declaration-only extern boundaries as metadata-only', () => {
    expect(py('extern package=numpy registry=pypi target=fastapi')).toBe('');
  });
});
