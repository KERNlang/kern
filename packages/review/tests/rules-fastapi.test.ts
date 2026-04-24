import type { ConceptMap, ConceptNode, ConceptSpan } from '@kernlang/core';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { extractConceptsForGraph, reviewGraph, reviewPythonSource } from '../src/index.js';
import { runFastapiConceptRules } from '../src/rules/fastapi.js';
import { getActiveRules, getRuleRegistry } from '../src/rules/index.js';
import type { ReviewFinding } from '../src/types.js';

// ── Test helpers ────────────────────────────────────────────────────────

function makeSpan(file: string, startLine: number, endLine?: number): ConceptSpan {
  return { file, startLine, startCol: 1, endLine: endLine ?? startLine, endCol: 1 };
}

function makeRouteNode(
  file: string,
  name: string,
  startLine: number,
  endLine: number,
  evidence: string,
  httpMethod?: string,
): ConceptNode {
  return {
    id: `${file}#entrypoint@${startLine}`,
    kind: 'entrypoint',
    primarySpan: makeSpan(file, startLine, endLine),
    evidence,
    confidence: 0.95,
    language: 'py',
    payload: { kind: 'entrypoint', subtype: 'route', name, httpMethod },
  };
}

function makeStateMutationNode(
  file: string,
  target: string,
  scope: 'local' | 'module' | 'global' | 'shared',
  startLine: number,
): ConceptNode {
  return {
    id: `${file}#state_mutation@${startLine}`,
    kind: 'state_mutation',
    primarySpan: makeSpan(file, startLine),
    evidence: `${target} = ...`,
    confidence: 0.9,
    language: 'py',
    payload: { kind: 'state_mutation', target, scope },
  };
}

function makeErrorHandleNode(
  file: string,
  startLine: number,
  disposition: 'ignored' | 'logged' | 'wrapped' | 'returned' | 'rethrown' | 'retried' = 'logged',
): ConceptNode {
  return {
    id: `${file}#error_handle@${startLine}`,
    kind: 'error_handle',
    primarySpan: makeSpan(file, startLine),
    evidence: 'except Exception as e:',
    confidence: 0.9,
    language: 'py',
    payload: { kind: 'error_handle', disposition },
  };
}

function makeConceptMap(file: string, nodes: ConceptNode[]): ConceptMap {
  return {
    filePath: file,
    language: 'py',
    nodes,
    edges: [],
    extractorVersion: 'test-1.0',
  };
}

function run(source: string, nodes: ConceptNode[], file = 'app.py'): ReviewFinding[] {
  return runFastapiConceptRules(makeConceptMap(file, nodes), file, source);
}

// ── Registry tests ──────────────────────────────────────────────────────

