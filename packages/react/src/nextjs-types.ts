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
