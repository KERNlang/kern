/**
 * Kern IR Type System
 *
 * This is the contract. Each forge engine must implement:
 * 1. A parser that reads IR → IRNode tree
 * 2. A transpiler that converts IRNode tree → React Native TypeScript
 * 3. A decompiler that converts IRNode tree → human-readable TypeScript
 * 4. Source map generation for debugging
 */

/** Base node in the IR tree */
export interface IRNode {
  /** Node type identifier */
  type: string;
  /** Source location for source maps */
  loc?: IRSourceLocation;
  /** Child nodes */
  children?: IRNode[];
  /** Node-specific properties */
  props?: Record<string, unknown>;
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
}

/** Result of decompilation (IR → human-readable) */
export interface DecompileResult {
  /** Human-readable TypeScript representation */
  code: string;
}

/** The main engine interface each implementation must satisfy */
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
