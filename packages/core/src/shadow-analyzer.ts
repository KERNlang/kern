/**
 * Shadow Source analyzer — semantic visibility into handler bodies without touching the node model.
 *
 * Strategy: synthesize a virtual TypeScript file per handler that models the surrounding scope
 * (fn params, service `this`, websocket connection locals), run a single shared `ts.Program`
 * across all virtual files, and map diagnostics back to the original .kern source.
 *
 * Narrower v0: supports only contexts whose lowering exists in `packages/core/src/codegen/`.
 * Currently: `fn`, `method` (inside `service`/`repository`), and `on` (inside `websocket`).
 * Every other handler parent is flagged `shadow-unsupported-context` rather than modeled —
 * we'd rather miss diagnostics than emit confident false ones.
 */

import { parseParamList } from './codegen/helpers.js';
import type { IRNode } from './types.js';

// ── Structural TypeScript surface — avoids leaking `typescript` into consumer type graphs ──

interface TsCompilerOptions {
  target?: number;
  module?: number;
  strict?: boolean;
  noEmit?: boolean;
  skipLibCheck?: boolean;
  noUnusedParameters?: boolean;
  noUnusedLocals?: boolean;
  lib?: string[];
  types?: string[];
}

interface TsSourceFile {
  fileName: string;
  text: string;
}

interface TsLineAndCharacter {
  line: number;
  character: number;
}

interface TsDiagnosticMessageChain {
  messageText: string;
  next?: TsDiagnosticMessageChain[];
}

interface TsDiagnostic {
  file?: TsSourceFile;
  start?: number;
  length?: number;
  messageText: string | TsDiagnosticMessageChain;
  code: number;
  category: number;
}

interface TsProgram {
  getSemanticDiagnostics(): readonly TsDiagnostic[];
}

interface TsCompilerHost {
  fileExists(fileName: string): boolean;
  readFile(fileName: string): string | undefined;
  getSourceFile(
    fileName: string,
    languageVersion: number,
    onError?: (message: string) => void,
    shouldCreateNewSourceFile?: boolean,
  ): TsSourceFile | undefined;
  writeFile(fileName: string, data: string, ...rest: unknown[]): void;
  getCurrentDirectory(): string;
  getDefaultLibFileName(options: TsCompilerOptions): string;
  getCanonicalFileName(fileName: string): string;
  useCaseSensitiveFileNames(): boolean;
  getNewLine(): string;
}

interface TsApi {
  ScriptTarget: { ES2022: number };
  ModuleKind: { ESNext: number };
  createCompilerHost(options: TsCompilerOptions, setParentNodes?: boolean): TsCompilerHost;
  createSourceFile(fileName: string, text: string, target: number, setParentNodes?: boolean): TsSourceFile;
  createProgram(args: { rootNames: readonly string[]; options: TsCompilerOptions; host: TsCompilerHost }): TsProgram;
  getLineAndCharacterOfPosition(file: TsSourceFile, position: number): TsLineAndCharacter;
  flattenDiagnosticMessageText(text: string | TsDiagnosticMessageChain, newLine: string): string;
}

// ── Public types ───────────────────────────────────────────────────────────

export interface ShadowDiagnostic {
  rule: string;
  nodeType: string;
  message: string;
  line?: number;
  col?: number;
  tsCode?: number;
}

// ── Internal ───────────────────────────────────────────────────────────────

interface HandlerUnit {
  fileName: string;
  node: IRNode;
  parentType: string;
  rawCode: string;
  virtualSource: string;
  bodyStartLine: number;
  bodyLineCount: number;
  sourceStartLine: number;
  sourceStartCol: number;
}

interface BuildResult {
  unit?: HandlerUnit;
  diagnostics: ShadowDiagnostic[];
}

const HANDLER_OPEN = 'handler <<<';

