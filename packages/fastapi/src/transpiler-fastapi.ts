/**
 * @kernlang/fastapi — FastAPI Python backend transpiler
 *
 * IR → Python/FastAPI multi-file output.
 * Blueprint: transpiler-express.ts — same IR nodes, same multi-file pattern, Python output.
 */

import type {
  AccountedEntry,
  GeneratedArtifact,
  IRNode,
  ResolvedKernConfig,
  SourceMapEntry,
  TranspileResult,
} from '@kernlang/core';
import {
  accountNode,
  buildDiagnostics,
  countTokens,
  getChildren,
  getFirstChild,
  getProps,
  serializeIR,
} from '@kernlang/core';
import { generatePythonCoreNode } from './codegen-python.js';
import { buildCorsMiddlewareLine, resolveMiddlewareUsage } from './fastapi-middleware.js';
import { buildRouteArtifact } from './fastapi-route.js';
import type { MiddlewareArtifactRef } from './fastapi-types.js';
import { analyzeRouteCapabilities, findServerNode } from './fastapi-utils.js';
import { buildWebSocketArtifact } from './fastapi-websocket.js';

// ── Main transpiler ──────────────────────────────────────────────────────

export function transpileFastAPI(root: IRNode, _config?: ResolvedKernConfig): TranspileResult {
  const sourceMap: SourceMapEntry[] = [];
  const accounted = new Map<IRNode, AccountedEntry>();
  const middlewareArtifacts = new Map<string, MiddlewareArtifactRef>();
  const serverNode = findServerNode(root) || root;
  accountNode(accounted, root, 'consumed', 'parse root');
  if (serverNode !== root) accountNode(accounted, serverNode, 'consumed', 'server container');

  const serverProps = getProps(serverNode);
  const serverName = String(serverProps.name || 'KernFastAPIServer');
  const port = String(serverProps.port || '8000');
  const serverMiddlewares = getChildren(serverNode, 'middleware');
  for (const mw of serverMiddlewares) accountNode(accounted, mw, 'consumed', 'server middleware', true);
  const routeNodes = getChildren(serverNode, 'route');
  for (const rn of routeNodes) accountNode(accounted, rn, 'consumed', 'route artifact', true);
  const websocketNodes = getChildren(serverNode, 'websocket');
  for (const ws of websocketNodes) accountNode(accounted, ws, 'consumed', 'websocket handler', true);
  const hasHealthRoute = routeNodes.some((routeNode) => {
    const props = getProps(routeNode);
    return String(props.path || '/') === '/health' && String(props.method || 'get').toLowerCase() === 'get';
  });

  const isStrict = !_config || (_config.fastapi?.security ?? 'strict') === 'strict';
  const corsEnabled = _config?.fastapi?.cors ?? false;
  const gzipEnabled = _config?.fastapi?.gzip ?? false;
  const uvicornHost = _config?.fastapi?.uvicorn?.host ?? '0.0.0.0';
  const uvicornReload = isStrict ? false : (_config?.fastapi?.uvicorn?.reload ?? false);
  const uvicornWorkers = _config?.fastapi?.uvicorn?.workers;

  // Collect top-level core language nodes (type, interface, fn, machine, etc.)
  // Exclude child-only types (field, transition, handler, describe, it, etc.)
  const TOP_LEVEL_CORE = new Set([
    'type',
    'interface',
    'fn',
    'machine',
    'error',
    'module',
    'config',
    'store',
    'test',
    'event',
    'import',
    'const',
    // Data layer
    'model',
    'repository',
    'cache',
    'dependency',
    'service',
    'union',
    // Backend infrastructure
    'job',
    'storage',
    'email',
    // Ground layer
    'derive',
    'transform',
    'action',
    'guard',
    'assume',
    'invariant',
    'each',
    'collect',
    'branch',
    'resolve',
    'expect',
    'recover',
  ]);
  // Core nodes may live as siblings of server under the parse root, or as server children.
  const rootChildren = root.children || [];
  const serverChildren = serverNode !== root ? serverNode.children || [] : [];
  const coreNodes = [
    ...rootChildren.filter((c) => TOP_LEVEL_CORE.has(c.type)),
    ...serverChildren.filter((c) => TOP_LEVEL_CORE.has(c.type)),
  ];
  // If the root itself is a core node (parser wraps first top-level node as root), include it
  if (TOP_LEVEL_CORE.has(root.type) && root !== serverNode) {
    coreNodes.unshift(root);
  }
  for (const cn of coreNodes) accountNode(accounted, cn, 'expressed', 'core artifact', true);

  const serverImports = new Set<string>();
  const middlewareLines: string[] = [];

  serverImports.add('from fastapi import FastAPI');
  if (
    !isStrict ||
    routeNodes.some((r) => {
      const caps = analyzeRouteCapabilities(r);
      return caps.hasTimer;
    })
  ) {
    serverImports.add('from fastapi import HTTPException');
  }
  if (isStrict) {
    serverImports.add('import logging');
    serverImports.add('from uuid import uuid4');
  }
  serverImports.add('import uvicorn');

  // Config-level cors/gzip
  if (corsEnabled) {
    if (isStrict) serverImports.add('import os');
    serverImports.add('from fastapi.middleware.cors import CORSMiddleware');
    middlewareLines.push(buildCorsMiddlewareLine(isStrict));
  }
  if (gzipEnabled) {
    serverImports.add('from fastapi.middleware.gzip import GZipMiddleware');
    middlewareLines.push('app.add_middleware(GZipMiddleware)');
  }

  // IR-level middleware
  for (const middlewareNode of serverMiddlewares) {
    if (isStrict && String(getProps(middlewareNode).name || '') === 'cors') {
      serverImports.add('import os');
    }
    const usage = resolveMiddlewareUsage(middlewareNode, middlewareArtifacts, isStrict);
    if (usage.importLine) serverImports.add(usage.importLine);
    middlewareLines.push(usage.addLine);
  }

  // Build route artifacts
  const routeArtifacts = routeNodes.map((routeNode, index) => buildRouteArtifact(routeNode, index, sourceMap));

  // Auth: generate auth.py artifact when any route uses auth
  const hasAuth = routeNodes.some((r) => getFirstChild(r, 'auth'));
  let authArtifact: GeneratedArtifact | null = null;
  if (hasAuth) {
    authArtifact = {
      path: 'auth.py',
      content: [
        `from fastapi import Depends, HTTPException`,
        `from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials`,
        `from jose import JWTError, jwt`,
        `import os`,
        ``,
        ...(isStrict
          ? [
              `JWT_SECRET = os.environ.get("JWT_SECRET")`,
              ``,
              `if not JWT_SECRET:`,
              `    raise RuntimeError("JWT_SECRET environment variable is required in strict mode")`,
            ]
          : [`JWT_SECRET = os.environ.get("JWT_SECRET", "change-me-in-production")`]),
        `JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")`,
        ``,
        `security = HTTPBearer()`,
        `security_optional = HTTPBearer(auto_error=False)`,
        ``,
        ``,
        `async def auth_required(`,
        `    credentials: HTTPAuthorizationCredentials = Depends(security),`,
        `) -> dict:`,
        `    try:`,
        `        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])`,
        `        return payload`,
        `    except JWTError:`,
        `        raise HTTPException(status_code=401, detail="Invalid or expired token")`,
        ``,
        ``,
        `async def auth_optional(`,
        `    credentials: HTTPAuthorizationCredentials | None = Depends(security_optional),`,
        `) -> dict | None:`,
        `    if not credentials:`,
        `        return None`,
        `    try:`,
        `        return jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])`,
        `    except JWTError:`,
        `        return None`,
      ].join('\n'),
      type: 'lib' as GeneratedArtifact['type'],
    };
    serverImports.add('from auth import auth_required, auth_optional');
  }

  // Build websocket artifacts
  const wsArtifacts = websocketNodes.map((wsNode, index) => buildWebSocketArtifact(wsNode, index, sourceMap));

  // WebSocket imports
  if (wsArtifacts.length > 0) {
    serverImports.add('from fastapi import WebSocket');
    serverImports.add('from starlette.websockets import WebSocketDisconnect');
  }

  // Route imports
  for (const route of routeArtifacts) {
    serverImports.add(`from routes.${route.fileBase} import router as ${route.routerName}`);
  }

  // WebSocket imports
  for (const ws of wsArtifacts) {
    serverImports.add(`from ws.${ws.fileBase} import ${ws.funcName}`);
  }

  // Collect imports needed by core language nodes
  const coreTypes = new Set(coreNodes.map((n) => n.type));
  const hasExplicitDb = coreNodes.some((n) => n.type === 'dependency' && String(n.props?.kind) === 'database');
  if (coreTypes.has('model')) {
    serverImports.add('from sqlmodel import SQLModel, Field, Relationship');
    // Implicit DB connection: add engine/session imports when models exist but no explicit database dependency
    if (!hasExplicitDb) {
      serverImports.add('import os');
      serverImports.add('from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession');
      serverImports.add('from sqlalchemy.orm import sessionmaker');
    }
  }
  if (coreTypes.has('union')) {
    serverImports.add('from pydantic import BaseModel');
    serverImports.add('from typing import Literal, Union');
  }
  if (coreTypes.has('repository')) {
    serverImports.add('from sqlalchemy.ext.asyncio import AsyncSession');
  }
  // Scan model columns for type-specific imports
  for (const node of coreNodes) {
    if (node.type === 'model') {
      for (const col of getChildren(node, 'column')) {
        const colType = (col.props?.type as string) || '';
        if (colType === 'uuid') serverImports.add('from uuid import UUID');
        if (['date', 'datetime', 'timestamp', 'Timestamp'].includes(colType))
          serverImports.add('from datetime import date, datetime');
        if (['decimal', 'Money'].includes(colType)) serverImports.add('from decimal import Decimal');
        if (colType === 'json') serverImports.add('from typing import Any');
      }
    }
  }

  // ── Generate main.py ──────────────────────────────────────────────────

  const lines: string[] = [];

  // Imports
  for (const imp of [...serverImports].sort()) {
    lines.push(imp);
  }
  lines.push('');

  // Core language nodes (models, types, etc.)
  if (coreNodes.length > 0) {
    lines.push('');
    for (const node of coreNodes) {
      const coreLines = generatePythonCoreNode(node);
      if (coreLines.length > 0) {
        lines.push(...coreLines);
        lines.push('');
      }
    }
  }

  // Implicit DB connection boilerplate (when models exist but no explicit database dependency)
  if (coreTypes.has('model') && !hasExplicitDb) {
    lines.push('# Database connection');
    lines.push('DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite+aiosqlite:///./app.db")');
    lines.push('engine = create_async_engine(DATABASE_URL, echo=False)');
    lines.push('async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)');
    lines.push('');
    lines.push('');
    lines.push('async def get_db():');
    lines.push('    async with async_session() as session:');
    lines.push('        yield session');
    lines.push('');
    lines.push('');
    lines.push('async def init_db():');
    lines.push('    async with engine.begin() as conn:');
    lines.push('        await conn.run_sync(SQLModel.metadata.create_all)');
    lines.push('');
  }

  // App instantiation
  lines.push(`app = FastAPI(title="${serverName}")`);
  lines.push('');

  // DB startup event
  if (coreTypes.has('model') && !hasExplicitDb) {
    lines.push('');
    lines.push('@app.on_event("startup")');
    lines.push('async def startup():');
    lines.push('    await init_db()');
    lines.push('');
  }

  // Request ID middleware (strict mode)
  if (isStrict) {
    lines.push('');
    lines.push('@app.middleware("http")');
    lines.push('async def add_request_id(request, call_next):');
    lines.push('    request_id = str(uuid4())');
    lines.push('    request.state.request_id = request_id');
    lines.push('    response = await call_next(request)');
    lines.push('    response.headers["X-Request-ID"] = request_id');
    lines.push('    return response');
    lines.push('');
  }

  // Middleware
  for (const mLine of middlewareLines) {
    lines.push(mLine);
  }
  if (middlewareLines.length > 0) {
    lines.push('');
  }

  // Health check — before user routes so it can't be shadowed by catch-all
  if (isStrict && !hasHealthRoute) {
    lines.push('@app.get("/health")');
    lines.push('async def health_check():');
    lines.push('    return {"status": "ok"}');
    lines.push('');
  }

  // Router includes
  for (const route of routeArtifacts) {
    lines.push(`app.include_router(${route.routerName})`);
  }
  if (routeArtifacts.length > 0) {
    lines.push('');
  }

  // WebSocket route decorators
  for (const ws of wsArtifacts) {
    lines.push(`app.websocket("${ws.wsPath}")(${ws.funcName})`);
  }
  if (wsArtifacts.length > 0) {
    lines.push('');
  }

  // Error handlers
  if (isStrict) {
    lines.push('');
    lines.push('@app.exception_handler(Exception)');
    lines.push('async def global_exception_handler(request, exc):');
    lines.push('    from fastapi.responses import JSONResponse');
    lines.push('    logging.exception("Unhandled exception")');
    lines.push('    return JSONResponse(status_code=500, content={"error": "Internal Server Error"})');
  } else {
    lines.push('');
    lines.push('@app.exception_handler(Exception)');
    lines.push('async def global_exception_handler(request, exc):');
    lines.push('    from fastapi.responses import JSONResponse');
    lines.push('    return JSONResponse(status_code=500, content={"error": str(exc)})');
  }

  lines.push('');
  lines.push('');
  lines.push('if __name__ == "__main__":');
  const uvicornTarget = uvicornReload || (uvicornWorkers !== undefined && uvicornWorkers > 1) ? '"main:app"' : 'app';
  const uvicornOpts: string[] = [uvicornTarget, `host="${uvicornHost}"`, `port=${port}`];
  if (uvicornReload) uvicornOpts.push('reload=True');
  if (uvicornWorkers && uvicornWorkers > 1) uvicornOpts.push(`workers=${uvicornWorkers}`);
  lines.push(`    uvicorn.run(${uvicornOpts.join(', ')})`);

  // ── Assemble result ────────────────────────────────────────────────────

  sourceMap.unshift({
    irLine: serverNode.loc?.line || root.loc?.line || 0,
    irCol: serverNode.loc?.col || root.loc?.col || 1,
    outLine: 1,
    outCol: 1,
  });

  // Alembic migration scaffolding when models exist
  const alembicArtifacts: GeneratedArtifact[] = [];
  if (coreTypes.has('model')) {
    alembicArtifacts.push({
      path: 'alembic.ini',
      content: [
        '# Generated by KERN. Run migrations:',
        '#   alembic revision --autogenerate -m "init"',
        '#   alembic upgrade head',
        '',
        '[alembic]',
        'script_location = alembic',
        'sqlalchemy.url = sqlite+aiosqlite:///./app.db',
      ].join('\n'),
      type: 'config',
    });
    alembicArtifacts.push({
      path: 'alembic/env.py',
      content: [
        `from logging.config import fileConfig`,
        `from sqlalchemy import engine_from_config, pool`,
        `from alembic import context`,
        `from sqlmodel import SQLModel`,
        ``,
        `# Import models so metadata is populated`,
        `from main import *  # noqa: F403`,
        ``,
        `config = context.config`,
        `if config.config_file_name is not None:`,
        `    fileConfig(config.config_file_name)`,
        ``,
        `target_metadata = SQLModel.metadata`,
        ``,
        ``,
        `def run_migrations_offline():`,
        `    url = config.get_main_option("sqlalchemy.url")`,
        `    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)`,
        `    with context.begin_transaction():`,
        `        context.run_migrations()`,
        ``,
        ``,
        `def run_migrations_online():`,
        `    connectable = engine_from_config(`,
        `        config.get_section(config.config_ini_section, {}),`,
        `        prefix="sqlalchemy.",`,
        `        poolclass=pool.NullPool,`,
        `    )`,
        `    with connectable.connect() as connection:`,
        `        context.configure(connection=connection, target_metadata=target_metadata)`,
        `        with context.begin_transaction():`,
        `            context.run_migrations()`,
        ``,
        ``,
        `if context.is_offline_mode():`,
        `    run_migrations_offline()`,
        `else:`,
        `    run_migrations_online()`,
      ].join('\n'),
      type: 'config',
    });
  }

  const artifacts: GeneratedArtifact[] = [
    ...routeArtifacts.map((r) => r.artifact),
    ...wsArtifacts.map((w) => w.artifact),
    ...[...middlewareArtifacts.values()].map((m) => m.artifact),
    ...(authArtifact ? [authArtifact] : []),
    ...alembicArtifacts,
  ];

  const output = lines.join('\n');
  const irText = serializeIR(root);
  const allText = [output, ...artifacts.map((a) => a.content)].join('\n');
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(allText);
  const tokenReduction = Math.round((1 - irTokenCount / tsTokenCount) * 100);

  return {
    code: output,
    sourceMap,
    irTokenCount,
    tsTokenCount,
    tokenReduction,
    artifacts,
    diagnostics: buildDiagnostics(root, accounted, 'fastapi'),
  };
}
