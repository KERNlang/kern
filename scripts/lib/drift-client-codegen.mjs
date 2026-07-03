#!/usr/bin/env node
/**
 * Typed TS client codegen for the backend↔frontend drift showcase.
 *
 * No client/OpenAPI target exists in KERN today (see packages/core/src/config.ts
 * KernTarget union). Rather than inventing a parallel compiler pipeline, this
 * module walks the SAME route IR the Express (`packages/express/src/express-route.ts`)
 * and FastAPI (`packages/python/src/fastapi-route.ts`) emitters consume, and
 * reuses their exact `schema` extraction (`buildSchema`) and naming
 * (`pascalCase`/`camelKey`) helpers — so the generated client's types and
 * function names are derived from, and stay honest to, the route descriptors
 * both backends were themselves generated from.
 *
 * Deliberately thin: one `interface`/`type` alias and one fetch wrapper per
 * route, string-templated the same way the existing emitters build source —
 * never hand-maintained per route.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const core = await import(join(REPO, 'packages/core/dist/index.js'));
const expressUtils = await import(join(REPO, 'packages/express/dist/express-utils.js'));
const expressMiddleware = await import(join(REPO, 'packages/express/dist/express-middleware.js'));

const { getChildren, getFirstChild, getProps, camelKey } = core;
const { findServerNode, pascalCase, derivePathParams } = expressUtils;
const { buildSchema } = expressMiddleware;

/**
 * @typedef {object} RouteDescriptor
 * @property {string} method   HTTP method, lowercase (e.g. 'get')
 * @property {string} path     Express-style path (e.g. '/api/items/:id')
 * @property {string} pascalName  e.g. 'GetApiItemsId'
 * @property {string} camelName   e.g. 'getApiItemsId'
 * @property {string[]} pathParams  path param names, in order (e.g. ['id'])
 * @property {string|undefined} requestType  raw TS type string from `schema body=`
 * @property {string|undefined} responseType raw TS type string from `schema response=`
 */

/**
 * Walk a parsed app.kern root and extract one descriptor per route, reading
 * the SAME `schema` child node (via the SAME `buildSchema` helper) that
 * `buildRouteArtifact` (express-route.ts) and the FastAPI route builder both
 * read when they emit the backends. This is the single source of truth the
 * generated client is derived from — never a hand-maintained duplicate.
 *
 * @param {import('@kernlang/core').IRNode} root
 * @returns {RouteDescriptor[]}
 */
export function extractRouteDescriptors(root) {
  const serverNode = findServerNode(root) || root;
  const routeNodes = getChildren(serverNode, 'route');
  return routeNodes.map((routeNode) => {
    const props = getProps(routeNode);
    const method = String(props.method || 'get').toLowerCase();
    const path = String(props.path || '/');
    const schema = buildSchema(getFirstChild(routeNode, 'schema'));
    const label = `${method} ${path}`;
    return {
      method,
      path,
      pascalName: pascalCase(label),
      camelName: camelKey(label),
      pathParams: derivePathParams(path),
      requestType: schema.body,
      responseType: schema.response,
    };
  });
}

/**
 * Apply a named mutation to a cloned descriptor list — used ONLY to prove
 * the negative control (a route contract change must break the frontend
 * build). Never mutates the input array.
 *
 * @param {RouteDescriptor[]} descriptors
 * @param {{camelName: string, responseType: string}} mutation
 * @returns {RouteDescriptor[]}
 */
export function withMutatedResponse(descriptors, mutation) {
  return descriptors.map((d) =>
    d.camelName === mutation.camelName ? { ...d, responseType: mutation.responseType } : d,
  );
}

function pathTemplate(descriptor) {
  if (descriptor.pathParams.length === 0) return `'${descriptor.path}'`;
  let expr = descriptor.path;
  // Longest-name-first + a "not followed by another identifier char" guard so
  // a shorter param name (e.g. `:id`) can't partially match inside a longer
  // one (e.g. `:idx`). Each interpolated value is URI-component-encoded so a
  // param value containing '/', '?', '#', etc. can't reshape the request path.
  const sortedParams = [...descriptor.pathParams].sort((a, b) => b.length - a.length);
  for (const param of sortedParams) {
    const pattern = new RegExp(`:${param}(?![A-Za-z0-9_])`, 'g');
    expr = expr.replace(pattern, `\${encodeURIComponent(params.${param})}`);
  }
  return `\`${expr}\``;
}

function paramsType(descriptor) {
  if (descriptor.pathParams.length === 0) return undefined;
  return `{ ${descriptor.pathParams.map((p) => `${p}: string`).join('; ')} }`;
}

/**
 * Generate the derived `types.ts` + `client.ts` module pair from route
 * descriptors. Returns file contents as strings — caller decides where (or
 * whether) to write them to disk.
 *
 * @param {RouteDescriptor[]} descriptors
 * @param {{header?: string}} [options]
 * @returns {{ typesTs: string, clientTs: string }}
 */
export function generateClientModule(descriptors, options = {}) {
  const header =
    options.header ??
    '// AUTO-GENERATED by scripts/check-drift-showcase.mjs — do not hand-edit.\n' +
      '// Derived from the `schema body=`/`schema response=` route descriptors in\n' +
      '// examples/drift-showcase/app.kern via scripts/lib/drift-client-codegen.mjs.\n';

  const typeLines = [header];
  for (const d of descriptors) {
    if (d.requestType) {
      typeLines.push(`export type ${d.pascalName}Request = ${d.requestType};`);
    }
    typeLines.push(`export type ${d.pascalName}Response = ${d.responseType ?? 'unknown'};`);
    typeLines.push('');
  }
  const typesTs = `${typeLines.join('\n').trimEnd()}\n`;

  const typeImports = [];
  for (const d of descriptors) {
    if (d.requestType) typeImports.push(`${d.pascalName}Request`);
    typeImports.push(`${d.pascalName}Response`);
  }

  const clientLines = [
    header,
    `import type { ${typeImports.join(', ')} } from './types.js';`,
    '',
    'export interface ApiResult<T> {',
    '  status: number;',
    '  body: T;',
    '}',
    '',
    'async function request(baseUrl: string, method: string, path: string, body: unknown): Promise<{ status: number; body: unknown }> {',
    '  const response = await fetch(`${baseUrl}${path}`, {',
    "    method,",
    "    headers: body === undefined ? undefined : { 'content-type': 'application/json' },",
    '    body: body === undefined ? undefined : JSON.stringify(body),',
    '  });',
    '  const text = await response.text();',
    '  const parsedBody = text ? JSON.parse(text) : undefined;',
    '  return { status: response.status, body: parsedBody };',
    '}',
    '',
  ];

  for (const d of descriptors) {
    const hasParams = d.pathParams.length > 0;
    const paramsArg = hasParams ? `, params: ${paramsType(d)}` : '';
    const bodyArg = d.requestType ? `, body: ${d.pascalName}Request` : '';
    const bodyValue = d.requestType ? 'body' : 'undefined';
    clientLines.push(
      `export async function ${d.camelName}(baseUrl: string${paramsArg}${bodyArg}): Promise<ApiResult<${d.pascalName}Response>> {`,
      `  return request(baseUrl, '${d.method.toUpperCase()}', ${pathTemplate(d)}, ${bodyValue}) as Promise<ApiResult<${d.pascalName}Response>>;`,
      '}',
      '',
    );
  }

  const clientTs = `${clientLines.join('\n').trimEnd()}\n`;
  return { typesTs, clientTs };
}
