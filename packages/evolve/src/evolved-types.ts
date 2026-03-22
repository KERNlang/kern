/**
 * Evolve v4 Types — Self-Extending IR
 *
 * These types define the schema for evolved nodes: proposals from LLM discovery,
 * graduated node definitions on disk, parser hints, and validation results.
 */

// ── Parser Hints ─────────────────────────────────────────────────────────
// Tells the parser how to handle an evolved node's special syntax.
// Without hints, the parser uses generic key=value parsing.

export interface ParserHints {
  /** Positional args consumed before key=value props.
   *  e.g. ["method", "path"] → "api-route GET /users" → props.method="GET", props.path="/users" */
  positionalArgs?: string[];

  /** A bare word consumed as a named prop.
   *  e.g. "name" → "auth-guard admin" → props.name="admin" */
  bareWord?: string;

  /** Registers this node type for <<<...>>> multiline block parsing.
   *  The value is the prop name that receives the block content.
   *  e.g. "code" → "my-node <<<...>>>" → props.code="..." */
  multilineBlock?: string;
}

// ── Evolved Node Definition (on disk) ────────────────────────────────────
// Stored in .kern/evolved/<keyword>/definition.json

export interface EvolvedNodeDefinition {
  keyword: string;
  displayName: string;
  description: string;

  props: EvolvedNodeProp[];
  childTypes: string[];

  parserHints?: ParserHints;

  reason: EvolvedNodeReason;

  // Metadata
  hash: string;               // SHA256 of codegen.js
  graduatedBy: string;
  graduatedAt: string;
  evolveRunId: string;
  kernVersion: string;         // KERN version at graduation time
}

export interface EvolvedNodeProp {
  name: string;
  type: 'string' | 'boolean' | 'number' | 'expression';
  required: boolean;
  description: string;
}

export interface EvolvedNodeReason {
  observation: string;
  inefficiency: string;
  kernBenefit: string;
  frequency: number;
  avgLines: number;
  instances: string[];
}

// ── Manifest (on disk) ───────────────────────────────────────────────────
// Stored in .kern/evolved/manifest.json

export interface EvolvedManifest {
  version: number;
  nodes: Record<string, EvolvedManifestEntry>;
}

export interface EvolvedManifestEntry {
  keyword: string;
  displayName: string;
  codegenTier: 1 | 2;
  childTypes: string[];
  parserHints?: ParserHints;
  hash: string;
  graduatedBy: string;
  graduatedAt: string;
  evolveRunId: string;
  kernVersion: string;
}

// ── Proposal (from LLM discovery) ────────────────────────────────────────

export interface EvolveNodeProposal {
  id: string;
  keyword: string;
  displayName: string;
  description: string;

  props: EvolvedNodeProp[];
  childTypes: string[];

  kernExample: string;
  expectedOutput: string;
  codegenSource: string;       // Full .ts source of the generator function

  parserHints?: ParserHints;
  targetOverrides?: Record<string, string>;

  reason: EvolvedNodeReason;

  codegenTier: 1 | 2;
  proposedAt: string;
  evolveRunId: string;
}

// ── Validation Result ────────────────────────────────────────────────────

export interface EvolveV4ValidationResult {
  schemaOk: boolean;
  keywordOk: boolean;
  parseOk: boolean;
  codegenCompileOk: boolean;
  codegenRunOk: boolean;
  typescriptOk: boolean;
  goldenDiffOk: boolean;
  dedupOk: boolean;
  errors: string[];
  retryCount: number;
}

// ── Staging ──────────────────────────────────────────────────────────────

export type EvolveV4ProposalStatus = 'pending' | 'approved' | 'rejected';

export interface StagedEvolveProposal {
  id: string;
  proposal: EvolveNodeProposal;
  validation: EvolveV4ValidationResult;
  status: EvolveV4ProposalStatus;
  stagedAt: string;
  reviewedAt?: string;
}

// ── Codegen Helpers (exposed to sandboxed generators) ────────────────────

export interface CodegenHelpers {
  capitalize: (s: string) => string;
  parseParamList: (params: string) => string;
  dedent: (code: string) => string;
  kids: (node: any, type?: string) => any[];
  firstChild: (node: any, type: string) => any | undefined;
  p: (node: any) => Record<string, unknown>;
  handlerCode: (node: any) => string;
  exportPrefix: (node: any) => string;
}
