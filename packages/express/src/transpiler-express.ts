import type { AccountedEntry, GeneratedArtifact, IRNode, ResolvedKernConfig, TranspileResult } from '@kernlang/core';
import {
  accountNode,
  buildDiagnostics,
  countTokens,
  getChildren,
  getFirstChild,
  getProps,
  serializeIR,
} from '@kernlang/core';
import { resolveMiddlewareUsage } from './express-middleware.js';
import { buildCoreArtifact, buildPrismaArtifact, TOP_LEVEL_CORE } from './express-prisma.js';
import { buildRouteArtifact } from './express-route.js';
import type { MiddlewareArtifactRef } from './express-types.js';
import {
  escapeSingleQuotes,
  findServerNode,
  renderImportNode,
  rewriteRelativeImportForRoute,
} from './express-utils.js';

// Re-export buildPrismaArtifact for external consumers
export { buildPrismaArtifact } from './express-prisma.js';

export function transpileExpress(root: IRNode, _config?: ResolvedKernConfig): TranspileResult {
  const sourceMap: import('@kernlang/core').SourceMapEntry[] = [];
  const accounted = new Map<IRNode, AccountedEntry>();
  const middlewareArtifacts = new Map<string, MiddlewareArtifactRef>();
  const serverNode = findServerNode(root) || root;
  accountNode(accounted, root, 'consumed', 'parse root');
  if (serverNode !== root) accountNode(accounted, serverNode, 'consumed', 'server container');
  const serverProps = getProps(serverNode);
  const serverName = String(serverProps.name || 'KernExpressServer');
  const port = String(serverProps.port || '3000');
  const serverMiddlewares = getChildren(serverNode, 'middleware');
  for (const mw of serverMiddlewares) accountNode(accounted, mw, 'consumed', 'server middleware', true);
  const routeNodes = getChildren(serverNode, 'route');
  for (const rn of routeNodes) accountNode(accounted, rn, 'consumed', 'route artifact', true);
  const serverImportNodes = getChildren(serverNode, 'import');
  for (const imp of serverImportNodes) accountNode(accounted, imp, 'consumed', 'server-level import', true);

  const isStrict = !_config || _config.express.security === 'strict';
  const hasJsonMiddleware = serverMiddlewares.some((m) => String(getProps(m).name || '') === 'json');

  const serverImports = new Set<string>();
  const serverMiddlewareInvocations: string[] = [];
  const dependencyComments: string[] = [];

  // Server-level `import` nodes flow into both the main server file and every
  // route file (with relative paths rewritten for the routes/ subdirectory),
  // so handlers can reference shared modules without a per-handler dynamic import.
  const propagatedRouteImports: string[] = [];
  for (const imp of serverImportNodes) {
    const serverLine = renderImportNode(imp);
    const routeLine = renderImportNode(imp, rewriteRelativeImportForRoute);
    if (serverLine) serverImports.add(serverLine);
    if (routeLine) propagatedRouteImports.push(routeLine);
  }

  for (const middlewareNode of serverMiddlewares) {
    const usage = resolveMiddlewareUsage(middlewareNode, middlewareArtifacts, './', isStrict ? 'strict' : 'relaxed');
    if (usage.importLine) serverImports.add(usage.importLine);
    serverMiddlewareInvocations.push(usage.invocation);
  }

  // Helmet/compression: opt-in via config
  if (_config?.express.helmet) {
    serverImports.add(`import helmet from 'helmet';`);
    serverMiddlewareInvocations.unshift('helmet()');
    dependencyComments.push('helmet');
  }
  if (_config?.express.compression) {
    serverImports.add(`import compression from 'compression';`);
    serverMiddlewareInvocations.unshift('compression()');
    dependencyComments.push('compression');
  }

  // Collect top-level core language nodes (type, interface, service, config, etc.)
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
  const coreArtifactRefs = coreNodes.map((n) => buildCoreArtifact(n));
  for (const cn of coreNodes) accountNode(accounted, cn, 'expressed', 'core artifact', true);

  const websocketNodes = getChildren(serverNode, 'websocket');
  for (const ws of websocketNodes) accountNode(accounted, ws, 'consumed', 'websocket handler', true);
  const routeArtifacts = routeNodes.map((routeNode, index) =>
    buildRouteArtifact(
      routeNode,
      index,
      middlewareArtifacts,
      sourceMap,
      isStrict ? 'strict' : 'relaxed',
      propagatedRouteImports,
    ),
  );
  const hasHealthRoute = routeNodes.some((routeNode) => {
    const props = getProps(routeNode);
    return String(props.path || '/') === '/health' && String(props.method || 'get').toLowerCase() === 'get';
  });

  // Auth middleware: generate real JWT implementation when any route uses auth
  const hasAuth = routeNodes.some((r) => getFirstChild(r, 'auth'));
  if (hasAuth && !middlewareArtifacts.has('auth')) {
    const authArtifact: GeneratedArtifact = {
      path: 'middleware/auth.ts',
      content: [
        `import type { NextFunction, Request, Response } from 'express';`,
        `import jwt from 'jsonwebtoken';`,
        ``,
        ...(isStrict
          ? [
              `const JWT_SECRET = process.env.JWT_SECRET;`,
              ``,
              `if (!JWT_SECRET) {`,
              `  throw new Error('JWT_SECRET environment variable is required in strict mode');`,
              `}`,
            ]
          : [`const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';`]),
        `const JWT_ALGORITHM = process.env.JWT_ALGORITHM || 'HS256';`,
        ``,
        `export interface AuthUser {`,
        `  id: string;`,
        `  [key: string]: unknown;`,
        `}`,
        ``,
        `declare global {`,
        `  namespace Express {`,
        `    interface Request {`,
        `      user?: AuthUser;`,
        `    }`,
        `  }`,
        `}`,
        ``,
        `export function authRequired(req: Request, res: Response, next: NextFunction): void {`,
        `  const header = req.headers.authorization;`,
        `  if (!header?.startsWith('Bearer ')) {`,
        `    res.status(401).json({ error: 'Missing or invalid Authorization header' });`,
        `    return;`,
        `  }`,
        `  try {`,
        `    const payload = jwt.verify(header.slice(7), JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as AuthUser;`,
        `    req.user = payload;`,
        `    next();`,
        `  } catch {`,
        `    res.status(401).json({ error: 'Invalid or expired token' });`,
        `  }`,
        `}`,
        ``,
        `export function authOptional(req: Request, res: Response, next: NextFunction): void {`,
        `  const header = req.headers.authorization;`,
        `  if (header?.startsWith('Bearer ')) {`,
        `    try {`,
        `      req.user = jwt.verify(header.slice(7), JWT_SECRET, { algorithms: [JWT_ALGORITHM] }) as AuthUser;`,
        `    } catch { /* token invalid — proceed without user */ }`,
        `  }`,
        `  next();`,
        `}`,
      ].join('\n'),
      type: 'middleware',
    };
    middlewareArtifacts.set('auth', { artifact: authArtifact, exportName: 'authRequired', fileBase: 'auth' });
    dependencyComments.push('jsonwebtoken');
  }

  const lines: string[] = [];
  if (dependencyComments.length > 0) {
    lines.push(`// Dependencies: ${dependencyComments.join(', ')}`);
  }
  if (isStrict) {
    lines.push(`import crypto from 'node:crypto';`);
  }
  lines.push(`import express from 'express';`);
  lines.push(`import type { NextFunction, Request, Response } from 'express';`);
  if (websocketNodes.length > 0) {
    lines.push(`import { createServer } from 'http';`);
    lines.push(`import { WebSocketServer, type WebSocket } from 'ws';`);
  }
  for (const serverImport of [...serverImports].sort()) {
    lines.push(serverImport);
  }
  for (const routeArtifact of routeArtifacts) {
    lines.push(`import { ${routeArtifact.registerName} } from './routes/${routeArtifact.fileBase}.js';`);
  }
  for (const coreRef of coreArtifactRefs) {
    if (coreRef.exportNames.length > 0) {
      lines.push(`import { ${coreRef.exportNames.join(', ')} } from '${coreRef.importPath}';`);
    }
  }
  lines.push('');
  lines.push(`const app = express();`);
  lines.push(`const port = ${port};`);
  lines.push(`const serverName = '${escapeSingleQuotes(serverName)}';`);
  lines.push('');

  // Hardened defaults (strict mode)
  if (isStrict) {
    lines.push(`app.disable('x-powered-by');`);
    lines.push(`app.use((req: Request, res: Response, next: NextFunction) => {`);
    lines.push(`  const id = crypto.randomUUID();`);
    lines.push(`  res.setHeader('X-Request-ID', id);`);
    lines.push(`  (req as any).requestId = id;`);
    lines.push(`  next();`);
    lines.push(`});`);
    if (!hasJsonMiddleware) {
      lines.push(`app.use(express.json({ limit: '1mb' }));`);
    }
    lines.push('');
  }

  for (const invocation of serverMiddlewareInvocations) {
    lines.push(`app.use(${invocation});`);
  }
  if (serverMiddlewareInvocations.length > 0 && routeArtifacts.length > 0) {
    lines.push('');
  }
  // Health check — before user routes so it can't be shadowed by catch-all
  if (isStrict && !hasHealthRoute) {
    lines.push(`app.get('/health', (_req: Request, res: Response) => {`);
    lines.push(`  res.status(200).json({ status: 'ok' });`);
    lines.push('});');
    lines.push('');
  }

  for (const routeArtifact of routeArtifacts) {
    lines.push(`${routeArtifact.registerName}(app);`);
  }
  if (routeArtifacts.length > 0) {
    lines.push('');
  }

  // 404 handler (strict mode)
  if (isStrict) {
    lines.push(`app.use((_req: Request, res: Response) => {`);
    lines.push(`  res.status(404).json({ error: 'Not Found' });`);
    lines.push('});');
    lines.push('');
  }

  // Error handler — sanitized in strict mode, verbose in relaxed
  if (isStrict) {
    lines.push(`app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {`);
    lines.push(`  console.error(err);`);
    lines.push(`  res.status(500).json({ error: 'Internal Server Error' });`);
    lines.push('});');
  } else {
    lines.push(`app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {`);
    lines.push(`  const message = error instanceof Error ? error.message : 'Internal Server Error';`);
    lines.push(`  res.status(500).json({ error: message });`);
    lines.push('});');
  }

  // WebSocket support
  if (websocketNodes.length > 0) {
    lines.push('');
    lines.push(`const server = createServer(app);`);

    for (const wsNode of websocketNodes) {
      const wsProps = getProps(wsNode);
      const wsPath = String(wsProps.path || '/ws');
      const wsName = String(wsProps.name || 'ws');
      const wsOnNodes = getChildren(wsNode, 'on');

      lines.push(`const ${wsName}Server = new WebSocketServer({ server, path: '${wsPath}' });`);
      lines.push('');
      lines.push(`${wsName}Server.on('connection', (ws: WebSocket) => {`);

      // on event=connect
      const connectNode = wsOnNodes.find((n) => {
        const e = String(getProps(n).event || getProps(n).name || '');
        return e === 'connect' || e === 'connection';
      });
      if (connectNode) {
        const handlerChild = getChildren(connectNode, 'handler')[0];
        const code = handlerChild ? String(getProps(handlerChild).code || '') : '';
        if (code) {
          for (const line of code.split('\n')) {
            lines.push(`  ${line}`);
          }
        }
      }

      // on event=message
      const messageNode = wsOnNodes.find((n) => {
        const e = String(getProps(n).event || getProps(n).name || '');
        return e === 'message';
      });
      lines.push('');
      lines.push(`  ws.on('message', (raw: Buffer) => {`);
      lines.push(`    let data: any;`);
      lines.push(`    try {`);
      lines.push(`      data = JSON.parse(raw.toString());`);
      lines.push(`    } catch {`);
      lines.push(`      ws.send(JSON.stringify({ error: 'Invalid JSON payload' }));`);
      lines.push(`      return;`);
      lines.push(`    }`);
      if (messageNode) {
        const handlerChild = getChildren(messageNode, 'handler')[0];
        const code = handlerChild ? String(getProps(handlerChild).code || '') : '';
        if (code) {
          for (const line of code.split('\n')) {
            lines.push(`    ${line}`);
          }
        }
      }
      lines.push(`  });`);

      // on event=error
      const errorNode = wsOnNodes.find((n) => {
        const e = String(getProps(n).event || getProps(n).name || '');
        return e === 'error';
      });
      if (errorNode) {
        const handlerChild = getChildren(errorNode, 'handler')[0];
        const code = handlerChild ? String(getProps(handlerChild).code || '') : '';
        lines.push('');
        lines.push(`  ws.on('error', (error: Error) => {`);
        if (code) {
          for (const line of code.split('\n')) {
            lines.push(`    ${line}`);
          }
        }
        lines.push(`  });`);
      }

      // on event=disconnect/close
      const closeNode = wsOnNodes.find((n) => {
        const e = String(getProps(n).event || getProps(n).name || '');
        return e === 'disconnect' || e === 'close';
      });
      lines.push('');
      lines.push(`  ws.on('close', () => {`);
      if (closeNode) {
        const handlerChild = getChildren(closeNode, 'handler')[0];
        const code = handlerChild ? String(getProps(handlerChild).code || '') : '';
        if (code) {
          for (const line of code.split('\n')) {
            lines.push(`    ${line}`);
          }
        }
      }
      lines.push(`  });`);

      lines.push(`});`);
    }

    lines.push('');
    lines.push(`server.listen(port, () => {`);
    lines.push(`  console.log(\`\${serverName} listening on port \${port}\`);`);
    lines.push('});');
    lines.push(`const shutdown = (signal: string) => {`);
    lines.push(`  console.log(\`\${signal} received, shutting down gracefully...\`);`);
    for (const wsNode of websocketNodes) {
      const wsName = String(getProps(wsNode).name || 'ws');
      lines.push(`  ${wsName}Server.clients.forEach((client: WebSocket) => client.terminate());`);
      lines.push(`  ${wsName}Server.close();`);
    }
    lines.push(`  server.close(() => {`);
    lines.push(`    console.log('Server closed');`);
    lines.push(`    process.exit(0);`);
    lines.push(`  });`);
    lines.push(`  setTimeout(() => { console.error('Forced shutdown'); process.exit(1); }, 30000);`);
    lines.push(`};`);
    lines.push(`process.on('SIGTERM', () => shutdown('SIGTERM'));`);
    lines.push(`process.on('SIGINT', () => shutdown('SIGINT'));`);
  } else {
    lines.push('');
    lines.push(`const server = app.listen(port, () => {`);
    lines.push(`  console.log(\`\${serverName} listening on port \${port}\`);`);
    lines.push('});');
    lines.push(`const shutdown = (signal: string) => {`);
    lines.push(`  console.log(\`\${signal} received, shutting down gracefully...\`);`);
    lines.push(`  server.close(() => {`);
    lines.push(`    console.log('Server closed');`);
    lines.push(`    process.exit(0);`);
    lines.push(`  });`);
    lines.push(`  setTimeout(() => { console.error('Forced shutdown'); process.exit(1); }, 30000);`);
    lines.push(`};`);
    lines.push(`process.on('SIGTERM', () => shutdown('SIGTERM'));`);
    lines.push(`process.on('SIGINT', () => shutdown('SIGINT'));`);
  }
  lines.push('');
  lines.push('export default app;');

  sourceMap.unshift({
    irLine: serverNode.loc?.line || root.loc?.line || 0,
    irCol: serverNode.loc?.col || root.loc?.col || 1,
    outLine: 1,
    outCol: 1,
  });

  // Build Prisma schema artifact from model nodes
  const modelNodes = coreNodes.filter((n) => n.type === 'model');
  const prismaArtifact = buildPrismaArtifact(modelNodes, _config);

  // DB connection: implicit path — auto-generate when models exist but no explicit dependency kind=database
  const hasExplicitDb = coreNodes.some((n) => n.type === 'dependency' && String(n.props?.kind) === 'database');
  let dbArtifact: GeneratedArtifact | null = null;
  if (modelNodes.length > 0 && !hasExplicitDb) {
    dbArtifact = {
      path: 'lib/db.ts',
      content: [
        `import { PrismaClient } from '@prisma/client';`,
        ``,
        `const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };`,
        ``,
        `export const prisma = globalForPrisma.prisma ?? new PrismaClient();`,
        ``,
        `if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;`,
        ``,
        `export default prisma;`,
      ].join('\n'),
      type: 'lib',
    };
    dependencyComments.push('@prisma/client');
  }

  // Backend infrastructure artifacts (job, storage, email)
  const infraArtifacts: GeneratedArtifact[] = [];
  for (const node of coreNodes) {
    const np = getProps(node);
    const nodeName = String(np.name || node.type);
    if (node.type === 'job') {
      const queue = String(np.queue || nodeName);
      const code = getFirstChild(node, 'handler') ? String(getProps(getFirstChild(node, 'handler')!).code || '') : '';
      infraArtifacts.push({
        path: `jobs/${nodeName}.ts`,
        content: [
          `import { Worker, Queue } from 'bullmq';`,
          ``,
          `export const ${nodeName}Queue = new Queue('${queue}');`,
          ``,
          `// Run: npx tsx jobs/${nodeName}.ts`,
          `const worker = new Worker('${queue}', async (job) => {`,
          ...(code ? code.split('\n').map((l: string) => `  ${l}`) : [`  // TODO: implement ${nodeName}`]),
          `});`,
          ``,
          `worker.on('completed', (job) => console.log(\`Job \${job.id} completed\`));`,
          `worker.on('failed', (job, err) => console.error(\`Job \${job?.id} failed:\`, err));`,
          ``,
          `export default worker;`,
        ].join('\n'),
        type: 'lib',
      });
      dependencyComments.push('bullmq');
    } else if (node.type === 'storage') {
      const provider = String(np.provider || 's3');
      const bucket = String(np.bucket || 'my-app-uploads');
      infraArtifacts.push({
        path: `lib/${nodeName}.ts`,
        content:
          provider === 's3'
            ? [
                `import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';`,
                `import { getSignedUrl } from '@aws-sdk/s3-request-presigner';`,
                ``,
                `const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });`,
                `const BUCKET = process.env.S3_BUCKET || '${bucket}';`,
                ``,
                `export async function uploadFile(key: string, body: Buffer, contentType: string): Promise<string> {`,
                `  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));`,
                `  return key;`,
                `}`,
                ``,
                `export async function getDownloadUrl(key: string, expiresIn = 3600): Promise<string> {`,
                `  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });`,
                `}`,
              ].join('\n')
            : [
                `import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';`,
                `import { join } from 'node:path';`,
                ``,
                `const STORAGE_DIR = process.env.STORAGE_DIR || './uploads';`,
                `mkdirSync(STORAGE_DIR, { recursive: true });`,
                ``,
                `export function uploadFile(key: string, body: Buffer): string {`,
                `  writeFileSync(join(STORAGE_DIR, key), body);`,
                `  return key;`,
                `}`,
                ``,
                `export function readFile(key: string): Buffer {`,
                `  return readFileSync(join(STORAGE_DIR, key));`,
                `}`,
              ].join('\n'),
        type: 'lib',
      });
      if (provider === 's3') dependencyComments.push('@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner');
    } else if (node.type === 'email') {
      const provider = String(np.provider || 'smtp');
      const from = String(np.from || 'noreply@example.com');
      infraArtifacts.push({
        path: `lib/${nodeName}.ts`,
        content:
          provider === 'sendgrid'
            ? [
                `const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';`,
                `const DEFAULT_FROM = '${from}';`,
                ``,
                `export async function sendEmail(to: string, subject: string, html: string, from = DEFAULT_FROM): Promise<void> {`,
                `  await fetch('https://api.sendgrid.com/v3/mail/send', {`,
                `    method: 'POST',`,
                `    headers: { Authorization: \`Bearer \${SENDGRID_API_KEY}\`, 'Content-Type': 'application/json' },`,
                `    body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: from }, subject, content: [{ type: 'text/html', value: html }] }),`,
                `  });`,
                `}`,
              ].join('\n')
            : [
                `import { createTransport } from 'nodemailer';`,
                ``,
                `const transporter = createTransport({`,
                `  host: process.env.SMTP_HOST || 'localhost',`,
                `  port: Number(process.env.SMTP_PORT || 587),`,
                `  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },`,
                `});`,
                ``,
                `export async function sendEmail(to: string, subject: string, html: string, from = '${from}'): Promise<void> {`,
                `  await transporter.sendMail({ from, to, subject, html });`,
                `}`,
              ].join('\n'),
        type: 'lib',
      });
      if (provider !== 'sendgrid') dependencyComments.push('nodemailer');
    }
  }

  const artifacts: GeneratedArtifact[] = [
    ...routeArtifacts.map((route) => route.artifact),
    ...[...middlewareArtifacts.values()].map((entry) => entry.artifact),
    ...coreArtifactRefs.map((ref) => ref.artifact),
    ...(prismaArtifact ? [prismaArtifact] : []),
    ...(dbArtifact ? [dbArtifact] : []),
    ...infraArtifacts,
  ];

  const output = lines.join('\n');
  const irText = serializeIR(root);
  const tsText = [output, ...artifacts.map((artifact) => artifact.content)].join('\n');
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(tsText);
  const tokenReduction = Math.round((1 - irTokenCount / tsTokenCount) * 100);

  return {
    code: output,
    sourceMap,
    irTokenCount,
    tsTokenCount,
    tokenReduction,
    artifacts,
    diagnostics: buildDiagnostics(root, accounted, 'express'),
  };
}
