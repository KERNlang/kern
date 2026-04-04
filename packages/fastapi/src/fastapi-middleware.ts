/**
 * Middleware artifact builders for the FastAPI transpiler.
 */

import type { IRNode } from '@kernlang/core';
import { getFirstChild, getProps } from '@kernlang/core';
import type { MiddlewareArtifactRef, MiddlewareUsage } from './fastapi-types.js';
import { slugify } from './fastapi-utils.js';

export function buildMiddlewareArtifact(node: IRNode): MiddlewareArtifactRef {
  const props = getProps(node);
  const name = String(props.name || 'middleware');
  const fileBase = slugify(name);
  const className = `${name.charAt(0).toUpperCase() + name.slice(1)}Middleware`;

  const handlerNode = getFirstChild(node, 'handler');
  const handlerProps = handlerNode ? getProps(handlerNode) : {};
  const handlerCode = typeof handlerProps.code === 'string' ? String(handlerProps.code) : '';

  const lines: string[] = [];
  lines.push('from starlette.middleware.base import BaseHTTPMiddleware');
  lines.push('from starlette.requests import Request');
  lines.push('from starlette.responses import Response');
  lines.push('');
  lines.push('');
  lines.push(`class ${className}(BaseHTTPMiddleware):`);
  lines.push(`    async def dispatch(self, request: Request, call_next) -> Response:`);
  if (handlerCode) {
    for (const line of handlerCode.split('\n')) {
      lines.push(`        ${line}`);
    }
  } else {
    lines.push('        response = await call_next(request)');
    lines.push('        return response');
  }

  return {
    className,
    fileBase,
    artifact: {
      path: `middleware/${fileBase}.py`,
      content: lines.join('\n'),
      type: 'middleware',
    },
  };
}

// ── Built-in middleware mapping ───────────────────────────────────────────

export function buildCorsMiddlewareLine(isStrict: boolean): string {
  return isStrict
    ? 'app.add_middleware(CORSMiddleware, allow_origins=[origin.strip() for origin in os.environ.get("CORS_ORIGINS", "").split(",") if origin.strip()], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])'
    : 'app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])';
}

export function resolveMiddlewareUsage(
  node: IRNode,
  middlewareArtifacts: Map<string, MiddlewareArtifactRef>,
  isStrict = false,
): MiddlewareUsage {
  const props = getProps(node);
  const name = String(props.name || 'middleware');

  if (name === 'cors') {
    return {
      importLine: 'from fastapi.middleware.cors import CORSMiddleware',
      addLine: buildCorsMiddlewareLine(isStrict),
    };
  }

  if (name === 'gzip') {
    return {
      importLine: 'from fastapi.middleware.gzip import GZipMiddleware',
      addLine: 'app.add_middleware(GZipMiddleware)',
    };
  }

  if (name === 'json') {
    // FastAPI handles JSON automatically via Pydantic — no-op
    return { addLine: '# JSON parsing handled automatically by FastAPI/Pydantic' };
  }

  if (name === 'rateLimit' || name === 'rate-limit' || name === 'rateLimiter') {
    return {
      importLine:
        'from slowapi import Limiter, _rate_limit_exceeded_handler\nfrom slowapi.util import get_remote_address\nfrom slowapi.errors import RateLimitExceeded',
      addLine:
        'limiter = Limiter(key_func=get_remote_address)\napp.state.limiter = limiter\napp.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)',
    };
  }

  // Custom middleware
  const existing = middlewareArtifacts.get(slugify(name));
  if (existing) {
    return {
      importLine: `from middleware.${existing.fileBase} import ${existing.className}`,
      addLine: `app.add_middleware(${existing.className})`,
    };
  }

  const created = buildMiddlewareArtifact(node);
  middlewareArtifacts.set(created.fileBase, created);
  return {
    importLine: `from middleware.${created.fileBase} import ${created.className}`,
    addLine: `app.add_middleware(${created.className})`,
  };
}
