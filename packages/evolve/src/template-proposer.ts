/**
 * Template Proposer — Phase 3 of the evolve pipeline.
 *
 * Generates .kern template source from analyzed patterns.
 * This is the hardest part: converting TS code patterns into valid
 * .kern template syntax with typed slots.
 */

import { createHash } from 'crypto';
import type { AnalyzedPattern, TemplateProposal, ExtractedParam, ImportDecl } from './types.js';

/**
 * Generate a proposal ID from the template name and structural hash.
 */
function generateProposalId(templateName: string, structuralHash: string): string {
  return `${templateName}-${structuralHash.substring(0, 6)}`;
}

/**
 * Generate .kern template source from an analyzed pattern.
 *
 * Output format follows the KERN template syntax:
 *   template name=<name>
 *     slot name=<name> type=<type> [optional=true] [default=<value>]
 *     import from=<pkg> names=<names>
 *     body <<<
 *       <template body with {{slotName}} placeholders>
 *     >>>
 */
export function generateKernSource(pattern: AnalyzedPattern): string {
  const lines: string[] = [];

  // Template declaration
  lines.push(`template name=${pattern.templateName}`);

  // Slots
  for (const slot of pattern.slots) {
    let slotLine = `  slot name=${slot.name} type=${slot.slotType}`;
    if (slot.optional) {
      slotLine += ' optional=true';
      if (slot.value) {
        slotLine += ` default=${slot.value.includes(' ') ? `"${slot.value}"` : slot.value}`;
      }
    }
    lines.push(slotLine);
  }

  // Imports
  for (const imp of pattern.imports) {
    const names = imp.names.join(',');
    lines.push(`  import from=${imp.from} names=${names}`);
  }

  // Body — transform the representative snippet into a template body
  const body = buildTemplateBody(pattern);
  lines.push('  body <<<');
  for (const bodyLine of body.split('\n')) {
    lines.push(`    ${bodyLine}`);
  }
  lines.push('  >>>');

  return lines.join('\n');
}

/**
 * Transform a code snippet into a template body with {{slot}} placeholders.
 */
function buildTemplateBody(pattern: AnalyzedPattern): string {
  let body = pattern.representativeSnippet;

  // Replace extracted param values with {{slotName}} placeholders
  // Sort params by value length (longest first) to avoid partial replacements
  const sortedSlots = [...pattern.slots]
    .filter(s => s.value && s.value !== 'any' && s.value !== 'unknown')
    .sort((a, b) => b.value.length - a.value.length);

  for (const slot of sortedSlots) {

    // Replace literal value occurrences with {{slotName}}
    const escaped = escapeRegExp(slot.value);
    const re = new RegExp(escaped, 'g');
    body = body.replace(re, `{{${slot.name}}}`);
  }

  // Ensure the body has proper export
  if (!body.startsWith('export')) {
    body = `export ${body}`;
  }

  return body;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generate template proposals from analyzed patterns.
 */
export function proposeTemplates(patterns: AnalyzedPattern[]): TemplateProposal[] {
  const proposals: TemplateProposal[] = [];

  for (const pattern of patterns) {
    const kernSource = generateKernSource(pattern);
    const id = generateProposalId(pattern.templateName, pattern.structuralHash);

    proposals.push({
      id,
      templateName: pattern.templateName,
      namespace: pattern.namespace,
      kernSource,
      slots: pattern.slots,
      imports: pattern.imports,
      goldenExample: pattern.goldenExample,
      qualityScore: pattern.qualityScore,
      structuralHash: pattern.structuralHash,
      instanceCount: pattern.instanceCount,
      representativeSnippet: pattern.representativeSnippet,
    });
  }

  return proposals;
}
