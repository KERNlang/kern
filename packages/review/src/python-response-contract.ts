const FASTAPI_RESPONSE_CLASSES = new Set([
  'FileResponse',
  'HTMLResponse',
  'JSONResponse',
  'ORJSONResponse',
  'PlainTextResponse',
  'RedirectResponse',
  'Response',
  'StreamingResponse',
  'UJSONResponse',
]);

const NON_JSON_RESPONSE_CLASSES = new Set([
  'FileResponse',
  'HTMLResponse',
  'PlainTextResponse',
  'RedirectResponse',
  'Response',
  'StreamingResponse',
]);

const FASTAPI_RESPONSE_CLASS_PATTERNS = Array.from(FASTAPI_RESPONSE_CLASSES, (candidate) => ({
  candidate,
  pattern: new RegExp(`(?:^|[^A-Za-z0-9_])${candidate}(?:$|[^A-Za-z0-9_])`),
}));

export interface PythonResponseEvidence {
  responseModel?: string;
  responseClass?: string;
  includeInSchema?: boolean;
}

export interface PythonRouterReference {
  routerName: string;
  sourceModule?: string;
  routerNameAuthoritative: boolean;
}

export interface PythonImportAlias {
  sourceModule: string;
  importedName: string;
  fromImport?: boolean;
}

export type PythonStringDelimiter = "'" | '"' | "'''" | '"""';

export interface PythonStructuralLine {
  parenDelta: number;
  sawOpenParen: boolean;
  hasColon: boolean;
  quote?: PythonStringDelimiter;
}

export interface PythonRouterConfiguration {
  prefix?: string;
  includeInSchema?: boolean;
}

export function inferPythonResponseEvidence(
  decoratorText: string,
  returnAnnotation: string | undefined,
): PythonResponseEvidence {
  const explicitModel = extractPythonKeywordArgument(decoratorText, 'response_model');
  const explicitResponseClass = extractPythonKeywordArgument(decoratorText, 'response_class');
  const returnResponseClass = normalizedResponseClass(returnAnnotation);
  const responseClass = normalizedResponseClass(explicitResponseClass) ?? returnResponseClass;
  const includeInSchema = pythonBooleanLiteral(extractPythonKeywordArgument(decoratorText, 'include_in_schema'));

  let responseModel: string | undefined;
  if (explicitModel && explicitModel !== 'None') {
    responseModel = explicitModel;
  } else if (
    explicitModel !== 'None' &&
    returnAnnotation &&
    !isNonJsonFastApiResponseClass(responseClass) &&
    !returnResponseClass &&
    isModelReturnAnnotation(returnAnnotation)
  ) {
    responseModel = returnAnnotation.trim();
  }

  return { responseModel, responseClass, includeInSchema };
}

export function inferPythonRouterConfiguration(callText: string): PythonRouterConfiguration {
  const prefixArgument = extractPythonKeywordArgument(callText, 'prefix');
  return {
    prefix: prefixArgument === undefined ? undefined : extractPythonStringLiteral(prefixArgument),
    includeInSchema: pythonBooleanLiteral(extractPythonKeywordArgument(callText, 'include_in_schema')),
  };
}

export function combinePythonSchemaInclusion(
  routeValue: boolean | undefined,
  routerValue: boolean | undefined,
): boolean | undefined {
  if (routeValue === false || routerValue === false) return false;
  if (routeValue === true || routerValue === true) return true;
  return undefined;
}

export function joinPythonRoutePaths(prefix: string | undefined, path: string): string {
  if (!prefix) return path;
  const normalizedPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return `${normalizedPrefix}${path.startsWith('/') ? path : `/${path}`}`;
}

export function isNonJsonFastApiResponseClass(responseClass: string | undefined): boolean {
  return responseClass ? NON_JSON_RESPONSE_CLASSES.has(lastTypeName(responseClass)) : false;
}

