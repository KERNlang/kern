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
const API_SUCCESS_STATUS_CODES_FB = new Set([200, 201, 202, 204, 206]);
const FASTAPI_DEFAULT_SUCCESS_FB = 200;
const FB_PAGE_ANCHORS = new Set(['page', 'page_number', 'pageNumber']);
const FB_OFFSET_ANCHORS = new Set(['offset', 'skip']);
const FB_CURSOR_ANCHORS = new Set(['cursor', 'after', 'before', 'next', 'previous']);
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

// P2-A fallback parity: mirror of `extractFastApiSuccessStatusCodes` in
// `packages/review-python/src/mapper.ts`. The fallback handles repos where
// the tree-sitter native build is unavailable. Both extractors must produce
// identical outputs for the same FastAPI source so cross-stack rules behave
// the same regardless of which path was used.
function successStatusCodesFromDecoratorAndBody(
  decoratorText: string,
  body: string,
): { codes: readonly number[] | undefined; resolved: boolean } {
  let sawDynamic = false;

  const decStatusMatch = decoratorText.match(/\bstatus_code\s*=\s*([^,)]+)/);
  let decoratorCode: number | undefined;
  if (decStatusMatch) {
    const code = parseFastApiStatusValueFb(decStatusMatch[1].trim());
    if (code === undefined) sawDynamic = true;
    else if (API_SUCCESS_STATUS_CODES_FB.has(code)) decoratorCode = code;
  }

  const responseCodes = new Set<number>();
  const responseRe =
    /\b(?:Response|JSONResponse|HTMLResponse|PlainTextResponse|RedirectResponse|StreamingResponse|FileResponse|ORJSONResponse|UJSONResponse)\s*\([^)]*?\bstatus_code\s*=\s*([^,)\n]+)/g;
  for (const match of body.matchAll(responseRe)) {
    const code = parseFastApiStatusValueFb(match[1].trim());
    if (code === undefined) sawDynamic = true;
    else if (API_SUCCESS_STATUS_CODES_FB.has(code)) responseCodes.add(code);
  }

  // Match any identifier prefix (Codex impl-review #2): the injected Response
  // param name varies — `response`, `resp`, `r`, `out`, etc.
  const mutationCodes = new Set<number>();
  const mutateRe = /\b[A-Za-z_]\w*\.status_code\s*=\s*([^\n;]+)/g;
  for (const match of body.matchAll(mutateRe)) {
    const code = parseFastApiStatusValueFb(match[1].trim());
    if (code === undefined) sawDynamic = true;
    else if (API_SUCCESS_STATUS_CODES_FB.has(code)) mutationCodes.add(code);
  }

  if (sawDynamic) return { codes: undefined, resolved: false };

  const plainReturnRe =
    /\breturn\b(?!\s+(?:Response|JSONResponse|HTMLResponse|PlainTextResponse|RedirectResponse|StreamingResponse|FileResponse|ORJSONResponse|UJSONResponse)\s*\()/;
  const hasPlainReturn = plainReturnRe.test(body);

  const final = new Set<number>();
  if (hasPlainReturn) {
    if (mutationCodes.size > 0) {
      for (const c of mutationCodes) final.add(c);
    } else if (decoratorCode !== undefined) {
      final.add(decoratorCode);
    } else {
      final.add(FASTAPI_DEFAULT_SUCCESS_FB);
    }
  } else if (decoratorCode !== undefined && responseCodes.size === 0 && mutationCodes.size === 0) {
    final.add(decoratorCode);
  }
  for (const c of responseCodes) final.add(c);
  for (const c of mutationCodes) final.add(c);

  return {
    codes: Array.from(final).sort((a, b) => a - b),
    resolved: true,
  };
}

/** Collect the full decorator text starting at line `startIdx`, walking
 *  forward through continuation lines until the outer parentheses balance.
 *  Used by the fallback success-status extraction so multi-line decorators
 *  like `@router.post(\n    "/x",\n    status_code=201,\n)` aren't truncated
 *  to the first line (Codex impl-review #3). */