// Minimal set of type names that should NOT be declared as `type X = any;` in the support file.
// Narrowly scoped — everything not in this set but referenced as a type must either come from
// an IR declaration (collected in collectDeclaredTypeNames) or trigger a real TS diagnostic.
const BUILTIN_TYPE_NAMES = new Set([
  'any', 'unknown', 'never', 'void', 'undefined', 'null',
  'string', 'number', 'boolean', 'object', 'bigint', 'symbol',
  'true', 'false',
  'Promise', 'Array', 'ReadonlyArray', 'Record', 'Pick', 'Omit',
  'Partial', 'Required', 'ReturnType', 'Parameters', 'NonNullable',
  'Exclude', 'Extract', 'Awaited',
  'Map', 'Set', 'WeakMap', 'WeakSet',
  'Date', 'Error', 'RegExp', 'URL', 'URLSearchParams',
  'Uint8Array', 'Buffer',
  'AbortController', 'AbortSignal',
]);

// IR node types that DECLARE a type name usable inside handlers.
const DECLARING_NODE_TYPES = new Set([
  'type', 'interface', 'union', 'error', 'event',
  'model', 'service', 'repository',
]);

export async function analyzeShadow(root: IRNode): Promise<ShadowDiagnostic[]> {
  const ts = await loadTypeScript();
  if (!ts) {
    return [
      {
        rule: 'shadow-typescript-missing',
        nodeType: root.type,
        message: "Shadow analysis requires the optional peer dependency 'typescript' to be installed.",
        line: root.loc?.line,
        col: root.loc?.col,
      },
    ];
  }

  const declaredTypeNames = collectDeclaredTypeNames(root);
  const moduleDeclarations = collectModuleDeclarations(root);
  const diagnostics: ShadowDiagnostic[] = [];
  const units: HandlerUnit[] = [];

  walk(root, [], (node, ancestors) => {
    if (node.type !== 'handler') return;
    if (ancestors.some((a) => a.type === '__error')) return;

    const parentNode = ancestors[ancestors.length - 1];
    if (!parentNode) return;

    const result = buildHandlerUnit(node, parentNode, ancestors, units.length);
    diagnostics.push(...result.diagnostics);
    if (result.unit) units.push(result.unit);
  });

  if (units.length === 0) return diagnostics;

  const supportFileName = '/__kern_shadow__/support.d.ts';
  const files = new Map<string, string>([
    [supportFileName, buildSupportFile(declaredTypeNames, moduleDeclarations)],
  ]);
  const unitsByFile = new Map<string, HandlerUnit>();

  for (const unit of units) {
    files.set(unit.fileName, unit.virtualSource);
    unitsByFile.set(unit.fileName, unit);
  }

  const options: TsCompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    noUnusedParameters: false,
    noUnusedLocals: false,
    lib: ['lib.es2022.d.ts'],
    types: [],
  };

  const baseHost = ts.createCompilerHost(options, true);
  const host: TsCompilerHost = {
    ...baseHost,
    fileExists(fileName) {
      return files.has(fileName) || baseHost.fileExists(fileName);
    },
    readFile(fileName) {
      return files.get(fileName) ?? baseHost.readFile(fileName);
    },
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
      const text = files.get(fileName);
      if (text !== undefined) {
        return ts.createSourceFile(fileName, text, languageVersion, true);
      }
      return baseHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    },
    writeFile() {},
    getCurrentDirectory() {
      return '/__kern_shadow__';
    },
  };

  const program = ts.createProgram({
    rootNames: [...files.keys()],
    options,
    host,
  });

  for (const diagnostic of program.getSemanticDiagnostics()) {
    const unit = diagnostic.file ? unitsByFile.get(diagnostic.file.fileName) : undefined;
    if (!unit || diagnostic.start === undefined) continue;

    const mapped = mapDiagnostic(ts, diagnostic, unit);
    if (mapped) diagnostics.push(mapped);
  }

  return diagnostics;
}

