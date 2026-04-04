/**
 * Template Validator — Phase 4 of the evolve pipeline.
 *
 * 5-step validation:
 * 1. Parse: Is the .kern source valid syntax?
 * 2. Register: Can the template be registered?
 * 3. Expand: Does the template expand with real slot values?
 * 4. Golden diff: Does the expansion match the original TS structure?
 * 5. Typecheck: Does the expanded TypeScript pass type checking? (tsconfig-aware)
 */

import type { IRNode } from '@kernlang/core';
import { clearTemplates, expandTemplateNode, parse, registerTemplate } from '@kernlang/core';
import { Project } from 'ts-morph';
import type { TemplateProposal, ValidationResult } from './types.js';

/**
 * Validate a template proposal through the 5-step pipeline.
 *
 * Uses REAL values extracted from source, not synthetic placeholders.
 * Each call operates on an isolated template registry (cleared before and after).
 */
export function validateProposal(proposal: TemplateProposal, tsconfigPath?: string): ValidationResult {
  const result: ValidationResult = {
    parseOk: false,
    registerOk: false,
    expansionOk: false,
    typecheckOk: false,
    goldenDiffOk: false,
    errors: [],
  };

  // Step 1: Parse the .kern source
  let ast: IRNode;
  try {
    ast = parse(proposal.kernSource);
    result.parseOk = true;
  } catch (err) {
    result.errors.push(`Parse error: ${(err as Error).message}`);
    return result;
  }

  // Isolate: clear the global template registry before registering
  clearTemplates();

  // Step 2: Register the template
  try {
    const templateNodes = ast.type === 'template' ? [ast] : (ast.children || []).filter((n) => n.type === 'template');

    if (templateNodes.length === 0) {
      result.errors.push('No template node found in parsed source');
      clearTemplates();
      return result;
    }

    for (const node of templateNodes) {
      registerTemplate(node, `evolve:${proposal.id}`);
    }
    result.registerOk = true;
  } catch (err) {
    result.errors.push(`Register error: ${(err as Error).message}`);
    clearTemplates();
    return result;
  }

  // Step 3: Expand the template with real values from golden example
  try {
    const instanceNode = buildInstanceNode(proposal);
    const expandedLines = expandTemplateNode(instanceNode);
    result.expandedTs = expandedLines.join('\n');
    result.expansionOk = true;
  } catch (err) {
    result.errors.push(`Expansion error: ${(err as Error).message}`);
    clearTemplates();
    return result;
  }

  // Clean up registry — expansion is done, remaining steps don't need it
  clearTemplates();

  // Step 4: Golden diff — compare expanded output with original TS
  try {
    const diff = computeGoldenDiff(proposal.goldenExample.originalTs, result.expandedTs!);
    result.goldenDiff = diff;
    result.goldenDiffOk = assessGoldenDiff(diff);
  } catch (err) {
    result.errors.push(`Golden diff error: ${(err as Error).message}`);
  }

  // Step 5: Typecheck the expanded TypeScript
  try {
    result.typecheckOk = typecheckExpansion(result.expandedTs!, tsconfigPath);
  } catch (err) {
    result.errors.push(`Typecheck error: ${(err as Error).message}`);
  }

  return result;
}

/**
 * Build an IRNode instance that uses the template with golden example values.
 */
function buildInstanceNode(proposal: TemplateProposal): IRNode {
  const props: Record<string, unknown> = {};

  for (const slot of proposal.slots) {
    const value = proposal.goldenExample.slotValues[slot.name];
    if (value !== undefined) {
      props[slot.name] = value;
    }
  }

  return {
    type: proposal.templateName,
    props,
  };
}

/**
 * Compute a unified diff between the original TS and the expanded TS.
 */
function computeGoldenDiff(original: string, expanded: string): string {
  const origLines = normalizeForDiff(original).split('\n');
  const expLines = normalizeForDiff(expanded).split('\n');

  const diff: string[] = [];
  const maxLen = Math.max(origLines.length, expLines.length);

  for (let i = 0; i < maxLen; i++) {
    const origLine = i < origLines.length ? origLines[i] : undefined;
    const expLine = i < expLines.length ? expLines[i] : undefined;

    if (origLine === expLine) {
      if (origLine !== undefined) diff.push(`  ${origLine}`);
    } else {
      if (origLine !== undefined) diff.push(`- ${origLine}`);
      if (expLine !== undefined) diff.push(`+ ${expLine}`);
    }
  }

  return diff.join('\n');
}

function normalizeForDiff(code: string): string {
  return code
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !l.startsWith('import '))
    .join('\n');
}

function assessGoldenDiff(diff: string): boolean {
  const lines = diff.split('\n');
  const totalLines = lines.length;
  const matchedLines = lines.filter((l) => l.startsWith('  ')).length;

  if (totalLines === 0) return true;
  return matchedLines / totalLines >= 0.4;
}

function typecheckExpansion(expandedTs: string, tsconfigPath?: string): boolean {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: tsconfigPath
      ? undefined
      : {
          target: 99, // ESNext
          module: 99, // ESNext
          moduleResolution: 100, // Bundler
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
    tsConfigFilePath: tsconfigPath,
  });

  const sourceFile = project.createSourceFile('__evolve_check__.ts', expandedTs);
  const diagnostics = sourceFile.getPreEmitDiagnostics();

  const realErrors = diagnostics.filter((d) => {
    const msg = d.getMessageText();
    const msgStr = typeof msg === 'string' ? msg : msg.getMessageText();
    if (msgStr.includes('Cannot find module')) return false;
    if (msgStr.includes('Could not find a declaration file')) return false;
    return true;
  });

  return realErrors.length === 0;
}