export function collectPythonImportAliases(source: string): ReadonlyMap<string, PythonImportAlias> {
  const aliases = new Map<string, PythonImportAlias>();
  for (const line of pythonImportStatements(source)) {
    const fromMatch = line.match(/^from\s+([.A-Za-z_][\w.]*)\s+import\s+(.+)$/);
    if (fromMatch) {
      const moduleName = fromMatch[1];
      const importedValues = fromMatch[2].replace(/[()]/g, '').split(',');
      for (const value of importedValues) {
        const imported = value.trim().match(/^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?$/);
        if (!imported) continue;
        const importedName = imported[1];
        const localName = imported[2] ?? importedName;
        aliases.set(localName, {
          sourceModule: moduleName,
          importedName,
          fromImport: true,
        });
      }
      continue;
    }

    const importMatch = line.match(/^import\s+(.+)$/);
    if (importMatch) {
      for (const value of importMatch[1].split(',')) {
        const imported = value.trim().match(/^([.A-Za-z_][\w.]*)(?:\s+as\s+([A-Za-z_]\w*))?$/);
        if (!imported) continue;
        const localName = imported[2] ?? imported[1].split('.')[0];
        aliases.set(localName, { sourceModule: imported[1], importedName: localName });
      }
    }
  }
  return aliases;
}

export function resolvePythonRouterReference(
  routerRef: string,
  aliases: ReadonlyMap<string, PythonImportAlias>,
): PythonRouterReference {
  const parts = routerRef.split('.');
  const routerName = parts.pop() ?? routerRef;
  if (parts.length === 0) {
    const imported = aliases.get(routerRef);
    return {
      routerName: imported?.importedName ?? routerName,
      sourceModule: imported?.sourceModule,
      routerNameAuthoritative: imported === undefined,
    };
  }

  const root = parts[0];
  const importedRoot = aliases.get(root);
  const referencedModule = parts.join('.');
  let sourceModule = referencedModule;
  if (importedRoot?.fromImport) {
    sourceModule = appendPythonModule(importedRoot.sourceModule, importedRoot.importedName, ...parts.slice(1));
  } else if (importedRoot) {
    const fullyQualifiedRootReference =
      referencedModule.startsWith(`${root}.`) && importedRoot.sourceModule.startsWith(`${root}.`);
    sourceModule =
      fullyQualifiedRootReference ||
      referencedModule === importedRoot.sourceModule ||
      referencedModule.startsWith(`${importedRoot.sourceModule}.`)
        ? referencedModule
        : [importedRoot.sourceModule, ...parts.slice(1)].join('.');
  }
  return { routerName, sourceModule, routerNameAuthoritative: true };
}

export function extractPythonKeywordArgument(source: string, keyword: string): string | undefined {
  const assignment = new RegExp(`^${keyword}\\s*=(?!=)\\s*([\\s\\S]+)$`);
  for (const argument of pythonCallArguments(source)) {
    const value = argument.match(assignment)?.[1].trim();
    if (value) return value;
  }
  return undefined;
}

export function extractPythonRouterArgument(source: string): string | undefined {
  const keywordRouter = extractPythonKeywordArgument(source, 'router');
  if (keywordRouter && isPythonReference(keywordRouter)) return keywordRouter;

  const firstArgument = pythonCallArguments(source)[0];
  return firstArgument && isPythonReference(firstArgument) ? firstArgument.trim() : undefined;
}

export function extractPythonRoutePath(source: string): string | undefined {
  const keywordPath = extractPythonKeywordArgument(source, 'path');
  if (keywordPath !== undefined) return extractPythonStringLiteral(keywordPath);
  const firstArgument = pythonCallArguments(source)[0];
  return firstArgument ? extractPythonStringLiteral(firstArgument) : undefined;
}

