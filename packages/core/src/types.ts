/**
 * Kern IR Type System
 *
 * This is the contract. Each forge engine must implement:
 * 1. A parser that reads IR → IRNode tree
 * 2. A transpiler that converts IRNode tree → React Native TypeScript
 * 3. A decompiler that converts IRNode tree → human-readable TypeScript
 * 4. Source map generation for debugging
 */

/** Expression object produced by the parser for inline expressions */
export interface ExprObject {
  __expr: true;
  code: string;
}

/** Type guard for ExprObject — matches the ExprObject contract exactly. */
export function isExprObject(value: unknown): value is ExprObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __expr?: unknown }).__expr === true &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}

/** Base node in the IR tree */
export interface IRNode {
  /** Node type identifier — known types have autocomplete, custom/evolved types accepted as string */
  type: import('./spec.js').IRNodeType | (string & {});
  /** Source location for source maps */
  loc?: IRSourceLocation;
  /** Child nodes */
  children?: IRNode[];
  /** Node-specific properties */
  props?: Record<string, unknown>;
  /** Names of props whose values originated from a quoted token (e.g. value="hello world").
   *  Used by the post-parse validator to skip expression validation on string literals.
   *  Stored as string[] (not Set) so it survives JSON serialization in decompile/sourcemap flows. */
  __quotedProps?: string[];
}

/** Source location tracking */
export interface IRSourceLocation {
  line: number;
  col: number;
  endLine?: number;
  endCol?: number;
}

/** Source map entry */
export interface SourceMapEntry {
  /** Position in IR source */
  irLine: number;
  irCol: number;
  /** Position in generated output */
  outLine: number;
  outCol: number;
}

/** Generated output artifact (for multi-file targets like Next.js, Express) */
export interface GeneratedArtifact {
  /** Relative output path */
  path: string;
  /** Generated code */
  content: string;
  /** Artifact type */
  type:
    | 'page'
    | 'layout'
    | 'route'
    | 'middleware'
    | 'component'
    | 'config'
    | 'entry'
    | 'command'
    | 'hook'
    | 'types'
    | 'barrel'
    | 'theme'
    | 'template'
    | 'websocket'
    | 'model'
    | 'service'
    | 'error'
    | 'lib'
    | 'prisma'
    | 'repository';
}

/** Diagnostic outcome for an IR node during transpilation */
export type DiagnosticOutcome = 'expressed' | 'consumed' | 'suppressed' | 'unsupported';

/** Diagnostic entry for a single IR node */
export interface TranspileDiagnostic {
  /** The IR node type that was processed */
  nodeType: string;
  /** How the node was handled */
  outcome: DiagnosticOutcome;
  /** Which transpiler target produced this diagnostic */
  target: string;
  /** Source location of the node in .kern file */
  loc?: { line: number; col: number };
  /** Why this outcome was chosen */
  reason?: string;
  /** Number of children also lost (for root-cause-only reporting) */
  childrenLost?: number;
  /** Severity level for custom transpiler diagnostics */
  severity?: 'error' | 'warning' | 'info';
  /** Human-readable description */
  message?: string;
}

/** Result of transpilation */
export interface TranspileResult {
  /** Generated React Native TypeScript code */
  code: string;
  /** Source map entries */
  sourceMap: SourceMapEntry[];
  /** Token count of the IR input */
  irTokenCount: number;
  /** Token count of the generated TypeScript output */
  tsTokenCount: number;
  /** Token reduction percentage */
  tokenReduction: number;
  /** Multi-file output artifacts */
  artifacts?: GeneratedArtifact[];
  /** Node-level diagnostics (never silently drop) */
  diagnostics?: TranspileDiagnostic[];
}

// ── Parse Diagnostics ────────────────────────────────────────────────────

export type ParseErrorCode =
  | 'UNCLOSED_EXPR'
  | 'UNCLOSED_STYLE'
  | 'UNCLOSED_STRING'
  | 'UNEXPECTED_TOKEN'
  | 'EMPTY_DOCUMENT'
  | 'INVALID_INDENT'
  | 'UNKNOWN_NODE_TYPE'
  | 'INDENT_JUMP'
  | 'DUPLICATE_PROP'
  | 'DROPPED_LINE'
  | 'INVALID_BIGINT'
  | 'INVALID_EXPRESSION'
  | 'INVALID_EFFECTS'
  | 'INVALID_UNION_KIND'
  | 'KIND_SHAPE_VIOLATION'
  | 'INVALID_PROPAGATION'
  | 'NESTED_PROPAGATION'
  | 'UNSAFE_UNWRAP_IN_RESULT_FN';

export type ParseDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface ParseDiagnostic {
  code: ParseErrorCode;
  severity: ParseDiagnosticSeverity;
  message: string;
  line: number;
  col: number;
  endCol: number;
  suggestion: string;
}

export interface ParseResult {
  root: IRNode;
  diagnostics: ParseDiagnostic[];
  /** True when the tree contains __error nodes — output is compilable but incomplete */
  partial?: boolean;
  /** Number of __error nodes in the tree */
  errorCount?: number;
}

/** Result of decompilation (IR → human-readable) */
export interface DecompileResult {
  /** Human-readable TypeScript representation */
  code: string;
}

/** The main engine interface each implementation must satisfy */
// ── Template System Types ──────────────────────────────────────────────

export type TemplateSlotType = 'identifier' | 'type' | 'expr' | 'block';

export interface TemplateSlot {
  name: string;
  slotType: TemplateSlotType;
  optional: boolean;
  defaultValue?: string;
}

export interface TemplateImport {
  from: string;
  names: string;
}

export interface TemplateDefinition {
  name: string;
  slots: TemplateSlot[];
  imports: TemplateImport[];
  body: string;
  sourceFile?: string;
}

export interface KernEngine {
  /** Parse IR source text into an IR node tree */
  parse(source: string): IRNode;

  /** Transpile IR node tree to React Native TypeScript */
  transpile(root: IRNode): TranspileResult;

  /** Decompile IR node tree to human-readable TypeScript */
  decompile(root: IRNode): DecompileResult;

  /** Get the IR representation of a component (for token comparison) */
  serialize(root: IRNode): string;
}
