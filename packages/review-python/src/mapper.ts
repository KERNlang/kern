/**
 * Python Concept Mapper — tree-sitter based.
 *
 * Maps Python syntax → universal KERN concepts.
 * Phase 1: error_raise, error_handle, effect
 */

import type { ConceptEdge, ConceptMap, ConceptNode, ConceptSpan, ErrorHandlePayload } from '@kernlang/core';
import { conceptId, conceptSpan } from '@kernlang/core';
import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';

const EXTRACTOR_VERSION = '1.0.0';

// ── Network call patterns ────────────────────────────────────────────────

const NETWORK_MODULES = new Set(['requests', 'httpx', 'aiohttp', 'urllib']);
const NETWORK_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request', 'fetch']);

const DB_MODULES = new Set(['psycopg2', 'asyncpg', 'pymongo', 'sqlalchemy', 'django']);
const DB_METHODS = new Set([
  'execute',
  'executemany',
  'fetchone',
  'fetchall',
  'fetchmany',
  'query',
  'find',
  'find_one',
  'insert_one',
  'insert_many',
  'update_one',
  'delete_one',
]);

const _FS_FUNCTIONS = new Set(['open', 'read', 'write', 'readlines', 'writelines']);

type FieldTypeTag = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'unknown';
type FieldTypeMap = Readonly<Record<string, FieldTypeTag>>;

interface PydanticModel {
  fields: readonly string[];
  types: FieldTypeMap;
}

interface PythonRouteAnalysis {
  errorStatusCodes?: readonly number[];
  hasUnboundedCollectionQuery?: boolean;
  hasDbWrite?: boolean;
  hasIdempotencyProtection?: boolean;
  hasBodyValidation?: boolean;
  validatedBodyFields?: readonly string[];
  bodyValidationResolved?: boolean;
  validatedBodyFieldTypes?: FieldTypeMap;
}