async function loadTypeScript(): Promise<TsApi | null> {
  try {
    const mod = (await import('typescript')) as unknown as { default?: TsApi } & TsApi;
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

function buildHandlerUnit(
  handlerNode: IRNode,
  parentNode: IRNode,
  ancestors: IRNode[],
  index: number,
): BuildResult {
  const rawCode = typeof handlerNode.props?.code === 'string' ? handlerNode.props.code : '';
  if (!rawCode.trim()) return { diagnostics: [] };

  switch (parentNode.type) {
    case 'fn': {
      const fnKeyword = shadowFnKeyword(parentNode);
      return {
        diagnostics: [],
        unit: createUnit({
          index,
          handlerNode,
          parentType: 'fn',
          lines: [
            buildModuleMarker(),
            buildReferenceLine(),
            `${fnKeyword} __shadow(${safeParams(parentNode.props?.params)})${returnClause(parentNode.props?.returns)} {`,
            rawCode,
            '}',
          ],
          bodyStartLine: 4,
          rawCode,
        }),
      };
    }

    case 'method': {
      const ownerNode = ancestors[ancestors.length - 2];
      if (!ownerNode || (ownerNode.type !== 'service' && ownerNode.type !== 'repository')) {
        return unsupportedContext(
          handlerNode,
          parentNode,
          'method owner is not a service or repository',
        );
      }
      const scopeLines = buildMethodScopeLines(ownerNode, index);
      const selfTypeName = `__ShadowSelf_${index}`;
      const staticSelfTypeName = `__ShadowStaticSelf_${index}`;
      const isStatic = parentNode.props?.static === 'true' || parentNode.props?.static === true;
      const fnKeyword = shadowFnKeyword(parentNode);
      return {
        diagnostics: [],
        unit: createUnit({
          index,
          handlerNode,
          parentType: 'method',
          lines: [
            buildModuleMarker(),
            buildReferenceLine(),
            ...scopeLines,
            `${fnKeyword} __shadow(${methodParams(parentNode, isStatic, selfTypeName, staticSelfTypeName)})${returnClause(parentNode.props?.returns)} {`,
            rawCode,
            '}',
          ],
          bodyStartLine: 4 + scopeLines.length,
          rawCode,
        }),
      };
    }

    case 'on': {
      const container = ancestors[ancestors.length - 2];
      if (container?.type === 'websocket') {
        return {
          diagnostics: [],
          unit: buildWebSocketOnUnit(handlerNode, parentNode, index, rawCode),
        };
      }
      void container;
      return unsupportedContext(
        handlerNode,
        parentNode,
        `'on' handlers are only modeled inside 'websocket' containers in this release`,
      );
    }

    default:
      return unsupportedContext(
        handlerNode,
        parentNode,
        `shadow analysis does not model '${parentNode.type}' handler scope yet`,
      );
  }
}

function buildWebSocketOnUnit(
  handlerNode: IRNode,
  onNode: IRNode,
  index: number,
  rawCode: string,
): HandlerUnit {
  // Mirrors events.ts:144-194. All websocket handlers share the outer
  // `wss.on('connection', (ws, req) => { const path = req.url || ...; ... })` scope,
  // so `ws`, `req`, `path` are in lexical scope for every inner handler.
  const eventName =
    typeof onNode.props?.event === 'string'
      ? onNode.props.event
      : typeof onNode.props?.name === 'string'
        ? onNode.props.name
        : '';

  const sharedLocals = [
    '  const ws: __ShadowWebSocket = undefined as any;',
    '  const req: __ShadowRequest = undefined as any;',
    '  const path: string = "";',
  ];

  const eventLocals: string[] = [];
  if (eventName === 'message') {
    // events.ts:158-161: `ws.on('message', (raw) => { const data = JSON.parse(raw.toString()); ... })`
    // `raw` is the ws RawData argument; `data` is any (JSON.parse return).
    eventLocals.push(
      '  const raw: Buffer = new Uint8Array() as Buffer;',
      '  const data: any = undefined;',
    );
  } else if (eventName === 'error') {
    // events.ts:172: `ws.on('error', (error) => { ... })` — `error` param, typed unknown/Error in ws.
    eventLocals.push('  const error: Error = new Error();');
  }
  // connect/disconnect/close: no extra locals — callbacks take no useful params.

  // ws `on` callbacks are sync arrow functions in the generator — see events.ts:145,158,172,183.
  // A user `await` inside a ws handler IS a real bug and shadow should surface it.
  return createUnit({
    index,
    handlerNode,
    parentType: `on:${eventName || 'unknown'}`,
    lines: [
      buildModuleMarker(),
      buildReferenceLine(),
      `// websocket on='${eventName || 'unknown'}'`,
      'function __shadow(): void {',
      ...sharedLocals,
      ...eventLocals,
      rawCode,
      '}',
    ],
    bodyStartLine: 5 + sharedLocals.length + eventLocals.length,
    rawCode,
  });
}

function unsupportedContext(handlerNode: IRNode, parentNode: IRNode, detail: string): BuildResult {
  return {
    diagnostics: [
      {
        rule: 'shadow-unsupported-context',
        nodeType: parentNode.type,
        message: `Skipped shadow analysis for '${parentNode.type}' handler: ${detail}.`,
        line: handlerNode.loc?.line,
        col: handlerNode.loc?.col,
      },
    ],
  };
}

function createUnit({
  index,
  handlerNode,
  parentType,
  lines,
  bodyStartLine,
  rawCode,
}: {
  index: number;
  handlerNode: IRNode;
  parentType: string;
  lines: string[];
  bodyStartLine: number;
  rawCode: string;
}): HandlerUnit {
  const safeSuffix = parentType.replace(/[^a-zA-Z0-9_]/g, '_');
  const fileName = `/__kern_shadow__/handler-${index}-${safeSuffix}.ts`;
  const virtualSource = lines.join('\n');
  const sourceLoc = inferSourceStart(handlerNode, rawCode);

  return {
    fileName,
    node: handlerNode,
    parentType,
    rawCode,
    virtualSource,
    bodyStartLine,
    bodyLineCount: rawCode.split('\n').length,
    sourceStartLine: sourceLoc.line,
    sourceStartCol: sourceLoc.col,
  };
}

function buildSupportFile(declaredTypeNames: Set<string>, moduleDeclarations: string[]): string {
  const extraTypes = [...declaredTypeNames]
    .filter((name) => !BUILTIN_TYPE_NAMES.has(name))
    .sort()
    .map((name) => `type ${name} = any;`);

  // `lib: ['lib.es2022.d.ts']` strips Node's ambient runtime globals, so we stub the
  // handful that real handlers routinely reach for. Typed as `any` to avoid downstream
  // false positives on shape — this is a lint assist, not a strict type-check.
  return [
    'declare const console: {',
    '  log(...args: unknown[]): void;',
    '  info(...args: unknown[]): void;',
    '  warn(...args: unknown[]): void;',
    '  error(...args: unknown[]): void;',
    '  debug(...args: unknown[]): void;',
    '};',
    'declare const process: any;',
    'declare function setTimeout(cb: (...args: any[]) => void, ms?: number, ...args: any[]): any;',
    'declare function clearTimeout(handle: any): void;',
    'declare function setInterval(cb: (...args: any[]) => void, ms?: number, ...args: any[]): any;',
    'declare function clearInterval(handle: any): void;',
    'declare function setImmediate(cb: (...args: any[]) => void, ...args: any[]): any;',
    'declare function clearImmediate(handle: any): void;',
    'declare function queueMicrotask(cb: () => void): void;',
    'declare function fetch(input: any, init?: any): Promise<any>;',
    'declare function structuredClone<T>(value: T): T;',
    'declare const globalThis: any;',
    '',
    'type Buffer = Uint8Array;',
    'type __ShadowRequest = {',
    '  url?: string;',
    '  headers: Record<string, string | undefined>;',
    '  method?: string;',
    '};',
    'type __ShadowWebSocket = {',
    '  send(data: unknown): void;',
    '  close(code?: number): void;',
    '  readyState?: number;',
    '  on(event: string, listener: (...args: any[]) => void): void;',
    '};',
    ...extraTypes,
    '',
    '// ── Module-scope declarations from the KERN file ──',
    ...moduleDeclarations,
  ].join('\n');
}

function buildMethodScopeLines(ownerNode: IRNode, index: number): string[] {
  const fieldLines = (ownerNode.children || [])
    .filter((child) => child.type === 'field')
    .map((field) => {
      const name = typeof field.props?.name === 'string' ? field.props.name : 'field';
      const type = typeof field.props?.type === 'string' ? field.props.type : 'any';
      return `  ${name}: ${type};`;
    });

  // Repositories synthesize a `readonly modelType = '<model>';` in generateRepository()
  // (see packages/core/src/codegen/data-layer.ts). Expose it so `this.modelType` type-checks.
  if (ownerNode.type === 'repository') {
    const model = typeof ownerNode.props?.model === 'string' ? ownerNode.props.model : '';
    fieldLines.push(`  readonly modelType: ${model ? JSON.stringify(model) : 'string'};`);
  }

  const instanceMethods: string[] = [];
  const staticMethods: string[] = [];
  for (const child of ownerNode.children || []) {
    if (child.type !== 'method') continue;
    const name = typeof child.props?.name === 'string' ? child.props.name : 'method';
    const isStatic = child.props?.static === 'true' || child.props?.static === true;
    const params = safeParams(child.props?.params);
    const returns = returnType(child.props?.returns);
    const line = `  ${name}(${params}): ${returns};`;
    if (isStatic) staticMethods.push(line);
    else instanceMethods.push(line);
  }

  return [
    `type __ShadowSelf_${index} = {`,
    ...fieldLines,
    ...instanceMethods,
    '};',
    `type __ShadowStaticSelf_${index} = {`,
    ...staticMethods,
    '};',
  ];
}

function returnClause(value: unknown): string {
  return `: ${returnType(value)}`;
}

function returnType(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : 'unknown';
}

function safeParams(value: unknown): string {
  return typeof value === 'string' && value.trim() ? parseParamList(value) : '';
}

function methodParams(
  node: IRNode,
  isStatic: boolean,
  selfTypeName: string,
  staticSelfTypeName: string,
): string {
  const parts = [`this: ${isStatic ? staticSelfTypeName : selfTypeName}`];
  const params = safeParams(node.props?.params);
  if (params) parts.push(params);
  return parts.join(', ');
}

function buildReferenceLine(): string {
  return '/// <reference path="./support.d.ts" />';
}

function buildModuleMarker(): string {
  // Force each virtual file to be a module, not a script. Otherwise TS puts every
  // __shadow/__ShadowSelf_* declaration into one global namespace and handlers
  // silently cross-contaminate each other.
  return 'export {};';
}

function shadowFnKeyword(node: IRNode): string {
  // Mirror codegen/functions.ts:32-79 strictly. A plain fn that uses `await` SHOULD
  // get TS1308 under shadow — it would be a real bug at compile time too.
  const async = node.props?.async === 'true' || node.props?.async === true;
  const generator = node.props?.generator === 'true' || node.props?.generator === true;
  const stream = node.props?.stream === 'true' || node.props?.stream === true;
  if (stream) return 'async function*';
  if (async && generator) return 'async function*';
  if (generator) return 'function*';
  if (async) return 'async function';
  return 'function';
}

function mapDiagnostic(ts: TsApi, diagnostic: TsDiagnostic, unit: HandlerUnit): ShadowDiagnostic | undefined {
  const file = diagnostic.file;
  if (!file || diagnostic.start === undefined) return undefined;

  const position = ts.getLineAndCharacterOfPosition(file, diagnostic.start);
  const diagnosticLine = position.line + 1;

  // Diagnostics inside the body — map 1:1.
  if (diagnosticLine >= unit.bodyStartLine && diagnosticLine < unit.bodyStartLine + unit.bodyLineCount) {
    const sourceLine = unit.sourceStartLine + (diagnosticLine - unit.bodyStartLine);
    const sourceCol =
      diagnosticLine === unit.bodyStartLine
        ? unit.sourceStartCol + position.character
        : position.character + 1;
    return {
      rule: 'shadow-ts',
      nodeType: unit.parentType,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      line: sourceLine,
      col: sourceCol,
      tsCode: diagnostic.code,
    };
  }

  // Diagnostics in the wrapper region (signature, scope types, module marker) —
  // e.g. TS2355 "function whose declared type is neither 'void' nor 'any' must
  // return a value" lands on the signature line. Attribute it to the handler's
  // first source line so real errors aren't silently dropped.
  if (diagnosticLine < unit.bodyStartLine + unit.bodyLineCount) {
    return {
      rule: 'shadow-ts',
      nodeType: unit.parentType,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      line: unit.sourceStartLine,
      col: unit.sourceStartCol,
      tsCode: diagnostic.code,
    };
  }

  // Outside the unit's extent entirely — belongs to a different unit or the support file.
  return undefined;
}

function inferSourceStart(handlerNode: IRNode, rawCode: string): { line: number; col: number } {
  const handlerLine = handlerNode.loc?.line ?? 1;
  const handlerCol = handlerNode.loc?.col ?? 1;

  if (!rawCode.includes('\n')) {
    // Inline: `handler <<< return x >>>` — col offset accounts for any leading whitespace.
    const leading = rawCode.length - rawCode.trimStart().length;
    return {
      line: handlerLine,
      col: handlerCol + HANDLER_OPEN.length + leading,
    };
  }

  return {
    line: handlerLine + 1,
    col: 1,
  };
}

/**
 * Collect `declare`-style entries for every top-level KERN symbol that would be
 * visible from sibling handlers in the emitted TypeScript. Goes in the support
 * file as ambient declarations so each virtual handler file sees them without
 * importing. Keeps signatures loose (`any` args, `unknown` returns) — this is
 * a lint assist, not a strict type-check.
 */
function collectModuleDeclarations(root: IRNode): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();

  // The parser promotes the first top-level declaration to the root and nests
  // the rest as its children. Walking the whole tree and filtering by type is
  // simpler than reasoning about which level is "top" in any given file. Any
  // declaration we encounter is module-scope from the handler's perspective
  // because handlers can't be parents of these node kinds.
  walk(root, [], (node) => {
    const name = typeof node.props?.name === 'string' ? node.props.name : '';
    if (!name || !/^[A-Za-z_]\w*$/.test(name)) return;
    const key = `${node.type}:${name}`;
    if (seen.has(key)) return;

    switch (node.type) {
      case 'fn': {
        const params = safeParams(node.props?.params);
        const returns = returnType(node.props?.returns);
        const async = node.props?.async === 'true' || node.props?.async === true;
        const retType = async && !/^Promise</.test(returns) ? `Promise<${returns}>` : returns;
        lines.push(`declare function ${name}(${params}): ${retType};`);
        seen.add(key);
        break;
      }
      case 'const': {
        const type = typeof node.props?.type === 'string' ? node.props.type : 'any';
        lines.push(`declare const ${name}: ${type};`);
        seen.add(key);
        break;
      }
      case 'error':
        // Use a namespace+var merge so `new NotFound()` works without pulling in
        // a full class body (declare class would also work but can trip on
        // `extends Error` in the minimal lib we load).
        lines.push(`declare const ${name}: { new (...args: any[]): Error & { [key: string]: any } };`);
        seen.add(key);
        break;
      case 'service':
      case 'repository':
      case 'model':
        lines.push(`declare const ${name}: { new (...args: any[]): { [key: string]: any } } & { [key: string]: any };`);
        seen.add(key);
        break;
      case 'type':
      case 'interface':
      case 'union':
      case 'event':
        // Covered by the declaredTypeNames `type X = any;` emission in buildSupportFile.
        break;
      default:
        // Ignore UI/framework nodes — their identifiers aren't referenced from handler bodies.
        break;
    }
  });

  return lines;
}

function collectDeclaredTypeNames(root: IRNode): Set<string> {
  const names = new Set<string>();

  walk(root, [], (node) => {
    if (!DECLARING_NODE_TYPES.has(node.type)) return;
    const name = typeof node.props?.name === 'string' ? node.props.name : '';
    if (name && /^[A-Za-z_]\w*$/.test(name)) {
      names.add(name);
    }
  });

  return names;
}

function walk(node: IRNode, ancestors: IRNode[], visit: (node: IRNode, ancestors: IRNode[]) => void): void {
  visit(node, ancestors);
  for (const child of node.children || []) {
    walk(child, [...ancestors, node], visit);
  }
}