export function extractPythonStringLiteral(value: string): string | undefined {
  const trimmed = value.trim();
  const match = trimmed.match(/^([rRuUbBfF]{0,2})("""|'''|["'])([\s\S]*)\2$/);
  if (!match) return undefined;
  const [, prefixes, , body] = match;
  if (/f/i.test(prefixes) && /(^|[^{])\{(?!\{)/.test(body)) return undefined;
  return body;
}

export function stripPythonLineComment(line: string): string {
  return stripPythonComments(line);
}

export function scanPythonStructuralLine(
  line: string,
  initialQuote: PythonStringDelimiter | undefined,
): PythonStructuralLine {
  let quote = initialQuote;
  let parenDelta = 0;
  let sawOpenParen = false;
  let hasColon = false;
  let index = 0;
  while (index < line.length) {
    if (quote) {
      if (quote.length === 3) {
        if (line[index] === '\\') index += 2;
        else if (line.startsWith(quote, index)) {
          index += 3;
          quote = undefined;
        } else index++;
      } else if (line[index] === '\\') index += 2;
      else if (line[index] === quote) {
        quote = undefined;
        index++;
      } else index++;
      continue;
    }

    if (line[index] === '#') break;
    const triple = line.slice(index, index + 3);
    if (triple === "'''" || triple === '"""') {
      quote = triple;
      index += 3;
    } else if (line[index] === "'" || line[index] === '"') {
      quote = line[index] as "'" | '"';
      index++;
    } else {
      if (line[index] === '(') {
        parenDelta++;
        sawOpenParen = true;
      } else if (line[index] === ')') parenDelta--;
      else if (line[index] === ':') hasColon = true;
      index++;
    }
  }
  return { parenDelta, sawOpenParen, hasColon, quote };
}

function pythonImportStatements(source: string): string[] {
  const statements: string[] = [];
  const sourceLines = source.split(/\r?\n/);
  const executableLines = pythonExecutableLineMask(sourceLines);
  let pending = '';
  let parenDepth = 0;
  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex++) {
    if (!executableLines[lineIndex]) continue;
    const rawLine = sourceLines[lineIndex];
    const line = stripPythonLineComment(rawLine).trim();
    if (!pending && !/^(?:from|import)\s+/.test(line)) continue;
    if (!line) continue;
    const continued = line.endsWith('\\');
    const fragment = continued ? line.slice(0, -1).trimEnd() : line;
    pending = pending ? `${pending} ${fragment}` : fragment;
    for (const char of line) {
      if (char === '(') parenDepth++;
      else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
    }
    if (parenDepth === 0 && !continued) {
      statements.push(pending);
      pending = '';
    }
  }
  return statements;
}

export function pythonExecutableLineMask(lines: readonly string[]): boolean[] {
  let delimiter: "'''" | '"""' | undefined;
  return lines.map((line) => {
    const startsInsideString = delimiter !== undefined;
    delimiter = scanPythonTripleQuotedLine(line, delimiter);
    return !startsInsideString;
  });
}

function scanPythonTripleQuotedLine(line: string, active: "'''" | '"""' | undefined): "'''" | '"""' | undefined {
  let index = 0;
  while (index < line.length) {
    if (active) {
      if (line[index] === '\\') index += 2;
      else if (line.startsWith(active, index)) {
        index += 3;
        active = undefined;
      } else index++;
      continue;
    }

    const char = line[index];
    if (char === '#') return undefined;
    const triple = line.slice(index, index + 3);
    if (triple === "'''" || triple === '"""') {
      active = triple;
      index += 3;
      continue;
    }
    if (char === '"' || char === "'") {
      index = skipPythonString(line, index, char);
      continue;
    }
    index++;
  }
  return active;
}

function skipPythonString(source: string, start: number, quote: string): number {
  const delimiter = source.slice(start, start + 3) === quote.repeat(3) ? quote.repeat(3) : quote;
  let index = start + delimiter.length;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source.startsWith(delimiter, index)) return index + delimiter.length;
    index++;
  }
  return source.length;
}

function normalizedResponseClass(value: string | undefined): string | undefined {
  if (!value) return undefined;
  for (const { candidate, pattern } of FASTAPI_RESPONSE_CLASS_PATTERNS) {
    if (pattern.test(value)) return candidate;
  }
  return undefined;
}

