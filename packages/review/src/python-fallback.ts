import type { ConceptEdge, ConceptMap, ConceptNode, ConceptSpan } from '@kernlang/core';
import { conceptId, conceptSpan } from '@kernlang/core';

const EXTRACTOR_VERSION = 'fallback-1.0.0';

const NETWORK_MODULES = new Set(['requests', 'httpx', 'aiohttp', 'urllib']);
const NETWORK_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'request', 'fetch']);
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
const API_ERROR_STATUS_CODES = new Set([401, 403, 404, 422, 500]);
const PAGINATION_RE = /\b(limit|offset|skip|cursor|page|page_size|per_page)\b|\.limit\s*\(/i;
const DB_COLLECTION_RE = /\.(find|all|fetchall|to_list|scalars)\s*\(|\bselect\s*\(/i;
const DB_WRITE_RE =
  /\.(insert_one|insert_many|update_one|update_many|delete_one|delete_many|add|create|save|commit)\s*\(/i;
const IDEMPOTENCY_RE =
  /\b(idempotency(?:[_-]?key)?|Idempotency-Key|transaction|unique|upsert|get_or_create|on_conflict)\b/i;
const STDLIB_MODULES = new Set([
  'argparse',
  'base64',
  'collections',
  'csv',
  'datetime',
  'enum',
  'functools',
  'gzip',
  'hashlib',
  'hmac',
  'io',
  'itertools',
  'json',
  'logging',
  'math',
  'multiprocessing',
  'os',
  'pathlib',
  'pickle',
  'random',
  're',
  'shutil',
  'sqlite3',
  'subprocess',
  'sys',
  'tarfile',
  'tempfile',
  'threading',
  'time',
  'typing',
  'unittest',
  'urllib',
  'uuid',
  'xml',
  'zipfile',
  'zlib',
]);

interface LineInfo {
  text: string;
  line: number;
  offset: number;
}

interface FunctionBlock {
  name: string;
  async: boolean;
  startLine: number;
  endLine: number;
  indent: number;
  id: string;
}

function splitLines(source: string): LineInfo[] {
  const lines = source.split('\n');
  let offset = 0;
  return lines.map((text, index) => {
    const info = { text, line: index + 1, offset };
    offset += text.length + 1;
    return info;
  });
}

function indentation(text: string): number {
  return text.match(/^\s*/)?.[0].length ?? 0;
}

function lineSpan(filePath: string, info: LineInfo): ConceptSpan {
  const startCol = indentation(info.text) + 1;
  return conceptSpan(filePath, info.line, startCol, info.line, Math.max(startCol, info.text.length + 1));
}

function nodeText(info: LineInfo): string {
  return info.text.trim();
}

function addNode(nodes: ConceptNode[], node: ConceptNode): void {
  nodes.push(node);
}

function findFunctionBlocks(lines: LineInfo[], filePath: string): FunctionBlock[] {
  const blocks: FunctionBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const info = lines[i];
    const match = info.text.match(/^(\s*)(async\s+def|def)\s+([A-Za-z_]\w*)\s*\(/);
    if (!match) continue;

    const indent = match[1].length;
    let endLine = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j];
      const trimmed = candidate.text.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('@')) continue;
      if (indentation(candidate.text) <= indent) {
        endLine = candidate.line - 1;
        break;
      }
    }

    blocks.push({
      name: match[3],
      async: match[2].startsWith('async'),
      startLine: info.line,
      endLine,
      indent,
      id: `${filePath}#fn:${match[3]}@${info.offset}`,
    });
  }
  return blocks;
}

function containerForLine(blocks: FunctionBlock[], line: number): FunctionBlock | undefined {
  return blocks.find((block) => line >= block.startLine && line <= block.endLine);
}

function classifyDependency(specifier: string): 'stdlib' | 'external' | 'internal' {
  if (specifier.startsWith('.')) return 'internal';
  const root = specifier.split('.')[0];
  return STDLIB_MODULES.has(root) ? 'stdlib' : 'external';
}

function addDependency(edges: ConceptEdge[], filePath: string, info: LineInfo, specifier: string): void {
  edges.push({
    id: `${filePath}#dep@${info.offset}:${specifier}`,
    kind: 'dependency',
    sourceId: filePath,
    targetId: specifier,
    primarySpan: lineSpan(filePath, info),
    evidence: nodeText(info),
    confidence: 0.85,
    language: 'py',
    payload: { kind: 'dependency', subtype: classifyDependency(specifier), specifier },
  });
}

function routeMethod(decorator: string): string | undefined {
  const match = decorator.match(/@(app|router|bp)\.(route|get|post|put|delete|patch)\s*\(/);
  if (!match) return undefined;
  const method = match[2].toUpperCase();
  return method === 'ROUTE' ? undefined : method;
}

function routeName(lines: LineInfo[], decoratorIndex: number): string {
  for (let i = decoratorIndex + 1; i < lines.length; i++) {
    const match = lines[i].text.match(/^\s*(async\s+def|def)\s+([A-Za-z_]\w*)\s*\(/);
    if (match) return match[2];
    if (!lines[i].text.trim().startsWith('@')) break;
  }
  const path = lines[decoratorIndex].text.match(/['"]([^'"]+)['"]/)?.[1];
  return path ?? 'anonymous';
}

function routePath(decorator: string): string | undefined {
  return decorator.match(/['"]([^'"]+)['"]/)?.[1];
}

function routeResponseModel(decorator: string): string | undefined {
  const match = decorator.match(/\bresponse_model\s*=\s*([^,)]+)/);
  return match?.[1]?.trim();
}

function functionBody(lines: LineInfo[], fn: FunctionBlock | undefined): string {
  if (!fn) return '';
  return lines
    .filter((line) => line.line > fn.startLine && line.line <= fn.endLine)
    .map((line) => line.text)
    .join('\n');
}

function nextFunctionAfter(blocks: readonly FunctionBlock[], line: number): FunctionBlock | undefined {
  return blocks.find((block) => block.startLine > line);
}

function errorStatusCodesFromBody(body: string): readonly number[] | undefined {
  const codes = new Set<number>();
  for (const match of body.matchAll(/HTTPException\s*\([^)]*status_code\s*=\s*(\d{3})/g)) {
    const code = Number(match[1]);
    if (API_ERROR_STATUS_CODES.has(code)) codes.add(code);
  }
  for (const match of body.matchAll(/HTTPException\s*\(\s*(\d{3})/g)) {
    const code = Number(match[1]);
    if (API_ERROR_STATUS_CODES.has(code)) codes.add(code);
  }
  return codes.size > 0 ? Array.from(codes).sort((a, b) => a - b) : undefined;
}

function collectPydanticModels(lines: readonly LineInfo[]): Map<string, readonly string[]> {
  const models = new Map<string, readonly string[]>();
  for (let i = 0; i < lines.length; i++) {
    const info = lines[i];
    const match = info.text.match(/^(\s*)class\s+([A-Za-z_]\w*)\s*\([^)]*BaseModel[^)]*\)\s*:/);
    if (!match) continue;

    const classIndent = match[1].length;
    const fields: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      const trimmed = line.text.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (indentation(line.text) <= classIndent) break;
      const field = trimmed.match(/^([A-Za-z_]\w*)\s*:/)?.[1];
      if (!field || field === 'model_config' || field === 'Config') continue;
      fields.push(field);
    }
    if (fields.length > 0) models.set(match[2], fields.sort());
  }
  return models;
}

