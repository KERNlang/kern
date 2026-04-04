import type { GeneratedArtifact, IRNode } from '@kernlang/core';
import { getFirstChild, getProps } from '@kernlang/core';
import type { MiddlewareArtifactRef, MiddlewareUsage, SchemaShape } from './express-types.js';
import { indentBlock, middlewareExportName, slugify } from './express-utils.js';

export function buildSchema(node?: IRNode): SchemaShape {
  if (!node) return {};
  const props = getProps(node);
  const schema: SchemaShape = {};

  if (typeof props.body === 'string') schema.body = props.body;
  if (typeof props.params === 'string') schema.params = props.params;
  if (typeof props.query === 'string') schema.query = props.query;
  if (typeof props.response === 'string') schema.response = props.response;

  return schema;
}

export function buildMiddlewareArtifact(node: IRNode, exportName: string): GeneratedArtifact {
  const handlerNode = getFirstChild(node, 'handler');
  const handlerProps = handlerNode ? getProps(handlerNode) : {};
  const handlerCode = typeof handlerProps.code === 'string' ? String(handlerProps.code) : '';

  const lines: string[] = [];
  lines.push(`import type { NextFunction, Request, Response } from 'express';`);
  lines.push('');
  lines.push(`export function ${exportName}(req: Request, res: Response, next: NextFunction): void {`);
  if (handlerCode) {
    lines.push(...indentBlock(handlerCode, '  '));
  } else {
    lines.push('  next();');
  }
  lines.push('}');

  const name = String(getProps(node).name || exportName);
  return {
    path: `middleware/${slugify(name)}.ts`,
    content: lines.join('\n'),
    type: 'middleware',
  };
}

export function ensureCustomMiddlewareArtifact(
  node: IRNode,
  middlewareArtifacts: Map<string, MiddlewareArtifactRef>,
): MiddlewareArtifactRef {
  const name = String(getProps(node).name || 'middleware');
  const fileBase = slugify(name);
  const existing = middlewareArtifacts.get(fileBase);
  if (existing) return existing;

  const exportName = middlewareExportName(node);
  const artifact = buildMiddlewareArtifact(node, exportName);
  const created: MiddlewareArtifactRef = { artifact, exportName, fileBase };
  middlewareArtifacts.set(fileBase, created);
  return created;
}

export function resolveMiddlewareUsage(
  node: IRNode,
  middlewareArtifacts: Map<string, MiddlewareArtifactRef>,
  importPrefix: string,
  securityLevel?: 'strict' | 'relaxed',
): MiddlewareUsage {
  const props = getProps(node);
  const name = String(props.name || 'middleware');

  if (name === 'cors') {
    const invocation =
      securityLevel === 'strict'
        ? `cors({ origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean) : false, credentials: true })`
        : 'cors()';
    return { importLine: `import cors from 'cors';`, invocation };
  }

  if (name === 'json') {
    const invocation = securityLevel === 'relaxed' ? 'express.json()' : `express.json({ limit: '1mb' })`;
    return { invocation };
  }

  if (name === 'rateLimit' || name === 'rate-limit' || name === 'rateLimiter') {
    return {
      importLine: `import rateLimit from 'express-rate-limit';`,
      invocation: `rateLimit({ windowMs: 15 * 60 * 1000, max: 100 })`,
    };
  }

  const artifact = ensureCustomMiddlewareArtifact(node, middlewareArtifacts);
  return {
    importLine: `import { ${artifact.exportName} } from '${importPrefix}middleware/${artifact.fileBase}.js';`,
    invocation: artifact.exportName,
  };
}
