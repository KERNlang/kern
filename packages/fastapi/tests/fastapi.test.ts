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
});
