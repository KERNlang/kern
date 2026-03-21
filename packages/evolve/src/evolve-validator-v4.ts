/**
 * Evolve v4 Validation Pipeline — 9-step validation for node proposals.
 *
 * Steps: schema → keyword → parse → codegen compile → codegen run →
 *        typescript check → golden diff → dedup → (LLM retry on failure)
 */

import { parse } from '@kernlang/core';
import { KERN_RESERVED, NODE_TYPES, registerParserHints, unregisterParserHints } from '@kernlang/core';
import { ts } from 'ts-morph';
import { compileSandboxedGenerator } from './sandboxed-generator.js';
import { checkDedup } from './evolve-dedup.js';
import { compareGoldenOutput } from './golden-test-runner.js';
import type { EvolveNodeProposal, EvolveV4ValidationResult } from './evolved-types.js';

/**
 * Run the full 9-step validation pipeline on a node proposal.
 */
export function validateEvolveProposal(
  proposal: EvolveNodeProposal,
  existingKeywords?: string[],
): EvolveV4ValidationResult {
  const result: EvolveV4ValidationResult = {
    schemaOk: false,
    keywordOk: false,
    parseOk: false,
    codegenCompileOk: false,
    codegenRunOk: false,
    typescriptOk: false,
    goldenDiffOk: false,
    dedupOk: false,
    errors: [],
    retryCount: 0,
  };

  // Step 1: Schema check
  result.schemaOk = validateSchema(proposal, result.errors);
  if (!result.schemaOk) return result;

  // Step 2: Keyword check
  result.keywordOk = validateKeyword(proposal.keyword, result.errors, existingKeywords);
  if (!result.keywordOk) return result;

  // Step 3: Parse check
  result.parseOk = validateParse(proposal, result.errors);

  // Step 4: Codegen compile
  let generator: ((node: any) => string[]) | null = null;
  try {
    generator = compileSandboxedGenerator(wrapAsCommonJS(proposal.codegenSource));
    result.codegenCompileOk = true;
  } catch (err) {
    result.errors.push(`Codegen compile failed: ${(err as Error).message}`);
    result.codegenCompileOk = false;
  }

  // Step 5: Codegen dry-run
  if (generator && result.parseOk) {
    result.codegenRunOk = validateCodegenRun(proposal, generator, result.errors);
  }

  // Step 6: TypeScript syntax check
  if (result.codegenRunOk && generator) {
    result.typescriptOk = validateTypeScript(proposal, generator, result.errors);
  }

  // Step 7: Golden diff
  if (result.codegenRunOk && generator) {
    result.goldenDiffOk = validateGoldenDiff(proposal, generator, result.errors);
  }

  // Step 8: Dedup check
  result.dedupOk = checkDedup(proposal, existingKeywords || []);
  if (!result.dedupOk) {
    result.errors.push(`Duplicate: keyword '${proposal.keyword}' is too similar to an existing node`);
  }

  return result;
}

// ── Step implementations ─────────────────────────────────────────────────

function validateSchema(proposal: EvolveNodeProposal, errors: string[]): boolean {
  if (!proposal.keyword || typeof proposal.keyword !== 'string') {
    errors.push('Missing or invalid keyword');
    return false;
  }
  if (!/^[a-z][a-z0-9-]*$/.test(proposal.keyword)) {
    errors.push(`Keyword '${proposal.keyword}' must be lowercase alphanumeric with hyphens`);
    return false;
  }
  if (!proposal.kernExample || typeof proposal.kernExample !== 'string') {
    errors.push('Missing kernExample');
    return false;
  }
  if (!proposal.codegenSource || typeof proposal.codegenSource !== 'string') {
    errors.push('Missing codegenSource');
    return false;
  }
  if (!proposal.expectedOutput || typeof proposal.expectedOutput !== 'string') {
    errors.push('Missing expectedOutput');
    return false;
  }
  if (!proposal.reason || typeof proposal.reason.observation !== 'string') {
    errors.push('Missing or invalid reason');
    return false;
  }
  if (!Array.isArray(proposal.props)) {
    errors.push('Missing props array');
    return false;
  }
  return true;
}

function validateKeyword(keyword: string, errors: string[], existing?: string[]): boolean {
  if (KERN_RESERVED.has(keyword as any)) {
    errors.push(`Keyword '${keyword}' is a reserved KERN core type`);
    return false;
  }
  if (existing?.includes(keyword)) {
    errors.push(`Keyword '${keyword}' is already graduated`);
    return false;
  }
  return true;
}