describe('FastAPI Rules', () => {
  describe('registry', () => {
    it('has 5 fastapi rules in REGISTRY', () => {
      const registry = getRuleRegistry('fastapi');
      const fastapiRules = registry.filter((r) => r.layer === 'fastapi');
      expect(fastapiRules.length).toBe(5);
    });

    it('getActiveRules returns empty array for fastapi (concept-only target)', () => {
      const rules = getActiveRules('fastapi');
      const fastapiSpecific = rules.filter((r) => (r as any).ruleId?.startsWith('fastapi'));
      expect(fastapiSpecific.length).toBe(0);
    });
  });

  describe('public review pipeline', () => {
    it('runs FastAPI rules through reviewPythonSource', () => {
      const source = `
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True)
`;
      const report = reviewPythonSource(source, 'main.py', { target: 'fastapi', noCache: true });

      expect(report.findings.some((f) => f.ruleId === 'missing-python-support')).toBe(false);
      expect(report.findings.some((f) => f.ruleId === 'fastapi-broad-cors')).toBe(true);
    });

    it('includes Python files in graph review', () => {
      const dir = mkdtempSync(join(tmpdir(), 'kern-review-fastapi-'));
      try {
        mkdirSync(join(dir, 'routes'), { recursive: true });
        const file = join(dir, 'routes', 'users.py');
        writeFileSync(
          file,
          `
from fastapi import APIRouter

router = APIRouter()

@router.get("/users")
async def users():
    return [{"id": "1"}]
`,
        );

        const reports = reviewGraph([file], { target: 'fastapi', noCache: true });
        const report = reports.find((r) => r.filePath === file);
        expect(report).toBeDefined();
        expect(report!.findings.some((f) => f.ruleId === 'missing-python-support')).toBe(false);
        expect(report!.findings.some((f) => f.ruleId === 'fastapi-missing-response-model')).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('extracts Python concepts for cross-stack partner caches', () => {
      const dir = mkdtempSync(join(tmpdir(), 'kern-review-fastapi-concepts-'));
      try {
        const file = join(dir, 'main.py');
        writeFileSync(
          file,
          `
from fastapi import FastAPI

app = FastAPI()

@app.get("/health")
async def health():
    return {"ok": True}
`,
        );

        const concepts = extractConceptsForGraph([file]);
        const conceptMap = concepts.get(file);
        expect(conceptMap).toBeDefined();
        expect(conceptMap!.nodes.some((node) => node.kind === 'entrypoint')).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // ── fastapi-missing-response-model ──────────────────────────────────────

  describe('fastapi-missing-response-model', () => {
    it('detects route returning data without response_model', () => {
      const source = `
@app.get("/items")
async def get_items():
    return [{"name": "item1"}]
`;
      const findings = run(source, [makeRouteNode('app.py', 'get_items', 2, 4, '@app.get("/items")', 'GET')]);
      const f = findings.find((f) => f.ruleId === 'fastapi-missing-response-model');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('warning');
      expect(f!.message).toContain('get_items');
    });

    it('does not flag route with response_model', () => {
      const source = `
@app.get("/items", response_model=list[Item])
async def get_items():
    return [{"name": "item1"}]
`;
      const findings = run(source, [
        makeRouteNode('app.py', 'get_items', 2, 4, '@app.get("/items", response_model=list[Item])', 'GET'),
      ]);
      const f = findings.find((f) => f.ruleId === 'fastapi-missing-response-model');
      expect(f).toBeUndefined();
    });

    it('does not flag route that returns None', () => {
      const source = `
@app.delete("/items/{id}")
async def delete_item(id: int):
    db.delete(id)
    return None
`;
      const findings = run(source, [
        makeRouteNode('app.py', 'delete_item', 2, 5, '@app.delete("/items/{id}")', 'DELETE'),
      ]);
      const f = findings.find((f) => f.ruleId === 'fastapi-missing-response-model');
      expect(f).toBeUndefined();
    });

    it('does not flag route that returns JSONResponse', () => {
      const source = `
@app.get("/custom")
async def custom():
    return JSONResponse(content={"msg": "ok"})
`;
      const findings = run(source, [makeRouteNode('app.py', 'custom', 2, 4, '@app.get("/custom")', 'GET')]);
      const f = findings.find((f) => f.ruleId === 'fastapi-missing-response-model');
      expect(f).toBeUndefined();
    });
  });

  // ── fastapi-blocking-sync-route ─────────────────────────────────────────

  describe('fastapi-blocking-sync-route', () => {
    it('detects requests.get in async route', () => {
      const source = `
@app.get("/proxy")
async def proxy():
    resp = requests.get("https://api.example.com/data")
    return resp.json()
`;
      const findings = run(source, [makeRouteNode('app.py', 'proxy', 2, 5, '@app.get("/proxy")', 'GET')]);
      const f = findings.find((f) => f.ruleId === 'fastapi-blocking-sync-route');
      expect(f).toBeDefined();
      expect(f!.message).toContain('blocking');
      expect(f!.message).toContain('requests');
    });

    it('detects time.sleep in async route', () => {
      const source = `
@app.get("/slow")
async def slow():
    time.sleep(5)
    return {"status": "done"}
`;
      const findings = run(source, [makeRouteNode('app.py', 'slow', 2, 5, '@app.get("/slow")', 'GET')]);
      const f = findings.find((f) => f.ruleId === 'fastapi-blocking-sync-route');
      expect(f).toBeDefined();
      expect(f!.message).toContain('time.sleep');
    });

    it('detects open() in async route', () => {
      const source = `
@app.get("/file")
async def read_file():
    f = open("/etc/config")
    return f.read()
`;
      const findings = run(source, [makeRouteNode('app.py', 'read_file', 2, 5, '@app.get("/file")', 'GET')]);
      const f = findings.find((f) => f.ruleId === 'fastapi-blocking-sync-route');
      expect(f).toBeDefined();
    });

    it('does not flag sync def route (FastAPI runs those in threadpool)', () => {
      const source = `
@app.get("/sync")
def sync_route():
    resp = requests.get("https://api.example.com/data")
    return resp.json()
`;
      const findings = run(source, [makeRouteNode('app.py', 'sync_route', 2, 5, '@app.get("/sync")', 'GET')]);
      const f = findings.find((f) => f.ruleId === 'fastapi-blocking-sync-route');
      expect(f).toBeUndefined();
    });

    it('does not flag async route without blocking calls', () => {
      const source = `
@app.get("/fast")
async def fast():
    data = await fetch_data()
    return data
`;
      const findings = run(source, [makeRouteNode('app.py', 'fast', 2, 5, '@app.get("/fast")', 'GET')]);
      const f = findings.find((f) => f.ruleId === 'fastapi-blocking-sync-route');
      expect(f).toBeUndefined();
    });
  });

  // ── fastapi-shared-state ────────────────────────────────────────────────

  describe('fastapi-shared-state', () => {
    it('detects global state mutation inside route', () => {
      const source = `
cache = {}

@app.post("/update")
async def update(data: dict):
    cache["key"] = data
    return {"ok": True}
`;
      const findings = run(source, [
        makeRouteNode('app.py', 'update', 4, 7, '@app.post("/update")', 'POST'),
        makeStateMutationNode('app.py', 'cache', 'global', 6),
      ]);
      const f = findings.find((f) => f.ruleId === 'fastapi-shared-state');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('error');
      expect(f!.message).toContain('cache');
      expect(f!.message).toContain('global');
    });

    it('detects module-level state mutation inside route', () => {
      const source = `
_counter = 0

@app.get("/count")
async def count():
    global _counter
    _counter += 1
    return {"count": _counter}
`;
      const findings = run(source, [
        makeRouteNode('app.py', 'count', 4, 8, '@app.get("/count")', 'GET'),
        makeStateMutationNode('app.py', '_counter', 'module', 7),
      ]);
      const f = findings.find((f) => f.ruleId === 'fastapi-shared-state');
      expect(f).toBeDefined();
      expect(f!.message).toContain('module');
    });

    it('does not flag local state mutation inside route', () => {
      const source = `
@app.get("/items")
async def get_items():
    items = []
    items.append("new")
    return items
`;
      const findings = run(source, [
        makeRouteNode('app.py', 'get_items', 2, 6, '@app.get("/items")', 'GET'),
        makeStateMutationNode('app.py', 'items', 'local', 4),
      ]);
      const f = findings.find((f) => f.ruleId === 'fastapi-shared-state');
      expect(f).toBeUndefined();
    });

    it('does not flag mutation outside route scope', () => {
      const source = `
cache = {}
cache["init"] = True

@app.get("/read")
async def read():
    return cache
`;
      const findings = run(source, [
        makeRouteNode('app.py', 'read', 5, 7, '@app.get("/read")', 'GET'),
        makeStateMutationNode('app.py', 'cache', 'global', 3), // outside route
      ]);
      const f = findings.find((f) => f.ruleId === 'fastapi-shared-state');
      expect(f).toBeUndefined();
    });
  });

  // ── fastapi-broad-except ────────────────────────────────────────────────

  describe('fastapi-broad-except', () => {
    it('detects broad except without re-raise in route', () => {
      const source = `
@app.get("/risky")
async def risky():
    try:
        do_something()
    except Exception as e:
        return {"error": "something went wrong"}
`;
      const findings = run(source, [
        makeRouteNode('app.py', 'risky', 2, 7, '@app.get("/risky")', 'GET'),
        makeErrorHandleNode('app.py', 6),
      ]);
      const f = findings.find((f) => f.ruleId === 'fastapi-broad-except');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('warning');
      expect(f!.message).toContain('broad exceptions');
    });

    it('does not flag broad except that re-raises HTTPException', () => {
      const source = `
@app.get("/risky")
async def risky():
    try:
        do_something()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
`;
      const findings = run(source, [
        makeRouteNode('app.py', 'risky', 2, 7, '@app.get("/risky")', 'GET'),
        makeErrorHandleNode('app.py', 6),
      ]);
      const f = findings.find((f) => f.ruleId === 'fastapi-broad-except');
      expect(f).toBeUndefined();
    });

    it('does not flag broad except that re-raises with raise', () => {
      const source = `
@app.get("/risky")
async def risky():
    try:
        do_something()
    except Exception as e:
        logger.error(e)
        raise
`;
      const findings = run(source, [
        makeRouteNode('app.py', 'risky', 2, 8, '@app.get("/risky")', 'GET'),
        makeErrorHandleNode('app.py', 6),
      ]);
      const f = findings.find((f) => f.ruleId === 'fastapi-broad-except');
      expect(f).toBeUndefined();
    });

    it('does not flag specific exception catch', () => {
      const source = `
@app.get("/risky")
async def risky():
    try:
        do_something()
    except ValueError as e:
        return {"error": str(e)}
`;
      // ValueError is not a broad catch — the regex only matches bare `except:` or `except Exception`
      const findings = run(source, [
        makeRouteNode('app.py', 'risky', 2, 7, '@app.get("/risky")', 'GET'),
        makeErrorHandleNode('app.py', 6),
      ]);
      const f = findings.find((f) => f.ruleId === 'fastapi-broad-except');
      expect(f).toBeUndefined();
    });

    it('does not flag route without error_handle concept nodes', () => {
      const source = `
@app.get("/safe")
async def safe():
    return {"status": "ok"}
`;
      const findings = run(source, [
        makeRouteNode('app.py', 'safe', 2, 4, '@app.get("/safe")', 'GET'),
        // No error_handle nodes
      ]);
      const f = findings.find((f) => f.ruleId === 'fastapi-broad-except');
      expect(f).toBeUndefined();
    });
  });

  // ── fastapi-broad-cors ──────────────────────────────────────────────────

  describe('fastapi-broad-cors', () => {
    it('detects wildcard CORS origins', () => {
      const source = `
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
)
`;
      const findings = run(source, []);
      const f = findings.find((f) => f.ruleId === 'fastapi-broad-cors');
      expect(f).toBeDefined();
      expect(f!.severity).toBe('warning');
      expect(f!.message).toContain('allow_origins');
    });

    it('does not flag specific CORS origins', () => {
      const source = `
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://example.com", "https://app.example.com"],
    allow_methods=["GET", "POST"],
)
`;
      const findings = run(source, []);
      const f = findings.find((f) => f.ruleId === 'fastapi-broad-cors');
      expect(f).toBeUndefined();
    });

    it('detects wildcard with single quotes', () => {
      const source = `
app.add_middleware(CORSMiddleware, allow_origins=['*'])
`;
      const findings = run(source, []);
      const f = findings.find((f) => f.ruleId === 'fastapi-broad-cors');
      expect(f).toBeDefined();
    });
  });
});