function fallbackBodyValidation(
  fn: FunctionBlock | undefined,
  lines: readonly LineInfo[],
  pydanticModels: ReadonlyMap<string, readonly string[]>,
): { has: boolean; fields: readonly string[] | undefined; resolved: boolean } {
  if (!fn) return { has: false, fields: undefined, resolved: false };
  const header = lines.find((line) => line.line === fn.startLine)?.text ?? '';
  const fields = new Set<string>();
  for (const match of header.matchAll(/([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)/g)) {
    const modelFields = pydanticModels.get(match[2]);
    if (!modelFields) continue;
    for (const field of modelFields) fields.add(field);
  }
  return {
    has: fields.size > 0,
    fields: fields.size > 0 ? Array.from(fields).sort() : undefined,
    resolved: fields.size > 0,
  };
}

function classifyExceptDisposition(lines: LineInfo[], exceptIndex: number): ConceptNode['payload'] {
  const exceptIndent = indentation(lines[exceptIndex].text);
  const body: string[] = [];
  for (let i = exceptIndex + 1; i < lines.length; i++) {
    const text = lines[i].text;
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (indentation(text) <= exceptIndent) break;
    body.push(trimmed);
  }

  let disposition: 'ignored' | 'logged' | 'wrapped' | 'returned' | 'rethrown' | 'retried' = 'wrapped';
  if (body.length === 0 || (body.length === 1 && (body[0] === 'pass' || body[0] === '...'))) {
    disposition = 'ignored';
  } else if (body.some((line) => /^raise\b/.test(line))) {
    disposition = 'rethrown';
  } else if (body.some((line) => /^return\b/.test(line))) {
    disposition = 'returned';
  } else if (body.some((line) => /\b(logging|logger|log|print)\b/.test(line))) {
    disposition = 'logged';
  }

  return { kind: 'error_handle', disposition };
}

export function extractPythonConceptsFallback(source: string, filePath: string): ConceptMap {
  const lines = splitLines(source);
  const functionBlocks = findFunctionBlocks(lines, filePath);
  const pydanticModels = collectPydanticModels(lines);
  const nodes: ConceptNode[] = [];
  const edges: ConceptEdge[] = [];
  const globalNames = new Set<string>();

  for (const info of lines) {
    const trimmed = info.text.trim();
    const block = containerForLine(functionBlocks, info.line);
    const span = lineSpan(filePath, info);
    const containerId = block?.id;

    if (!trimmed || trimmed.startsWith('#')) continue;

    const fn = functionBlocks.find((candidate) => candidate.startLine === info.line);
    if (fn) {
      const body = lines
        .filter((line) => line.line > fn.startLine && line.line <= fn.endLine)
        .map((line) => line.text)
        .join('\n');
      addNode(nodes, {
        id: fn.id,
        kind: 'function_declaration',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.8,
        language: 'py',
        payload: {
          kind: 'function_declaration',
          name: fn.name,
          async: fn.async,
          hasAwait: /\bawait\b/.test(body),
          isComponent: false,
          isExport: false,
        },
      });
    }

    if (trimmed.startsWith('global ')) {
      for (const name of trimmed.replace(/^global\s+/, '').split(',')) {
        const normalized = name.trim();
        if (normalized) globalNames.add(normalized);
      }
    }

    if (/^(?:import|from)\s+/.test(trimmed)) {
      const fromMatch = trimmed.match(/^from\s+([.\w]+)\s+import\s+/);
      if (fromMatch) {
        addDependency(edges, filePath, info, fromMatch[1]);
      } else {
        const importList = trimmed.replace(/^import\s+/, '').split(',');
        for (const item of importList) {
          const specifier = item
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim();
          if (specifier) addDependency(edges, filePath, info, specifier);
        }
      }
    }

    if (/^@(app|router|bp)\.(route|get|post|put|delete|patch)\s*\(/.test(trimmed)) {
      const method = routeMethod(trimmed);
      const path = routePath(trimmed) ?? routeName(lines, info.line - 1);
      const responseModel = routeResponseModel(trimmed);
      const routeFn = nextFunctionAfter(functionBlocks, info.line);
      const body = functionBody(lines, routeFn);
      const validation = fallbackBodyValidation(routeFn, lines, pydanticModels);
      addNode(nodes, {
        id: conceptId(filePath, 'entrypoint', info.offset),
        kind: 'entrypoint',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.9,
        language: 'py',
        containerId,
        payload: {
          kind: 'entrypoint',
          subtype: 'route',
          name: path,
          httpMethod: method,
          responseModel,
          errorStatusCodes: errorStatusCodesFromBody(body),
          hasUnboundedCollectionQuery:
            method === 'GET' &&
            !/[{:]/.test(path) &&
            !PAGINATION_RE.test(body) &&
            DB_COLLECTION_RE.test(body) &&
            (responseModel ? /^(list|List|Sequence|Iterable)\s*\[/.test(responseModel) : true),
          hasDbWrite: DB_WRITE_RE.test(body),
          hasIdempotencyProtection: IDEMPOTENCY_RE.test(body),
          hasBodyValidation: validation.has,
          validatedBodyFields: validation.fields,
          bodyValidationResolved: validation.resolved,
        },
      });
    }

    if (/@(login_required|requires_auth|permission_required|auth_required|authenticated)/.test(trimmed)) {
      addNode(nodes, {
        id: conceptId(filePath, 'guard', info.offset),
        kind: 'guard',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.9,
        language: 'py',
        containerId,
        payload: { kind: 'guard', subtype: 'auth', name: trimmed.replace('@', '').split('(')[0] },
      });
    }

    if (
      /\bDepends\s*\(\s*(?:auth_required|requires_auth|authenticated|current_user|get_current_user)\b/.test(trimmed)
    ) {
      addNode(nodes, {
        id: conceptId(filePath, 'guard', info.offset),
        kind: 'guard',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.85,
        language: 'py',
        containerId,
        payload: { kind: 'guard', subtype: 'auth', name: 'Depends(auth)' },
      });
    }

    if (/\bmodel_validate\s*\(/.test(trimmed)) {
      addNode(nodes, {
        id: conceptId(filePath, 'guard', info.offset),
        kind: 'guard',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.85,
        language: 'py',
        containerId,
        payload: { kind: 'guard', subtype: 'validation', name: 'pydantic' },
      });
    }

    if (/^if\b.*\b(user|auth|request\.user)\b/.test(trimmed)) {
      const next = lines.find((line) => line.line > info.line && line.text.trim());
      if (next && indentation(next.text) > indentation(info.text) && /^\s*(raise|return)\b/.test(next.text)) {
        addNode(nodes, {
          id: conceptId(filePath, 'guard', info.offset),
          kind: 'guard',
          primarySpan: span,
          evidence: trimmed,
          confidence: 0.75,
          language: 'py',
          containerId,
          payload: { kind: 'guard', subtype: 'auth' },
        });
      }
    }

    if (/^raise\b/.test(trimmed)) {
      addNode(nodes, {
        id: conceptId(filePath, 'error_raise', info.offset),
        kind: 'error_raise',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.9,
        language: 'py',
        containerId,
        payload: { kind: 'error_raise', subtype: 'throw', errorType: trimmed.match(/^raise\s+([A-Za-z_]\w*)/)?.[1] },
      });
    }

    if (/^except\b/.test(trimmed)) {
      addNode(nodes, {
        id: conceptId(filePath, 'error_handle', info.offset),
        kind: 'error_handle',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.75,
        language: 'py',
        containerId,
        payload: classifyExceptDisposition(lines, info.line - 1),
      });
    }

    const networkCall = trimmed.match(
      new RegExp(`\\b(${Array.from(NETWORK_MODULES).join('|')})\\.(${Array.from(NETWORK_METHODS).join('|')})\\s*\\(`),
    );
    if (networkCall || /\baiohttp\.request\s*\(|\bfetch\s*\(/.test(trimmed)) {
      addNode(nodes, {
        id: conceptId(filePath, 'effect', info.offset),
        kind: 'effect',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.75,
        language: 'py',
        containerId,
        payload: { kind: 'effect', subtype: 'network', async: Boolean(block?.async), target: networkCall?.[0] },
      });
    }

    const dbPattern = new RegExp(`\\b([A-Za-z_]\\w*)\\.(${Array.from(DB_METHODS).join('|')})\\s*\\(`);
    const dbCall = trimmed.match(dbPattern);
    if (dbCall && /cursor|conn|db|session|collection/i.test(dbCall[1])) {
      addNode(nodes, {
        id: conceptId(filePath, 'effect', info.offset),
        kind: 'effect',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.7,
        language: 'py',
        containerId,
        payload: { kind: 'effect', subtype: 'db', async: Boolean(block?.async), target: dbCall[0] },
      });
    }

    if (/\bopen\s*\(/.test(trimmed)) {
      addNode(nodes, {
        id: conceptId(filePath, 'effect', info.offset),
        kind: 'effect',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.8,
        language: 'py',
        containerId,
        payload: { kind: 'effect', subtype: 'fs', async: Boolean(block?.async), target: 'open' },
      });
    }

    const assignment = trimmed.match(/^([A-Za-z_]\w*)\s*(?:=|\+=|-=|\*=|\/=)/);
    if (assignment) {
      const atTopLevel = !block;
      const name = assignment[1];
      if (atTopLevel || globalNames.has(name)) {
        addNode(nodes, {
          id: conceptId(filePath, 'state_mutation', info.offset),
          kind: 'state_mutation',
          primarySpan: span,
          evidence: trimmed,
          confidence: atTopLevel ? 0.7 : 0.85,
          language: 'py',
          containerId,
          payload: { kind: 'state_mutation', target: name, scope: globalNames.has(name) ? 'global' : 'module' },
        });
      }
    }

    const selfAssignment = trimmed.match(/^self\.([A-Za-z_]\w*)\s*(?:=|\+=|-=|\*=|\/=)/);
    if (selfAssignment) {
      addNode(nodes, {
        id: conceptId(filePath, 'state_mutation', info.offset),
        kind: 'state_mutation',
        primarySpan: span,
        evidence: trimmed,
        confidence: 0.8,
        language: 'py',
        containerId,
        payload: { kind: 'state_mutation', target: `self.${selfAssignment[1]}`, scope: 'module' },
      });
    }
  }

  return {
    filePath,
    language: 'py',
    nodes,
    edges,
    extractorVersion: EXTRACTOR_VERSION,
  };
}