function validateParse(proposal: EvolveNodeProposal, errors: string[]): boolean {
  // Temporarily register parser hints if provided
  if (proposal.parserHints) {
    registerParserHints(proposal.keyword, proposal.parserHints);
  }

  try {
    const ast = parse(proposal.kernExample);
    if (!ast || !ast.type) {
      errors.push('kernExample parsed to empty AST');
      return false;
    }
    // Root node should match the proposed keyword
    if (ast.type !== proposal.keyword) {
      errors.push(`kernExample root type '${ast.type}' does not match keyword '${proposal.keyword}'`);
      return false;
    }
    return true;
  } catch (err) {
    errors.push(`Parse failed: ${(err as Error).message}`);
    return false;
  } finally {
    if (proposal.parserHints) {
      unregisterParserHints(proposal.keyword);
    }
  }
}

function validateCodegenRun(
  proposal: EvolveNodeProposal,
  generator: (node: any) => string[],
  errors: string[],
): boolean {
  if (proposal.parserHints) {
    registerParserHints(proposal.keyword, proposal.parserHints);
  }
  try {
    const ast = parse(proposal.kernExample);
    const output = generator(ast);
    if (!Array.isArray(output) || output.length === 0) {
      errors.push('Codegen produced empty output');
      return false;
    }
    return true;
  } catch (err) {
    errors.push(`Codegen run failed: ${(err as Error).message}`);
    return false;
  } finally {
    if (proposal.parserHints) {
      unregisterParserHints(proposal.keyword);
    }
  }
}

function validateTypeScript(
  proposal: EvolveNodeProposal,
  generator: (node: any) => string[],
  errors: string[],
): boolean {
  if (proposal.parserHints) {
    registerParserHints(proposal.keyword, proposal.parserHints);
  }
  try {
    const ast = parse(proposal.kernExample);
    const output = generator(ast).join('\n');

    // Real TypeScript syntax validation via ts.transpileModule
    // Enable JSX since KERN generates React/JSX output for frontend targets
    const result = ts.transpileModule(output, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        strict: false,
        noEmit: false,
        skipLibCheck: true,
      },
      reportDiagnostics: true,
      fileName: 'evolved-output.tsx',
    });

    const diagnostics = result.diagnostics || [];
    // Only fail on syntax errors (category 1 = Error), not semantic warnings
    const syntaxErrors = diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);
    if (syntaxErrors.length > 0) {
      for (const d of syntaxErrors.slice(0, 3)) {
        const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
        errors.push(`TypeScript syntax error: ${msg}`);
      }
      return false;
    }

    return true;
  } catch (err) {
    errors.push(`TypeScript check failed: ${(err as Error).message}`);
    return false;
  } finally {
    if (proposal.parserHints) {
      unregisterParserHints(proposal.keyword);
    }
  }
}

function validateGoldenDiff(
  proposal: EvolveNodeProposal,
  generator: (node: any) => string[],
  errors: string[],
): boolean {
  if (proposal.parserHints) {
    registerParserHints(proposal.keyword, proposal.parserHints);
  }
  try {
    const ast = parse(proposal.kernExample);
    const actual = generator(ast).join('\n');
    const match = compareGoldenOutput(actual, proposal.expectedOutput);
    if (!match) {
      errors.push('Golden diff mismatch: codegen output differs from expectedOutput');
      return false;
    }
    return true;
  } catch (err) {
    errors.push(`Golden diff failed: ${(err as Error).message}`);
    return false;
  } finally {
    if (proposal.parserHints) {
      unregisterParserHints(proposal.keyword);
    }
  }
}

/**
 * Wrap raw generator source as CommonJS for the sandbox.
 * Handles both "export default function..." and plain "function generate..." patterns.
 */
function wrapAsCommonJS(source: string): string {
  // Already CommonJS
  if (source.includes('module.exports')) return source;

  // ES module: export default function(node, helpers) { ... }
  let wrapped = source
    .replace(/^export\s+default\s+/m, 'module.exports = ')
    .replace(/^export\s+function\s+(\w+)/m, 'module.exports = function $1');

  // If still no module.exports, wrap the whole thing
  if (!wrapped.includes('module.exports')) {
    wrapped = `module.exports = ${wrapped}`;
  }

  // Strip TypeScript type annotations for the sandbox (runs as JS)
  wrapped = wrapped
    .replace(/:\s*IRNode/g, '')
    .replace(/:\s*string\[\]/g, '')
    .replace(/:\s*CodegenHelpers/g, '')
    .replace(/import\s+.*?from\s+['"].*?['"];?\n?/g, '');

  return wrapped;
}
