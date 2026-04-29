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

    test('emits Optional[T] = None for optional param children without defaults', async () => {
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
      expect(output).toContain('def greet(salutation: Optional[str] = None) -> str:');
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
      const result = transpileFastAPI(parse(source));
      expect(result.code).toContain('create_async_engine');
      expect(result.code).toContain('DATABASE_URL');
      expect(result.code).toContain('async def get_db()');
      expect(result.code).toContain('async def init_db()');
      expect(result.code).toContain('@app.on_event("startup")');
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
      expect(result.code).toContain('import uvicorn');
      expect(result.code).toContain('app = FastAPI(title="TestAPI")');
      expect(result.code).toContain('CORSMiddleware');
      expect(result.code).toContain('app.include_router(');
      expect(result.code).toContain('port=8080');
      expect(result.artifacts).toBeDefined();
      expect(result.artifacts!.length).toBe(2);
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

    test('strict mode generates sanitized error handler', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const ast = parse(
        'server name=Test\n  route method=get path=/health\n    handler <<<\n      return {"ok": True}\n    >>>',
      );
      const result = transpileFastAPI(ast);

      expect(result.code).toContain('Internal Server Error');
      expect(result.code).not.toContain('str(exc)');
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
        'allow_origins=[origin.strip() for origin in os.environ.get("CORS_ORIGINS", "").split(",") if origin.strip()]',
      );
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

      expect(result.code).toContain('uvicorn.run("main:app"');
      expect(result.code).toContain('reload=True');
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
});
