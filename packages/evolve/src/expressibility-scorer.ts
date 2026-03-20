/**
 * Expressibility Scorer — measures how well the current IR handles a pattern.
 *
 * Scores from 0-10 where higher = less expressible (needs a new node type).
 * Used to decide when to propose new IR nodes vs. just new templates.
 */

import type { PatternGap, ExpressibilityScore } from './types.js';

// Weights for different signal types
const HANDLER_ESCAPE_WEIGHT = 3;
const NON_STANDARD_ATTR_WEIGHT = 2;
const SEMANTIC_LEAK_WEIGHT = 1.5;

// Max counts for normalization (clamp above these)
const MAX_HANDLER_ESCAPES = 5;
const MAX_NON_STANDARD_ATTRS = 8;
const MAX_SEMANTIC_LEAKS = 6;

/** Score above which a pattern is a candidate for a new IR node. */
export const EXPRESSIBILITY_NODE_THRESHOLD = 7.0;

/**
 * Score how well the current IR can express the patterns found in these gaps.
 *
 * - Handler escapes (<<<...>>>) mean the IR can't express the logic — weight 3
 * - Non-standard attributes mean the node types lack proper slots — weight 2
 * - Semantic leaks (raw code in props) mean the abstraction is leaking — weight 1.5
 */
export function scoreExpressibility(
  gaps: PatternGap[],
  snippets: string[],
): ExpressibilityScore {
  let handlerEscapes = 0;
  let nonStandardAttrs = 0;
  let semanticLeaks = 0;

  for (const snippet of snippets) {
    // Count handler escapes: <<<...>>>
    const handlerMatches = snippet.match(/<<<[^]*?>>>/g);
    if (handlerMatches) handlerEscapes += handlerMatches.length;

    // Count non-standard attributes (attrs that aren't name, value, type, etc.)
    const attrMatches = snippet.match(/\b[a-z][a-zA-Z]*=/g);
    if (attrMatches) {
      const standard = new Set(['name', 'value', 'type', 'key', 'id', 'class', 'src', 'href', 'label', 'placeholder']);
      for (const attr of attrMatches) {
        const attrName = attr.slice(0, -1);
        if (!standard.has(attrName)) nonStandardAttrs++;
      }
    }

    // Count semantic leaks: raw code expressions in {{ }}
    const exprMatches = snippet.match(/\{\{[^}]+\}\}/g);
    if (exprMatches) semanticLeaks += exprMatches.length;
  }

  // Also count from gap snippets not already in snippets array
  const snippetSet = new Set(snippets);
  for (const gap of gaps) {
    if (snippetSet.has(gap.snippet)) continue;
    if (gap.snippet.includes('<<<')) handlerEscapes++;
    if (gap.snippet.includes('{{')) semanticLeaks++;
  }

  // Normalize each dimension to 0-10
  const normHandler = Math.min(handlerEscapes / MAX_HANDLER_ESCAPES, 1) * 10;
  const normAttrs = Math.min(nonStandardAttrs / MAX_NON_STANDARD_ATTRS, 1) * 10;
  const normLeaks = Math.min(semanticLeaks / MAX_SEMANTIC_LEAKS, 1) * 10;

  // Weighted average
  const totalWeight = HANDLER_ESCAPE_WEIGHT + NON_STANDARD_ATTR_WEIGHT + SEMANTIC_LEAK_WEIGHT;
  const overall = (
    normHandler * HANDLER_ESCAPE_WEIGHT +
    normAttrs * NON_STANDARD_ATTR_WEIGHT +
    normLeaks * SEMANTIC_LEAK_WEIGHT
  ) / totalWeight;

  return {
    handlerEscapes,
    nonStandardAttrs,
    semanticLeaks,
    overall: Math.round(overall * 100) / 100,
  };
}

/** Check if an expressibility score warrants proposing a new IR node. */
export function isNodeCandidate(score: ExpressibilityScore): boolean {
  return score.overall > EXPRESSIBILITY_NODE_THRESHOLD;
}