const PY_API_ERROR_STATUS_CODES = new Set([401, 403, 404, 422, 500]);
const PY_PAGINATION_RE = /\b(limit|offset|skip|cursor|page|page_size|per_page)\b|\.limit\s*\(/i;
const PY_DB_COLLECTION_RE = /\.(find|all|fetchall|to_list|scalars)\s*\(|\bselect\s*\(/i;
const PY_DB_WRITE_RE =
  /\.(insert_one|insert_many|update_one|update_many|delete_one|delete_many|add|create|save|commit)\s*\(/i;
const PY_IDEMPOTENCY_RE =
  /\b(idempotency(?:[_-]?key)?|Idempotency-Key|transaction|unique|upsert|get_or_create|on_conflict)\b/i;

const STDLIB_MODULES = new Set([
  'os',
  'sys',
  'json',
  're',
  'math',
  'datetime',
  'time',
  'logging',
  'argparse',
  'collections',
  'itertools',
  'functools',
  'pathlib',
  'shutil',
  'subprocess',
  'threading',
  'multiprocessing',
  'abc',
  'typing',
  'io',
  'pickle',
  'random',
  'hashlib',
  'hmac',
  'base64',
  'csv',
  'sqlite3',
  'zlib',
  'gzip',
  'tarfile',
  'zipfile',
  'enum',
  'struct',
  'tempfile',
  'unittest',
  'urllib',
  'uuid',
  'xml',
]);

// ── Parser setup ─────────────────────────────────────────────────────────

let parser: Parser | null = null;

function getParser(): Parser {
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(Python as unknown as Parser.Language);
  }
  return parser;
}

// ── Main Extractor ───────────────────────────────────────────────────────

export function extractPythonConcepts(source: string, filePath: string): ConceptMap {
  const tree = getParser().parse(source);
  const nodes: ConceptNode[] = [];
  const edges: ConceptEdge[] = [];

  extractErrorRaise(tree.rootNode, source, filePath, nodes);
  extractErrorHandle(tree.rootNode, source, filePath, nodes);
  extractEffects(tree.rootNode, source, filePath, nodes);

  extractEntrypoints(tree.rootNode, source, filePath, nodes);
  extractGuards(tree.rootNode, source, filePath, nodes);
  extractStateMutation(tree.rootNode, source, filePath, nodes);
  extractDependencyEdges(tree.rootNode, source, filePath, edges);

  return {
    filePath,
    language: 'py',
    nodes,
    edges,
    extractorVersion: EXTRACTOR_VERSION,
  };
}

// ── error_raise ──────────────────────────────────────────────────────────

function extractErrorRaise(root: Parser.SyntaxNode, source: string, filePath: string, nodes: ConceptNode[]): void {
  // raise statements
  walkNodes(root, 'raise_statement', (node) => {
    const errorType = extractRaiseType(node);
    nodes.push({
      id: conceptId(filePath, 'error_raise', node.startIndex),
      kind: 'error_raise',
      primarySpan: nodeSpan(filePath, node),
      evidence: nodeText(source, node, 100),
      confidence: 1.0,
      language: 'py',
      containerId: getContainerId(node, filePath),
      payload: {
        kind: 'error_raise',
        subtype: 'throw', // Python raise ≡ throw
        errorType,
      },
    });
  });
}

// ── error_handle ─────────────────────────────────────────────────────────

function extractErrorHandle(root: Parser.SyntaxNode, source: string, filePath: string, nodes: ConceptNode[]): void {
  // except clauses
  walkNodes(root, 'except_clause', (node) => {
    const block = node.children.find((c) => c.type === 'block');
    const disposition = classifyPythonDisposition(block, source);
    const errorVar = extractExceptVar(node);

    nodes.push({
      id: conceptId(filePath, 'error_handle', node.startIndex),
      kind: 'error_handle',
      primarySpan: nodeSpan(filePath, node),
      evidence: nodeText(source, node, 150),
      confidence: disposition.confidence,
      language: 'py',
      containerId: getContainerId(node, filePath),
      payload: {
        kind: 'error_handle',
        disposition: disposition.type,
        errorVariable: errorVar,
      },
    });
  });
}

function classifyPythonDisposition(
  block: Parser.SyntaxNode | undefined,
  source: string,
): { type: ErrorHandlePayload['disposition']; confidence: number } {
  if (!block) return { type: 'ignored', confidence: 1.0 };

  const children = block.namedChildren;

  // except: pass → ignored
  if (children.length === 1 && children[0].type === 'pass_statement') {
    return { type: 'ignored', confidence: 1.0 };
  }

  // except: ... (ellipsis) → ignored
  if (children.length === 1 && children[0].type === 'expression_statement') {
    const text = source.substring(children[0].startIndex, children[0].endIndex).trim();
    if (text === '...') return { type: 'ignored', confidence: 1.0 };
  }

  // Empty block
  if (children.length === 0) {
    return { type: 'ignored', confidence: 1.0 };
  }

  const bodyText = source.substring(block.startIndex, block.endIndex);

  // raise → rethrown or wrapped
  if (bodyText.includes('raise')) {
    // bare `raise` → rethrown
    if (/\braise\s*$|\braise\s*\n/m.test(bodyText)) {
      return { type: 'rethrown', confidence: 0.95 };
    }
    return { type: 'wrapped', confidence: 0.9 };
  }

  // return → returned
  if (bodyText.includes('return')) {
    return { type: 'returned', confidence: 0.85 };
  }

  // logging
  if (/\b(logging|logger|log|print)\b/.test(bodyText)) {
    if (children.length === 1) return { type: 'logged', confidence: 0.9 };
    return { type: 'logged', confidence: 0.7 };
  }

  return { type: 'wrapped', confidence: 0.5 };
}

// ── effect ───────────────────────────────────────────────────────────────

function extractEffects(root: Parser.SyntaxNode, source: string, filePath: string, nodes: ConceptNode[]): void {
  walkNodes(root, 'call', (node) => {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) return;

    const funcText = source.substring(funcNode.startIndex, funcNode.endIndex);

    // Network: requests.get(), httpx.post(), etc.
    if (funcNode.type === 'attribute') {
      const obj = funcNode.childForFieldName('object');
      const attr = funcNode.childForFieldName('attribute');
      if (obj && attr) {
        const objName = source.substring(obj.startIndex, obj.endIndex);
        const methodName = source.substring(attr.startIndex, attr.endIndex);

        if (NETWORK_MODULES.has(objName) && NETWORK_METHODS.has(methodName)) {
          nodes.push({
            id: conceptId(filePath, 'effect', node.startIndex),
            kind: 'effect',
            primarySpan: nodeSpan(filePath, node),
            evidence: nodeText(source, node, 120),
            confidence: 0.95,
            language: 'py',
            containerId: getContainerId(node, filePath),
            payload: { kind: 'effect', subtype: 'network', async: isInAsyncDef(node) },
          });
          return;
        }

        // DB: cursor.execute(), db.query(), etc.
        if (
          DB_METHODS.has(methodName) &&
          (DB_MODULES.has(objName) || /cursor|conn|db|session|collection/i.test(objName))
        ) {
          nodes.push({
            id: conceptId(filePath, 'effect', node.startIndex),
            kind: 'effect',
            primarySpan: nodeSpan(filePath, node),
            evidence: nodeText(source, node, 120),
            confidence: 0.85,
            language: 'py',
            containerId: getContainerId(node, filePath),
            payload: { kind: 'effect', subtype: 'db', async: isInAsyncDef(node) },
          });
          return;
        }
      }
    }

    // FS: open()
    if (funcText === 'open') {
      nodes.push({
        id: conceptId(filePath, 'effect', node.startIndex),
        kind: 'effect',
        primarySpan: nodeSpan(filePath, node),
        evidence: nodeText(source, node, 120),
        confidence: 0.9,
        language: 'py',
        containerId: getContainerId(node, filePath),
        payload: { kind: 'effect', subtype: 'fs', async: false },
      });
    }

    // fetch() in async context (aiohttp pattern)
    if (funcText === 'fetch' || funcText === 'aiohttp.request') {
      nodes.push({
        id: conceptId(filePath, 'effect', node.startIndex),
        kind: 'effect',
        primarySpan: nodeSpan(filePath, node),
        evidence: nodeText(source, node, 120),
        confidence: 0.8,
        language: 'py',
        containerId: getContainerId(node, filePath),
        payload: { kind: 'effect', subtype: 'network', async: true },
      });
    }
  });
}

// ── entrypoint ──────────────────────────────────────────────────────────

function extractEntrypoints(root: Parser.SyntaxNode, source: string, filePath: string, nodes: ConceptNode[]): void {
  const pydanticModels = collectPydanticModels(source);

  // FastAPI / Flask route decorators.
  //
  // The route *path* (e.g. `/current`) is what cross-stack rules need to
  // match against — not the Python function name. Prior to 2026-04-21 this
  // emitted the function name, which `collectRoutes` then silently dropped
  // (it filters on paths starting with `/`). The FastAPI router-prefix join
  // in `cross-stack-utils.collectRoutes` also needs `routerName` so it can
  // pair per-file routes with the `include_router(prefix=…)` call that
  // mounts them.
  walkNodes(root, 'decorated_definition', (node) => {
    const fnDef = node.children.find((c) => c.type === 'function_definition');
    if (!fnDef) return;

    for (const child of node.children) {
      if (child.type !== 'decorator') continue;
      const decText = source.substring(child.startIndex, child.endIndex);

      const routeMatch = decText.match(/@(\w+)\.(route|get|post|put|delete|patch)\s*\(/);
      if (!routeMatch) continue;

      const routerName = routeMatch[1];
      const method = routeMatch[2].toUpperCase();
      const pathMatch = decText.match(/['"]([^'"]+)['"]/);
      const routePath = pathMatch?.[1];
      // Only surface the decorator as a route when we could extract a URL
      // path literal. Mystery decorators with only kwargs (e.g. `@app.get`
      // stub) are noise — skip them instead of filling `name` with the
      // function name, which cross-stack routes treat as invalid.
      if (!routePath?.startsWith('/')) continue;

      const responseModel = extractResponseModel(decText);
      const routeContainerId = getSelfContainerId(fnDef, filePath);
      const routeAnalysis = analyzePythonRoute(fnDef, source, method, routePath, responseModel, pydanticModels);

      nodes.push({
        id: conceptId(filePath, 'entrypoint', child.startIndex),
        kind: 'entrypoint',
        primarySpan: nodeSpan(filePath, child),
        evidence: nodeText(source, child, 100),
        confidence: 1.0,
        language: 'py',
        containerId: routeContainerId,
        payload: {
          kind: 'entrypoint',
          subtype: 'route',
          name: routePath,
          httpMethod: method === 'ROUTE' ? undefined : method,
          responseModel,
          isAsync: isAsyncFunction(fnDef),
          routerName,
          errorStatusCodes: routeAnalysis.errorStatusCodes,
          hasUnboundedCollectionQuery: routeAnalysis.hasUnboundedCollectionQuery,
          hasDbWrite: routeAnalysis.hasDbWrite,
          hasIdempotencyProtection: routeAnalysis.hasIdempotencyProtection,
          hasBodyValidation: routeAnalysis.hasBodyValidation,
          validatedBodyFields: routeAnalysis.validatedBodyFields,
          bodyValidationResolved: routeAnalysis.bodyValidationResolved,
          validatedBodyFieldTypes: routeAnalysis.validatedBodyFieldTypes,
        },
      });
    }
  });

  // FastAPI `app.include_router(<module>.<router>, prefix="/api/x")`.
  //
  // Emitted as a route-mount concept so `collectRoutes` can join it with
  // the per-file route nodes: a route declared on `router` in
  // `app/api/nutrition_goals.py` and mounted in `main.py` with
  // `app.include_router(nutrition_goals.router, prefix="/api/nutrition-goals")`
  // should resolve to the full URL `/api/nutrition-goals/<path>`.
  walkNodes(root, 'call', (node) => {
    const fn = node.childForFieldName('function');
    if (!fn) return;
    const fnText = source.substring(fn.startIndex, fn.endIndex);
    if (!/\.include_router$/.test(fnText)) return;
    const argsNode = node.childForFieldName('arguments');
    if (!argsNode) return;
    const argsText = source.substring(argsNode.startIndex, argsNode.endIndex);

    // First positional arg is the router. Common shapes:
    //   include_router(router)                  — local identifier
    //   include_router(nutrition_goals.router)  — imported-module attribute
    //   include_router(auth_router)             — aliased local identifier
    const posMatch = argsText.match(/^\(\s*([A-Za-z_][\w.]*)/);
    if (!posMatch) return;
    const routerRef = posMatch[1];
    const dot = routerRef.lastIndexOf('.');
    const sourceModule = dot === -1 ? undefined : routerRef.slice(0, dot);
    const routerName = dot === -1 ? routerRef : routerRef.slice(dot + 1);

    const prefixMatch = argsText.match(/prefix\s*=\s*['"]([^'"]*)['"]/);
    // Prefix defaults to '' when omitted — still valid (the route keeps its
    // declared path as-is), so emit the mount either way.
    const prefix = prefixMatch?.[1] ?? '';

    nodes.push({
      id: conceptId(filePath, 'entrypoint', node.startIndex),
      kind: 'entrypoint',
      primarySpan: nodeSpan(filePath, node),
      evidence: nodeText(source, node, 120),
      confidence: 0.95,
      language: 'py',
      payload: {
        kind: 'entrypoint',
        subtype: 'route-mount',
        name: prefix,
        routerName,
        sourceModule,
      },
    });
  });

  // `if __name__ == '__main__':`
  walkNodes(root, 'if_statement', (node) => {
    const condition = node.childForFieldName('condition');
    if (condition?.text.includes('__name__') && condition.text.includes('__main__')) {
      nodes.push({
        id: conceptId(filePath, 'entrypoint', node.startIndex),
        kind: 'entrypoint',
        primarySpan: nodeSpan(filePath, node),
        evidence: nodeText(source, node, 100),
        confidence: 1.0,
        language: 'py',
        payload: {
          kind: 'entrypoint',
          subtype: 'main',
          name: 'main',
        },
      });
    }
  });
}

// ── guard ───────────────────────────────────────────────────────────────

function extractGuards(root: Parser.SyntaxNode, source: string, filePath: string, nodes: ConceptNode[]): void {
  // 1. Auth decorators (tree-sitter: decorated_definition → decorator + function_definition)
  walkNodes(root, 'decorated_definition', (node) => {
    for (const child of node.children) {
      if (child.type !== 'decorator') continue;
      const decText = source.substring(child.startIndex, child.endIndex);
      if (/@(login_required|requires_auth|permission_required|auth_required|authenticated)/.test(decText)) {
        nodes.push({
          id: conceptId(filePath, 'guard', child.startIndex),
          kind: 'guard',
          primarySpan: nodeSpan(filePath, child),
          evidence: nodeText(source, child, 100),
          confidence: 1.0,
          language: 'py',
          containerId: getContainerId(node, filePath),
          payload: {
            kind: 'guard',
            subtype: 'auth',
            name: decText.replace('@', '').split('(')[0].trim(),
          },
        });
      }
    }
  });

  // 2. Pydantic validation: BaseModel.model_validate()
  walkNodes(root, 'call', (node) => {
    const func = node.childForFieldName('function');
    if (func?.text.includes('model_validate')) {
      nodes.push({
        id: conceptId(filePath, 'guard', node.startIndex),
        kind: 'guard',
        primarySpan: nodeSpan(filePath, node),
        evidence: nodeText(source, node, 100),
        confidence: 0.9,
        language: 'py',
        containerId: getContainerId(node, filePath),
        payload: { kind: 'guard', subtype: 'validation', name: 'pydantic' },
      });
    }
  });

  // 3. FastAPI `Depends(...)` injection — route handler parameter with a
  //    `Depends` default is the idiomatic FastAPI auth/validation guard.
  //    Example:
  //      @router.get("/me")
  //      def me(user: User = Depends(get_current_user)):
  //    Classified by the dependency function name:
  //      - `get_current_user` / `current_user` / `require_auth` / `*_user` → 'auth'
  //      - `verify_*` / `validate_*` → 'validation'
  //      - `rate_limit_*` / `check_rate_limit` → 'rate-limit'
  //      - everything else → 'policy'
  //    Feeds the `auth-drift` cross-stack rule.
  walkNodes(root, 'default_parameter', (node) => {
    const val = node.childForFieldName('value');
    if (!val || val.type !== 'call') return;
    const func = val.childForFieldName('function');
    if (!func || func.text !== 'Depends') return;
    const args = val.childForFieldName('arguments');
    if (!args) return;
    const posArg = args.namedChildren.find((c) => c.type === 'identifier' || c.type === 'attribute');
    const depName = posArg ? posArg.text : 'Depends';
    const subtype = classifyDependency(depName);
    nodes.push({
      id: conceptId(filePath, 'guard', node.startIndex),
      kind: 'guard',
      primarySpan: nodeSpan(filePath, node),
      evidence: nodeText(source, node, 120),
      confidence: 0.85,
      language: 'py',
      containerId: getContainerId(node, filePath),
      payload: { kind: 'guard', subtype, name: depName },
    });
  });

  // 4. Early return/raise after auth check: if not request.user: raise/return
  walkNodes(root, 'if_statement', (node) => {
    const cond = node.childForFieldName('condition');
    if (cond && /\b(user|auth|request\.user)\b/.test(cond.text)) {
      const block = node.namedChildren.find((c) => c.type === 'block');
      if (block) {
        const firstStmt = block.namedChildren[0];
        if (firstStmt && (firstStmt.type === 'return_statement' || firstStmt.type === 'raise_statement')) {
          nodes.push({
            id: conceptId(filePath, 'guard', node.startIndex),
            kind: 'guard',
            primarySpan: nodeSpan(filePath, node),
            evidence: nodeText(source, node, 100),
            confidence: 0.8,
            language: 'py',
            containerId: getContainerId(node, filePath),
            payload: { kind: 'guard', subtype: 'auth' },
          });
        }
      }
    }
  });
}

function classifyDependency(depName: string): 'auth' | 'validation' | 'rate-limit' | 'policy' {
  // Strip module prefix (`auth.get_current_user` → `get_current_user`) so the
  // heuristic looks at the final identifier where intent usually lives.
  const tail = depName.split('.').pop() ?? depName;
  if (/^(get_current_user|current_user|require_auth|authenticated|is_authenticated)$/i.test(tail)) return 'auth';
  if (/_user$|^user$|auth/i.test(tail)) return 'auth';
  if (/^(verify_|validate_)/i.test(tail)) return 'validation';
  if (/rate_?limit/i.test(tail)) return 'rate-limit';
  return 'policy';
}

function analyzePythonRoute(
  fnDef: Parser.SyntaxNode,
  source: string,
  method: string,
  routePath: string,
  responseModel: string | undefined,
  pydanticModels: ReadonlyMap<string, PydanticModel>,
): PythonRouteAnalysis {
  const text = source.substring(fnDef.startIndex, fnDef.endIndex);
  const validation = extractFastApiBodyValidation(fnDef, source, pydanticModels);
  return {
    errorStatusCodes: extractPythonHttpExceptionStatusCodes(text),
    hasUnboundedCollectionQuery: hasUnboundedPythonCollectionQuery(text, method, routePath, responseModel),
    hasDbWrite: PY_DB_WRITE_RE.test(text),
    hasIdempotencyProtection: PY_IDEMPOTENCY_RE.test(text),
    hasBodyValidation: validation.has,
    validatedBodyFields: validation.fields,
    bodyValidationResolved: validation.resolved,
    validatedBodyFieldTypes: validation.types,
  };
}

function extractPythonHttpExceptionStatusCodes(text: string): readonly number[] | undefined {
  const codes = new Set<number>();
  const keywordRe = /HTTPException\s*\([^)]*status_code\s*=\s*(\d{3})/g;
  for (const match of text.matchAll(keywordRe)) {
    const code = Number(match[1]);
    if (PY_API_ERROR_STATUS_CODES.has(code)) codes.add(code);
  }
  const positionalRe = /HTTPException\s*\(\s*(\d{3})/g;
  for (const match of text.matchAll(positionalRe)) {
    const code = Number(match[1]);
    if (PY_API_ERROR_STATUS_CODES.has(code)) codes.add(code);
  }
  return codes.size > 0 ? Array.from(codes).sort((a, b) => a - b) : undefined;
}

function hasUnboundedPythonCollectionQuery(
  text: string,
  method: string,
  routePath: string,
  responseModel: string | undefined,
): boolean {
  if (method !== 'GET') return false;
  if (/[{:]/.test(routePath)) return false;
  if (PY_PAGINATION_RE.test(text)) return false;
  const responseLooksList = responseModel ? /^(list|List|Sequence|Iterable)\s*\[/.test(responseModel) : false;
  return (
    PY_DB_COLLECTION_RE.test(text) &&
    (responseLooksList || /\breturn\b[\s\S]*(\.all\s*\(|\.find\s*\(|\.fetchall\s*\()/.test(text))
  );
}

function collectPydanticModels(source: string): Map<string, PydanticModel> {
  const models = new Map<string, PydanticModel>();
  const classRe = /^class\s+([A-Za-z_]\w*)\s*\([^)]*BaseModel[^)]*\)\s*:/gm;
  for (const match of source.matchAll(classRe)) {
    const name = match[1];
    const start = (match.index ?? 0) + match[0].length;
    const rest = source.slice(start);
    const nextTopLevel = rest.search(/\n\S/);
    const body = nextTopLevel === -1 ? rest : rest.slice(0, nextTopLevel);
    const fields: string[] = [];
    const types: Record<string, FieldTypeTag> = {};
    // Capture annotations alongside names. The annotation runs until either
    // an `=` (default value) or end-of-line / inline comment. Multiline
    // annotations (`x: Annotated[\n  str, Field(...)\n]`) are not handled —
    // false-negative on the type tag, never false-positive.
    const fieldRe = /^[ \t]+([A-Za-z_]\w*)[ \t]*:[ \t]*([^=#\n]+?)(?:[ \t]*=[^\n]*|[ \t]*#[^\n]*)?$/gm;
    for (const fieldMatch of body.matchAll(fieldRe)) {
      const field = fieldMatch[1];
      if (field === 'model_config' || field === 'Config') continue;
      fields.push(field);
      const annotation = fieldMatch[2].trim();
      types[field] = coarsenPythonTypeAnnotation(annotation);
    }
    if (fields.length > 0) {
      models.set(name, { fields: fields.sort(), types: Object.freeze({ ...types }) });
    }
  }
  return models;
}

// Split a type-annotation string at top-level commas / pipes — respecting
// nested `[...]` brackets — so `Union[A, B[C, D]]` splits into `[A, B[C, D]]`
// not `[A, B[C, D]]`.
function splitTopLevelTypeArgs(s: string, delim: ',' | '|'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === delim && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Coarsen a Pydantic field type annotation to the same FieldTypeTag union
// the TS mapper uses, so cross-stack rules can compare client TS types
// against server Pydantic types symmetrically. Handles the common shapes:
//
//   str / int / float / bool / None / Decimal / UUID / EmailStr
//   Optional[T] / Annotated[T, ...]               → coarsen T (drop wrapper)
//   Union[A, B] / `A | B` (PEP 604)               → only stable if all agree
//   List[T] / list[T] / Sequence[T] / Tuple[...]  → 'array'
//   Dict[K, V] / dict[K, V] / Mapping[K, V]       → 'object'
//   Literal['admin'] / Literal[1] / Literal[True] → primitive of literal
//   <CapitalIdent>                                → 'object' (BaseModel sub)
//
// Anything we don't recognise → 'unknown'. Conservative on purpose:
// /type rules skip 'unknown' tags.
function coarsenPythonTypeAnnotation(ann: string): FieldTypeTag {
  const t = ann.trim();
  if (t === '') return 'unknown';

  // Optional[T] / typing.Optional[T] — strip and recurse.
  const optMatch = t.match(/^(?:typing\.)?Optional\[([\s\S]+)\]$/);
  if (optMatch) return coarsenPythonTypeAnnotation(optMatch[1]);

  // Annotated[T, ...] — first arg is the underlying type.
  const annoMatch = t.match(/^(?:typing\.)?Annotated\[([\s\S]+)\]$/);
  if (annoMatch) {
    const parts = splitTopLevelTypeArgs(annoMatch[1], ',');
    if (parts.length >= 1) return coarsenPythonTypeAnnotation(parts[0]);
    return 'unknown';
  }

  // Union[A, B, ...] — only stable if every non-null branch agrees.
  // ANY 'unknown' branch poisons the result.
  const unionMatch = t.match(/^(?:typing\.)?Union\[([\s\S]+)\]$/);
  if (unionMatch) {
    return coarsenUnionParts(splitTopLevelTypeArgs(unionMatch[1], ','));
  }

  // PEP 604 `int | None | str`. Only treat `|` as a union separator when
  // it appears OUTSIDE of any `[...]` — otherwise `Dict[str, int | None]`
  // would be split incorrectly.
  if (containsTopLevelChar(t, '|')) {
    return coarsenUnionParts(splitTopLevelTypeArgs(t, '|'));
  }

  // Container types — coarsen to wire shape.
  if (/^(?:typing\.)?(?:List|list|Sequence|Iterable|Tuple|tuple|Set|set|FrozenSet|frozenset)\[/.test(t)) return 'array';
  if (/^(?:typing\.)?(?:Dict|dict|Mapping|MutableMapping)\[/.test(t)) return 'object';

  // Literal[X, Y, ...] — coarsen every literal arg, return the shared tag
  // ONLY when all literals agree. Mixed-primitive literals like
  // `Literal['a', 1]` accept either string or number on the wire, so
  // tagging it 'string' (first-only) would FP-flag a number client.
  // OpenCode caught this in the v1 review.
  const litMatch = t.match(/^(?:typing\.)?Literal\[([\s\S]+)\]$/);
  if (litMatch) {
    const parts = splitTopLevelTypeArgs(litMatch[1], ',');
    if (parts.length === 0) return 'unknown';
    const tags = parts.map((p) => coarsenLiteralValue(p.trim()));
    if (tags.includes('unknown')) return 'unknown';
    const set = new Set(tags);
    return set.size === 1 ? [...set][0] : 'unknown';
  }

  // Plain primitives + common Pydantic-string newtypes. `bytes` intentionally
  // stays 'unknown' — it's binary on the wire and not a JSON primitive.
  switch (t) {
    case 'str':
    case 'EmailStr':
    case 'HttpUrl':
    case 'AnyUrl':
    case 'AnyHttpUrl':
    case 'UUID':
    case 'UUID1':
    case 'UUID3':
    case 'UUID4':
    case 'UUID5':
    case 'SecretStr':
      return 'string';
    case 'int':
    case 'float':
    case 'Decimal':
    case 'PositiveInt':
    case 'NegativeInt':
    case 'NonNegativeInt':
    case 'NonPositiveInt':
    case 'PositiveFloat':
    case 'NegativeFloat':
      return 'number';
    case 'bool':
    case 'StrictBool':
      return 'boolean';
    case 'None':
    case 'NoneType':
      return 'null';
  }

  // Capitalized bare identifier could be:
  //   - A nested BaseModel ('object' on the wire)
  //   - A `class Status(str, Enum)` ('string' on the wire)
  //   - A `Status = Literal['a','b']` type alias ('string' on the wire)
  //   - A custom newtype like StrictStr / IPvAnyAddress
  // We can't disambiguate without symbol resolution. Tagging 'object'
  // FP'd Enum/Literal aliases against string clients (Codex flag); tag
  // 'unknown' instead — the rule will skip and we trade FN for FP.
  if (/^[A-Z][\w]*$/.test(t)) return 'unknown';

  return 'unknown';
}

// Coarsen a single literal-value source token (e.g. `'admin'`, `42`, `True`)
// to its primitive tag. Anything we don't recognise as one of the four JSON
// primitives → 'unknown'.
function coarsenLiteralValue(v: string): FieldTypeTag {
  if (/^['"]/.test(v)) return 'string';
  if (/^-?\d/.test(v)) return 'number';
  if (v === 'True' || v === 'False') return 'boolean';
  if (v === 'None') return 'null';
  return 'unknown';
}

function coarsenUnionParts(parts: readonly string[]): FieldTypeTag {
  const tags = parts.map(coarsenPythonTypeAnnotation);
  if (tags.includes('unknown')) return 'unknown';
  const noNull = tags.filter((tag) => tag !== 'null');
  if (noNull.length === 0) return 'null';
  const set = new Set(noNull);
  return set.size === 1 ? [...set][0] : 'unknown';
}

function containsTopLevelChar(s: string, ch: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === ch && depth === 0) return true;
  }
  return false;
}

function extractFastApiBodyValidation(
  fnDef: Parser.SyntaxNode,
  source: string,
  pydanticModels: ReadonlyMap<string, PydanticModel>,
): {
  has: boolean;
  fields: readonly string[] | undefined;
  resolved: boolean;
  types: FieldTypeMap | undefined;
} {
  const body = fnDef.childForFieldName('body') ?? fnDef.namedChildren.find((child) => child.type === 'block');
  const headerEnd = body ? body.startIndex : fnDef.endIndex;
  const header = source.substring(fnDef.startIndex, headerEnd);
  const fields = new Set<string>();
  const types: Record<string, FieldTypeTag> = {};
  let has = false;
  const annotationRe = /([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)/g;
  for (const match of header.matchAll(annotationRe)) {
    const model = pydanticModels.get(match[2]);
    if (!model) continue;
    has = true;
    for (const field of model.fields) fields.add(field);
    for (const [name, tag] of Object.entries(model.types)) {
      // Only record concrete tags. 'unknown' for a key would shadow a
      // concrete tag from another model parameter on the same handler
      // (rare, but multi-arg handlers do exist), so skip them.
      if (tag !== 'unknown') types[name] = tag;
    }
  }
  return {
    has,
    fields: fields.size > 0 ? Array.from(fields).sort() : undefined,
    resolved: fields.size > 0,
    types: Object.keys(types).length > 0 ? Object.freeze({ ...types }) : undefined,
  };
}

// ── state_mutation ───────────────────────────────────────────────────────

function extractStateMutation(root: Parser.SyntaxNode, source: string, filePath: string, nodes: ConceptNode[]): void {
  // Track global keyword usage
  const globalVarsInFile = new Set<string>();
  walkNodes(root, 'global_statement', (node) => {
    for (const child of node.namedChildren) {
      if (child.type === 'identifier') globalVarsInFile.add(child.text);
    }
  });

  walkNodes(root, 'assignment', (node) => {
    const left = node.childForFieldName('left');
    if (!left) return;

    // self.x = ... → scope 'module' (as requested)
    if (left.type === 'attribute') {
      const obj = left.childForFieldName('object');
      if (obj && obj.text === 'self') {
        nodes.push({
          id: conceptId(filePath, 'state_mutation', node.startIndex),
          kind: 'state_mutation',
          primarySpan: nodeSpan(filePath, node),
          evidence: nodeText(source, node, 100),
          confidence: 0.9,
          language: 'py',
          containerId: getContainerId(node, filePath),
          payload: { kind: 'state_mutation', target: left.text, scope: 'module' },
        });
        return;
      }
    }

    // Global or Module level assignment
    if (left.type === 'identifier') {
      const name = left.text;
      const containerId = getContainerId(node, filePath);

      if (globalVarsInFile.has(name)) {
        nodes.push({
          id: conceptId(filePath, 'state_mutation', node.startIndex),
          kind: 'state_mutation',
          primarySpan: nodeSpan(filePath, node),
          evidence: nodeText(source, node, 100),
          confidence: 1.0,
          language: 'py',
          containerId,
          payload: { kind: 'state_mutation', target: name, scope: 'global' },
        });
      } else if (!containerId) {
        // Module level (top level)
        nodes.push({
          id: conceptId(filePath, 'state_mutation', node.startIndex),
          kind: 'state_mutation',
          primarySpan: nodeSpan(filePath, node),
          evidence: nodeText(source, node, 100),
          confidence: 0.8,
          language: 'py',
          payload: { kind: 'state_mutation', target: name, scope: 'module' },
        });
      }
    }
  });
}

// ── dependency ──────────────────────────────────────────────────────────

function extractDependencyEdges(root: Parser.SyntaxNode, source: string, filePath: string, edges: ConceptEdge[]): void {
  const addDependency = (node: Parser.SyntaxNode, specifier: string): void => {
    let subtype: 'stdlib' | 'external' | 'internal' = 'external';
    if (specifier.startsWith('.')) {
      subtype = 'internal';
    } else {
      const rootModule = specifier.split('.')[0];
      if (STDLIB_MODULES.has(rootModule)) {
        subtype = 'stdlib';
      }
    }

    edges.push({
      id: `${filePath}#dep@${node.startIndex}`,
      kind: 'dependency',
      sourceId: filePath,
      targetId: specifier,
      primarySpan: nodeSpan(filePath, node),
      evidence: nodeText(source, node, 100),
      confidence: 1.0,
      language: 'py',
      payload: { kind: 'dependency', subtype, specifier },
    });
  };

  walkNodes(root, 'import_statement', (node) => {
    // import x, y as z
    for (const child of node.namedChildren) {
      if (child.type === 'dotted_name') {
        addDependency(node, child.text);
      } else if (child.type === 'aliased_import') {
        const name = child.childForFieldName('name');
        if (name) addDependency(node, name.text);
      }
    }
  });

  walkNodes(root, 'import_from_statement', (node) => {
    // from x import y
    const moduleNode = node.childForFieldName('module_name');
    const relativeMatch = node.text.match(/^from\s+(\.+)/);
    let specifier = moduleNode ? moduleNode.text : '';
    if (relativeMatch) {
      specifier = relativeMatch[1] + specifier;
    }
    if (specifier) {
      addDependency(node, specifier);
    }
  });
}

// ── Tree-sitter Helpers ──────────────────────────────────────────────────

function walkNodes(root: Parser.SyntaxNode, type: string, callback: (node: Parser.SyntaxNode) => void): void {
  const cursor = root.walk();
  let reachedRoot = false;
  while (true) {
    if (cursor.nodeType === type) {
      callback(cursor.currentNode);
    }
    if (cursor.gotoFirstChild()) continue;
    if (cursor.gotoNextSibling()) continue;
    while (true) {
      if (!cursor.gotoParent()) {
        reachedRoot = true;
        break;
      }
      if (cursor.gotoNextSibling()) break;
    }
    if (reachedRoot) break;
  }
}

function nodeSpan(filePath: string, node: Parser.SyntaxNode): ConceptSpan {
  return conceptSpan(
    filePath,
    node.startPosition.row + 1,
    node.startPosition.column + 1,
    node.endPosition.row + 1,
    node.endPosition.column + 1,
  );
}

function nodeText(source: string, node: Parser.SyntaxNode, maxLen: number): string {
  return source.substring(node.startIndex, Math.min(node.endIndex, node.startIndex + maxLen));
}

function getContainerId(node: Parser.SyntaxNode, filePath: string): string | undefined {
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'function_definition' || parent.type === 'class_definition') {
      const nameNode = parent.childForFieldName('name');
      const name = nameNode ? nameNode.text : 'anonymous';
      return `${filePath}#fn:${name}@${parent.startIndex}`;
    }
    parent = parent.parent;
  }
  return undefined;
}

function getSelfContainerId(node: Parser.SyntaxNode, filePath: string): string | undefined {
  if (node.type !== 'function_definition' && node.type !== 'class_definition') return undefined;
  const nameNode = node.childForFieldName('name');
  const name = nameNode ? nameNode.text : 'anonymous';
  return `${filePath}#fn:${name}@${node.startIndex}`;
}

function extractResponseModel(decoratorText: string): string | undefined {
  const match = decoratorText.match(/\bresponse_model\s*=/);
  if (!match || match.index === undefined) return undefined;

  let index = match.index + match[0].length;
  while (/\s/.test(decoratorText[index] ?? '')) index++;

  const start = index;
  let squareDepth = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let quote: string | undefined;

  while (index < decoratorText.length) {
    const char = decoratorText[index];
    const prev = decoratorText[index - 1];

    if (quote) {
      if (char === quote && prev !== '\\') quote = undefined;
      index++;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      index++;
      continue;
    }

    if (char === '[') squareDepth++;
    else if (char === ']') squareDepth = Math.max(0, squareDepth - 1);
    else if (char === '(') parenDepth++;
    else if (char === ')') {
      if (squareDepth === 0 && parenDepth === 0 && braceDepth === 0) break;
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === '{') braceDepth++;
    else if (char === '}') braceDepth = Math.max(0, braceDepth - 1);
    else if (char === ',' && squareDepth === 0 && parenDepth === 0 && braceDepth === 0) {
      break;
    }

    index++;
  }

  const model = decoratorText.slice(start, index).trim();
  if (!model || model === 'None') return undefined;
  return model;
}

function extractRaiseType(node: Parser.SyntaxNode): string | undefined {
  // raise ValueError("...") → "ValueError"
  const callNode = node.namedChildren.find((c) => c.type === 'call');
  if (callNode) {
    const func = callNode.childForFieldName('function');
    if (func) return func.text;
  }
  // raise ValueError → just identifier
  const ident = node.namedChildren.find((c) => c.type === 'identifier');
  if (ident) return ident.text;
  return undefined;
}

function extractExceptVar(node: Parser.SyntaxNode): string | undefined {
  // except Exception as e → "e"
  for (const child of node.children) {
    if (child.type === 'as_pattern') {
      const alias = child.childForFieldName('alias');
      if (alias) return alias.text;
    }
    // Also try direct identifier after 'as'
    if (child.type === 'identifier' && child.previousSibling?.text === 'as') {
      return child.text;
    }
  }
  return undefined;
}

function isInAsyncDef(node: Parser.SyntaxNode): boolean {
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'function_definition') {
      return isAsyncFunction(parent);
    }
    parent = parent.parent;
  }
  return false;
}

function isAsyncFunction(node: Parser.SyntaxNode): boolean {
  return node.children.some((c) => c.type === 'async');
}
