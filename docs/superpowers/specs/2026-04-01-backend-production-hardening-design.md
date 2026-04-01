# Backend Production Hardening — Express & FastAPI

**Date:** 2026-04-01
**Status:** Approved
**Scope:** 10 fixes across both transpilers to bring generated backends to production readiness

## Context

KERN's Express and FastAPI transpilers generate runnable multi-file backend projects from KERN IR. Both have feature parity on routes, WebSocket, SSE, auth, middleware, database, and infrastructure artifacts. However, the generated code has security, stability, and operations gaps that prevent production deployment.

**Assessment:** Express ~65% production-ready, FastAPI ~80% production-ready.
**Validated by:** Evil Twin challenge, synthesis tribunal (Gemini + OpenCode), Codex review. All citations verified against source.

## Gap Summary

### Express (8 gaps — `packages/express/src/transpiler-express.ts`)

| # | Severity | Gap | Line(s) |
|---|----------|-----|---------|
| E1 | HIGH | JWT default secret fallback `'change-me-in-production'` | 1155 |
| E2 | HIGH | JWT `jwt.verify` no algorithm pinning | 1177, 1189 |
| E3 | HIGH | WebSocket `JSON.parse(raw.toString())` no try/catch | 1308 |
| E4 | HIGH | No graceful shutdown despite SSE/WS/spawn | 1360-1368 |
| E5 | HIGH | CORS `cors()` bare — no origin restriction | 482 |
| E6 | MEDIUM | `assertRequiredFields` checks existence only, not types | 803-812 |
| E7 | MEDIUM | No health check endpoint | N/A |
| E8 | LOW | No request ID middleware | N/A (deferred) |

### FastAPI (8 gaps — `packages/fastapi/src/transpiler-fastapi.ts`)

| # | Severity | Gap | Line(s) |
|---|----------|-----|---------|
| F1 | HIGH | JWT default secret fallback `"change-me-in-production"` | 1011 |
| F2 | HIGH | `auth_optional` broken — `HTTPBearer(auto_error=True)` rejects before handler | 1014, 1028 |
| F3 | HIGH | CORS hardcoded `allow_origins=["*"]` (two sites) | 786, 980 |
| F4 | MEDIUM | WebSocket `receive_json()` only catches `WebSocketDisconnect` | 881 |
| F5 | MEDIUM | Global exception handler doesn't log | 1176 |
| F6 | MEDIUM | No health check endpoint | N/A |
| F7 | LOW | `uvicorn.run()` needs string path for `reload`/`workers>1` | 1196 |
| F8 | LOW | No request ID middleware | N/A (deferred) |

## Design

### Security Fixes (5 changes)

#### S1: JWT Secret — fail-fast in strict mode (E1, F1)

Both transpilers currently generate a fallback secret. In strict mode, generate code that throws/raises on startup if `JWT_SECRET` is not set. In relaxed mode, keep the fallback for local dev.

**Express** (`transpiler-express.ts:1155`):
```typescript
// Strict mode:
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
// Relaxed mode (unchanged):
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
```

**FastAPI** (`transpiler-fastapi.ts:1011`):
```python
# Strict mode:
JWT_SECRET = os.environ.get("JWT_SECRET")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET environment variable is required")
# Relaxed mode (unchanged):
JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-production")
```

#### S2: Express JWT algorithm pinning (E2)

Add `{ algorithms: ['HS256'] }` to both `jwt.verify` calls in the generated auth middleware.

**Location:** `transpiler-express.ts:1177` and `:1189`

```typescript
// Before:
jwt.verify(header.slice(7), JWT_SECRET) as AuthUser;
// After:
jwt.verify(header.slice(7), JWT_SECRET, { algorithms: ['HS256'] }) as AuthUser;
```

#### S3: FastAPI auth_optional fix (F2)

`HTTPBearer()` defaults to `auto_error=True`, which rejects unauthenticated requests with 403 before `auth_optional` runs.

**Location:** `transpiler-fastapi.ts:1014`

Generate a separate `HTTPBearer(auto_error=False)` instance for optional auth:
```python
security = HTTPBearer()
security_optional = HTTPBearer(auto_error=False)

async def auth_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(security_optional),
) -> dict | None:
```

