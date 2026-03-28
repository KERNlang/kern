/**
 * Evolve v4 Validation Pipeline — 9-step validation for node proposals.
 *
 * Steps: schema → keyword → parse → codegen compile → codegen run →
 *        typescript check → golden diff → dedup → (LLM retry on failure)
 */

import { parse } from '@kernlang/core';
import { KERN_RESERVED, registerParserHints, unregisterParserHints } from '@kernlang/core';
import { ts } from 'ts-morph';
import { compileSandboxedGenerator } from './sandboxed-generator.js';
import { checkDedup } from './evolve-dedup.js';
import { compareGoldenOutput } from './golden-test-runner.js';
import { compileCodegenToJS } from './graduation.js';
import type { IRNode } from '@kernlang/core';
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

  // Register parser hints once for all parse-dependent steps (3, 5, 6, 7)
  if (proposal.parserHints) {
    registerParserHints(proposal.keyword, proposal.parserHints);
  }

  try {
    // Step 3: Parse check — parse once, reuse AST for steps 5-7
    let ast: IRNode | null = null;
    try {
      const parsed = parse(proposal.kernExample);
      if (!parsed || !parsed.type) {
        result.errors.push('kernExample parsed to empty AST');
        result.parseOk = false;
      } else if (parsed.type !== proposal.keyword) {
        result.errors.push(`kernExample root type '${parsed.type}' does not match keyword '${proposal.keyword}'`);
        result.parseOk = false;
      } else {
        result.parseOk = true;
        ast = parsed;
      }
    } catch (err) {
      result.errors.push(`Parse failed: ${(err as Error).message}`);
      result.parseOk = false;
    }

    // Step 4: Codegen compile (uses compileCodegenToJS from graduation for
    // consistent TS→JS stripping — same logic used at graduation time)
    let generator: ((node: any) => string[]) | null = null;
    try {
      generator = compileSandboxedGenerator(compileCodegenToJS(proposal.codegenSource));
      result.codegenCompileOk = true;
    } catch (err) {
      result.errors.push(`Codegen compile failed: ${(err as Error).message}`);
      result.codegenCompileOk = false;
    }

    // Step 5: Codegen dry-run
    if (generator && ast) {
      result.codegenRunOk = validateCodegenRun(ast, generator, result.errors);
    }

    // Step 6: TypeScript syntax check
    if (result.codegenRunOk && generator && ast) {
      result.typescriptOk = validateTypeScript(ast, generator, result.errors);
    }

    // Step 7: Golden diff
    if (result.codegenRunOk && generator && ast) {
      result.goldenDiffOk = validateGoldenDiff(ast, proposal, generator, result.errors);
    }

    // Step 8: Dedup check
    result.dedupOk = checkDedup(proposal, existingKeywords || []);
    if (!result.dedupOk) {
      result.errors.push(`Duplicate: keyword '${proposal.keyword}' is too similar to an existing node`);
    }
  } finally {
    if (proposal.parserHints) {
      unregisterParserHints(proposal.keyword);
    }
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

/**
 * Run generator on a cloned AST to preserve mutation isolation.
 * Each step gets its own copy so user-provided generators can't
 * corrupt the AST for subsequent steps.
 */
function runGenerator(ast: IRNode, generator: (node: any) => string[]): string[] {
  return generator(structuredClone(ast));
}

function validateCodegenRun(
  ast: IRNode,
  generator: (node: any) => string[],
  errors: string[],
): boolean {
  try {
    const output = runGenerator(ast, generator);
    if (!Array.isArray(output) || output.length === 0) {
      errors.push('Codegen produced empty output');
      return false;
    }
    return true;
  } catch (err) {
    errors.push(`Codegen run failed: ${(err as Error).message}`);
    return false;
  }
}

function validateTypeScript(
  ast: IRNode,
  generator: (node: any) => string[],
  errors: string[],
): boolean {
  try {
    const output = runGenerator(ast, generator).join('\n');

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
  }
}

function validateGoldenDiff(
  ast: IRNode,
  proposal: EvolveNodeProposal,
  generator: (node: any) => string[],
  errors: string[],
): boolean {
  try {
    const actual = runGenerator(ast, generator).join('\n');
    const match = compareGoldenOutput(actual, proposal.expectedOutput);
    if (!match) {
      errors.push('Golden diff mismatch: codegen output differs from expectedOutput');
      return false;
    }
    return true;
  } catch (err) {
    errors.push(`Golden diff failed: ${(err as Error).message}`);
    return false;
  }
}
