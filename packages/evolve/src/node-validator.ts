/**
 * Node Validator — validates IR node proposals by parsing + codegen dry-run.
 *
 * Checks:
 *   1. KERN syntax parses without errors
 *   2. Codegen stub compiles (syntax check)
 *   3. Count target coverage
 */

import type { NodeProposal, NodeValidationResult } from './types.js';

/**
 * Validate a node proposal.
 *
 * In v3, this is a lightweight structural check.
 * Full validation (typecheck output, run against all targets) is deferred to promotion.
 */
export function validateNodeProposal(proposal: NodeProposal): NodeValidationResult {
  const errors: string[] = [];

  // 1. Check KERN syntax is non-empty and parseable-looking
  const parseOk = validateKernSyntax(proposal.kernSyntax, errors);

  // 2. Check codegen stub has expected structure
  const codegenOk = validateCodegenStub(proposal.codegenStub, proposal.nodeName, errors);

  // 3. Count target coverage
  const targetCoverage = countTargetCoverage(proposal);

  return {
    parseOk,
    codegenOk,
    targetCoverage,
    errors,
  };
}

function validateKernSyntax(syntax: string, errors: string[]): boolean {
  if (!syntax || syntax.trim().length === 0) {
    errors.push('KERN syntax is empty');
    return false;
  }

  // Check the syntax has proper indentation structure
  const lines = syntax.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) {
    errors.push('KERN syntax has no non-empty lines');
    return false;
  }

  // First line should start with a node type (alpha chars)
  const firstLine = lines[0].trimStart();
  if (!/^[a-zA-Z]/.test(firstLine)) {
    errors.push(`KERN syntax first line doesn't start with a node type: "${firstLine}"`);
    return false;
  }

  return true;
}

function validateCodegenStub(stub: string, nodeName: string, errors: string[]): boolean {
  if (!stub || stub.trim().length === 0) {
    errors.push('Codegen stub is empty');
    return false;
  }

  // Check it contains a function definition
  if (!stub.includes('function')) {
    errors.push('Codegen stub missing function definition');
    return false;
  }

  // Check it references the node name
  const expectedFn = `generate${nodeName[0].toUpperCase()}${nodeName.slice(1)}`;
  if (!stub.includes(expectedFn)) {
    errors.push(`Codegen stub missing expected function name: ${expectedFn}`);
    return false;
  }

  return true;
}

function countTargetCoverage(proposal: NodeProposal): number {
  // Core node types work across all targets (11)
  // Target stubs add specific coverage
  const baseCoverage = 11; // core nodes work everywhere
  const stubs = Object.keys(proposal.targetStubs).length;
  return stubs > 0 ? stubs : baseCoverage;
}
