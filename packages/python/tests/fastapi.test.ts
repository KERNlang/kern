import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('FastAPI Transpiler', () => {
  // ── Type Mapping ─────────────────────────────────────────────────────

  describe('Type Mapping', () => {
    test('maps primitive TS types to Python types', async () => {
      const { mapTsTypeToPython } = await import('../src/type-map.js');

      expect(mapTsTypeToPython('string')).toBe('str');
      expect(mapTsTypeToPython('number')).toBe('float');
      expect(mapTsTypeToPython('boolean')).toBe('bool');
      expect(mapTsTypeToPython('any')).toBe('Any');
      expect(mapTsTypeToPython('unknown')).toBe('Any');
      expect(mapTsTypeToPython('void')).toBe('None');
      expect(mapTsTypeToPython('Date')).toBe('datetime');
    });

    test('maps array types', async () => {
      const { mapTsTypeToPython } = await import('../src/type-map.js');

      expect(mapTsTypeToPython('string[]')).toBe('list[str]');
      expect(mapTsTypeToPython('number[]')).toBe('list[float]');
      expect(mapTsTypeToPython('Track[]')).toBe('list[Track]');
    });

    test('maps Record/Map/Set types', async () => {
      const { mapTsTypeToPython } = await import('../src/type-map.js');

      expect(mapTsTypeToPython('Record<string, number>')).toBe('dict[str, float]');
      expect(mapTsTypeToPython('Map<string, boolean>')).toBe('dict[str, bool]');
      expect(mapTsTypeToPython('Set<string>')).toBe('set[str]');
    });

    test('strips Promise wrapper', async () => {
      const { mapTsTypeToPython } = await import('../src/type-map.js');

      expect(mapTsTypeToPython('Promise<Track>')).toBe('Track');
      expect(mapTsTypeToPython('Promise<string>')).toBe('str');
    });

    test('maps union types', async () => {
      const { mapTsTypeToPython } = await import('../src/type-map.js');

      expect(mapTsTypeToPython('string | null')).toBe('str | None');
      expect(mapTsTypeToPython('Track | null')).toBe('Track | None');
    });

    test('maps string literal unions to Literal', async () => {
      const { mapTsTypeToPython } = await import('../src/type-map.js');

      expect(mapTsTypeToPython('"draft" | "approved"')).toBe('Literal["draft", "approved"]');
    });

    test('converts camelCase to snake_case', async () => {
      const { toSnakeCase } = await import('../src/type-map.js');

      expect(toSnakeCase('createTrack')).toBe('create_track');
      expect(toSnakeCase('PlanState')).toBe('plan_state');
      expect(toSnakeCase('HTMLParser')).toBe('html_parser');
      expect(toSnakeCase('simple')).toBe('simple');
    });

    test('maps `Result<T, E>` and `Option<T>` (slice 4 compact form)', async () => {
      const { mapTsTypeToPython } = await import('../src/type-map.js');

      expect(mapTsTypeToPython('Result<User, ParseError>')).toBe('Result[User, ParseError]');
      expect(mapTsTypeToPython('Option<string>')).toBe('Option[str]');
      // Nested generic in T
      expect(mapTsTypeToPython('Result<list<User>, ParseError>')).toBe('Result[list<User>, ParseError]');
      // Promise<Result<T, E>> → Result[T, E] (Promise stripped, then Result mapped)
      expect(mapTsTypeToPython('Promise<Result<User, ParseError>>')).toBe('Result[User, ParseError]');
    });
  });

  // ── Slice 4 — Python stdlib preamble ─────────────────────────────────

  describe('Python stdlib preamble', () => {
    test('emits empty preamble when neither Result nor Option used', async () => {
      const { pythonStdlibPreamble } = await import('../src/python-stdlib-preamble.js');
      expect(pythonStdlibPreamble({ result: false, option: false })).toEqual([]);
    });

    test('emits Result + TypeAlias when result=true', async () => {
      const { pythonStdlibPreamble } = await import('../src/python-stdlib-preamble.js');
      const out = pythonStdlibPreamble({ result: true, option: false }).join('\n');
      expect(out).toContain('class Ok(Generic[_T_kern]):');
      expect(out).toContain('class Err(Generic[_E_kern]):');
      expect(out).toContain('Result: TypeAlias = Union[Ok[_T_kern], Err[_E_kern]]');
      expect(out).not.toContain('class Some(');
      expect(out).not.toContain('class None_');
    });

    test('emits Option + TypeAlias when option=true', async () => {
      const { pythonStdlibPreamble } = await import('../src/python-stdlib-preamble.js');
      const out = pythonStdlibPreamble({ result: false, option: true }).join('\n');
      expect(out).toContain('class Some(Generic[_T_kern]):');
      expect(out).toContain('class None_:');
      expect(out).toContain('Option: TypeAlias = Union[Some[_T_kern], None_]');
      expect(out).not.toContain('class Ok(');
    });

    test('emits BOTH Result and Option when both used', async () => {
      const { pythonStdlibPreamble } = await import('../src/python-stdlib-preamble.js');
      const out = pythonStdlibPreamble({ result: true, option: true }).join('\n');
      expect(out).toContain('Result: TypeAlias = Union[Ok[_T_kern], Err[_E_kern]]');
      expect(out).toContain('Option: TypeAlias = Union[Some[_T_kern], None_]');
    });

    test('uses frozen=True dataclass (not Optional[T])', async () => {
      const { pythonStdlibPreamble } = await import('../src/python-stdlib-preamble.js');
      const out = pythonStdlibPreamble({ result: true, option: true }).join('\n');
      // Spec: frozen dataclass to keep Some(None) round-trip distinct from None_.
      const frozenCount = out.split('@dataclass(frozen=True)').length - 1;
      expect(frozenCount).toBe(4); // Ok, Err, Some, None_
      expect(out).not.toContain('Optional[');
    });

    test('end-to-end: transpileFastAPI injects preamble + maps Result return', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const root = parse(
        [
          'server name=API port=8000',
          '  fn name=parseUser params="raw:string" returns="Result<User, ParseError>"',
          '    handler <<<',
          '      return Ok(value=raw)',
          '    >>>',
        ].join('\n'),
      );
      const result = transpileFastAPI(root);
      expect(result.code).toContain('from dataclasses import dataclass');
      expect(result.code).toContain('class Ok(Generic[_T_kern]):');
      expect(result.code).toContain('Result: TypeAlias = Union[Ok[_T_kern], Err[_E_kern]]');
      expect(result.code).toContain('-> Result[User, ParseError]');
      // Preamble must come before the user fn definition.
      expect(result.code.indexOf('Result: TypeAlias')).toBeLessThan(result.code.indexOf('def parse_user'));
    });

    test('no preamble when module does not reference Result/Option', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const root = parse(
        [
          'server name=API port=8000',
          '  fn name=greet params="name:string" returns=string',
          '    handler <<<',
          '      return f"hi {name}"',
          '    >>>',
        ].join('\n'),
      );
      const result = transpileFastAPI(root);
      expect(result.code).not.toContain('class Ok(Generic');
      expect(result.code).not.toContain('Result: TypeAlias');
    });
  });

  // ── Python Codegen ───────────────────────────────────────────────────

  describe('Python Codegen', () => {
    test('generates Literal type for type node', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse('type name=PlanState values="draft|approved|running"');
      const lines = generatePythonCoreNode(ast);

      expect(lines.join('\n')).toContain('PlanState = Literal["draft", "approved", "running"]');
    });

    test('generates Pydantic BaseModel for interface node', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(
        'interface name=Track\n  field name=id type=string\n  field name=title type=string\n  field name=duration type=number optional=true',
      );
      const lines = generatePythonCoreNode(ast);
      const output = lines.join('\n');

      expect(output).toContain('class Track(BaseModel):');
      expect(output).toContain('id: str');
      expect(output).toContain('title: str');
      expect(output).toContain('duration: float | None = None');
    });

    test('generates async def for fn node', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(
        'fn name=createTrack params="title:string" returns=Track async=true\n  handler <<<\n    return Track(title=title)\n  >>>',
      );
      const lines = generatePythonCoreNode(ast);
      const output = lines.join('\n');

      expect(output).toContain('async def create_track(title: str) -> Track:');
      expect(output).toContain('return Track(title=title)');
    });

    // ─── Slice 3c P2 follow-up: target-neutral param-list builder ──────────

    test('reads structured param children (slice 3c canonical form)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(
        [
          'fn name=createTrack returns=Track async=true',
          '  param name=title type=string',
          '  param name=duration type=number value=120',
          '  handler <<<',
          '    return Track(title=title, duration=duration)',
          '  >>>',
        ].join('\n'),
      );
      const output = generatePythonCoreNode(ast).join('\n');
      expect(output).toContain('async def create_track(title: str, duration: float = 120) -> Track:');
    });

    test('emits *args for variadic param children', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(
        [
          'fn name=concat returns=string',
          '  param name=parts type="string[]" variadic=true',
          '  handler <<<',
          '    return ",".join(parts)',
          '  >>>',
        ].join('\n'),
      );
      const output = generatePythonCoreNode(ast).join('\n');
      // Variadic strips trailing `[]` so the type is the element type, not the array.
      expect(output).toContain('def concat(*parts: str) -> str:');
    });

    test('emits `T | None = None` for optional param children without defaults', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(
        [
          'fn name=greet returns=string',
          '  param name=salutation type=string optional=true',
          '  handler <<<',
          '    return salutation or "hi"',
          '  >>>',
        ].join('\n'),
      );
      const output = generatePythonCoreNode(ast).join('\n');
      // Codex review fix: PEP-604 union over `Optional[T]` to avoid
      // requiring `from typing import Optional` (not auto-imported here).
      expect(output).toContain('def greet(salutation: str | None = None) -> str:');
    });

    test('translates JS literal defaults (true/false/null) to Python equivalents', async () => {
      // Codex review fix: bare `value=true` etc. used to emit `= true` raw,
      // which fails Python's import-time evaluation (`NameError`). Now
      // translated to `True`/`False`/`None`.
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(
        [
          'fn name=run returns=string',
          '  param name=enabled type=boolean value=true',
          '  param name=quiet type=boolean value=false',
          '  param name=tag type=string value=null',
          '  handler <<<',
          '    return tag or "default"',
          '  >>>',
        ].join('\n'),
      );
      const output = generatePythonCoreNode(ast).join('\n');
      expect(output).toContain('enabled: bool = True');
      expect(output).toContain('quiet: bool = False');
      expect(output).toContain('tag: str = None');
      expect(output).not.toContain('= true');
      expect(output).not.toContain('= false');
      expect(output).not.toContain('= null');
    });

    test('skips destructured params (no Python equivalent)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(
        [
          'fn name=length returns=number',
          '  param type="Point"',
          '    binding name=x',
          '    binding name=y',
          '  handler <<<',
          '    return math.hypot(x, y)',
          '  >>>',
        ].join('\n'),
      );
      const output = generatePythonCoreNode(ast).join('\n');
      // Destructured param is skipped — function takes no positional args.
      // Caller is expected to unpack inside the body; Python has no native
      // destructured-param syntax.
      expect(output).toContain('def length() -> float:');
    });

    test('legacy params="..." string still works (back-compat)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(
        'fn name=add params="a:number,b:number" returns=number\n  handler <<<\n    return a + b\n  >>>',
      );
      const output = generatePythonCoreNode(ast).join('\n');
      expect(output).toContain('def add(a: float, b: float) -> float:');
    });

    test('generates Exception class for error node', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse('error name=NotFoundError');
      const lines = generatePythonCoreNode(ast);
      const output = lines.join('\n');

      expect(output).toContain('class NotFoundError(Exception):');
      expect(output).toContain('def __init__(self, message: str):');
      expect(output).toContain('super().__init__(message)');
    });

    test('generates Enum + transition functions for machine node', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(
        [
          'machine name=Plan',
          '  state name=draft initial=true',
          '  state name=approved',
          '  state name=cancelled',
          '  transition name=approve from=draft to=approved',
          '  transition name=cancel from="draft|approved" to=cancelled',
        ].join('\n'),
      );
      const lines = generatePythonCoreNode(ast);
      const output = lines.join('\n');

      expect(output).toContain('class PlanState(str, Enum):');
      expect(output).toContain('DRAFT = "draft"');
      expect(output).toContain('APPROVED = "approved"');
      expect(output).toContain('class PlanStateError(Exception):');
      expect(output).toContain('def approve_plan(entity: dict) -> dict:');
      expect(output).toContain('if entity["state"] != "draft":');
      expect(output).toContain('return {**entity, "state": "approved"}');
      expect(output).toContain('def cancel_plan(entity: dict) -> dict:');
      expect(output).toContain('valid_states = ["draft", "approved"]');
    });

    test('generates const with type annotation', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse('const name=MAX_RETRIES type=number value=3');
      const lines = generatePythonCoreNode(ast);

      expect(lines.join('\n')).toContain('MAX_RETRIES: float = 3');
    });

    test('generates Pydantic BaseSettings for config node', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(
        'config name=AppConfig\n  field name=timeout type=number default=120\n  field name=debugMode type=boolean default=false',
      );
      const lines = generatePythonCoreNode(ast);
      const output = lines.join('\n');

      expect(output).toContain('class AppConfig(BaseSettings):');
      expect(output).toContain('timeout: float = 120');
      expect(output).toContain('debug_mode: bool = false');
    });

    test('generates pathlib CRUD for store node', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse('store name=Plan path="~/.agon/plans" key=id');
      const lines = generatePythonCoreNode(ast);
      const output = lines.join('\n');

      expect(output).toContain('from pathlib import Path');
      expect(output).toContain('PLAN_DIR = Path.home() / ".agon/plans"');
      expect(output).toContain('def save_plan(item: dict) -> None:');
      expect(output).toContain('def load_plan(id: str) -> dict | None:');
      expect(output).toContain('def list_plans(limit: int = 20) -> list[dict]:');
      expect(output).toContain('def delete_plan(id: str) -> bool:');
    });

    test('generates pytest class for test node', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(
        'test name="Plan Transitions"\n  describe name=approve\n    it name="transitions draft to approved"\n      handler <<<\n        assert True\n      >>>',
      );
      const lines = generatePythonCoreNode(ast);
      const output = lines.join('\n');

      expect(output).toContain('import pytest');
      expect(output).toContain('class TestPlanTransitions:');
      expect(output).toContain('class Testapprove:');
      expect(output).toContain('def test_transitions_draft_to_approved(self):');
    });

    test('generates Literal + TypedDict for event node', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse('event name=TrackEvent\n  type name="track:created"\n  type name="track:deleted"');
      const lines = generatePythonCoreNode(ast);
      const output = lines.join('\n');

      expect(output).toContain('TrackEventType = Literal["track:created", "track:deleted"]');
      expect(output).toContain('class TrackEvent(TypedDict):');
    });

    test('generates Python import statement', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse('import from=pathlib names=Path');
      const lines = generatePythonCoreNode(ast);

      expect(lines.join('\n')).toContain('from pathlib import Path');
    });

    test('generates Python use/from import for a relative .kern module', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(['use path="./helpers/parse-user.kern"', '  from name=parseUser as=parse_user'].join('\n'));
      const lines = generatePythonCoreNode(ast);

      expect(lines.join('\n')).toBe('from .helpers.parse_user import parseUser as parse_user');
    });

    test('uses planned Python module names for relative KERN imports', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(['use path="./json.kern"', '  from name=parseUser kind=fn'].join('\n'));
      const lines = generatePythonCoreNode(ast, {
        resolveKernModuleSpec: (rawPath) => (rawPath === './json.kern' ? '.json_' : undefined),
      });

      expect(lines.join('\n')).toBe('from .json_ import parse_user as parseUser');
    });

    test('uses planned Python module names for extensionless relative KERN imports', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(['use path="./json"', '  from name=parseUser kind=fn'].join('\n'));
      const lines = generatePythonCoreNode(ast, {
        resolveKernModuleSpec: (rawPath) => (rawPath === './json' ? '.json_' : undefined),
      });

      expect(lines.join('\n')).toBe('from .json_ import parse_user as parseUser');
    });

    test('generates Python use/from import with function symbol-kind bridge alias', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(['use path="./helpers.kern"', '  from name=parseUser kind=fn'].join('\n'));
      const lines = generatePythonCoreNode(ast);

      expect(lines.join('\n')).toBe('from .helpers import parse_user as parseUser');
    });

    test('generates Python use/from import from resolved KERN export metadata', async () => {
      const { parseDocumentWithDiagnostics } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const result = parseDocumentWithDiagnostics(
        ['use path="./helpers.kern"', '  from name=parseUser'].join('\n'),
        undefined,
        {
          resolveImport: (path) =>
            path === './helpers.kern'
              ? {
                  symbols: new Map([['parseUser', { name: 'parseUser', kind: 'fn' }]]),
                  resultFns: new Set(),
                  optionFns: new Set(),
                }
              : null,
        },
      );
      const useNode = result.root.children?.[0];
      const lines = useNode ? generatePythonCoreNode(useNode) : [];

      expect(lines.join('\n')).toBe('from .helpers import parse_user as parseUser');
    });

    test('generates Python use/from import with explicit alias over function symbol kind', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(['use path="./helpers.kern"', '  from name=parseUser kind=fn as=parse'].join('\n'));
      const lines = generatePythonCoreNode(ast);

      expect(lines.join('\n')).toBe('from .helpers import parse_user as parse');
    });

    test('keeps class/type symbol-kind imports in source spelling', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(['use path="./models.kern"', '  from name=UserProfile kind=class'].join('\n'));
      const lines = generatePythonCoreNode(ast);

      expect(lines.join('\n')).toBe('from .models import UserProfile');
    });

    test('generates Python side-effect import for a relative .kern module', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse('use path="./setup.kern"');
      const lines = generatePythonCoreNode(ast);

      expect(lines.join('\n')).toBe('from . import setup');
    });

    test('generates Python module with re-export imports and inline definitions', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(
        [
          'module name=auth',
          '  export from="./roles.kern" names="Role,hasRole"',
          '  fn name=checkRole params="role:string" returns=boolean',
          '    handler <<<',
          '      return role == "admin"',
          '    >>>',
        ].join('\n'),
      );
      const output = generatePythonCoreNode(ast).join('\n');

      expect(output).toContain('# -- Module: auth --');
      expect(output).toContain('from .roles import Role, hasRole');
      expect(output).toContain('def check_role(role: str) -> bool:');
    });
  });

  // ── Model & Union ────────────────────────────────────────────────────

  describe('Model & Union', () => {
    test('generates SQLModel class for model node', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonModel } = await import('../src/codegen-python.js');

      const ast = parse(
        [
          'model name=User table=users',
          '  column name=id type=uuid primary=true',
          '  column name=email type=string unique=true',
          '  column name=bio type=text nullable=true',
        ].join('\n'),
      );
      const output = generatePythonModel(ast).join('\n');

      expect(output).toContain('class User(SQLModel, table=True):');
      expect(output).toContain('__tablename__ = "users"');
      expect(output).toContain('id: UUID = Field(primary_key=True)');
      expect(output).toContain('email: str = Field(unique=True)');
      expect(output).toContain('bio: str | None');
    });

    test('generates SQLModel with relations', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonModel } = await import('../src/codegen-python.js');

      const ast = parse(
        [
          'model name=User table=users',
          '  column name=id type=uuid primary=true',
          '  relation name=posts target=Post kind=one-to-many',
        ].join('\n'),
      );
      const output = generatePythonModel(ast).join('\n');

      expect(output).toContain('posts: list["Post"] = Relationship(back_populates="user")');
    });

    test('generates SQLModel with default value', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonModel } = await import('../src/codegen-python.js');

      const ast = parse(['model name=Config', '  column name=retries type=int default=3'].join('\n'));
      const output = generatePythonModel(ast).join('\n');

      expect(output).toContain('retries: int = Field(default=3)');
    });

    test('generates discriminated union from union node', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonUnion } = await import('../src/codegen-python.js');

      const ast = parse(
        [
          'union name=Shape discriminant=kind',
          '  variant name=Circle',
          '    field name=radius type=number',
          '  variant name=Square',
          '    field name=side type=number',
        ].join('\n'),
      );
      const output = generatePythonUnion(ast).join('\n');

      expect(output).toContain('class Circle');
      expect(output).toContain('(BaseModel):');
      expect(output).toContain('Literal["Circle"]');
      expect(output).toContain('radius: float');
      expect(output).toContain('class Square');
      expect(output).toContain('side: float');
      expect(output).toContain('Shape = Union[');
    });

    test('model and union dispatch from generatePythonCoreNode', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const modelAst = parse('model name=Item\n  column name=id type=uuid primary=true');
      const modelOutput = generatePythonCoreNode(modelAst).join('\n');
      expect(modelOutput).toContain('class Item(SQLModel, table=True):');

      const unionAst = parse('union name=Event discriminant=type\n  variant name=Click\n    field name=x type=number');
      const unionOutput = generatePythonCoreNode(unionAst).join('\n');
      expect(unionOutput).toContain('Event = Union[');
    });

    test('generates Python repository class', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(
        [
          'repository name=UserRepository model=User',
          '  method name=findByEmail params="email:string" returns="User | null" async=true',
          '    handler <<<',
          '      return await self.session.get(User, email)',
          '    >>>',
        ].join('\n'),
      );
      const output = generatePythonCoreNode(ast).join('\n');

      expect(output).toContain('class UserRepository:');
      expect(output).toContain('def __init__(self, session: AsyncSession):');
      expect(output).toContain('async def find_by_email(self, email: str) -> User | None:');
    });

    test('generates Python cache class', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(
        [
          'cache name=userCache backend=redis prefix="user:" ttl=3600',
          '  entry name=profile key="user:{id}"',
          '  invalidate on=userUpdate tags="user:{id}"',
        ].join('\n'),
      );
      const output = generatePythonCoreNode(ast).join('\n');

      expect(output).toContain('class UserCache:');
      expect(output).toContain('prefix = "user:"');
      expect(output).toContain('ttl = 3600');
      expect(output).toContain('async def get_profile(self, id: str):');
      expect(output).toContain('await redis.get(key)');
      expect(output).toContain('async def invalidate_on_user_update(self, id: str):');
    });

    test('generates Python dependency factory', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(['dependency name=authService scope=singleton', '  inject db from=database'].join('\n'));
      const output = generatePythonCoreNode(ast).join('\n');

      expect(output).toContain('_auth_service_instance = None');
      expect(output).toContain('def create_auth_service()');
      expect(output).toContain('global _auth_service_instance');
      expect(output).toContain('= database');
    });

    test('generates Python service class', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { generatePythonCoreNode } = await import('../src/codegen-python.js');

      const ast = parse(
        [
          'service name=AuthService',
          '  field name=repo type=UserRepository private=true',
          '  method name=findByEmail params="email:string" returns="User | null" async=true',
          '    handler <<<',
          '      return await self._repo.find_by_email(email)',
          '    >>>',
        ].join('\n'),
      );
      const output = generatePythonCoreNode(ast).join('\n');

      expect(output).toContain('class AuthService:');
      expect(output).toContain('def __init__(self, repo: UserRepository):');
      expect(output).toContain('self._repo = repo');
      expect(output).toContain('async def find_by_email(self, email: str) -> User | None:');
    });
  });

  // ── FastAPI Transpiler ────────────────────────────────────────────────

  describe('DB Connection', () => {
    test('generates implicit DB boilerplate when models exist', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'model name=User table=users',
        '  column name=id type=uuid primary=true',
        'server name=Test',
        '  route method=get path=/health',
        '    handler <<<',
        '      return {"status": "ok"}',
        '    >>>',
      ].join('\n');
      const resolvedConfig = resolveConfig({
        target: 'fastapi' as any,
      } as any);
      const config = {
        ...resolvedConfig,
        fastapi: { ...resolvedConfig.fastapi, entryModules: ['users_api'] },
      };
      const result = transpileFastAPI(parse(source), config as any);
      expect(result.code).toContain('create_async_engine');
      expect(result.code).toContain('DATABASE_URL');
      expect(result.code).toContain('async def get_db()');
      expect(result.code).toContain('async def init_db()');
      expect(result.code).toContain('@app.on_event("startup")');
      const envArtifact = result.artifacts?.find((artifact) => artifact.path === 'alembic/env.py');
      expect(envArtifact?.content).toContain('model_modules = ["users_api"]');
      expect(envArtifact?.content).toContain('importlib.import_module(module_name)');
      expect(envArtifact?.content).toContain('header = [next(module_file, "") for _ in range(10)]');
      expect(envArtifact?.content).toContain('except (OSError, UnicodeDecodeError):');
      expect(envArtifact?.content).toContain('if any("@generated by kern" in line.lower() for line in header):');
      expect(envArtifact?.content).toContain('app_dir = Path(__file__).resolve().parents[1]');
      expect(envArtifact?.content).not.toContain('from main import');
      expect(envArtifact?.content).not.toContain('importlib.import_module(module_path.stem)');
      const alembicConfig = result.artifacts?.find((artifact) => artifact.path === 'alembic.ini');
      expect(alembicConfig?.content).toContain('sqlalchemy.url = sqlite:///./app.db');
    });
  });

  describe('Server Generation', () => {
    test('generates FastAPI main.py with routes and middleware', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const source = [
        'server name=TestAPI port=8080',
        '  middleware name=cors',
        '  route method=get path=/health',
        '    handler <<<',
        '      return {"status": "ok"}',
        '    >>>',
        '  route method=post path=/tracks',
        '    handler <<<',
        '      return {"created": True}',
        '    >>>',
      ].join('\n');

      const result = transpileFastAPI(parse(source));

      expect(result.code).toContain('from fastapi import FastAPI');
      expect(result.code).toContain('from fastapi.responses import JSONResponse');
      expect(result.code).toContain('import uvicorn');
      expect(result.code).toContain('app = FastAPI(title="TestAPI")');
      expect(result.code).toContain('CORSMiddleware');
      expect(result.code).toContain('app.include_router(');
      expect(result.code).toContain('port=8080');
      expect(result.code).toContain('host=os.environ.get("HOST", "127.0.0.1")');
      expect(result.code).not.toContain('host="0.0.0.0"');
      expect(result.artifacts).toBeDefined();
      expect(result.artifacts!.length).toBeGreaterThanOrEqual(3);
      expect(result.artifacts!.some((a) => a.path === 'routes/__init__.py')).toBe(true);
      expect(result.artifacts!.some((a) => a.path.endsWith('.py'))).toBe(true);
    });

    test('route artifacts contain APIRouter and correct path conversion', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const source = [
        'server name=Test',
        '  route method=get path=/tracks/:id',
        '    handler <<<',
        '      return {"id": id}',
        '    >>>',
      ].join('\n');

      const result = transpileFastAPI(parse(source));
      const routeArtifact = result.artifacts?.find((a) => a.type === 'route');

      expect(routeArtifact).toBeDefined();
      expect(routeArtifact!.content).toContain('from fastapi import APIRouter');
      expect(routeArtifact!.content).toContain('router = APIRouter()');
      // :id → {id}
      expect(routeArtifact!.content).toContain('{id}');
      expect(routeArtifact!.content).not.toContain(':id');
      expect(routeArtifact!.content).toContain('id: str');
    });

    test('route artifacts lower simple Express-style JSON handlers to Python', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const source = [
        'server name=Test',
        '  route method=get path=/health',
        '    handler <<<',
        "      res.json({ ok: true, version: '0.1.0', service: 'agon-saas-api', message: 'true false null' });",
        '    >>>',
        '  route method=post path=/users',
        '    handler <<<',
        '      res.status(201).json({ id: "u1", active: false });',
        '    >>>',
      ].join('\n');

      const result = transpileFastAPI(parse(source));
      const healthRoute = result.artifacts?.find((a) => a.path === 'routes/get_health.py');
      const postRoute = result.artifacts?.find((a) => a.path === 'routes/post_users.py');

      expect(healthRoute?.content).toContain(
        'return { "ok": True, "version": \'0.1.0\', "service": \'agon-saas-api\', "message": \'true false null\' }',
      );
      expect(healthRoute?.content).not.toContain('res.json');
      expect(postRoute?.content).toContain('from fastapi.responses import JSONResponse');
      expect(postRoute?.content).toContain(
        'return JSONResponse(content={ "id": "u1", "active": False }, status_code=201)',
      );
    });

    test('unsupported raw JavaScript handlers emit valid Python stubs', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const source = [
        'server name=Test',
        '  route method=get path=/send',
        '    handler <<<',
        "      res.send('ok');",
        '    >>>',
        '  route method=get path=/shorthand',
        '    handler <<<',
        '      res.json({ user });',
        '    >>>',
        '  route method=get path=/template',
        '    handler <<<',
        '      res.json({ msg: `hi ${name}` });',
        '    >>>',
      ].join('\n');

      const result = transpileFastAPI(parse(source));
      for (const path of ['routes/get_send.py', 'routes/get_shorthand.py', 'routes/get_template.py']) {
        const route = result.artifacts?.find((a) => a.path === path);
        expect(route?.content).toContain(
          'raise NotImplementedError("Unsupported raw JavaScript handler syntax for FastAPI target")',
        );
        expect(route?.content).not.toContain('res.');
        expect(route?.content).not.toContain('`');
      }
    });

    test('strict mode generates sanitized error handler', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const ast = parse(
        'server name=Test\n  route method=get path=/health\n    handler <<<\n      return {"ok": True}\n    >>>',
      );
      const result = transpileFastAPI(ast);

      expect(result.code).toContain('Internal Server Error');
      expect(result.code).not.toContain('str(exc)');
      expect(result.code).not.toContain('    from fastapi.responses import JSONResponse');
    });

    test('relaxed mode generates verbose error handler', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const config = resolveConfig({ target: 'fastapi' as any, fastapi: { security: 'relaxed' } } as any);
      const ast = parse(
        'server name=Test\n  route method=get path=/health\n    handler <<<\n      return {"ok": True}\n    >>>',
      );
      const result = transpileFastAPI(ast, config);

      expect(result.code).toContain('str(exc)');
    });

    test('strict mode hardens auth, cors, websocket parsing, health checks, and exception logging', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const config = resolveConfig({ target: 'fastapi' as any, fastapi: { cors: true } } as any);
      const source = [
        'server name=Test',
        '  route GET /api/private',
        '    auth optional',
        '    handler <<<',
        '      return {"ok": True}',
        '    >>>',
        '  websocket path=/ws',
        '    on event=message',
        '      handler <<<',
        '        await websocket.send_json(data)',
        '      >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source), config);
      const authArtifact = result.artifacts?.find((a) => a.path === 'auth.py');
      const wsArtifact = result.artifacts?.find((a) => a.type === 'websocket');

      expect(result.code).toContain('import logging');
      expect(result.code).toContain('import os');
      expect(result.code).toContain(
        'allow_origins=[origin.strip() for origin in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",") if origin.strip()]',
      );
      expect(result.code).toContain('allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]');
      expect(result.code).toContain('allow_headers=["Authorization", "Content-Type", "X-Request-ID"]');
      expect(result.code).not.toContain('allow_methods=["*"]');
      expect(result.code).not.toContain('allow_headers=["*"]');
      expect(result.code).toContain('@app.get("/health")');
      expect(result.code).toContain('logging.exception("Unhandled exception")');
      expect(authArtifact?.content).toContain('JWT_SECRET = os.environ.get("JWT_SECRET")');
      expect(authArtifact?.content).toContain(
        'raise RuntimeError("JWT_SECRET environment variable is required in strict mode")',
      );
      expect(authArtifact?.content).toContain('security_optional = HTTPBearer(auto_error=False)');
      expect(authArtifact?.content).toContain('Depends(security_optional)');
      expect(wsArtifact?.content).toContain('import json');
      expect(wsArtifact?.content).toContain('data = json.loads(await websocket.receive_text())');
      expect(wsArtifact?.content).toContain('except json.JSONDecodeError:');
    });

    test('relaxed CORS remains permissive without wildcard credentials', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const config = resolveConfig({
        target: 'fastapi' as any,
        fastapi: { security: 'relaxed', cors: true },
      } as any);
      const result = transpileFastAPI(parse('server name=Test'), config);

      expect(result.code).toContain('os.environ.get("CORS_ORIGINS", "*")');
      expect(result.code).toContain('allow_credentials=False');
      expect(result.code).toContain('allow_methods=["*"]');
      expect(result.code).toContain('allow_headers=["*"]');
      expect(result.code).not.toContain('allow_credentials=True, allow_methods=["*"]');
    });

    test('reload uses uvicorn string app path', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const config = resolveConfig({
        target: 'fastapi' as any,
        fastapi: { security: 'relaxed', uvicorn: { reload: true } },
      } as any);
      const ast = parse(
        'server name=Test\n  route method=get path=/health\n    handler <<<\n      return {"ok": True}\n    >>>',
      );
      const result = transpileFastAPI(ast, config);

      expect(result.code).toContain('from pathlib import Path');
      expect(result.code).toContain('import sys');
      expect(result.code).toContain('sys.path.insert(0, script_dir)');
      expect(result.code).toContain('uvicorn_app = f"{Path(__file__).stem}:app"');
      expect(result.code).toContain('uvicorn.run(uvicorn_app');
      expect(result.code).toContain('app_dir=script_dir');
      expect(result.code).not.toContain('"main:app"');
      expect(result.code).toContain('reload=True');
    });

    test('workers use dynamic uvicorn string app path', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const config = resolveConfig({
        target: 'fastapi' as any,
        fastapi: { security: 'relaxed', uvicorn: { workers: 2 } },
      } as any);
      const defaultResult = transpileFastAPI(parse('server name=Test'));
      const configured = transpileFastAPI(parse('server name=Test'), config);

      expect(defaultResult.code).not.toContain('from pathlib import Path');
      expect(defaultResult.code).not.toContain('import sys');
      expect(configured.code).toContain('from pathlib import Path');
      expect(configured.code).toContain('import sys');
      expect(configured.code).toContain('sys.path.insert(0, script_dir)');
      expect(configured.code).toContain('uvicorn_app = f"{Path(__file__).stem}:app"');
      expect(configured.code).toContain('uvicorn.run(uvicorn_app');
      expect(configured.code).toContain('app_dir=script_dir');
      expect(configured.code).toContain('workers=2');
    });

    test('custom middleware generates BaseHTTPMiddleware artifact', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const source = [
        'server name=Test',
        '  middleware name=auth',
        '    handler <<<',
        '      response = await call_next(request)',
        '      return response',
        '    >>>',
        '  route method=get path=/health',
        '    handler <<<',
        '      return {"ok": True}',
        '    >>>',
      ].join('\n');

      const result = transpileFastAPI(parse(source));
      const mwArtifact = result.artifacts?.find((a) => a.type === 'middleware');

      expect(mwArtifact).toBeDefined();
      expect(result.artifacts?.some((a) => a.path === 'middleware/__init__.py')).toBe(true);
      expect(mwArtifact!.path).toBe('middleware/auth.py');
      expect(mwArtifact!.content).toContain('BaseHTTPMiddleware');
      expect(mwArtifact!.content).toContain('class AuthMiddleware');
    });

    test('generates Pydantic schema model for body schema', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const source = [
        'server name=Test',
        '  route method=post path=/tracks',
        '    schema body="{title: string, duration: number}"',
        '    handler <<<',
        '      return {"ok": True}',
        '    >>>',
      ].join('\n');

      const result = transpileFastAPI(parse(source));
      const routeArtifact = result.artifacts?.find((a) => a.type === 'route');

      expect(routeArtifact!.content).toContain('from pydantic import BaseModel');
      expect(routeArtifact!.content).toContain('class RequestBody(BaseModel):');
      expect(routeArtifact!.content).toContain('title: str');
      expect(routeArtifact!.content).toContain('duration: float');
      expect(routeArtifact!.content).toContain('body: RequestBody');
    });
  });

  // ── Stream/Spawn/Timer ────────────────────────────────────────────────

  describe('Stream/Spawn/Timer', () => {
    test('stream route generates StreamingResponse', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const ast = parse(
        'server name=Test\n  route method=post path=/api/stream\n    stream\n      handler <<<\n        yield f"data: ping\\n\\n"\n      >>>',
      );
      const result = transpileFastAPI(ast);
      const route = result.artifacts!.find((a) => a.type === 'route');

      expect(route).toBeDefined();
      expect(route!.content).toContain('StreamingResponse');
      expect(route!.content).toContain('event_generator');
      expect(route!.content).toContain('text/event-stream');
    });

    test('timer route generates asyncio.wait_for', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const ast = parse(
        'server name=Test\n  route method=post path=/api/test\n    timer 15\n      handler <<<\n        result = await do_work()\n        return result\n      >>>',
      );
      const result = transpileFastAPI(ast);
      const route = result.artifacts!.find((a) => a.type === 'route');

      expect(route!.content).toContain('asyncio.wait_for');
      expect(route!.content).toContain('timeout=15');
      expect(route!.content).toContain('408');
      expect(route!.content).toContain('Request timed out');
    });

    test('spawn generates asyncio.create_subprocess_exec', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const ast = parse(
        "server name=Test\n  route method=post path=/api/run\n    stream\n      spawn binary=python args=['-c','print(42)']\n        on name=stdout\n          handler <<<\n            yield f\"data: {chunk.decode()}\\n\\n\"\n          >>>",
      );
      const result = transpileFastAPI(ast);
      const route = result.artifacts!.find((a) => a.type === 'route');

      expect(route!.content).toContain('asyncio.create_subprocess_exec');
      expect(route!.content).toContain('"python"');
      expect(route!.content).toContain('stdout=asyncio.subprocess.PIPE');
    });
  });

  // ── WebSocket ────────────────────────────────────────────────────────

  describe('WebSocket', () => {
    test('generates websocket endpoint with connect/message/disconnect handlers', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const source = [
        'server name=ChatAPI port=8000',
        '  websocket path=/ws/chat',
        '    on event=connect',
        '      handler <<<await websocket.send_json({"type": "welcome"})>>>',
        '    on event=message',
        '      handler <<<',
        '        await broadcast(data)',
        '      >>>',
        '    on event=disconnect',
        '      handler <<<print("client left")>>>',
      ].join('\n');

      const result = transpileFastAPI(parse(source));

      // main.py should import WebSocket types and mount the ws endpoint
      expect(result.code).toContain('from fastapi import WebSocket');
      expect(result.code).toContain('from starlette.websockets import WebSocketDisconnect');
      expect(result.code).toContain('app.websocket("/ws/chat")');

      // Should have a websocket artifact
      const wsArtifact = result.artifacts?.find((a) => a.type === 'websocket');
      expect(wsArtifact).toBeDefined();
      expect(wsArtifact!.path).toContain('ws/');
      expect(wsArtifact!.path.endsWith('.py')).toBe(true);

      // Artifact content should have the websocket handler structure
      const content = wsArtifact!.content;
      expect(content).toContain('async def websocket_');
      expect(content).toContain('websocket: WebSocket');
      expect(content).toContain('await websocket.accept()');
      expect(content).toContain('await websocket.send_json({"type": "welcome"})');
      expect(content).toContain('while True:');
      expect(content).toContain('data = json.loads(await websocket.receive_text())');
      expect(content).toContain('await broadcast(data)');
      expect(content).toContain('except WebSocketDisconnect:');
      expect(content).toContain('print("client left")');
    });

    test('websocket with only message handler generates correct structure', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const source = [
        'server name=EchoAPI port=9000',
        '  websocket path=/ws/echo',
        '    on event=message',
        '      handler <<<',
        '        await websocket.send_json(data)',
        '      >>>',
      ].join('\n');

      const result = transpileFastAPI(parse(source));
      const wsArtifact = result.artifacts?.find((a) => a.type === 'websocket');

      expect(wsArtifact).toBeDefined();
      const content = wsArtifact!.content;
      expect(content).toContain('await websocket.accept()');
      expect(content).toContain('await websocket.send_json(data)');
      // disconnect handler should have 'pass' fallback
      expect(content).toContain('except WebSocketDisconnect:');
      expect(content).toContain('pass');
    });

    test('websocket artifacts coexist with route artifacts', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const source = [
        'server name=HybridAPI port=8000',
        '  route method=get path=/health',
        '    handler <<<return {"status": "ok"}>>>',
        '  websocket path=/ws/live',
        '    on event=message',
        '      handler <<<await websocket.send_json(data)>>>',
      ].join('\n');

      const result = transpileFastAPI(parse(source));

      const routeArtifacts = result.artifacts?.filter((a) => a.type === 'route') || [];
      const wsArtifacts = result.artifacts?.filter((a) => a.type === 'websocket') || [];

      expect(routeArtifacts.length).toBe(1);
      expect(wsArtifacts.length).toBe(1);
      expect(result.artifacts?.some((a) => a.path === 'routes/__init__.py')).toBe(true);
      expect(result.artifacts?.some((a) => a.path === 'ws/__init__.py')).toBe(true);
      expect(result.code).toContain('app.include_router(');
      expect(result.code).toContain('app.websocket("/ws/live")');
    });
  });

  // ── Token Metrics ─────────────────────────────────────────────────────

  test('reports token metrics', async () => {
    const { parse } = await import('../../core/src/parser.js');
    const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

    const ast = parse(
      'server name=Test\n  route method=get path=/health\n    handler <<<\n      return {"ok": True}\n    >>>',
    );
    const result = transpileFastAPI(ast);

    expect(result.irTokenCount).toBeGreaterThan(0);
    expect(result.tsTokenCount).toBeGreaterThan(0);
    expect(typeof result.tokenReduction).toBe('number');
  });

  // ── Route v3 — framework-agnostic syntax ────────────────────────────

  describe('Route v3 — framework-agnostic syntax', () => {
    test('route GET /path parses positional verb and path', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    handler <<<',
        '      return {"users": []}',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route).toBeDefined();
      expect(route!.content).toContain('@router.get("/api/users")');
    });

    test('params generates typed function parameters with defaults', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    params page:number = 1, limit:number = 20',
        '    handler <<<',
        '      return {"page": page, "limit": limit}',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('page: int = 1');
      expect(route!.content).toContain('limit: int = 20');
    });

    test('auth required adds Depends(auth_required)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route POST /api/users',
        '    auth required',
        '    handler <<<',
        '      return {"ok": True}',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('Depends(auth_required)');
      expect(route!.content).toContain('from fastapi import Depends');
    });

    test('auth optional adds Depends(auth_optional)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/public',
        '    auth optional',
        '    handler <<<',
        '      return {"ok": True}',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('Depends(auth_optional)');
    });

    test('validate adds schema as function parameter', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route POST /api/users',
        '    validate CreateUserSchema',
        '    handler <<<',
        '      return {"ok": True}',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('body: CreateUserSchema');
    });

    test('error nodes add docstring error contract', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    handler <<<',
        '      return []',
        '    >>>',
        '    error 401 "Unauthorized"',
        '    error 500 "Server error"',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('Errors:');
      expect(route!.content).toContain('401');
      expect(route!.content).toContain('500');
    });

    test('full v3 route example compiles end-to-end', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = readFileSync(resolve(ROOT, 'examples/route-v3.kern'), 'utf-8');
      const result = transpileFastAPI(parse(source));

      expect(result.code).toContain('FastAPI');
      expect(result.artifacts!.length).toBeGreaterThanOrEqual(4);

      const getUsersRoute = result.artifacts!.find((a: any) => a.path.includes('get_api_users'));
      expect(getUsersRoute).toBeDefined();
      expect(getUsersRoute!.content).toContain('page: int = 1');
      expect(getUsersRoute!.content).toContain('limit: int = 20');
      expect(getUsersRoute!.content).toContain('Depends(auth_required)');
      // Route-level middleware should also be present as Depends
      expect(getUsersRoute!.content).toContain('Depends(rate_limit)');
      expect(getUsersRoute!.content).toContain('Depends(cors)');
    });

    test('backward compat: old route method=get path=/ still works', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route method=get path=/api/health',
        '    handler <<<',
        '      return {"ok": True}',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route).toBeDefined();
      expect(route!.content).toContain('@router.get("/api/health")');
    });

    test('params with string type generates str parameter', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/search',
        '    params q:string, sort:string = "relevance"',
        '    handler <<<',
        '      return {"q": q}',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('q: str');
      expect(route!.content).toContain('sort: str = "relevance"');
    });

    test('route-level middleware emits Depends()', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    middleware rateLimit, cors',
        '    handler <<<',
        '      return []',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('Depends(rate_limit)');
      expect(route!.content).toContain('Depends(cors)');
      expect(route!.content).toContain('from fastapi import Depends');
    });

    test('validate on GET uses Depends, not body param', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    validate UserQuerySchema',
        '    handler <<<',
        '      return []',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      // GET route should NOT have body param
      expect(route!.content).not.toContain('body: UserQuerySchema');
      // Should use Depends instead
      expect(route!.content).toContain('Depends(user_query_schema)');
    });

    test('validate on POST uses body param', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route POST /api/users',
        '    validate CreateUserSchema',
        '    handler <<<',
        '      return {"ok": True}',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('body: CreateUserSchema');
      expect(route!.content).not.toContain('Depends(create_user_schema)');
    });

    test('validate does not duplicate body when schema body= is present', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route POST /api/users',
        '    schema body="{name: string}"',
        '    validate CreateUserSchema',
        '    handler <<<',
        '      return {"ok": True}',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      // schema body= takes priority — only one body param
      const bodyCount = (route!.content.match(/body:/g) || []).length;
      expect(bodyCount).toBe(1);
    });
  });

  // ── Portable Backend — respond, derive, guard ──────────────────────

  describe('Portable Backend — respond, derive, guard', () => {
    test('respond 200 json=data generates return data', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = ['server name=Test', '  route GET /api/users', '    respond 200 json=users'].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('return users');
    });

    test('respond 201 json=user generates JSONResponse with status', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = ['server name=Test', '  route POST /api/users', '    respond 201 json=user'].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('JSONResponse(content=user, status_code=201)');
      expect(route!.content).toContain('from fastapi.responses import JSONResponse');
    });

    test('respond 204 generates Response(status_code=204)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = ['server name=Test', '  route DELETE /api/users/:id', '    respond 204'].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('Response(status_code=204)');
      expect(route!.content).toContain('from fastapi.responses import Response');
    });

    test('respond 404 error="Not found" generates HTTPException', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = ['server name=Test', '  route GET /api/users/:id', '    respond 404 error="Not found"'].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('raise HTTPException(status_code=404, detail="Not found")');
    });

    test('respond redirect="/login" generates RedirectResponse', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = ['server name=Test', '  route GET /login', '    respond redirect="/login"'].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('RedirectResponse(url="/login")');
      expect(route!.content).toContain('from fastapi.responses import RedirectResponse');
    });

    test('respond 200 text=result generates PlainTextResponse', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = ['server name=Test', '  route GET /api/text', '    respond 200 text=result'].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('PlainTextResponse(content=result)');
      expect(route!.content).toContain('from fastapi.responses import PlainTextResponse');
    });

    test('derive generates variable binding', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    derive users expr={{await db.query("SELECT * FROM users")}}',
        '    respond 200 json=users',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('users = await db.query("SELECT * FROM users")');
      expect(route!.content).toContain('return users');
    });

    test('guard generates early-return check', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/users/:id',
        '    derive user expr={{await db.findById(params.id)}}',
        '    guard name=exists expr={{user}} else=404',
        '    respond 200 json=user',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      // params.id → id (function param in FastAPI)
      expect(route!.content).toContain('await db.findById(id)');
      expect(route!.content).toContain('if not (user):');
      expect(route!.content).toContain('raise HTTPException(status_code=404');
      expect(route!.content).toContain('return user');
    });

    test('portable request refs: params/body/headers rewritten for FastAPI', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route POST /api/users/:id',
        '    derive user expr={{await db.findById(params.id)}}',
        '    derive token expr={{headers.authorization}}',
        '    respond 200 json=user',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      // params.id → id (function param)
      expect(route!.content).toContain('await db.findById(id)');
      // headers.X → request.headers.get("X")
      expect(route!.content).toContain('request.headers.get("authorization")');
    });

    test('handler + respond coexist (escape hatch pattern)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route POST /api/tracks/analyze',
        '    handler <<<',
        '      result = await analyze_audio(body.track_id)',
        '    >>>',
        '    respond 200 json=result',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('analyze_audio(body.track_id)');
      expect(route!.content).toContain('return result');
    });

    test('derive + guard + handler + respond execution order', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route POST /api/tracks/:id/analyze',
        '    derive track expr={{await db.tracks.find_by_id(params.id)}}',
        '    guard name=trackExists expr={{track}} else=404',
        '    handler <<<',
        '      result = await analyze_audio_fft(track.audio_path)',
        '    >>>',
        '    respond 200 json=result',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;

      // Verify execution order
      const deriveIdx = content.indexOf('track = ');
      const guardIdx = content.indexOf('if not (track)');
      const handlerIdx = content.indexOf('analyze_audio_fft');
      const respondIdx = content.indexOf('return result');

      expect(deriveIdx).toBeGreaterThan(-1);
      expect(guardIdx).toBeGreaterThan(deriveIdx);
      expect(handlerIdx).toBeGreaterThan(guardIdx);
      expect(respondIdx).toBeGreaterThan(handlerIdx);
    });

    test('full v3 portable route example compiles end-to-end', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = readFileSync(resolve(ROOT, 'examples/route-v3.kern'), 'utf-8');
      const result = transpileFastAPI(parse(source));

      // Portable POST route
      const postRoute = result.artifacts!.find((a: any) => a.path.includes('post_api_users'));
      expect(postRoute).toBeDefined();
      expect(postRoute!.content).toContain('user = ');
      expect(postRoute!.content).toContain('JSONResponse(content=user, status_code=201)');

      // Portable GET :id route
      const getIdRoute = result.artifacts!.find((a: any) => a.path.includes('get_api_users_id'));
      expect(getIdRoute).toBeDefined();
      expect(getIdRoute!.content).toContain('user = ');
      expect(getIdRoute!.content).toContain('if not (user)');
      expect(getIdRoute!.content).toContain('return user');

      // Portable DELETE route
      const deleteRoute = result.artifacts!.find((a: any) => a.path.includes('delete_api_users_id'));
      expect(deleteRoute).toBeDefined();
      expect(deleteRoute!.content).toContain('Response(status_code=204)');
    });

    test('bilingual: same .kern compiles to matching Express AND FastAPI', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileExpress } = await import('../../express/src/transpiler-express.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test port=3000',
        '  route GET /api/users/:id',
        '    derive user expr={{await db.findById(params.id)}}',
        '    guard name=exists expr={{user}} else=404',
        '    respond 200 json=user',
        '  route POST /api/users',
        '    auth required',
        '    validate CreateUserSchema',
        '    derive user expr={{await db.create(body)}}',
        '    respond 201 json=user',
        '  route DELETE /api/users/:id',
        '    auth required',
        '    respond 204',
      ].join('\n');
      const ast = parse(source);
      const expressResult = transpileExpress(ast);
      const fastapiResult = transpileFastAPI(ast);

      // Both produce 3 route artifacts
      const expressRoutes = expressResult.artifacts!.filter((a) => a.type === 'route');
      const fastapiRoutes = fastapiResult.artifacts!.filter((a) => a.type === 'route');
      expect(expressRoutes.length).toBe(3);
      expect(fastapiRoutes.length).toBe(3);

      // GET :id — both have derive, guard, respond
      const exGetId = expressRoutes.find((a) => a.path.includes('get'));
      const pyGetId = fastapiRoutes.find((a) => a.path.includes('get'));
      expect(exGetId!.content).toContain('const user =');
      expect(pyGetId!.content).toContain('user = ');
      expect(exGetId!.content).toContain('res.json(user)');
      expect(pyGetId!.content).toContain('return user');

      // POST — both have auth + create + 201
      const exPost = expressRoutes.find((a) => a.path.includes('post'));
      const pyPost = fastapiRoutes.find((a) => a.path.includes('post'));
      expect(exPost!.content).toContain('res.status(201).json(user)');
      expect(pyPost!.content).toContain('JSONResponse(content=user, status_code=201)');

      // DELETE — both respond 204
      const exDelete = expressRoutes.find((a) => a.path.includes('delete'));
      const pyDelete = fastapiRoutes.find((a) => a.path.includes('delete'));
      expect(exDelete!.content).toContain('res.status(204).send()');
      expect(pyDelete!.content).toContain('Response(status_code=204)');
    });
  });

  // ── Portable Control Flow — branch, each, collect ──────────────────

  describe('Portable Control Flow — branch, each, collect', () => {
    test('branch generates if/elif chain on query param', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    params role:string',
        '    derive users expr={{await db.query("SELECT * FROM users")}}',
        '    branch name=filterByRole on=query.role',
        '      path value="admin"',
        '        collect name=filtered from=users where={{item.role == "admin"}}',
        '        respond 200 json=filtered',
        '      path value="user"',
        '        collect name=filtered from=users where={{item.role == "user"}}',
        '        respond 200 json=filtered',
        '    respond 200 json=users',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;

      // Branch generates if/elif
      expect(content).toContain('if role == "admin"');
      expect(content).toContain('elif role == "user"');
      // Collect inside branch
      expect(content).toContain('item for item in');
      // Respond inside branch
      expect(content).toContain('return filtered');
      // Default respond at end
      expect(content).toContain('return users');
    });

    test('collect generates list comprehension with filter', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/tracks',
        '    derive tracks expr={{await db.query("SELECT * FROM tracks")}}',
        '    collect name=popular from=tracks where={{item.plays > 1000}} limit=10',
        '    respond 200 json=popular',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;

      // With both where+limit, uses multi-step pattern
      expect(content).toContain('item for item in popular if item.plays > 1000');
      expect(content).toContain('[:10]');
      expect(content).toContain('return popular');
    });

    test('each generates for loop', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route POST /api/batch',
        '    derive items expr={{body.items}}',
        '    each name=item in=items',
        '      derive result expr={{await process_item(item)}}',
        '    respond 200 json=items',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;

      expect(content).toContain('for item in items:');
      expect(content).toContain('result = await process_item(item)');
    });

    test('each with index generates enumerate loop', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/list',
        '    derive items expr={{await db.get_all()}}',
        '    each name=item in=items index=i',
        '      derive numbered expr={{{"index": i, **item}}}',
        '    respond 200 json=items',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));

      expect(route!.content).toContain('for i, item in enumerate(items):');
    });

    test('collect with sort generates sorted()', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/tracks',
        '    derive tracks expr={{await db.query("SELECT * FROM tracks")}}',
        '    collect name=sorted from=tracks order=item.score',
        '    respond 200 json=sorted',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));

      // 'sorted' is a Python built-in → renamed to sorted_result
      expect(route!.content).toContain('sorted(sorted_result, key=lambda item: item.score)');
    });

    test('branch.on={{...}} curly-expr form is unwrapped (regression)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    derive role expr={{request.headers.get("x-role")}}',
        '    branch name=byRole on={{role}}',
        '      path value="admin"',
        '        respond 200 json={"role": "admin"}',
        '      path value="user"',
        '        respond 200 json={"role": "user"}',
        '    respond 404',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;
      expect(content).not.toContain('[object Object]');
      expect(content).toContain('if role == "admin"');
    });

    test('collect.from={{...}} curly-expr form is unwrapped (regression)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/items',
        '    derive everything expr={{await db.all()}}',
        '    collect name=top from={{everything}} where={{item.score > 10}} limit=5',
        '    respond 200 json=top',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;
      expect(content).not.toContain('[object Object]');
      expect(content).toMatch(/top = everything/);
    });

    test('collect.order={{...}} curly-expr form is unwrapped (regression)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/items',
        '    derive items expr={{await db.all()}}',
        '    collect name=ranked from=items order={{item.score}}',
        '    respond 200 json=ranked',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;
      expect(content).not.toContain('[object Object]');
      expect(content).toContain('sorted(ranked, key=lambda item: item.score)');
    });
  });

  // ── Portable Effect — effect + trigger + recover ───────────────────

  describe('Portable Effect — effect + trigger + recover', () => {
    test('effect with retry generates for loop', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    effect fetchUsers',
        '      trigger db query="SELECT * FROM users"',
        '      recover retry=3 fallback=[]',
        '    respond 200 json=fetchUsers.result',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;

      // Retry loop — Python style
      expect(content).toContain('for _attempt in range(3):');
      expect(content).toContain('fetch_users = SELECT * FROM users');
      expect(content).toContain('break');
      // Fallback
      expect(content).toContain('fetch_users = []');
      // effectName.result → effectName (snake_case)
      expect(content).toContain('return fetch_users');
    });

    test('effect without retry generates try/except', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/data',
        '    effect loadData',
        '      trigger http url="/api/external"',
        '      recover fallback=null',
        '    guard name=hasData expr={{loadData.result}} else=502',
        '    respond 200 json=loadData.result',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;

      // try/except (no retry)
      expect(content).toContain('try:');
      expect(content).toContain('except Exception:');
      expect(content).toContain('load_data = None');
      // guard + respond reference effect
      expect(content).toContain('if not (load_data)');
      expect(content).toContain('return load_data');
    });

    test('effect.recover.fallback={{...}} curly-expr form is unwrapped (regression)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    effect fetchUsers',
        '      trigger expr={{await loadUsers()}}',
        '      recover retry=2 fallback={{[]}}',
        '    respond 200 json=fetchUsers.result',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;
      expect(content).not.toContain('[object Object]');
      expect(content).toMatch(/fetch_users = \[\]/);
    });

    test('effect.recover.fallback={{null}} curly-expr lowers to Python None', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/data',
        '    effect loadData',
        '      trigger expr={{await fetchData()}}',
        '      recover fallback={{null}}',
        '    respond 200 json=loadData.result',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;
      expect(content).toContain('load_data = None');
      expect(content).not.toContain('[object Object]');
    });

    test('effect.recover.fallback={{ true }} (with whitespace) maps to Python True (B4)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      // Pre-fix: lowerPropToPython compared `code === 'true'` without
      // trimming, so the curly form `{{ true }}` (which yields code
      // ' true ' with surrounding whitespace) bypassed the literal map
      // and emitted bare `true` — a Python `NameError` at runtime.
      const source = [
        'server name=Test',
        '  route GET /api/x',
        '    effect e',
        '      trigger expr={{await f()}}',
        '      recover fallback={{ true }}',
        '    respond 200 json=e.result',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('e = True');
      expect(route!.content).not.toMatch(/\be = true\b/);
    });

    test('effect.recover.fallback=0 preserves the numeric primitive (Gemini B5)', async () => {
      // Pre-fix: `fallback=0` (or `fallback=false` as a raw boolean
      // prop, before stringification) flowed through extractCodeOrString
      // → '' → lowerPropToPython → 'None'. Silent data-loss regression
      // vs the original naked `String(...)` which preserved "0"/"false".
      // Now extractCodeOrString preserves bare number/boolean primitives
      // via String(...) fallback.
      // (The KERN parser typically yields strings for bare unquoted
      // values, but if numeric props arrive directly through programmatic
      // IR construction we shouldn't silently swallow them.)
      const { transpileFastAPI: tx } = await import('../src/transpiler-fastapi.js');
      const ir = {
        type: 'server',
        props: { name: 'T' },
        children: [
          {
            type: 'route',
            props: { method: 'get', path: '/api/n' },
            children: [
              {
                type: 'effect',
                props: { name: 'e' },
                children: [
                  { type: 'trigger', props: { expr: { __expr: true, code: 'await f()' } } },
                  { type: 'recover', props: { fallback: 0 } as any },
                ],
              },
              { type: 'respond', props: { status: 200, json: 'e.result' } },
            ],
          },
        ],
      } as any;
      const result = tx(ir);
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).toContain('e = 0');
      expect(route!.content).not.toContain('e = None');
    });

    test('effect.recover.fallback=false (raw boolean IR prop) preserves False (Codex companion to B5)', async () => {
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const ir = {
        type: 'server',
        props: { name: 'T' },
        children: [
          {
            type: 'route',
            props: { method: 'get', path: '/api/b' },
            children: [
              {
                type: 'effect',
                props: { name: 'e' },
                children: [
                  { type: 'trigger', props: { expr: { __expr: true, code: 'await f()' } } },
                  { type: 'recover', props: { fallback: false } as any },
                ],
              },
              { type: 'respond', props: { status: 200, json: 'e.result' } },
            ],
          },
        ],
      } as any;
      const result = transpileFastAPI(ir);
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      // Pre-B5-fix: `false` typeof boolean → extractCodeOrString returned ''
      // → lowerPropToPython returned 'None'. Now preserved as 'False'.
      expect(route!.content).toContain('e = False');
      expect(route!.content).not.toContain('e = None');
    });

    test('collect.order=null suppresses sorted() emission (Codex BLOCKING on fix-up 6)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      // Pre-fix: order=null lowered to 'None' then emitted
      // `sorted(items, key=lambda item: None)` — Python runtime TypeError.
      // Now `null`/`undefined`/empty resolve to "absent" so `sorted()`
      // isn't emitted at all.
      const source = [
        'server name=Test',
        '  route GET /api/items',
        '    derive items expr={{await db.all()}}',
        '    collect name=ranked from=items order=null',
        '    respond 200 json=ranked',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).not.toContain('sorted(');
      expect(route!.content).not.toContain('key=lambda item: None');
    });

    test('collect.order={{null}} curly form also suppresses sorted()', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/items',
        '    derive items expr={{await db.all()}}',
        '    collect name=ranked from=items order={{null}}',
        '    respond 200 json=ranked',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      expect(route!.content).not.toContain('sorted(');
    });

    test('JS literals preserved after `.` with whitespace (Codex fix-up 1 followup)', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      // Pre-fix: `(?<!\.)` only checked the immediate previous char, so
      // `obj . true` (whitespace between dot and keyword) still lowered
      // to `obj . True` — Python SyntaxError. Now `(?<!\.\s*)` handles
      // any whitespace between.
      expect(rewriteFastAPIExpr('obj . true', [])).toBe('obj . true');
      expect(rewriteFastAPIExpr('obj  .  null', [])).toBe('obj  .  null');
      expect(rewriteFastAPIExpr('a.b . false', [])).toBe('a.b . false');
    });

    test('Python comment containing JS keywords does NOT false-positive (Codex fix-up 1 followup)', async () => {
      const { isUnsupportedJsHandlerBody } = await import('../src/fastapi-raw-handler.js');
      // Pre-fix: stripStringsForJsCheck only stripped strings, not
      // comments. A Python comment mentioning JS keywords would still
      // trip the `\bconst\s+\w+\s*=` regex.
      expect(isUnsupportedJsHandlerBody('# const x = 1 is JS syntax\nreturn 42')).toBe(false);
      expect(isUnsupportedJsHandlerBody('# uses res.json pattern in JS\nreturn {"ok": True}')).toBe(false);
      expect(isUnsupportedJsHandlerBody('# arrow syntax: (x) => x\nreturn 1')).toBe(false);
      expect(isUnsupportedJsHandlerBody('// JS-style comment about const x = 1\nreturn 1')).toBe(false);
      expect(isUnsupportedJsHandlerBody('/* block: new Date() */\nreturn 1')).toBe(false);
      // …but actual code outside comments still trips
      expect(isUnsupportedJsHandlerBody('# a comment\nconst x = 1;\nreturn x')).toBe(true);
    });

    test('stripStringsForJsCheck preserves JS private fields (Codex fix-up 9 followup)', async () => {
      const { stripStringsForJsCheck } = await import('../src/fastapi-raw-handler.js');
      // Modern JS uses `#x` for private class fields. Treating `#` as
      // a Python line comment unconditionally would hide `#x = 1` from
      // the leak detector. The fix: `#` only starts a comment when
      // not immediately followed by an identifier-start char.
      expect(stripStringsForJsCheck('class Foo { #x = 1; }')).toBe('class Foo { #x = 1; }');
      expect(stripStringsForJsCheck('this.#privateField = 42')).toBe('this.#privateField = 42');
      // …Python comments still get stripped (space or other non-ident
      // char after `#`).
      expect(stripStringsForJsCheck('# this is a comment\nx = 1')).toMatch(/^_+\nx = 1$/);
      // Standalone `#` at end of line — treated as comment-start since
      // nothing follows (next is undefined).
      expect(stripStringsForJsCheck('x = 1 #\ny = 2')).toMatch(/^x = 1 _\ny = 2$/);
    });

    test('stripStringsForJsCheck preserves Unicode / escape JS private fields (Codex+Gemini fix-up 11 followup)', async () => {
      const { stripStringsForJsCheck } = await import('../src/fastapi-raw-handler.js');
      // Unicode identifier start — `π` is a valid JS identifier char
      // per `\p{ID_Start}`. Pre-fix-up-13: only ASCII letters / `_` /
      // `$` were recognized, so `#π` was stripped as Python comment.
      expect(stripStringsForJsCheck('class Greek { #π = 3.14; }')).toBe('class Greek { #π = 3.14; }');
      // `\u`-escape identifier sequence: JS allows `#a` as a
      // valid private field name (resolves to `#a`). Treat the leading
      // `\` as private-field-start so the entire sequence stays visible
      // to subsequent leak checks.
      expect(stripStringsForJsCheck('class C { #\\u0061 = 1; }')).toBe('class C { #\\u0061 = 1; }');
      // NOTE: emoji code points (e.g. U+1F600 😀) are NOT `ID_Start`,
      // so `#\u{1F600}` is NOT a syntactically valid JS private field
      // name. Codex fix-up 17 review correctly required the decoded
      // codepoint be validated against `ID_Start`; this test now
      // asserts the comment-strip behavior for invalid-start escapes.
      expect(stripStringsForJsCheck('this.#\\u{1F600} = "emoji"')).not.toContain('#\\u{1F600}');
    });

    test('`#\\` only preserved when followed by a full \\u escape — fix-up 13 + 15 reviews', async () => {
      const { stripStringsForJsCheck } = await import('../src/fastapi-raw-handler.js');
      // Full Unicode-escape forms IS preserved as code:
      expect(stripStringsForJsCheck('this.#\\u0061 = 1')).toContain('#\\u0061'); // 4-hex form (a = U+0061 is ID_Start)
      // Codex fix-up 17 review: must validate the DECODED codepoint
      // against ID_Start, not just the escape syntax. Examples below
      // are syntactically-valid escapes that decode to non-ID_Start
      // codepoints — they should strip as comments.
      // U+0030 = '0' (digit, NOT ID_Start)
      expect(stripStringsForJsCheck('x = 1 #\\u0030 zero')).toMatch(/^x = 1 _+$/);
      // U+002D = '-' (hyphen, NOT ID_Start)
      expect(stripStringsForJsCheck('x = 1 #\\u{2D} hyphen')).toMatch(/^x = 1 _+$/);
      // U+1F600 = 😀 (emoji, Symbol_Other, NOT ID_Start)
      expect(stripStringsForJsCheck('x = 1 #\\u{1F600} emoji')).toMatch(/^x = 1 _+$/);
      // NOT escape sequences — strip as Python comment:
      expect(stripStringsForJsCheck('x = 1 #\\d+ regex note')).toMatch(/^x = 1 _+$/);
      expect(stripStringsForJsCheck('x = 1 #\\ note "quote"')).toMatch(/^x = 1 _+$/);
      // The fix-up 15 regression: `#\update note` is a Python comment
      // whose first non-`#` chars happen to be `\u` BUT don't form a
      // valid Unicode escape (no hex follows). Codex fix-up 15 review.
      expect(stripStringsForJsCheck('x = 1 #\\update note')).toMatch(/^x = 1 _+$/);
      // Malformed braced form — `\u{XYZ}` has non-hex chars; fix-up 15
      // suggested explicitly testing this.
      expect(stripStringsForJsCheck('x = 1 #\\u{XYZ} not hex')).toMatch(/^x = 1 _+$/);
      // Partial 4-hex (only 3 digits) is also not a valid escape.
      expect(stripStringsForJsCheck('x = 1 #\\u123 partial')).toMatch(/^x = 1 _+$/);
    });

    test('stripStringsForJsCheck handles non-BMP Unicode identifier (Gemini fix-up 13)', async () => {
      const { stripStringsForJsCheck } = await import('../src/fastapi-raw-handler.js');
      // `𐐀` (U+10400 DESERET CAPITAL LETTER LONG I) is a non-BMP
      // ID_Start codepoint. Pre-fix-up-15: single-code-unit `next`
      // contained only the high surrogate (`\uD801`) which fails the
      // `\p{ID_Start}` test, so this `#𐐀` would have been stripped
      // as Python comment. Now uses slice + anchored regex.
      expect(stripStringsForJsCheck('class C { #𐐀 = 1; }')).toBe('class C { #𐐀 = 1; }');
    });

    test('collect.order={{...}} curly form routes through lowerPropToPython too (Gemini fix-up 6)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      // Pre-fix-up-6: order used extractCodeOrString → bypassed the JS-
      // literal map → `order={{null}}` would emit `sorted(items, key=lambda
      // item: null)` (Python NameError). Now routes through
      // lowerPropToPython for consistency with from/limit.
      const source = [
        'server name=Test',
        '  route GET /api/items',
        '    derive items expr={{await db.all()}}',
        '    collect name=ranked from=items order={{params.sortKey}}',
        '    respond 200 json=ranked',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;
      // params.sortKey → sortKey (query param rewrite)
      expect(content).toContain('sorted(ranked, key=lambda item: sortKey)');
      // No [object Object] or double-rewrite artifacts
      expect(content).not.toContain('[object Object]');
    });

    test('collect.limit={{...}} curly form routes through lowerPropToPython (Gemini M3)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/items',
        '    derive everything expr={{await db.all()}}',
        '    collect name=top from=everything where={{item.score > 10}} limit={{params.max}}',
        '    respond 200 json=top',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;
      expect(content).not.toContain('[object Object]');
      // params.max → max (query/path param rewrite via rewriteFastAPIExpr)
      expect(content).toMatch(/\[:max\]/);
    });

    test('effect.recover.fallback={{true}} / {{false}} lowers to Python True / False', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      for (const [literal, expected] of [
        ['{{true}}', 'True'],
        ['{{false}}', 'False'],
      ] as const) {
        const source = [
          'server name=Test',
          '  route GET /api/data',
          '    effect loadData',
          '      trigger expr={{await fetchData()}}',
          `      recover fallback=${literal}`,
          '    respond 200 json=loadData.result',
        ].join('\n');
        const result = transpileFastAPI(parse(source));
        const route = result.artifacts!.find((a: any) => a.path.includes('route'));
        expect(route!.content).toContain(`load_data = ${expected}`);
      }
    });

    test('effect with expr trigger rewrites portable refs', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/users/:id',
        '    effect fetchUser',
        '      trigger db expr={{await db.users.find_by_id(params.id)}}',
        '      recover retry=2 fallback=null',
        '    guard name=exists expr={{fetchUser.result}} else=404',
        '    respond 200 json=fetchUser.result',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;

      // params.id → id (function param)
      expect(content).toContain('await db.users.find_by_id(id)');
      expect(content).toContain('_attempt in range(2)');
      // .result stripped
      expect(content).toContain('if not (fetch_user)');
      expect(content).toContain('return fetch_user');
    });
  });

  // ── rewriteFastAPIExpr — JS-to-Python expression lowerings ─────────

  describe('rewriteFastAPIExpr JS-to-Python lowerings', () => {
    test('=== / !== lower to == / !=', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      expect(rewriteFastAPIExpr('item.role === "admin"', [])).toBe('item.role == "admin"');
      expect(rewriteFastAPIExpr('user.id !== other.id', [])).toBe('user.id != other.id');
      // Doesn't touch already-correct ==/!=
      expect(rewriteFastAPIExpr('a == b', [])).toBe('a == b');
    });

    test('.filter((x) => pred) lowers to list comprehension', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      expect(rewriteFastAPIExpr('users.filter((u) => u.active)', [])).toBe('[u for u in users if u["active"]]');
    });

    test('.map((x) => expr) lowers to list comprehension', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      expect(rewriteFastAPIExpr('users.map((u) => u.name)', [])).toBe('[u["name"] for u in users]');
    });

    test('.find((x) => pred) lowers to next() with None default', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      expect(rewriteFastAPIExpr('users.find((u) => u.id == id)', [])).toBe(
        'next((u for u in users if u["id"] == id), None)',
      );
    });

    test('combined: .find with === lowers correctly (ordering invariant)', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      // Arrow rewrite runs first; the inner `===` is then caught by the
      // strict-equality pass on the rewritten predicate.
      expect(rewriteFastAPIExpr('users.find((item) => item.id === id)', [])).toBe(
        'next((item for item in users if item["id"] == id), None)',
      );
    });

    test('map with index arg lowers via enumerate()', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      expect(rewriteFastAPIExpr('arr.map((u, i) => u.name)', [])).toBe('[u["name"] for i, u in enumerate(arr)]');
    });

    test('arr-core dict member access lowers to subscript form', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      expect(rewriteFastAPIExpr('items.filter((x) => x.active)', [])).toBe('[x for x in items if x["active"]]');
      expect(rewriteFastAPIExpr('items.map((x) => x.n)', [])).toBe('[x["n"] for x in items]');
      expect(rewriteFastAPIExpr('items.find((x) => x.n === 2)', [])).toBe(
        'next((x for x in items if x["n"] == 2), None)',
      );
    });

    test('arr-core supports bare arrow params and nested dict member access', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      expect(rewriteFastAPIExpr('items.filter(x => x.active)', [])).toBe('[x for x in items if x["active"]]');
      expect(rewriteFastAPIExpr('items.map((x) => x.meta.tag)', [])).toBe('[x["meta"]["tag"] for x in items]');
      expect(rewriteFastAPIExpr('items.map((x, i) => x.n + i)', [])).toBe('[x["n"] + i for i, x in enumerate(items)]');
    });

    test('=== / !== are skipped when inside string literals (Codex P2)', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      expect(rewriteFastAPIExpr('label = "use === for strict equality"', [])).toBe(
        'label = "use === for strict equality"',
      );
      expect(rewriteFastAPIExpr("msg = 'a !== b'", [])).toBe("msg = 'a !== b'");
      // Mixed — the in-string text is preserved, the out-of-string operator IS rewritten
      expect(rewriteFastAPIExpr('cond = a === b && label === "x !== y"', [])).toBe(
        'cond = a == b && label == "x !== y"',
      );
    });

    test('chained .filter().map() rewrites fully (Gemini #2)', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      expect(rewriteFastAPIExpr('users.filter((u) => u.active).map((u) => u.name)', [])).toBe(
        '[u["name"] for u in [u for u in users if u["active"]]]',
      );
    });

    test('arr-method lowerings rewrite to Python forms (and drop JS method syntax)', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      const out = rewriteFastAPIExpr(
        'nums.includes(2) && nums.indexOf(2) >= 0 && nums.join(",") == "1,2,3" && nums.slice(0, 2)',
        [],
      );
      expect(out).toContain('(2 in nums)');
      expect(out).toContain('next((__i for __i, __v in enumerate(nums) if __v == 2), -1)');
      expect(out).toContain('",".join(str(__v) for __v in nums)');
      expect(out).toContain('nums[0:2]');
      expect(out).not.toContain('nums.includes(');
      expect(out).not.toContain('nums.indexOf(');
      expect(out).not.toContain('nums.join(');
      expect(out).not.toContain('nums.slice(');
    });

    test('arr-method callbacks some/every/reduce lower and reduce adds functools import', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      const imports = new Set<string>();
      const out = rewriteFastAPIExpr(
        'nums.some((n) => n === 2) && nums.every((n) => n > 0) && nums.reduce((a, b) => a + b, 0)',
        [],
        new Set(),
        false,
        imports,
      );
      expect(out).toContain('any(n == 2 for n in nums)');
      expect(out).toContain('all(n > 0 for n in nums)');
      expect(out).toContain('functools.reduce(lambda a, b: a + b, nums, 0)');
      expect(out).not.toContain('nums.some(');
      expect(out).not.toContain('nums.every(');
      expect(out).not.toContain('nums.reduce(');
      expect(imports.has('import functools')).toBe(true);
    });

    test('arrow predicate with one level of nested parens (Gemini #3)', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      expect(rewriteFastAPIExpr('users.filter((u) => (u.age > 18))', [])).toBe('[u for u in users if (u["age"] > 18)]');
    });

    test('undefined / null lower to None outside strings (Gemini #4)', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      expect(rewriteFastAPIExpr('x === undefined', [])).toBe('x == None');
      expect(rewriteFastAPIExpr('x !== null', [])).toBe('x != None');
      // …and `undefined`/`null` inside strings are preserved
      expect(rewriteFastAPIExpr('reason = "undefined behavior"', [])).toBe('reason = "undefined behavior"');
      expect(rewriteFastAPIExpr('msg = "null pointer"', [])).toBe('msg = "null pointer"');
    });

    test('true / false lower to True / False outside strings', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      expect(rewriteFastAPIExpr('enabled = true', [])).toBe('enabled = True');
      expect(rewriteFastAPIExpr('flag = false', [])).toBe('flag = False');
      expect(rewriteFastAPIExpr('msg = "set to true"', [])).toBe('msg = "set to true"');
    });

    test('backtick templates without interpolation lower to plain strings', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      expect(rewriteFastAPIExpr('msg = `use === for strict equality`', [])).toBe('msg = "use === for strict equality"');
      expect(rewriteFastAPIExpr('msg = `a !== b`', [])).toBe('msg = "a !== b"');
    });

    test('JS literals preserved inside backtick template literals (B3 cont.)', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      expect(rewriteFastAPIExpr('s = `undefined behavior`', [])).toBe('s = "undefined behavior"');
      expect(rewriteFastAPIExpr('s = `set to true`', [])).toBe('s = "set to true"');
    });

    test('JS literals skipped when used as property access (Codex+Gemini B2)', async () => {
      const { rewriteFastAPIExpr } = await import('../src/fastapi-response.js');
      // `obj.true` etc. would lower to `obj.True`, which is a Python
      // `SyntaxError` (True/False/None are reserved words and cannot
      // appear after a `.`). Skip the rewrite when preceded by `.`.
      expect(rewriteFastAPIExpr('obj.true', [])).toBe('obj.true');
      expect(rewriteFastAPIExpr('obj.null', [])).toBe('obj.null');
      expect(rewriteFastAPIExpr('obj.undefined', [])).toBe('obj.undefined');
      expect(rewriteFastAPIExpr('obj.false', [])).toBe('obj.false');
      // …but a bare token after a non-dot still lowers
      expect(rewriteFastAPIExpr('x = true', [])).toBe('x = True');
      // …and a token after a dotted access (`obj.x.true` ?) actually
      // this would still be a property access — preserve.
      expect(rewriteFastAPIExpr('a.b.true', [])).toBe('a.b.true');
    });
  });

  // ── Raw-JS handler guard — portable + stream paths ─────────────────

  describe('Raw-JS handler guard (Python target)', () => {
    test('portable child handler with raw JS body emits NotImplementedError, not raw JS', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route POST /api/providers/test',
        '    guard expr={{registry.get(body.id)}}',
        '      error status=404 message="Provider not found"',
        '    handler <<<',
        '      const provider = registry.get(req.body.id);',
        '      const result = await provider.test();',
        '      res.json({ ok: true, message: result });',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('providers_test'));
      const content = route!.content;
      // Must NOT contain the raw JS that previously leaked
      expect(content).not.toMatch(/const\s+provider\s*=/);
      expect(content).not.toContain('res.json');
      // Must contain the foreign-bailout stub
      expect(content).toContain('raise NotImplementedError("Unsupported raw JavaScript handler syntax');
    });

    test('stream handler with raw JS body emits NotImplementedError inside event_generator', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route POST /api/review',
        '    stream',
        '      handler <<<',
        '        const abortController = new AbortController();',
        '        res.on("close", () => abortController.abort());',
        '      >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('post_api_review'));
      const content = route!.content;
      expect(content).toContain('async def event_generator():');
      expect(content).not.toMatch(/const\s+abortController/);
      expect(content).toContain('raise NotImplementedError("Unsupported raw JavaScript handler syntax');
    });

    test('res.json({ ... new Date() ... }) rejected by lowerer; falls back to NotImplementedError (Bug E)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/health',
        '    handler <<<',
        "      res.json({ status: 'ok', timestamp: new Date().toISOString() });",
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('get_api_health'));
      const content = route!.content;
      // The pre-fix output was `return { "status": 'ok', "timestamp": new Date().toISOString() }`
      // which is a Python SyntaxError ('new' is not a keyword, juxtaposed names invalid).
      // Now the lowerer recognizes `new X(...)` as un-lowerable and falls through
      // to the JS-detection guard, which emits NotImplementedError.
      expect(content).not.toMatch(/new\s+Date/);
      expect(content).toContain('raise NotImplementedError("Unsupported raw JavaScript handler syntax');
    });

    test('res.json({ status: "ok", count: 42 }) without new-keyword still lowers cleanly', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/info',
        '    handler <<<',
        "      res.json({ status: 'ok', count: 42 });",
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('get_api_info'));
      const content = route!.content;
      // Clean lowering still works — keys quoted, no NotImplementedError fallback.
      expect(content).toContain('"status"');
      expect(content).toContain('"count": 42');
      expect(content).not.toContain('NotImplementedError');
    });

    test('stream handler with JS body emits NotImplementedError OUTSIDE async-for (B7)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      // Spawn-stream variant: pre-fix, the raise sat INSIDE
      // `async for chunk in process.stdout:` so if the subprocess
      // produced no stdout the error never fired. Now the check
      // hoists the raise to the `if process.stdout:` branch so the
      // error path is deterministic.
      const source = [
        'server name=Test',
        '  route POST /api/spawn',
        '    stream',
        '      spawn binary="echo" args="hello"',
        '        on name=stdout',
        '          handler <<<',
        '            const x = JSON.parse(chunk);',
        '            res.write(x);',
        '          >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('post_api_spawn'));
      const content = route!.content;
      // The raise must appear, AND must not be nested inside the async-for body
      // (12-space indent inside `if process.stdout:`, not 16-space inside the for-body).
      expect(content).toContain('raise NotImplementedError("Unsupported raw JavaScript handler syntax');
      // Verify the raise is at the `if process.stdout:` indent level, not deeper:
      const lines = content.split('\n');
      const raiseLine = lines.find((l: string) => l.includes('raise NotImplementedError'));
      expect(raiseLine).toBeDefined();
      // Indent should be exactly 12 spaces (one level inside `if process.stdout:`),
      // not 16 (which would be inside the async-for body).
      expect(raiseLine!.startsWith('            raise')).toBe(true);
      expect(raiseLine!.startsWith('                raise')).toBe(false);
    });

    test('effect.trigger precedence restored: query wins over url when both present (B8)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      // Pre-Step-5 precedence was expr > query > url > call. My Step 5
      // commit silently flipped it to expr > url > query > call. Now restored.
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    effect fetchUsers',
        '      trigger query="SELECT * FROM users" url="/legacy"',
        '    respond 200 json=fetchUsers.result',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('get_api_users'));
      const content = route!.content;
      // Query selected → emitted unquoted (legacy SQL-expression behavior).
      expect(content).toContain('fetch_users = SELECT * FROM users');
      // url ignored when query also present.
      expect(content).not.toContain('"/legacy"');
    });

    test('effect.trigger.url="" empty string emits "" not falls through to call (B9)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/empty',
        '    effect e',
        '      trigger url="" call="fallback()"',
        '    respond 200 json=e.result',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('route'));
      const content = route!.content;
      // Pre-fix: url="" was falsy, so triggerExpr fell through to call → fallback().
      // Now: url is present (even empty) → emit "" string literal.
      expect(content).toContain('e = ""');
      expect(content).not.toContain('fallback()');
    });

    test('effect.trigger.url string-prop emits as Python string literal (Bug C)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/users',
        '    effect fetchUsers',
        '      trigger url="/api/users"',
        '    respond 200 json=fetchUsers.result',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('get_api_users'));
      const content = route!.content;
      // Previously emitted bare `/api/users` (Python parses `=` then `/` as
      // binary division → SyntaxError). Now wrapped as Python string literal.
      expect(content).toContain('fetch_users = "/api/users"');
      expect(content).not.toMatch(/=\s+\/api/);
    });

    test('clean Python handler body passes through unchanged (no false-positive guard)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/health',
        '    handler lang="python" <<<',
        '      return {"ok": True}',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('health'));
      // Clean Python body — should NOT trip the guard
      expect(route!.content).not.toContain('NotImplementedError');
      expect(route!.content).toContain('return {"ok": True}');
    });

    test('isUnsupportedJsHandlerBody catches destructuring + for-loop variants (Codex+Gemini M1)', async () => {
      const { isUnsupportedJsHandlerBody } = await import('../src/fastapi-raw-handler.js');
      // Destructuring assignments — not valid Python.
      expect(isUnsupportedJsHandlerBody('const { id } = req.body;')).toBe(true);
      expect(isUnsupportedJsHandlerBody('let [a, b] = arr;')).toBe(true);
      expect(isUnsupportedJsHandlerBody('var { x, y } = obj;')).toBe(true);
      // for-loop variants — not valid Python.
      expect(isUnsupportedJsHandlerBody('for (var x of list) { console.log(x); }')).toBe(true);
      expect(isUnsupportedJsHandlerBody('for (let key in obj) { ... }')).toBe(true);
      expect(isUnsupportedJsHandlerBody('for (const item of items) { ... }')).toBe(true);
      // Python `for var in items:` is NOT flagged — `var`/`let`/`const`
      // are Python identifiers there, not declaration keywords. The
      // pattern requires `for (` (JS-style parens) so this is unambiguous.
      expect(isUnsupportedJsHandlerBody('for var in items:\n    print(var)')).toBe(false);
      expect(isUnsupportedJsHandlerBody('for let in things:\n    pass')).toBe(false);
    });

    test('isUnsupportedJsHandlerBody catches non-PascalCase `new` ctors (Gemini+Codex M2)', async () => {
      const { isUnsupportedJsHandlerBody } = await import('../src/fastapi-raw-handler.js');
      expect(isUnsupportedJsHandlerBody('const x = new error("oops");')).toBe(true);
      expect(isUnsupportedJsHandlerBody('return new lowerctor();')).toBe(true);
      expect(isUnsupportedJsHandlerBody('const d = new globalThis.Date();')).toBe(true);
      expect(isUnsupportedJsHandlerBody('return new foo.bar.Baz();')).toBe(true);
    });

    test('Python idioms where `new` is a variable name do NOT false-positive (Codex+Gemini fix-up 8)', async () => {
      const { isUnsupportedJsHandlerBody } = await import('../src/fastapi-raw-handler.js');
      // All of these are valid Python where `new` is a local variable
      // name followed by a Python keyword. Pre-fix-up-10: my no-parens
      // `new IDENT` regex matched these as JS construction.
      expect(isUnsupportedJsHandlerBody('if new is None:\n    return None')).toBe(false);
      expect(isUnsupportedJsHandlerBody('if new in items:\n    return new')).toBe(false);
      expect(isUnsupportedJsHandlerBody('return [new for new in items]')).toBe(false);
      expect(isUnsupportedJsHandlerBody('return new if condition else old')).toBe(false);
      expect(isUnsupportedJsHandlerBody('return new and other')).toBe(false);
      expect(isUnsupportedJsHandlerBody('return new or other')).toBe(false);
      // `new not in items` — Python's negated-membership operator `not in`
      // (NOT `X not Y` which is invalid Python syntax). Codex caught the
      // earlier `return new not other` assertion as testing invalid Python.
      expect(isUnsupportedJsHandlerBody('if new not in items:\n    return new')).toBe(false);
      // `return new\nfoo = 1` — `new` is a Python variable on its own line,
      // next statement is independent. The newline-cross newline case
      // codex flagged on fix-up 10.
      expect(isUnsupportedJsHandlerBody('return new\nfoo = 1')).toBe(false);
      // `return new\nDate()` IS valid Python (two statements: `return
      // new` then independent `Date()`), so we keep horizontal-only
      // whitespace on the parens-form regex too — Python correctness
      // wins over the JS edge case where someone formats `new\nDate()`
      // across lines. Codex fix-up 14 review marked the cross-newline
      // match BLOCKING for Python safety.
      expect(isUnsupportedJsHandlerBody('return new\nDate()')).toBe(false);
      // `const d = new\nFoo.Bar()` IS still flagged — but via the `const X =`
      // JS assignment detection, not the `new` regex. The `new` cross-newline
      // suppression only affects the standalone `new IDENT(...)` form.
      expect(isUnsupportedJsHandlerBody('const d = new\nFoo.Bar()')).toBe(true);
      // Multi-space lookbehind: `for  new in items:` (two spaces)
      expect(isUnsupportedJsHandlerBody('for  new in items:\n    print(new)')).toBe(false);
      expect(isUnsupportedJsHandlerBody('for\tnew\tin\titems:\n    print(new)')).toBe(false);
      // `for old, new in items:` — multi-decl form; `new` followed by `in`
      expect(isUnsupportedJsHandlerBody('for old, new in items:\n    print(new)')).toBe(false);
      // …but actual JS `new Foo` (followed by IDENT not in Python kw set) still fires
      expect(isUnsupportedJsHandlerBody('return new Foo')).toBe(true);
      expect(isUnsupportedJsHandlerBody('const d = new Date')).toBe(true);
    });

    test('isUnsupportedJsHandlerBody catches for-await + $-identifiers + new-no-parens (Codex+Gemini fix-up 5)', async () => {
      const { isUnsupportedJsHandlerBody } = await import('../src/fastapi-raw-handler.js');
      // for await (streaming form — common in handler bodies)
      expect(isUnsupportedJsHandlerBody('for await (const chunk of stream) { process(chunk); }')).toBe(true);
      expect(isUnsupportedJsHandlerBody('for await (let x of s) ...')).toBe(true);
      // $ in identifiers
      expect(isUnsupportedJsHandlerBody('const $el = document.querySelector("x");')).toBe(true);
      expect(isUnsupportedJsHandlerBody('let _$state = init();')).toBe(true);
      expect(isUnsupportedJsHandlerBody('var $$ = 1;')).toBe(true);
      // `new` without parens — also valid JS, also SyntaxError in Python
      expect(isUnsupportedJsHandlerBody('return new Date;')).toBe(true);
      expect(isUnsupportedJsHandlerBody('const d = new globalThis.Date\nconst e = 1')).toBe(true);
      // Python idiom `for new in items:` is NOT flagged (the `new` is a
      // loop variable name preceded by `for `, so negative lookbehind
      // suppresses the no-parens `new`-keyword match).
      expect(isUnsupportedJsHandlerBody('for new in items:\n    print(new)')).toBe(false);
    });

    test('Python body containing JS keywords inside strings does NOT false-positive (Codex B6)', async () => {
      const { isUnsupportedJsHandlerBody } = await import('../src/fastapi-raw-handler.js');
      // Pre-fix: `\bconst\s+\w+\s*=` regex matched the inner text of the
      // Python string literal and emitted NotImplementedError for an
      // otherwise-valid Python body.
      expect(isUnsupportedJsHandlerBody('msg = "const x = 1 is JS syntax"; return msg')).toBe(false);
      expect(isUnsupportedJsHandlerBody('label = "uses res.json pattern in JS"; return label')).toBe(false);
      expect(isUnsupportedJsHandlerBody("tip = 'use => for arrows in JS'; return tip")).toBe(false);
      // …but real JS keywords outside strings still trip the guard
      expect(isUnsupportedJsHandlerBody('const x = 1; return x')).toBe(true);
      expect(isUnsupportedJsHandlerBody('return res.json({ok: true})')).toBe(true);
    });

    test('isLowerableJsValueExpression: `new\\nFoo()` in expression context IS rejected (Codex fix-up 16)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      // Codex fix-up 16: in expression context (the X in `res.json(X)`),
      // there are no statement boundaries — `new\nDate()` is
      // unambiguously JS construction, NOT two Python statements.
      // The handler-body guard's horizontal-only restriction would
      // weaken expression-level JS detection.
      const source = [
        'server name=Test',
        '  route GET /api/info',
        '    handler <<<',
        '      res.json({ x: new',
        '        Date() });',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('get_api_info'));
      expect(route!.content).toContain('NotImplementedError');
    });

    test('isLowerableJsValueExpression: no-parens `new\\nDate` in payload also rejected (Gemini fix-up 18)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      // Gemini fix-up 18 caught that I'd relaxed only the parens-form
      // regex in expression context; the no-parens form `new\nDate`
      // (no trailing parens) was still horizontal-only, so this
      // multiline form slipped the guard. Now both forms use `\s+`
      // in expression scope.
      const source = [
        'server name=Test',
        '  route GET /api/noparens',
        '    handler <<<',
        '      res.json({ x: new',
        '        Date });',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('get_api_noparens'));
      expect(route!.content).toContain('NotImplementedError');
    });

    test('isLowerableJsValueExpression: single-line `new Date()` payload still rejected', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/single',
        '    handler <<<',
        '      res.json({ x: new Date() });',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('get_api_single'));
      expect(route!.content).toContain('NotImplementedError');
    });

    test('isLowerableJsValueExpression: `new` inside string literals does not reject (Codex B10)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/info',
        '    handler <<<',
        "      res.json({ status: 'example: new Date() pattern', count: 42 });",
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('get_api_info'));
      const content = route!.content;
      // Pre-fix: `\bnew\s+[A-Z]` regex matched inside the quoted string
      // and emitted NotImplementedError. Now the check strips string
      // contents first, so this lowers cleanly.
      expect(content).not.toContain('NotImplementedError');
      expect(content).toContain('"status"');
      expect(content).toContain('"count": 42');
    });

    test('isLowerableJsValueExpression: non-PascalCase `new foo()` also rejected (Gemini+Codex M2)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/lowercase',
        '    handler <<<',
        '      res.json({ x: new lowerctor() });',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('get_api_lowercase'));
      // Pre-fix: PascalCase-only constraint missed lowercase ctors → invalid Python.
      expect(route!.content).toContain('raise NotImplementedError');
    });

    test('isLowerableJsValueExpression: namespaced `new foo.Bar()` also rejected (M2 cont.)', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const source = [
        'server name=Test',
        '  route GET /api/namespaced',
        '    handler <<<',
        '      res.json({ x: new globalThis.Date() });',
        '    >>>',
      ].join('\n');
      const result = transpileFastAPI(parse(source));
      const route = result.artifacts!.find((a: any) => a.path.includes('get_api_namespaced'));
      expect(route!.content).toContain('raise NotImplementedError');
    });
  });
});