function isModelReturnAnnotation(value: string): boolean {
  const normalized = value.trim();
  return normalized !== 'Any' && normalized !== 'typing.Any' && normalized !== 'None' && normalized !== 'NoneType';
}

function pythonBooleanLiteral(value: string | undefined): boolean | undefined {
  if (value === 'True') return true;
  if (value === 'False') return false;
  return undefined;
}

function lastTypeName(value: string): string {
  return value.split('.').pop() ?? value;
}

function isPythonReference(value: string): boolean {
  return /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(value.trim());
}

function appendPythonModule(base: string, ...segments: string[]): string {
  let moduleName = base;
  for (const segment of segments) {
    if (!segment) continue;
    moduleName = moduleName.endsWith('.') ? `${moduleName}${segment}` : `${moduleName}.${segment}`;
  }
  return moduleName;
}

function pythonCallArguments(source: string): string[] {
  const withoutComments = stripPythonComments(source);
  const includeRouterStart = findPythonCodeSubstring(withoutComments, '.include_router');
  const openParen = withoutComments.indexOf('(', includeRouterStart === -1 ? 0 : includeRouterStart);
  if (openParen === -1) return [];

  const argumentsList: string[] = [];
  const depths = { square: 0, paren: 0, brace: 0 };
  let argumentStart = openParen + 1;
  let index = argumentStart;
  while (index < withoutComments.length) {
    const char = withoutComments[index];
    if (char === '"' || char === "'") {
      index = skipPythonString(withoutComments, index, char);
      continue;
    }
    if (char === '[') depths.square++;
    else if (char === ']') depths.square = Math.max(0, depths.square - 1);
    else if (char === '(') depths.paren++;
    else if (char === ')') {
      if (depths.square === 0 && depths.paren === 0 && depths.brace === 0) {
        pushPythonCallArgument(argumentsList, withoutComments.slice(argumentStart, index));
        return argumentsList;
      }
      depths.paren = Math.max(0, depths.paren - 1);
    } else if (char === '{') depths.brace++;
    else if (char === '}') depths.brace = Math.max(0, depths.brace - 1);
    else if (char === ',' && depths.square === 0 && depths.paren === 0 && depths.brace === 0) {
      pushPythonCallArgument(argumentsList, withoutComments.slice(argumentStart, index));
      argumentStart = index + 1;
    }
    index++;
  }

  pushPythonCallArgument(argumentsList, withoutComments.slice(argumentStart));
  return argumentsList;
}

function findPythonCodeSubstring(source: string, needle: string): number {
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'") {
      index = skipPythonString(source, index, char);
    } else if (source.startsWith(needle, index)) {
      return index;
    } else {
      index++;
    }
  }
  return -1;
}

function pushPythonCallArgument(argumentsList: string[], value: string): void {
  const argument = value.trim();
  if (argument) argumentsList.push(argument);
}

function stripPythonComments(source: string): string {
  let output = '';
  let quote: PythonStringDelimiter | undefined;
  let index = 0;
  while (index < source.length) {
    if (quote) {
      if (source[index] === '\\') {
        output += source.slice(index, index + 2);
        index += 2;
      } else if (source.startsWith(quote, index)) {
        output += quote;
        index += quote.length;
        quote = undefined;
      } else {
        output += source[index];
        index++;
      }
      continue;
    }

    if (source[index] === '#') {
      const newline = source.indexOf('\n', index);
      if (newline === -1) break;
      output += '\n';
      index = newline + 1;
      continue;
    }
    const triple = source.slice(index, index + 3);
    if (triple === "'''" || triple === '"""') {
      quote = triple;
      output += triple;
      index += 3;
    } else if (source[index] === "'" || source[index] === '"') {
      quote = source[index] as "'" | '"';
      output += source[index];
      index++;
    } else {
      output += source[index];
      index++;
    }
  }
  return output;
}
