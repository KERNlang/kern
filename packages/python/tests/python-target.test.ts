import type { ResolvedKernConfig } from '@kernlang/core';
import { parse } from '../../core/src/parser.js';
import { transpilePython } from '../src/targets/python.js';

describe('Python Transpiler Target & emit=models Flag', () => {
  test('emits pure portable Pydantic models for interface-only source', () => {
    const root = parse(
      [
        'interface name=User',
        '  field name=id type=string',
        '  field name=email type=string',
        '',
        'type name=Role values="admin|user|guest"',
      ].join('\n'),
    );

    const result = transpilePython(root, {
      target: 'python',
      emit: 'models',
    } as ResolvedKernConfig);

    expect(result.code).toContain('class User(BaseModel):');
    expect(result.code).toContain('id: str');
    expect(result.code).toContain('email: str');
    expect(result.code).toContain('Role = Literal["admin", "user", "guest"]');
    expect(result.code).toContain('from pydantic import BaseModel');
    expect(result.code).not.toContain('FastAPI');
    expect(result.code).not.toContain('sqlmodel');
  });

  test('respects --python-model-backend=pydantic', () => {
    const root = parse(['model name=User table=users', '  column name=id type=string'].join('\n'));

    const result = transpilePython(root, {
      target: 'python',
      emit: 'models',
      pythonModelBackend: 'pydantic',
    } as ResolvedKernConfig);

    expect(result.code).toContain('class User(BaseModel):');
    expect(result.code).toContain('id: str');
    expect(result.code).not.toContain('SQLModel');
    expect(result.code).not.toContain('table=True');
  });

  test('respects --python-model-backend=sqlmodel', () => {
    const root = parse(['model name=User table=users', '  column name=id type=string'].join('\n'));

    const result = transpilePython(root, {
      target: 'python',
      emit: 'models',
      pythonModelBackend: 'sqlmodel',
    } as ResolvedKernConfig);

    expect(result.code).toContain('class User(SQLModel, table=True):');
    expect(result.code).toContain('id: str');
    expect(result.code).toContain('from sqlmodel import SQLModel');
  });

  test('route invariance (decl-driven emit-models)', () => {
    const root1 = parse(['interface name=User', '  field name=id type=string'].join('\n'));

    const root2 = parse(
      [
        'interface name=User',
        '  field name=id type=string',
        '',
        'server name=API port=8000',
        '  route method=get path=/api',
        '    respond 200 json={{ {status: "ok"} }}',
      ].join('\n'),
    );

    const res1 = transpilePython(root1, { target: 'python', emit: 'models' } as ResolvedKernConfig);
    const res2 = transpilePython(root2, { target: 'python', emit: 'models' } as ResolvedKernConfig);

    expect(res1.code.trim()).toBe(res2.code.trim());
  });
});