#### S4: CORS — env-driven origins in strict mode (E5, F3)

**Express** (`transpiler-express.ts:482`):
```typescript
// Strict:
cors({ origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : [] })
// Relaxed (unchanged):
cors()
```

**FastAPI** (`transpiler-fastapi.ts:786` and `:980`):
```python
# Strict:
allow_origins=os.environ.get("CORS_ORIGINS", "").split(",")
# Relaxed (unchanged):
allow_origins=["*"]
```

#### S5: WebSocket JSON safety (E3, F4)

**Express** (`transpiler-express.ts:1308`):
```typescript
// Before:
const data = JSON.parse(raw.toString());
// After:
let data: unknown;
try { data = JSON.parse(raw.toString()); } catch { ws.send(JSON.stringify({ error: 'Invalid JSON' })); return; }
```

**FastAPI** (`transpiler-fastapi.ts:881`):
```python
# Before:
try:
    while True:
        data = await websocket.receive_json()
        ...
except WebSocketDisconnect:
    pass
# After:
try:
    while True:
        try:
            data = await websocket.receive_json()
        except (ValueError, RuntimeError):
            await websocket.send_json({"error": "Invalid JSON"})
            continue
        ...
except WebSocketDisconnect:
    pass
```

### Stability Fixes (3 changes)

#### T1: Express graceful shutdown (E4)

**Location:** `transpiler-express.ts:1360-1368` — replace the `app.listen` / `server.listen` block.

Generate SIGTERM/SIGINT handlers that:
1. Call `server.close()` to stop accepting new connections
2. If models exist, call `prisma.$disconnect()`
3. Set a 30s timeout, then `process.exit(1)`

```typescript
const server = app.listen(port, () => { ... });

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  setTimeout(() => { console.error('Forced shutdown'); process.exit(1); }, 30000);
}
```

When WebSocket is present, the `server` variable already exists (from `createServer`). The shutdown handler stays the same.

#### T2: FastAPI exception logging (F5)

**Location:** `transpiler-fastapi.ts:1176`

Add `import logging` at the top and `logging.exception(exc)` before returning the error response:
```python
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logging.exception(exc)
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=500, content={"error": "Internal Server Error"})
```

#### T3: FastAPI uvicorn string path (F7)

**Location:** `transpiler-fastapi.ts:1191-1198`

When `reload=True` or `workers>1`, emit `"main:app"` (string import path) instead of `app`:
```python
# Before:
uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
# After:
uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
```

### Operations Fixes (1 change, deferred 1)

#### O1: Health check endpoint (E7, F6)

In strict mode, generate a `/health` endpoint before route registration.

**Express:**
```typescript
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
```

**FastAPI:**
```python
@app.get("/health")
async def health():
    return {"status": "ok"}
```

#### O2: Request ID middleware (E8, F8) — DEFERRED

Low priority. Can be added later without breaking changes.

## Validation — existing assertRequiredFields (E6)

The `assertRequiredFields` gap (existence-only validation) is MEDIUM severity. Enhancing it to check types would require the transpiler to propagate KERN IR type information into the route validator. This is a larger change than the other fixes.

**Decision:** Defer to a follow-up. The security and stability fixes are more urgent and self-contained. Note: FastAPI doesn't have this problem because Pydantic validates types automatically.

## Testing Strategy

Each fix needs at least one test in the corresponding test file:
- `packages/express/tests/express.test.ts`
- `packages/fastapi/tests/fastapi.test.ts`

Tests should verify the generated code contains the expected patterns (string matching on transpiler output), not run the generated code.

Existing golden/snapshot tests must still pass — update snapshots where the generated output changes.

## Implementation Order

1. **S1-S5** — Security fixes (highest severity, independent of each other)
2. **T1-T3** — Stability fixes
3. **O1** — Health check
4. Update snapshots, run full test suite

## Files Modified

- `packages/express/src/transpiler-express.ts` (7 changes: E1-E5, E7, E4)
- `packages/fastapi/src/transpiler-fastapi.ts` (7 changes: F1-F3, F4-F7)
- `packages/express/tests/express.test.ts` (new test cases)
- `packages/fastapi/tests/fastapi.test.ts` (new test cases)
- Snapshot files (updated)