function collectFullDecoratorText(lines: readonly LineInfo[], startIdx: number): string {
  const parts: string[] = [];
  let depth = 0;
  let started = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].text;
    parts.push(line);
    for (const ch of line) {
      if (ch === '(') {
        depth++;
        started = true;
      } else if (ch === ')') {
        depth--;
      }
    }
    if (started && depth === 0) break;
  }
  return parts.join('\n');
}

function parseFastApiStatusValueFb(val: string): number | undefined {
  const trimmed = val.trim();
  const litMatch = trimmed.match(/^(\d{3})$/);
  if (litMatch) return Number(litMatch[1]);
  const httpMatch = trimmed.match(/HTTP_(\d{3})_/);
  if (httpMatch) return Number(httpMatch[1]);
  return undefined;
}

// P2-A fallback parity: classify the route handler's parameter signature
// against pagination anchor families. The fallback parses the function-def
// signature line(s) since it has no AST; tree-sitter mapper is preferred
// when available.
function paginationStrategyFromSignature(
  routeFn: FunctionBlock | undefined,
  lines: readonly LineInfo[],
): {
  strategy: 'page' | 'offset' | 'cursor' | 'mixed' | 'none' | undefined;
  resolved: boolean;
} {
  if (!routeFn) return { strategy: 'none', resolved: true };
  const headerLine = lines.find((line) => line.line === routeFn.startLine)?.text ?? '';
  // Multi-line signatures: collect lines from startLine until we close the
  // outer `(` introducing parameters.
  let sig = headerLine;
  let depth = 0;
  let foundOpen = false;
  for (const ch of headerLine) {
    if (ch === '(') {
      depth++;
      foundOpen = true;
    } else if (ch === ')') {
      depth--;
    }
  }
  if (foundOpen && depth > 0) {
    for (let i = routeFn.startLine; i < lines.length && depth > 0; i++) {
      const text = lines[i]?.text ?? '';
      sig += `\n${text}`;
      for (const ch of text) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (depth === 0) break;
      }
    }
  }

  const openIdx = sig.indexOf('(');
  if (openIdx === -1) return { strategy: 'none', resolved: true };
  // Find matching close paren.
  let d = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < sig.length; i++) {
    const ch = sig[i];
    if (ch === '(') d++;
    else if (ch === ')') {
      d--;
      if (d === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx === -1) return { strategy: undefined, resolved: false };

  const paramsText = sig.substring(openIdx + 1, closeIdx);
  // Split by top-level commas, respecting nested parens/brackets.
  const params: string[] = [];
  let bracketDepth = 0;
  let cur = '';
  for (const ch of paramsText) {
    if (ch === '(' || ch === '[' || ch === '{') bracketDepth++;
    else if (ch === ')' || ch === ']' || ch === '}') bracketDepth--;
    else if (ch === ',' && bracketDepth === 0) {
      if (cur.trim()) params.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) params.push(cur.trim());

  const families = new Set<'page' | 'offset' | 'cursor'>();
  let sawOpaque = false;

  for (const raw of params) {
    if (raw.startsWith('**')) {
      sawOpaque = true;
      continue;
    }
    if (raw.startsWith('*')) continue;

    // Drop default value (after first top-level `=`) and trailing type annotation
    // separators to extract the parameter name.
    let nameAndType = raw;
    let defaultExpr = '';
    let eqDepth = 0;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (ch === '(' || ch === '[' || ch === '{') eqDepth++;
      else if (ch === ')' || ch === ']' || ch === '}') eqDepth--;
      else if (ch === '=' && eqDepth === 0) {
        nameAndType = raw.substring(0, i);
        defaultExpr = raw.substring(i + 1);
        break;
      }
    }
    const colonIdx = nameAndType.indexOf(':');
    const namePart = colonIdx === -1 ? nameAndType.trim() : nameAndType.substring(0, colonIdx).trim();
    const typePart = colonIdx === -1 ? '' : nameAndType.substring(colonIdx + 1).trim();
    if (!namePart) continue;
    if (/\bRequest\b/.test(typePart)) {
      sawOpaque = true;
      continue;
    }

    // Modern FastAPI (≥0.95): `x: Annotated[int, Query(alias="page")]` —
    // Query() lives in the type annotation, not the default. Older syntax
    // puts it in the default: `x: int = Query(0, alias="page")`. Both are
    // valid; default-form takes precedence when both are present.
    const aliasFromDefault = extractQueryAliasFb(defaultExpr);
    const aliasFromType = aliasFromDefault.alias === undefined ? extractQueryAliasFb(typePart) : aliasFromDefault;
    if (aliasFromDefault.opaque || aliasFromType.opaque) {
      sawOpaque = true;
      continue;
    }
    let key = namePart;
    if (aliasFromDefault.alias) key = aliasFromDefault.alias;
    else if (aliasFromType.alias) key = aliasFromType.alias;

    const family = classifyAnchorFb(key);
    if (family) families.add(family);
  }

  if (sawOpaque) return { strategy: undefined, resolved: false };
  if (families.size === 0) return { strategy: 'none', resolved: true };
  if (families.size === 1) return { strategy: [...families][0], resolved: true };
  return { strategy: 'mixed', resolved: true };
}

function classifyAnchorFb(key: string): 'page' | 'offset' | 'cursor' | undefined {
  if (FB_PAGE_ANCHORS.has(key)) return 'page';
  if (FB_OFFSET_ANCHORS.has(key)) return 'offset';
  if (FB_CURSOR_ANCHORS.has(key)) return 'cursor';
  return undefined;
}

function extractQueryAliasFb(text: string | undefined): { alias?: string; opaque: boolean } {
  if (!text) return { opaque: false };
  if (!/\bQuery\s*\(/.test(text)) return { opaque: false };
  const aliasMatch = text.match(/\balias\s*=\s*['"]([^'"]+)['"]/);
  if (aliasMatch) return { alias: aliasMatch[1], opaque: false };
  if (/\balias\s*=/.test(text)) return { opaque: true };
  return { opaque: false };
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

type FieldTypeTag = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'unknown';
type FieldTypeMap = Readonly<Record<string, FieldTypeTag>>;

interface PydanticModel {
  fields: readonly string[];
  types: FieldTypeMap;
}

function collectPydanticModels(lines: readonly LineInfo[]): Map<string, PydanticModel> {
  const models = new Map<string, PydanticModel>();
  for (let i = 0; i < lines.length; i++) {
    const info = lines[i];
    const match = info.text.match(/^(\s*)class\s+([A-Za-z_]\w*)\s*\([^)]*BaseModel[^)]*\)\s*:/);
    if (!match) continue;

    const classIndent = match[1].length;
    const fields: string[] = [];
    const types: Record<string, FieldTypeTag> = {};
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      const trimmed = line.text.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (indentation(line.text) <= classIndent) break;
      const fieldMatch = trimmed.match(/^([A-Za-z_]\w*)\s*:\s*([^=#]+?)(?:\s*=.*|\s*#.*)?$/);
      if (!fieldMatch) continue;
      const field = fieldMatch[1];
      if (field === 'model_config' || field === 'Config') continue;
      fields.push(field);
      types[field] = coarsenPythonTypeAnnotation(fieldMatch[2].trim());
    }
    if (fields.length > 0) {
      models.set(match[2], { fields: fields.sort(), types: Object.freeze({ ...types }) });
    }
  }
  return models;
}

function fallbackBodyValidation(
  fn: FunctionBlock | undefined,
  lines: readonly LineInfo[],
  pydanticModels: ReadonlyMap<string, PydanticModel>,
): {
  has: boolean;
  fields: readonly string[] | undefined;
  resolved: boolean;
  types: FieldTypeMap | undefined;
} {
  if (!fn) return { has: false, fields: undefined, resolved: false, types: undefined };
  const header = lines.find((line) => line.line === fn.startLine)?.text ?? '';
  const fields = new Set<string>();
  const types: Record<string, FieldTypeTag> = {};
  for (const match of header.matchAll(/([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)/g)) {
    const model = pydanticModels.get(match[2]);
    if (!model) continue;
    for (const field of model.fields) fields.add(field);
    for (const [name, tag] of Object.entries(model.types)) {
      if (tag !== 'unknown') types[name] = tag;
    }
  }
  return {
    has: fields.size > 0,
    fields: fields.size > 0 ? Array.from(fields).sort() : undefined,
    resolved: fields.size > 0,
    types: Object.keys(types).length > 0 ? Object.freeze({ ...types }) : undefined,
  };
}

// Mirror of `coarsenPythonTypeAnnotation` in @kernlang/review-python's
// tree-sitter mapper. Both extractors should produce identical type tags
// for the same Pydantic source so cross-stack rules behave consistently
// regardless of which path was used. See that file for shape coverage.
function coarsenPythonTypeAnnotation(ann: string): FieldTypeTag {
  const t = ann.trim();
  if (t === '') return 'unknown';

  const optMatch = t.match(/^(?:typing\.)?Optional\[([\s\S]+)\]$/);
  if (optMatch) return coarsenPythonTypeAnnotation(optMatch[1]);

  const annoMatch = t.match(/^(?:typing\.)?Annotated\[([\s\S]+)\]$/);
  if (annoMatch) {
    const parts = splitTopLevelTypeArgs(annoMatch[1], ',');
    if (parts.length >= 1) return coarsenPythonTypeAnnotation(parts[0]);
    return 'unknown';
  }

  const unionMatch = t.match(/^(?:typing\.)?Union\[([\s\S]+)\]$/);
  if (unionMatch) {
    return coarsenUnionParts(splitTopLevelTypeArgs(unionMatch[1], ','));
  }

  if (containsTopLevelChar(t, '|')) {
    return coarsenUnionParts(splitTopLevelTypeArgs(t, '|'));
  }

  if (/^(?:typing\.)?(?:List|list|Sequence|Iterable|Tuple|tuple|Set|set|FrozenSet|frozenset)\[/.test(t)) return 'array';
  if (/^(?:typing\.)?(?:Dict|dict|Mapping|MutableMapping)\[/.test(t)) return 'object';

  // Mirror of the tree-sitter mapper: every Literal arg must coarsen to
  // the same primitive tag, else 'unknown'. Mixed `Literal['a', 1]` would
  // FP a number client against a 'string' tag.
  const litMatch = t.match(/^(?:typing\.)?Literal\[([\s\S]+)\]$/);
  if (litMatch) {
    const parts = splitTopLevelTypeArgs(litMatch[1], ',');
    if (parts.length === 0) return 'unknown';
    const tags = parts.map((p) => coarsenLiteralValue(p.trim()));
    if (tags.includes('unknown')) return 'unknown';
    const set = new Set(tags);
    return set.size === 1 ? [...set][0] : 'unknown';
  }

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

  // Capitalized bare ident → 'unknown' (could be Enum/alias/newtype, not
  // necessarily a BaseModel). Mirror of the tree-sitter mapper choice.
  if (/^[A-Z][\w]*$/.test(t)) return 'unknown';
  return 'unknown';
}

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
      // Codex impl-review #3: multi-line decorators put `status_code=` on
      // continuation lines. Collect the full decorator text across lines
      // until the outer `(` closes.
      const decoratorFullText = collectFullDecoratorText(lines, info.line - 1);
      const success = successStatusCodesFromDecoratorAndBody(decoratorFullText, body);
      const pagination = paginationStrategyFromSignature(routeFn, lines);
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
          successStatusCodes: success.codes,
          successStatusCodesResolved: success.resolved,
          paginationStrategy: pagination.strategy,
          paginationStrategyResolved: pagination.resolved,
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
          validatedBodyFieldTypes: validation.types,
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
