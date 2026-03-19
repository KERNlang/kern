import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
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

      const ast = parse('interface name=Track\n  field name=id type=string\n  field name=title type=string\n  field name=duration type=number optional=true');
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

      const ast = parse('fn name=createTrack params="title:string" returns=Track async=true\n  handler <<<\n    return Track(title=title)\n  >>>');
      const lines = generatePythonCoreNode(ast);
      const output = lines.join('\n');

      expect(output).toContain('async def create_track(title: str) -> Track:');
      expect(output).toContain('return Track(title=title)');
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

      const ast = parse([
        'machine name=Plan',
        '  state name=draft initial=true',
        '  state name=approved',
        '  state name=cancelled',
        '  transition name=approve from=draft to=approved',
        '  transition name=cancel from="draft|approved" to=cancelled',
      ].join('\n'));
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

      const ast = parse('config name=AppConfig\n  field name=timeout type=number default=120\n  field name=debugMode type=boolean default=false');
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

      const ast = parse('test name="Plan Transitions"\n  describe name=approve\n    it name="transitions draft to approved"\n      handler <<<\n        assert True\n      >>>');
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

  // ── FastAPI Transpiler ────────────────────────────────────────────────

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
      expect(result.artifacts!.some(a => a.path.endsWith('.py'))).toBe(true);
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
      const routeArtifact = result.artifacts?.find(a => a.type === 'route');

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

      const ast = parse('server name=Test\n  route method=get path=/health\n    handler <<<\n      return {"ok": True}\n    >>>');
      const result = transpileFastAPI(ast);

      expect(result.code).toContain('Internal Server Error');
      expect(result.code).not.toContain('str(exc)');
    });

    test('relaxed mode generates verbose error handler', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { resolveConfig } = await import('../../core/src/config.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');
      const config = resolveConfig({ target: 'fastapi' as any, fastapi: { security: 'relaxed' } } as any);
      const ast = parse('server name=Test\n  route method=get path=/health\n    handler <<<\n      return {"ok": True}\n    >>>');
      const result = transpileFastAPI(ast, config);

      expect(result.code).toContain('str(exc)');
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
      const mwArtifact = result.artifacts?.find(a => a.type === 'middleware');

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
      const routeArtifact = result.artifacts?.find(a => a.type === 'route');

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

      const ast = parse('server name=Test\n  route method=post path=/api/stream\n    stream\n      handler <<<\n        yield f"data: ping\\n\\n"\n      >>>');
      const result = transpileFastAPI(ast);
      const route = result.artifacts!.find(a => a.type === 'route');

      expect(route).toBeDefined();
      expect(route!.content).toContain('StreamingResponse');
      expect(route!.content).toContain('event_generator');
      expect(route!.content).toContain('text/event-stream');
    });

    test('timer route generates asyncio.wait_for', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const ast = parse('server name=Test\n  route method=post path=/api/test\n    timer 15\n      handler <<<\n        result = await do_work()\n        return result\n      >>>');
      const result = transpileFastAPI(ast);
      const route = result.artifacts!.find(a => a.type === 'route');

      expect(route!.content).toContain('asyncio.wait_for');
      expect(route!.content).toContain('timeout=15');
      expect(route!.content).toContain('408');
      expect(route!.content).toContain('Request timed out');
    });

    test('spawn generates asyncio.create_subprocess_exec', async () => {
      const { parse } = await import('../../core/src/parser.js');
      const { transpileFastAPI } = await import('../src/transpiler-fastapi.js');

      const ast = parse("server name=Test\n  route method=post path=/api/run\n    stream\n      spawn binary=python args=['-c','print(42)']\n        on name=stdout\n          handler <<<\n            yield f\"data: {chunk.decode()}\\n\\n\"\n          >>>");
      const result = transpileFastAPI(ast);
      const route = result.artifacts!.find(a => a.type === 'route');

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
      const wsArtifact = result.artifacts?.find(a => a.type === 'websocket');
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
      expect(content).toContain('await websocket.receive_json()');
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
      const wsArtifact = result.artifacts?.find(a => a.type === 'websocket');

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

      const routeArtifacts = result.artifacts?.filter(a => a.type === 'route') || [];
      const wsArtifacts = result.artifacts?.filter(a => a.type === 'websocket') || [];

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

    const ast = parse('server name=Test\n  route method=get path=/health\n    handler <<<\n      return {"ok": True}\n    >>>');
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
});
