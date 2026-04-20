import type { NextjsVersionProfile, SourceMapEntry, TailwindVersionProfile } from '@kernlang/core';

// ── Next.js specific types ──────────────────────────────────────────────

export interface NextFile {
  path: string;
  content: string;
}

// ── Code generation context ─────────────────────────────────────────────

export interface JSImportSpec {
  defaultImport?: string;
  namedImports: Set<string>;
  typeOnlyImports: Set<string>;
}

export interface FetchCall {
  name: string;
  url: string;
  options?: string;
  /**
   * Body of a `handler <<<>>>` child on the `fetch` node. When present the
   * codegen emits this body as the data-loader for `name` instead of the
   * default `await fetch(url).then(r => r.json())` so pages can call their
   * own DB/service layer directly.
   */
  handlerCode?: string;
}

export interface GenerateMetadataInfo {
  handlerCode: string;
}

export interface StateDecl {
  name: string;
  initial: string;
}

export interface Ctx {
  lines: string[];
  sourceMap: SourceMapEntry[];
  imports: Map<string, JSImportSpec>;
  componentImports: Set<string>;
  isClient: boolean;
  isAsync: boolean;
  metadata: Record<string, string> | null;
  generateMetadataInfo: GenerateMetadataInfo | null;
  fetchCalls: FetchCall[];
  bodyLines: string[];
  stateDecls: StateDecl[];
  logicBlocks: string[];
  colors: Record<string, string> | undefined;
  twProfile: TailwindVersionProfile | undefined;
  njProfile: NextjsVersionProfile | undefined;
}
